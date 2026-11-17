import "server-only";
import { sql } from "@/lib/db/sql";
import { hasAny, routeInScope } from "./perm-db";

type WorkItem = { r: string; km: number | null };
type CrewItem = { id?: string; name: string; on?: boolean; wage?: number; ot?: number };
type DailyRow = {
  company_id: string;
  log_date: string;
  order_id: string | null;
  work: WorkItem[];
  crew: CrewItem[];
  fuel: number;
  other: number;
  note: string;
};

function medianWage(wages: number[]) {
  if (!wages.length) return 0;
  const sorted = [...wages].sort((a, b) => a - b);
  const idx = Math.ceil(0.5 * sorted.length) - 1;
  return sorted[idx];
}

// พอร์ตจาก public.save_daily(p_company, p_date, p_work, p_crew, p_fuel, p_other, p_note)
// เดิมใช้ auth.uid() ทั้งตรวจสิทธิ์ (has_any/route_in_scope) และเป็น updated_by ตอนนี้รับ userId ตรงๆ
export async function saveDaily(
  userId: string,
  companyId: string,
  date: string,
  work: WorkItem[],
  crew: CrewItem[],
  fuel: number | null,
  other: number | null,
  note: string | null,
) {
  if (!(await hasAny(companyId, userId, ["account", "field"]))) throw new Error("ไม่มีสิทธิ์บันทึกรายวัน");
  if (!date) throw new Error("วันที่ไม่ถูกต้อง");

  const [old] = await sql<DailyRow[]>`select * from daily_logs where company_id = ${companyId} and log_date = ${date}`;
  const acct = await hasAny(companyId, userId, ["account"]);

  const inScopeFlags = await Promise.all((work ?? []).map((w) => routeInScope(userId, w.r)));
  const mine = (work ?? []).filter((_, i) => inScopeFlags[i]);
  const oldOutOfScopeFlags = await Promise.all((old?.work ?? []).map((w) => routeInScope(userId, w.r)));
  const preserved = (old?.work ?? []).filter((_, i) => !oldOutOfScopeFlags[i]);
  const mergedWork = [...mine, ...preserved];

  let mergedCrew: CrewItem[];
  if (acct) {
    mergedCrew = crew ?? [];
  } else {
    const activeCrew = await sql<{ id: string; name: string; wage: number }[]>`
      select id, name, wage from crew where company_id = ${companyId} and active = true
    `;
    const crewById = new Map(activeCrew.map((k) => [k.id, k]));
    const dflt = medianWage(activeCrew.map((k) => Number(k.wage)));
    mergedCrew = (crew ?? []).map((x) => {
      const prev = x.id
        ? (old?.crew ?? []).find((y) => y.id === x.id)
        : (old?.crew ?? []).find((y) => y.name === x.name);
      const master = x.id ? crewById.get(x.id) : undefined;
      return {
        id: x.id,
        name: x.name,
        on: x.on ?? false,
        wage: prev?.wage ?? (master ? Number(master.wage) : dflt),
        ot: prev?.ot ?? 0,
      };
    });
  }

  const orderId = mergedWork.length > 0 ? null : old?.order_id ?? null;
  const trimmedNote = (note ?? "").slice(0, 500);

  await sql`
    insert into daily_logs (company_id, log_date, order_id, work, crew, fuel, other, note, updated_by)
    values (${companyId}, ${date}, ${orderId}, ${sql.json(mergedWork)}, ${sql.json(mergedCrew)}, ${fuel ?? 0}, ${other ?? 0}, ${trimmedNote}, ${userId})
    on conflict (company_id, log_date) do update set
      order_id = excluded.order_id, work = excluded.work, crew = excluded.crew, fuel = excluded.fuel,
      other = excluded.other, note = excluded.note, updated_by = excluded.updated_by
  `;
}
