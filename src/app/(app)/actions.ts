"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COMPANY_COOKIE, getContext } from "@/lib/context";

export async function switchCompany(formData: FormData) {
  const id = String(formData.get("company") ?? "");
  const ctx = await getContext();
  if (ctx.memberships.some((m) => m.company.id === id)) {
    (await cookies()).set(COMPANY_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  redirect("/");
}
