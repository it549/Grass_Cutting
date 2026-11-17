import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db/sql";
import { fileUrl } from "@/lib/data/files";
import { perms, type Company, type Role } from "@/lib/types";

export const COMPANY_COOKIE = "gc_company";

export type Membership = { roles: Role[]; scope: string[]; company: Company };

// ผู้ใช้ปัจจุบัน + บริษัทที่เป็นสมาชิก + บริษัทที่เลือกอยู่
export const getContext = cache(async () => {
  const session = await getSession();
  if (!session) redirect("/login");
  const { userId, email } = session;

  const rows = await sql<({ roles: Role[]; scope: string[] } & Company)[]>`
    select cm.roles, cm.scope, c.*
    from company_members cm
    join companies c on c.id = cm.company_id
    where cm.user_id = ${userId}
    order by cm.created_at
  `;
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
  return { ...ctx, company: ctx.active.company, roles, scope, perm: perms(roles, scope) };
}

export async function logoUrl(path: string | null | undefined) {
  if (!path) return null;
  return fileUrl(path);
}
