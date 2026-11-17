import { notFound, redirect } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { coHead, type DocData, type DocKind, type DocStatus } from "@/lib/docs";
import { loadOrders, signUrls } from "@/lib/orders";
import { DocEditor } from "@/components/DocEditor";
import { Flash } from "@/components/Flash";

export const metadata = { title: "เอกสาร · งานตัดหญ้า" };

export default async function DocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { company, perm } = await requireCompany();
  if (!perm.docs) redirect("/rounds");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await sql<{ id: string; order_id: string | null; kind: DocKind; no: string; doc_date: string; status: DocStatus; data: DocData; void_reason: string | null }[]>`
    select id, order_id, kind, no, doc_date, status, data, void_reason from documents where id = ${id} and company_id = ${company.id}
  `;
  if (!row) notFound();
  const orders = row.order_id ? await loadOrders() : [];
  const o = orders.find((x) => x.id === row.order_id);
  const d = { ...(row.data as DocData), kind: row.kind, no: row.no, date: row.doc_date, status: row.status, voidReason: row.void_reason ?? undefined } as DocData;
  const urls = await signUrls([company.logo_path ?? "", d.head?.logo ?? ""]);
  return (
    <div className="edwrap">
      <Flash {...sp} />
      <DocEditor
        id={row.id}
        initial={d}
        canEdit={perm.docKind(row.kind)}
        canIssue={row.kind !== "rc" || perm.rcIssue}
        orderId={row.order_id}
        orderLabel={o ? `งวดที่ ${o.round_no} · หมวด${o.hmd} · ใบสั่งจ้าง ${o.po_no || "–"}` : ""}
        routes={o?.routes.map((r) => ({ code: r.code, descr: r.descr, area: r.area, rate: r.rate })) ?? []}
        companyHead={coHead(company)}
        urls={urls}
      />
    </div>
  );
}
