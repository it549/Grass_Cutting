import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireCompany } from "@/lib/context";
import { saveFile } from "@/lib/data/files";
import { extractPO, type PoFile } from "@/lib/po-extract";

const OK_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_TOTAL = 20 * 1024 * 1024;

const toB64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// รับไฟล์ใบสั่งจ้าง → เก็บไฟล์ไว้ในที่เก็บของบริษัท → ให้ Claude อ่าน → ส่งข้อมูลกลับให้ฟอร์ม
export async function POST(req: NextRequest) {
  const { company, perm } = await requireCompany();
  if (!perm.orders) return NextResponse.json({ error: "เฉพาะธุรการหรือเจ้าของ" }, { status: 403 });

  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 400 });
  if (files.some((f) => !OK_TYPES.includes(f.type)))
    return NextResponse.json({ error: "รองรับเฉพาะ PDF, JPG, PNG" }, { status: 400 });
  if (files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL)
    return NextResponse.json({ error: "ไฟล์รวมกันต้องไม่เกิน 20MB" }, { status: 400 });

  const payload: PoFile[] = [];
  let storedPath = "";
  for (const [i, f] of files.entries()) {
    const buf = await f.arrayBuffer();
    payload.push({ mediaType: f.type, base64: toB64(buf) });
    if (i === 0) {
      const ext = f.type === "application/pdf" ? "pdf" : f.type.split("/")[1];
      const path = `${company.id}/po/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      try {
        await saveFile(path, Buffer.from(buf));
        storedPath = path;
      } catch {
        // เก็บไฟล์ไม่สำเร็จก็ยังให้ Claude อ่านต่อได้
      }
    }
  }

  try {
    const data = await extractPO(payload);
    return NextResponse.json({ data, po_file_path: storedPath });
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Anthropic.AuthenticationError) msg = "ANTHROPIC_API_KEY ไม่ถูกต้อง";
    else if (e instanceof Anthropic.RateLimitError) msg = "ใช้งาน Claude ถี่เกินไป รอสักครู่แล้วลองใหม่";
    else if (e instanceof Anthropic.BadRequestError) msg = "Claude อ่านไฟล์นี้ไม่ได้: " + e.message;
    else if (e instanceof Anthropic.APIError) msg = `Claude ขัดข้อง (${e.status}) ลองใหม่อีกครั้ง`;
    return NextResponse.json({ error: msg, po_file_path: storedPath }, { status: 502 });
  }
}
