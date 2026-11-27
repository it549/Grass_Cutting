import "server-only";
import { sql } from "@/lib/db/sql";
import { weekOf } from "@/lib/model";
import { hasAny, routeInScope } from "./perm-db";

type WorkItem = { r: string; km?: number | null; fin?: boolean | null };
type CrewItem = { id?: string; name: string; on?: boolean; half?: boolean; wage?: number; ot?: number };
type DailyRow = {
  company_id: string;
  log_date: string;
  order_id: string | null;
  work: WorkItem[];
  crew: CrewItem[];
  fuel: number;
  fuel_car: number;
  water: number;
  other: number;
  note: string;
};

/** percentile_disc(0.5) ของค่าแรงคนงานที่ยังทำงานอยู่ */
async function medianWage(companyId: string) {
  const rows = await sql<{ wage: number }[]>`select wage from crew where company_id = ${companyId} and active = true`;
  if (!rows.length) return 0;
  const sorted = rows.map((k) => Number(k.wage)).sort((a, b) => a - b);
  return sorted[Math.ceil(0.5 * sorted.length) - 1];
}

// พอร์ตจาก public.save_daily (รุ่น 0007) — เดิมใช้ auth.uid() ตอนนี้รับ userId ตรงๆ
// · คนที่ไม่ใช่บัญชี: ค่าแรง/OT ใช้ของเดิมหรือจากรายชื่อลูกจ้าง ส่งมาเท่าไรก็ไม่นับ
// · งานของสายที่อยู่นอกขอบเขตของผู้บันทึกจะถูกเก็บไว้เหมือนเดิม
// · คนงานที่จ่ายค่าแรงสัปดาห์นั้นแล้ว: ใช้ของเดิม แก้ไม่ได้จนกว่าจะยกเลิกการจ่าย
export async function saveDaily(
  userId: string,
  companyId: string,
  date: string,
  work: WorkItem[],
  crew: CrewItem[],
  fuel: number | null,
  other: number | null,
  note: string | null,
  water: number | null = null,
  fuelCar: number | null = null,
) {
  if (!(await hasAny(companyId, userId, ["account", "field"]))) throw new Error("ไม่มีสิทธิ์บันทึกรายวัน");
  if (!date) throw new Error("วันที่ไม่ถูกต้อง");

  const [old] = await sql<DailyRow[]>`select * from daily_logs where company_id = ${companyId} and log_date = ${date}`;
  const acct = await hasAny(companyId, userId, ["account"]);
  const paidRows = await sql<{ crew_id: string }[]>`
    select crew_id from crew_pays where company_id = ${companyId} and week_start = ${weekOf(date)[0]}
  `;
  const paid = new Set(paidRows.map((p) => p.crew_id));

  // งาน: ของผู้บันทึก (ในขอบเขต) + ของเดิมที่อยู่นอกขอบเขต · เก็บ r, km, fin
  const inFlags = await Promise.all((work ?? []).map((w) => routeInScope(userId, w.r)));
  const mine = (work ?? [])
    .filter((_, i) => inFlags[i])
    .map((w) => {
      const x: WorkItem = { r: w.r };
      if (w.km != null) x.km = w.km;
      if (w.fin === true || (w.fin as unknown) === "true") x.fin = true;
      return x;
    });
  const oldFlags = await Promise.all((old?.work ?? []).map((w) => routeInScope(userId, w.r)));
  const preserved = (old?.work ?? []).filter((_, i) => !oldFlags[i]);
  const mergedWork = [...mine, ...preserved];

  // คนงาน
  let c: CrewItem[];
  if (acct) {
    c = crew ?? [];
  } else {
    const dflt = await medianWage(companyId);
    const master = await sql<{ id: string; wage: number }[]>`select id, wage from crew where company_id = ${companyId}`;
    const wageOf = new Map(master.map((k) => [k.id, Number(k.wage)]));
    c = (crew ?? []).map((x) => {
      const prev = x.id
        ? (old?.crew ?? []).find((y) => y.id === x.id)
        : (old?.crew ?? []).find((y) => y.name === x.name);
      const on = x.on ?? false;
      return {
        id: x.id,
        name: x.name,
        on,
        half: on && (x.half ?? false),
        wage: prev?.wage != null ? Number(prev.wage) : (x.id && wageOf.has(x.id) ? wageOf.get(x.id)! : dflt),
        ot: on ? Number(prev?.ot ?? 0) : 0,
      };
    });
  }
  // คนที่จ่ายแล้ว: ใช้ของเดิม
  if (paid.size > 0) {
    c = [
      ...c.filter((x) => !paid.has(x.id ?? "")),
      ...(old?.crew ?? []).filter((y) => paid.has(y.id ?? "")),
    ];
  }

  const orderId = mergedWork.length > 0 ? null : old?.order_id ?? null;
  await sql`
    insert into daily_logs (company_id, log_date, order_id, work, crew, fuel, fuel_car, water, other, note, updated_by)
    values (${companyId}, ${date}, ${orderId}, ${sql.json(mergedWork)}, ${sql.json(c)}, ${fuel ?? 0},
            ${fuelCar ?? old?.fuel_car ?? 0}, ${water ?? old?.water ?? 0}, ${other ?? 0}, ${(note ?? "").slice(0, 500)}, ${userId})
    on conflict (company_id, log_date) do update set
      order_id = excluded.order_id, work = excluded.work, crew = excluded.crew, fuel = excluded.fuel, fuel_car = excluded.fuel_car,
      water = excluded.water, other = excluded.other, note = excluded.note, updated_by = excluded.updated_by
  `;
}

// พอร์ตจาก public.add_crew — หัวหน้าชุดเพิ่มคนงานใหม่จากหน้าบันทึกรายวันได้ (ค่าแรงใช้ค่ากลาง บัญชีแก้ทีหลัง)
export async function addCrew(userId: string, companyId: string, name: string, wage: number | null) {
  if (!(await hasAny(companyId, userId, ["account", "field"]))) throw new Error("ไม่มีสิทธิ์เพิ่มคนงาน");
  const n = (name ?? "").trim();
  if (!n) throw new Error("ใส่ชื่อคนงาน");
  const acct = await hasAny(companyId, userId, ["account"]);
  const w = acct && wage != null ? Math.max(wage, 0) : await medianWage(companyId);
  const [row] = await sql<{ id: string }[]>`
    insert into crew (company_id, name, wage, sort, start_date)
    values (${companyId}, ${n}, ${w},
            coalesce((select max(sort) + 1 from crew where company_id = ${companyId}), 0),
            (now() at time zone 'Asia/Bangkok')::date)
    returning id
  `;
  return row.id;
}
