"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { addCrew as addCrewDb, saveDaily as saveDailyDb } from "@/lib/data/daily";
import { num } from "@/lib/calc";

type R = { error?: string };
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const money = (v: unknown) => Math.round(num(v) * 100) / 100;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type DayInput = {
  date: string;
  work: { r: string; km: number | string | null; fin?: boolean }[];
  crew: { id?: string; name: string; wage?: number | string | null; ot?: number | string | null; on: boolean; half?: boolean }[];
  fuel: number | string;
  fuel_car: number | string;
  water: number | string;
  other: number | string;
  note: string;
};

/** บันทึกรายวัน (บันทึกอัตโนมัติจากหน้าบันทึกรายวัน) */
export async function saveDaily(x: DayInput): Promise<R> {
  const { userId, company, perm } = await requireCompany();
  if (!perm.daily) return { error: "ไม่มีสิทธิ์บันทึกรายวัน" };
  if (!isDate(x.date)) return { error: "วันที่ไม่ถูกต้อง" };
  const crew = (x.crew || [])
    .map((c) => ({ id: String(c.id || ""), name: String(c.name || "").trim(), wage: num(c.wage), ot: c.on ? num(c.ot) : 0, on: Boolean(c.on), half: Boolean(c.on && c.half) }))
    .filter((c) => c.name);
  const seen = new Set<string>();
  const work: { r: string; km: number | null; fin?: boolean }[] = [];
  for (const w of x.work || []) {
    if (!isUuid(w.r) || seen.has(w.r)) continue;
    seen.add(w.r);
    const t = String(w.km ?? "").replace(/,/g, "").trim();
    const km = t === "" ? null : Number(t);
    if (km !== null && (!Number.isFinite(km) || km < 0)) return { error: "ระยะที่ตัดได้ต้องเป็นตัวเลข กม." };
    work.push(w.fin ? { r: w.r, km, fin: true } : { r: w.r, km });
  }
  // คนที่ไม่ใช่บัญชีแก้ค่าแรงไม่ได้, คนที่จ่ายแล้วแก้ไม่ได้, งานของสายนอกขอบเขตไม่หาย (ดู lib/data/daily.ts)
  try {
    await saveDailyDb(userId, company.id, x.date, work, crew, money(x.fuel), money(x.other), String(x.note || "").slice(0, 500), money(x.water), money(x.fuel_car));
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function deleteDaily(date: string): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.wages) return { error: "ลบบันทึกรายวันได้เฉพาะฝ่ายบัญชีหรือเจ้าของ" };
  if (!isDate(date)) return { error: "วันที่ไม่ถูกต้อง" };
  await sql`delete from daily_logs where company_id = ${company.id} and log_date = ${date}`;
  revalidatePath("/", "layout");
  return {};
}

/** เพิ่มคนงานใหม่จากหน้าบันทึกรายวัน (หัวหน้าชุดเพิ่มได้ ค่าแรงใช้ค่ากลาง บัญชีแก้ทีหลัง) */
export async function addCrew(name: string, wage?: number | string): Promise<R & { id?: string; wage?: number | null }> {
  const { userId, company, perm } = await requireCompany();
  if (!perm.daily) return { error: "ไม่มีสิทธิ์เพิ่มคนงาน" };
  const n = String(name || "").trim();
  if (!n) return { error: "ใส่ชื่อคนงาน" };
  let id: string;
  try {
    id = await addCrewDb(userId, company.id, n, perm.wages && wage !== undefined && wage !== "" ? num(wage) : null);
  } catch (e) {
    return { error: msg(e) };
  }
  // ค่าแรงเห็นเฉพาะบัญชี (แบบ crew_v เดิม)
  const [c] = perm.wages ? await sql<{ wage: number }[]>`select wage from crew where id = ${id}` : [];
  revalidatePath("/", "layout");
  return { id, wage: c?.wage == null ? null : Number(c.wage) };
}

/**
 * เอาคนงานออกจากบันทึกรายวัน (ปุ่ม ✕ ในรายชื่อใครมาทำงาน)
 * · เอาออกจากบันทึกของวันนั้น
 * · ไม่เคยมีประวัติ (มาทำงานวันอื่น จ่ายค่าแรง เบิก) → ลบออกจากทะเบียนเลย (เช่น เพิ่มผิด/พิมพ์ชื่อผิด)
 * · มีประวัติแล้ว → พักงาน ไม่ขึ้นในบันทึกวันใหม่ ประวัติยังอยู่ครบ (เฉพาะบัญชี/เจ้าของ)
 */
export async function removeDailyCrew(date: string, crewId: string): Promise<R & { mode?: "deleted" | "inactive" }> {
  const { company, perm } = await requireCompany();
  if (!perm.daily) return { error: "ไม่มีสิทธิ์แก้บันทึกรายวัน" };
  if (!isDate(date)) return { error: "วันที่ไม่ถูกต้อง" };
  if (!isUuid(crewId)) return { error: "ไม่พบคนงาน" };
  try {
    const [k] = await sql<{ name: string }[]>`select name from crew where id = ${crewId} and company_id = ${company.id}`;
    if (!k) return { error: "ไม่พบคนงาน" };
    const d = new Date(date + "T00:00:00Z"), dow = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (dow - 1));
    const ws = d.toISOString().slice(0, 10);
    const [paidNow] = await sql`select 1 from crew_pays where company_id = ${company.id} and week_start = ${ws} and crew_id = ${crewId}`;
    if (paidNow) return { error: `${k.name} จ่ายค่าแรงสัปดาห์นี้แล้ว ยกเลิกการจ่ายในหน้าคนงานและค่าแรงก่อน` };

    const me = sql.json([{ id: crewId, on: true }]);
    const [worked] = await sql`select 1 from daily_logs where company_id = ${company.id} and log_date <> ${date} and crew @> ${me} limit 1`;
    const [paid] = await sql`select 1 from crew_pays where company_id = ${company.id} and crew_id = ${crewId} limit 1`;
    const [adv] = await sql`select 1 from crew_advances where company_id = ${company.id} and crew_id = ${crewId} limit 1`;
    const hist = Boolean(worked || paid || adv);
    if (hist && !perm.wages) return { error: `${k.name} มีประวัติทำงานแล้ว ให้ฝ่ายบัญชีกดลบ (ระบบจะพักงานไว้) หรือตั้งพักงานในทะเบียนคนงาน` };

    await sql.begin(async (tx) => {
      await tx`
        update daily_logs set crew = coalesce((select jsonb_agg(e) from jsonb_array_elements(crew) e where e->>'id' is distinct from ${crewId}), '[]'::jsonb)
        where company_id = ${company.id} and log_date = ${date}
      `;
      if (hist) await tx`update crew set active = false where id = ${crewId} and company_id = ${company.id}`;
      else {
        // ยังไม่เคยมาทำงาน: เอาออกจากบันทึกทุกวัน (ที่ติ๊กไม่มา) แล้วลบออกจากทะเบียน
        const ref = sql.json([{ id: crewId }]);
        await tx`
          update daily_logs set crew = coalesce((select jsonb_agg(e) from jsonb_array_elements(crew) e where e->>'id' is distinct from ${crewId}), '[]'::jsonb)
          where company_id = ${company.id} and crew @> ${ref}
        `;
        await tx`delete from crew where id = ${crewId} and company_id = ${company.id}`;
      }
    });
    revalidatePath("/", "layout");
    return { mode: hist ? "inactive" : "deleted" };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** เบิกล่วงหน้า */
export async function saveAdvance(a: { crew_id: string; date: string; amt: number | string; note?: string }): Promise<R> {
  const { userId, company, perm } = await requireCompany();
  if (!perm.daily) return { error: "ไม่มีสิทธิ์บันทึกการเบิก" };
  if (!isUuid(a.crew_id)) return { error: "เลือกคนงาน" };
  if (!isDate(a.date)) return { error: "ใส่วันที่เบิก" };
  const amt = money(a.amt);
  if (!(amt > 0)) return { error: "ใส่จำนวนเงินที่เบิก" };
  const [k] = await sql`select 1 from crew where id = ${a.crew_id} and company_id = ${company.id}`;
  if (!k) return { error: "ไม่พบคนงาน" };
  await sql`
    insert into crew_advances (company_id, crew_id, adv_date, amt, note, created_by)
    values (${company.id}, ${a.crew_id}, ${a.date}, ${amt}, ${String(a.note || "").trim().slice(0, 200)}, ${userId})
  `;
  revalidatePath("/", "layout");
  return {};
}
export async function deleteAdvance(id: string): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.daily) return { error: "ไม่มีสิทธิ์ลบการเบิก" };
  if (!isUuid(id)) return { error: "ไม่พบรายการ" };
  await sql`delete from crew_advances where id = ${id} and company_id = ${company.id}`;
  revalidatePath("/", "layout");
  return {};
}

export type FuelIn = {
  id?: string; date: string; kind: "mower" | "car"; liters: number | string; price: number | string; amt: number | string;
  crew_id?: string; by_name?: string; car_id?: string; car_plate?: string; odo?: number | string; note?: string; pic_path?: string | null;
};
/** เบิกน้ำมัน */
export async function saveFuel(f: FuelIn): Promise<R> {
  const { userId, company, perm } = await requireCompany();
  if (!perm.fuel) return { error: "ไม่มีสิทธิ์บันทึกน้ำมัน" };
  if (!isDate(f.date)) return { error: "ใส่วันที่เบิก" };
  const liters = money(f.liters), price = money(f.price), amt = money(f.amt) || money(liters * price);
  if (!(liters > 0)) return { error: "ใส่จำนวนลิตร" };
  if (!(amt > 0)) return { error: "ใส่ราคาต่อลิตร หรือยอดเงิน" };
  const car = f.kind === "car";
  const row = {
    company_id: company.id, log_date: f.date, kind: car ? "car" : "mower", liters, price: price || money(amt / liters), amt,
    crew_id: isUuid(f.crew_id) ? f.crew_id : null, by_name: String(f.by_name || "").slice(0, 100),
    car_id: car && isUuid(f.car_id) ? f.car_id : null, car_plate: car ? String(f.car_plate || "").slice(0, 40) : "",
    odo: car && num(f.odo) > 0 ? Math.round(num(f.odo)) : null, note: String(f.note || "").trim().slice(0, 200),
    pic_path: f.pic_path && f.pic_path.startsWith(company.id + "/") ? f.pic_path : null,
  };
  try {
    // คนงาน/รถต้องเป็นของบริษัทนี้
    if (row.crew_id && !(await sql`select 1 from crew where id = ${row.crew_id} and company_id = ${company.id}`).length) row.crew_id = null;
    if (row.car_id && !(await sql`select 1 from cars where id = ${row.car_id} and company_id = ${company.id}`).length) row.car_id = null;
    if (isUuid(f.id)) await sql`update fuel_logs set ${sql(row)} where id = ${f.id} and company_id = ${company.id}`;
    else await sql`insert into fuel_logs ${sql({ ...row, created_by: userId })}`;
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/", "layout");
  return {};
}
export async function deleteFuel(id: string): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.fuel) return { error: "ไม่มีสิทธิ์ลบ" };
  if (!isUuid(id)) return { error: "ไม่พบรายการ" };
  await sql`delete from fuel_logs where id = ${id} and company_id = ${company.id}`;
  revalidatePath("/", "layout");
  return {};
}
