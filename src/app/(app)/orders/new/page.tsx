import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { loadAgencies } from "@/lib/orders";
import { OrderEditor } from "@/components/OrderEditor";
import { fyOf } from "@/lib/model";
import { todayBkk } from "@/lib/calc";

export const metadata = { title: "ใบสั่งจ้างใหม่ · งานตัดหญ้า" };

export default async function NewOrder({ searchParams }: { searchParams: Promise<{ agency?: string; ag?: string; round?: string; no?: string; fy?: string; hmd?: string }> }) {
  const sp = await searchParams;
  const { company, perm } = await requireCompany();
  if (!perm.orders) redirect("/rounds");
  const agencies = await loadAgencies();
  if (!agencies.length) redirect("/settings/agencies?err=" + encodeURIComponent("เพิ่มแขวงก่อน แล้วค่อยสร้างงวด"));
  const ag = agencies.find((a) => a.id === (sp.ag ?? sp.agency)) ?? agencies[0];
  const fy = parseInt(sp.fy ?? "", 10) || fyOf(todayBkk());
  let round = parseInt(sp.no ?? sp.round ?? "", 10);
  if (!(round > 0)) {
    const [last] = await sql<{ round_no: number }[]>`
      select round_no from orders where company_id = ${company.id} and agency_id = ${ag.id} and fy = ${fy} order by round_no desc limit 1
    `;
    round = (last?.round_no ?? 0) + 1;
  }
  return (
    <div className="pad">
      <div className="hd">
        <div>
          <div className="eyebrow">New purchase order</div>
          <h2>ใบสั่งจ้างใหม่ · งวด {round}/{fy}{sp.hmd ? " · หมวด" + sp.hmd : ""}</h2>
          <div className="meta"><Link href={`/rounds?ag=${ag.id}&fy=${fy}&no=${round}`}>← {ag.name} งวด {round}/{fy}</Link></div>
        </div>
      </div>
      <OrderEditor
        agencies={agencies}
        readOnly={false}
        canRead={Boolean(process.env.ANTHROPIC_API_KEY)}
        initial={{ id: null, agency_id: ag.id, fy, round_no: round, hmd: sp.hmd ?? "", po_no: "", po_date: "", proj_no: "", due_days: "", due_date: "", penalty: "", vat_incl: true, note: "", po_file_path: "", routes: [] }}
      />
    </div>
  );
}
