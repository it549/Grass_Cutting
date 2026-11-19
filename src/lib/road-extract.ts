import "server-only";
import { extractWithAI } from "@/lib/ai-extract";
import { z } from "zod";
import type { PoFile } from "@/lib/po-extract";

const ROADS = z.object({
  routes: z.array(
    z.object({
      hmd: z.string().describe("ชื่อหมวดของสายนี้ตามหัวข้อ/หัวตารางในเอกสาร เฉพาะชื่อสั้น เช่น บางละมุง ไม่ได้แยกหมวดให้เป็น \"\""),
      code: z.string().describe("รหัสสายทาง เช่น ชบ.3083"),
      name: z.string().describe("ชื่อสายทาง เช่น แยก ทล.3 - บ้านหนองปลาไหล (ไม่ต้องมีคำว่าสาย/รหัส)"),
      amp: z.string().describe("อำเภอ ถ้ามี ไม่มีให้เป็น \"\""),
      len: z.number().nullable().describe("ความยาวเป็นกิโลเมตร ไม่มีให้เป็น null"),
    }),
  ),
});
export type ExtractedRoads = z.infer<typeof ROADS>;

const prompt = (hmds: string[]) => `อ่านรายชื่อสายทาง (ทางหลวงชนบท) จากข้อมูลที่ให้
เรื่องหมวด (สำคัญ): เอกสารมักแยกตาราง หรือมีหัวข้อ/หัวตาราง/แถวคั่น เช่น "หมวดบำรุงทางหลวงชนบทบางละมุง" หรือ "หมวดฯ บ่อทอง" แล้วตามด้วยรายการสายของหมวดนั้น ให้ใส่ hmd ของทุกสายตามหัวข้อที่สายนั้นอยู่ใต้ ใส่แค่ชื่อหมวดสั้น ๆ (เช่น "บางละมุง")
ห้ามเดาหมวดจากชื่ออำเภอของสาย (สายในหมวดบางละมุงอาจอยู่ อ.ศรีราชา หรือ สัตหีบ ก็ได้) ถ้าเอกสารไม่ได้แยกหมวดเลย ให้ hmd เป็น ""
หมวดที่มีอยู่ในระบบ: ${hmds.join(", ") || "-"} (ถ้าเอกสารเขียนชื่อหมวดใกล้เคียงให้ใช้ชื่อตามนี้)
กติกาอื่น: แปลงเลขไทยเป็นเลขอารบิก ตัวเลขไม่มีจุลภาค ถ้าระบุความยาวเป็นเมตรให้แปลงเป็นกิโลเมตร ใส่ทุกสายตามลำดับในเอกสาร ห้ามเดาสายที่ไม่มีในข้อมูล`;

export async function extractRoads(text: string, files: PoFile[], hmds: string[]): Promise<ExtractedRoads> {
  return extractWithAI(ROADS, files, prompt(hmds) + (text ? "\n\nข้อมูล:\n" + text : ""));
}
