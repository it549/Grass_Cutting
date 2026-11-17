// คำนวณค่าแรงรายสัปดาห์ เบิกค้าง และรอบน้ำมัน (แบบเดียวกับระบบบน claude.ai) · ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์
import { type Advance, type CrewDay, type CrewRec, type Fuel, addDaysIso, num, payOf, r2, unitOf } from "@/lib/model";

export type LogLite = { date: string; crew: CrewDay[]; work: { r: string; km: number | null }[]; other?: number };
export type PayLite = { week_start: string; crew_id: string; pay_date: string; ded: number | null; name?: string; method?: "cash" | "pp" | "bank"; days?: number; gross?: number; ot?: number; net?: number };
export type WeekRow = {
  cid: string; name: string; days: Record<string, CrewDay>; units: number; gross: number; ot: number;
  carry: number; advWk: number; ded: number; net: number; left: number; paid: PayLite | null;
};

/** สรุปค่าแรงรายคนของสัปดาห์ (wk = จันทร์..อาทิตย์) */
export function weekPay(wk: string[], logs: LogLite[], adv: Advance[], pays: PayLite[], crew: CrewRec[]): WeekRow[] {
  const wk0 = wk[0], end = wk[6], P = new Map<string, WeekRow>();
  const nameOf = (id: string) => crew.find((c) => c.id === id)?.name || "(ไม่มีชื่อ)";
  const get = (id: string, name?: string) => {
    let p = P.get(id);
    if (!p) { p = { cid: id, name: name || nameOf(id), days: {}, units: 0, gross: 0, ot: 0, carry: 0, advWk: 0, ded: 0, net: 0, left: 0, paid: null }; P.set(id, p); }
    return p;
  };
  for (const d of wk) {
    const r = logs.find((x) => x.date === d);
    if (!r) continue;
    for (const c of r.crew) if (c.on && String(c.name || "").trim()) {
      const p = get(c.id || c.name, c.name);
      p.days[d] = c; p.units += unitOf(c); p.gross += payOf(c) - num(c.ot); p.ot += num(c.ot);
    }
  }
  for (const a of adv) if (a.adv_date >= wk0 && a.adv_date <= end) get(a.crew_id);
  for (const x of pays) if (x.week_start === wk0) get(x.crew_id, x.name);
  for (const p of P.values()) {
    const pd0 = pays.find((x) => x.week_start === wk0 && x.crew_id === p.cid) ?? null;
    const before = adv.filter((a) => a.crew_id === p.cid && a.adv_date < wk0).reduce((s, a) => s + num(a.amt), 0)
      - pays.filter((x) => x.crew_id === p.cid && x.week_start < wk0).reduce((s, x) => s + num(x.ded), 0);
    const inWk = adv.filter((a) => a.crew_id === p.cid && a.adv_date >= wk0 && a.adv_date <= end).reduce((s, a) => s + num(a.amt), 0);
    p.gross = r2(p.gross); p.ot = r2(p.ot);
    p.carry = r2(Math.max(0, before)); p.advWk = r2(inWk);
    const avail = p.carry + p.advWk;
    p.ded = pd0 ? num(pd0.ded) : r2(Math.min(avail, p.gross + p.ot));
    p.net = pd0 && pd0.net != null ? num(pd0.net) : r2(p.gross + p.ot - p.ded);
    p.left = r2(avail - p.ded); p.paid = pd0;
  }
  const order = crew.map((c) => c.id);
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? 999 : i; };
  return [...P.values()].sort((a, b) => rank(a.cid) - rank(b.cid));
}

/** เบิกค้างทั้งหมดของคนงาน (เบิกรวม − หักแล้วรวม) */
export const advLeft = (cid: string, adv: Advance[], pays: PayLite[]) =>
  r2(adv.filter((a) => a.crew_id === cid).reduce((s, a) => s + num(a.amt), 0) - pays.filter((x) => x.crew_id === cid).reduce((s, x) => s + num(x.ded), 0));

const dDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export type Cycle = { f: Fuel; open: boolean; days: number; work: number; km: number; dist: number; lpk: number; bpk: number; kpl: number; bpd: number; warn: boolean };

/** รอบน้ำมัน: นับจากวันที่เบิกถึงวันที่เบิกครั้งถัดไป (ตัดหญ้าเทียบกับ กม. ที่ตัด, รถเทียบกับเลขไมล์) */
export function fuelCycles(all: Fuel[], logs: LogLite[], kind: "mower" | "car", today: string, car?: string) {
  const L = all.filter((f) => f.kind === kind && (car === undefined || (f.car_id ?? "") === car))
    .sort((a, b) => a.log_date.localeCompare(b.log_date) || a.id.localeCompare(b.id));
  const out: Cycle[] = L.map((f, i) => {
    const nx = L[i + 1] ?? null, end = nx ? nx.log_date : null, to = end || addDaysIso(today, 1);
    const ds = logs.filter((d) => d.date >= f.log_date && d.date < to);
    const work = ds.filter((d) => d.crew.some((c) => c.on)).length;
    const km = ds.reduce((s, d) => s + d.work.reduce((t, w) => t + num(w.km), 0), 0);
    const days = Math.max(nx ? dDiff(f.log_date, end!) : dDiff(f.log_date, today) + 1, 1);
    const dist = kind === "car" && nx && num(f.odo) && num(nx.odo) > num(f.odo) ? num(nx.odo) - num(f.odo) : 0;
    return { f, open: !nx, days, work, km: r2(km), dist, lpk: km > 0 ? f.liters / km : 0, bpk: km > 0 ? f.amt / km : 0, kpl: dist && f.liters ? dist / f.liters : 0, bpd: f.amt / days, warn: false };
  });
  const closed = out.filter((c) => !c.open);
  const sumL = closed.reduce((s, c) => s + (kind === "mower" ? (c.km ? c.f.liters : 0) : c.dist ? c.f.liters : 0), 0);
  const sumK = closed.reduce((s, c) => s + (kind === "mower" ? c.km : c.dist), 0);
  const sumA = closed.reduce((s, c) => s + (kind === "mower" ? (c.km ? c.f.amt : 0) : c.f.amt), 0);
  const dd = closed.reduce((s, c) => s + c.days, 0);
  const avg = kind === "mower"
    ? { lpk: sumK ? sumL / sumK : 0, bpk: sumK ? sumA / sumK : 0, kpl: 0, bpd: 0 }
    : { lpk: 0, bpk: 0, kpl: sumL ? sumK / sumL : 0, bpd: dd ? closed.reduce((s, c) => s + c.f.amt, 0) / dd : 0 };
  for (const c of out) c.warn = !c.open && Boolean(kind === "mower" ? avg.lpk && c.lpk > avg.lpk * 1.3 : avg.kpl && c.kpl && c.kpl < avg.kpl * 0.77);
  return { list: out, avg };
}
