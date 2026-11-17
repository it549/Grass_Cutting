import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { loadAgencies } from "@/lib/orders";
import { OrderEditor } from "@/components/OrderEditor";

export const metadata = { title: "ใบสั่งจ้างใหม่ · งานตัดหญ้า" };

export default async function NewOrder({ searchParams }: { searchParams: Promise<{ agency?: string; round?: string; hmd?: string }> }) {
  const sp = await searchParams;
  const { company, perm } = await requireCompany();
  if (!perm.orders) redirect("/rounds");
  const agencies = await loadAgencies();
  if (!agencies.length) redirect("/settings/agencies?err=" + encodeURIComponent("เพิ่มแขวงก่อน แล้วค่อยสร้างงวด"));
  const ag = agencies.find((a) => a.id === sp.agency) ?? agencies[0];
  let round = parseInt(sp.round ?? "", 10);
  if (!(round > 0)) {
    const data = await sql<{ round_no: number }[]>`
      select round_no from orders where company_id = ${company.id} and agency_id = ${ag.id} order by round_no desc limit 1
    `;
    round = (data[0]?.round_no ?? 0) + 1;
  }
  return (
    <div className="pad">
      <div className="hd">
        <div>
          <div className="eyebrow">New purchase order</div>
          <h2>ใบสั่งจ้างใหม่ · งวดที่ {round}</h2>
          <div className="meta"><Link href={`/rounds/${ag.id}/${round}`}>← {ag.name} งวดที่ {round}</Link></div>
        </div>
      </div>
      <OrderEditor
        agencies={agencies}
        readOnly={false}
        canRead={Boolean(process.env.ANTHROPIC_API_KEY)}
        initial={{ id: null, agency_id: ag.id, round_no: round, hmd: sp.hmd ?? "", po_no: "", po_date: "", proj_no: "", due_days: "", due_date: "", penalty: "", vat_incl: true, note: "", po_file_path: "", routes: [] }}
      />
    </div>
  );
}
