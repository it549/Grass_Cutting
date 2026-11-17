import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";

// ลิงก์เก่า /rounds/แขวง/งวดที่ → หน้างานใหม่ (เลือกปีงบล่าสุดที่มีงวดนี้)
export default async function OldRoundPage({ params }: { params: Promise<{ agency: string; no: string }> }) {
  const { agency, no } = await params;
  const { company } = await requireCompany();
  const n = parseInt(no, 10) || 0;
  if (!/^[0-9a-f-]{36}$/i.test(agency)) redirect("/rounds");
  const [row] = await sql<{ fy: number }[]>`
    select fy from orders where company_id = ${company.id} and agency_id = ${agency} and round_no = ${n} order by fy desc limit 1
  `;
  redirect(row ? `/rounds?ag=${agency}&fy=${row.fy}&no=${n}` : `/rounds?ag=${agency}`);
}
