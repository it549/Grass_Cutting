import "server-only";
import { cache } from "react";
import type { PendingQuery, Row } from "postgres";
import { sql } from "@/lib/db/sql";
import type { Role } from "@/lib/types";
import { hasAnyRole, inScopeFor } from "./perm-db";

// แทน view ของ Supabase (routes_v, crew_v, daily_v, crew_pays_v) ที่เคยซ่อนข้อมูลตามสิทธิ์ด้วย auth.uid()
// ตอนนี้รับ roles/scope ของผู้ใช้ปัจจุบัน (จาก requireCompany()) แล้วกรอง/ซ่อนในโค้ดแทน

export type Who = { companyId: string; roles: Role[]; scope: string[] };
type Frag = PendingQuery<Row[]>;
const none = () => sql``;

/** สายทางทั้งหมดของบริษัท → แขวง/หมวด (ใช้ตรวจขอบเขต) อ่านครั้งเดียวต่อคำขอ */
const routeScopeMap = cache(async (companyId: string) => {
  const rows = await sql<{ id: string; agency_id: string; hmd: string }[]>`
    select r.id, o.agency_id, o.hmd from routes r join orders o on o.id = r.order_id where r.company_id = ${companyId}
  `;
  return new Map(rows.map((r) => [r.id, r]));
});

/** สายนี้อยู่ในขอบเขตของผู้ใช้ไหม (สายที่ถูกลบไปแล้ว = ไม่อยู่) */
export async function routeScopeTest(w: Who) {
  const m = await routeScopeMap(w.companyId);
  return (routeId: string) => {
    const r = m.get(routeId);
    return !!r && inScopeFor(w.roles, w.scope, r.agency_id, r.hmd);
  };
}

export type RouteV = {
  id: string; order_id: string; company_id: string; seq: number; code: string; descr: string; area: number;
  rate: number | null; done: boolean | null; done_date: string | null; length_km: number | null; created_at: string;
  road_id: string | null; in_po: boolean;
};
/** routes_v: ราคาเห็นเฉพาะธุรการ/บัญชี · ความยาวเอาจากทะเบียนก่อน · เฉพาะในขอบเขต */
export async function routesV(w: Who, where: Frag = none(), order: Frag = sql`order by r.seq`) {
  const seeRate = hasAnyRole(w.roles, ["office", "account"]);
  const rows = await sql<(RouteV & { agency_id: string; hmd: string })[]>`
    select r.id, r.order_id, r.company_id, r.seq, r.code, r.descr, r.area, r.rate, r.done, r.done_date,
           coalesce(g.len_km, r.length_km) as length_km, r.created_at, r.road_id, r.in_po, o.agency_id, o.hmd
    from routes r join orders o on o.id = r.order_id left join roads g on g.id = r.road_id
    where r.company_id = ${w.companyId} ${where}
    ${order}
  `;
  return rows
    .filter((r) => inScopeFor(w.roles, w.scope, r.agency_id, r.hmd))
    .map(({ agency_id: _a, hmd: _h, ...r }) => { void _a; void _h; return { ...r, rate: seeRate ? r.rate : null }; });
}

export type CrewV = {
  id: string; company_id: string; name: string; nick: string; role: string; phone: string; sort: number; active: boolean;
  start_date: string | null; note: string; created_at: string; wage: number | null; pay_by: string | null; pay_no: string | null;
};
/** crew_v: คนอื่นเห็นชื่อ ชื่อเล่น ตำแหน่ง โทร · ค่าแรงและเลขบัญชีเห็นเฉพาะบัญชี */
export async function crewV(w: Who, where: Frag = none()) {
  const acct = hasAnyRole(w.roles, ["account"]);
  const rows = await sql<CrewV[]>`
    select id, company_id, name, nick, role, phone, sort, active, start_date, note, created_at, wage, pay_by, pay_no
    from crew where company_id = ${w.companyId} ${where}
    order by sort, created_at
  `;
  return rows.map((c) => (acct ? c : { ...c, wage: null, pay_by: null, pay_no: null }));
}

export type WorkJ = { r: string; km?: number | null; fin?: boolean };
export type CrewJ = { id?: string; name: string; on?: boolean; half?: boolean; wage?: number; ot?: number };
export type DailyV = {
  company_id: string; log_date: string; order_id: string | null; work: WorkJ[]; route_ids: string[]; crew: CrewJ[];
  fuel: number | null; fuel_car: number | null; water: number | null; other: number | null; note: string; updated_at: string;
};
/** daily_v: งานเฉพาะสายในขอบเขต · ค่าแรง/OT เห็นเฉพาะบัญชี · เงินน้ำมัน/ค่าน้ำ/อื่นๆ เห็นเฉพาะบัญชี/หัวหน้าชุด */
export async function dailyV(w: Who, where: Frag = none(), order: Frag = sql`order by log_date`) {
  const acct = hasAnyRole(w.roles, ["account"]);
  const money = hasAnyRole(w.roles, ["account", "field"]);
  const [rows, ok] = await Promise.all([
    sql<DailyV[]>`
      select company_id, log_date, order_id, work, crew, fuel, fuel_car, water, other, note, updated_at
      from daily_logs where company_id = ${w.companyId} ${where}
      ${order}
    `,
    routeScopeTest(w),
  ]);
  return rows.map((d) => {
    const work = (d.work ?? []).filter((x) => ok(x.r));
    return {
      ...d,
      work,
      route_ids: work.map((x) => x.r),
      crew: acct ? d.crew ?? [] : (d.crew ?? []).map(({ wage: _w, ot: _o, ...c }) => { void _w; void _o; return c; }),
      fuel: money ? d.fuel : null,
      fuel_car: money ? d.fuel_car : null,
      water: money ? d.water : null,
      other: money ? d.other : null,
    };
  });
}

/** crew_pays_v: ทุกคนรู้ว่าใครจ่ายแล้ว (ล็อกวันในรายวัน) · ยอดหักเบิกเห็นเฉพาะบัญชี/หัวหน้าชุด */
export async function crewPaysV(w: Who, where: Frag = none()) {
  const see = hasAnyRole(w.roles, ["account", "field"]);
  const rows = await sql<{ company_id: string; week_start: string; crew_id: string; pay_date: string; ded: number | null }[]>`
    select company_id, week_start, crew_id, pay_date, ded from crew_pays where company_id = ${w.companyId} ${where}
    order by week_start
  `;
  return rows.map((p) => (see ? p : { ...p, ded: null }));
}
