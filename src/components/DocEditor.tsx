"use client";
/* eslint-disable react-hooks/refs, react-hooks/purity, react-hooks/preserve-manual-memoization -- ตัวแก้เอกสารเก็บประวัติย้อน/ทำซ้ำใน ref โดยตั้งใจ */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { copyDoc, deleteDoc, saveDoc, setDocStatus } from "@/app/(app)/docs/actions";
import { docTotals, letterItems, routeItems, STATUS_LABEL, type DocData, type Head, type RouteLite } from "@/lib/docs";
import { num } from "@/lib/calc";
import { bahtText, fileSafe, fmt } from "@/lib/print/fmt";
import { docPages, registerUrls } from "@/lib/print/pages";
import { Preview } from "@/components/print/Preview";
import { PdfButton } from "@/components/print/PdfButton";

type P = string;
const getP = (o: unknown, path: P) => path.split(".").reduce<unknown>((x, p) => (x == null ? x : (x as Record<string, unknown>)[p]), o);
function setP<T>(o: T, path: P, v: unknown): T {
  const n = structuredClone(o) as Record<string, unknown>;
  const ps = path.split(".");
  let x = n;
  while (ps.length > 1) {
    const p = ps.shift()!;
    if (x[p] == null) x[p] = {};
    x = x[p] as Record<string, unknown>;
  }
  x[ps[0]] = v;
  return n as T;
}

export function DocEditor({ id, initial, canEdit, canIssue = true, orderId, orderLabel, routes, companyHead, urls }: {
  id: string;
  initial: DocData;
  canEdit: boolean;
  /** ออก/ยกเลิกเอกสารได้ (ใบกำกับภาษี = เฉพาะบัญชีหรือเจ้าของ) */
  canIssue?: boolean;
  orderId: string | null;
  orderLabel: string;
  routes: RouteLite[];
  companyHead: Head;
  urls: Record<string, string>;
}) {
  registerUrls(urls);
  const router = useRouter();
  const [d, setD] = useState<DocData>(initial);
  const hist = useRef<DocData[]>([]);
  const fut = useRef<DocData[]>([]);
  const last = useRef(0);
  const [hc, setHc] = useState({ h: 0, f: 0 });
  const sync = () => setHc({ h: hist.current.length, f: fut.current.length });
  const [saving, setSaving] = useState<"" | "saving" | "saved">("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const dRef = useRef(d);

  const L = !canEdit || d.status === "void" || (d.kind === "rc" && d.status !== "draft");
  const LT = d.layout === "letter";
  const t = docTotals(d);

  const doSave = useCallback(async (doc: DocData) => {
    setSaving("saving");
    const r = await saveDoc(id, doc);
    if (r.error) { setErr("บันทึกไม่สำเร็จ: " + r.error); setSaving(""); }
    else { setErr(""); setSaving("saved"); dirty.current = false; }
  }, [id]);

  const change = (fn: (x: DocData) => DocData, now = false) => {
    if (L) return;
    const cur = dRef.current;
    const tm = Date.now();
    if (tm - last.current > 900) { hist.current.push(cur); if (hist.current.length > 80) hist.current.shift(); fut.current = []; }
    last.current = tm;
    const n = fn(cur);
    dRef.current = n;
    dirty.current = true;
    setD(n);
    sync();
    if (saveT.current) clearTimeout(saveT.current);
    saveT.current = setTimeout(() => doSave(n), now ? 0 : 800);
  };
  const set = (path: P, v: unknown) => change((x) => setP(x, path, v));
  const undo = () => { if (L || !hist.current.length) return; fut.current.push(d); const p = hist.current.pop()!; last.current = 0; dRef.current = p; setD(p); doSave(p); sync(); };
  const redo = () => { if (L || !fut.current.length) return; hist.current.push(d); const p = fut.current.pop()!; last.current = 0; dRef.current = p; setD(p); doSave(p); sync(); };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    const bu = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };
    window.addEventListener("keydown", k);
    window.addEventListener("beforeunload", bu);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("beforeunload", bu); };
  });

  const act = (fn: () => Promise<{ error?: string } | void>, after?: () => void) =>
    start(async () => {
      if (saveT.current && dirty.current) { clearTimeout(saveT.current); await doSave(dRef.current); }
      const r = await fn();
      if (r && r.error) { setErr(r.error); return; }
      after?.();
      router.refresh();
    });

  const inp = (path: P, label: string, o: { span?: boolean; area?: number; type?: string; numeric?: boolean; ph?: string } = {}) => {
    const v = getP(d, path);
    const common = {
      disabled: L,
      placeholder: o.ph,
      value: v == null ? "" : String(v),
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(path, o.numeric ? (e.target.value.trim() === "" ? "" : num(e.target.value)) : e.target.value),
    };
    return (
      <label className={o.span ? "wide" : ""}>
        {label}
        {o.area ? <textarea rows={o.area} {...common} /> : <input type={o.type ?? "text"} {...common} inputMode={o.numeric ? "decimal" : undefined} />}
      </label>
    );
  };
  const arr = <K extends "info" | "items" | "notes" | "sign">(k: K) => (d[k] ?? []) as DocData[K];
  const addRow = (k: "info" | "items" | "notes" | "sign") =>
    change((x) => ({ ...x, [k]: [...((x[k] as unknown[]) ?? []), k === "info" ? ["", ""] : k === "items" ? { desc: "", qty: "", unit: "ตารางเมตร", price: "" } : k === "notes" ? { h: "", t: "" } : { label: "", name: "" }] }), true);
  const rmRow = (k: "info" | "items" | "notes" | "sign", i: number) => change((x) => ({ ...x, [k]: (x[k] as unknown[]).filter((_, j) => j !== i) }), true);
  const mv = (i: number, j: number) => change((x) => { const a = [...x.items]; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, items: a }; }, true);

  const both = d.copy === "ต้นฉบับ + สำเนา";
  const st = STATUS_LABEL[d.status];
  const back = orderId ? `/orders/${orderId}` : "/docs";

  return (
    <div className="ed">
      <div className="form">
        <p style={{ margin: "0 0 10px" }}><Link href={back}>← {orderLabel || "เอกสารทั้งหมด"}</Link></p>
        {L && canEdit && <div className="alert">{d.status === "void" ? `เอกสารนี้ถูกยกเลิกแล้ว${d.voidReason ? " (" + d.voidReason + ")" : ""}` : "ใบกำกับภาษีที่ออกแล้วแก้ไขไม่ได้ตามกฎหมาย"} · ถ้าต้องแก้ ให้ยกเลิกแล้วกด “ทำฉบับใหม่จากใบนี้”</div>}
        {!canEdit && <div className="alert">ดูได้อย่างเดียว เอกสารประเภทนี้แก้ได้เฉพาะธุรการหรือเจ้าของ</div>}
        {canEdit && !canIssue && d.status === "draft" && <div className="alert">ทำร่างได้ การออกและยกเลิกใบกำกับภาษี/ใบเสร็จเป็นของฝ่ายบัญชีหรือเจ้าของ</div>}
        {LT && !L && <div className="alert ok">ในข้อความใส่ {"{จำนวนเงิน} {ตัวอักษร} {จำนวนสาย} {พื้นที่}"} ได้ ระบบคำนวณจากรายการให้อัตโนมัติ</div>}
        {d.replaces && <p className="small muted">ทำแทนเอกสารเลขที่ {d.replaces}</p>}

        <section><h3>หัวเอกสาร</h3><div className="grid2">
          {inp("title", "ชื่อเอกสาร")}{inp("en", "ชื่อภาษาอังกฤษ")}{inp("no", "เลขที่")}{inp("date", "วันที่", { type: "date" })}
          {!LT && inp("dateLabel", "คำหน้าวันที่", { ph: "วันที่" })}
          <label>ฉบับ
            <select value={d.copy || ""} disabled={L} onChange={(e) => set("copy", e.target.value)}>
              {["ต้นฉบับ", "สำเนา", "ต้นฉบับ + สำเนา", ""].map((x) => <option key={x} value={x}>{x || "ไม่แสดง"}</option>)}
            </select>
          </label>
        </div></section>

        <section><h3>ผู้ออกเอกสาร {!L && <button type="button" className="link" onClick={() => change((x) => ({ ...x, head: { ...companyHead, noLogo: x.head?.noLogo } }), true)}>ดึงจากตั้งค่าบริษัท</button>}</h3><div className="grid2">
          {inp("head.name", "ชื่อบริษัท", { span: true })}{inp("head.address", "ที่อยู่", { span: true, area: 2 })}
          {inp("head.taxId", "เลขประจำตัวผู้เสียภาษี")}{inp("head.branch", "สาขา")}{inp("head.phone", "โทร")}{inp("head.email", "อีเมล")}
          <label className="chk wide"><input type="checkbox" checked={Boolean(d.head?.noLogo)} disabled={L} onChange={(e) => set("head.noLogo", e.target.checked)} /> ไม่แสดงโลโก้</label>
        </div></section>

        {LT ? (
          <>
            <section><h3>หนังสือ</h3><div className="grid2">
              {inp("subject", "เรื่อง", { span: true })}{inp("to", "เรียน", { span: true })}{inp("ref", "อ้างถึง", { span: true })}{inp("encl", "สิ่งที่ส่งมาด้วย (ว่าง = ไม่แสดง)", { span: true, area: 2 })}
            </div></section>
            <section><h3>ย่อหน้าแรก (ก่อนรายการสาย)</h3>{inp("p1", "", { area: 3 })}
              <label style={{ marginTop: 8 }}>รูปแบบรายการสาย
                <select value={d.listStyle === "lines" ? "lines" : "table"} disabled={L} onChange={(e) => set("listStyle", e.target.value)}>
                  <option value="lines">บรรทัดข้อความ (แบบหนังสือ)</option>
                  <option value="table">ตาราง พื้นที่ + ยอดเงินรายสาย</option>
                </select>
              </label>
            </section>
          </>
        ) : (
          <>
            <section><h3>ลูกค้า / ผู้รับเอกสาร</h3><div className="grid2">
              {inp("party.label", "หัวกล่อง")}{inp("party.name", "ชื่อ")}{inp("party.address", "ที่อยู่", { span: true, area: 2 })}{inp("party.phone", "โทรศัพท์")}{inp("party.tax", "เลขประจำตัวผู้เสียภาษี")}
            </div></section>
            <section><h3>ข้อมูลอ้างอิง (กล่องขวา) {!L && <button type="button" className="link" onClick={() => addRow("info")}>+ เพิ่มแถว</button>}</h3>
              {arr("info").map((_, i) => (
                <div key={i} className="rowx" style={{ gridTemplateColumns: "130px 1fr auto" }}>
                  <input value={d.info[i][0]} disabled={L} onChange={(e) => set(`info.${i}.0`, e.target.value)} />
                  <input value={d.info[i][1]} disabled={L} onChange={(e) => set(`info.${i}.1`, e.target.value)} />
                  {!L && <button type="button" className="x" onClick={() => rmRow("info", i)}>×</button>}
                </div>
              ))}
            </section>
            <section><h3>ข้อความนำ</h3>{inp("intro", "", { area: 3 })}</section>
          </>
        )}

        <section><h3>รายการ {!L && <span className="acts" style={{ gap: 12 }}>
          {routes.length > 0 && <button type="button" className="link" onClick={() => window.confirm(`แทนรายการทั้งหมดด้วยสายทาง ${routes.length} สายจากใบสั่งจ้าง?`) && change((x) => ({ ...x, items: x.layout === "letter" ? letterItems(routes) : routeItems(routes) }), true)}>ดึงสายทางจากใบสั่งจ้างใหม่</button>}
          <button type="button" className="link" onClick={() => addRow("items")}>+ เพิ่มรายการ</button></span>}</h3>
          {d.items.map((it, i) => (
            <div key={i} className="itm">
              <textarea rows={2} value={it.desc} disabled={L} onChange={(e) => set(`items.${i}.desc`, e.target.value)} />
              <div className="r">
                <span className="small muted">#{i + 1}</span>
                <input className="n" placeholder="จำนวน" value={it.qty} disabled={L} onChange={(e) => set(`items.${i}.qty`, e.target.value.trim() === "" ? "" : num(e.target.value))} />
                <input placeholder="หน่วย" value={it.unit} disabled={L} onChange={(e) => set(`items.${i}.unit`, e.target.value)} />
                <input className="n" placeholder="ราคา" value={it.price} disabled={L} onChange={(e) => set(`items.${i}.price`, e.target.value.trim() === "" ? "" : num(e.target.value))} />
                {!L && <span className="acts" style={{ gap: 4 }}>
                  <button type="button" className="link" onClick={() => mv(i, i - 1)}>↑</button>
                  <button type="button" className="link" onClick={() => mv(i, i + 1)}>↓</button>
                  <button type="button" className="x" onClick={() => rmRow("items", i)}>×</button>
                </span>}
              </div>
            </div>
          ))}
        </section>

        <section><h3>ยอดเงิน</h3><div className="grid2">
          <label className="chk wide"><input type="checkbox" checked={d.vatIncl !== false} disabled={L} onChange={(e) => change((x) => ({ ...x, vatIncl: e.target.checked }), true)} /> ราคาต่อหน่วยรวมภาษีมูลค่าเพิ่มแล้ว (แยก VAT ออกจากยอดรวม)</label>
          {inp("wht", "หักภาษี ณ ที่จ่าย (%)", { numeric: true })}
          <label>ยอดรวมทั้งสิ้น<input value={fmt(t.total)} disabled /></label>
          {inp("words", "จำนวนเงินตัวอักษร (ว่าง = อัตโนมัติ)", { span: true, ph: bahtText(t.total) })}
        </div></section>

        {LT ? (
          <>
            <section><h3>ย่อหน้าหลังรายการสาย</h3>{inp("p2", "ย่อหน้าที่ 2", { area: 4 })}{inp("p3", "ย่อหน้าที่ 3", { area: 2 })}</section>
            <section><h3>ลงนาม</h3><div className="grid2">
              {inp("closing", "คำลงท้าย")}<span />{inp("signName", "ชื่อผู้ลงนาม")}{inp("signTitle", "ตำแหน่ง")}
              <label className="chk wide"><input type="checkbox" checked={d.noContact !== true} disabled={L} onChange={(e) => set("noContact", !e.target.checked)} /> แสดงผู้ประสานงาน (มุมล่างซ้าย)</label>
              {inp("contact", "ผู้ประสานงาน", { span: true, area: 2 })}
            </div></section>
          </>
        ) : (
          <>
            <section><h3>หมายเหตุ / เงื่อนไข {!L && <button type="button" className="link" onClick={() => addRow("notes")}>+ เพิ่ม</button>}</h3>
              {arr("notes").map((x, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div className="rowx" style={{ gridTemplateColumns: "1fr auto" }}>
                    <input placeholder="หัวข้อ" value={x.h} disabled={L} onChange={(e) => set(`notes.${i}.h`, e.target.value)} />
                    {!L && <button type="button" className="x" onClick={() => rmRow("notes", i)}>×</button>}
                  </div>
                  <textarea rows={2} value={x.t} disabled={L} onChange={(e) => set(`notes.${i}.t`, e.target.value)} style={{ width: "100%" }} />
                </div>
              ))}
            </section>
            <section><h3>ช่องลงนาม {!L && <button type="button" className="link" onClick={() => addRow("sign")}>+ เพิ่ม</button>}</h3>
              {arr("sign").map((x, i) => (
                <div key={i} className="rowx" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
                  <input placeholder="ตำแหน่ง" value={x.label} disabled={L} onChange={(e) => set(`sign.${i}.label`, e.target.value)} />
                  <input placeholder="ชื่อ (ว่าง = เส้นประ)" value={x.name} disabled={L} onChange={(e) => set(`sign.${i}.name`, e.target.value)} />
                  {!L && <button type="button" className="x" onClick={() => rmRow("sign", i)}>×</button>}
                </div>
              ))}
            </section>
          </>
        )}
        <p className="small muted" style={{ marginTop: 20 }}>Ctrl+Z ย้อน · Ctrl+Shift+Z ทำซ้ำ · ทุกการแก้บันทึกอัตโนมัติ</p>
      </div>

      <div className="prev">
        <div className="edbar">
          <span className="small">
            <span className={"st " + st[1]}>{st[0]}</span>{" "}
            <span className="muted">{saving === "saving" ? "กำลังบันทึก…" : saving === "saved" ? "บันทึกแล้ว" : canEdit && !L ? "บันทึกอัตโนมัติ" : ""}</span>
            {err && <span style={{ color: "var(--bad)" }}> · {err}</span>}
          </span>
          <span className="acts">
            {!L && <>
              <button type="button" className="btn sm" disabled={!hc.h} onClick={undo}>↶ ย้อน</button>
              <button type="button" className="btn sm" disabled={!hc.f} onClick={redo}>↷ ทำซ้ำ</button>
            </>}
            {canEdit && canIssue && d.status === "draft" && (
              <button type="button" className="btn sm" disabled={pending} onClick={() => {
                if (d.kind === "rc" && !window.confirm("ออกใบกำกับภาษีแล้วจะแก้ไขไม่ได้ ต้องยกเลิกแล้วทำใหม่เท่านั้น ยืนยันออกเอกสาร?")) return;
                act(() => setDocStatus(id, "issued"), () => { dRef.current = { ...dRef.current, status: "issued" }; setD(dRef.current); });
              }}>ออกเอกสาร</button>
            )}
            {canEdit && canIssue && d.status === "issued" && (
              <button type="button" className="btn sm bad" disabled={pending} onClick={() => {
                const r = window.prompt(`เหตุผลที่ยกเลิก ${d.no} (เอกสารยังอยู่ในระบบ พิมพ์ออกมามีตรายกเลิก เลขที่นี้จะไม่ถูกใช้ซ้ำ)`, "");
                if (r === null) return;
                if (!r.trim()) { setErr("ใส่เหตุผลก่อน"); return; }
                act(() => setDocStatus(id, "void", r), () => { dRef.current = { ...dRef.current, status: "void", voidReason: r }; setD(dRef.current); });
              }}>ยกเลิกเอกสาร</button>
            )}
            {canEdit && d.status !== "draft" && <button type="button" className="btn sm" disabled={pending} onClick={() => act(() => copyDoc(id))}>ทำฉบับใหม่จากใบนี้</button>}
            {canEdit && d.status === "draft" && <button type="button" className="btn sm bad" disabled={pending} onClick={() => window.confirm(`ลบฉบับร่าง ${d.no}?`) && act(() => deleteDoc(id))}>ลบร่าง</button>}
            <PdfButton className="btn sm dk" label="ดาวน์โหลด PDF" filename={fileSafe(`${d.title.replace(/\s*\/\s*/g, "-")}-${d.no}`) + ".pdf"}
              build={(h) => (both ? [...docPages(d, h, "ต้นฉบับ"), ...docPages(d, h, "สำเนา")] : docPages(d, h))} />
          </span>
        </div>
        <Preview deps={[JSON.stringify(d)]} build={(h) => docPages(d, h, both ? "ต้นฉบับ" : undefined)} />
      </div>
    </div>
  );
}
