"use client";

// เพิ่มสายทางจากเอกสาร: วางข้อความ / แนบรูป / PDF → AI อ่านและแยกหมวดตามหัวตาราง → ตรวจแล้วบันทึก
import { useEffect, useRef, useState } from "react";
import { Chip, Dialog, toast } from "@/components/ui";
import { type Agency, type World, num, regFind } from "@/lib/model";
import { shrink } from "@/lib/image";
import { saveRoads } from "./actions";

type In = { hmd: string | null; code: string; name: string; amp: string; len: number | null };
type Row = { hmd: string; code: string; name: string; amp: string; len: string; fromDoc: boolean; dup: boolean; on: boolean };

const normH = (h: string | null | undefined) => String(h || "").replace(/^หมวด(ฯ|บำรุงทางหลวงชนบท|บำรุงทาง)?\s*/, "").trim();

/** อ่านแบบพื้นฐาน (ไม่ใช้ AI): แถวจาก Excel หรือบรรทัด "ชบ.3083 ชื่อสาย 5.5" และหัวข้อ "หมวด…" */
function localParse(t: string): In[] {
  let curH: string | null = null;
  const out: In[] = [];
  for (const l of t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const hm = /^หมวด(?:ฯ|บำรุงทางหลวงชนบท|บำรุงทาง)?\s*([ก-๙]+)\s*$/.exec(l);
    if (hm) { curH = hm[1]; continue; }
    const c = l.split("\t");
    if (c.length >= 2 && /\d/.test(c[0])) { out.push({ hmd: curH, code: c[0].trim(), name: (c[1] || "").trim(), amp: (c[2] || "").trim(), len: c[3] != null && c[3] !== "" ? num(c[3]) : null }); continue; }
    const m = /^([ก-ฮ]{1,3}\.?\s?\d{3,5}|\d{3,5})\s*(.*)$/.exec(l);
    if (!m) continue;
    let rest = m[2], len: number | null = null;
    const lm = /(\d+(?:\.\d+)?)\s*(กม\.?|km)?\s*$/i.exec(rest);
    if (lm) { len = num(lm[1]); rest = rest.slice(0, lm.index).trim(); }
    out.push({ hmd: curH, code: m[1].replace(/\s/g, ""), name: rest.replace(/^สาย\s*/, ""), amp: "", len });
  }
  return out;
}

export function RoadImport({ W, A, hmd, canRead, onClose, onSaved, initFiles }: {
  W: World; A: Agency; hmd: string; canRead: boolean; onClose: () => void; onSaved: (h: string) => void;
  /** แนบไฟล์มาแล้ว: เปิดหน้าต่างแล้วให้ AI อ่านทันที */
  initFiles?: File[];
}) {
  const [def, setDef] = useState(A.hmds.includes(hmd) ? hmd : A.hmds[0] ?? "");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>(initFiles ?? []);
  const autoRan = useRef(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [extraH, setExtraH] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ c: "ok" | "warn" | "bad"; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);

  const matchH = (h: string | null) => {
    const v = normH(h);
    if (!v) return null;
    return A.hmds.find((x) => x === v) || A.hmds.find((x) => v.includes(x) || x.includes(v)) || v;
  };
  const setFrom = (rs: In[]) => {
    const ex: string[] = [];
    const L = rs.filter((r) => r.code).map((r) => {
      const h = matchH(r.hmd);
      if (h && !A.hmds.includes(h) && !ex.includes(h)) ex.push(h);
      const dup = !!regFind(W, A.id, r.code);
      return { hmd: h ?? def, code: r.code, name: r.name, amp: r.amp, len: r.len == null ? "" : String(r.len), fromDoc: !!h, dup, on: !dup };
    });
    setExtraH(ex); setRows(L);
    return L.some((r) => r.fromDoc);
  };
  const sep = (by: boolean) => (by ? "แยกหมวดตามหัวตารางในเอกสารแล้ว" : "เอกสารไม่ได้แยกหมวด ใช้หมวดที่เลือกด้านบน");

  const read = async () => {
    const t = text.trim();
    if (!t && !files.length) { toast("วางรายการหรือแนบรูปก่อน", true); return; }
    if (!canRead) {
      if (t) { const by = setFrom(localParse(t)); setMsg({ c: "warn", t: `อ่านแบบพื้นฐาน (ยังไม่ได้ตั้งค่า AI) · ${sep(by)} · ตรวจทุกช่องก่อนบันทึก` }); }
      else setMsg({ c: "bad", t: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY หรือ ANTHROPIC_API_KEY จึงอ่านรูปไม่ได้ วางเป็นข้อความแทน" });
      return;
    }
    setBusy(true); setMsg({ c: "warn", t: "AI กำลังอ่าน… ใช้เวลาประมาณ 20–60 วินาที" });
    try {
      const fd = new FormData();
      fd.append("text", t);
      fd.append("hmds", A.hmds.join("|"));
      for (const f of files) fd.append("file", f.type.startsWith("image/") && f.size > 1.5e6 ? new File([(await shrink(f, 2000)).blob], f.name + ".jpg", { type: "image/jpeg" }) : f);
      const res = await fetch("/api/road-extract", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({ error: "อ่านไม่สำเร็จ" }));
      if (!res.ok) throw new Error(j.error || "อ่านไม่สำเร็จ");
      const rs: In[] = (j.data?.routes ?? []).map((r: { hmd?: string; code?: string; name?: string; amp?: string; len?: number | null }) => ({
        hmd: String(r.hmd || "").trim(), code: String(r.code || "").trim(), name: String(r.name || "").trim(), amp: String(r.amp || "").trim(), len: r.len == null ? null : num(r.len),
      }));
      const by = setFrom(rs);
      setMsg({ c: "ok", t: `อ่านได้ ${rs.length} สาย · ${sep(by)} · ตรวจหมวดและแก้ได้ก่อนบันทึก` });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      if (t) { const by = setFrom(localParse(t)); setMsg({ c: "warn", t: `AI อ่านไม่สำเร็จ (${err}) ใช้การอ่านแบบพื้นฐานแทน · ${sep(by)} · ตรวจทุกช่องก่อนบันทึก` }); }
      else setMsg({ c: "bad", t: err });
    }
    setBusy(false);
  };
  useEffect(() => {
    if (autoRan.current || !initFiles?.length) return;
    autoRan.current = true;
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changeDef = (v: string) => { setDef(v); setRows((rs) => rs.map((r) => (r.fromDoc ? r : { ...r, hmd: v }))); };
  const upd = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));

  const save = async () => {
    const L = rows.filter((r) => r.on && r.code.trim() && !regFind(W, A.id, r.code));
    if (!L.length) return;
    setBusy(true);
    const res = await saveRoads(L.map((r) => ({ agency_id: A.id, hmd: r.hmd, code: r.code, name: r.name, amp: r.amp, len_km: r.len.trim() === "" ? null : num(r.len), note: "" })));
    setBusy(false);
    if (!res.ok) { toast(res.error, true); return; }
    const by: Record<string, number> = {};
    L.forEach((r) => { const k = r.hmd || "ไม่ระบุ"; by[k] = (by[k] ?? 0) + 1; });
    toast(`เพิ่ม ${L.length} สายแล้ว · ${Object.entries(by).map(([h, n]) => h + " " + n).join(" · ")}`);
    onSaved(L[0]?.hmd ?? hmd);
  };

  const hs = [...A.hmds, ...extraH];
  const cnt: Record<string, number> = {};
  rows.filter((r) => r.on).forEach((r) => { cnt[r.hmd] = (cnt[r.hmd] ?? 0) + 1; });
  const nOn = rows.filter((r) => r.on).length;

  return (
    <Dialog
      wide
      title="เพิ่มสายทางจากเอกสาร"
      onClose={onClose}
      foot={<>
        <span className="muted small">{rows.length ? `เลือก ${nOn} จาก ${rows.length} สาย` : ""}</span>
        <div className="acts"><button className="btn" type="button" onClick={onClose}>ยกเลิก</button><button className="btn pr" type="button" disabled={!nOn || busy} onClick={save}>บันทึกเข้าทะเบียน</button></div>
      </>}
    >
      <div className="grid2">
        <label className="f">แขวง<input className="in" value={A.name} disabled /></label>
        <label className="f">หมวด (ถ้าเอกสารไม่ได้แยกหมวด)
          <select className="in" value={def} onChange={(e) => changeDef(e.target.value)}>
            {A.hmds.map((h) => <option key={h} value={h}>{h}</option>)}<option value="">ไม่ระบุหมวด</option>
          </select>
        </label>
      </div>
      <label className="f" style={{ marginTop: 12 }}>วางรายการสายทาง (จาก Excel, LINE หรือเอกสาร)
        <textarea className="in" style={{ minHeight: 100 }} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"ชบ.3083 แยก ทล.3 - บ้านหนองปลาไหล บางละมุง 5.5\nชบ.4036 แยก ทล.331 - บ้านเขาไม้แก้ว 5.3"} />
      </label>
      <div className="acts" style={{ marginTop: 8 }}>
        <button className="btn sm" type="button" onClick={() => fileIn.current?.click()}>แนบรูป / PDF</button>
        <input ref={fileIn} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        <span className="muted small">{files.length ? `แนบ ${files.length} ไฟล์` : ""}</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm pr" type="button" disabled={busy} onClick={read}>{canRead ? "ให้ AI อ่าน" : "อ่านรายการ"}</button>
      </div>
      <div className="hint" style={{ marginTop: 6, whiteSpace: "normal" }}>ถ้าเอกสารแยกตารางตามหมวด AI จะแยกหมวดให้ทีละสาย ตรวจและเปลี่ยนหมวดได้ในตารางก่อนบันทึก</div>
      {msg ? <div className={msg.c + "box"}>{msg.t}</div> : null}
      {rows.length ? <>
        <div className="acts" style={{ marginTop: 12 }}>
          {Object.entries(cnt).map(([h, n]) => <Chip key={h} c={h ? "g" : "w"}>{h ? "หมวด" + h : "ไม่ระบุหมวด"} {n} สาย</Chip>)}
          {extraH.length ? <span className="small" style={{ color: "var(--warn)" }}>หมวดใหม่ {extraH.join(", ")} จะถูกเพิ่มเข้าแขวงตอนบันทึก</span> : null}
        </div>
        <div className="tscroll"><table className="tb rgt" style={{ marginTop: 8 }}>
          <thead><tr><th></th><th>หมวด</th><th>เลขสาย</th><th>ชื่อสาย</th><th>อำเภอ</th><th className="n">กม.</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.dup ? "dim" : undefined}>
                <td><input type="checkbox" checked={r.on} disabled={r.dup} onChange={(e) => upd(i, { on: e.target.checked })} /></td>
                <td><select className="in" value={r.hmd} style={{ width: 130 }} onChange={(e) => upd(i, { hmd: e.target.value })}>{hs.map((h) => <option key={h} value={h}>{h}</option>)}<option value="">ไม่ระบุ</option></select></td>
                <td><input className="in" value={r.code} style={{ width: 110 }} onChange={(e) => upd(i, { code: e.target.value })} />{r.dup ? <div className="small" style={{ color: "var(--warn)" }}>มีในทะเบียนแล้ว</div> : null}</td>
                <td><input className="in" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} /></td>
                <td><input className="in" value={r.amp} style={{ width: 130 }} onChange={(e) => upd(i, { amp: e.target.value })} /></td>
                <td><input className="in" value={r.len} style={{ textAlign: "right", width: 64 }} onChange={(e) => upd(i, { len: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </> : null}
    </Dialog>
  );
}
