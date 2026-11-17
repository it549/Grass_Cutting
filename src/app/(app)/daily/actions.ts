"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db/sql";
import { saveDaily as saveDailyDb } from "@/lib/data/daily";
import { num } from "@/lib/calc";

type R = { error?: string };
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

export type DayInput = {
  date: string;
  work: { r: string; km: number | string | null }[];
  crew: { id?: string; name: string; wage: number | string; ot: number | string; on: boolean }[];
  fuel: number | string;
  other: number | string;
  note: string;
};

export async function saveDaily(x: DayInput): Promise<R> {
  const { company, perm } = await requireCompany();
  const session = await getSession();
  if (!perm.daily || !session) return { error: "ไม่มีสิทธิ์บันทึกรายวัน" };
  if (!isDate(x.date)) return { error: "วันที่ไม่ถูกต้อง" };
  const crew = (x.crew || [])
    .map((c) => ({ id: String(c.id || ""), name: String(c.name || "").trim(), wage: num(c.wage), ot: num(c.ot), on: Boolean(c.on) }))
    .filter((c) => c.name);
  const seen = new Set<string>();
  const work = [];
  for (const w of x.work || []) {
    if (!isUuid(w.r) || seen.has(w.r)) continue;
    seen.add(w.r);
    const t = String(w.km ?? "").replace(/,/g, "").trim();
    const km = t === "" ? null : Number(t);
    if (km !== null && (!Number.isFinite(km) || km < 0)) return { error: "ระยะที่ตัดได้ต้องเป็นตัวเลข กม." };
    work.push({ r: w.r, km });
  }
  // บันทึกผ่านฟังก์ชันนี้เท่านั้น: คนที่ไม่ใช่บัญชีแก้ค่าแรงไม่ได้ และงานของสายนอกขอบเขตจะไม่หาย
  try {
    await saveDailyDb(session.userId, company.id, x.date, work, crew, num(x.fuel), num(x.other), String(x.note || "").slice(0, 500));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function deleteDaily(date: string): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.wages) return { error: "ลบบันทึกรายวันได้เฉพาะฝ่ายบัญชีหรือเจ้าของ" };
  await sql`delete from daily_logs where company_id = ${company.id} and log_date = ${date}`;
  revalidatePath("/daily");
  return {};
}

/** บันทึกรายชื่อลูกจ้างประจำชุด (คนที่เอาออกจะถูกซ่อน ไม่ลบประวัติรายวัน) */
export async function saveCrew(list: { id?: string; name: string; wage: number | string }[]): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.wages) return { error: "เฉพาะฝ่ายบัญชีหรือเจ้าของที่แก้รายชื่อและค่าแรงได้" };
  const keep = list.map((c, i) => ({ id: isUuid(c.id) ? c.id : undefined, name: String(c.name || "").trim(), wage: num(c.wage), sort: i })).filter((c) => c.name);
  const cur = await sql<{ id: string }[]>`select id from crew where company_id = ${company.id} and active = true`;
  const ids = new Set(keep.map((c) => c.id).filter(Boolean));
  const gone = cur.filter((c) => !ids.has(c.id)).map((c) => c.id);
  if (gone.length) {
    await sql`update crew set active = false where id in ${sql(gone)} and company_id = ${company.id}`;
  }
  for (const c of keep) {
    if (c.id) {
      await sql`update crew set name = ${c.name}, wage = ${c.wage}, sort = ${c.sort}, active = true where id = ${c.id} and company_id = ${company.id}`;
    } else {
      await sql`insert into crew (company_id, name, wage, sort) values (${company.id}, ${c.name}, ${c.wage}, ${c.sort})`;
    }
  }
  revalidatePath("/daily");
  return {};
}
