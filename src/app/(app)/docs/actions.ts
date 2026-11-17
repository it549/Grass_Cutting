"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { defaultDate, docTotals, newDoc, type DocData, type DocKind } from "@/lib/docs";
import { loadAgencies, loadOrders, loadPhotos } from "@/lib/orders";
import { routeState } from "@/lib/progress";
import { todayBkk } from "@/lib/calc";

const KINDS: DocKind[] = ["qt", "dl", "rc"];
const bad = (path: string, m: string) => redirect(`${path}?err=${encodeURIComponent(m)}`);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUniqueViolation = (e: unknown) => e instanceof Error && "code" in e && (e as { code?: string }).code === "23505";

async function insertDoc(d: DocData, orderId: string | null) {
  const { company } = await requireCompany();
  for (let i = 0; i < 3; i++) {
    if (i > 0 || !d.no) {
      const [row] = await sql<{ no: string }[]>`select public.next_doc_no(${company.id}, ${d.kind}, ${d.date}) as no`;
      d.no = row.no;
    }
    const { status: _s, ...data } = d;
    void _s;
    try {
      const [row] = await sql<{ id: string }[]>`
        insert into documents (company_id, order_id, kind, no, doc_date, status, data, total)
        values (${company.id}, ${orderId}, ${d.kind}, ${d.no}, ${d.date}, 'draft', ${sql.json(data)}, ${docTotals(d).total})
        returning id
      `;
      return row.id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("ออกเลขที่เอกสารไม่สำเร็จ ลองใหม่อีกครั้ง");
}

export async function createDoc(formData: FormData) {
  const { company, perm } = await requireCompany();
  const kind = String(formData.get("kind")) as DocKind;
  const orderId = String(formData.get("order"));
  const back = `/orders/${orderId}`;
  if (!perm.docKind(kind)) bad(back, kind === "rc" ? "ใบกำกับภาษีทำได้เฉพาะธุรการ บัญชี หรือเจ้าของ" : "ใบเสนอราคาและหนังสือส่งมอบทำได้เฉพาะธุรการหรือเจ้าของ");
  if (!KINDS.includes(kind)) bad(back, "ประเภทเอกสารไม่ถูกต้อง");
  const [agencies, orders] = await Promise.all([loadAgencies(), loadOrders()]);
  const o = orders.find((x) => x.id === orderId);
  if (!o) bad("/rounds", "ไม่พบใบสั่งจ้าง");
  const A = agencies.find((a) => a.id === o!.agency_id);
  const [ag] = await sql<{ name: string; address: string | null; phone: string | null; tax_id: string | null; director: string | null }[]>`
    select name, address, phone, tax_id, director from agencies where id = ${o!.agency_id}
  `;
  const photos = await loadPhotos({ orderIds: [o!.id] });
  const lastDone = o!.routes.map((r) => routeState(r, photos.filter((p) => p.route_id === r.id)).doneDate).filter(Boolean).sort().pop() || null;
  const dl = await sql<{ no: string }[]>`
    select no from documents where order_id = ${o!.id} and kind = 'dl' and status <> 'void' order by no desc limit 1
  `;
  const ctx = { ...o!, lastDone, routes: o!.routes };
  const date = defaultDate(kind, ctx);
  const d = newDoc(kind, "", date, company, ag ?? { name: A?.name ?? "", address: null, phone: null, tax_id: null, director: null }, ctx, dl?.[0]?.no);
  let id = "";
  try {
    id = await insertDoc(d, o!.id);
  } catch (e) {
    bad(back, e instanceof Error ? e.message : String(e));
  }
  revalidatePath("/", "layout");
  redirect(`/docs/${id}`);
}

/** ทำฉบับใหม่จากใบเดิม (ใช้หลังยกเลิกใบกำกับภาษี) */
export async function copyDoc(id: string) {
  const { company, perm } = await requireCompany();
  const [src] = await sql<{ id: string; kind: DocKind; no: string; order_id: string | null; data: DocData }[]>`
    select id, kind, no, order_id, data from documents where id = ${id} and company_id = ${company.id}
  `;
  if (!src) return { error: "ไม่พบเอกสาร" };
  if (!perm.docKind(src.kind)) return { error: "ไม่มีสิทธิ์ทำเอกสารประเภทนี้" };
  const d = { ...src.data, kind: src.kind, status: "draft", date: todayBkk(), no: "", replaces: src.no } as DocData;
  delete d.voidReason;
  let nid = "";
  try {
    nid = await insertDoc(d, src.order_id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/docs/${nid}?msg=${encodeURIComponent(`สร้างฉบับร่างใหม่แทน ${src.no} แล้ว`)}`);
}

export async function saveDoc(id: string, d: DocData): Promise<{ error?: string }> {
  const { company, perm } = await requireCompany();
  if (!perm.docKind(d.kind)) return { error: "ไม่มีสิทธิ์แก้เอกสารประเภทนี้" };
  if (!String(d.no || "").trim()) return { error: "ใส่เลขที่เอกสาร" };
  if (!isDate(d.date)) return { error: "ใส่วันที่เอกสาร" };
  const { status: _s, voidReason: _v, ...data } = d;
  void _s; void _v;
  try {
    await sql`
      update documents set no = ${d.no.trim()}, doc_date = ${d.date}, data = ${sql.json(data)}, total = ${docTotals(d).total}
      where id = ${id} and company_id = ${company.id}
    `;
  } catch (e) {
    return { error: isUniqueViolation(e) ? `เลขที่ ${d.no} มีอยู่แล้ว` : e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/docs");
  return {};
}

export async function setDocStatus(id: string, status: "issued" | "void", reason = ""): Promise<{ error?: string }> {
  const { company, perm } = await requireCompany();
  if (!perm.docs) return { error: "ไม่มีสิทธิ์" };
  const [doc] = await sql<{ kind: DocKind }[]>`select kind from documents where id = ${id} and company_id = ${company.id}`;
  if (!doc) return { error: "ไม่พบเอกสาร" };
  if (doc.kind === "rc" && !perm.rcIssue) return { error: "ออกหรือยกเลิกใบกำกับภาษี/ใบเสร็จได้เฉพาะฝ่ายบัญชีหรือเจ้าของ" };
  try {
    if (status === "void") {
      await sql`update documents set status = ${status}, void_reason = ${reason.trim()} where id = ${id} and company_id = ${company.id}`;
    } else {
      await sql`update documents set status = ${status} where id = ${id} and company_id = ${company.id}`;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function deleteDoc(id: string): Promise<{ error?: string }> {
  const { company, perm } = await requireCompany();
  if (!perm.docs) return { error: "ไม่มีสิทธิ์" };
  let rows: { order_id: string | null }[];
  try {
    rows = await sql<{ order_id: string | null }[]>`
      delete from documents where id = ${id} and company_id = ${company.id} returning order_id
    `;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  redirect(rows[0]?.order_id ? `/orders/${rows[0].order_id}?msg=${encodeURIComponent("ลบฉบับร่างแล้ว")}` : "/docs");
}
