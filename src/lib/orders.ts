import "server-only";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { fileUrl } from "@/lib/data/files";
import { inScopeFor } from "@/lib/data/perm-db";
import { dailyV, routesV } from "@/lib/data/views";

export type OrderRow = {
  id: string; agency_id: string; fy: number; round_no: number; hmd: string; start_date: string | null; po_no: string | null; po_date: string | null;
  proj_no: string | null; due_days: number | null; due_date: string | null; penalty: string | null; vat_incl: boolean;
  note: string | null; po_file_path: string | null; created_at: string;
};
export type RouteDb = { id: string; order_id: string; seq: number; code: string; descr: string; area: number; rate: number; done: boolean | null; done_date: string | null; length_km: number | null; road_id: string | null; in_po: boolean };

export async function loadAgencies() {
  const { company, roles, scope } = await requireCompany();
  const rows = await sql<{ id: string; name: string; short_name: string | null; hmds: string[]; address: string | null; director: string | null }[]>`
    select id, name, short_name, hmds, address, director from agencies
    where company_id = ${company.id}
    order by sort, created_at
  `;
  return rows.filter((a) => inScopeFor(roles, scope, a.id, null));
}

export async function loadOrders(filter: { agency?: string; round?: number } = {}) {
  const { company, roles, scope, who } = await requireCompany();
  const orders = await sql<OrderRow[]>`
    select * from orders
    where company_id = ${company.id}
    ${filter.agency ? sql`and agency_id = ${filter.agency}` : sql``}
    ${filter.round ? sql`and round_no = ${filter.round}` : sql``}
    order by fy desc, round_no desc, hmd
  `;
  const list = orders.filter((o) => inScopeFor(roles, scope, o.agency_id, o.hmd));
  const ids = list.map((o) => o.id);
  const routes = ids.length ? await routesV(who, sql`and r.order_id in ${sql(ids)}`) : [];
  const byOrder = new Map<string, RouteDb[]>();
  for (const r of routes) {
    const l = byOrder.get(r.order_id) ?? [];
    l.push({ ...r, area: Number(r.area), rate: Number(r.rate ?? 0), length_km: r.length_km == null ? null : Number(r.length_km), in_po: r.in_po !== false });
    byOrder.set(r.order_id, l);
  }
  return list.map((o) => ({ ...o, routes: byOrder.get(o.id) ?? [] }));
}

export type PhotoDb = {
  id: string; order_id: string; route_id: string; kind: "b" | "a" | "L" | "R" | "t"; slot: string | null; sig: string | null; path: string; w: number | null; h: number | null;
  taken_date: string | null; taken_time: string | null; caption: string; name: string | null; sort: number; created_at: string;
};
export async function loadPhotos(filter: { orderIds?: string[]; routeId?: string }) {
  const { company, roles, scope } = await requireCompany();
  if (!filter.routeId && filter.orderIds && !filter.orderIds.length) return [];
  const rows = await sql<(PhotoDb & { agency_id: string; hmd: string })[]>`
    select p.id, p.order_id, p.route_id, p.kind, p.slot, p.sig, p.path, p.w, p.h, p.taken_date, p.taken_time, p.caption, p.name, p.sort, p.created_at,
           o.agency_id, o.hmd
    from route_photos p
    join orders o on o.id = p.order_id
    where p.company_id = ${company.id}
    ${filter.routeId ? sql`and p.route_id = ${filter.routeId}` : filter.orderIds ? sql`and p.order_id in ${sql(filter.orderIds)}` : sql``}
    order by p.sort, p.taken_date nulls last, p.taken_time, p.created_at
  `;
  return rows
    .filter((r) => inScopeFor(roles, scope, r.agency_id, r.hmd))
    .map(({ agency_id: _a, hmd: _h, ...p }) => { void _a; void _h; return p as PhotoDb; });
}

/** URL ของไฟล์ (ตรวจสิทธิ์จริงที่ /api/files/... ตอนขอไฟล์) */
export async function signUrls(paths: string[]) {
  const uniq = [...new Set(paths.filter(Boolean))];
  const out: Record<string, string> = {};
  for (const p of uniq) out[p] = fileUrl(p);
  return out;
}

/** ค่าแรงและค่าใช้จ่ายจากบันทึกรายวันของแต่ละใบสั่งจ้าง */
export type WorkItem = { r: string; km?: number | null };
type LogRow = { order_id: string | null; route_ids: string[] | null; work: WorkItem[] | null; crew: { on?: boolean; wage?: number; ot?: number }[]; fuel: number | null; other: number | null };

/**
 * ต้นทุนรายวันต่อใบสั่งจ้าง + ระยะที่ตัดได้สะสมต่อสาย
 * วันที่ทำหลายหมวด แบ่งค่าแรงและค่าน้ำมันตาม กม. ที่ตัดได้ ถ้าวันนั้นมีสายที่ไม่ได้ใส่ กม. ใช้ ตร.ม. แทน
 */
export async function loadCosts(orderIds: string[]) {
  const { who } = await requireCompany();
  const out: Record<string, { lab: number; oth: number; md: number; days: number }> = {};
  const km: Record<string, number> = {};
  if (!orderIds.length) return { costs: out, km };
  const mine = await routesV(who, sql`and r.order_id in ${sql(orderIds)}`);
  const myIds = mine.map((r) => r.id);
  const [a, b] = await Promise.all([
    myIds.length ? dailyV(who, sql`and route_ids && ${myIds}::uuid[]`) : Promise.resolve([]),
    dailyV(who, sql`and order_id in ${sql(orderIds)} and route_ids = '{}'`),
  ]);
  const logs: LogRow[] = [...a, ...b];
  const all = [...new Set(logs.flatMap((l) => l.route_ids ?? []))];
  const rs = all.length ? await routesV(who, sql`and r.id in ${sql(all)}`) : [];
  const R = new Map(rs.map((r) => [r.id, r]));
  const want = new Set(orderIds);
  for (const l of logs) {
    let lab = 0, md = 0;
    for (const w of l.crew || []) if (w.on) { lab += Number(w.wage || 0) + Number(w.ot || 0); md++; }
    const oth = Number(l.fuel || 0) + Number(l.other || 0);
    const items = (l.work ?? []).filter((w) => R.has(w.r));
    for (const w of items) if (w.km != null && Number(w.km) > 0) km[w.r] = (km[w.r] ?? 0) + Number(w.km);
    const share: Record<string, number> = {};
    if (items.length) {
      const byKm = items.every((w) => w.km != null && Number(w.km) > 0);
      const wt = items.map((w) => (byKm ? Number(w.km) : Number(R.get(w.r)!.area) || 0));
      const tot = wt.reduce((x, y) => x + y, 0);
      items.forEach((w, i) => { const o = R.get(w.r)!.order_id; share[o] = (share[o] ?? 0) + (tot > 0 ? wt[i] / tot : 1 / items.length); });
    } else if (l.order_id) share[l.order_id] = 1;
    for (const [o, f] of Object.entries(share)) {
      if (!want.has(o)) continue;
      const c = (out[o] ??= { lab: 0, oth: 0, md: 0, days: 0 });
      c.lab += lab * f; c.oth += oth * f; c.md += md * f; if (md) c.days += f;
    }
  }
  return { costs: out, km };
}
