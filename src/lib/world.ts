import "server-only";
import { cache } from "react";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { inScopeFor } from "@/lib/data/perm-db";
import { dailyV, routesV } from "@/lib/data/views";
import type { Agency, DayWork, Order, PicStat, Road, Route, World } from "@/lib/model";
import type { DocLite } from "@/lib/docboard";

/** ข้อมูลทั้งบริษัทที่หน้างาน/สายทาง/รายวันใช้ (ตามสิทธิ์ของผู้ใช้: ราคาเป็นค่าว่างถ้าไม่มีสิทธิ์เห็น) */
export function loadWorld(opts: { days?: boolean; pics?: boolean } = {}): Promise<World> {
  return loadWorldC(opts.days !== false, opts.pics !== false);
}
// อ่านครั้งเดียวต่อคำขอ (เมนูซ้ายกับหน้าใช้ข้อมูลชุดเดียวกัน)
const loadWorldC = cache(async (withDays: boolean, withPics: boolean): Promise<World> => {
  const { company, roles, scope, who } = await requireCompany();
  const cid = company.id;
  const ok = (agencyId: string, hmd: string | null) => inScopeFor(roles, scope, agencyId, hmd);
  const [agencies, roads, orders, routes] = await Promise.all([
    sql<Agency[]>`select id, name, short_name, hmds, address, director, photo_lr from agencies where company_id = ${cid} order by sort, created_at`,
    sql<Road[]>`select id, agency_id, hmd, code, name, amp, len_km, map_url, note from roads where company_id = ${cid} order by code`,
    sql<Omit<Order, "routes">[]>`
      select id, agency_id, fy, round_no, hmd, start_date, po_no, po_date, proj_no, due_days, due_date, penalty, vat_incl, note, po_file_path, created_at
      from orders where company_id = ${cid} order by fy desc, round_no desc
    `,
    routesV(who, sql``, sql`order by r.order_id, r.seq`),
  ]);
  const byOrder = new Map<string, Route[]>();
  for (const r of routes) {
    const l = byOrder.get(r.order_id) ?? [];
    l.push({ ...r, area: Number(r.area), rate: r.rate == null ? null : Number(r.rate), length_km: r.length_km == null ? null : Number(r.length_km), in_po: r.in_po !== false });
    byOrder.set(r.order_id, l);
  }
  const W: World = {
    agencies: agencies.filter((a) => ok(a.id, null)).map((a) => ({ ...a, hmds: a.hmds ?? [] })),
    roads: roads.filter((g) => ok(g.agency_id, g.hmd)).map((g) => ({ ...g, len_km: g.len_km == null ? null : Number(g.len_km) })),
    orders: orders.filter((o) => ok(o.agency_id, o.hmd)).map((o) => ({ ...o, routes: byOrder.get(o.id) ?? [] })),
    days: [],
    pics: {},
  };
  if (withDays) {
    const ds = await dailyV(who);
    W.days = ds.map((d) => ({ date: d.log_date, work: (d.work ?? []) as DayWork["work"] }));
  }
  if (withPics) {
    const ps = await sql<{ route_id: string; kind: string; taken_date: string | null; slot: string | null; agency_id: string; hmd: string }[]>`
      select p.route_id, p.kind, p.taken_date, p.slot, o.agency_id, o.hmd
      from route_photos p join orders o on o.id = p.order_id
      where p.company_id = ${cid} order by p.id
    `;
    const P: Record<string, PicStat> = {};
    for (const p of ps) {
      if (!ok(p.agency_id, p.hmd)) continue;
      const x = (P[p.route_id] ??= { b: 0, a: 0, n: 0, first: "", last: "", sl: [] });
      x.n++;
      if (p.slot) x.sl.push(p.slot);
      if (p.kind === "b") x.b++; else if (p.kind === "a") x.a++;
      if (p.taken_date) { if (!x.first || p.taken_date < x.first) x.first = p.taken_date; if (p.taken_date > x.last) x.last = p.taken_date; }
    }
    W.pics = P;
  }
  return W;
});

/** เอกสารทั้งหมดของบริษัท (เฉพาะหัวข้อ ไม่รวมเนื้อหา) — เห็นเฉพาะธุรการ/บัญชี */
export const loadDocs = cache(async (): Promise<DocLite[]> => {
  const { company, perm } = await requireCompany();
  if (!perm.docs) return [];
  const rows = await sql<DocLite[]>`
    select id, kind, no, doc_date, status, total, order_id from documents where company_id = ${company.id} order by doc_date, no
  `;
  return rows.map((d) => ({ ...d, total: Number(d.total) }));
});
