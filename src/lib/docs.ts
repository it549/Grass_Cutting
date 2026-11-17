// แบบข้อมูลเอกสาร (ใบเสนอราคา หนังสือส่งมอบงาน ใบกำกับภาษี/ใบเสร็จ) และค่าตั้งต้น
import { addDays, hmdFull, num, r2, todayBkk } from "@/lib/calc";
import { dL, dS } from "@/lib/print/fmt";
import type { Company } from "@/lib/types";

export type DocKind = "qt" | "dl" | "rc";
export type DocStatus = "draft" | "issued" | "void";
export const KIND: Record<DocKind, { p: string; t: string; en: string; short: string }> = {
  qt: { p: "GQT", t: "ใบเสนอราคา", en: "Quotation", short: "ใบเสนอราคา" },
  dl: { p: "GDL", t: "หนังสือส่งมอบงาน", en: "", short: "หนังสือส่งมอบงาน" },
  rc: { p: "GRC", t: "ใบกำกับภาษี / ใบเสร็จรับเงิน", en: "Tax Invoice / Receipt", short: "ใบกำกับภาษี/ใบเสร็จ" },
};
export const STATUS_LABEL: Record<DocStatus, [string, string]> = { draft: ["ฉบับร่าง", "s1"], issued: ["ออกแล้ว", "s2"], void: ["ยกเลิก", "s0"] };

export type Head = { name: string; address: string; taxId: string; branch: string; phone: string; email: string; logo: string; noLogo?: boolean };
export type Item = { desc: string; qty: number | ""; unit: string; price: number | "" };
export type DocData = {
  kind: DocKind;
  no: string;
  date: string;
  status: DocStatus;
  title: string;
  en: string;
  copy: string;
  dateLabel?: string;
  head: Head;
  party: { label: string; name: string; address: string; phone: string; tax: string };
  items: Item[];
  vatIncl: boolean;
  wht: number | "";
  words: string;
  intro: string;
  info: [string, string][];
  notes: { h: string; t: string }[];
  sign: { label: string; name: string }[];
  layout?: "letter";
  listStyle?: "lines" | "table";
  subject?: string;
  to?: string;
  ref?: string;
  encl?: string;
  p1?: string;
  p2?: string;
  p3?: string;
  closing?: string;
  signName?: string;
  signTitle?: string;
  contact?: string;
  noContact?: boolean;
  voidReason?: string;
  replaces?: string;
};

export const itAmt = (it: Pick<Item, "qty" | "price">) => r2(num(it.qty) * num(it.price));
export function docTotals(d: Pick<DocData, "items" | "vatIncl" | "wht">) {
  const sum = r2((d.items || []).reduce((s, it) => s + itAmt(it), 0));
  const vi = d.vatIncl !== false;
  const total = vi ? sum : r2(sum * 1.07);
  const pre = vi ? r2(sum / 1.07) : sum;
  const vat = r2(total - pre);
  const wht = r2((pre * num(d.wht)) / 100);
  return { sum, total, pre, vat, wht, net: r2(total - wht) };
}

export const coHead = (c: Company): Head => ({
  name: c.name ?? "",
  address: c.address ?? "",
  taxId: c.tax_id ?? "",
  branch: c.branch ?? "",
  phone: c.phone ?? "",
  email: c.email ?? "",
  logo: c.logo_path ?? "",
});

export type RouteLite = { code: string; descr: string; area: number; rate: number };
export const routeItems = (rs: RouteLite[]): Item[] =>
  rs.map((r) => ({ desc: `จ้างเหมาบริการงานตัดหญ้าสาย ${r.code} แยก${r.descr}`, qty: num(r.area), unit: "ตารางเมตร", price: num(r.rate) }));
export const letterItems = (rs: RouteLite[]): Item[] =>
  rs.map((r) => ({ desc: `จ้างเหมาบริการตัดหญ้า สาย ${r.code} แยก${r.descr}`, qty: num(r.area), unit: "ตารางเมตร", price: num(r.rate) }));

export type DocOrderCtx = {
  round_no: number;
  hmd: string;
  po_no: string | null;
  po_date: string | null;
  proj_no: string | null;
  due_days: number | null;
  due_date: string | null;
  vat_incl: boolean;
  routes: RouteLite[];
  lastDone: string | null;
};
export type DocAgencyCtx = { name: string; address: string | null; phone: string | null; tax_id: string | null; director: string | null };

/** วันที่ตั้งต้นของเอกสารแต่ละประเภท */
export function defaultDate(kind: DocKind, o: DocOrderCtx) {
  if (kind === "qt") return o.po_date || todayBkk();
  if (kind === "dl") return o.lastDone || todayBkk();
  return todayBkk();
}

export function newDoc(kind: DocKind, no: string, date: string, c: Company, A: DocAgencyCtx, o: DocOrderCtx, dlNo?: string | null): DocData {
  const K = KIND[kind];
  const bank = {
    h: "ชำระเงินโดยโอนเข้าบัญชี",
    t: `ธนาคาร ${c.bank_name || "........................"} เลขที่บัญชี ${c.bank_account_no || "........................"}\nชื่อบัญชี ${c.bank_account_name || c.name}`,
  };
  const d: DocData = {
    kind, no, date, status: "draft", title: K.t, en: K.en, copy: "ต้นฉบับ", head: coHead(c),
    party: { label: kind === "dl" ? "ผู้รับมอบงาน" : "ลูกค้า / Customer", name: A.name, address: A.address ?? "", phone: A.phone ?? "", tax: kind === "rc" ? A.tax_id ?? "" : "" },
    items: routeItems(o.routes), vatIncl: o.vat_incl !== false, wht: kind === "rc" ? 1 : 0, words: "", intro: "", info: [], notes: [], sign: [],
  };
  const ref = `ใบสั่งจ้างเลขที่ ${o.po_no || "–"}`;
  const hm: [string, string][] = o.hmd ? [["หมวด", hmdFull(o.hmd)]] : [];
  const signer = c.signer_name ?? "";
  if (kind === "qt") {
    d.info = [["ยืนราคาถึง", dS(addDays(date, 60))], ["อ้างอิง", ref], ["โครงการ", `จ้างเหมาบริการงานตัดหญ้า ${o.routes.length} สายทาง`], ["เลขที่โครงการ", o.proj_no || ""], ...hm];
    d.notes = [bank, { h: "หมายเหตุ", t: `${d.vatIncl ? "ราคาต่อหน่วยรวมภาษีมูลค่าเพิ่มแล้ว" : "ราคายังไม่รวมภาษีมูลค่าเพิ่ม"}${o.due_days ? ` · ส่งมอบภายใน ${o.due_days} วัน นับถัดจากวันที่ได้รับใบสั่งจ้าง` : ""}` }];
    d.sign = [{ label: "ผู้เสนอราคา", name: signer }, { label: "ผู้อนุมัติสั่งจ้าง (ลูกค้า)", name: "" }];
  } else if (kind === "dl") {
    Object.assign(d, {
      layout: "letter", listStyle: "lines", en: "", copy: "", items: letterItems(o.routes),
      subject: "ขอส่งมอบงานและขอเบิกเงินค่าจ้าง",
      to: A.director || `ผู้อำนวยการ${A.name}`,
      ref: `ใบสั่งจ้างเลขที่ ${o.po_no || "…"}`,
      encl: "",
      p1: `ตามใบสั่งจ้างที่อ้างถึง ${c.name} เป็นผู้รับจ้าง งานจ้างเหมาบริการงานตัดหญ้า${o.hmd ? " ในพื้นที่" + hmdFull(o.hmd) : ""}${o.due_date ? ` กำหนดแล้วเสร็จภายในวันที่ ${dL(o.due_date)}` : ""} ดังนี้`,
      p2: `จำนวน {จำนวนสาย} สายทาง พื้นที่รวม {พื้นที่} ตารางเมตร เป็นจำนวนเงิน {จำนวนเงิน} บาท ({ตัวอักษร}) ซึ่งรวมภาษีมูลค่าเพิ่มแล้ว บัดนี้ ${c.name} ได้ดำเนินการตัดหญ้าสายทางดังกล่าวแล้วเสร็จครบถ้วน`,
      p3: "จึงเรียนมาเพื่อโปรดนัดคณะกรรมการตรวจรับพัสดุ ตรวจรับงาน และเบิกจ่ายเงินให้แก่บริษัทฯ เป็นจำนวนเงิน {จำนวนเงิน} บาท ({ตัวอักษร}) ด้วย จักขอบคุณยิ่ง",
      closing: "ขอแสดงความนับถือ",
      signName: signer,
      signTitle: c.signer_title ?? "",
      contact: `ผู้ประสานงาน ${signer}\nโทรศัพท์ ${c.phone ?? ""}${c.email ? "  อีเมล " + c.email : ""}`,
    });
  } else {
    d.info = [["อ้างอิง", ref + (dlNo ? ` · หนังสือส่งมอบงาน ${dlNo}` : "")], ["งวดที่", String(o.round_no || "")], ["เลขที่โครงการ", o.proj_no || ""], ...hm];
    d.notes = [{ h: "ชำระโดย", t: "โอนเงินเข้าบัญชี" }, { h: "หมายเหตุ", t: `หักภาษี ณ ที่จ่าย 1% ตามหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ของ${A.name || "ผู้ว่าจ้าง"}` }];
    d.sign = [{ label: "ผู้รับเงิน", name: "" }, { label: "ผู้มีอำนาจลงนาม", name: signer }];
  }
  return d;
}
