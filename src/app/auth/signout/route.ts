import { clearSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  await clearSession();
  // ออกจากหน้าลิงก์ชวน: กลับไปหน้าเข้าสู่ระบบพร้อมลิงก์เดิม
  const join = String((await request.formData().catch(() => null))?.get("join") ?? "");
  const to = /^[A-Za-z0-9]{16,64}$/.test(join) ? `/login?join=${join}` : "/login";
  // ใช้ path แบบ relative: หลัง Cloudflare Tunnel request.url เป็น localhost:3004 ถ้าใช้แบบเต็มเบราว์เซอร์จะเด้งไป localhost
  return new Response(null, { status: 303, headers: { Location: to } });
}
