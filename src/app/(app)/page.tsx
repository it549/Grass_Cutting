import Link from "next/link";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";

export default async function Home() {
  const { company } = await requireCompany();
  const [[{ count: agN }], [{ count: memN }]] = await Promise.all([
    sql<{ count: number }[]>`select count(*) from agencies where company_id = ${company.id}`,
    sql<{ count: number }[]>`select count(*) from company_members where company_id = ${company.id}`,
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
    </div>
  );
}
