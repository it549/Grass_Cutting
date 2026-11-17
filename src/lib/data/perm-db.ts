import "server-only";
import { sql } from "@/lib/db/sql";
import type { Role } from "@/lib/types";

// พอร์ตจาก supabase/setup_all.sql (is_member/has_any/can_work/in_scope/...) — เดิมใช้ auth.uid()
// เป็น "ผู้ใช้ปัจจุบัน" โดยปริยาย ตอนนี้ไม่มี RLS/session context แล้ว จึงรับ userId มาตรงๆเป็น parameter

type Membership = { roles: Role[]; scope: string[] };

async function getMembership(companyId: string, userId: string): Promise<Membership | null> {
  const rows = await sql<Membership[]>`
    select roles, scope from company_members where company_id = ${companyId} and user_id = ${userId}
  `;
  return rows[0] ?? null;
}

export async function isMember(companyId: string, userId: string) {
  return (await getMembership(companyId, userId)) !== null;
}

export async function hasAny(companyId: string, userId: string, want: Role[]) {
  const m = await getMembership(companyId, userId);
  if (!m) return false;
  if (m.roles.includes("owner")) return true;
  return m.roles.some((r) => want.includes(r));
}

export async function canWork(companyId: string, userId: string) {
  return hasAny(companyId, userId, ["office", "account", "field"]);
}

export async function inScope(companyId: string, userId: string, agencyId: string, hmd: string | null) {
  const m = await getMembership(companyId, userId);
  if (!m) return false;
  if (m.roles.includes("owner") || m.roles.includes("office") || m.roles.includes("account")) return true;
  if (m.scope.length === 0) return true;
  if (m.scope.includes(agencyId)) return true;
  if (hmd != null && m.scope.includes(`${agencyId}|${hmd}`)) return true;
  if (hmd == null && m.scope.some((s) => s.split("|")[0] === agencyId)) return true;
  return false;
}

export async function orderInScope(userId: string, orderId: string) {
  const rows = await sql<{ company_id: string; agency_id: string; hmd: string }[]>`
    select company_id, agency_id, hmd from orders where id = ${orderId}
  `;
  const o = rows[0];
  if (!o) return false;
  return inScope(o.company_id, userId, o.agency_id, o.hmd);
}

// เวอร์ชันไม่ query DB — ใช้เมื่อมี roles/scope ของผู้ใช้ปัจจุบันอยู่แล้ว (จาก requireCompany())
export function hasAnyRole(roles: Role[], want: Role[]) {
  if (roles.includes("owner")) return true;
  return roles.some((r) => want.includes(r));
}

export function inScopeFor(roles: Role[], scope: string[], agencyId: string, hmd: string | null) {
  if (hasAnyRole(roles, ["office", "account"])) return true;
  if (scope.length === 0) return true;
  if (scope.includes(agencyId)) return true;
  if (hmd != null && scope.includes(`${agencyId}|${hmd}`)) return true;
  if (hmd == null && scope.some((s) => s.split("|")[0] === agencyId)) return true;
  return false;
}

export async function routeInScope(userId: string, routeId: string) {
  const rows = await sql<{ company_id: string; agency_id: string; hmd: string }[]>`
    select o.company_id, o.agency_id, o.hmd
    from routes r join orders o on o.id = r.order_id
    where r.id = ${routeId}
  `;
  const o = rows[0];
  if (!o) return false;
  return inScope(o.company_id, userId, o.agency_id, o.hmd);
}
