// คำนวณเงินของใบสั่งจ้าง: ราคาต่อ ตร.ม. ในใบสั่งจ้างรวม VAT แล้ว (ค่าเริ่มต้น)
export type RouteRow = { id?: string; code: string; descr: string; area: number | string; rate: number | string };

export const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const money = (v: unknown) => Math.round(num(v) * 100) / 100;
export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
export const lineAmt = (r: Pick<RouteRow, "area" | "rate">) => r2(num(r.area) * num(r.rate));

export function totals(routes: Pick<RouteRow, "area" | "rate">[], vatIncl = true) {
  const sum = r2(routes.reduce((s, r) => s + lineAmt(r), 0));
  const area = routes.reduce((s, r) => s + num(r.area), 0);
  const pre = vatIncl ? r2(sum / 1.07) : sum;
  const vat = vatIncl ? r2(sum - pre) : r2(sum * 0.07);
  const total = r2(pre + vat);
  const wht = r2(pre * 0.01); // ขทช. หัก ณ ที่จ่าย 1% จากยอดก่อน VAT
  return { n: routes.length, area, sum, pre, vat, total, wht, net: r2(total - wht) };
}

export const fmt = (n: number) => num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt0 = (n: number) => num(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const fmtKm = (n: number) => num(n).toLocaleString("en-US", { maximumFractionDigits: 3 });

const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
// "2026-01-05" -> "5 ม.ค. 2569"
export function thaiDate(iso: string | null | undefined) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${TH_M[m - 1]} ${y + 543}`;
}
export function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function todayBkk() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
export function dayDiff(from: string, to: string) {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}
export const hmdFull = (h: string | null | undefined) => (h ? `หมวดบำรุงทางหลวงชนบท${h}` : "ยังไม่ระบุหมวด");
