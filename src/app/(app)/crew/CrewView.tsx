"use client";

// คนงานและค่าแรง (แบบเดียวกับระบบบน claude.ai): จ่ายค่าแรง · ทะเบียนคนงาน · เบิกล่วงหน้า · น้ำมัน
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Chip, Stat, Top, toast } from "@/components/ui";
import { FuelDialog } from "@/components/FuelDialog";
import { PdfButton } from "@/components/print/PdfButton";
import { crewPages, registerUrls, voucherEach, voucherPages, type PackCompany, type VoucherRow } from "@/lib/print/pages";
import { fileSafe, monthTitle } from "@/lib/print/fmt";
import { downloadBlob, xlsxBlob } from "@/lib/xlsx";
import { type LogLite, type PayLite, type WeekRow, advLeft, fuelCycles, weekPay } from "@/lib/crewpay";
import { type Advance, type Car, type CrewRec, type Fuel, PAYBY, WD, addDaysIso, dS, dShort, fmt0, fmtKm, fmtN, noSunday, num, payDateOf, payText, unitOf, wdOf, weekOf } from "@/lib/model";
import { deleteAdvance, saveAdvance } from "../daily/actions";
import { newCrew, payCrew, saveCars, unpayCrew, updateCrew, type CrewPatch } from "./actions";

export type CrewTab = "pay" | "crew" | "adv" | "fuel";
type Can = { wages: boolean; daily: boolean; fuel: boolean; cars: boolean };
type Props = {
  tab: CrewTab; tabs: CrewTab[]; day: string; today: string; crew: CrewRec[]; logs: LogLite[]; adv: Advance[]; pays: PayLite[];
  fuel: Fuel[]; cars: Car[]; jobs: string; head: PackCompany; logo: Record<string, string>; can: Can;
};

const TABN: Record<CrewTab, string> = { pay: "จ่ายค่าแรง", crew: "ทะเบียนคนงาน", adv: "เบิกล่วงหน้า", fuel: "น้ำมัน" };
const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const crumb = <>หน้างาน › <b>คนงานและค่าแรง</b></>;

function Tabs({ tabs, tab, day }: { tabs: CrewTab[]; tab: CrewTab; day: string }) {
  return <div className="tabs">{tabs.map((t) => <Link key={t} href={`/crew?tab=${t}&d=${day}`} className={t === tab ? "on" : ""}>{TABN[t]}</Link>)}</div>;
}
function Armed({ label, armedLabel, onGo, className = "lnk bad small" }: { label: string; armedLabel: string; onGo: () => Promise<void> | void; className?: string }) {
  const [armed, setArmed] = useState(false);
  return <button type="button" className={className} onClick={async () => { if (!armed) { setArmed(true); return; } await onGo(); setArmed(false); }}>{armed ? armedLabel : label}</button>;
}

export function CrewView(p: Props) {
  return (
    <div className="ax"><div className="pg">
      {p.tab === "pay" ? <PayTab {...p} /> : p.tab === "crew" ? <RegTab {...p} /> : p.tab === "adv" ? <AdvTab {...p} /> : <FuelTab {...p} />}
    </div></div>
  );
}

// ---------------- เบิกล่วงหน้า (ฟอร์ม) ----------------
function AdvBox({ crew, date, onClose }: { crew: CrewRec[]; date: string; onClose?: () => void }) {
  const act = crew.filter((c) => c.active);
  const [who, setWho] = useState(act[0]?.id ?? "");
  const [d, setD] = useState(date);
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!who) { toast("เพิ่มคนงานในทะเบียนก่อน", true); return; }
    setBusy(true);
    const r = await saveAdvance({ crew_id: who, date: d, amt, note });
    setBusy(false);
    if (r.error) { toast(r.error, true); return; }
    toast(`บันทึกเบิก ${crew.find((c) => c.id === who)?.name ?? ""} ${fmt(num(amt))} บาทแล้ว`);
    setAmt(""); setNote("");
    onClose?.();
  };
  return (
    <div className="advf">
      <div className="grid2">
        <label className="f" style={{ gridColumn: "span 2" }}>คนงาน<select className="in" value={who} onChange={(e) => setWho(e.target.value)}>{act.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="f">วันที่เบิก<input className="in" type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label className="f">จำนวนเงิน (บาท)<input className="in" value={amt} placeholder="0" style={{ textAlign: "right" }} inputMode="decimal" onChange={(e) => setAmt(e.target.value)} /></label>
        <label className="f" style={{ gridColumn: "span 2" }}>หมายเหตุ<input className="in" value={note} placeholder="ถ้ามี" onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="acts" style={{ marginTop: 10 }}>
        <button className="btn sm pr" type="button" disabled={busy} onClick={save}>บันทึกเบิก</button>
        {onClose ? <button className="btn sm" type="button" onClick={onClose}>ปิด</button> : null}
      </div>
    </div>
  );
}
const delAdv = async (id: string) => { const r = await deleteAdvance(id); if (r.error) toast(r.error, true); else toast("ลบรายการเบิกแล้ว"); };

// ---------------- จ่ายค่าแรง ----------------
function PayTab({ tabs, day, today, crew, logs, adv, pays, jobs, head, logo }: Props) {
  const wk = weekOf(day), wk0 = wk[0];
  const P = useMemo(() => weekPay(wk, logs, adv, pays, crew), [wk0, logs, adv, pays, crew]); // eslint-disable-line react-hooks/exhaustive-deps
  const showSun = P.some((p) => p.days[wk[1]]), days = showSun ? wk : noSunday(wk);
  const tot = (f: (p: WeekRow) => number) => P.reduce((s, p) => s + f(p), 0);
  const crewOf = (id: string) => crew.find((c) => c.id === id);
  const methodOf = (p: WeekRow) => p.paid?.method ?? crewOf(p.cid)?.pay_by ?? "cash";
  const paidN = P.filter((p) => p.paid).length, paidAmt = P.filter((p) => p.paid).reduce((s, p) => s + p.net, 0);
  const cashAmt = P.filter((p) => methodOf(p) === "cash").reduce((s, p) => s + p.net, 0);
  const advs = adv.filter((a) => a.adv_date >= wk0 && a.adv_date <= wk[6]).sort((a, b) => a.adv_date.localeCompare(b.adv_date));
  const fri = wk[6], sat = payDateOf(wk0);
  // วันที่จ่ายตั้งต้น: จ่ายก่อนกำหนดใช้วันนี้ นอกนั้นใช้วันเสาร์วันจ่าย · วันที่เบิกตั้งต้นต้องอยู่ในรอบ
  const payDay = today >= wk0 && today <= sat ? today : sat, advDay = today >= wk0 && today <= fri ? today : fri;
  const [ed, setEd] = useState<string | null>(null);
  const [m, setM] = useState("cash");
  const [pd, setPd] = useState(payDay);
  const [busy, setBusy] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const toIn = (p: WeekRow, method: string) => ({ crew_id: p.cid, name: p.name, method, days: p.units, gross: p.gross, ot: p.ot, ded: p.ded, net: p.net });
  const open = (p: WeekRow) => { setEd(p.cid); setM(methodOf(p)); setPd(payDay); };
  const payOne = async () => {
    const p = P.find((x) => x.cid === ed); if (!p) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pd)) { toast("ใส่วันที่จ่าย", true); return; }
    setBusy(true); const r = await payCrew(wk0, pd, [toIn(p, m)]); setBusy(false);
    if (r.error) { toast(r.error, true); return; }
    setEd(null); toast(`บันทึกจ่าย ${p.name} ${fmt(p.net)} บาทแล้ว`);
  };
  const left = P.filter((p) => !p.paid && (p.units || p.ot));
  const payAll = async () => {
    setBusy(true); const r = await payCrew(wk0, payDay, left.map((p) => toIn(p, crewOf(p.cid)?.pay_by ?? "cash"))); setBusy(false);
    if (r.error) toast(r.error, true); else toast(`บันทึกจ่าย ${left.length} คนแล้ว`);
  };
  const vrows: VoucherRow[] = P.map((p) => { const R = crewOf(p.cid); return { ...p, nick: R?.nick, payText: payText(R), paid: p.paid ? { pay_date: p.paid.pay_date, method: p.paid.method } : null }; });
  const go = (k: number) => `/crew?tab=pay&d=${addDaysIso(wk0, k * 7 + 6)}`;
  return <>
    <Top crumb={crumb} title={`จ่ายค่าแรง ${dShort(wk0)} – ${dS(fri)}`} sub={`รอบ ส.–ศ. · ตัดรอบวันศุกร์ · จ่ายวันเสาร์ ${dS(sat)}`}
      acts={<><Tabs tabs={tabs} tab="pay" day={day} /><Link className="btn" href={go(-1)}>‹ สัปดาห์ก่อน</Link><Link className="btn" href={go(1)}>สัปดาห์ถัดไป ›</Link></>} />
    <div className="body">
      <div className="stats">
        <Stat l="ยอดจ่ายรอบนี้" v={fmt0(tot((p) => p.net))} u="บาท" s={`${P.length} คน · ${fmtN(tot((p) => p.units))} คน-วัน`} />
        <Stat l="จ่ายแล้ว" v={fmt0(paidAmt)} u="บาท" s={`${paidN} / ${P.length} คน`} p={P.length ? pct(paidN, P.length) : undefined} />
        <Stat l="ยังไม่จ่าย" v={fmt0(tot((p) => p.net) - paidAmt)} u="บาท" s={tot((p) => p.ded) ? `หักเบิกแล้ว ${fmt0(tot((p) => p.ded))} บาท` : " "} />
        <Stat l="เงินสด / โอน" v={`${fmt0(cashAmt)} / ${fmt0(tot((p) => p.net) - cashAmt)}`} u="บาท" s="เตรียมเงินสดตามยอดนี้" />
      </div>
      <div className="card">
        <div className="ch"><h3>ค่าแรงรายคน</h3>
          <div className="acts">
            {P.length ? <>
              <PdfButton className="btn sm" label="ใบสำคัญจ่าย PDF (รวม)" filename={fileSafe(`ใบสำคัญจ่ายค่าแรง-${wk0}-ถึง-${fri}.pdf`)} build={(h) => { registerUrls(logo); return voucherPages(head, wk, vrows, jobs, h); }} />
              <PdfButton className="btn sm" label="PDF แยกรายคน" filename={fileSafe(`ใบสำคัญจ่ายรายคน-${wk0}-ถึง-${fri}.pdf`)} build={(h) => { registerUrls(logo); return voucherEach(head, wk, vrows, h); }} />
            </> : <><button className="btn sm" type="button" disabled>ใบสำคัญจ่าย PDF (รวม)</button><button className="btn sm" type="button" disabled>PDF แยกรายคน</button></>}
          </div>
        </div>
        {P.length ? <>
          <div className="tscroll"><table className="tb paytab"><tbody>
            <tr><th>คนงาน</th>{days.map((d) => <th key={d} className="c">{WD[wdOf(d)]} {+d.slice(8)}</th>)}<th className="n">วัน</th><th className="n">ค่าแรง</th><th className="n">OT/เบี้ย</th><th className="n">หักเบิก</th><th className="n">สุทธิ</th><th>จ่ายทาง</th><th></th></tr>
            {P.map((p) => { const R = crewOf(p.cid); return [
              <tr key={p.cid} className={p.paid ? "paid" : ""}>
                <td><b>{p.name}</b>{R && !R.active ? <span className="small muted"> (พักงาน)</span> : null}</td>
                {days.map((d) => { const c = p.days[d]; return <td key={d} className={"c " + (!c ? "d0" : c.half ? "dh" : "d1")}>{!c ? "–" : c.half ? "½" : "✓"}</td>; })}
                <td className="n num">{fmtN(p.units)}</td><td className="n num">{fmt(p.gross)}</td><td className="n num">{p.ot ? fmt(p.ot) : "–"}</td>
                <td className="n num" title={p.carry ? "ยอดยกมา " + fmt(p.carry) : ""}>{p.ded ? "−" + fmt(p.ded) : "–"}{p.left > 0 ? <div className="small" style={{ color: "var(--warn)" }}>ค้าง {fmt(p.left)}</div> : null}</td>
                <td className="n num"><b>{fmt(p.net)}</b></td>
                <td className="small muted">{p.paid ? PAYBY[p.paid.method ?? "cash"] : payText(R)}</td>
                <td>{p.paid ? <><Chip c="g">จ่ายแล้ว {dShort(p.paid.pay_date)}</Chip><div><Armed label="ยกเลิกการจ่าย" armedLabel="กดอีกครั้งเพื่อยกเลิกการจ่าย" onGo={async () => { const r = await unpayCrew(wk0, p.cid); if (r.error) toast(r.error, true); else toast("ยกเลิกการจ่ายแล้ว วันของคนนี้แก้ได้อีกครั้ง"); }} /></div></>
                  : ed === p.cid ? <button type="button" className="lnk" onClick={() => setEd(null)}>ปิด</button>
                  : <button type="button" className="btn sm pr" disabled={!(p.units || p.ot)} onClick={() => open(p)}>จ่าย</button>}</td>
              </tr>,
              ed === p.cid && !p.paid ? (
                <tr key={p.cid + "-ed"} className="payrow"><td colSpan={days.length + 8}>
                  <span className="payed"><span className="small muted">จ่าย {p.name}</span> ทาง
                    <select className="in" value={m} onChange={(e) => setM(e.target.value)}>{Object.entries(PAYBY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> วันที่
                    <input className="in" type="date" value={pd} onChange={(e) => setPd(e.target.value)} />
                    <button type="button" className="btn sm pr" disabled={busy} onClick={payOne}>ยืนยันจ่าย {fmt(p.net)} บาท</button>
                  </span>
                </td></tr>
              ) : null,
            ]; })}
            <tr className="tt"><td>รวม {P.length} คน</td>{days.map((d) => <td key={d} className="c">{fmtN(P.reduce((s, p) => s + unitOf(p.days[d]), 0)) || "–"}</td>)}<td className="n num">{fmtN(tot((p) => p.units))}</td><td className="n num">{fmt(tot((p) => p.gross))}</td><td className="n num">{fmt(tot((p) => p.ot))}</td><td className="n num">{tot((p) => p.ded) ? "−" + fmt(tot((p) => p.ded)) : "–"}</td><td className="n num">{fmt(tot((p) => p.net))}</td><td /><td className="small muted">จ่ายแล้ว {paidN}/{P.length}</td></tr>
          </tbody></table></div>
          <div className="cf"><span className="small muted">กดจ่ายแล้ววันของคนนั้นในสัปดาห์นี้จะล็อก จนกว่าจะยกเลิกการจ่าย · หักเบิกให้อัตโนมัติ ยอดเกินยกไปสัปดาห์หน้า</span>
            {left.length ? <Armed className="btn sm pr" label={`✓ จ่ายทุกคนที่เหลือ (${dShort(payDay)})`} armedLabel={`กดอีกครั้งเพื่อยืนยันจ่าย ${left.length} คน รวม ${fmt(left.reduce((s, p) => s + p.net, 0))} บาท`} onGo={payAll} /> : null}
          </div>
        </> : <div className="emp big"><h3>ยังไม่มีบันทึกคนงานในสัปดาห์นี้</h3><p>บันทึกคนมาทำงานที่เมนูบันทึกรายวัน แล้วสรุปจะขึ้นที่นี่</p></div>}
      </div>
      <div className="row2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="ch"><h3>เบิกล่วงหน้าสัปดาห์นี้ <span className="m">{advs.length} รายการ</span></h3><button className="btn sm" type="button" onClick={() => setAdvOpen((v) => !v)}>+ บันทึกเบิก</button></div>
          {advOpen ? <div className="cb" style={{ paddingBottom: 0 }}><AdvBox crew={crew} date={advDay} onClose={() => setAdvOpen(false)} /></div> : null}
          {advs.length ? <div className="tscroll"><table className="tb"><tbody><tr><th>วันที่</th><th>คนงาน</th><th>หมายเหตุ</th><th className="n">จำนวน</th><th /></tr>
            {advs.map((a) => <tr key={a.id}><td className="small">{WD[wdOf(a.adv_date)]}. {dShort(a.adv_date)}</td><td><b>{crewOf(a.crew_id)?.name ?? "?"}</b></td><td className="small muted">{a.note}</td><td className="n num">{fmt(a.amt)}</td><td className="n"><Armed label="ลบ" armedLabel="กดอีกครั้ง" onGo={() => delAdv(a.id)} /></td></tr>)}
          </tbody></table></div> : <div className="emp">ไม่มีการเบิกสัปดาห์นี้</div>}
          {P.some((p) => p.carry) ? <div className="cf"><span>ยอดค้างยกมาจากสัปดาห์ก่อน</span><b className="num">{fmt(tot((p) => p.carry))}</b></div> : null}
        </div>
        <div className="card"><div className="ch"><h3>วิธีจ่าย</h3></div>
          <div className="cb small muted" style={{ lineHeight: 1.8 }}>1. ตรวจวันทำงานของแต่ละคนในตาราง<br />2. กด &quot;จ่าย&quot; รายคน หรือ &quot;จ่ายทุกคนที่เหลือ&quot;<br />3. พิมพ์ใบสำคัญจ่ายให้คนงานเซ็นรับเงิน<br />ถ้าจ่ายผิด กด &quot;ยกเลิกการจ่าย&quot; แล้วแก้บันทึกรายวันได้</div>
        </div>
      </div>
    </div>
  </>;
}

// ---------------- ทะเบียนคนงาน ----------------
const CREW_HD = ["ที่", "ชื่อ-สกุล", "ชื่อเล่น", "ตำแหน่ง", "โทร", "ค่าแรง/วัน", "รับเงินทาง", "พร้อมเพย์ / เลขบัญชี", "เริ่มงาน", "สถานะ", "หมายเหตุ"];
function RegTab({ tabs, day, today, crew, logs, adv, pays, head, can }: Props) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Partial<CrewRec>>>({});
  const L = crew.map((c) => ({ ...c, ...edits[c.id] }));
  const [sel, setSel] = useState<string | null>(L[0]?.id ?? null);
  const C = L.find((c) => c.id === sel) ?? null;
  const [st, setSt] = useState("✓ บันทึกอัตโนมัติ");
  const pend = useRef<{ id: string; p: CrewPatch } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const x = pend.current; pend.current = null;
    if (!x) return;
    setSt("กำลังบันทึก…");
    const r = await updateCrew(x.id, x.p);
    if (r.error) { setSt("บันทึกไม่สำเร็จ"); toast(r.error, true); } else setSt("✓ บันทึกอัตโนมัติ");
  };
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); const x = pend.current; if (x) updateCrew(x.id, x.p); } }, []);
  const set = (k: keyof CrewPatch, v: string | boolean, now = false) => {
    if (!C || !can.wages) return;
    const id = C.id;
    if (pend.current && pend.current.id !== id) flush();
    setEdits((e) => ({ ...e, [id]: { ...e[id], [k]: k === "wage" ? num(v) : v } }));
    pend.current = { id, p: { ...(pend.current?.id === id ? pend.current.p : {}), [k]: v } };
    setSt("กำลังบันทึก…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, now ? 0 : 700);
  };
  const pick = async (id: string) => { await flush(); setSel(id); };
  const add = async () => {
    await flush();
    const r = await newCrew();
    if (r.error || !r.id) { toast(r.error || "เพิ่มไม่สำเร็จ", true); return; }
    setSel(r.id); router.refresh();
    setTimeout(() => { const n = document.querySelector<HTMLInputElement>('.cform input[data-k="name"]'); n?.focus(); n?.select(); }, 400);
  };
  const daysOf = (cid: string) => logs.reduce((s, d) => s + d.crew.filter((c) => c.id === cid).reduce((t, c) => t + unitOf(c), 0), 0);
  const lastPay = (cid: string) => pays.filter((x) => x.crew_id === cid).map((x) => x.pay_date).sort().pop();
  const left = (cid: string) => advLeft(cid, adv, pays);
  const act = L.filter((c) => c.active), advAll = L.reduce((s, c) => s + Math.max(0, left(c.id)), 0);
  const wageSum = act.reduce((s, c) => s + num(c.wage), 0);
  const xls = () => {
    const rows = L.map((c, i) => [i + 1, c.name, c.nick, c.role, c.phone, num(c.wage), PAYBY[c.pay_by ?? "cash"], c.pay_by === "cash" ? "" : c.pay_no ?? "", c.start_date ? dS(c.start_date) : "", c.active ? "ทำงาน" : "พักงาน", c.note]);
    downloadBlob(xlsxBlob("ทะเบียนคนงาน", [["ทะเบียนคนงาน " + head.name], ["ข้อมูล ณ วันที่ " + dS(today)], [], CREW_HD, ...rows], [5, 26, 10, 14, 14, 10, 12, 22, 14, 9, 30]), fileSafe(`ทะเบียนคนงาน-${today}.xlsx`));
  };
  return <>
    <Top crumb={crumb} title="ทะเบียนคนงาน"
      sub={can.wages ? "แก้ค่าแรงมีผลกับวันใหม่เท่านั้น · พักงานแล้วไม่ขึ้นในบันทึกวันใหม่ แต่ประวัติยังอยู่ครบ" : "ค่าแรงและเลขบัญชีดูได้เฉพาะฝ่ายบัญชี · เพิ่มคนงานใหม่ได้จากหน้าบันทึกรายวัน"}
      acts={<><Tabs tabs={tabs} tab="crew" day={day} />
        {can.wages && L.length ? <>
          <PdfButton className="btn" label="PDF" filename={fileSafe(`ทะเบียนคนงาน-${today}.pdf`)} build={(h) => crewPages(head, L.map((c) => ({ name: c.name, nick: c.nick, role: c.role, phone: c.phone, wage: c.wage, payText: payText(c), active: c.active })), today, h)} />
          <button className="btn" type="button" onClick={xls}>Excel</button>
        </> : null}
        {can.wages ? <button className="btn pr" type="button" onClick={add}>+ เพิ่มคนงาน</button> : null}
      </>} />
    <div className="body">
      <div className="stats">
        <Stat l="ทำงานอยู่" v={act.length} u="คน" s={L.length - act.length ? `พักงาน ${L.length - act.length} คน` : " "} />
        {can.wages ? <>
          <Stat l="ค่าแรงรวมต่อวัน" v={fmt0(wageSum)} u="บาท" s="ถ้ามาครบทุกคน" />
          <Stat l="ค่าแรงเฉลี่ย" v={act.length ? fmt0(wageSum / act.length) : "–"} u="บาท/วัน" />
        </> : null}
        {can.daily ? <Stat l="เบิกค้าง" v={fmt0(advAll)} u="บาท" s="หักตอนจ่ายวันเสาร์" /> : null}
      </div>
      <div className="g2r">
        <div className="card">{L.length ? (
          <div className="tscroll"><table className="tb"><tbody>
            <tr><th>ชื่อ-สกุล</th><th>ชื่อเล่น</th><th>โทร</th>{can.wages ? <><th className="n">ค่าแรง/วัน</th><th>รับเงินทาง</th></> : <th>ตำแหน่ง</th>}{can.daily ? <th className="n">เบิกค้าง</th> : null}<th>สถานะ</th></tr>
            {L.map((c) => (
              <tr key={c.id} className={"click" + (c.id === sel ? " sel" : "") + (c.active ? "" : " dim")} onClick={() => pick(c.id)}>
                <td><b>{c.name}</b></td><td>{c.nick}</td><td className="small">{c.phone || "–"}</td>
                {can.wages ? <><td className="n num">{fmt0(num(c.wage))}</td><td className="small">{payText(c)}</td></> : <td className="small">{c.role || "–"}</td>}
                {can.daily ? <td className="n num">{left(c.id) > 0 ? fmt(left(c.id)) : "–"}</td> : null}
                <td>{c.active ? <Chip c="g">ทำงาน</Chip> : <Chip c="w">พักงาน</Chip>}</td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <div className="emp big"><h3>ยังไม่มีคนงานในทะเบียน</h3><p>{can.wages ? 'กด "+ เพิ่มคนงาน" หรือเพิ่มจากหน้าบันทึกรายวัน' : "เพิ่มคนงานได้จากหน้าบันทึกรายวัน"}</p></div>}</div>
        <div className="card">{C ? <>
          <div className="ch"><h3>{C.name || "(ไม่มีชื่อ)"}</h3>{can.wages ? <span className="small" style={{ color: /ไม่สำเร็จ/.test(st) ? "var(--bad)" : "var(--acc)" }}>{st}</span> : null}</div>
          {can.wages ? (
            <div className="cb cform" key={C.id}>
              <label className="f">ชื่อ-สกุล<input className="in" data-k="name" value={C.name} onChange={(e) => set("name", e.target.value)} /></label>
              <div className="grid2"><label className="f">ชื่อเล่น<input className="in" value={C.nick} onChange={(e) => set("nick", e.target.value)} /></label><label className="f">ตำแหน่ง<input className="in" value={C.role} onChange={(e) => set("role", e.target.value)} /></label></div>
              <div className="grid2"><label className="f">ค่าแรง/วัน (บาท)<input className="in" defaultValue={String(num(C.wage))} style={{ textAlign: "right" }} inputMode="decimal" onChange={(e) => set("wage", e.target.value)} /></label><label className="f">โทร<input className="in" value={C.phone} onChange={(e) => set("phone", e.target.value)} /></label></div>
              <label className="f">รับเงินทาง<select className="in" value={C.pay_by ?? "cash"} onChange={(e) => set("pay_by", e.target.value, true)}>{Object.entries(PAYBY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="f">{C.pay_by === "bank" ? "ธนาคาร + เลขบัญชี" : "เลขพร้อมเพย์ (เบอร์โทร / เลขบัตร)"}<input className="in" value={C.pay_by === "cash" ? "" : C.pay_no ?? ""} disabled={C.pay_by === "cash" || !C.pay_by} placeholder={C.pay_by === "cash" || !C.pay_by ? "จ่ายเงินสด" : ""} onChange={(e) => set("pay_no", e.target.value)} /></label>
              <div className="grid2"><label className="f">เริ่มงาน<input className="in" type="date" value={C.start_date ?? ""} onChange={(e) => set("start_date", e.target.value, true)} /></label>
                <label className="f">สถานะ<select className="in" value={C.active ? "active" : "paused"} onChange={(e) => set("active", e.target.value === "active", true)}><option value="active">ทำงาน</option><option value="paused">พักงาน</option></select></label></div>
              <label className="f">หมายเหตุ<textarea className="in" value={C.note} onChange={(e) => set("note", e.target.value)} /></label>
              <History days={daysOf(C.id)} last={lastPay(C.id)} left={left(C.id)} />
            </div>
          ) : (
            <div className="cb">
              {[["ชื่อเล่น", C.nick], ["ตำแหน่ง", C.role], ["โทร", C.phone], ["เริ่มงาน", C.start_date ? dS(C.start_date) : ""], ["สถานะ", C.active ? "ทำงาน" : "พักงาน"], ["หมายเหตุ", C.note]].map(([k, v]) => (
                <div key={k} className="rw" style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", fontSize: 13 }}><span className="muted">{k}</span><b style={{ fontWeight: 500, textAlign: "right" }}>{v || "–"}</b></div>
              ))}
              <History days={daysOf(C.id)} last={lastPay(C.id)} left={can.daily ? left(C.id) : 0} />
            </div>
          )}
        </> : <div className="emp">เลือกคนงานจากตาราง</div>}</div>
      </div>
    </div>
  </>;
}
function History({ days, last, left }: { days: number; last?: string; left: number }) {
  return <><div className="hh">ประวัติ</div><div className="small muted">ทำงาน {fmtN(days)} วัน{last ? " · รับเงินล่าสุด " + dS(last) : ""}{left > 0 ? " · เบิกค้าง " + fmt(left) + " บาท" : ""}</div></>;
}

// ---------------- เบิกล่วงหน้า ----------------
function AdvTab({ tabs, day, today, crew, adv, pays }: Props) {
  const L = [...adv].sort((a, b) => b.adv_date.localeCompare(a.adv_date));
  const ppl = crew.map((c) => ({ c, left: advLeft(c.id, adv, pays) })).filter((x) => x.left > 0);
  const dedOf = (a: Advance) => { const wk0 = weekOf(a.adv_date)[0]; return pays.find((x) => x.crew_id === a.crew_id && x.week_start >= wk0 && num(x.ded) > 0) ?? null; };
  return <>
    <Top crumb={crumb} title="เบิกล่วงหน้า" sub="หักจากค่าแรงให้อัตโนมัติตอนจ่ายวันเสาร์ ถ้าเบิกเกินค่าแรง ยอดที่เหลือยกไปหักสัปดาห์ถัดไป" acts={<Tabs tabs={tabs} tab="adv" day={day} />} />
    <div className="body">
      <div className="stats">
        <Stat l="เบิกค้างทั้งหมด" v={fmt0(ppl.reduce((s, x) => s + x.left, 0))} u="บาท" s={ppl.length ? ppl.length + " คน" : "ไม่มีค้าง"} />
        <Stat l="เบิกเดือนนี้" v={fmt0(adv.filter((a) => a.adv_date.slice(0, 7) === today.slice(0, 7)).reduce((s, a) => s + num(a.amt), 0))} u="บาท" />
        <Stat l="รายการทั้งหมด" v={adv.length} u="รายการ" />
        <Stat l="หักแล้วทั้งหมด" v={fmt0(pays.reduce((s, x) => s + num(x.ded), 0))} u="บาท" />
      </div>
      <div className="row2">
        <div className="card"><div className="ch"><h3>รายการเบิก</h3></div>
          {L.length ? <div className="tscroll"><table className="tb"><tbody><tr><th>วันที่</th><th>คนงาน</th><th>หมายเหตุ</th><th className="n">จำนวน</th><th>สถานะ</th><th /></tr>
            {L.map((a) => { const p = dedOf(a); return (
              <tr key={a.id}><td className="small">{dS(a.adv_date)}</td><td><b>{crew.find((c) => c.id === a.crew_id)?.name ?? "?"}</b></td><td className="muted small">{a.note}</td><td className="n num">{fmt(a.amt)}</td>
                <td>{p ? <Chip c="g">หักแล้ว {dShort(p.pay_date)}</Chip> : <Chip c="w">รอหัก</Chip>}</td>
                <td className="n">{p ? null : <Armed label="ลบ" armedLabel="กดอีกครั้ง" onGo={() => delAdv(a.id)} />}</td></tr>
            ); })}
          </tbody></table></div> : <div className="emp">ยังไม่มีการเบิก</div>}
        </div>
        <div className="card"><div className="ch"><h3>บันทึกเบิกใหม่</h3></div><div className="cb"><AdvBox crew={crew} date={today} /></div>
          {ppl.length ? <><div className="ch" style={{ borderTop: "1px solid var(--line2)" }}><h3>ค้างอยู่</h3></div>
            {ppl.map((x) => <div key={x.c.id} className="todo"><div className="t"><b>{x.c.name}</b></div><span className="num">{fmt(x.left)}</span></div>)}</> : null}
        </div>
      </div>
    </div>
  </>;
}

// ---------------- น้ำมัน ----------------
function FuelTab({ tabs, day, today, crew, logs, fuel, cars, can }: Props) {
  const [mon, setMon] = useState("");
  const [dlg, setDlg] = useState<null | { f0: Fuel | null; kind?: "mower" | "car" }>(null);
  const M = useMemo(() => fuelCycles(fuel, logs, "mower", today), [fuel, logs, today]);
  const carIds = [...new Set([...cars.filter((c) => c.active).map((c) => c.id), ...fuel.filter((f) => f.kind === "car").map((f) => f.car_id ?? "")])];
  const CC = carIds.map((id) => ({ id, Z: fuelCycles(fuel, logs, "car", today, id) })).filter((x) => x.Z.list.length || x.id);
  const cl = CC.flatMap((x) => x.Z.list.filter((c) => c.dist)), cDist = cl.reduce((s, c) => s + c.dist, 0), cLit = cl.reduce((s, c) => s + c.f.liters, 0);
  const closed = CC.flatMap((x) => x.Z.list.filter((c) => !c.open)), cDays = closed.reduce((s, c) => s + c.days, 0);
  const carAvg = { kpl: cLit ? cDist / cLit : 0, bpd: cDays ? closed.reduce((s, c) => s + c.f.amt, 0) / cDays : 0 };
  const mons = [...new Set(fuel.map((f) => f.log_date.slice(0, 7)))].sort().reverse();
  const inM = (f: Fuel) => !mon || f.log_date.startsWith(mon);
  const curM = mon || today.slice(0, 7), mf = fuel.filter((f) => f.log_date.startsWith(curM));
  const tot = (xs: Fuel[], k?: string) => xs.filter((f) => !k || f.kind === k).reduce((s, f) => s + f.amt, 0);
  const lit = (xs: Fuel[], k: string) => xs.filter((f) => f.kind === k).reduce((s, f) => s + f.liters, 0);
  const carOf = (id: string) => cars.find((c) => c.id === id) ?? null;
  type Z = ReturnType<typeof fuelCycles>;
  const tbl = (Z: Z, kind: "mower" | "car") => {
    const rs = Z.list.filter((c) => inM(c.f)).reverse();
    if (!rs.length) return <div className="emp" style={{ padding: 18 }}>ยังไม่มีรายการ{mon ? "ในเดือนนี้" : ""}</div>;
    return <div className="tscroll"><table className="tb ftab"><tbody>
      <tr><th>วันที่เบิก</th><th className="n">ลิตร</th><th className="n">บาท/ลิตร</th><th className="n">เป็นเงิน</th><th>ผู้เบิก</th><th className="n">ใช้ไป</th>
        {kind === "mower" ? <><th className="n">ตัดได้ (กม.)</th><th className="n">ลิตร/กม.</th><th className="n">บาท/กม.</th></> : <><th className="n">เลขไมล์</th><th className="n">วิ่ง (กม.)</th><th className="n">กม./ลิตร</th><th className="n">บาท/วัน</th></>}<th /></tr>
      {rs.map((c) => { const f = c.f; return (
        <tr key={f.id} className={"click" + (c.warn ? " warnr" : "")} onClick={() => setDlg({ f0: f })}>
          <td>{dS(f.log_date)}</td><td className="n">{fmtN(f.liters)}</td><td className="n">{fmt(f.price)}</td><td className="n"><b>{fmt0(f.amt)}</b></td>
          <td>{f.by_name || "–"}</td>
          <td className="n">{c.days} วัน{c.open ? <> <span className="chip b">ใช้อยู่</span></> : null}{kind === "mower" ? <div className="small muted">ทำงาน {c.work} วัน</div> : null}</td>
          {kind === "mower"
            ? <><td className="n">{c.km ? fmtKm(c.km) : "–"}</td><td className="n">{c.km ? fmt(c.lpk) : "–"}</td><td className="n">{c.km ? fmt(c.bpk) : "–"}</td></>
            : <><td className="n">{f.odo ? fmt0(f.odo) : "–"}</td><td className="n">{c.dist ? fmt0(c.dist) : "–"}</td><td className="n">{c.kpl ? fmt(c.kpl) : "–"}</td><td className="n">{fmt0(c.bpd)}</td></>}
          <td>{c.warn ? <Chip c="w">{kind === "mower" ? "เปลืองกว่าปกติ" : "กินน้ำมันกว่าปกติ"}</Chip> : f.note}</td>
        </tr>
      ); })}
    </tbody></table></div>;
  };
  return <>
    <Top crumb={crumb} title="น้ำมัน" sub="แต่ละรอบนับจากวันที่เบิกถึงวันที่เบิกครั้งถัดไป · ต้นทุนลงในวันที่เบิก · ระยะตัดหญ้าดึงจากบันทึกรายวัน"
      acts={<><Tabs tabs={tabs} tab="fuel" day={day} />
        <select className="in" style={{ width: "auto" }} value={mon} onChange={(e) => setMon(e.target.value)}><option value="">ทุกเดือน</option>{mons.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}</select>
        <button className="btn pr" type="button" onClick={() => setDlg({ f0: null })}>+ เบิกน้ำมัน</button></>} />
    <div className="body">
      <div className="stats">
        <Stat l={`น้ำมันเดือน${monthTitle(curM)}`} v={fmt0(tot(mf))} u="บาท" s={`ตัดหญ้า ${fmt0(tot(mf, "mower"))} · รถ ${fmt0(tot(mf, "car"))}`} />
        <Stat l="ลิตรเดือนนี้" v={fmtN(lit(mf, "mower") + lit(mf, "car"))} u="ลิตร" s={`ตัดหญ้า ${fmtN(lit(mf, "mower"))} · รถ ${fmtN(lit(mf, "car"))}`} />
        <Stat l="ตัดหญ้าเฉลี่ย" v={M.avg.bpk ? fmt(M.avg.bpk) : "–"} u="บาท/กม." s={M.avg.lpk ? `${fmt(M.avg.lpk)} ลิตร/กม.` : "ต้องมีอย่างน้อย 2 ครั้งที่เบิก และลง กม. ในบันทึกรายวัน"} />
        <Stat l="รถเฉลี่ย" v={carAvg.kpl ? fmt(carAvg.kpl) : "–"} u="กม./ลิตร" s={carAvg.bpd ? `${fmt0(carAvg.bpd)} บาท/วัน` : "กรอกเลขไมล์ตอนเติมเพื่อดู กม./ลิตร"} />
      </div>
      <div className="card"><div className="ch"><h3>🌿 น้ำมันเครื่องตัดหญ้า <span className="m">รวมทุกเครื่อง</span></h3><button className="btn sm" type="button" onClick={() => setDlg({ f0: null, kind: "mower" })}>+ เบิก</button></div>{tbl(M, "mower")}</div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="ch"><h3>🚗 น้ำมันรถเดินทาง <span className="m">แยกรายคัน · ทะเบียนรถอยู่ด้านล่าง</span></h3><button className="btn sm" type="button" onClick={() => setDlg({ f0: null, kind: "car" })}>+ เบิก</button></div>
        {CC.length ? CC.map(({ id, Z }) => {
          const c = carOf(id), xs = fuel.filter((f) => f.kind === "car" && (f.car_id ?? "") === id && inM(f));
          return <div key={id || "none"}>
            <div className="carh"><b>{id ? c?.plate || "(รถที่ลบไปแล้ว)" : "ไม่ระบุทะเบียน"}</b>{c?.name ? <span className="muted">{c.name}</span> : null}{c?.fuel_type ? <span className="chip nd">{c.fuel_type}</span> : null}
              <span className="carst">{xs.length} ครั้ง · {fmtN(xs.reduce((s, f) => s + f.liters, 0))} ลิตร · <b>{fmt0(xs.reduce((s, f) => s + f.amt, 0))}</b> บาท{Z.avg.kpl ? <> · เฉลี่ย <b>{fmt(Z.avg.kpl)}</b> กม./ลิตร</> : null}</span></div>
            {tbl(Z, "car")}
          </div>;
        }) : <div className="emp" style={{ padding: 18 }}>ยังไม่มีรายการ · เพิ่มทะเบียนรถด้านล่าง แล้วกด + เบิก</div>}
      </div>
      {mons.length ? <div className="card" style={{ marginTop: 16 }}><div className="ch"><h3>สรุปรายเดือน</h3></div>
        <div className="tscroll"><table className="tb"><tbody><tr><th>เดือน</th><th className="n">ตัดหญ้า (ลิตร)</th><th className="n">ตัดหญ้า (บาท)</th><th className="n">รถ (ลิตร)</th><th className="n">รถ (บาท)</th><th className="n">รวม (บาท)</th></tr>
          {mons.map((m) => { const xs = fuel.filter((f) => f.log_date.startsWith(m)); return <tr key={m}><td>{monthTitle(m)}</td><td className="n">{fmtN(lit(xs, "mower"))}</td><td className="n">{fmt0(tot(xs, "mower"))}</td><td className="n">{fmtN(lit(xs, "car"))}</td><td className="n">{fmt0(tot(xs, "car"))}</td><td className="n"><b>{fmt0(tot(xs))}</b></td></tr>; })}
        </tbody></table></div></div> : null}
      <CarsCard key={cars.map((c) => c.id + c.plate + c.name + (c.fuel_type ?? "") + c.active).join("|")} cars={cars} fuel={fuel} edit={can.cars} />
    </div>
    {dlg ? <FuelDialog f0={dlg.f0} kind0={dlg.kind} date={today} crew={crew} cars={cars} recent={fuel} onClose={() => setDlg(null)} /> : null}
  </>;
}

const FUELT = ["ดีเซล", "แก๊สโซฮอล์ 91", "แก๊สโซฮอล์ 95", "E20", "เบนซิน"];
function CarsCard({ cars, fuel, edit }: { cars: Car[]; fuel: Fuel[]; edit: boolean }) {
  type Row = { id?: string; plate: string; name: string; fuel_type: string; active: boolean };
  const init = () => cars.map((c) => ({ id: c.id, plate: c.plate, name: c.name, fuel_type: c.fuel_type ?? "", active: c.active }));
  const [L, setL] = useState<Row[]>(init);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const used = (id?: string) => (id ? fuel.filter((f) => f.car_id === id).length : 0);
  const upd = (i: number, k: keyof Row, v: string | boolean) => { setL((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setDirty(true); };
  const save = async () => {
    setBusy(true); const r = await saveCars(L); setBusy(false);
    if (r.error) { toast(r.error, true); return; }
    setDirty(false); toast("บันทึกรถแล้ว");
  };
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="ch"><h3>ทะเบียนรถ <span className="m">ใช้เลือกตอนเบิกน้ำมันรถ · นับ กม./ลิตร แยกรายคัน</span></h3>
        {edit ? <div className="acts"><button className="btn sm" type="button" onClick={() => { setL((x) => [...x, { plate: "", name: "", fuel_type: "ดีเซล", active: true }]); setDirty(true); }}>+ เพิ่มรถ</button><button className="btn sm pr" type="button" disabled={busy || !dirty} onClick={save}>บันทึกรถ</button></div> : null}</div>
      {L.length ? <div className="tscroll"><table className="tb"><tbody>
        <tr><th style={{ width: "22%" }}>ทะเบียน</th><th>ชื่อเรียก</th><th style={{ width: "20%" }}>ชนิดน้ำมัน</th><th style={{ width: "14%" }}>สถานะ</th><th className="n" style={{ width: "12%" }}>เบิกน้ำมัน</th><th style={{ width: 60 }} /></tr>
        {L.map((c, i) => edit ? (
          <tr key={c.id ?? "n" + i}>
            <td><input className="in" value={c.plate} placeholder="เช่น บข 1234 ชลบุรี" onChange={(e) => upd(i, "plate", e.target.value)} /></td>
            <td><input className="in" value={c.name} placeholder="เช่น กระบะขาว" onChange={(e) => upd(i, "name", e.target.value)} /></td>
            <td><select className="in" value={c.fuel_type} onChange={(e) => upd(i, "fuel_type", e.target.value)}><option value="">–</option>{FUELT.map((t) => <option key={t}>{t}</option>)}</select></td>
            <td><select className="in" value={c.active ? "" : "off"} onChange={(e) => upd(i, "active", e.target.value !== "off")}><option value="">ใช้งาน</option><option value="off">เลิกใช้</option></select></td>
            <td className="n small muted">{used(c.id)} ครั้ง</td>
            <td>{used(c.id) ? null : <button type="button" className="lnk bad small" onClick={() => { setL((x) => x.filter((_, j) => j !== i)); setDirty(true); }}>ลบ</button>}</td>
          </tr>
        ) : (
          <tr key={c.id ?? i}><td>{c.plate}</td><td>{c.name}</td><td>{c.fuel_type || "–"}</td><td>{c.active ? "ใช้งาน" : "เลิกใช้"}</td><td className="n small muted">{used(c.id)} ครั้ง</td><td /></tr>
        ))}
      </tbody></table></div> : <div className="cb small muted">ยังไม่มีรถ{edit ? " กด + เพิ่มรถ แล้วใส่ทะเบียน" : ""}</div>}
    </div>
  );
}
