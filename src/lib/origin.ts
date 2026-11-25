/** ลิงก์เว็บนี้จาก header ของคำขอ ใช้ทำลิงก์ชวน/ลิงก์ในอีเมล และพากลับเว็บเดิมหลังกดลิงก์ */
export function originOf(h: Headers) {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
