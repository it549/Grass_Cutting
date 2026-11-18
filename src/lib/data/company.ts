import "server-only";
import { sql } from "@/lib/db/sql";

export const NO_CREATE_MSG = "อีเมลนี้ได้รับสิทธิ์จำกัดจากบริษัทที่เชิญ จึงสร้างบริษัทใหม่ไม่ได้ ติดต่อเจ้าของบริษัทถ้าต้องการสิทธิ์เพิ่ม";

/**
 * สร้างบริษัทใหม่ได้ไหม
 * · เป็นเจ้าของ (owner) อย่างน้อย 1 บริษัท → ได้
 * · เป็นสมาชิกแบบจำกัดสิทธิ์ (บัญชี/หัวหน้าชุด/ดูอย่างเดียว ฯลฯ) หรือมีคำเชิญค้างอยู่ → ไม่ได้
 * · ยังไม่เกี่ยวกับบริษัทไหนเลย (สมัครใหม่) → ได้
 */
export async function canCreateCompany(userId: string, email: string) {
  const mem = await sql<{ roles: string[] }[]>`select roles from company_members where user_id = ${userId}`;
  if (mem.some((m) => (m.roles ?? []).includes("owner"))) return true;
  if (mem.length) return false;
  const [inv] = await sql`select 1 from invites where email = ${String(email || "").toLowerCase()} limit 1`;
  return !inv;
}

// พอร์ตจาก public.create_company(p_name) — เดิมใช้ auth.uid() เป็นผู้สร้าง/เจ้าของ ตอนนี้รับ userId ตรงๆ
export async function createCompany(userId: string, name: string, email: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("กรุณาใส่ชื่อบริษัท");
  if (!(await canCreateCompany(userId, email))) throw new Error(NO_CREATE_MSG);
  return sql.begin(async (tx) => {
    const [company] = await tx<{ id: string }[]>`
      insert into companies (name, created_by) values (${trimmed}, ${userId}) returning id
    `;
    await tx`
      insert into company_members (company_id, user_id, roles) values (${company.id}, ${userId}, ${["owner"]})
    `;
    return company.id as string;
  });
}
