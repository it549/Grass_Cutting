"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { removeFiles, saveFile } from "@/lib/data/files";
import { done } from "@/lib/flash";

const P = "/settings/company";
const FIELDS = [
  "name", "name_en", "tax_id", "branch", "address", "phone", "email",
  "signer_name", "signer_title", "bank_name", "bank_account_no", "bank_account_name",
] as const;

export async function saveCompany(formData: FormData) {
  const { company, perm } = await requireCompany();
  if (!perm.orders) done(P, "เฉพาะธุรการหรือเจ้าของที่แก้ข้อมูลบริษัทได้", true);
  const row: Record<string, string | null> = {};
  for (const f of FIELDS) row[f] = String(formData.get(f) ?? "").trim() || null;
  if (!row.name) done(P, "ต้องมีชื่อบริษัท", true);

  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!logo.type.startsWith("image/")) done(P, "โลโก้ต้องเป็นไฟล์รูปภาพ", true);
    if (logo.size > 2 * 1024 * 1024) done(P, "โลโก้ต้องไม่เกิน 2MB", true);
    const ext = (logo.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${company.id}/logo/logo-${Date.now()}.${ext}`;
    await saveFile(path, Buffer.from(await logo.arrayBuffer()));
    if (company.logo_path) await removeFiles([company.logo_path]);
    row.logo_path = path;
  } else if (formData.get("remove_logo") === "1") {
    if (company.logo_path) await removeFiles([company.logo_path]);
    row.logo_path = null;
  }

  await sql`update companies set ${sql(row, ...Object.keys(row))} where id = ${company.id}`;
  revalidatePath("/", "layout");
  done(P, "บันทึกข้อมูลบริษัทแล้ว");
}
