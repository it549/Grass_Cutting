import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { isMember, hasAny, canWork } from "./perm-db";

export const STORAGE_ROOT = path.join(process.cwd(), "storage", "company-files");

function safeJoin(relPath: string) {
  const full = path.join(STORAGE_ROOT, relPath);
  if (!full.startsWith(STORAGE_ROOT)) throw new Error("เส้นทางไฟล์ไม่ถูกต้อง");
  return full;
}

// พอร์ตจาก public.file_ok(p_name, p_op) — company-files/<company_id>/<dir>/...
export async function fileOk(relPath: string, op: "read" | "write", userId: string) {
  const [companyId, dir] = relPath.split("/");
  if (!companyId) return false;
  if (op === "read" && (dir === "photos" || dir === "logo")) return isMember(companyId, userId);
  if (op === "read") return hasAny(companyId, userId, ["office"]);
  if (dir === "photos") return canWork(companyId, userId);
  return hasAny(companyId, userId, ["office"]);
}

export async function saveFile(relPath: string, data: Buffer) {
  const full = safeJoin(relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
}

export async function readStoredFile(relPath: string) {
  try {
    return await fs.readFile(safeJoin(relPath));
  } catch {
    return null;
  }
}

export async function removeFiles(relPaths: string[]) {
  await Promise.all(
    relPaths.filter(Boolean).map(async (p) => {
      try {
        await fs.unlink(safeJoin(p));
      } catch {
        // ไฟล์ไม่มีอยู่แล้วก็ไม่เป็นไร
      }
    }),
  );
}

/** ลิงก์ของไฟล์ (ตรวจสิทธิ์ที่ /api/files/... ทุกครั้งที่ขอ ไม่ต้อง "เซ็น" URL แบบ Supabase Storage) */
export function fileUrl(relPath: string) {
  return `/api/files/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}
