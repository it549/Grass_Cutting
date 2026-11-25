import "server-only";
import { sql } from "@/lib/db/sql";

export const NO_CREATE_MSG = "สร้างบริษัทใหม่ได้เฉพาะเจ้าของบริษัท ถ้าจะเข้าบริษัทที่มีอยู่ ขอลิงก์ชวนจากเจ้าของบริษัท";

/**
 * สร้างบริษัทใหม่ได้ไหม (ตาม v5)
 * · เป็นเจ้าของ (owner) อย่างน้อย 1 บริษัท → ได้
 * · ยังไม่มีบริษัทในระบบเลย (ติดตั้งครั้งแรก) → ได้
 * · นอกนั้นไม่ได้ ต้องเข้าผ่านลิงก์ชวนหรือคำเชิญ
 */
export async function canCreateCompany(userId: string) {
  const [r] = await sql<{ ok: boolean }[]>`
    select (
      exists (select 1 from company_members where user_id = ${userId} and 'owner' = any (roles))
      or not exists (select 1 from companies)
    ) as ok
  `;
  return Boolean(r?.ok);
}

// พอร์ตจาก public.create_company(p_name) — เดิมใช้ auth.uid() เป็นผู้สร้าง/เจ้าของ ตอนนี้รับ userId ตรงๆ
export async function createCompany(userId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("กรุณาใส่ชื่อบริษัท");
  if (!(await canCreateCompany(userId))) throw new Error(NO_CREATE_MSG);
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
