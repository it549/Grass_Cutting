import "server-only";
import { extractWithAI, type AiFile } from "@/lib/ai-extract";
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

export type PoFile = AiFile;

export async function extractPO(files: PoFile[]): Promise<ExtractedPO> {
  return extractWithAI(PO, files, PROMPT);
}
