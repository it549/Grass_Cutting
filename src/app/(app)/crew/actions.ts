"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { num } from "@/lib/calc";

type R = { error?: string };
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const money = (v: unknown) => Math.round(num(v) * 100) / 100;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const METHODS = ["cash", "pp", "bank"] as const;
type Method = (typeof METHODS)[number];
const isMethod = (s: unknown): s is Method => METHODS.includes(s as Method);

export type CrewPatch = Partial<{ name: string; nick: string; role: string; phone: string; wage: number | string; pay_by: string; pay_no: string; start_date: string | null; active: boolean; note: string }>;

/** แก้ข้อมูลคนงาน (บันทึกอัตโนมัติจากทะเบียนคนงาน) · เฉพาะบัญชี */
export async function updateCrew(id: string, p: CrewPatch): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.wages) return { error: "แก้ทะเบียนคนงานได้เฉพาะฝ่ายบัญชีหรือเจ้าของ" };
  if (!isUuid(id)) return { error: "ไม่พบคนงาน" };
  const row: Record<string, string | number | boolean | null> = {};
  const txt = (k: keyof CrewPatch, max: number) => { if (p[k] !== undefined) row[k] = String(p[k] ?? "").trim().slice(0, max); };
  if (p.name !== undefined) { const n = String(p.name).trim(); row.name = n || "(ไม่มีชื่อ)"; }
  txt("nick", 60); txt("role", 60); txt("phone", 40); txt("pay_no", 80); txt("note", 500);
  if (p.wage !== undefined) row.wage = Math.max(0, money(p.wage));
  if (p.pay_by !== undefined) { if (!isMethod(p.pay_by)) return { error: "วิธีรับเงินไม่ถูกต้อง" }; row.pay_by = p.pay_by; }
  if (p.start_date !== undefined) row.start_date = isDate(p.start_date) ? p.start_date : null;
  if (p.active !== undefined) row.active = Boolean(p.active);
  if (!Object.keys(row).length) return {};
  try {
    await sql`update crew set ${sql(row)} where id = ${id} and company_id = ${company.id}`;
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

/** เพิ่มคนงานใหม่ในทะเบียน (ค่าแรงตั้งต้นเท่าคนแรกที่ทำงานอยู่) */
export async function newCrew(): Promise<R & { id?: string }> {
  const { company, perm } = await requireCompany();
  if (!perm.wages) return { error: "เพิ่มคนงานในทะเบียนได้เฉพาะฝ่ายบัญชีหรือเจ้าของ" };
  const act = await sql<{ wage: number; sort: number }[]>`select wage, sort from crew where company_id = ${company.id} order by sort`;
  const first = act[0];
  const sort = act.reduce((m, c) => Math.max(m, Number(c.sort) + 1), 0);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
  try {
    const [row] = await sql<{ id: string }[]>`
      insert into crew (company_id, name, wage, sort, start_date, pay_by)
      values (${company.id}, ${"คนงานใหม่"}, ${num(first?.wage) || 400}, ${sort}, ${today}, ${"cash"})
      returning id
    `;
    revalidatePath("/", "layout");
    return { id: row.id };
  } catch (e) {
    return { error: msg(e) };
  }
}

export type PayIn = { crew_id: string; name: string; method: string; days: number; gross: number; ot: number; ded: number; net: number };
/** บันทึกจ่ายค่าแรงของสัปดาห์ (วันของคนที่จ่ายแล้วจะล็อกในบันทึกรายวัน) · เฉพาะบัญชี */
export async function payCrew(week_start: string, pay_date: string, list: PayIn[]): Promise<R> {
  const { userId, company, perm } = await requireCompany();
  if (!perm.wages) return { error: "จ่ายค่าแรงได้เฉพาะฝ่ายบัญชีหรือเจ้าของ" };
  if (!isDate(week_start) || new Date(week_start + "T00:00:00Z").getUTCDay() !== 1) return { error: "สัปดาห์ไม่ถูกต้อง" };
  if (!isDate(pay_date)) return { error: "ใส่วันที่จ่าย" };
  if (!list.length) return { error: "ไม่มีรายการที่จะจ่าย" };
  const rows = [];
  for (const p of list) {
    if (!isUuid(p.crew_id)) return { error: `จ่าย ${p.name || "คนนี้"} ไม่ได้ เพราะไม่ได้อยู่ในทะเบียนคนงาน` };
    const gross = money(p.gross), ot = money(p.ot), ded = money(p.ded), net = money(p.net);
    if ([gross, ot, ded, net].some((x) => x < 0) || Math.abs(gross + ot - ded - net) > 0.02) return { error: "ยอดเงินไม่ถูกต้อง ลองโหลดหน้าใหม่" };
    rows.push({ company_id: company.id, week_start, crew_id: p.crew_id, name: String(p.name || "").slice(0, 100), pay_date, method: isMethod(p.method) ? p.method : "cash", days: Math.round(num(p.days) * 10) / 10, gross, ot, ded, net, created_by: userId });
  }
  try {
    const ids = rows.map((r) => r.crew_id);
    const mine = await sql<{ id: string }[]>`select id from crew where company_id = ${company.id} and id in ${sql(ids)}`;
    if (mine.length !== new Set(ids).size) return { error: "มีคนงานที่ไม่ได้อยู่ในทะเบียนของบริษัทนี้" };
    await sql`
      insert into crew_pays ${sql(rows)}
      on conflict (company_id, week_start, crew_id) do update set
        name = excluded.name, pay_date = excluded.pay_date, method = excluded.method, days = excluded.days,
        gross = excluded.gross, ot = excluded.ot, ded = excluded.ded, net = excluded.net
    `;
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/", "layout");
  return {};
}
export async function unpayCrew(week_start: string, crew_id: string): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.wages) return { error: "ยกเลิกการจ่ายได้เฉพาะฝ่ายบัญชีหรือเจ้าของ" };
  if (!isDate(week_start) || !isUuid(crew_id)) return { error: "ข้อมูลไม่ถูกต้อง" };
  await sql`delete from crew_pays where company_id = ${company.id} and week_start = ${week_start} and crew_id = ${crew_id}`;
  revalidatePath("/", "layout");
  return {};
}

export type CarIn = { id?: string; plate: string; name: string; fuel_type: string; active: boolean };
/** ทะเบียนรถ: บันทึกทั้งชุด (แถวที่เอาออกจะลบ ถ้ายังไม่เคยเบิกน้ำมัน) */
export async function saveCars(list: CarIn[]): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.orders && !perm.daily) return { error: "ไม่มีสิทธิ์แก้ทะเบียนรถ" };
  const L = list.map((c, i) => ({ id: isUuid(c.id) ? c.id : undefined, plate: String(c.plate || "").trim().slice(0, 40), name: String(c.name || "").trim().slice(0, 60), fuel_type: String(c.fuel_type || "").slice(0, 30), active: c.active !== false, sort: i }));
  if (L.some((c) => !c.plate)) return { error: "ใส่ทะเบียนรถให้ครบทุกคัน หรือลบแถวที่ว่าง" };
  const key = (s: string) => s.replace(/\s/g, "");
  const dup = L.find((c, i) => L.findIndex((x) => key(x.plate) === key(c.plate)) !== i);
  if (dup) return { error: "ทะเบียน " + dup.plate + " ซ้ำ" };
  try {
    await sql.begin(async (tx) => {
      const old = await tx<{ id: string }[]>`select id from cars where company_id = ${company.id}`;
      const keep = new Set(L.map((c) => c.id).filter(Boolean));
      const gone = old.map((c) => c.id).filter((id) => !keep.has(id));
      if (gone.length) {
        const used = await tx`select car_id from fuel_logs where company_id = ${company.id} and car_id in ${tx(gone)} limit 1`;
        if (used.length) throw new Error("รถที่เคยเบิกน้ำมันแล้วลบไม่ได้ ให้ตั้งเป็นเลิกใช้แทน");
        await tx`delete from cars where company_id = ${company.id} and id in ${tx(gone)}`;
      }
      for (const c of L) {
        const row = { company_id: company.id, plate: c.plate, name: c.name, fuel_type: c.fuel_type, active: c.active, sort: c.sort };
        if (c.id) await tx`update cars set ${tx(row)} where id = ${c.id} and company_id = ${company.id}`;
        else await tx`insert into cars ${tx(row)}`;
      }
    });
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/", "layout");
  return {};
}
