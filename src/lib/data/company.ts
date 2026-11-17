import "server-only";
import { sql } from "@/lib/db/sql";

// พอร์ตจาก public.create_company(p_name) — เดิมใช้ auth.uid() เป็นผู้สร้าง/เจ้าของ ตอนนี้รับ userId ตรงๆ
export async function createCompany(userId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("กรุณาใส่ชื่อบริษัท");
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
