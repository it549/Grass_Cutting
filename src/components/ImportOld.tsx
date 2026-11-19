"use client";

import { useState } from "react";
import { importOld, type OldExport } from "@/app/(app)/settings/import/actions";
import { addPhotos, type NewPhoto } from "@/app/(app)/orders/photo-actions";
import { uploadFile } from "@/lib/upload-client";
import { useRouter } from "next/navigation";
import type { World } from "@/lib/model";
import { RoadImport } from "@/app/(app)/roads/RoadImport";

type Kind = "zip" | "json" | "image" | "pdf" | "other";

function sniff(b: Uint8Array): Kind {
  if (b[0] === 0x50 && b[1] === 0x4b) return "zip"; // PK
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf"; // %PDF
  if (b[0] === 0xff && b[1] === 0xd8) return "image"; // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image"; // PNG
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return "image"; // RIFF (WEBP)
  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0; // BOM
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  return b[i] === 0x7b ? "json" : "other"; // {
}

function parseJson(s: string): OldExport {
  try {
    return JSON.parse(s.replace(/^﻿/, ""));
  } catch {
    throw new Error("อ่าน data.json ไม่ได้ ไฟล์อาจเสียหรือดาวน์โหลดไม่ครบ ลองส่งออกจากระบบเดิมใหม่");
  }
}

export function ImportOld({ companyId, W, canRead }: { companyId: string; W: World; canRead: boolean }) {
  const router = useRouter();
  const [roadFiles, setRoadFiles] = useState<File[] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const add = (l: string) => setLog((x) => [...x, l]);

  async function run(picked: File[]) {
    if (!picked.length) return;
    setErr(""); setLog([]); setBusy(true);
    try {
      let data: OldExport | undefined;
      const files: Record<string, Uint8Array> = {};
      // ดูชนิดไฟล์จากเนื้อไฟล์จริง ไม่เชื่อนามสกุล
      const typed = await Promise.all(picked.map(async (f) => {
        const bytes = new Uint8Array(await f.arrayBuffer());
        return { f, bytes, kind: sniff(bytes) };
      }));
      const zip = typed.find((t) => t.kind === "zip");
      const json = typed.find((t) => t.kind === "json");
      if (zip) {
        const { unzipSync, strFromU8 } = await import("fflate");
        const z = unzipSync(zip.bytes);
        const key = Object.keys(z).find((k) => /(^|\/)data\.json$/.test(k));
        if (!key) throw new Error("ในไฟล์ zip ไม่มี data.json");
        data = parseJson(strFromU8(z[key]));
        for (const [k, v] of Object.entries(z)) { const m = /photos\/([^/.]+)\.[a-z0-9]+$/i.exec(k); if (m) files[m[1]] = v; }
      } else if (json) {
        data = parseJson(new TextDecoder().decode(json.bytes));
      } else if (typed.some((t) => t.kind === "image" || t.kind === "pdf")) {
        // รูป/PDF รายชื่อสายทาง → เปิดหน้าต่างให้ AI อ่านและบันทึกเข้าทะเบียนสายทาง
        if (!W.agencies.length) throw new Error("ต้องเพิ่มแขวงและหมวดก่อน (ตั้งค่า → แขวงและหมวด) แล้วจึงใส่รูปรายชื่อสายทาง");
        setRoadFiles(typed.filter((t) => t.kind === "image" || t.kind === "pdf").map((t) => t.f));
        return;
      } else {
        throw new Error("ไฟล์นี้ไม่ใช่ข้อมูลส่งออกจากระบบเดิม ให้เลือกไฟล์ .zip หรือ data.json");
      }
      // แตก zip แล้วเลือก data.json + รูปมาพร้อมกัน: ใช้ชื่อไฟล์ (ไม่มีนามสกุล) เป็นรหัสรูป
      for (const t of typed) if (t.kind === "image") { const m = /^([^/.]+)\.[a-z0-9]+$/i.exec(t.f.name); if (m && !files[m[1]]) files[m[1]] = t.bytes; }
      if (!data || typeof data !== "object" || !("inst" in data || "docs" in data || "settings" in data)) throw new Error("ไฟล์นี้ไม่ใช่ข้อมูลส่งออกจากระบบเดิม");
      add(`อ่านไฟล์แล้ว: สายทาง ${data.road?.length ?? 0} · ใบสั่งจ้าง/แผน ${data.inst?.length ?? 0} · เอกสาร ${data.docs?.length ?? 0} · รายวัน ${data.daily?.length ?? 0} · เบิก ${data.adv?.length ?? 0} · จ่ายค่าแรง ${data.pay?.length ?? 0} · น้ำมัน ${data.fuel?.length ?? 0} · รูป ${Object.keys(files).length} ไฟล์`);
      const r = await importOld(data);
      r.log.forEach(add);
      if (r.error) throw new Error(r.error);
      let up = 0, miss = 0;
      for (const job of r.photos) {
        const list: NewPhoto[] = [];
        for (const p of job.pics) {
          const bytes = files[p.asset];
          if (!bytes) { miss++; continue; }
          const path = `${companyId}/photos/${job.orderId}/${crypto.randomUUID()}.jpg`;
          const { error } = await uploadFile(path, new Blob([bytes as BlobPart], { type: "image/jpeg" }));
          if (error) { add(`รูป ${p.name || p.asset}: ${error}`); continue; }
          list.push({ path, kind: p.kind, slot: p.slot, w: 0, h: 0, taken_date: p.date, taken_time: p.time, name: p.name, caption: p.cap, sig: p.sig });
        }
        if (list.length) {
          const res = await addPhotos(job.orderId, job.routeId, list);
          if (res.error) add(`รูป: ${res.error}`); else up += list.length;
        }
      }
      if (r.photos.length) add(`รูป: อัปโหลด ${up} รูป${miss ? ` · ไม่พบไฟล์ ${miss} รูป` : ""}`);
      add("เสร็จแล้ว");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {roadFiles && W.agencies[0] ? (
        <RoadImport
          W={W}
          A={W.agencies[0]}
          hmd={W.agencies[0].hmds[0] ?? ""}
          canRead={canRead}
          initFiles={roadFiles}
          onClose={() => setRoadFiles(null)}
          onSaved={(h) => { setRoadFiles(null); router.push(`/roads?ag=${encodeURIComponent(W.agencies[0].id)}&h=${encodeURIComponent(h)}`); }}
        />
      ) : null}
      <input type="file" multiple accept=".json,.zip,application/json,application/zip,application/pdf,image/*" disabled={busy} onChange={(e) => { run(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {busy && <p className="small">กำลังย้ายข้อมูล อย่าปิดหน้านี้…</p>}
      {err && <p className="alert bad">{err}</p>}
      {log.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  );
}
