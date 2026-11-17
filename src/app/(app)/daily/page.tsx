import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { loadAgencies, loadOrders, loadPhotos, signUrls } from "@/lib/orders";
import { routeState } from "@/lib/progress";
import { addDays, todayBkk } from "@/lib/calc";
import { coHead } from "@/lib/docs";
import { DailyEditor, type DayRec, type RouteOpt } from "@/components/DailyEditor";
import type { CrewDay } from "@/lib/print/pages";

type WorkItem = { r: string; km: number | null };
type CrewItem = CrewDay;

export const metadata = { title: "บันทึกรายวัน · งานตัดหญ้า" };

const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const weekOf = (s: string) => { const k = (new Date(s + "T00:00:00Z").getUTCDay() + 6) % 7; const a = addDays(s, -k); return [...Array(7)].map((_, i) => addDays(a, i)); };

export default async function DailyPage({ searchParams }: { searchParams: Promise<{ d?: string; m?: string }> }) {
  const sp = await searchParams;
  const { company, perm } = await requireCompany();
  const day = isDate(sp.d) ? sp.d! : todayBkk();
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : day.slice(0, 7);
  const week = weekOf(day);
  const mStart = month + "-01";
  const mEnd = addDays(addDays(mStart, 32).slice(0, 7) + "-01", -1);
  const from = [mStart, week[0]].sort()[0], to = [mEnd, week[6]].sort()[1];
  const [logsRaw, kmLogsRaw, crewRaw, agencies, orders, urls] = await Promise.all([
    sql<{ log_date: string; order_id: string | null; work: WorkItem[]; crew: CrewItem[]; fuel: number; other: number; note: string }[]>`
      select log_date, order_id, work, crew, fuel, other, note from daily_logs
      where company_id = ${company.id} and log_date >= ${from} and log_date <= ${to}
    `,
    sql<{ log_date: string; work: WorkItem[] }[]>`
      select log_date, work from daily_logs where company_id = ${company.id} and route_ids <> '{}'
    `,
    sql<{ id: string; name: string; wage: number }[]>`
      select id, name, wage from crew where company_id = ${company.id} and active = true order by sort, created_at
    `,
    loadAgencies(),
    loadOrders(),
    signUrls([company.logo_path ?? ""]),
  ]);
  const multi = agencies.length > 1;
  const photos = await loadPhotos({ orderIds: orders.map((o) => o.id) });
  // งานของสายที่อยู่นอกขอบเขตของผู้ดูจะไม่แสดง (ค่าแรง/ค่าน้ำมันก็เห็นตามสิทธิ์)
  const inScopeRouteIds = new Set(orders.flatMap((o) => o.routes.map((r) => r.id)));
  const logs = logsRaw.map((l) => ({
    ...l,
    work: (l.work ?? []).filter((w) => inScopeRouteIds.has(w.r)),
    crew: perm.wages ? l.crew ?? [] : (l.crew ?? []).map((c) => ({ ...c, wage: 0, ot: 0 })),
    fuel: perm.fuel ? l.fuel : 0,
    other: perm.fuel ? l.other : 0,
  }));
  const kmLogs = kmLogsRaw.map((l) => ({ ...l, work: (l.work ?? []).filter((w) => inScopeRouteIds.has(w.r)) }));
  const crew = crewRaw.map((c) => ({ ...c, wage: perm.wages ? Number(c.wage) : 0 }));
  // ระยะที่ตัดได้สะสมต่อสาย (ไม่นับวันที่กำลังแก้ หน้าจอจะบวกค่าของวันนี้เอง)
  const kmDone: Record<string, number> = {};
  for (const l of kmLogs) {
    if (l.log_date === day) continue;
    for (const w of l.work ?? []) if (w.km != null) kmDone[w.r] = (kmDone[w.r] ?? 0) + Number(w.km);
  }
  const routes: RouteOpt[] = orders.flatMap((o) => {
    const A = agencies.find((a) => a.id === o.agency_id);
    return o.routes.map((r) => ({
      id: r.id, code: r.code, descr: r.descr, order_id: o.id, round: o.round_no, hmd: o.hmd, area: r.area,
      ag: o.agency_id, agName: multi && A ? A.short_name || A.name : "",
      len: r.length_km, kmDone: kmDone[r.id] ?? 0,
      done: routeState(r, photos.filter((p) => p.route_id === r.id)).s === 2,
    }));
  });
  const recs: DayRec[] = (logs ?? []).map((l) => ({
    date: l.log_date, order_id: l.order_id ?? "", work: (l.work ?? []).map((w: { r: string; km: number | null }) => ({ r: w.r, km: w.km == null ? "" : String(w.km) })),
    crew: l.crew ?? [], fuel: Number(l.fuel ?? 0), other: Number(l.other ?? 0), note: l.note ?? "",
  }));
  return (
    <DailyEditor
      key={day}
      day={day}
      month={month}
      week={week}
      today={todayBkk()}
      recs={recs}
      crew={(crew ?? []).map((c) => ({ id: c.id, name: c.name, wage: Number(c.wage ?? 0) }))}
      routes={routes}
      can={{ edit: perm.daily, wages: perm.wages, fuel: perm.fuel }}
      company={{ head: coHead(company), signer: company.signer_name ?? "", name: company.name }}
      urls={urls}
    />
  );
}
