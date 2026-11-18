import { clearSession } from "@/lib/auth/session";

export async function POST() {
  await clearSession();
  // ใช้ path แบบ relative: หลัง Cloudflare Tunnel request.url เป็น localhost:3004 ถ้าใช้แบบเต็มเบราว์เซอร์จะเด้งไป localhost
  return new Response(null, { status: 303, headers: { Location: "/login" } });
}
