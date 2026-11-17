import Link from "next/link";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";

const PHASES = [
  ["1", "ล็อกอิน บริษัท แขวง หมวด สมาชิก", "พร้อมใช้"],
  ["2", "งวด หมวด สายทาง และ Claude อ่านใบสั่งจ้าง", "พร้อมใช้"],
  ["3", "รูปก่อน/หลัง และ PDF รายงานรูป ชุดส่งงวด", "พร้อมใช้"],
  ["4", "ใบเสนอราคา หนังสือส่งมอบงาน ใบกำกับภาษี/ใบเสร็จ", "พร้อมใช้"],
  ["5", "บันทึกรายวัน ค่าแรง ใบสำคัญจ่าย", "พร้อมใช้"],
  ["6", "ย้ายข้อมูลจากระบบเดิม (ตั้งค่า > ย้ายข้อมูล)", "พร้อมใช้"],
];

export default async function Home() {
  const { company } = await requireCompany();
  const [[{ count: agN }], [{ count: memN }]] = await Promise.all([
    sql<{ count: number }[]>`select count(*)::int as count from agencies where company_id = ${company.id}`,
    sql<{ count: number }[]>`select count(*)::int as count from company_members where company_id = ${company.id}`,
  ]);
  const missing = [
    !company.tax_id && "เลขผู้เสียภาษี",
    !company.address && "ที่อยู่",
    !company.signer_name && "ผู้ลงนาม",
    !company.logo_path && "โลโก้",
  ].filter(Boolean) as string[];

  return (
    <div className="pad">
      <div className="hd">
        <div>
          <div className="eyebrow">Overview</div>
          <h2>ภาพรวม</h2>
          <div className="meta">{company.name}</div>
        </div>
      </div>
      <div className="kp">
        <div className="k"><div className="lab">แขวงที่รับงาน</div><div className="v num">{agN ?? 0}<small>แขวง</small></div><div className="s"><Link href="/settings/agencies">จัดการแขวงและหมวด</Link></div></div>
        <div className="k"><div className="lab">สมาชิกในบริษัท</div><div className="v num">{memN ?? 0}<small>คน</small></div><div className="s"><Link href="/settings/members">เชิญสมาชิก</Link></div></div>
        <div className="k"><div className="lab">ข้อมูลหัวกระดาษ</div><div className="v num">{missing.length ? missing.length : "✓"}<small>{missing.length ? "รายการที่ยังขาด" : "ครบ"}</small></div><div className="s">{missing.length ? <Link href="/settings/company">ยังขาด {missing.join(", ")}</Link> : "พร้อมออกเอกสาร"}</div></div>
      </div>
      <div className="card" style={{ marginTop: 22 }}>
        <div className="serif" style={{ fontSize: 17, marginBottom: 8 }}>ความคืบหน้าการย้ายระบบมาเป็นเว็บ</div>
        <table className="tbl">
          <tbody>
            {PHASES.map(([n, t, s]) => (
              <tr key={n}><td className="c" style={{ width: 70 }}>ช่วงที่ {n}</td><td>{t}</td><td style={{ width: 120 }}>{s && <span className={"st " + (s === "พร้อมใช้" ? "s2" : "s1")}>{s}</span>}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 10 }}>ย้ายข้อมูลจากระบบเดิมบน claude.ai ได้ที่ ตั้งค่า &gt; ย้ายข้อมูล (ทำครั้งเดียวตอนพร้อมเปลี่ยนมาใช้เว็บ)</p>
      </div>
    </div>
  );
}
