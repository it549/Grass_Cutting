"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { loadWorld } from "@/lib/world";
import { type Order, type Route, hasPo, num, regOf, rkName, roundOf, workIndex } from "@/lib/model";

type R = { ok: true; msg: string; warn?: boolean; firstH?: string } | { ok: false; error: string };
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });

const orderJson = (o: Order) => ({
  agency_id: o.agency_id, round_no: o.round_no, hmd: o.hmd, fy: o.fy, start_date: o.start_date ?? "",
  po_no: o.po_no ?? "", po_date: o.po_date ?? "", proj_no: o.proj_no ?? "", due_days: o.due_days ?? "", due_date: o.due_date ?? "",
  penalty: o.penalty ?? "", vat_incl: o.vat_incl, note: o.note ?? "", po_file_path: o.po_file_path ?? "",
});
const routeJson = (r: Partial<Route> & { code: string; descr: string }) => ({
  id: r.id ?? "", code: r.code, descr: r.descr, area: r.area ?? 0, rate: r.rate ?? 0, road_id: r.road_id ?? "", in_po: r.in_po !== false,
});

/**
 * สร้างงวดจากแผน / เพิ่มหมวดเข้างวด / แก้สายในงวด (ยังไม่ต้องมีใบสั่งจ้าง)
 * แต่ละหมวดเป็น 1 ใบสั่งจ้างที่ยังไม่มีเลข สายในแผน in_po = false จนกว่าจะอัปโหลดใบสั่งจ้าง
 * เอาสายออกไม่ได้ถ้ามีบันทึกการตัด รูป หรืออยู่ในใบสั่งจ้างแล้ว
 */
export async function saveRoundPlan(inp: { ag: string; fy: number; no: number; edit: boolean; sel: string[] }): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.orders) return { ok: false, error: "เฉพาะธุรการหรือเจ้าของที่สร้างงวดได้" };
  const fy = Math.trunc(num(inp.fy)), no = Math.trunc(num(inp.no));
  if (!no || no < 1 || fy < 2500 || fy > 2700) return { ok: false, error: "ใส่งวดที่และปีงบประมาณ (พ.ศ.)" };
  const W = await loadWorld();
  const A = W.agencies.find((a) => a.id === inp.ag);
  if (!A) return { ok: false, error: "ไม่พบแขวง" };
  const k = { ag: A.id, fy, no }, sel = new Set(inp.sel);
  const regs = W.roads.filter((g) => g.agency_id === A.id), pickG = regs.filter((g) => sel.has(g.id));
  const exist = roundOf(W, k), addMode = !inp.edit && exist.length > 0;
  if (!inp.edit && !pickG.length) return { ok: false, error: "เลือกสายอย่างน้อย 1 สาย" };
  if (inp.edit && !exist.length) return { ok: false, error: "ไม่พบงวดนี้" };

  const hs = [...A.hmds];
  for (const x of [...regs, ...exist]) if (!hs.includes(x.hmd || "")) hs.push(x.hmd || "");
  const wi = workIndex(W.days);
  const dr = exist.length ? await sql<{ order_id: string }[]>`select order_id from documents where order_id in ${sql(exist.map((o) => o.id))}` : [];
  const hasDocs = new Set(dr.map((d) => d.order_id));

  type Write = { id: string | null; order: ReturnType<typeof orderJson> | Record<string, unknown>; routes: ReturnType<typeof routeJson>[] };
  const writes: Write[] = [], dels: string[] = [], blocked: string[] = [], added: string[] = [];
  for (const h of hs) {
    const gs = pickG.filter((g) => (g.hmd || "") === h), o0 = exist.find((o) => (o.hmd || "") === h);
    if (addMode && o0) continue;
    const plan = (g: (typeof gs)[number]) => routeJson({ road_id: g.id, code: g.code, descr: g.name, area: 0, rate: 0, in_po: false });
    if (!o0) {
      if (gs.length) {
        added.push(h);
        writes.push({ id: null, order: { agency_id: A.id, round_no: no, hmd: h, fy, start_date: today(), vat_incl: true }, routes: gs.map(plan) });
      }
      continue;
    }
    const keep: ReturnType<typeof routeJson>[] = [], seen = new Set<string>();
    for (const r of o0.routes) {
      const g = regOf(W, o0, r);
      if (g && sel.has(g.id)) { keep.push(routeJson({ ...r, road_id: g.id })); seen.add(g.id); continue; }
      if (!g) { keep.push(routeJson(r)); continue; }
      const x = wi.get(r.id), P = W.pics[r.id];
      const used = !!(P && P.b + P.a) || !!(x && (x.km || x.days.length));
      if (used || (hasPo(o0) && r.in_po !== false)) { blocked.push(r.code); keep.push(routeJson({ ...r, road_id: g.id })); }
    }
    for (const g of gs) if (!seen.has(g.id)) keep.push(plan(g));
    if (!keep.length && !hasPo(o0) && !hasDocs.has(o0.id)) dels.push(o0.id);
    else writes.push({ id: o0.id, order: orderJson(o0), routes: keep });
  }
  if (addMode && !writes.length) return { ok: false, error: "หมวดที่เลือกมีในงวดนี้แล้ว · ถ้าจะแก้สายของหมวดนั้น ใช้ปุ่ม แก้สายในงวด" };

  for (const w of writes) {
    try {
      await sql`select public.save_order(${w.id}, ${company.id}, ${sql.json(w.order as Record<string, string | number | boolean>)}, ${sql.json(w.routes)})`;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      revalidatePath("/", "layout");
      return { ok: false, error: err.code === "23505" ? `${rkName(k)} หมวด${String(w.order.hmd)} มีอยู่แล้ว` : String(err.message ?? e) };
    }
  }
  for (const id of dels) {
    try {
      await sql`delete from orders where id = ${id} and company_id = ${company.id}`;
    } catch (e) {
      revalidatePath("/", "layout");
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  revalidatePath("/", "layout");
  const nm = added.map((h) => (h ? "หมวด" + h : "ไม่ระบุหมวด")).join(", ");
  if (blocked.length) return { ok: true, warn: true, firstH: added[0], msg: `บันทึกแล้ว · เอาออกไม่ได้ ${blocked.join(", ")} เพราะมีบันทึกการตัด รูป หรืออยู่ในใบสั่งจ้างแล้ว` };
  return { ok: true, firstH: added[0], msg: inp.edit ? "บันทึกสายในงวดแล้ว" : addMode ? `เพิ่ม${nm} เข้า${rkName(k)}แล้ว` : `สร้าง${rkName(k)}แล้ว` };
}
