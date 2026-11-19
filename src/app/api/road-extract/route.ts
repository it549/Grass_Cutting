import { NextResponse, type NextRequest } from "next/server";
import { aiErrorMessage } from "@/lib/ai-extract";
import { requireCompany } from "@/lib/context";
import type { PoFile } from "@/lib/po-extract";
import { extractRoads } from "@/lib/road-extract";

const OK_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_TOTAL = 20 * 1024 * 1024;
const toB64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// ข้อความ/รูป/PDF รายชื่อสายทาง → AI อ่านเป็นรายการสาย (ยังไม่บันทึก ให้ผู้ใช้ตรวจก่อน)
export async function POST(req: NextRequest) {
  const { perm } = await requireCompany();
  if (!perm.orders) return NextResponse.json({ error: "เฉพาะธุรการหรือเจ้าของ" }, { status: 403 });
  const form = await req.formData();
  const text = String(form.get("text") ?? "").slice(0, 60000);
  const hmds = String(form.get("hmds") ?? "").split("|").filter(Boolean);
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!text.trim() && !files.length) return NextResponse.json({ error: "วางรายการหรือแนบรูปก่อน" }, { status: 400 });
  if (files.some((f) => !OK_TYPES.includes(f.type))) return NextResponse.json({ error: "รองรับเฉพาะ PDF, JPG, PNG" }, { status: 400 });
  if (files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL) return NextResponse.json({ error: "ไฟล์รวมกันต้องไม่เกิน 20MB" }, { status: 400 });
  const payload: PoFile[] = [];
  for (const f of files) payload.push({ mediaType: f.type, base64: toB64(await f.arrayBuffer()) });
  try {
    return NextResponse.json({ data: await extractRoads(text, payload, hmds) });
  } catch (e) {
    return NextResponse.json({ error: aiErrorMessage(e) }, { status: 502 });
  }
}
