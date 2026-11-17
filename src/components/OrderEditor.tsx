"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { saveOrder, type OrderInput } from "@/app/(app)/orders/actions";
import { addDays, fmt, fmt0, hmdFull, lineAmt, num, totals } from "@/lib/calc";

type AgencyOpt = { id: string; name: string; hmds: string[] };
type Row = { key: string; id?: string; code: string; descr: string; area: string; rate: string };

const k = () => Math.random().toString(36).slice(2);
const toRow = (r: { id?: string; code?: string; descr?: string; area?: number | string; rate?: number | string }): Row => ({
  key: k(),
  id: r.id,
  code: r.code ?? "",
  descr: r.descr ?? "",
  area: r.area === undefined || r.area === null || r.area === "" ? "" : String(r.area),
  rate: r.rate === undefined || r.rate === null || r.rate === "" ? "" : String(r.rate),
});
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function OrderEditor({
  initial,
  agencies,
  readOnly,
  canRead,
}: {
  initial: Omit<OrderInput, "routes"> & { routes: { id?: string; code: string; descr: string; area: number | string; rate: number | string }[] };
  agencies: AgencyOpt[];
  readOnly: boolean;
  canRead: boolean;
}) {
  const [o, setO] = useState({ ...initial, round_no: String(initial.round_no) });
  const [rows, setRows] = useState<Row[]>(() => (initial.routes.length ? initial.routes.map(toRow) : [toRow({})]));
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const ag = agencies.find((a) => a.id === o.agency_id);
  const hmdOpts = useMemo(() => {
    const l = [...(ag?.hmds ?? [])];
    if (o.hmd && !l.includes(o.hmd)) l.push(o.hmd);
    return l;
  }, [ag, o.hmd]);
  const t = totals(rows, o.vat_incl);
  const set = (f: keyof typeof o, v: string | boolean) =>
    setO((p) => {
      const n = { ...p, [f]: v };
      if ((f === "po_date" || f === "due_days") && isDate(n.po_date) && num(n.due_days) > 0)
        n.due_date = addDays(n.po_date, Math.trunc(num(n.due_days)));
      return n;
    });
  const setRow = (key: string, f: keyof Row, v: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [f]: v } : r)));

  async function readPO(files: FileList | null) {
    if (!files?.length) return;
    setErr("");
    setNote("");
    setReading(true);
    try {
      const fd = new FormData();
      [...files].forEach((f) => fd.append("file", f));
      const res = await fetch("/api/po-extract", { method: "POST", body: fd });
      const j = await res.json();
      if (j.po_file_path) setO((p) => ({ ...p, po_file_path: j.po_file_path }));
      if (!res.ok) throw new Error(j.error || "อ่านไม่สำเร็จ");
      const d = j.data;
      const rs: Row[] = (d.routes ?? []).map(toRow);
      const hmd = o.hmd || ag?.hmds.find((h) => String(d.hmd || "").includes(h)) || "";
      setO((p) => {
        const n = {
          ...p,
          po_no: d.no || p.po_no,
          po_date: isDate(d.date) ? d.date : p.po_date,
          proj_no: d.projNo || p.proj_no,
          due_days: d.dueDays ? String(d.dueDays) : p.due_days,
          due_date: isDate(d.dueDate) ? d.dueDate : p.due_date,
          penalty: d.penalty || p.penalty,
          vat_incl: d.vatIncl !== false,
          hmd,
        };
        if (!isDate(d.dueDate) && isDate(n.po_date) && num(n.due_days) > 0) n.due_date = addDays(n.po_date, Math.trunc(num(n.due_days)));
        return n;
      });
      if (rs.length) setRows(rs);
      const tt = totals(rs, d.vatIncl !== false);
      setNote(
        `Claude อ่านได้ ${rs.length} สายทาง รวม ${fmt0(tt.area)} ตร.ม. เป็นเงิน ${fmt(tt.total)} บาท` +
          (d.hmd && !hmd ? ` · ใบสั่งจ้างระบุหมวด "${d.hmd}" แต่ไม่ตรงกับหมวดในแขวงนี้ เลือกหมวดเอง` : "") +
          " · ตรวจกับใบสั่งจ้างจริงอีกครั้งก่อนกดบันทึก",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onSave(force = false) {
    setErr("");
    start(async () => {
      const r = await saveOrder({
        ...o,
        round_no: Math.trunc(num(o.round_no)),
        routes: rows.map(({ id, code, descr, area, rate }) => ({ id, code, descr, area, rate })),
        force,
      });
      if (r?.confirm) {
        if (window.confirm(r.error + "\n\nยืนยันบันทึก?")) onSave(true);
        return;
      }
      if (r?.error) setErr(r.error);
    });
  }

  // วางข้อมูลจาก Excel: รหัส <tab> ชื่อสาย <tab> พื้นที่ <tab> ราคา
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, key: string) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const parsed = text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => {
        const c = l.split("\t");
        return toRow({ code: c[0]?.trim(), descr: c[1]?.trim(), area: c[2]?.replace(/,/g, "").trim(), rate: c[3]?.replace(/,/g, "").trim() });
      });
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const keep = rs.slice(0, i).concat(rs.slice(i + 1).filter((r) => r.code || r.descr || r.area || r.rate));
      keep.splice(i, 0, ...parsed);
      return keep;
    });
  }

  const ro = readOnly;
  return (
    <div className="stack" style={{ gap: 18 }}>
      {!ro && (
        <div className="card drop">
          <div className="serif h3" style={{ marginBottom: 4 }}>อ่านจากใบสั่งจ้าง</div>
          <p className="small muted" style={{ margin: "0 0 10px" }}>
            แนบ PDF ใบสั่งจ้าง (หรือรูปถ่ายทุกหน้า) Claude จะกรอกเลขที่ วันที่ สายทาง พื้นที่ และราคาต่อ ตร.ม. ให้ แล้วตรวจแก้ได้ก่อนบันทึก
          </p>
          <div className="acts" style={{ alignItems: "center" }}>
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple disabled={reading || !canRead} onChange={(e) => readPO(e.target.files)} />
            {reading && <span className="small">กำลังให้ Claude อ่าน อาจใช้เวลา 20–60 วินาที…</span>}
          </div>
          {!canRead && <p className="small" style={{ color: "var(--warn)" }}>ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY จึงอ่านอัตโนมัติไม่ได้ กรอกเองด้านล่างได้</p>}
        </div>
      )}
      {note && <p className="alert ok" style={{ margin: 0 }}>{note}</p>}
      {err && <p className="alert bad" style={{ margin: 0 }}>{err}</p>}

      <div className="card">
        <div className="serif h3">ข้อมูลใบสั่งจ้าง</div>
        <div className="grid4">
          <label className="span2">แขวง (ผู้ว่าจ้าง)
            <select value={o.agency_id} disabled={ro} onChange={(e) => set("agency_id", e.target.value)}>
              {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>งวดที่<input type="number" min={1} value={o.round_no} disabled={ro} onChange={(e) => set("round_no", e.target.value)} /></label>
          <label>หมวด
            <select value={o.hmd} disabled={ro} onChange={(e) => set("hmd", e.target.value)}>
              <option value="">— เลือกหมวด —</option>
              {hmdOpts.map((h) => <option key={h} value={h}>{hmdFull(h)}</option>)}
            </select>
          </label>
          <label>เลขที่ใบสั่งจ้าง<input value={o.po_no} disabled={ro} onChange={(e) => set("po_no", e.target.value)} placeholder="034/2569" /></label>
          <label>ลงวันที่<input type="date" value={o.po_date} disabled={ro} onChange={(e) => set("po_date", e.target.value)} /></label>
          <label>ส่งมอบภายใน (วัน)<input type="number" min={0} value={o.due_days} disabled={ro} onChange={(e) => set("due_days", e.target.value)} /></label>
          <label>ครบกำหนดส่งมอบ<input type="date" value={o.due_date} disabled={ro} onChange={(e) => set("due_date", e.target.value)} /></label>
          <label>เลขที่โครงการ<input value={o.proj_no} disabled={ro} onChange={(e) => set("proj_no", e.target.value)} /></label>
          <label className="span3">ค่าปรับ<input value={o.penalty} disabled={ro} onChange={(e) => set("penalty", e.target.value)} /></label>
          <label className="chk span4"><input type="checkbox" checked={o.vat_incl} disabled={ro} onChange={(e) => set("vat_incl", e.target.checked)} /> ราคาต่อ ตร.ม. รวมภาษีมูลค่าเพิ่มแล้ว</label>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="serif h3">สายทาง ({rows.filter((r) => r.code || r.descr).length} สาย)</div>
          {!ro && <span className="small muted">วางจาก Excel ได้: รหัส | ชื่อสาย | พื้นที่ | ราคา</span>}
        </div>
        <table className="tbl rt">
          <thead>
            <tr><th style={{ width: 40 }}>#</th><th style={{ width: 120 }}>รหัสสายทาง</th><th>ชื่อสายทาง</th><th style={{ width: 120 }} className="n">พื้นที่ (ตร.ม.)</th><th style={{ width: 100 }} className="n">ราคา/ตร.ม.</th><th style={{ width: 130 }} className="n">จำนวนเงิน</th>{!ro && <th style={{ width: 36 }} />}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="c muted">{i + 1}</td>
                <td><input value={r.code} disabled={ro} onChange={(e) => setRow(r.key, "code", e.target.value)} onPaste={(e) => onPaste(e, r.key)} /></td>
                <td><input value={r.descr} disabled={ro} onChange={(e) => setRow(r.key, "descr", e.target.value)} /></td>
                <td><input className="n" inputMode="decimal" value={r.area} disabled={ro} onChange={(e) => setRow(r.key, "area", e.target.value)} /></td>
                <td><input className="n" inputMode="decimal" value={r.rate} disabled={ro} onChange={(e) => setRow(r.key, "rate", e.target.value)} /></td>
                <td className="n">{fmt(lineAmt(r))}</td>
                {!ro && <td className="c"><button type="button" className="x" title="ลบแถว" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [toRow({})]))}>×</button></td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td /><td colSpan={2}>{!ro && <button type="button" className="link" onClick={() => setRows((rs) => [...rs, toRow({ rate: rs[rs.length - 1]?.rate ?? "" })])}>+ เพิ่มสายทาง</button>}</td><td className="n"><b>{fmt0(t.area)}</b></td><td /><td className="n"><b>{fmt(t.sum)}</b></td>{!ro && <td />}</tr>
          </tfoot>
        </table>
        <div className="sumbox">
          <div><span>มูลค่าก่อนภาษี</span><span>{fmt(t.pre)}</span></div>
          <div><span>ภาษีมูลค่าเพิ่ม 7%</span><span>{fmt(t.vat)}</span></div>
          <div className="g"><span>รวมทั้งสิ้น</span><span>{fmt(t.total)}</span></div>
          <div className="muted"><span>หัก ณ ที่จ่าย 1% (จากยอดก่อนภาษี)</span><span>{fmt(t.wht)}</span></div>
          <div className="muted"><span>รับสุทธิโดยประมาณ</span><span>{fmt(t.net)}</span></div>
        </div>
      </div>

      {!ro && (
        <div className="acts">
          <button type="button" className="btn dk" disabled={saving || reading} onClick={() => onSave()}>{saving ? "กำลังบันทึก…" : "บันทึกใบสั่งจ้าง"}</button>
        </div>
      )}
    </div>
  );
}
