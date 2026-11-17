"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDaily, saveCrew, saveDaily } from "@/app/(app)/daily/actions";
import { addDays, fmtKm, num } from "@/lib/calc";
import { WD, dL, dS, fileSafe, fmt, monthTitle, weekday } from "@/lib/print/fmt";
import { registerUrls, voucherPages, type CrewDay, type PackCompany } from "@/lib/print/pages";
import { PdfButton } from "@/components/print/PdfButton";

export type DayRec = { date: string; order_id: string; work: { r: string; km: string }[]; crew: CrewDay[]; fuel: number; other: number; note: string };
export type RouteOpt = {
  id: string; code: string; descr: string; order_id: string; round: number; hmd: string; area: number;
  ag: string; agName: string; len: number | null; kmDone: number; done: boolean;
};
type CrewM = { id: string; name: string; wage: number };

const norm = (s: string) => s.toLowerCase().replace(/[\s.\-–_/]/g, "");
const gkey = (r: RouteOpt) => (r.code.trim() ? r.ag + "|" + norm(r.code) : r.id);
/** สายเดียวกันมีหลายงวด: เลือกงวดล่าสุดที่ยังไม่เสร็จ ถ้าเสร็จหมดเอางวดล่าสุด */
const pick = (g: RouteOpt[]) => g.find((r) => !r.done) ?? g[0];

const cost = (d: Pick<DayRec, "crew" | "fuel" | "other">) => {
  let w = 0, n = 0;
  for (const c of d.crew || []) if (c.on) { w += num(c.wage) + num(c.ot); n++; }
  return { w, n, o: num(d.fuel) + num(d.other) };
};

export function DailyEditor({ day, month, week, today, recs, crew, routes, can, company, urls }: {
  day: string; month: string; week: string[]; today: string; recs: DayRec[]; crew: CrewM[]; routes: RouteOpt[];
  /** edit = บันทึกได้, wages = เห็น/แก้ค่าแรง (บัญชี), fuel = เห็น/กรอกน้ำมัน */
  can: { edit: boolean; wages: boolean; fuel: boolean }; company: PackCompany; urls: Record<string, string>;
}) {
  const ro = !can.edit;
  const byId = new Map(routes.map((r) => [r.id, r]));
  const groups = new Map<string, RouteOpt[]>();
  for (const r of routes) { const k = gkey(r); const l = groups.get(k) ?? []; l.push(r); groups.set(k, l); }
  for (const l of groups.values()) l.sort((a, b) => b.round - a.round);
  const [q, setQ] = useState("");
  const router = useRouter();
  const rec = recs.find((r) => r.date === day);
  const prevRec = [...recs].filter((r) => r.date < day && r.work.length).sort((a, b) => b.date.localeCompare(a.date))[0];
  const init = (): DayRec => {
    const base: DayRec = rec
      ? structuredClone(rec)
      : { date: day, order_id: "", work: [], crew: crew.map((c) => ({ id: c.id, name: c.name, wage: c.wage, ot: 0, on: false })), fuel: 0, other: 0, note: "" };
    for (const c of crew) if (!base.crew.some((x) => x.id === c.id)) base.crew.push({ id: c.id, name: c.name, wage: c.wage, ot: 0, on: false });
    return base;
  };
  const [D, setD] = useState<DayRec>(init);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [ml, setMl] = useState(() => crew.map((c) => ({ ...c, wage: String(c.wage) as string | number })));

  const upd = (fn: (x: DayRec) => DayRec) => { setD((x) => fn(structuredClone(x))); setDirty(true); setMsg(""); };
  const run = (fn: () => Promise<{ error?: string }>, ok: string) =>
    start(async () => {
      setErr("");
      const r = await fn();
      if (r.error) { setErr(r.error); return; }
      setMsg(ok);
      setDirty(false);
      router.refresh();
    });

  // ปฏิทิน
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lead = (weekday(first) + 6) % 7;
  const nd = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prevM = addDays(first, -1).slice(0, 7), nextM = addDays(first, 32).slice(0, 7);
  let mw = 0, mn = 0, mo = 0;
  const cells = [...Array(nd)].map((_, i) => {
    const ds = `${month}-${String(i + 1).padStart(2, "0")}`;
    const r = recs.find((x) => x.date === ds);
    const c = r ? cost(r) : null;
    if (c) { mw += c.w; mn += c.n; mo += c.o; }
    return { ds, i: i + 1, r, c, sun: weekday(ds) === 0 };
  });
  const go = (ds: string, mm = month) => {
    if (dirty && !window.confirm("มีการแก้ที่ยังไม่บันทึก ทิ้งการแก้แล้วไปวันอื่น?")) return;
    router.push(`/daily?d=${ds}&m=${mm}`);
  };

  // สัปดาห์
  const wkRecs = week.map((d) => recs.find((r) => r.date === d)).filter(Boolean) as DayRec[];
  const per: Record<string, { name: string; d: number; amt: number }> = {};
  for (const r of wkRecs) for (const c of r.crew || []) if (c.on) { const p = (per[c.id || c.name] ??= { name: c.name, d: 0, amt: 0 }); p.d++; p.amt += num(c.wage) + num(c.ot); }
  const wkTot = Object.values(per).reduce((s, p) => s + p.amt, 0);
  const jobs = [...new Set(wkRecs.flatMap((r) => r.work.map((w) => byId.get(w.r)).filter(Boolean).map((x) => `${x!.agName ? x!.agName + " " : ""}งวดที่ ${x!.round} หมวด${x!.hmd}`)))].join(", ");

  const qn = norm(q.trim());
  const hits = qn
    ? [...groups.values()].filter((g) => norm(g[0].code).includes(qn) || norm(g[0].descr).includes(qn)).slice(0, 12)
    : [];
  const inDay = new Set(D.work.map((w) => w.r));
  const addGroup = (g: RouteOpt[]) => {
    setQ("");
    if (g.some((r) => inDay.has(r.id))) return;
    upd((x) => ({ ...x, work: [...x.work, { r: pick(g).id, km: "" }] }));
  };
  const dayKm = D.work.reduce((s, w) => s + num(w.km), 0);
  const dc = cost(D);

  return (
    <div className="dgrid">
      <div className="pad dcal">
        <div className="eyebrow">Daily log</div>
        <div className="hd" style={{ marginBottom: 6 }}>
          <h2 style={{ fontSize: 24 }}>{monthTitle(month)}</h2>
          <span className="acts">
            <Link className="btn sm" href={`/daily?d=${day}&m=${prevM}`}>‹</Link>
            <Link className="btn sm" href={`/daily?d=${day}&m=${nextM}`}>›</Link>
          </span>
        </div>
        <div className="cal">
          {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((x) => <div key={x} className="h">{x}</div>)}
          {[...Array(lead)].map((_, i) => <div key={"x" + i} className="c x" />)}
          {cells.map(({ ds, i, r, c, sun }) => (
            <button type="button" key={ds} onClick={() => go(ds)} className={"c" + (c && c.n ? " w" : "") + (ds === day ? " sel" : "") + (sun && !c ? " sun" : "") + (ds === today ? " today" : "")}>
              <b>{i}</b>
              {c && c.n ? <><small>{c.n} คน</small><small className="muted">{r!.work.length} สาย</small></> : null}
            </button>
          ))}
        </div>
        {can.wages ? <div className="mrow"><span className="muted">ค่าแรงทั้งเดือน ({mn} คน-วัน)</span><span className="num">{fmt(mw)}</span></div>
          : <div className="mrow"><span className="muted">ทั้งเดือน</span><span className="num">{mn} คน-วัน</span></div>}
        {can.fuel && <div className="mrow"><span className="muted">น้ำมัน / อื่น ๆ</span><span className="num">{fmt(mo)}</span></div>}
        {day !== today && <p className="small"><button type="button" className="link" onClick={() => go(today, today.slice(0, 7))}>ไปวันนี้</button></p>}
      </div>

      <div className="pad">
        <div className="hd">
          <div>
            <div className="eyebrow">{WD[weekday(day)]} · {dL(day)}</div>
            <h2 style={{ fontSize: 24 }}>บันทึกประจำวัน</h2>
          </div>
          <span className="acts">
            {rec && can.wages && <button type="button" className="btn sm bad" disabled={pending} onClick={() => window.confirm(`ลบบันทึกวันที่ ${dS(day)}?`) && run(() => deleteDaily(day), "ลบแล้ว")}>ลบวันนี้</button>}
            {can.edit && <button type="button" className="btn dk" disabled={pending} onClick={() => run(() => saveDaily(D), `บันทึก ${dS(day)} แล้ว`)}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>}
          </span>
        </div>
        {msg && <p className="alert ok">{msg}</p>}
        {err && <p className="alert bad">{err}</p>}
        {ro && <p className="alert">ดูได้อย่างเดียว บันทึกรายวันได้เฉพาะหัวหน้าชุด ฝ่ายบัญชี หรือเจ้าของ</p>}
        {dirty && <p className="small" style={{ color: "var(--warn)", marginTop: -8 }}>ยังไม่ได้บันทึก</p>}
        <section className="dsec">
          <h3>สายทางที่ทำวันนี้ {D.work.length > 0 && <span className="small muted">{D.work.length} สาย{dayKm ? ` · ${fmtKm(dayKm)} กม.` : ""}</span>}</h3>
          {!ro && <div className="rsearch">
            <input value={q} placeholder="พิมพ์เลขสายทาง เช่น 3083 หรือชื่อสาย" onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); addGroup(hits[0]); } if (e.key === "Escape") setQ(""); }} />
            {qn && (
              <div className="rhits">
                {hits.map((g) => {
                  const r = pick(g), on = g.some((x) => inDay.has(x.id));
                  return (
                    <button type="button" key={gkey(r)} className={on ? "on" : ""} onClick={() => addGroup(g)}>
                      <b>{r.code || "(ไม่มีรหัส)"}</b> <span>{r.descr}</span>
                      <small>{r.agName ? r.agName + " · " : ""}หมวด{r.hmd} · งวดที่ {r.round}{g.length > 1 ? ` (มี ${g.length} งวด)` : ""}{on ? " · เลือกแล้ว" : ""}</small>
                    </button>
                  );
                })}
                {!hits.length && <div className="muted small" style={{ padding: "8px 12px" }}>ไม่พบสายทาง “{q}” ในใบสั่งจ้าง</div>}
              </div>
            )}
          </div>}
          {D.work.length > 0 && (
            <table className="tbl rt wk2">
              <thead><tr><th>สายทาง</th><th style={{ width: 150 }}>งวด / หมวด</th><th className="n" style={{ width: 100 }}>ตัดวันนี้ (กม.)</th><th className="n" style={{ width: 120 }}>สะสม</th><th style={{ width: 30 }} /></tr></thead>
              <tbody>
                {D.work.map((w, i) => {
                  const r = byId.get(w.r);
                  if (!r) return <tr key={w.r}><td colSpan={4} className="muted small">สายนี้ถูกลบจากใบสั่งจ้างแล้ว</td><td><button type="button" className="x" onClick={() => upd((x) => ({ ...x, work: x.work.filter((_, j) => j !== i) }))}>×</button></td></tr>;
                  const g = groups.get(gkey(r)) ?? [r];
                  const sum = r.kmDone + num(w.km);
                  const over = r.len != null && r.len > 0 && sum > r.len + 1e-9;
                  return (
                    <tr key={w.r}>
                      <td><b>{r.code}</b> <span className="small muted">{r.descr}</span></td>
                      <td>
                        {g.length > 1 ? (
                          <select value={r.id} disabled={ro} onChange={(e) => upd((x) => { x.work[i].r = e.target.value; return x; })}>
                            {g.map((o) => <option key={o.id} value={o.id} disabled={o.id !== r.id && inDay.has(o.id)}>งวดที่ {o.round}{o.done ? " (เสร็จแล้ว)" : ""}</option>)}
                          </select>
                        ) : <span className="small">งวดที่ {r.round}</span>}
                        <div className="small muted">{r.agName ? r.agName + " · " : ""}หมวด{r.hmd}</div>
                      </td>
                      <td><input className="n" inputMode="decimal" placeholder="–" disabled={ro} value={w.km} onChange={(e) => upd((x) => { x.work[i].km = e.target.value; return x; })} /></td>
                      <td className="n small" style={over ? { color: "var(--bad, #a33)" } : undefined}>
                        {fmtKm(sum)}{r.len ? ` / ${fmtKm(r.len)}` : ""} กม.{over ? " เกินความยาวสาย" : ""}
                      </td>
                      <td>{!ro && <button type="button" className="x" onClick={() => upd((x) => ({ ...x, work: x.work.filter((_, j) => j !== i) }))}>×</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!D.work.length && dc.n > 0 && <p className="small" style={{ color: "var(--warn)", marginTop: 6 }}>ยังไม่ได้เลือกสายทาง ค่าแรงและค่าน้ำมันของวันนี้จะไม่ถูกนับเป็นต้นทุนของหมวดใด</p>}
          <p className="small muted" style={{ marginTop: 6 }}>
            {!ro && !D.work.length && prevRec && <><button type="button" className="link" onClick={() => upd((x) => ({ ...x, work: prevRec.work.filter((w) => byId.has(w.r)).map((w) => ({ r: w.r, km: "" })) }))}>ใช้สายเดียวกับวันที่ {dS(prevRec.date)}</button> · </>}
            กม. ใช้ดูความคืบหน้า ไม่เกี่ยวกับ ตร.ม. ที่คิดเงิน · ความยาวสายกรอกที่หน้าสายทาง
          </p>
        </section>
        <label className="dnote">หมายเหตุ<input value={D.note} disabled={ro} onChange={(e) => upd((x) => ({ ...x, note: e.target.value }))} /></label>
        <section className="dsec">
          <h3>ลูกจ้างรายวัน <span className="small muted">{dc.n} คน{can.wages ? ` · ${fmt(dc.w)} บาท` : ""}</span></h3>
          <table className="tbl rt">
            <thead><tr><th style={{ width: 44 }}>มา</th><th>ชื่อ</th>{can.wages && <><th className="n" style={{ width: 120 }}>ค่าแรง</th><th className="n" style={{ width: 120 }}>OT / เบี้ยเลี้ยง</th></>}</tr></thead>
            <tbody>
              {D.crew.map((c, i) => (
                <tr key={c.id || i}>
                  <td className="c"><input type="checkbox" checked={c.on} disabled={ro} onChange={(e) => upd((x) => { x.crew[i].on = e.target.checked; return x; })} /></td>
                  <td><input value={c.name} disabled={ro} onChange={(e) => upd((x) => { x.crew[i].name = e.target.value; return x; })} /></td>
                  {can.wages && <>
                    <td><input className="n" inputMode="decimal" value={c.wage} onChange={(e) => upd((x) => { x.crew[i].wage = e.target.value as unknown as number; return x; })} /></td>
                    <td><input className="n" inputMode="decimal" value={c.ot || ""} onChange={(e) => upd((x) => { x.crew[i].ot = e.target.value as unknown as number; return x; })} /></td>
                  </>}
                </tr>
              ))}
              {!D.crew.length && <tr><td colSpan={can.wages ? 4 : 2} className="muted small">ยังไม่มีรายชื่อ เพิ่มคนเฉพาะวันนี้ หรือเพิ่มรายชื่อประจำชุดด้านขวา</td></tr>}
            </tbody>
          </table>
          {!ro && <p className="small">
            <button type="button" className="link" onClick={() => upd((x) => ({ ...x, crew: [...x.crew, { id: "t" + Date.now().toString(36), name: "", wage: crew[0]?.wage ?? 400, ot: 0, on: true }] }))}>+ เพิ่มคนเฉพาะวันนี้</button>
            {" · "}
            <button type="button" className="link" onClick={() => upd((x) => ({ ...x, crew: x.crew.map((c) => ({ ...c, on: true })) }))}>ติ๊กมาทุกคน</button>
            {!can.wages && <span className="muted"> · ค่าแรงฝ่ายบัญชีเป็นคนใส่ คนใหม่ใช้ค่าแรงตั้งต้นไปก่อน</span>}
          </p>}
        </section>
        {can.fuel && <section className="dsec">
          <h3>ค่าใช้จ่ายอื่น</h3>
          <div className="grid2">
            <label>ค่าน้ำมัน (บาท)<input inputMode="decimal" value={D.fuel || ""} onChange={(e) => upd((x) => ({ ...x, fuel: e.target.value as unknown as number }))} /></label>
            <label>อื่น ๆ (บาท)<input inputMode="decimal" value={D.other || ""} onChange={(e) => upd((x) => ({ ...x, other: e.target.value as unknown as number }))} /></label>
          </div>
        </section>}
      </div>

      <aside className="dright">
        <div className="eyebrow">This week</div>
        <h3 className="serif">{dS(week[0])} – {dS(week[6])}</h3>
        <div className="wk">
          {Object.values(per).map((p) => <div key={p.name}><span>{p.name} · {p.d} วัน</span>{can.wages && <span className="num">{fmt(p.amt)}</span>}</div>)}
          {!Object.keys(per).length && <div><span className="muted">ยังไม่มีบันทึกสัปดาห์นี้</span></div>}
        </div>
        {can.wages && <>
        <div className="wtot"><span className="muted small">ค่าแรงรวมสัปดาห์</span><span className="num">{fmt(wkTot)}</span></div>
        {wkRecs.length > 0 && (
          <PdfButton className="btn dk" label="ใบสำคัญจ่ายค่าแรง (PDF)" filename={fileSafe(`ใบสำคัญจ่ายค่าแรง-${week[0]}-ถึง-${week[6]}`) + ".pdf"}
            build={(h) => { registerUrls(urls); return voucherPages(company, week, wkRecs, jobs, h); }} />
        )}

        <div className="eyebrow" style={{ marginTop: 26 }}>Crew</div>
        <h3 className="serif">รายชื่อลูกจ้างประจำชุด</h3>
        {ml.map((c, i) => (
          <div key={c.id || i} className="rowx" style={{ gridTemplateColumns: "1fr 76px auto" }}>
            <input value={c.name} placeholder="ชื่อ" onChange={(e) => setMl((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="n" value={c.wage} onChange={(e) => setMl((l) => l.map((x, j) => (j === i ? { ...x, wage: e.target.value } : x)))} />
            <button type="button" className="x" onClick={() => setMl((l) => l.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div className="acts" style={{ marginTop: 6 }}>
          <button type="button" className="btn sm" onClick={() => setMl((l) => [...l, { id: "", name: "", wage: "400" }])}>+ เพิ่ม</button>
          <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => saveCrew(ml), "บันทึกรายชื่อลูกจ้างแล้ว")}>บันทึกรายชื่อ</button>
        </div>
        <p className="small muted">ค่าแรงในรายชื่อเป็นค่าตั้งต้นของวันใหม่ แก้รายวันได้ในตารางกลาง</p>
        </>}
      </aside>
    </div>
  );
}
