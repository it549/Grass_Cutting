"use client";

import { useState } from "react";
import { importOld, type OldExport } from "@/app/(app)/settings/import/actions";
import { addPhotos, type NewPhoto } from "@/app/(app)/orders/photo-actions";
import { uploadFile } from "@/lib/upload-client";

export function ImportOld({ companyId }: { companyId: string }) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const add = (l: string) => setLog((x) => [...x, l]);

  async function run(f: File | undefined) {
    if (!f) return;
    setErr(""); setLog([]); setBusy(true);
    try {
      let data: OldExport;
      const files: Record<string, Uint8Array> = {};
      if (/\.zip$/i.test(f.name)) {
        const { unzipSync, strFromU8 } = await import("fflate");
        const z = unzipSync(new Uint8Array(await f.arrayBuffer()));
        const key = Object.keys(z).find((k) => /(^|\/)data\.json$/.test(k));
        if (!key) throw new Error("ในไฟล์ zip ไม่มี data.json");
        data = JSON.parse(strFromU8(z[key]));
        for (const [k, v] of Object.entries(z)) { const m = /photos\/([^/.]+)\.[a-z0-9]+$/i.exec(k); if (m) files[m[1]] = v; }
      } else {
        data = JSON.parse(await f.text());
      }
      if (!data || typeof data !== "object" || !("inst" in data || "docs" in data || "settings" in data)) throw new Error("ไฟล์นี้ไม่ใช่ข้อมูลส่งออกจากระบบเดิม");
      add(`อ่านไฟล์แล้ว: ใบสั่งจ้าง ${data.inst?.length ?? 0} · เอกสาร ${data.docs?.length ?? 0} · รายวัน ${data.daily?.length ?? 0} · รูป ${Object.keys(files).length} ไฟล์`);
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
          list.push({ path, kind: p.kind, w: 0, h: 0, taken_date: p.date, taken_time: p.time, name: p.name, caption: p.cap });
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
      <input type="file" accept=".json,.zip,application/json,application/zip" disabled={busy} onChange={(e) => { run(e.target.files?.[0]); e.target.value = ""; }} />
      {busy && <p className="small">กำลังย้ายข้อมูล อย่าปิดหน้านี้…</p>}
      {err && <p className="alert bad">{err}</p>}
      {log.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  );
}
