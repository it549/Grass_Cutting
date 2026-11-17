import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const PO = z.object({
  no: z.string().describe("เลขที่ใบสั่งจ้าง เช่น 034/2569 ไม่พบให้เป็น \"\""),
  date: z.string().describe("วันที่ใบสั่งจ้าง รูปแบบ YYYY-MM-DD เป็น ค.ศ. ไม่พบให้เป็น \"\""),
  projNo: z.string().describe("เลขที่โครงการ ไม่พบให้เป็น \"\""),
  dueDays: z.number().nullable().describe("จำนวนวันที่ต้องส่งมอบงาน ไม่พบให้เป็น null"),
  dueDate: z.string().describe("วันครบกำหนดส่งมอบ YYYY-MM-DD ค.ศ. ถ้าระบุไว้ ไม่พบให้เป็น \"\""),
  agency: z.string().describe("ชื่อหน่วยงานผู้สั่งจ้าง"),
  hmd: z.string().describe("ชื่อหมวดบำรุงทางที่ระบุในใบสั่งจ้าง เฉพาะชื่อหมวด เช่น บางละมุง ไม่พบให้เป็น \"\""),
  vatIncl: z.boolean().describe("true ถ้าราคาต่อหน่วยรวมภาษีมูลค่าเพิ่มแล้ว"),
  penalty: z.string().describe("ข้อความเรื่องค่าปรับ ไม่พบให้เป็น \"\""),
  routes: z.array(
    z.object({
      code: z.string().describe("รหัสสายทาง เช่น ชบ.3083"),
      descr: z.string().describe("ชื่อสายทางเต็มตามที่เขียน"),
      area: z.number().describe("พื้นที่ ตารางเมตร"),
      rate: z.number().describe("ราคาต่อตารางเมตร (บาท)"),
    }),
  ),
});
export type ExtractedPO = z.infer<typeof PO>;

const PROMPT = `เอกสารที่แนบคือ "ใบสั่งจ้าง" งานจ้างเหมาตัดหญ้าข้างทาง ของหน่วยงานราชการไทย เช่น แขวงทางหลวงชนบท
ดึงข้อมูลตามโครงสร้างที่กำหนด
- แปลงเลขไทยเป็นเลขอารบิก และแปลงปี พ.ศ. เป็น ค.ศ. (ลบ 543)
- ใส่ทุกสายทางในตาราง ตามลำดับในเอกสาร ห้ามข้ามแถว ตัวเลขไม่มีจุลภาค
- ถ้าไม่พบข้อมูลใด ให้ใส่ค่าว่างตามที่กำหนด ห้ามเดา`;

export type PoFile = { mediaType: string; base64: string };

export async function extractPO(files: PoFile[]): Promise<ExtractedPO> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ในหน้าตั้งค่าของเว็บ (ดู README)");
  const client = new Anthropic({ apiKey });

  const blocks: Anthropic.Beta.BetaContentBlockParam[] = files.map((f) =>
    f.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } }
      : {
          type: "image",
          source: { type: "base64", media_type: f.mediaType as "image/jpeg" | "image/png" | "image/webp", data: f.base64 },
        },
  );

  const res = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(PO) },
    messages: [{ role: "user", content: [...blocks, { type: "text", text: PROMPT }] }],
  });

  if (res.stop_reason === "refusal") throw new Error("Claude ไม่สามารถอ่านเอกสารนี้ได้");
  if (res.stop_reason === "max_tokens") throw new Error("เอกสารยาวเกินไป ลองแยกเป็นหลายไฟล์");
  if (!res.parsed_output) throw new Error("อ่านผลลัพธ์ไม่สำเร็จ ลองใหม่อีกครั้ง");
  return res.parsed_output;
}
