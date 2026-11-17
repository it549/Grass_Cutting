import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { loadAgencies, loadCosts, loadOrders, loadPhotos, signUrls } from "@/lib/orders";
import { hmdFull } from "@/lib/calc";
import { RoutePhotos } from "@/components/RoutePhotos";
import { PackButton } from "@/components/PackButton";

export const metadata = { title: "รูปสายทาง · งานตัดหญ้า" };

export default async function RoutePage({ params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const { company, perm } = await requireCompany();
  const [agencies, orders] = await Promise.all([loadAgencies(), loadOrders()]);
  const o = orders.find((x) => x.id === id);
  const r = o?.routes.find((x) => x.id === rid);
  if (!o || !r) notFound();
  const ag = agencies.find((a) => a.id === o.agency_id);
  const [photos, { km }] = await Promise.all([loadPhotos({ routeId: r.id }), loadCosts([o.id])]);
  const urls = await signUrls(photos.map((p) => p.path));
  const i = o.routes.findIndex((x) => x.id === r.id);
  const prev = o.routes[i - 1], next = o.routes[i + 1];
  return (
    <div className="pad">
      <div className="hd">
        <div>
          <div className="eyebrow">Route {i + 1} / {o.routes.length}</div>
          <h2>สาย {r.code}</h2>
          <div className="meta">
            <Link href={`/orders/${o.id}`}>← {ag?.name ?? ""} งวดที่ {o.round_no} · {hmdFull(o.hmd)}</Link> · {r.descr}
          </div>
        </div>
        <div className="acts" style={{ alignItems: "center" }}>
          {prev && <Link className="btn sm" href={`/orders/${o.id}/routes/${prev.id}`}>‹ สาย {prev.code}</Link>}
          {next && <Link className="btn sm" href={`/orders/${o.id}/routes/${next.id}`}>สาย {next.code} ›</Link>}
          <PackButton orderIds={[o.id]} mode="route" routeId={r.id} label="PDF รายงานภาพถ่ายสายนี้" filename={`รายงานภาพถ่าย-สาย ${r.code}-งวด${o.round_no}`} />
        </div>
      </div>
      <RoutePhotos
        key={r.id}
        companyId={company.id}
        orderId={o.id}
        route={{ id: r.id, area: r.area, rate: r.rate, done: r.done, done_date: r.done_date, length_km: r.length_km, km_done: km[r.id] ?? 0 }}
        can={{ work: perm.work, money: perm.prices }}
        photos={photos.map((p) => ({ id: p.id, kind: p.kind, url: urls[p.path] ?? "", taken_date: p.taken_date, taken_time: p.taken_time, caption: p.caption, name: p.name }))}
      />
    </div>
  );
}
