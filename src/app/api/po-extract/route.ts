import { NextResponse, type NextRequest } from "next/server";
import { aiConfigured, aiErrorMessage } from "@/lib/ai-extract";
import { requireCompany } from "@/lib/context";
import { saveFile } from "@/lib/data/files";
import { extractPO, type ExtractedPO, type PoFile } from "@/lib/po-extract";
import { parsePoText, pdfLines } from "@/lib/po-text";

const OK_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_TOTAL = 20 * 1024 * 1024;

const toB64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// รับไฟล์ใบสั่งจ้าง → เก็บไฟล์ไว้ในที่เก็บของบริษัท → อ่านข้อความใน PDF เอง (ใช้ AI เฉพาะไฟล์สแกน/รูป) → ส่งข้อมูลกลับให้ฟอร์ม
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
  const pdfs: Uint8Array[] = [];
  let storedPath = "";
  for (const [i, f] of files.entries()) {
    const buf = await f.arrayBuffer();
    payload.push({ mediaType: f.type, base64: toB64(buf) });
    if (f.type === "application/pdf") pdfs.push(new Uint8Array(buf.slice(0)));
    if (i === 0) {
      const ext = f.type === "application/pdf" ? "pdf" : f.type.split("/")[1];
      const path = `${company.id}/po/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      try {
        await saveFile(path, Buffer.from(buf));
        storedPath = path;
      } catch {
        // เก็บไฟล์ไม่สำเร็จก็ยังให้ AI อ่านต่อได้
      }
    }
  }

  // 1) PDF ที่มีข้อความ (สร้างจากคอมพิวเตอร์): อ่านเองก่อน ไม่ใช้ AI
  // 2) PDF สแกน / รูปถ่าย / อ่านเองแล้วไม่ได้ตาราง: ให้ AI อ่าน (ถ้าตั้งค่าไว้)
  const fail = (error: string, status = 422) => NextResponse.json({ error, po_file_path: storedPath }, { status });
  const ok = (data: ExtractedPO, source: "text" | "ai", aiError?: string) =>
    NextResponse.json({ data, source, aiError, po_file_path: storedPath });

  let text: ExtractedPO | null = null;
  let scanned = false;
  let broken = false;
  // อ่านเองได้เฉพาะเมื่อแนบเป็น PDF ทั้งหมด (มีรูปปนมา ต้องให้ AI อ่านรวมกัน)
  if (pdfs.length === files.length) {
    try {
      const lines = (await Promise.all(pdfs.map((b) => pdfLines(b)))).flat();
      if (lines.join("").replace(/\s/g, "").length < 30) scanned = true;
      else text = parsePoText(lines);
    } catch (e) {
      console.warn("[po-extract] อ่าน PDF ไม่สำเร็จ:", e);
      broken = true;
    }
  }
  // อ่านเองได้ครบ = มีตารางสายทางและมีพื้นที่ → ไม่ต้องใช้ AI
  if (text && text.routes.length && text.routes.some((r) => r.area > 0)) return ok(text, "text");

  if (!aiConfigured()) {
    if (text && (text.routes.length || text.no)) return ok(text, "text");
    if (!pdfs.length) return fail("ไม่มี AI จึงอ่านรูปถ่ายไม่ได้ แนบเป็น PDF ที่สร้างจากคอมพิวเตอร์ หรือกรอกเองด้านล่าง (เก็บไฟล์ไว้แล้ว)");
    if (broken) return fail("เปิดไฟล์ PDF นี้ไม่ได้ กรอกเองด้านล่าง (เก็บไฟล์ไว้แล้ว)");
    if (scanned) return fail("PDF นี้เป็นภาพสแกน ไม่มีข้อความให้อ่าน กรอกเองด้านล่าง (เก็บไฟล์ไว้แล้ว)");
    return fail("อ่านข้อความใน PDF ได้ แต่ไม่พบเลขที่ใบสั่งจ้างหรือตารางสายทาง กรอกเองด้านล่าง (เก็บไฟล์ไว้แล้ว)");
  }

  try {
    return ok(await extractPO(payload), "ai");
  } catch (e) {
    const msg = aiErrorMessage(e);
    if (text && (text.routes.length || text.no)) return ok(text, "text", msg);
    return fail(msg, 502);
  }
}
