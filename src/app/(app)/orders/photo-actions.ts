"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db/sql";
import { removeFiles } from "@/lib/data/files";
import { setRouteLength as setRouteLengthDb, setRouteStatus as setRouteStatusDb } from "@/lib/data/routes";
import { buildPack } from "@/lib/pack";

type R = { error?: string };
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);

export type NewPhoto = { path: string; kind: "b" | "a"; w: number; h: number; taken_date: string; taken_time: string; name: string; caption?: string };

/** บันทึกรูปที่อัปโหลดเข้าที่เก็บแล้ว */
export async function addPhotos(orderId: string, routeId: string, list: NewPhoto[]): Promise<R> {
  const { company } = await requireCompany();
  const prefix = `${company.id}/photos/${orderId}/`;
  const rows = list
    .filter((p) => typeof p.path === "string" && p.path.startsWith(prefix) && (p.kind === "a" || p.kind === "b"))
    .map((p, i) => ({
      company_id: company.id, order_id: orderId, route_id: routeId, kind: p.kind, path: p.path,
      w: Math.round(Number(p.w) || 0) || null, h: Math.round(Number(p.h) || 0) || null,
      taken_date: isDate(p.taken_date) ? p.taken_date : null, taken_time: isTime(p.taken_time) ? p.taken_time : null,
      name: String(p.name || "").slice(0, 200), caption: String(p.caption || "").slice(0, 300), sort: i,
    }));
  if (!rows.length) return { error: "ไม่มีรูปที่บันทึกได้" };
  try {
    await sql`insert into route_photos ${sql(rows)}`;
  } catch (e) {
    await removeFiles(rows.map((r) => r.path));
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(`/orders/${orderId}`, "layout");
  return {};
}

export async function updatePhoto(id: string, patch: { caption?: string; taken_date?: string; kind?: "a" | "b" }): Promise<R> {
  const { company } = await requireCompany();
  const p: Record<string, unknown> = {};
  if (patch.caption !== undefined) p.caption = String(patch.caption).slice(0, 300);
  if (patch.taken_date !== undefined) p.taken_date = isDate(patch.taken_date) ? patch.taken_date : null;
  if (patch.kind === "a" || patch.kind === "b") p.kind = patch.kind;
  if (!Object.keys(p).length) return {};
  const rows = await sql<{ order_id: string }[]>`
    update route_photos set ${sql(p, ...Object.keys(p))} where id = ${id} and company_id = ${company.id} returning order_id
  `;
  if (rows[0]) revalidatePath(`/orders/${rows[0].order_id}`, "layout");
  return {};
}

/** เลื่อนลำดับรูป (ใช้จับคู่ก่อน/หลังในรายงาน) */
export async function reorderPhotos(ids: string[]): Promise<R> {
  const { company } = await requireCompany();
  for (let i = 0; i < ids.length; i++) {
    await sql`update route_photos set sort = ${i} where id = ${ids[i]} and company_id = ${company.id}`;
  }
  return {};
}

export async function deletePhoto(id: string): Promise<R> {
  const { company } = await requireCompany();
  const rows = await sql<{ path: string; order_id: string }[]>`
    delete from route_photos where id = ${id} and company_id = ${company.id} returning path, order_id
  `;
  if (rows[0]) {
    await removeFiles([rows[0].path]);
    revalidatePath(`/orders/${rows[0].order_id}`, "layout");
  }
  return {};
}

export async function setRouteStatus(routeId: string, done: boolean | null, doneDate: string): Promise<R> {
  const session = await getSession();
  if (!session) return { error: "ต้องเข้าสู่ระบบก่อน" };
  try {
    await setRouteStatusDb(session.userId, routeId, done, isDate(doneDate) ? doneDate : null);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

/** ความยาวสาย (กม.) ใช้ดูความคืบหน้าเท่านั้น ไม่เกี่ยวกับ ตร.ม. ที่คิดเงิน */
export async function setRouteLength(routeId: string, km: string): Promise<R> {
  const session = await getSession();
  if (!session) return { error: "ต้องเข้าสู่ระบบก่อน" };
  const t = String(km ?? "").replace(/,/g, "").trim();
  const v = t === "" ? null : Number(t);
  if (v !== null && (!Number.isFinite(v) || v < 0)) return { error: "ใส่ความยาวเป็นตัวเลข กม." };
  try {
    await setRouteLengthDb(session.userId, routeId, v);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

/** ข้อมูลพิมพ์ (โหลดเมื่อกดปุ่ม PDF) */
export async function getPack(orderIds: string[], onlyRoute?: string) {
  const { perm } = await requireCompany();
  // ใบสรุปงวดและชุดส่งงวดมีราคา: เฉพาะคนที่เห็นราคา (รายงานรูปสายเดียวไม่มีราคา)
  if (!onlyRoute && !perm.prices) throw new Error("ไม่มีสิทธิ์ดูราคา");
  return buildPack(orderIds, onlyRoute);
}
