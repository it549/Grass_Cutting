import "server-only";
import { sql } from "@/lib/db/sql";
import { canWork, hasAny, routeInScope } from "./perm-db";

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

// พอร์ตจาก public.set_route_length (0010) — ความยาวสายแก้ได้เฉพาะเจ้าของ ถ้าสายผูกกับทะเบียน เก็บที่ทะเบียน
export async function setRouteLength(userId: string, routeId: string, km: number | null) {
  if (km != null && km < 0) throw new Error("ความยาวติดลบไม่ได้");
  const [route] = await sql<{ company_id: string; road_id: string | null }[]>`select company_id, road_id from routes where id = ${routeId}`;
  if (!route || !(await hasAny(route.company_id, userId, ["owner"]))) throw new Error("ความยาวสายแก้ได้เฉพาะเจ้าของ (CEO)");
  if (route.road_id) await sql`update roads set len_km = ${km} where id = ${route.road_id}`;
  else await sql`update routes set length_km = ${km} where id = ${routeId}`;
}

// พอร์ตจาก public.set_road_length (0010) — เจ้าของเท่านั้น
export async function setRoadLength(userId: string, roadId: string, km: number | null) {
  if (km != null && km < 0) throw new Error("ความยาวติดลบไม่ได้");
  const [g] = await sql<{ company_id: string }[]>`select company_id from roads where id = ${roadId}`;
  if (!g || !(await hasAny(g.company_id, userId, ["owner"]))) throw new Error("ความยาวสายแก้ได้เฉพาะเจ้าของ (CEO)");
  await sql`update roads set len_km = ${km} where id = ${roadId}`;
}
