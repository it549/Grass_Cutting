import "server-only";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { fileOk, readStoredFile } from "@/lib/data/files";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const relPath = segments.join("/");
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });
  if (!(await fileOk(relPath, "read", session.userId))) return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });

  const data = await readStoredFile(relPath);
  if (!data) return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 404 });

  const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  return new NextResponse(data, {
    headers: { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" },
  });
}
