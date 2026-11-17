import "server-only";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { fileOk, saveFile } from "@/lib/data/files";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });

  const form = await req.formData();
  const relPath = form.get("path");
  const file = form.get("file");
  if (typeof relPath !== "string" || !(file instanceof Blob)) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  if (!(await fileOk(relPath, "write", session.userId))) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  await saveFile(relPath, buf);
  return NextResponse.json({ path: relPath });
}
