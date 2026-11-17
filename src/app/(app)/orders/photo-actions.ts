"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { removeFiles } from "@/lib/data/files";
import { inScopeFor } from "@/lib/data/perm-db";
import { setRouteLength as setRouteLengthDb } from "@/lib/data/routes";
import { buildPack } from "@/lib/pack";

type R = { error?: string };
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type NewPhoto = {
  path: string; w: number; h: number; taken_date: string; taken_time: string; name: string; sig: string;
  /** ใช้ตอนย้ายข้อมูลจากระบบเดิม: ช่องที่วางไว้ หรือชนิดรูปรุ่นเก่า (b/a) */
  slot?: string | null; kind?: string; caption?: string;
};
const SLOT = /^[baLR]\|\d+$/;

/** แทน RLS เดิมของ route_photos: ต้องเป็นบทบาทที่ทำงานหน้างาน และสายต้องอยู่ในบริษัท/ขอบเขตของผู้ใช้ */
async function workRoute(routeId: string) {
  const { company, perm, roles, scope } = await requireCompany();
  if (!perm.work) return { error: "ไม่มีสิทธิ์แก้รูปหรือสายทาง" } as const;
  if (!isUuid(routeId)) return { error: "ไม่พบสายทาง" } as const;
  const [r] = await sql<{ order_id: string; agency_id: string; hmd: string }[]>`
    select r.order_id, o.agency_id, o.hmd from routes r join orders o on o.id = r.order_id
    where r.id = ${routeId} and r.company_id = ${company.id}
  `;
  if (!r || !inScopeFor(roles, scope, r.agency_id, r.hmd)) return { error: "ไม่พบสายทาง หรือไม่มีสิทธิ์" } as const;
  return { company, orderId: r.order_id } as const;
}

/** บันทึกรูปที่อัปโหลดเข้าที่เก็บแล้ว: เข้าถาด หรือวางลงช่องที่ระบุ (รูปแรก) · ข้ามรูปซ้ำ (ลายมือไฟล์เดียวกัน) */
export async function addPhotos(orderId: string, routeId: string, list: NewPhoto[], slot?: string): Promise<R & { skipped?: number }> {
  const g = await workRoute(routeId);
  if ("error" in g) return { error: g.error };
  const { company } = g;
  if (g.orderId !== orderId) return { error: "สายทางนี้ไม่ใช่ของใบสั่งจ้างนี้" };
  const prefix = `${company.id}/photos/${orderId}/`;
  const have = await sql<{ slot: string | null; sig: string | null }[]>`
    select slot, sig from route_photos where route_id = ${routeId} and company_id = ${company.id}
  `;
  const sigs = new Set(have.map((h) => h.sig).filter(Boolean)), used = new Set(have.map((h) => h.slot).filter(Boolean));
  const skip: string[] = [];
  const rows = list
    .filter((p) => typeof p.path === "string" && p.path.startsWith(prefix) && !p.path.includes(".."))
    .filter((p) => { const s = String(p.sig || ""); if (s && sigs.has(s)) { skip.push(p.path); return false; } if (s) sigs.add(s); return true; })
    .map((p, i) => {
      const sl = p.slot && SLOT.test(p.slot) && !used.has(p.slot) ? p.slot : null;
      if (sl) used.add(sl);
      const kind = sl ? sl[0] : p.kind === "b" || p.kind === "a" ? p.kind : "t";
      return {
        company_id: company.id, order_id: orderId, route_id: routeId, kind, slot: sl, path: p.path,
        w: Math.round(Number(p.w) || 0) || null, h: Math.round(Number(p.h) || 0) || null,
        taken_date: isDate(p.taken_date) ? p.taken_date : null, taken_time: isTime(p.taken_time) ? p.taken_time : null,
        name: String(p.name || "").slice(0, 200), caption: String(p.caption || "").slice(0, 300), sig: String(p.sig || "").slice(0, 300) || null, sort: i,
      };
    });
  if (skip.length) await removeFiles(skip);
  if (!rows.length) return skip.length ? { skipped: skip.length } : { error: "ไม่มีรูปที่บันทึกได้" };
  let ids: { id: string }[];
  try {
    ids = await sql<{ id: string }[]>`insert into route_photos ${sql(rows)} returning id`;
  } catch (e) {
    await removeFiles(rows.map((r) => r.path));
    return { error: msg(e) };
  }
  if (slot && SLOT.test(slot) && ids[0]) {
    try {
      await sql`select public.place_photos(${routeId}, ${sql.json({ [slot]: ids[0].id })})`;
    } catch (e) {
      return { error: msg(e) };
    }
  }
  revalidatePath("/", "layout");
  return { skipped: skip.length };
}

/** วาง/ย้าย/เอารูปออกจากช่อง: map = {"b|500": id หรือ null} */
export async function placePhotos(routeId: string, map: Record<string, string | null>): Promise<R> {
  const g = await workRoute(routeId);
  if ("error" in g) return { error: g.error };
  const m: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    if (!SLOT.test(k)) return { error: "ช่องรูปไม่ถูกต้อง" };
    m[k] = isUuid(v) ? v : null;
  }
  if (!Object.keys(m).length) return {};
  try {
    await sql`select public.place_photos(${routeId}, ${sql.json(m)})`;
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

/** เอารูปออกจากช่องกลับเข้าถาด */
export async function unplacePhoto(routeId: string, photoId: string): Promise<R> {
  const g = await workRoute(routeId);
  if ("error" in g) return { error: g.error };
  if (!isUuid(photoId)) return { error: "ไม่พบรูป" };
  await sql`update route_photos set slot = null, kind = 't' where id = ${photoId} and route_id = ${routeId} and company_id = ${g.company.id}`;
  revalidatePath("/", "layout");
  return {};
}

export async function deletePhoto(id: string): Promise<R> {
  const { company } = await requireCompany();
  if (!isUuid(id)) return { error: "ไม่พบรูป" };
  const [p] = await sql<{ route_id: string }[]>`select route_id from route_photos where id = ${id} and company_id = ${company.id}`;
  if (!p) return { error: "ไม่พบรูป" };
  const g = await workRoute(p.route_id);
  if ("error" in g) return { error: g.error };
  const rows = await sql<{ path: string }[]>`delete from route_photos where id = ${id} and company_id = ${company.id} returning path`;
  if (rows[0]) await removeFiles([rows[0].path]);
  revalidatePath("/", "layout");
  return {};
}

/** แขวงนี้ต้องมีแบบสำรวจ ซ้าย/ขวา ทุก 250 ม. ครบด้วย (ธุรการ/เจ้าของ) */
export async function setPhotoLR(agencyId: string, on: boolean): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.orders) return { error: "เฉพาะธุรการหรือเจ้าของตั้งค่านี้ได้" };
  if (!isUuid(agencyId)) return { error: "ไม่พบแขวง" };
  await sql`update agencies set photo_lr = ${!!on} where id = ${agencyId} and company_id = ${company.id}`;
  revalidatePath("/", "layout");
  return {};
}

/** ความยาวสาย (กม.) ใช้ดูความคืบหน้าเท่านั้น ไม่เกี่ยวกับ ตร.ม. ที่คิดเงิน */
export async function setRouteLength(routeId: string, km: string): Promise<R> {
  const { userId } = await requireCompany();
  const t = String(km ?? "").replace(/,/g, "").trim();
  const v = t === "" ? null : Number(t);
  if (v !== null && (!Number.isFinite(v) || v < 0)) return { error: "ใส่ความยาวเป็นตัวเลข กม." };
  if (!isUuid(routeId)) return { error: "ไม่พบสายทาง" };
  try {
    await setRouteLengthDb(userId, routeId, v);
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

/** ข้อมูลพิมพ์ (โหลดเมื่อกดปุ่ม PDF) */
export async function getPack(orderIds: string[], onlyRoute?: string, photosOnly = false) {
  const { perm } = await requireCompany();
  // ใบสรุปงวดและชุดส่งงวดมีราคา: เฉพาะคนที่เห็นราคา (รายงานภาพถ่ายไม่มีราคา)
  if (!onlyRoute && !photosOnly && !perm.prices) throw new Error("ไม่มีสิทธิ์ดูราคา");
  return buildPack(orderIds, onlyRoute);
}
