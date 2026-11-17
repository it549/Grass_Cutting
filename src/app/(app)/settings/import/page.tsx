import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { ImportOld } from "@/components/ImportOld";

export const metadata = { title: "ย้ายข้อมูล · งานตัดหญ้า" };

export default async function ImportPage() {
  const { company, perm } = await requireCompany();
  if (!perm.members) redirect("/settings/company");
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="serif h3">ย้ายข้อมูลจากระบบเดิม (claude.ai)</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        เลือกไฟล์ที่ส่งออกจากระบบเดิม (.json หรือ .zip ที่มี data.json และโฟลเดอร์ photos) ข้อมูลจะเข้าบริษัท <b>{company.name}</b>.
        ทำซ้ำได้ ของที่มีอยู่แล้วจะถูกข้าม: สายทางที่เลขสายตรงกัน, ใบสั่งจ้างที่แขวง ปีงบ งวด และหมวดตรงกัน, เอกสารที่เลขที่ตรงกัน, บันทึกรายวันวันเดียวกัน, คนงานชื่อเดียวกัน, การเบิก จ่ายค่าแรง และน้ำมันที่ซ้ำ
      </p>
      <ImportOld companyId={company.id} />
    </div>
  );
}
