"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { setRoadLength } from "@/lib/data/routes";
import { cNorm } from "@/lib/model";

export type RoadIn = { id?: string; agency_id: string; hmd: string; code: string; name: string; amp: string; len_km: number | null; map_url?: string; note?: string };
type R = { ok: true; n?: number; id?: string } | { ok: false; error: string };

const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const clean = (r: RoadIn) => ({
  agency_id: r.agency_id,
  hmd: String(r.hmd ?? "").trim(),
  code: String(r.code ?? "").trim(),
  name: String(r.name ?? "").trim(),
  amp: String(r.amp ?? "").trim(),
  len_km: r.len_km == null || !Number.isFinite(Number(r.len_km)) ? null : Number(r.len_km),
  map_url: String(r.map_url ?? "").trim() || null,
  note: String(r.note ?? "").trim(),
});
const errText = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return x?.code === "23505" ? "เลขสายซ้ำกับที่มีในทะเบียนแล้ว" : String(x?.message ?? e);
};

/** เพิ่ม/แก้หลายสายพร้อมกัน (ทะเบียนสายทาง) */
export async function saveRoads(rows: RoadIn[]): Promise<R> {
  const { userId, company, perm } = await requireCompany();
  if (!perm.orders) {
    // คนหน้างาน: แก้ได้แค่ความยาวของสายที่มีอยู่แล้ว
    if (!perm.work) return { ok: false, error: "เฉพาะธุรการหรือเจ้าของที่แก้ทะเบียนสายทางได้" };
    let n = 0;
    for (const r of rows) {
      if (!isUuid(r.id)) return { ok: false, error: "เพิ่มสายใหม่ได้เฉพาะธุรการหรือเจ้าของ" };
      const v = clean(r);
      if (v.len_km != null && v.len_km < 0) return { ok: false, error: `${v.code}: กม. ติดลบไม่ได้` };
      try {
        await setRoadLength(userId, r.id, v.len_km);
      } catch (e) {
        revalidatePath("/", "layout");
        return { ok: false, error: `บันทึกได้ ${n} สาย แล้วติดที่ ${v.code}: ${errText(e)}` };
      }
      n++;
    }
    revalidatePath("/", "layout");
    return { ok: true, n };
  }
  const L = rows.map((r) => ({ id: isUuid(r.id) ? r.id : undefined, ...clean(r) })).filter((r) => r.code);
  if (!L.length) return { ok: false, error: "ยังไม่มีแถวที่จะบันทึก" };
  const seen = new Set<string>();
  for (const r of L) {
    if (!isUuid(r.agency_id)) return { ok: false, error: `${r.code}: เลือกแขวง` };
    const k = r.agency_id + "|" + cNorm(r.code);
    if (seen.has(k)) return { ok: false, error: `${r.code} ซ้ำกันในรายการ` };
    seen.add(k);
    if (r.len_km != null && r.len_km < 0) return { ok: false, error: `${r.code}: กม. ติดลบไม่ได้` };
    if (r.map_url && !/^https?:\/\//i.test(r.map_url)) return { ok: false, error: `${r.code}: ลิงก์ต้องขึ้นต้นด้วย https://` };
  }
  // หมวดใหม่ที่ยังไม่อยู่ในแขวง: เพิ่มเข้าแขวงด้วย
  const ags = await sql<{ id: string; hmds: string[] }[]>`select id, hmds from agencies where company_id = ${company.id}`;
  for (const a of ags) {
    const add = [...new Set(L.filter((r) => r.agency_id === a.id && r.hmd && !(a.hmds ?? []).includes(r.hmd)).map((r) => r.hmd))];
    if (add.length) await sql`update agencies set hmds = ${[...(a.hmds ?? []), ...add]} where id = ${a.id} and company_id = ${company.id}`;
  }
  let n = 0;
  for (const r of L) {
    const { id, ...v } = r;
    try {
      if (id) await sql`update roads set ${sql(v)} where id = ${id} and company_id = ${company.id}`;
      else await sql`insert into roads ${sql({ ...v, company_id: company.id })}`;
    } catch (e) {
      revalidatePath("/roads");
      return { ok: false, error: `บันทึกได้ ${n} สาย แล้วติดที่ ${r.code}: ${errText(e)}` };
    }
    n++;
  }
  revalidatePath("/", "layout");
  return { ok: true, n };
}

/** แก้สายเดียว (ช่องด้านขวาของทะเบียน) */
export async function updateRoad(id: string, r: RoadIn): Promise<R> {
  const { userId, company, perm } = await requireCompany();
  if (!isUuid(id)) return { ok: false, error: "ไม่พบสายทาง" };
  const v = clean(r);
  if (!perm.orders) {
    // คนหน้างานใส่ได้แค่ความยาว
    if (!perm.work) return { ok: false, error: "ไม่มีสิทธิ์แก้ทะเบียน" };
    try {
      await setRoadLength(userId, id, v.len_km);
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
    revalidatePath("/", "layout");
    return { ok: true };
  }
  if (!v.code) return { ok: false, error: "เลขสายว่างไม่ได้" };
  if (!isUuid(v.agency_id)) return { ok: false, error: "เลือกแขวง" };
  if (v.map_url && !/^https?:\/\//i.test(v.map_url)) return { ok: false, error: "ลิงก์ต้องขึ้นต้นด้วย https://" };
  try {
    await sql`update roads set ${sql(v)} where id = ${id} and company_id = ${company.id}`;
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteRoad(id: string): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.orders) return { ok: false, error: "ไม่มีสิทธิ์ลบ" };
  if (!isUuid(id)) return { ok: false, error: "ไม่พบสายทาง" };
  const [{ count }] = await sql<{ count: number }[]>`select count(*) as count from routes where road_id = ${id}`;
  if (count) return { ok: false, error: `สายนี้อยู่ใน ${count} งวดแล้ว ลบไม่ได้ (เอาออกจากงวดก่อน)` };
  await sql`delete from roads where id = ${id} and company_id = ${company.id}`;
  revalidatePath("/", "layout");
  return { ok: true };
}

/** ย้ายหลายสายไปหมวดอื่น (ในแขวงเดิมหรือแขวงอื่นของบริษัท) */
export async function moveRoads(ids: string[], agencyId: string, rawHmd: string): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.orders) return { ok: false, error: "เฉพาะธุรการหรือเจ้าของที่ย้ายหมวดได้" };
  const L = [...new Set((ids ?? []).filter(isUuid))];
  if (!L.length) return { ok: false, error: "ยังไม่ได้เลือกสาย" };
  if (!isUuid(agencyId)) return { ok: false, error: "เลือกแขวง" };
  const h = String(rawHmd ?? "").trim().replace(/^หมวด(บำรุงทางหลวงชนบท)?\s*/, "");
  const [a] = await sql<{ id: string; hmds: string[] }[]>`select id, hmds from agencies where id = ${agencyId} and company_id = ${company.id}`;
  if (!a) return { ok: false, error: "ไม่พบแขวง" };
  const rs = await sql<{ id: string; agency_id: string; code: string }[]>`select id, agency_id, code from roads where id in ${sql(L)} and company_id = ${company.id}`;
  if (rs.length !== L.length) return { ok: false, error: "ไม่พบสายทางบางสาย" };
  const cross = rs.filter((r) => r.agency_id !== agencyId);
  if (cross.length) {
    // ย้ายข้ามแขวง: สายที่อยู่ในงวดแล้วย้ายไม่ได้ (งวดผูกกับแขวงเดิม) และเลขสายต้องไม่ซ้ำในแขวงใหม่
    const used = await sql<{ code: string }[]>`select distinct r.code from roads r join routes t on t.road_id = r.id where r.id in ${sql(cross.map((r) => r.id))}`;
    if (used.length) return { ok: false, error: `${used.map((u) => u.code).join(", ")} อยู่ในงวดของแขวงเดิมแล้ว ย้ายข้ามแขวงไม่ได้` };
    const have = await sql<{ code: string }[]>`select code from roads where company_id = ${company.id} and agency_id = ${agencyId}`;
    const hs = new Set(have.map((x) => cNorm(x.code)));
    const dup = cross.filter((r) => hs.has(cNorm(r.code)));
    if (dup.length) return { ok: false, error: `${dup.map((r) => r.code).join(", ")} มีอยู่ในแขวงปลายทางแล้ว` };
  }
  if (h && !(a.hmds ?? []).includes(h)) await sql`update agencies set hmds = ${[...(a.hmds ?? []), h]} where id = ${agencyId} and company_id = ${company.id}`;
  try {
    await sql`update roads set agency_id = ${agencyId}, hmd = ${h} where id in ${sql(L)} and company_id = ${company.id}`;
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, n: L.length };
}

/** เพิ่มหมวดเข้าแขวง */
export async function addHmd(agencyId: string, raw: string): Promise<R> {
  const { company, perm } = await requireCompany();
  if (!perm.orders) return { ok: false, error: "ไม่มีสิทธิ์" };
  if (!isUuid(agencyId)) return { ok: false, error: "ไม่พบแขวง" };
  const h = String(raw ?? "").trim().replace(/^หมวด(บำรุงทางหลวงชนบท)?\s*/, "");
  if (!h) return { ok: false, error: "ใส่ชื่อหมวด" };
  const [a] = await sql<{ hmds: string[] }[]>`select hmds from agencies where id = ${agencyId} and company_id = ${company.id}`;
  if (!a) return { ok: false, error: "ไม่พบแขวง" };
  if ((a.hmds ?? []).includes(h)) return { ok: true };
  await sql`update agencies set hmds = ${[...(a.hmds ?? []), h]} where id = ${agencyId} and company_id = ${company.id}`;
  revalidatePath("/", "layout");
  return { ok: true };
}
