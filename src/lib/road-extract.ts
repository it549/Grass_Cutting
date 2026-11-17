import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ในหน้าตั้งค่าของเว็บ (ดู README)");
  const client = new Anthropic({ apiKey });
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = files.map((f) =>
    f.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } }
      : { type: "image", source: { type: "base64", media_type: f.mediaType as "image/jpeg" | "image/png" | "image/webp", data: f.base64 } },
  );
  const res = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ROADS) },
    messages: [{ role: "user", content: [...blocks, { type: "text", text: prompt(hmds) + (text ? "\n\nข้อมูล:\n" + text : "") }] }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude ไม่สามารถอ่านเอกสารนี้ได้");
  if (res.stop_reason === "max_tokens") throw new Error("เอกสารยาวเกินไป ลองแยกเป็นหลายส่วน");
  if (!res.parsed_output) throw new Error("อ่านผลลัพธ์ไม่สำเร็จ ลองใหม่อีกครั้ง");
  return res.parsed_output;
}
