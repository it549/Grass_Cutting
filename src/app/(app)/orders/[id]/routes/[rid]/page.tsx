import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { dailyV } from "@/lib/data/views";
import { loadPhotos, signUrls } from "@/lib/orders";
import { loadWorld } from "@/lib/world";
import { type CrewDay, num, rInfo, regOf, rkOf, unitOf, workIndex } from "@/lib/model";
import { RouteView } from "./RouteView";

export const metadata = { title: "สายทาง · งานตัดหญ้า" };

export default async function RoutePage({ params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const { company, perm, who } = await requireCompany();
  const W = await loadWorld();
  const o = W.orders.find((x) => x.id === id);
  const r = o?.routes.find((x) => x.id === rid);
  if (!o || !r) notFound();
  const A = W.agencies.find((a) => a.id === o.agency_id);
  const G = regOf(W, o, r);
  const x = rInfo(W, workIndex(W.days), r);
  const photos = await loadPhotos({ routeId: r.id });
  const urls = await signUrls(photos.map((p) => p.path));
  // วันที่เข้าตัดสายนี้ (ใหม่สุดก่อน) + จำนวนคนงานทั้งวัน
  const days = W.days
    .filter((d) => d.work.some((w) => w.r === r.id))
    .map((d) => { const ws = d.work.filter((w) => w.r === r.id); return { date: d.date, km: ws.some((w) => w.km != null) ? ws.reduce((s, w) => s + num(w.km), 0) : null, fin: ws.some((w) => w.fin) }; })
    .sort((a, b) => b.date.localeCompare(a.date));
  const crewN: Record<string, number> = {};
  if (days.length) {
    const data = await dailyV(who, sql`and log_date in ${sql(days.map((d) => d.date))}`);
    for (const d of data) crewN[d.log_date] = ((d.crew ?? []) as CrewDay[]).reduce((s, c) => s + unitOf(c), 0);
  }
  const i = o.routes.findIndex((y) => y.id === r.id);
  const nb = (y?: (typeof o.routes)[number]) => (y ? { id: y.id, code: y.code } : null);
  return (
    <RouteView
      key={r.id}
      companyId={company.id}
      o={{ id: o.id, round_no: o.round_no, fy: o.fy, hmd: o.hmd, po_no: o.po_no, k: rkOf(o) }}
      r={{ id: r.id, code: r.code, descr: r.descr, area: r.area, rate: r.rate, in_po: r.in_po }}
      x={x}
      A={{ id: A?.id ?? "", name: A?.name ?? "", short: A?.short_name || A?.name || "", lr: !!A?.photo_lr }}
      G={G ? { id: G.id, amp: G.amp, map: G.map_url } : null}
      photos={photos.map((p) => ({ id: p.id, kind: p.kind, slot: p.slot, url: urls[p.path] ?? "", date: p.taken_date ?? "", time: p.taken_time ?? "", name: p.name ?? "", sig: p.sig ?? "" }))}
      days={days.map((d) => ({ ...d, crew: crewN[d.date] ?? 0 }))}
      nav={{ prev: nb(o.routes[i - 1]), next: nb(o.routes[i + 1]), pos: i + 1, n: o.routes.length }}
      can={{ work: perm.work, orders: perm.orders, roads: perm.roads, prices: perm.prices, daily: perm.daily }}
    />
  );
}
