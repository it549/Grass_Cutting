// ตรรกะหลักของงาน (ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และหน้าเว็บ) ยกมาจากระบบบน claude.ai
// งวด = แขวง + ปีงบประมาณ + งวดที่ · แต่ละหมวดเป็น 1 ใบสั่งจ้าง (Order) ที่อาจยังเป็นแค่แผน (ยังไม่มีเลขใบสั่งจ้าง)

export type Agency = { id: string; name: string; short_name: string | null; hmds: string[]; address?: string | null; director?: string | null; photo_lr?: boolean };
export type Road = { id: string; agency_id: string; hmd: string; code: string; name: string; amp: string; len_km: number | null; map_url: string | null; note: string };
export type Route = {
  id: string; order_id: string; seq: number; code: string; descr: string; area: number; rate: number | null;
  road_id: string | null; in_po: boolean; length_km: number | null; done: boolean | null; done_date: string | null;
};
export type Order = {
  id: string; agency_id: string; fy: number; round_no: number; hmd: string; start_date: string | null;
  po_no: string | null; po_date: string | null; proj_no: string | null; due_days: number | null; due_date: string | null;
  penalty: string | null; vat_incl: boolean; note: string | null; po_file_path: string | null; created_at: string;
  routes: Route[];
};
export type WorkItem = { r: string; km: number | null; fin?: boolean };
export type DayWork = { date: string; work: WorkItem[] };
/** รูปของสาย: b/a = จำนวนรูปชนิดก่อน/หลัง · n = รูปทั้งหมด (รวมในถาด) · sl = ช่องที่วางรูปแล้ว เช่น "b|500" */
export type PicStat = { b: number; a: number; n: number; first: string; last: string; sl: string[] };
export type RoundKey = { ag: string; fy: number; no: number };

export const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
export const fmtKm = (n: number) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
export const fmt0 = (n: number) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
export const cNorm = (s: unknown) => String(s ?? "").replace(/[\s.\-]/g, "").toLowerCase();
export const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** ปีงบประมาณไทย (ต.ค.–ก.ย.) */
export const fyOf = (iso: string | null | undefined) => {
  if (!iso) return 0;
  const [y, m] = iso.split("-").map(Number);
  return y ? y + 543 + (m >= 10 ? 1 : 0) : 0;
};
export const hmdName = (h: string | null | undefined) => (h ? "หมวด" + h : "ไม่ระบุหมวด");
export const rkName = (k: Pick<RoundKey, "no" | "fy">) => "งวด " + k.no + (k.fy ? "/" + k.fy : "");
export const rkOf = (o: Pick<Order, "agency_id" | "fy" | "round_no">): RoundKey => ({ ag: o.agency_id, fy: o.fy, no: o.round_no });
export const rkSame = (a: RoundKey | null | undefined, b: RoundKey | null | undefined) => !!a && !!b && a.ag === b.ag && a.fy === b.fy && a.no === b.no;
export const rkQuery = (k: RoundKey) => `ag=${k.ag}&fy=${k.fy}&no=${k.no}`;
export const hasPo = (o: Pick<Order, "po_no"> | null | undefined) => !!(o && o.po_no);
/** สายที่อยู่ในใบสั่งจ้าง (ใช้ทำเอกสาร) */
export const poRoutes = (o: Order) => o.routes.filter((r) => r.in_po !== false);

const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** 14 พ.ย. 2569 */
export const dS = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return y ? `${d} ${TH_MON[m - 1]} ${y + 543}` : "";
};
export const dShort = (iso: string | null | undefined) => dS(iso).replace(/ \d{4}$/, "");
export const dateRange = (a: string, b: string) => {
  if (!a) return "–";
  if (!b || a === b) return dShort(a);
  const sameMon = a.slice(0, 7) === b.slice(0, 7);
  return `${Number(a.slice(8, 10))}${sameMon ? "" : " " + dS(a).split(" ")[1]}–${dShort(b)}`;
};

export type World = {
  agencies: Agency[];
  roads: Road[];
  orders: Order[];
  days: DayWork[];
  pics: Record<string, PicStat>; // route_id → จำนวนรูป
};

export const agOf = (W: World, id: string) => W.agencies.find((a) => a.id === id) ?? W.agencies[0];
export const hIdx = (A: Agency | undefined, h: string) => { const i = (A?.hmds ?? []).indexOf(h || ""); return i < 0 ? 99 : i; };

export function roundOf(W: World, k: RoundKey) {
  const A = agOf(W, k.ag);
  return W.orders.filter((o) => o.agency_id === k.ag && o.fy === k.fy && o.round_no === k.no).sort((a, b) => hIdx(A, a.hmd) - hIdx(A, b.hmd));
}
export function roundKeys(W: World, ag?: string) {
  const m = new Map<string, RoundKey>();
  for (const o of W.orders) { if (ag && o.agency_id !== ag) continue; const k = rkOf(o); m.set(`${k.ag}~${k.fy}~${k.no}`, k); }
  const L = W.agencies;
  return [...m.values()].sort((p, q) => L.findIndex((a) => a.id === p.ag) - L.findIndex((a) => a.id === q.ag) || q.fy - p.fy || q.no - p.no);
}
/** ช่องหมวดของงวด: ทุกหมวดของแขวงตามลำดับ + หมวดอื่นที่มีอยู่ในงวด */
export function roundSlots(W: World, k: RoundKey) {
  const xs = roundOf(W, k), A = agOf(W, k.ag), hs = [...(A?.hmds ?? [])];
  for (const o of xs) if (!hs.includes(o.hmd || "")) hs.push(o.hmd || "");
  const out: { h: string; o: Order | null }[] = [];
  for (const h of hs) { const L = xs.filter((o) => (o.hmd || "") === h); if (L.length) L.forEach((o) => out.push({ h, o })); else if (h) out.push({ h, o: null }); }
  return out;
}

export const regFind = (W: World, ag: string, code: string) => W.roads.find((g) => g.agency_id === ag && cNorm(g.code) === cNorm(code));
export const regOf = (W: World, o: Order, r: Route) => (r.road_id && W.roads.find((g) => g.id === r.road_id)) || regFind(W, o.agency_id, r.code) || null;

/** ดัชนีงานรายวันต่อสาย: กม. สะสม วันที่ทำ วันที่จบ */
export function workIndex(days: DayWork[]) {
  const idx = new Map<string, { km: number; days: string[]; fin: string }>();
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const w of d.work || []) {
      const x = idx.get(w.r) ?? { km: 0, days: [], fin: "" };
      if (w.km != null && String(w.km) !== "") x.km += num(w.km);
      if (!x.days.includes(d.date)) x.days.push(d.date);
      if (w.fin && !x.fin) x.fin = d.date;
      idx.set(w.r, x);
    }
  }
  return idx;
}

export type PhCount = { n: number; N: number; pts: number };
export type RInfo = {
  L: number; km: number; cut: boolean; pics: boolean; b: number; a: number; fin: string; finDate: string; first: string; last: string;
  s: "done" | "cut" | "wip" | "todo";
  /** รูปรายงานตาม กม. (มีเมื่อรู้ความยาวสาย) */
  ph: { ba: PhCount; lr: PhCount; lrNeed: boolean } | null;
};

// ---------- รูปรายงานตาม กม. (v34) ----------
export type PfKind = "ba" | "lr";
export const PF: Record<PfKind, { step: number; cols: [string, string, string][]; name: string; every: string }> = {
  ba: { step: 500, cols: [["b", "ก่อนดำเนินการ", "ก่อน"], ["a", "หลังดำเนินการ", "หลัง"]], name: "ก่อน / หลังดำเนินการ", every: "ทุก 500 ม." },
  lr: { step: 250, cols: [["L", "ด้านซ้ายทาง", "ซ้าย"], ["R", "ด้านขวาทาง", "ขวา"]], name: "สำรวจ ซ้าย / ขวาทาง", every: "ทุก 250 ม." },
};
export const kmTxt = (m: number) => `${Math.floor(m / 1000)}+${String(Math.round(m % 1000)).padStart(3, "0")}`;
/** จุดถ่ายรูป (เมตร): 0, step, 2·step … และปลายสายพอดี */
export function stations(L: number | null | undefined, step: number) {
  const Lm = Math.round(num(L) * 1000);
  if (!(Lm > 0)) return [] as number[];
  const out: number[] = [];
  for (let m = 0; m < Lm; m += step) out.push(m);
  out.push(Lm);
  return out;
}
export function pfCount(sl: Iterable<string>, L: number, f: PfKind): PhCount {
  const have = new Set(sl), ps = stations(L, PF[f].step);
  let n = 0;
  for (const m of ps) for (const [c] of PF[f].cols) if (have.has(c + "|" + m)) n++;
  return { n, N: ps.length * 2, pts: ps.length };
}
const lrCache = new WeakMap<World, Map<string, boolean>>();
/** แขวงของใบสั่งจ้างนี้ต้องมีแบบสำรวจซ้าย/ขวาด้วยไหม */
export function needLR(W: World, orderId: string) {
  let m = lrCache.get(W);
  if (!m) {
    m = new Map();
    const ag = new Map(W.agencies.map((a) => [a.id, !!a.photo_lr]));
    for (const o of W.orders) m.set(o.id, ag.get(o.agency_id) ?? false);
    lrCache.set(W, m);
  }
  return m.get(orderId) ?? false;
}
export const R_ST: Record<RInfo["s"], [string, string]> = { done: ["ครบ", "g"], cut: ["ตัดครบ รอรูป", "w"], wip: ["กำลังตัด", "b"], todo: ["ยังไม่เริ่ม", "nd"] };

export function rInfo(W: World, wi: ReturnType<typeof workIndex>, r: Route): RInfo {
  const L = num(r.length_km), x = wi.get(r.id), km = x?.km ?? 0, P = W.pics[r.id] ?? { b: 0, a: 0, n: 0, first: "", last: "", sl: [] };
  const fin = x?.fin ?? "", cut = !!fin || (L > 0 && km >= L - 1e-9);
  const days = x?.days ?? [];
  const finDate = fin || (cut ? days[days.length - 1] || "" : "");
  // รูปครบ: รู้ความยาวสาย = ช่องก่อน/หลังครบทุกจุด (+ ซ้าย/ขวา ถ้าแขวงนี้ต้องใช้) · ยังไม่รู้ความยาว = มีทั้งรูปก่อนและหลัง (เกณฑ์เดิม)
  let pics = P.b > 0 && P.a > 0, ph: RInfo["ph"] = null;
  if (L > 0) {
    const lrNeed = needLR(W, r.order_id), ba = pfCount(P.sl, L, "ba"), lr = pfCount(P.sl, L, "lr");
    pics = ba.n === ba.N && (!lrNeed || lr.n === lr.N);
    ph = { ba, lr, lrNeed };
  }
  return {
    L, km, cut, pics, b: P.b, a: P.a, fin, finDate, first: days[0] || P.first || "", last: days[days.length - 1] || "",
    s: cut && pics ? "done" : cut ? "cut" : km > 0 || P.n > 0 || days.length ? "wip" : "todo",
    ph,
  };
}
export function orderAgg(W: World, wi: ReturnType<typeof workIndex>, o: Order) {
  const rs = o.routes.map((r) => rInfo(W, wi, r));
  return {
    n: rs.length, cut: rs.filter((x) => x.cut).length, pics: rs.filter((x) => x.pics).length, done: rs.filter((x) => x.s === "done").length,
    km: rs.reduce((s, x) => s + Math.min(x.km, x.L || x.km), 0), L: rs.reduce((s, x) => s + x.L, 0), started: rs.some((x) => x.s !== "todo"),
  };
}
/** งวดที่กำลังทำ: งวดแรกที่ยังตัดไม่ครบ ไม่งั้นงวดล่าสุด */
export function currentRound(W: World, wi: ReturnType<typeof workIndex>, ag?: string) {
  const ks = roundKeys(W, ag);
  return ks.find((k) => roundOf(W, k).some((o) => { const g = orderAgg(W, wi, o); return g.done < g.n; })) || ks[0] || null;
}
export function rkStat(W: World, wi: ReturnType<typeof workIndex>, k: RoundKey) {
  const sl = roundSlots(W, k), xs = sl.filter((s) => s.o).map((s) => s.o as Order);
  let n = 0, cut = 0;
  for (const o of xs) { const g = orderAgg(W, wi, o); n += g.n; cut += g.cut; }
  const po = sl.filter((s) => s.o && hasPo(s.o)).length, tot = sl.length, miss = po < tot;
  const st = n && cut >= n && !miss ? "done" : miss ? "miss" : "cut";
  return { po, tot, n, cut, st, pc: n ? Math.round((cut / n) * 100) : 0, txt: st === "done" ? "ครบ" : miss ? (po ? `ขาดใบสั่งจ้าง ${tot - po}` : "ยังไม่มีใบสั่งจ้าง") : `ตัด ${cut}/${n}` };
}
export const RK_COL: Record<string, string> = { done: "var(--acc)", cut: "#5b8bd6", miss: "#e9b56b" };

/** รวมเลขใบสั่งจ้างที่ Claude อ่านได้เข้ากับแผนของหมวด: จับคู่ตามเลขสาย */
export function mergePo(plan: Route[], read: { code: string; descr: string; area: number; rate: number }[]) {
  const used = new Set<string>(), out: (Partial<Route> & { code: string; descr: string; area: number; rate: number; in_po: boolean })[] = [], extra: string[] = [];
  for (const p of read) {
    const m = plan.find((x) => !used.has(x.id) && (cNorm(x.code) === cNorm(p.code) || (digits(x.code) && digits(x.code) === digits(p.code))));
    if (m) { used.add(m.id); out.push({ ...m, code: m.code || p.code, descr: p.descr || m.descr, area: p.area, rate: p.rate, in_po: true }); }
    else { out.push({ ...p, in_po: true }); extra.push(p.code); }
  }
  const missing = plan.filter((x) => !used.has(x.id));
  const routes = [...out, ...missing.map((x) => ({ ...x, rate: x.rate ?? 0, in_po: false }))];
  const note = `Claude อ่านได้ ${read.length} สาย ตรงกับแผน ${out.length - extra.length} สาย`
    + (extra.length ? ` · มีในใบสั่งจ้างแต่ไม่อยู่ในแผน: ${extra.join(", ")}` : "")
    + (missing.length ? ` · อยู่ในแผนแต่ไม่มีในใบสั่งจ้าง: ${missing.map((x) => x.code).join(", ")} (จะไม่ขึ้นในเอกสาร)` : "")
    + " · ตรวจกับใบสั่งจ้างจริงก่อนบันทึก";
  return { routes, note, warn: !!(extra.length || missing.length) };
}

/** ตัวย่อจังหวัดของเลขสายในแขวง เช่น ชบ. */
export function codePrefix(W: World, ag: string) {
  const c: Record<string, number> = {};
  for (const g of W.roads.filter((x) => x.agency_id === ag)) { const m = /^([ก-ฮ]{1,3})\.?/.exec(String(g.code || "").trim()); if (m) c[m[1]] = (c[m[1]] ?? 0) + 1; }
  const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] + "." : "";
}
export const kmText = (v: unknown) => { let t = String(v ?? "").trim().replace(/\s/g, ""); if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", "."); return t.replace(/,/g, ""); };
export const mapSearch = (g: Road, A?: Agency) =>
  "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([g.code, g.name, g.amp ? "อ." + g.amp : "", A?.short_name || ""].filter(Boolean).join(" "));

// ---------- คนงานและค่าแรง ----------
export type CrewDay = { id: string; name: string; wage?: number | null; ot?: number | null; on: boolean; half?: boolean };
export type CrewRec = {
  id: string; name: string; nick: string; role: string; phone: string; wage: number | null; pay_by: "cash" | "pp" | "bank" | null; pay_no: string | null;
  start_date: string | null; note: string; active: boolean; sort: number;
};
export type DayRec = { date: string; work: { r: string; km: number | null; fin?: boolean }[]; crew: CrewDay[]; fuel: number; fuel_car: number; water: number; other: number; note: string };
export type Fuel = { id: string; log_date: string; kind: "mower" | "car"; liters: number; price: number; amt: number; crew_id: string | null; by_name: string; car_id: string | null; car_plate: string; odo: number | null; note: string; pic_path: string | null };
export type Car = { id: string; plate: string; name: string; fuel_type?: string; note: string; active: boolean; sort: number };
export type Advance = { id: string; crew_id: string; adv_date: string; amt: number; note: string };
export type Pay = { week_start: string; crew_id: string; name: string; pay_date: string; method: "cash" | "pp" | "bank"; days: number; gross: number; ot: number; ded: number; net: number };

/** ค่าแรงของคนในวันนั้น: ครึ่งวันคิดครึ่งหนึ่ง + OT */
export const payOf = (c: CrewDay | null | undefined) => (c && c.on ? (c.half ? num(c.wage) / 2 : num(c.wage)) + num(c.ot) : 0);
export const unitOf = (c: CrewDay | null | undefined) => (c && c.on ? (c.half ? 0.5 : 1) : 0);
export const fmtN = (n: number) => { const f = Math.floor(n), h = n - f >= 0.5; return (f || !h ? String(f) : "") + (h ? "½" : ""); };
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const PAYBY: Record<string, string> = { cash: "เงินสด", pp: "พร้อมเพย์", bank: "โอนเข้าบัญชี" };
export const payText = (c: Pick<CrewRec, "pay_by" | "pay_no"> | null | undefined) =>
  !c ? "" : c.pay_by === "pp" ? "พร้อมเพย์ " + (c.pay_no || "") : c.pay_by === "bank" ? c.pay_no || "โอนเข้าบัญชี" : "เงินสด";
export const FK: Record<string, string> = { mower: "เครื่องตัดหญ้า", car: "รถเดินทาง" };
export const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
export const WDL = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export const addDaysIso = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const wdOf = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();
/** จันทร์–อาทิตย์ของสัปดาห์ที่มีวันนี้ */
export const weekOf = (iso: string) => { const k = (wdOf(iso) + 6) % 7, a = addDaysIso(iso, -k); return [0, 1, 2, 3, 4, 5, 6].map((i) => addDaysIso(a, i)); };
export const dayN = (iso: string) => Number(iso.slice(8, 10));
