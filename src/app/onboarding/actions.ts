"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createCompany as createCompanyDb } from "@/lib/data/company";
import { COMPANY_COOKIE } from "@/lib/context";

export async function createCompany(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/onboarding?msg=" + encodeURIComponent("กรุณาใส่ชื่อบริษัท"));
  const session = await getSession();
  if (!session) redirect("/login");

  let companyId: string;
  try {
    companyId = await createCompanyDb(session.userId, name, session.email);
  } catch (err) {
    redirect("/onboarding?msg=" + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }
  (await cookies()).set(COMPANY_COOKIE, companyId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/settings/company?msg=" + encodeURIComponent("สร้างบริษัทแล้ว กรอกข้อมูลหัวกระดาษต่อได้เลย"));
}
