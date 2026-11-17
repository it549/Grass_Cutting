"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { done } from "@/lib/flash";

const P = "/settings/agencies";

const read = (fd: FormData) => {
  const s = (k: string) => String(fd.get(k) ?? "").trim() || null;
  const hmds = String(fd.get("hmds") ?? "")
    .split(/\r?\n|,/)
    .map((h) => h.trim().replace(/^หมวดบำรุงทางหลวงชนบท\s*/, ""))
    .filter(Boolean);
  return {
    name: s("name") ?? "",
    short_name: s("short_name"),
    address: s("address"),
    phone: s("phone"),
    tax_id: s("tax_id"),
    director: s("director"),
    hmds: [...new Set(hmds)],
  };
};

async function guard() {
  const ctx = await requireCompany();
  if (!ctx.perm.orders) done(P, "เฉพาะธุรการหรือเจ้าของที่แก้แขวงได้", true);
  return ctx;
}

export async function addAgency(formData: FormData) {
  const { company } = await guard();
  const row = read(formData);
  if (!row.name) done(P, "ต้องมีชื่อแขวง", true);
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from agencies where company_id = ${company.id}`;
  await sql`
    insert into agencies (name, short_name, address, phone, tax_id, director, hmds, company_id, sort)
    values (${row.name}, ${row.short_name}, ${row.address}, ${row.phone}, ${row.tax_id}, ${row.director}, ${row.hmds}, ${company.id}, ${count ?? 0})
  `;
  revalidatePath("/", "layout");
  done(P, `เพิ่ม ${row.name} แล้ว`);
}

export async function addSampleAgency() {
  const { company } = await guard();
  await sql`
    insert into agencies (company_id, name, short_name, address, phone, director, hmds) values (
      ${company.id}, 'แขวงทางหลวงชนบทชลบุรี', 'ชลบุรี', '409 หมู่ที่ 3 ตำบลหนองชาก อำเภอบ้านบึง จังหวัดชลบุรี', '0-3820-2044-7',
      'ผู้อำนวยการแขวงทางหลวงชนบทชลบุรี', ${["ชลบุรี", "บ่อทอง", "บางละมุง"]}
    )
  `;
  revalidatePath("/", "layout");
  done(P, "เพิ่มแขวงทางหลวงชนบทชลบุรี พร้อม 3 หมวดแล้ว ตรวจที่อยู่และเบอร์โทรอีกครั้ง");
}

export async function saveAgency(formData: FormData) {
  const { company } = await guard();
  const id = String(formData.get("id") ?? "");
  const row = read(formData);
  if (!row.name) done(P, "ต้องมีชื่อแขวง", true);
  await sql`
    update agencies set name = ${row.name}, short_name = ${row.short_name}, address = ${row.address}, phone = ${row.phone},
      tax_id = ${row.tax_id}, director = ${row.director}, hmds = ${row.hmds}
    where id = ${id} and company_id = ${company.id}
  `;
  revalidatePath("/", "layout");
  done(P, `บันทึก ${row.name} แล้ว`);
}

export async function deleteAgency(formData: FormData) {
  const { company } = await guard();
  const id = String(formData.get("id") ?? "");
  await sql`delete from agencies where id = ${id} and company_id = ${company.id}`;
  revalidatePath("/", "layout");
  done(P, "ลบแขวงแล้ว");
}
