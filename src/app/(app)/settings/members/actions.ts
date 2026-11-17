"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { COMPANY_COOKIE, requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { ROLES, type Role } from "@/lib/types";
import { done } from "@/lib/flash";

const P = "/settings/members";

/** บทบาทจากช่องติ๊ก (คำเชิญตั้งเป็นเจ้าของไม่ได้ ต้องเข้ามาก่อนแล้วค่อยตั้ง) */
function readRoles(formData: FormData, allowOwner: boolean): Role[] {
  const rs = formData.getAll("roles").map(String).filter((r): r is Role => (ROLES as string[]).includes(r));
  return [...new Set(rs)].filter((r) => allowOwner || r !== "owner");
}

/** ขอบเขตแขวง/หมวด: เก็บเฉพาะแขวงของบริษัทนี้ ถ้าติ๊กทั้งแขวงไม่ต้องเก็บหมวดของแขวงนั้น */
async function readScope(formData: FormData, roles: Role[]) {
  if (roles.some((r) => r === "owner" || r === "office" || r === "account")) return [];
  const { company } = await requireCompany();
  const ags = await sql<{ id: string; hmds: string[] }[]>`select id, hmds from agencies where company_id = ${company.id}`;
  const A = new Map(ags.map((a) => [a.id, a.hmds ?? []]));
  const raw = [...new Set(formData.getAll("scope").map(String))];
  const whole = new Set(raw.filter((s) => !s.includes("|") && A.has(s)));
  return raw.filter((s) => {
    if (!s.includes("|")) return whole.has(s);
    const [ag, h] = s.split("|");
    return A.has(ag) && A.get(ag)!.includes(h) && !whole.has(ag);
  });
}

export async function invite(formData: FormData) {
  const { company, perm } = await requireCompany();
  if (!perm.members) done(P, "เฉพาะเจ้าของที่เชิญสมาชิกได้", true);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) done(P, "อีเมลไม่ถูกต้อง", true);
  const roles = readRoles(formData, false);
  if (!roles.length) done(P, "เลือกบทบาทอย่างน้อย 1 อย่าง", true);
  const scope = await readScope(formData, roles);
  await sql`
    insert into invites (company_id, email, roles, scope) values (${company.id}, ${email}, ${roles}, ${scope})
    on conflict (company_id, email) do update set roles = excluded.roles, scope = excluded.scope
  `;
  revalidatePath(P);
  done(P, `เชิญ ${email} แล้ว ให้เขาสมัครหรือเข้าสู่ระบบด้วยอีเมลนี้`);
}

export async function cancelInvite(formData: FormData) {
  const { company, perm } = await requireCompany();
  if (!perm.members) done(P, "เฉพาะเจ้าของที่จัดการคำเชิญได้", true);
  await sql`delete from invites where id = ${String(formData.get("id"))} and company_id = ${company.id}`;
  revalidatePath(P);
  done(P, "ยกเลิกคำเชิญแล้ว");
}

export async function setMember(formData: FormData) {
  const { company, perm } = await requireCompany();
  if (!perm.members) done(P, "เฉพาะเจ้าของที่เปลี่ยนบทบาทได้", true);
  const roles = readRoles(formData, true);
  if (!roles.length) done(P, "เลือกบทบาทอย่างน้อย 1 อย่าง", true);
  const scope = await readScope(formData, roles);
  const rows = await sql<{ user_id: string }[]>`
    update company_members set roles = ${roles}, scope = ${scope}
    where company_id = ${company.id} and user_id = ${String(formData.get("user_id"))}
    returning user_id
  `;
  if (!rows.length) done(P, "คุณไม่มีสิทธิ์เปลี่ยนบทบาทของคนนี้", true);
  revalidatePath("/", "layout");
  done(P, "บันทึกบทบาทแล้ว");
}

export async function removeMember(formData: FormData) {
  const { company, userId } = await requireCompany();
  const uid = String(formData.get("user_id"));
  const rows = await sql<{ user_id: string }[]>`
    delete from company_members where company_id = ${company.id} and user_id = ${uid} returning user_id
  `;
  if (!rows.length) done(P, "คุณไม่มีสิทธิ์นำคนนี้ออก", true);
  if (uid === userId) {
    (await cookies()).delete(COMPANY_COOKIE);
    redirect("/");
  }
  revalidatePath(P);
  done(P, "นำออกจากบริษัทแล้ว");
}
