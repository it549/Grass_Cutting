// อ่านใบสั่งจ้างจาก "ข้อความที่อยู่ใน PDF" โดยไม่ใช้ AI
// ใช้ได้เฉพาะ PDF ที่สร้างจากคอมพิวเตอร์ (export จาก Word/Excel) — PDF สแกนหรือรูปถ่ายไม่มีข้อความให้อ่าน
// แยกเป็นสองส่วน: pdfLines (ดึงข้อความเป็นบรรทัด) และ parsePoText (แยกข้อมูลจากบรรทัด) เพื่อทดสอบแยกกันได้
import type { ExtractedPO } from "@/lib/po-extract";

type Item = { str: string; x: number; y: number; w: number; h: number };

/** ดึงข้อความจาก PDF เป็นบรรทัด เรียงจากบนลงล่าง ซ้ายไปขวา (ทุกหน้าต่อกัน) */
export async function pdfLines(data: Uint8Array): Promise<string[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const items: Item[] = [];
    for (const it of tc.items) {
      if (!("str" in it) || !it.str) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 10 });
    }
    // จัดกลุ่มเป็นบรรทัดตามแนวตั้ง (ตัวอักษรไทยบางชิ้นถูกตัดเป็นหลายชิ้นที่ y ใกล้กัน)
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: Item[][] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= Math.max(2, r[0].h * 0.35));
      if (row) row.push(it);
      else rows.push([it]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      let s = "";
      let end = -Infinity;
      for (const it of row) {
        // เว้นวรรคเมื่อชิ้นข้อความห่างกันพอสมควร (เช่น ข้ามคอลัมน์ในตาราง)
        if (s && it.x - end > it.h * 0.25 && !s.endsWith(" ") && !it.str.startsWith(" ")) s += " ";
        s += it.str;
        end = Math.max(end, it.x + it.w);
      }
      s = s.replace(/\s+/g, " ").trim();
      if (s) out.push(s);
    }
  }
  return out;
}

const TH_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
/** เลขไทย → อารบิก, นิคหิต+สระอา → สระอำ (PDF มักเก็บ "ำ" แยกเป็นสองตัว), ช่องว่างซ้ำ
 *  วรรณยุกต์ที่อยู่เหนือสระบน (ที่ สั่ง) ฟอนต์บางตัวใช้รูปพิเศษที่ PDF ไม่บอกว่าเป็นตัวอะไร → ได้ \0 มา
 *  ให้เป็นไม้เอก (พบบ่อยที่สุด: ที่ สั่ง ซึ่ง เพิ่ม) — คำที่เป็นไม้โทจะผิดเล็กน้อยแต่ไม่กระทบตัวเลข */
export function normTh(s: string) {
  return s
    .replace(/[๐-๙]/g, (d) => String(TH_DIGITS.indexOf(d)))
    .replace(/\u0000/g, "่")
    .replace(/ํ([่-๋]?)า/g, "$1ำ")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS: [RegExp, number][] = [
  [/^(มกราคม|ม\.ค\.?)$/, 1], [/^(กุมภาพันธ์|ก\.พ\.?)$/, 2], [/^(มีนาคม|มี\.ค\.?)$/, 3], [/^(เมษายน|เม\.ย\.?)$/, 4],
  [/^(พฤษภาคม|พ\.ค\.?)$/, 5], [/^(มิถุนายน|มิ\.ย\.?)$/, 6], [/^(กรกฎาคม|ก\.ค\.?)$/, 7], [/^(สิงหาคม|ส\.ค\.?)$/, 8],
  [/^(กันยายน|ก\.ย\.?)$/, 9], [/^(ตุลาคม|ต\.ค\.?)$/, 10], [/^(พฤศจิกายน|พ\.ย\.?)$/, 11], [/^(ธันวาคม|ธ\.ค\.?)$/, 12],
];
const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (d: number, m: number, y: number) => {
  if (y > 2400) y -= 543; // พ.ศ. → ค.ศ.
  if (y < 100) y += y > 50 ? 1957 : 2000; // ปีสองหลัก เช่น 69 → 2026 (พ.ศ. 2569)
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y > 1990 && y < 2100)) return "";
  return `${y}-${pad(m)}-${pad(d)}`;
};
/** หาวันที่แรกในข้อความ: "15 ตุลาคม 2568", "15 ต.ค. 68", "15/10/2568" */
export function findDate(s: string): string {
  const a = s.match(/(\d{1,2})\s*([ก-๙.]+?)\s*(\d{2,4})(?!\d)/g) ?? [];
  for (const m of a) {
    const r = m.match(/(\d{1,2})\s*([ก-๙.]+?)\s*(\d{2,4})$/);
    if (!r) continue;
    const mon = MONTHS.find(([re]) => re.test(r[2]))?.[1];
    if (mon) {
      const v = toYmd(+r[1], mon, +r[3]);
      if (v) return v;
    }
  }
  const n = s.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})(?!\d)/);
  return n ? toYmd(+n[1], +n[2], +n[3]) : "";
}

const num = (s: string) => Number(s.replace(/,/g, ""));
// รหัสสายทาง เช่น ชบ.3083 / ชบ. 3083 (ไม่นับที่อยู่ติดตัวอักษรหรือจุด เช่น ทช.ชบ.3083 ในชื่อสาย)
const CODE = /(?<![ก-ฮ.])([ก-ฮ]{1,3})\.\s?(\d{3,5})(?!\d)/;
const CODE_G = new RegExp(CODE.source, "g");
// บรรทัดที่เริ่มแถวใหม่ในตาราง: [ลำดับ] [สาย/สายทาง] รหัส
const ROW_START = /^(?:\d{1,3}[.)]?\s+)?(สาย(?:ทาง)?(?:หมายเลข)?\s*)?([ก-ฮ]{1,3})\.\s?(\d{3,5})(?!\d)/;
// ทางหลวงที่มักอยู่ในชื่อสาย ไม่ใช่รหัสสายของใบสั่งจ้าง
const NOT_ROW = /^(ทล|ทช)$/;
const TABLE_END = /^(รวมเป็นเงิน|รวมทั้งสิ้น|รวมเงิน|รวม\s|รวม$|ราคารวม|เงื่อนไข|หมายเหตุ)/;
const isTh = (c: string) => /[฀-๿]/.test(c);

const UNIT = /(?:ตร\.?\s?ม\.?|ตารางเมตร|บาท)(?=\s|$)/g;
// รหัสทางทุกแบบในชื่อสาย เช่น ทล.3 ทล.331 ชบ.3083 (ตัวเลขติดกับจุด)
const ANY_CODE = /[ก-ฮ]{1,3}\.\d+/g;
/** แยกตัวเลขในแถว (ไม่นับเลขที่เป็นส่วนของรหัสสาย) */
function rowNumbers(s: string) {
  return (s.replace(UNIT, " ").replace(CODE_G, " ").replace(ANY_CODE, " ").match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(num).filter((v) => !Number.isNaN(v));
}
/** หา (พื้นที่, ราคาต่อหน่วย) จากตัวเลขในแถว: เลือกสามตัวติดกันที่ พื้นที่ × ราคา ≈ จำนวนเงิน */
function areaRate(nums: number[], text: string): { area: number; rate: number } {
  for (let i = 0; i + 2 < nums.length; i++) {
    const [a, r, t] = nums.slice(i, i + 3);
    if (a > 0 && r > 0 && Math.abs(a * r - t) <= Math.max(1, t * 0.001)) return { area: a, rate: r };
  }
  // ไม่มีจำนวนเงิน: ใช้ "<พื้นที่> ตร.ม. <ราคา>"
  const m = text.replace(CODE_G, " ").match(/(\d[\d,]*(?:\.\d+)?)\s*(?:ตร\.?\s?ม\.?|ตารางเมตร)\s*(\d[\d,]*(?:\.\d+)?)?/);
  if (m) return { area: num(m[1]), rate: m[2] ? num(m[2]) : 0 };
  return { area: 0, rate: 0 };
}
/** ชื่อสาย = ข้อความในแถวที่เหลือหลังตัดลำดับ ตัวเลขพื้นที่/ราคา และหน่วยออก (รหัสในชื่อสายยังอยู่ครบ) */
function rowDescr(lines: string[]) {
  const parts = lines
    .map((l) => {
      // กันรหัสทางไว้ด้วยอักขระพิเศษที่ไม่มีตัวเลข แล้วค่อยลบตัวเลขที่เหลือ
      const keep: string[] = [];
      const hold = (m: string) => String.fromCharCode(0xe000 + keep.push(m) - 1);
      l = l.replace(UNIT, " ").replace(CODE_G, (m) => hold(m.replace(/\s/g, ""))).replace(ANY_CODE, hold);
      l = l.replace(/\d[\d,]*(?:\.\d+)?/g, " ");
      return l.replace(/[-]/g, (c) => keep[c.charCodeAt(0) - 0xe000]).replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
  let s = "";
  for (const p of parts) {
    // ชื่อสายภาษาไทยที่ขึ้นบรรทัดใหม่กลางคำ ("บ้านหนอง" + "ปลาไหล") ต่อกันโดยไม่เว้นวรรค
    s = !s ? p : isTh(s.at(-1)!) && isTh(p[0]) ? s + p : s + " " + p;
  }
  return s.replace(/^\d{1,3}[.)]?\s+/, "").replace(/\s*-\s*$/, "").trim();
}

/** แยกข้อมูลใบสั่งจ้างจากบรรทัดข้อความ คืนรูปแบบเดียวกับที่ AI คืน (ช่องที่หาไม่พบเป็นค่าว่าง) */
export function parsePoText(raw: string[]): ExtractedPO {
  const lines = raw.map(normTh).filter(Boolean);
  const all = lines.join("\n");
  const pick = (re: RegExp) => all.match(re)?.[1]?.trim() ?? "";

  const no = pick(/(?:ใบสั่งจ้าง\s*)?เลขที่\s*(?!โครงการ)[:：]?\s*(\d{1,5}\s*\/\s*\d{2,4})/).replace(/\s/g, "");
  const projNo = pick(/เลขที่โครงการ\s*[:：]?\s*([A-Za-z0-9-]{5,})/);
  // วันที่ใบสั่งจ้าง: บรรทัดแรกที่มี "วันที่" และไม่ใช่เรื่องกำหนดส่งมอบ
  const dateLine = lines.find((l) => /วันที่/.test(l) && !/ครบกำหนด|ส่งมอบ|นับถัด|ภายใน/.test(l)) ?? "";
  const date = findDate(dateLine.slice(dateLine.indexOf("วันที่")));
  const dueLine = lines.find((l) => /ครบกำหนด/.test(l)) ?? "";
  const dueDate = findDate(dueLine);
  const dd = pick(/ภายใน\s*(\d{1,4})\s*วัน/);
  const dueDays = dd ? Number(dd) : null;

  const agency = (pick(/ส่วนราชการ\s*[:：]?\s*([^\n(]+)/) || pick(/((?:แขวงทางหลวง|สำนักงานทางหลวง|องค์การบริหารส่วน|เทศบาล)[^\n(,]*)/))
    .replace(/\s+(ซึ่ง|ได้|โดย|หมวด).*$/, "").trim();
  const hmd = pick(/หมวด(?:บำรุงทางหลวงชนบท|บำรุงทางหลวง|บำรุงทาง|ทางหลวงชนบท|ฯ)?\s*((?!บำรุง)[ก-๙]+)/);
  const vatIncl = !/ไม่รวมภาษี/.test(all);

  // ค่าปรับ: ตั้งแต่คำว่า "ค่าปรับ" ต่อบรรทัดถัดไปจนถึงข้อใหม่/ลายเซ็น
  let penalty = "";
  const pi = lines.findIndex((l) => /ค่าปรับ/.test(l));
  if (pi >= 0) {
    const parts = [lines[pi].slice(lines[pi].indexOf("ค่าปรับ"))];
    for (let i = pi + 1; i < lines.length && parts.length < 4; i++) {
      if (/^(\d{1,2}[.)]|ลงชื่อ|\()/.test(lines[i])) break;
      parts.push(lines[i]);
    }
    penalty = parts.join(" ").replace(/\s+/g, " ").trim();
  }

  // ตาราง: เริ่มที่แถวแรกที่มีรหัสสาย จบที่บรรทัดรวมเงิน
  const segs: string[][] = [];
  for (const l of lines) {
    const m = l.match(ROW_START);
    const starts = m && (m[1] || !NOT_ROW.test(m[2]));
    if (starts) segs.push([l]);
    else if (segs.length) {
      if (TABLE_END.test(l)) break;
      segs.at(-1)!.push(l);
    }
  }
  const routes = segs.map((seg) => {
    const m = seg[0].match(ROW_START)!;
    const text = seg.join(" ");
    const { area, rate } = areaRate(rowNumbers(text.replace(ROW_START, " ")), text);
    return { code: `${m[2]}.${m[3]}`, descr: rowDescr(seg), area, rate };
  });

  return { no, date, projNo, dueDays, dueDate, agency, hmd, vatIncl, penalty, routes };
}
