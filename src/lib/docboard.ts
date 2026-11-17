// สถานะเอกสารของแต่ละหมวด (ใบสั่งจ้าง › ใบเสนอราคา › หนังสือส่งมอบ › ใบกำกับภาษี) แบบเดียวกับระบบบน claude.ai
import { totals } from "@/lib/calc";
import { type Order, type RoundKey, type World, hasPo, poRoutes, rInfo, roundOf, workIndex } from "@/lib/model";

export type DocKind = "qt" | "dl" | "rc";
export type DocLite = { id: string; kind: DocKind; no: string; doc_date: string; status: "draft" | "issued" | "void"; total: number; order_id: string | null };

/** เอกสารที่ยังใช้อยู่ (ไม่นับที่ยกเลิก) ของหมวด ใบใหม่สุดก่อน */
export const docsOf = (docs: DocLite[], o: Pick<Order, "id">, k: DocKind) =>
  docs.filter((d) => d.order_id === o.id && d.kind === k && d.status !== "void").sort((a, b) => b.no.localeCompare(a.no));

/** "d" ออกแล้ว · "r" มีแต่ฉบับร่าง · "" ยังไม่มี (ช่องแรก = ใบสั่งจ้าง) */
export function poParts(o: Order, docs: DocLite[]): ("d" | "r" | "")[] {
  if (!hasPo(o)) return ["", "", "", ""];
  const st = (k: DocKind) => { const L = docsOf(docs, o, k); return L.some((d) => d.status === "issued") ? "d" : L.length ? "r" : ""; };
  return ["d", st("qt"), st("dl"), st("rc")];
}
/** ขั้นถัดไปที่ต้องทำ: 0 ยังไม่มีใบสั่งจ้าง · 1 เสนอราคา · 2 ส่งมอบ · 3 ใบกำกับ · 4 ครบ */
export function poStep(o: Order, docs: DocLite[]) {
  if (!hasPo(o)) return 0;
  const i = poParts(o, docs).findIndex((x) => x !== "d");
  return i < 0 ? 4 : i;
}
export const poLate = (o: Order, docs: DocLite[], today: string) => hasPo(o) && poStep(o, docs) < 3 && !!o.due_date && o.due_date < today;
export const poStat = (o: Order, docs: DocLite[]) => { const s = poStep(o, docs); return !s ? "none" : s === 4 ? "done" : s === 3 ? "bill" : "docs"; };
export const orderTotal = (o: Order) => totals(poRoutes(o).map((r) => ({ area: r.area, rate: r.rate ?? 0 })), o.vat_incl).total;
export const lateDays = (due: string, today: string) => Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / 864e5);

export type Todo = { o: Order; t: string; s: string; kind: "po" | DocKind };
/** งานเอกสารที่ค้างของงวด */
export function docTodos(W: World, wi: ReturnType<typeof workIndex>, k: RoundKey | null, docs: DocLite[]) {
  const out: Todo[] = [];
  if (!k) return out;
  for (const o of roundOf(W, k)) {
    const xs = o.routes.map((r) => rInfo(W, wi, r));
    const hm = o.hmd ? "หมวด" + o.hmd : `งวด ${o.round_no}`;
    if (!hasPo(o)) {
      if (xs.some((x) => x.s !== "todo")) out.push({ o, t: `รอใบสั่งจ้าง ${hm}`, s: `ตัดแล้ว ${xs.filter((x) => x.cut).length}/${xs.length} สาย · อัปโหลดเมื่อได้รับ`, kind: "po" });
      continue;
    }
    const pr = poRoutes(o), ready = pr.length > 0 && pr.every((r) => rInfo(W, wi, r).s === "done");
    if (!docsOf(docs, o, "qt").length) out.push({ o, t: `ทำใบเสนอราคา ${hm}`, s: `ใบสั่งจ้าง ${o.po_no}`, kind: "qt" });
    if (ready && !docsOf(docs, o, "dl").length) out.push({ o, t: `ออกหนังสือส่งมอบ ${hm}`, s: `ตัดครบ รูปครบ ${pr.length}/${pr.length} สายแล้ว`, kind: "dl" });
    if (docsOf(docs, o, "dl").length && !docsOf(docs, o, "rc").some((d) => d.status === "issued")) out.push({ o, t: `ออกใบกำกับภาษี/ใบเสร็จ ${hm}`, s: "ส่งมอบแล้ว รอวางบิล", kind: "rc" });
  }
  return out;
}
