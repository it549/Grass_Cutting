"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db/sql";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { acceptInvites } from "@/lib/data/invites";

const back = (mode: string, msg: string) =>
  redirect(`/login?mode=${mode}&msg=${encodeURIComponent(msg)}`);

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const [user] = await sql<{ id: string; password_hash: string }[]>`
    select id, password_hash from users where email = ${email}
  `;
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    back("login", "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  }
  await createSession({ userId: user.id, email });
  await acceptInvites(user.id, email);
  redirect("/");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (password.length < 8) back("signup", "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");

  const [existing] = await sql<{ id: string }[]>`select id from users where email = ${email}`;
  if (existing) back("signup", "อีเมลนี้มีผู้ใช้แล้ว");

  const passwordHash = await hashPassword(password);
  const [user] = await sql<{ id: string }[]>`
    insert into users (email, password_hash, full_name) values (${email}, ${passwordHash}, ${fullName || null})
    returning id
  `;
  await createSession({ userId: user.id, email });
  await acceptInvites(user.id, email);
  redirect("/");
}
