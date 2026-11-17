import "server-only";
import { sql } from "@/lib/db/sql";
import { canWork, routeInScope } from "./perm-db";

async function assertRouteWritable(userId: string, routeId: string) {
  const [route] = await sql<{ company_id: string }[]>`select company_id from routes where id = ${routeId}`;
  if (!route) throw new Error("ไม่พบสายทาง หรือไม่มีสิทธิ์");
  const ok = (await canWork(route.company_id, userId)) && (await routeInScope(userId, routeId));
  if (!ok) throw new Error("ไม่พบสายทาง หรือไม่มีสิทธิ์");
}

// พอร์ตจาก public.set_route_status(p_route, p_done, p_done_date)
export async function setRouteStatus(userId: string, routeId: string, done: boolean | null, doneDate: string | null) {
  await assertRouteWritable(userId, routeId);
  await sql`update routes set done = ${done}, done_date = ${doneDate} where id = ${routeId}`;
}

// พอร์ตจาก public.set_route_length(p_route, p_km)
export async function setRouteLength(userId: string, routeId: string, km: number | null) {
  if (km != null && km < 0) throw new Error("ความยาวติดลบไม่ได้");
  await assertRouteWritable(userId, routeId);
  await sql`update routes set length_km = ${km} where id = ${routeId}`;
}
