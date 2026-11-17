// ตัวช่วยจัดรูปแบบสำหรับเอกสารพิมพ์ (ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์)
import { num, r2 } from "@/lib/calc";

export const E = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

const MON = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const MOS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const pd = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
};
/** "5 ม.ค. 2569" */
export const dS = (s: string | null | undefined) => { const d = pd(s); return d ? `${d.d} ${MOS[d.m - 1]} ${d.y + 543}` : ""; };
/** "5 มกราคม 2569" */
export const dL = (s: string | null | undefined) => { const d = pd(s); return d ? `${d.d} ${MON[d.m - 1]} ${d.y + 543}` : ""; };
export const monthTitle = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${MON[m - 1]} ${y + 543}`; };
export const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
export const weekday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();

export const fmt = (n: unknown, d = 2) => num(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmt0 = (n: unknown) => fmt(n, 0);
export const fmtQ = (n: unknown) => (n === "" || n == null ? "" : Number.isInteger(num(n)) ? fmt0(n) : fmt(n));
export const fmtP = (n: unknown) => (n === "" || n == null ? "" : num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }));

export function bahtText(v: number) {
  const n = r2(v);
  if (!n) return "ศูนย์บาทถ้วน";
  const D = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  const P = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
  const six = (s: string, higher: boolean) => {
    let o = "";
    const L = s.length;
    for (let i = 0; i < L; i++) {
      const d = +s[i], p = L - i - 1;
      if (!d) continue;
      if (p === 0 && d === 1 && (higher || /[1-9]/.test(s.slice(0, i)))) o += "เอ็ด";
      else if (p === 1 && d === 2) o += "ยี่สิบ";
      else if (p === 1 && d === 1) o += "สิบ";
      else o += D[d] + P[p];
    }
    return o;
  };
  const read = (s0: string): string => {
    const s = s0.replace(/^0+/, "");
    if (!s) return "";
    if (s.length > 6) return read(s.slice(0, -6)) + "ล้าน" + six(s.slice(-6).replace(/^0+/, ""), true);
    return six(s, false);
  };
  const [b, st] = Math.abs(n).toFixed(2).split(".");
  const bt = read(b);
  return (n < 0 ? "ลบ" : "") + (bt ? bt + "บาท" : "") + (+st ? read(st) + "สตางค์" : "ถ้วน");
}

export const fileSafe = (s: string) => String(s).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
