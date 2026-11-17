import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { loadAgencies } from "@/lib/orders";
import { fmt, thaiDate } from "@/lib/calc";
import { KIND, STATUS_LABEL, type DocKind, type DocStatus } from "@/lib/docs";
import { Flash } from "@/components/Flash";

export const metadata = { title: "เอกสาร · งานตัดหญ้า" };

export default async function DocsPage({ searchParams }: { searchParams: Promise<{ kind?: string; msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const { company, perm } = await requireCompany();
  if (!perm.docs) redirect("/rounds");
  const [docs, ords, agencies] = await Promise.all([
    sql<{ id: string; kind: DocKind; no: string; doc_date: string; status: DocStatus; total: number; order_id: string | null; name: string | null }[]>`
      select id, kind, no, doc_date, status, total, order_id, data->'party'->>'name' as name
      from documents
      where company_id = ${company.id}
      ${sp.kind && sp.kind in KIND ? sql`and kind = ${sp.kind}` : sql``}
      order by doc_date desc, no desc
      limit 500
    `,
    sql<{ id: string; agency_id: string; round_no: number; hmd: string }[]>`
      select id, agency_id, round_no, hmd from orders where company_id = ${company.id}
    `,
    loadAgencies(),
  ]);
  const ordOf = (id: string | null) => ords.find((o) => o.id === id);
  const sum = (k: DocKind) => docs.filter((d) => d.kind === k && d.status !== "void").reduce((s, d) => s + Number(d.total), 0);
  return (
    <div className="pad">
      <div className="hd">
        <div>
          <div className="eyebrow">Documents</div>
          <h2>เอกสาร</h2>
          <div className="meta">สร้างเอกสารได้จากหน้าใบสั่งจ้างของแต่ละหมวด · เลขที่นับแยกตามประเภทและปี พ.ศ.</div>
        </div>
      </div>
      <Flash msg={sp.msg} err={sp.err} />
      <div className="tabs">
        <Link href="/docs" className={!sp.kind ? "on" : ""}>ทั้งหมด</Link>
        {(Object.keys(KIND) as DocKind[]).map((k) => (
          <Link key={k} href={`/docs?kind=${k}`} className={sp.kind === k ? "on" : ""}>{KIND[k].short}</Link>
        ))}
      </div>
      {sp.kind && sp.kind in KIND && <p className="small muted">รวมยอด (ไม่นับที่ยกเลิก) {fmt(sum(sp.kind as DocKind))} บาท</p>}
      <table className="tbl">
        <thead><tr><th>เลขที่</th><th>ประเภท</th><th>ผู้รับ</th><th>งวด / หมวด</th><th>วันที่</th><th className="n">จำนวนเงิน</th><th>สถานะ</th></tr></thead>
        <tbody>
          {docs.map((d) => {
            const o = ordOf(d.order_id);
            const A = o && agencies.find((a) => a.id === o.agency_id);
            return (
              <tr key={d.id}>
                <td><Link href={`/docs/${d.id}`}>{d.no}</Link></td>
                <td>{KIND[d.kind].short}</td>
                <td>{d.name || "–"}</td>
                <td>{o ? <Link href={`/orders/${o.id}`}>{agencies.length > 1 && A ? (A.short_name || A.name) + " · " : ""}งวดที่ {o.round_no} · {o.hmd}</Link> : "–"}</td>
                <td>{thaiDate(d.doc_date)}</td>
                <td className="n">{fmt(d.total)}</td>
                <td><span className={"st " + STATUS_LABEL[d.status][1]}>{STATUS_LABEL[d.status][0]}</span></td>
              </tr>
            );
          })}
          {!docs.length && <tr><td colSpan={7} className="muted">ยังไม่มีเอกสาร เปิดหน้าใบสั่งจ้างแล้วกด “+ สร้าง…”</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
