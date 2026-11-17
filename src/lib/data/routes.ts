import "server-only";
import { sql } from "@/lib/db/sql";
import { canWork, inScope, routeInScope } from "./perm-db";

async function assertRouteWritable(userId: string, routeId: string) {
  const [route] = await sql<{ company_id: string; road_id: string | null }[]>`select company_id, road_id from routes where id = ${routeId}`;
  if (!route) throw new Error("ไม่พบสายทาง หรือไม่มีสิทธิ์");
  const ok = (await canWork(route.company_id, userId)) && (await routeInScope(userId, routeId));
  if (!ok) throw new Error("ไม่พบสายทาง หรือไม่มีสิทธิ์");
  return route;
}

// พอร์ตจาก public.set_route_status(p_route, p_done, p_done_date)
export async function setRouteStatus(userId: string, routeId: string, done: boolean | null, doneDate: string | null) {
  await assertRouteWritable(userId, routeId);
  await sql`update routes set done = ${done}, done_date = ${doneDate} where id = ${routeId}`;
}

// พอร์ตจาก public.set_route_length (รุ่น 0006) — ถ้าสายผูกกับทะเบียน เก็บความยาวที่ทะเบียน
export async function setRouteLength(userId: string, routeId: string, km: number | null) {
  if (km != null && km < 0) throw new Error("ความยาวติดลบไม่ได้");
  const route = await assertRouteWritable(userId, routeId);
  if (route.road_id) await sql`update roads set len_km = ${km} where id = ${route.road_id}`;
  else await sql`update routes set length_km = ${km} where id = ${routeId}`;
}

// พอร์ตจาก public.set_road_length — ทุกบทบาทที่ทำงานหน้างานใส่ได้ (ภายในขอบเขต)
export async function setRoadLength(userId: string, roadId: string, km: number | null) {
  if (km != null && km < 0) throw new Error("ความยาวติดลบไม่ได้");
  const [g] = await sql<{ company_id: string; agency_id: string; hmd: string }[]>`select company_id, agency_id, hmd from roads where id = ${roadId}`;
  const ok = g && (await canWork(g.company_id, userId)) && (await inScope(g.company_id, userId, g.agency_id, g.hmd));
  if (!ok) throw new Error("ไม่พบสายทาง หรือไม่มีสิทธิ์");
  await sql`update roads set len_km = ${km} where id = ${roadId}`;
}
