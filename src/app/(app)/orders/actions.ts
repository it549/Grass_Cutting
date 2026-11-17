"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { removeFiles } from "@/lib/data/files";
import { num } from "@/lib/calc";

export type OrderInput = {
  id: string | null;
  agency_id: string;
  round_no: number;
  hmd: string;
  po_no: string;
  po_date: string;
  proj_no: string;
  due_days: string;
  due_date: string;
  penalty: string;
  vat_incl: boolean;
  note: string;
  po_file_path: string;
  routes: { id?: string; code: string; descr: string; area: string | number; rate: string | number }[];
  force?: boolean;
};

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUniqueViolation = (e: unknown) => e instanceof Error && "code" in e && (e as { code?: string }).code === "23505";

export async function saveOrder(input: OrderInput): Promise<{ error: string; confirm?: boolean } | never> {
  const { company, perm } = await requireCompany();
  if (!perm.orders) return { error: "เฉพาะธุรการหรือเจ้าของที่แก้ใบสั่งจ้างได้" };
  if (!input.agency_id) return { error: "เลือกแขวงก่อน" };
  const round = Math.trunc(num(input.round_no));
  if (round < 1) return { error: "เลขงวดต้องเป็น 1 ขึ้นไป" };
  if (!input.hmd) return { error: "เลือกหมวดของใบสั่งจ้างนี้" };
  for (const d of [input.po_date, input.due_date]) if (d && !isDate(d)) return { error: "รูปแบบวันที่ไม่ถูกต้อง" };
  const routes = input.routes
    .map((r) => ({ id: r.id || "", code: String(r.code ?? "").trim(), descr: String(r.descr ?? "").trim(), area: num(r.area), rate: num(r.rate) }))
    .filter((r) => r.code || r.descr || r.area || r.rate);

  if (input.id) {
    // สายที่วางใหม่/อ่านใหม่แต่รหัสตรงกับสายเดิม ใช้สายเดิม (รูปและสถานะไม่หาย)
    const old = await sql<{ id: string; code: string }[]>`select id, code from routes where order_id = ${input.id}`;
    const used = new Set(routes.map((r) => r.id).filter(Boolean));
    for (const r of routes) {
      if (r.id || !r.code) continue;
      const m = old.find((o) => o.code === r.code && !used.has(o.id));
      if (m) { r.id = m.id; used.add(m.id); }
    }
    const gone = old.filter((o) => !used.has(o.id));
    if (gone.length && !input.force) {
      const ph = await sql<{ route_id: string }[]>`select route_id from route_photos where route_id in ${sql(gone.map((g) => g.id))}`;
      const withPics = gone.filter((g) => ph.some((p) => p.route_id === g.id));
      if (withPics.length)
        return { confirm: true, error: `สายที่จะถูกลบมีรูปอยู่: ${withPics.map((g) => g.code || "(ไม่มีรหัส)").join(", ")} ถ้าบันทึก รูปของสายเหล่านี้จะหายด้วย` };
    }
  }

  const order = {
    agency_id: input.agency_id, round_no: round, hmd: input.hmd, po_no: input.po_no.trim(), po_date: input.po_date,
    proj_no: input.proj_no.trim(), due_days: input.due_days ? String(Math.trunc(num(input.due_days))) : "", due_date: input.due_date,
    penalty: input.penalty.trim(), vat_incl: input.vat_incl, note: input.note.trim(), po_file_path: input.po_file_path,
  };
  let id: string;
  try {
    const [row] = await sql<{ id: string }[]>`
      select public.save_order(${input.id}, ${company.id}, ${sql.json(order)}, ${sql.json(routes)}) as id
    `;
    id = row.id;
  } catch (e) {
    if (isUniqueViolation(e)) return { error: `งวดที่ ${round} มีใบสั่งจ้างของหมวด${input.hmd}อยู่แล้ว` };
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/orders/${id}?msg=${encodeURIComponent("บันทึกใบสั่งจ้างแล้ว")}`);
}

export async function deleteOrder(formData: FormData) {
  const { company, perm } = await requireCompany();
  const id = String(formData.get("id"));
  if (!perm.orders) redirect(`/orders/${id}?err=${encodeURIComponent("ไม่มีสิทธิ์ลบ")}`);
  const [o] = await sql<{ agency_id: string; round_no: number; po_file_path: string | null }[]>`
    select agency_id, round_no, po_file_path from orders where id = ${id} and company_id = ${company.id}
  `;
  const [{ count: issued }] = await sql<{ count: number }[]>`
    select count(*)::int as count from documents where order_id = ${id} and status <> 'draft'
  `;
  if (issued) redirect(`/orders/${id}?err=${encodeURIComponent("ใบสั่งจ้างนี้มีเอกสารที่ออกแล้ว ลบไม่ได้ (ยกเลิกเอกสารก็ยังเก็บไว้เป็นหลักฐาน)")}`);
  const pics = await sql<{ path: string }[]>`select path from route_photos where order_id = ${id}`;
  await sql`delete from documents where order_id = ${id} and status = 'draft'`;
  try {
    await sql`delete from orders where id = ${id} and company_id = ${company.id}`;
  } catch (e) {
    redirect(`/orders/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
  const files = [o?.po_file_path, ...pics.map((p) => p.path)].filter(Boolean) as string[];
  if (files.length) await removeFiles(files);
  revalidatePath("/", "layout");
  redirect(o ? `/rounds/${o.agency_id}/${o.round_no}?msg=${encodeURIComponent("ลบใบสั่งจ้างแล้ว")}` : "/rounds");
}
