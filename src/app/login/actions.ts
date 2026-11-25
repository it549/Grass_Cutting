"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db/sql";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { acceptInvites } from "@/lib/data/invites";
import { signupAllowed, validCode } from "@/lib/data/join";

const joinOf = (f: FormData) => { const j = String(f.get("join") ?? ""); return validCode(j) ? j : ""; };
/** ลิงก์ชวน/คำเชิญที่พามาหน้านี้ ส่งต่อทุกครั้งที่เด้งกลับ */
const keepOf = (f: FormData) => { const j = joinOf(f); return j ? `&join=${j}` : f.get("invite") === "1" ? "&invite=1" : ""; };
const back = (mode: string, msg: string, keep = "") =>
  redirect(`/login?mode=${mode}${keep}&msg=${encodeURIComponent(msg)}`);
/** หลังเข้าสู่ระบบ: มาจากลิงก์ชวน = ไปส่งคำขอเข้าร่วม ไม่งั้นหน้าหลัก */
const after = (join: string) => redirect(join ? `/join/${join}` : "/");

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const join = joinOf(formData);

  const [user] = await sql<{ id: string; password_hash: string }[]>`
    select id, password_hash from users where email = ${email}
  `;
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    back("login", "อีเมลหรือรหัสผ่านไม่ถูกต้อง", keepOf(formData));
  }
  await createSession({ userId: user.id, email });
  await acceptInvites(user.id, email);
  after(join);
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const join = joinOf(formData), keep = keepOf(formData);
  if (password.length < 8) back("signup", "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร", keep);

  // สมัครได้เฉพาะคนแรกของระบบ / มีลิงก์ชวน / อีเมลที่ถูกเชิญ
  if (!(await signupAllowed(email, join))) {
    back("login", join ? "ลิงก์ชวนนี้ใช้ไม่ได้แล้ว ขอลิงก์ใหม่จากเจ้าของบริษัท" : "อีเมลนี้ยังไม่ได้รับเชิญ สมัครได้เฉพาะคนที่ได้ลิงก์ชวนหรือคำเชิญจากเจ้าของบริษัท", keep);
  }

  const [existing] = await sql<{ id: string }[]>`select id from users where email = ${email}`;
  if (existing) back("signup", "อีเมลนี้มีผู้ใช้แล้ว", keep);

  const passwordHash = await hashPassword(password);
  const [user] = await sql<{ id: string }[]>`
    insert into users (email, password_hash, full_name) values (${email}, ${passwordHash}, ${fullName || null})
    returning id
  `;
  await createSession({ userId: user.id, email });
  await acceptInvites(user.id, email);
  after(join);
}
