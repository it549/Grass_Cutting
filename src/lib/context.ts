import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db/sql";
import { fileUrl } from "@/lib/data/files";
import type { Who } from "@/lib/data/views";
import { perms, type Company, type Role } from "@/lib/types";

export const COMPANY_COOKIE = "gc_company";

export type Membership = { roles: Role[]; scope: string[]; company: Company };

// ผู้ใช้ปัจจุบัน + บริษัทที่เป็นสมาชิก + บริษัทที่เลือกอยู่
export const getContext = cache(async () => {
  const session = await getSession();
  if (!session) redirect("/login");
  const { userId, email } = session;

  let rows: ({ roles: Role[]; scope: string[] } & Company)[];
  try {
    rows = await sql<({ roles: Role[]; scope: string[] } & Company)[]>`
      select cm.roles, cm.scope, c.*
      from company_members cm
      join companies c on c.id = cm.company_id
      where cm.user_id = ${userId}
      order by cm.created_at
    `;
  } catch (e) {
    // ฐานข้อมูลยังไม่ตรงกับโค้ด หรือต่อ PostgreSQL ไม่ได้: ไปหน้าบอกวิธีแก้ แทนหน้า error
    const err = e as { code?: string; message?: string };
    redirect(`/setup?code=${encodeURIComponent(err.code ?? "")}&e=${encodeURIComponent(String(err.message ?? e).slice(0, 300))}`);
  }
  const memberships: Membership[] = rows.map(({ roles, scope, ...company }) => ({
    roles,
    scope,
    company: company as Company,
  }));

  const store = await cookies();
  const wanted = store.get(COMPANY_COOKIE)?.value;
  const active = memberships.find((m) => m.company.id === wanted) ?? memberships[0] ?? null;

  return { userId, email, memberships, active };
});

// ใช้ในหน้าที่ต้องมีบริษัทแล้ว
export async function requireCompany() {
  const ctx = await getContext();
  if (!ctx.active) redirect("/onboarding");
  const { roles, scope } = ctx.active;
  const company = ctx.active.company;
  const who: Who = { companyId: company.id, roles, scope };
  return { ...ctx, company, roles, scope, who, perm: perms(roles, scope) };
}

export async function logoUrl(path: string | null | undefined) {
  if (!path) return null;
  return fileUrl(path);
}
