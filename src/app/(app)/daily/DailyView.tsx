"use client";

// บันทึกรายวัน (แบบ 3 คอลัมน์): แถบวันบนหัว · ใครมาทำงาน | ตัดสายไหน | สรุปวันนี้ + สัปดาห์นี้ · บันทึกอัตโนมัติ
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Top, toast } from "@/components/ui";
import { FuelDialog } from "@/components/FuelDialog";
import { dL } from "@/lib/print/fmt";
import {
  type Advance, type Car, type CrewDay, type CrewRec, type DayRec, type Fuel, type Order, type Route, type World,
  FK, WD, WDL, addDaysIso, cNorm, dS, dShort, dayN, fmt0, fmtKm, fmtN, num, payOf, rInfo, unitOf, wdOf, weekOf, workIndex,
} from "@/lib/model";
import { addCrew, deleteAdvance, deleteDaily, removeDailyCrew, saveAdvance, saveDaily } from "./actions";

type Can = { edit: boolean; wages: boolean; fuel: boolean };
type W2 = { r: string; km: string; fin?: boolean };
type D = { work: W2[]; crew: CrewDay[]; fuel: string; fuel_car: string; water: string; other: string; note: string };
type Ent = { o: Order; r: Route; done: boolean };

const dInit = (nm: string) => {
  const t = String(nm || "?").trim().split(/\s+/), f = (x: string) => (x.match(/[ก-ฮA-Za-z0-9]/) || ["?"])[0];
  return t.length > 1 ? f(t[0]) + f(t[1]) : f(t[0]);
};
const sDay = (d: string) => `${WD[wdOf(d)]}. ${dShort(d)}`;
const str = (n: number) => (n ? String(n) : "");

export function DailyView({ W, day, today, week, prev, crew, paid, adv, fuel, cars, add, can }: {
  W: World; day: string; today: string; week: DayRec[]; prev: DayRec | null; crew: CrewRec[]; paid: string[];
  adv: Advance[]; fuel: Fuel[]; cars: Car[]; add: string[]; can: Can;
}) {
  const router = useRouter();
  const ro = !can.edit;
  const wk = weekOf(day), rec = week.find((r) => r.date === day) ?? null;
  const isPaid = (id: string) => paid.includes(id);
  const crewOf = (id: string) => crew.find((c) => c.id === id);

  // ---------- สายทั้งหมด จัดกลุ่มตามสาย (สายเดียวกันหลายงวด) ----------
  const { byId, groups, keyOf } = useMemo(() => {
    const wiAll = workIndex(W.days);
    const byId = new Map<string, Ent>(), groups = new Map<string, Ent[]>(), keyOf = new Map<string, string>();
    for (const o of W.orders) for (const r of o.routes) {
      const e = { o, r, done: rInfo(W, wiAll, r).s === "done" }, k = r.code.trim() ? o.agency_id + "|" + cNorm(r.code) : r.id;
      byId.set(r.id, e); keyOf.set(r.id, k);
      const l = groups.get(k) ?? []; l.push(e); groups.set(k, l);
    }
    for (const l of groups.values()) l.sort((a, b) => b.o.fy - a.o.fy || b.o.round_no - a.o.round_no);
    return { byId, groups, keyOf };
  }, [W]);
  const gPick = (g: Ent[]) => g.find((x) => !x.done) ?? g[0];
  const otherDays = useMemo(() => W.days.filter((d) => d.date !== day), [W.days, day]);
  const wiOther = useMemo(() => workIndex(otherDays), [otherDays]);
  const wiBefore = useMemo(() => workIndex(otherDays.filter((d) => d.date < day)), [otherDays, day]);
  const multiAg = W.agencies.length > 1;
  const where = (o: Order) => (multiAg ? (W.agencies.find((a) => a.id === o.agency_id)?.short_name ?? "") + " · " : "") + (o.hmd ? "หมวด" + o.hmd : "ไม่ระบุหมวด");
  const noYr = (o: Order) => `${o.round_no}/${o.fy}`;

  // ---------- ข้อมูลของวัน ----------
  const init = (): D => {
    const base: D = rec
      ? { work: rec.work.map((w) => ({ r: w.r, km: w.km == null ? "" : String(w.km), ...(w.fin ? { fin: true } : {}) })), crew: rec.crew.map((c) => ({ ...c })), fuel: str(rec.fuel), fuel_car: str(rec.fuel_car), water: str(rec.water), other: str(rec.other), note: rec.note }
      : { work: [], crew: [], fuel: "", fuel_car: "", water: "", other: "", note: "" };
    for (const c of crew) if (c.active && !base.crew.some((x) => x.id === c.id)) base.crew.push({ id: c.id, name: c.name, wage: c.wage, ot: 0, on: false });
    for (const r of add) if (byId.has(r) && !base.work.some((w) => w.r === r)) base.work.push({ r, km: "" });
    return base;
  };
  const [D, setD] = useState<D>(init);
  const Dref = useRef(D);
  const [st, setSt] = useState(!can.edit ? "ดูอย่างเดียว" : rec ? "✓ บันทึกอัตโนมัติแล้ว" : "เริ่มกรอกแล้วระบบบันทึกให้เอง");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const [fuelDlg, setFuelDlg] = useState<null | { f0: Fuel | null }>(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const doSave = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const x = Dref.current;
    setSt("กำลังบันทึก…");
    const p = saveDaily({ date: day, work: x.work.map((w) => ({ r: w.r, km: w.km, fin: w.fin })), crew: x.crew, fuel: x.fuel, fuel_car: x.fuel_car, water: x.water, other: x.other, note: x.note })
      .then((r) => { if (r.error) { setSt("บันทึกไม่สำเร็จ"); toast(r.error, true); } else setSt("✓ บันทึกอัตโนมัติแล้ว"); });
    saving.current = p;
    await p;
  };
  const change = (fn: (x: D) => D, now = false) => {
    if (ro) return;
    const n = fn(structuredClone(Dref.current));
    Dref.current = n; setD(n); setSt("กำลังบันทึก…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(doSave, now ? 0 : 700);
  };
  const flush = async () => { if (timer.current) await doSave(); else if (saving.current) await saving.current; };
  const goDay = async (d: string) => { await flush(); router.push(`/daily?d=${d}`); };

  // สายที่ส่งมาจากหน้างาน: บันทึกทันที แล้วเอาพารามิเตอร์ออก
  const added = useRef(false);
  useEffect(() => {
    if (added.current || !add.length || ro) return;
    added.current = true;
    const n = add.filter((r) => byId.has(r) && !(rec?.work ?? []).some((w) => w.r === r)).length;
    doSave().then(() => {
      if (n) toast(`เพิ่ม ${n} สายในบันทึกวันที่ ${dS(day)} แล้ว กดมาให้คนงาน แล้วเปิด "จบสาย" เมื่อตัดครบ`);
      router.replace(`/daily?d=${day}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (timer.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); if (timer.current) doSave(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- คำนวณ ----------
  const fuelOn = (d: string) => fuel.filter((f) => f.log_date === d).reduce((s, f) => s + f.amt, 0);
  const cost = (r: { crew: CrewDay[]; fuel: number | string; fuel_car: number | string; water: number | string; other: number | string }, d: string) => {
    let w = 0, n = 0;
    for (const c of r.crew) if (c.on) { w += payOf(c); n += unitOf(c); }
    return { w, n, o: num(r.fuel) + num(r.fuel_car) + num(r.water) + num(r.other) + fuelOn(d) };
  };
  const recDay = (d: string) => { const r = d === day ? D : week.find((x) => x.date === d); return r && cost(r, d).n ? r : null; };
  const dc = cost(D, day), km = D.work.reduce((s, w) => s + num(w.km), 0), half = D.crew.filter((x) => x.on && x.half).length;
  const cum = (w: W2) => {
    const e = byId.get(w.r);
    const L = e ? rInfo(W, wiOther, e.r).L : 0, sum = (wiOther.get(w.r)?.km ?? 0) + num(w.km);
    return { L, sum, over: L > 0 && sum > L + 1e-9, pc: L > 0 ? Math.min(100, Math.round((sum / L) * 100)) : 0 };
  };
  const finBefore = (r: string) => wiBefore.get(r)?.fin ?? "";
  const inDay = new Set(D.work.map((w) => w.r));

  // ---------- คนงาน ----------
  const setCrew = (i: number, v: "y" | "h" | "n") => {
    const x = D.crew[i];
    if (isPaid(x.id)) { toast(`${x.name} จ่ายค่าแรงสัปดาห์นี้แล้ว ถ้าต้องแก้ ให้ยกเลิกการจ่ายในหน้าคนงานและค่าแรงก่อน`, true); return; }
    change((d) => { const c = d.crew[i]; c.on = v !== "n"; c.half = v === "h"; if (!c.on) c.ot = 0; return d; });
  };
  const allOn = () => {
    const n = D.crew.filter((x) => !isPaid(x.id) && !(x.on && !x.half)).length;
    if (!n) { toast("ทุกคนมาอยู่แล้ว"); return; }
    change((d) => { for (const c of d.crew) if (!isPaid(c.id)) { c.on = true; c.half = false; } return d; });
  };
  const copyPrev = () => {
    if (!prev) return;
    change((d) => {
      for (const x of d.crew) { if (isPaid(x.id)) continue; const s = prev.crew.find((y) => y.id === x.id); x.on = !!(s && s.on); x.half = !!(s && s.on && s.half); if (!x.on) x.ot = 0; }
      d.work = prev.work.filter((w) => byId.has(w.r) && !finBefore(w.r) && !w.fin).map((w) => ({ r: w.r, km: "" }));
      return d;
    }, true);
    toast("ก๊อปคนงานและสายที่ยังไม่จบจากวันที่ " + dS(prev.date) + " แล้ว แก้เฉพาะที่ต่างได้เลย");
  };
  const onN = D.crew.filter((x) => x.on && !x.half).length;
  // ลบชื่อคนงาน: กด ✕ สองครั้ง · คนที่ไม่มี id (ชื่อพิมพ์เองแบบเดิม) เอาออกจากวันนี้อย่างเดียว
  const [rmArm, setRmArm] = useState<string | null>(null);
  const [rmBusy, setRmBusy] = useState(false);
  const rmKey = (x: CrewDay) => x.id || "n:" + x.name;
  const rmCrew = async (x: CrewDay) => {
    if (isPaid(x.id)) { toast(`${x.name} จ่ายค่าแรงสัปดาห์นี้แล้ว ยกเลิกการจ่ายในหน้าคนงานและค่าแรงก่อน`, true); return; }
    const k = rmKey(x);
    if (rmArm !== k) { setRmArm(k); toast(`กด ✕ อีกครั้งเพื่อลบ ${x.name || "(ไม่มีชื่อ)"} ออกจากรายชื่อ`); return; }
    setRmArm(null);
    const drop = (d: D) => { d.crew = d.crew.filter((c) => rmKey(c) !== k); return d; };
    if (!x.id) { change(drop, true); return; }
    setRmBusy(true);
    await flush();
    const r = await removeDailyCrew(day, x.id);
    setRmBusy(false);
    if (r.error) { toast(r.error, true); return; }
    const n = drop(structuredClone(Dref.current));
    Dref.current = n; setD(n);
    toast(r.mode === "inactive" ? `ลบ ${x.name} ออกจากรายชื่อแล้ว (พักงานไว้ ประวัติยังอยู่ครบ เปิดใหม่ได้ที่ทะเบียนคนงาน)` : `ลบ ${x.name} ออกจากทะเบียนแล้ว`);
    router.refresh();
  };

  // ---------- สาย ----------
  const [q, setQ] = useState("");
  const [hitsOpen, setHitsOpen] = useState(false);
  const qn = cNorm(q);
  const hits = qn ? [...groups.values()].map((g) => { const c = cNorm(g[0].r.code); return [g, c === qn || c.endsWith(qn) ? 0 : c.includes(qn) ? 1 : cNorm(g[0].r.descr).includes(qn) ? 2 : 9] as const; })
    .filter((x) => x[1] < 9).sort((x, y) => x[1] - y[1]).map((x) => x[0]).slice(0, 12) : [];
  const addG = (g: Ent[]) => {
    setQ(""); setHitsOpen(false);
    if (g.some((x) => inDay.has(x.r.id))) { toast("เลือกสายนี้แล้ว"); return; }
    const p = gPick(g); change((d) => { d.work.push({ r: p.r.id, km: "" }); return d; });
  };
  const sug: { r: string; c: ReturnType<typeof cum> }[] = [];
  { const seen = new Set<string>();
    for (const d of [...otherDays].filter((x) => x.date < day).sort((a, b) => b.date.localeCompare(a.date))) for (const w of d.work) {
      if (seen.has(w.r)) continue; seen.add(w.r);
      if (inDay.has(w.r) || !byId.has(w.r) || finBefore(w.r)) continue;
      const c = cum({ r: w.r, km: "" }); if (c.L && c.sum >= c.L - 1e-9) continue;
      sug.push({ r: w.r, c }); if (sug.length >= 5) break;
    } }

  // ---------- สัปดาห์ ----------
  const wDays = wk.slice(0, 6).filter((d) => recDay(d)), miss = wk.slice(0, 6).filter((d) => d < today && !recDay(d));
  const tot = (f: (r: NonNullable<ReturnType<typeof recDay>>, d: string) => number) => wk.reduce((s, d) => { const r = recDay(d); return s + (r ? f(r, d) : 0); }, 0);
  const strip = wk.map((d) => {
    const r = recDay(d), sun = wdOf(d) === 0, ms = !r && !sun && d < today;
    return (
      <button key={d} type="button" className={"dd" + (d === day ? " on" : "") + (r ? " ok" : "") + (ms ? " ms" : "") + (sun && !r ? " off" : "") + (d === today ? " tdy" : "")}
        title={dS(d) + (r ? " · " + fmtN(cost(r, d).n) + " คน" : ms ? " · ยังไม่บันทึก" : "")} onClick={() => goDay(d)}>
        {WD[wdOf(d)]}.<b>{dayN(d)}</b><i />
      </button>
    );
  });
  const legacy = (["fuel", "fuel_car"] as const).filter((k) => num(D[k]));
  const dayFuel = fuel.filter((f) => f.log_date === day);
  const carLbl = (f: Fuel) => (f.car_id ? cars.find((c) => c.id === f.car_id)?.plate || f.car_plate || "รถ" : f.car_plate || "รถ (ไม่ระบุ)");

  return (
    <div className="ax"><div className="pg">
      <Top
        crumb={<>หน้างาน › <b>บันทึกรายวัน</b></>}
        title={`${WDL[wdOf(day)]} ${dL(day)}`}
        sub={<span className="tagnote" style={/ไม่สำเร็จ/.test(st) ? { color: "var(--bad)" } : undefined}>{st}</span>}
        acts={<>
          <div className="dwk">
            <button type="button" className="ar" title="สัปดาห์ก่อน" onClick={() => goDay(addDaysIso(day, -7))}>‹</button>
            {strip}
            <button type="button" className="ar" title="สัปดาห์ถัดไป" onClick={() => goDay(addDaysIso(day, 7))}>›</button>
            <label className="cal" title="เลือกวันที่"><input type="date" value={day} onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) goDay(e.target.value); }} />📅</label>
          </div>
          {day !== today ? <button className="btn" type="button" onClick={() => goDay(today)}>วันนี้</button> : null}
          {can.edit ? <button className="btn copy" type="button" disabled={!prev} title={prev ? "ก๊อปคนงานและสายทางจากวันที่ " + dS(prev.date) : "ยังไม่มีวันก่อนหน้า"} onClick={copyPrev}>⧉ ดึงจากเมื่อวาน</button> : null}
        </>}
      />
      <div className="body"><div className="d3">
        {/* 1. ใครมาทำงาน */}
        <div className="card dcard">
          <div className="dh"><h3><span className="no">1</span>ใครมาทำงาน <span className="m">มา {onN} · ครึ่งวัน {half} · ไม่มา {D.crew.length - onN - half}</span></h3>
            {can.edit ? <button className="btn sm g" type="button" onClick={allOn}>✓ ทุกคนมา</button> : null}</div>
          {advOpen ? <AdvForm crew={crew} date={day} list={adv} onClose={() => setAdvOpen(false)} /> : null}
          {!D.crew.length ? <div className="emp" style={{ padding: 16 }}>ยังไม่มีคนงานในทะเบียน{can.edit ? " กด + คนงานใหม่" : ""}</div> : null}
          {D.crew.map((x, i) => {
            const R = crewOf(x.id), lock = isPaid(x.id), s = !x.on ? "n" : x.half ? "h" : "y";
            const sub = [R?.nick, R?.role].filter(Boolean).join(" · ");
            return (
              <div key={x.id || x.name} className={"crw" + (lock ? " lock" : "") + (ro ? "" : " ed")}>
                <div className="av">{dInit(x.name)}</div>
                <div className="nm"><b>{x.name || "(ไม่มีชื่อ)"}</b><small>{lock ? "จ่ายแล้ว · " : ""}{sub ? sub + (can.wages ? " · " : "") : ""}{can.wages ? fmt0(num(x.wage)) + "/วัน" : !sub && !lock ? " " : ""}</small></div>
                <div className="seg">{([["y", "มา"], ["h", "ครึ่งวัน"], ["n", "ไม่มา"]] as const).map(([k, t]) => (
                  <button key={k} type="button" className={s === k ? k : ""} disabled={lock || ro} onClick={() => setCrew(i, k)}>{t}</button>
                ))}</div>
                {can.wages ? <input className="in ot" value={x.on && x.ot ? String(x.ot) : ""} placeholder="OT" title="OT / เบี้ยเลี้ยง (บาท)" disabled={!x.on || lock || ro}
                  onChange={(e) => { const v = e.target.value; change((d) => { d.crew[i].ot = num(v); return d; }); }} /> : <span />}
                <div className={"amt" + (x.on ? "" : " z")}>{can.wages ? (x.on ? fmt0(payOf(x)) : "–") : x.on ? (x.half ? "½" : "✓") : "–"}</div>
                {ro ? null : <button type="button" className={"rm" + (rmArm === rmKey(x) ? " arm" : "")} disabled={lock || rmBusy}
                  title={lock ? "จ่ายค่าแรงแล้ว ลบไม่ได้" : rmArm === rmKey(x) ? "กดอีกครั้งเพื่อยืนยันลบ" : "ลบชื่อออกจากรายชื่อ"}
                  onBlur={() => setRmArm((v) => (v === rmKey(x) ? null : v))} onClick={() => rmCrew(x)}>✕</button>}
              </div>
            );
          })}
          {adding ? <AddCrew wages={can.wages} defWage={crew.find((c) => c.active)?.wage ?? 400} onCancel={() => setAdding(false)} onAdded={(c) => { setAdding(false); change((d) => { d.crew.push(c); return d; }, true); router.refresh(); }} /> : null}
          {can.edit ? (
            <div className="dfoot">
              <button className="btn sm" type="button" onClick={() => setAdding(true)}>+ คนงานใหม่</button>
              <button className="btn sm" type="button" onClick={() => setAdvOpen((v) => !v)}>+ เบิกล่วงหน้า</button>
              {can.wages ? <span className="m">ค่าแรงรวม <b>{fmt0(dc.w)}</b></span> : null}
            </div>
          ) : null}
        </div>

        {/* 2. ตัดสายไหน */}
        <div className="card dcard">
          <div className="dh"><h3><span className="no">2</span>ตัดสายไหน <span className="m">{D.work.length ? `${D.work.length} สาย${km ? " · " + fmtKm(km) + " กม." : ""}` : ""}</span></h3></div>
          {D.work.map((w, i) => {
            const e = byId.get(w.r);
            if (!e) return <div key={w.r} className="rw2"><div className="l1"><span className="muted small">สายนี้ถูกลบจากงวดแล้ว หรืออยู่นอกขอบเขตที่เห็น</span>{ro ? null : <button type="button" className="x" onClick={() => change((d) => { d.work.splice(i, 1); return d; })}>✕</button>}</div></div>;
            const g = groups.get(keyOf.get(w.r) ?? "") ?? [e], c = cum(w), fd = finBefore(w.r);
            return (
              <div key={w.r} className="rw2">
                <div className="l1"><b>{e.r.code}</b><span className="ds" title={e.r.descr}>{e.r.descr}</span>{ro ? null : <button type="button" className="x" title="เอาออก" onClick={() => change((d) => { d.work.splice(i, 1); return d; })}>✕</button>}</div>
                <div className="l0">
                  {g.length > 1 && !ro ? (
                    <select className="in" value={w.r} onChange={(ev) => { const v = ev.target.value; change((d) => { d.work[i] = { r: v, km: d.work[i].km }; return d; }); }}>
                      {g.map((x) => <option key={x.r.id} value={x.r.id} disabled={x.r.id !== w.r && inDay.has(x.r.id)}>งวด {noYr(x.o)}{x.done ? " (เสร็จแล้ว)" : ""}</option>)}
                    </select>
                  ) : <>งวด {noYr(e.o)}</>} · {where(e.o)}
                </div>
                <div className="l2">
                  <input className="in km" value={w.km} placeholder="–" inputMode="decimal" disabled={ro} onChange={(ev) => { const v = ev.target.value; change((d) => { d.work[i].km = v; return d; }); }} /> กม.
                  {c.L && !ro ? <button type="button" className="btn xs" title="ใส่ระยะที่เหลือทั้งหมด" onClick={() => { const left = Math.max(0, Math.round((c.L - (c.sum - num(w.km))) * 100) / 100); change((d) => { d.work[i].km = String(left); d.work[i].fin = true; return d; }); }}>ทั้งสาย</button> : null}
                  {fd ? <span className="fin done">จบแล้ว {dShort(fd)}</span>
                    : <button type="button" className={"fin" + (w.fin ? " on" : "")} disabled={ro} onClick={() => change((d) => { if (d.work[i].fin) delete d.work[i].fin; else d.work[i].fin = true; return d; })}><i />จบสาย</button>}
                  <span className="cm" style={c.over ? { color: "var(--bad)" } : undefined}>{fmtKm(c.sum)}{c.L ? "/" + fmtKm(c.L) : ""} กม.</span>
                  <span className="pbx"><i style={{ width: c.pc + "%" }} /></span>
                </div>
              </div>
            );
          })}
          {!D.work.length ? (
            <div className="emp" style={{ padding: "14px 16px", textAlign: "left" }}>
              {dc.n ? <span style={{ color: "var(--warn)" }}>ยังไม่ได้เลือกสายทาง ค่าแรงและค่าน้ำมันวันนี้จะไม่ถูกนับเป็นต้นทุนของหมวดใด</span> : ro ? "ยังไม่มีสาย" : "ยังไม่มีสาย พิมพ์เลขสายด้านล่าง หรือกดสายที่ทำค้างไว้"}
            </div>
          ) : null}
          {ro ? null : <>
            <div className="dadd rsearch">
              <input className="in" placeholder="+ พิมพ์เลขสายหรือชื่อสาย เช่น 3083" autoComplete="off" value={q}
                onChange={(e) => { setQ(e.target.value); setHitsOpen(true); }} onFocus={() => setHitsOpen(true)} onBlur={() => setTimeout(() => setHitsOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); addG(hits[0]); } if (e.key === "Escape") { setQ(""); } }} />
              {hitsOpen && qn ? (
                <div className="rhits">
                  {hits.length ? hits.map((g) => { const p = gPick(g), sel = g.some((x) => inDay.has(x.r.id)); return (
                    <button key={p.r.id} type="button" className={sel ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); addG(g); }}>
                      <b>{p.r.code || "(ไม่มีรหัส)"}</b> <span>{p.r.descr}</span><small>{where(p.o)} · งวด {noYr(p.o)}{g.length > 1 ? ` (มี ${g.length} งวด)` : ""}{sel ? " · เลือกแล้ว" : ""}</small>
                    </button>
                  ); }) : <div className="small muted" style={{ padding: "8px 12px" }}>ไม่พบสายทาง “{q}” ในงวดงาน · เพิ่มสายเข้างวดที่เมนูงาน › แก้สายในงวด</div>}
                </div>
              ) : null}
            </div>
            {sug.length ? <div className="dsg">ทำค้างไว้: {sug.map(({ r, c }) => (
              <button key={r} type="button" className="chipb" onClick={() => change((d) => { d.work.push({ r, km: "" }); return d; })}>+ {byId.get(r)!.r.code}{c.L ? <> <small>{fmtKm(c.sum)}/{fmtKm(c.L)}</small></> : null}</button>
            ))}</div> : null}
          </>}
          <p className="hint2">กม. ใช้ดูความคืบหน้า ไม่เกี่ยวกับ ตร.ม. ที่คิดเงิน · ความยาวสายกรอกที่ทะเบียนสายทาง</p>
        </div>

        {/* สรุป */}
        <div className="dside">
          <div className="card sm2">
            <h4>สรุปวันนี้</h4>
            <div className="rw">คนมา<b>{fmtN(dc.n)} คน{half ? ` (ครึ่งวัน ${half})` : ""}</b></div>
            {can.wages ? <div className="rw">ค่าแรง + OT<b>{fmt0(dc.w)}</b></div> : null}
            {can.fuel ? (
              <div className="dfuel">
                <div className="t">น้ำมันที่เบิกวันนี้{can.edit ? <button className="btn xs g" type="button" onClick={() => setFuelDlg({ f0: null })}>+ เบิกน้ำมัน</button> : null}</div>
                {dayFuel.length ? dayFuel.map((f) => (
                  <button key={f.id} type="button" className="fi" onClick={() => can.edit && setFuelDlg({ f0: f })}>
                    <span>{f.kind === "car" ? "🚗 " + carLbl(f) : "🌿 " + FK[f.kind]} · {fmtN(f.liters)} ล. × {f.price.toFixed(2)}</span><b>{fmt0(f.amt)}</b>
                  </button>
                )) : <div className="fe">ยังไม่มี · เบิกแล้วกดปุ่มด้านบน</div>}
              </div>
            ) : null}
            {can.fuel ? (
              <div className="exin">
                {legacy.map((k) => <label key={k}>{k === "fuel" ? "น้ำมันตัดหญ้า (เดิม)" : "น้ำมันรถ (เดิม)"}<input className="in" value={D[k]} placeholder="0" inputMode="decimal" disabled={ro} onChange={(e) => { const v = e.target.value; change((d) => { d[k] = v; return d; }); }} /></label>)}
                <label>ค่าน้ำลูกจ้าง<input className="in" value={D.water} placeholder="0" inputMode="decimal" disabled={ro} onChange={(e) => { const v = e.target.value; change((d) => { d.water = v; return d; }); }} /></label>
                <label>อื่น ๆ<input className="in" value={D.other} placeholder="0" inputMode="decimal" disabled={ro} onChange={(e) => { const v = e.target.value; change((d) => { d.other = v; return d; }); }} /></label>
                <label>หมายเหตุ<input className="in" value={D.note} placeholder="เช่น ฝนตกช่วงบ่าย" disabled={ro} onChange={(e) => { const v = e.target.value; change((d) => { d.note = v; return d; }); }} /></label>
              </div>
            ) : D.note ? <div className="rw">หมายเหตุ<b>{D.note}</b></div> : null}
            <div className="rw">ระยะที่ตัด<b>{fmtKm(km)} กม. · {D.work.length} สาย</b></div>
            {can.wages ? <div className="rw tot">รวมวันนี้<b>{fmt0(dc.w + dc.o)} บาท</b></div>
              : can.fuel ? <div className="rw tot">ค่าใช้จ่ายอื่นวันนี้<b>{fmt0(dc.o)} บาท</b></div> : null}
            {can.wages && rec ? <DelDay day={day} locked={D.crew.some((x) => x.on && isPaid(x.id))} /> : null}
          </div>
          <div className="card sm2">
            <h4>สัปดาห์นี้ <span className="m">{sDay(wk[0])} – {sDay(wk[5])} · จ่ายเย็นเสาร์</span></h4>
            <div className="rw">วันทำงาน<b>{wDays.length}/6 วัน</b></div>
            <div className="rw">ระยะที่ตัด<b>{fmtKm(tot((r) => r.work.reduce((s, w) => s + num(w.km), 0)))} กม.</b></div>
            {can.fuel ? <div className="rw">ค่าใช้จ่ายอื่น<b>{fmt0(tot((r, d) => cost(r, d).o))}</b></div> : null}
            {miss.length ? <div className="rw">ยังไม่บันทึก<b className="wn">{miss.map((d) => <button key={d} type="button" className="lnk" style={{ marginLeft: 6 }} onClick={() => goDay(d)}>{WD[wdOf(d)]}. {dayN(d)}</button>)}</b></div> : null}
            {can.wages ? <>
              <div className="rw tot">ค่าแรงสัปดาห์นี้<b>{fmt0(tot((r) => cost(r, "").w))}</b></div>
              <Link className="btn g wide" href={`/crew?tab=pay&d=${day}`} onClick={async (e) => { if (timer.current) { e.preventDefault(); await flush(); router.push(`/crew?tab=pay&d=${day}`); } }}>จ่ายค่าแรงสัปดาห์นี้ →</Link>
            </> : null}
          </div>
        </div>
      </div></div>
      {fuelDlg ? <FuelDialog f0={fuelDlg.f0} date={day} crew={crew} cars={cars} recent={fuel} onClose={() => setFuelDlg(null)} /> : null}
    </div></div>
  );
}

function AddCrew({ wages, defWage, onCancel, onAdded }: { wages: boolean; defWage: number | null; onCancel: () => void; onAdded: (c: CrewDay) => void }) {
  const [name, setName] = useState("");
  const [wage, setWage] = useState(String(defWage ?? 400));
  const [busy, setBusy] = useState(false);
  const ok = async () => {
    if (!name.trim()) { toast("ใส่ชื่อคนงาน", true); return; }
    setBusy(true);
    const r = await addCrew(name, wages ? wage : undefined);
    setBusy(false);
    if (r.error || !r.id) { toast(r.error || "เพิ่มไม่สำเร็จ", true); return; }
    toast("เพิ่ม " + name.trim() + " เข้าทะเบียนแล้ว");
    onAdded({ id: r.id, name: name.trim(), wage: r.wage ?? null, ot: 0, on: true });
  };
  const key = (e: React.KeyboardEvent) => { if (e.key === "Enter") ok(); if (e.key === "Escape") onCancel(); };
  return (
    <div className="crw addf">
      <div className="av">+</div>
      <input className="in" autoFocus placeholder="ชื่อ-สกุล" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={key} />
      {wages ? <input className="in" value={wage} title="ค่าแรงต่อวัน" style={{ textAlign: "right" }} onChange={(e) => setWage(e.target.value)} onKeyDown={key} /> : <span />}
      <button className="btn sm pr" type="button" disabled={busy} onClick={ok}>เพิ่ม</button>
      <button className="lnk" type="button" onClick={onCancel}>ยกเลิก</button>
    </div>
  );
}

function AdvForm({ crew, date, list, onClose }: { crew: CrewRec[]; date: string; list: Advance[]; onClose: () => void }) {
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
    toast(`บันทึกเบิก ${crew.find((c) => c.id === who)?.name ?? ""} ${fmt0(num(amt))} บาทแล้ว`);
    setAmt(""); setNote("");
  };
  return (
    <div className="cb" style={{ paddingBottom: 0 }}>
      <div className="advf">
        <div className="grid2">
          <label className="f" style={{ gridColumn: "span 2" }}>คนงาน<select className="in" value={who} onChange={(e) => setWho(e.target.value)}>{act.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="f">วันที่เบิก<input className="in" type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
          <label className="f">จำนวนเงิน (บาท)<input className="in" value={amt} placeholder="0" style={{ textAlign: "right" }} inputMode="decimal" onChange={(e) => setAmt(e.target.value)} /></label>
          <label className="f" style={{ gridColumn: "span 2" }}>หมายเหตุ<input className="in" value={note} placeholder="ถ้ามี" onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <div className="acts" style={{ marginTop: 10 }}><button className="btn sm pr" type="button" disabled={busy} onClick={save}>บันทึกเบิก</button><button className="btn sm" type="button" onClick={onClose}>ปิด</button></div>
        {list.length ? (
          <div style={{ marginTop: 10 }}>
            {list.map((a) => <AdvRow key={a.id} a={a} name={crew.find((c) => c.id === a.crew_id)?.name ?? "?"} />)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
function AdvRow({ a, name }: { a: Advance; name: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="rw" style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
      <span>เบิกวันนี้ · <b>{name}</b> {a.note ? <span className="muted">({a.note})</span> : null}</span>
      <span><b className="num">{fmt0(a.amt)}</b> <button type="button" className="lnk bad small" onClick={async () => { if (!armed) { setArmed(true); return; } const r = await deleteAdvance(a.id); if (r.error) toast(r.error, true); else toast("ลบรายการเบิกแล้ว"); }}>{armed ? "กดอีกครั้ง" : "ลบ"}</button></span>
    </div>
  );
}
function DelDay({ day, locked }: { day: string; locked: boolean }) {
  const [armed, setArmed] = useState(false);
  const router = useRouter();
  return (
    <button className="lnk bad small" type="button" style={{ marginTop: 8 }} onClick={async () => {
      if (locked) { toast("วันนี้มีคนที่จ่ายค่าแรงแล้ว ยกเลิกการจ่ายก่อนจึงลบได้", true); return; }
      if (!armed) { setArmed(true); return; }
      const r = await deleteDaily(day);
      if (r.error) toast(r.error, true); else { toast("ลบบันทึกวันที่ " + dS(day) + " แล้ว"); router.replace(`/daily?d=${day}&x=${Date.now()}`); }
    }}>{armed ? "กดอีกครั้งเพื่อยืนยันลบ" : "ลบบันทึกของวันนี้"}</button>
  );
}
