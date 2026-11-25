import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db/sql";

const CODE_RE = /^[A-Za-z0-9]{16,64}$/;
export const validCode = (c: string) => CODE_RE.test(c);

/** ลิงก์ชวนปัจจุบันของบริษัท (ไม่มี = null) */
export async function getJoinCode(companyId: string) {
  const [r] = await sql<{ code: string }[]>`select code from company_join where company_id = ${companyId}`;
  return r?.code ?? null;
}

/** สร้างลิงก์ใหม่ (ลิงก์เก่าใช้ไม่ได้ทันที) */
export async function resetJoinCode(companyId: string) {
  const code = randomBytes(16).toString("hex");
  await sql`
    insert into company_join (company_id, code) values (${companyId}, ${code})
    on conflict (company_id) do update set code = excluded.code, created_at = now()
  `;
  return code;
}

export async function closeJoinCode(companyId: string) {
  await sql`delete from company_join where company_id = ${companyId}`;
}

/** ชื่อบริษัทของลิงก์ชวน (ไม่พบ = null) */
export async function joinInfo(code: string) {
  if (!validCode(code)) return null;
  const [r] = await sql<{ name: string }[]>`
    select c.name from company_join j join companies c on c.id = j.company_id where j.code = ${code}
  `;
  return r?.name ?? null;
}

/** สมัครได้เฉพาะ: ระบบใหม่ที่ยังไม่มีบริษัท / มีลิงก์ชวนที่ใช้ได้ / อีเมลนี้มีคำเชิญรออยู่ */
export async function signupAllowed(email: string, code: string) {
  const [r] = await sql<{ ok: boolean }[]>`
    select (
      not exists (select 1 from companies)
      or (${code} <> '' and exists (select 1 from company_join where code = ${code}))
      or exists (select 1 from invites where email = ${email.trim().toLowerCase()})
    ) as ok
  `;
  return Boolean(r?.ok);
}

export type JoinResult = { status: "member" | "pending"; companyId: string; name: string } | null;

/** ส่งคำขอเข้าร่วมจากลิงก์ชวน (ซ้ำได้ ไม่สร้างคำขอซ้อน) */
export async function requestJoin(userId: string, email: string, code: string): Promise<JoinResult> {
  if (!validCode(code)) return null;
  const [j] = await sql<{ company_id: string; name: string }[]>`
    select j.company_id, c.name from company_join j join companies c on c.id = j.company_id where j.code = ${code}
  `;
  if (!j) return null;
  const [m] = await sql`select 1 from company_members where company_id = ${j.company_id} and user_id = ${userId}`;
  if (m) return { status: "member", companyId: j.company_id, name: j.name };
  await sql`
    insert into join_requests (company_id, user_id, email, full_name, company_name)
    select ${j.company_id}, ${userId}, ${email.toLowerCase()}, coalesce((select full_name from users where id = ${userId}), ''), ${j.name}
    on conflict (company_id, user_id) do nothing
  `;
  return { status: "pending", companyId: j.company_id, name: j.name };
}

export async function listJoinRequests(companyId: string) {
  return sql<{ id: string; email: string; full_name: string; created_at: string }[]>`
    select id, email, full_name, created_at from join_requests where company_id = ${companyId} order by created_at
  `;
}

export async function pendingJoins(companyId: string) {
  const [r] = await sql<{ n: number }[]>`select count(*) as n from join_requests where company_id = ${companyId}`;
  return Number(r?.n ?? 0);
}

/** อนุมัติ: ผู้เรียกต้องตรวจว่าเป็นเจ้าของของบริษัทนี้แล้ว (ตั้งเป็นเจ้าของไม่ได้) */
export async function approveJoin(companyId: string, id: string, roles: string[], scope: string[]) {
  return sql.begin(async (tx) => {
    const [r] = await tx<{ user_id: string }[]>`
      delete from join_requests where id = ${id} and company_id = ${companyId} returning user_id
    `;
    if (!r) throw new Error("ไม่พบคำขอนี้ อาจอนุมัติหรือยกเลิกไปแล้ว");
    await tx`
      insert into company_members (company_id, user_id, roles, scope) values (${companyId}, ${r.user_id}, ${roles}, ${scope})
      on conflict (company_id, user_id) do nothing
    `;
  });
}

export async function rejectJoin(companyId: string, id: string) {
  await sql`delete from join_requests where id = ${id} and company_id = ${companyId}`;
}
