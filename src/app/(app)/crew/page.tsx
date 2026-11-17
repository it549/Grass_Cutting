import { redirect } from "next/navigation";
import { requireCompany, logoUrl } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { crewPaysV, crewV, dailyV } from "@/lib/data/views";
import { loadWorld } from "@/lib/world";
import { todayBkk } from "@/lib/calc";
import { coHead } from "@/lib/docs";
import { type Advance, type Car, type CrewDay, type CrewRec, type Fuel, type World, weekOf } from "@/lib/model";
import type { LogLite, PayLite } from "@/lib/crewpay";
import { CrewView, type CrewTab } from "./CrewView";

export const metadata = { title: "คนงานและค่าแรง · งานตัดหญ้า" };

const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

export default async function CrewPage({ searchParams }: { searchParams: Promise<{ tab?: string; d?: string }> }) {
  const sp = await searchParams;
  const { company, perm, who } = await requireCompany();
  if (!perm.wages && !perm.daily && !perm.fuel) redirect("/");
  const tabs: CrewTab[] = [...(perm.wages ? ["pay" as const] : []), "crew", ...(perm.daily ? ["adv" as const] : []), ...(perm.fuel ? ["fuel" as const] : [])];
  const tab: CrewTab = tabs.includes(sp.tab as CrewTab) ? (sp.tab as CrewTab) : tabs[0];
  const today = todayBkk();
  const day = isDate(sp.d) ? sp.d! : today;
  const cid = company.id;
  const wk = weekOf(day);

  const [crew, logsRaw, adv, pays, fuel, cars, W, logo] = await Promise.all([
    crewV(who) as Promise<CrewRec[]>,
    dailyV(who) as Promise<{ log_date: string; work: LogLite["work"] | null; crew: CrewDay[] | null }[]>,
    perm.daily ? sql<Advance[]>`select id, crew_id, adv_date, amt, note from crew_advances where company_id = ${cid} order by adv_date, created_at` : Promise.resolve([] as Advance[]),
    perm.wages
      ? sql<PayLite[]>`select week_start, crew_id, name, pay_date, method, days, gross, ot, ded, net from crew_pays where company_id = ${cid} order by week_start`
      : (crewPaysV(who) as Promise<PayLite[]>),
    perm.fuel
      ? sql<Fuel[]>`select id, log_date, kind, liters, price, amt, crew_id, by_name, car_id, car_plate, odo, note, pic_path from fuel_logs where company_id = ${cid} order by log_date`
      : Promise.resolve([] as Fuel[]),
    sql<Car[]>`select id, plate, name, fuel_type, note, active, sort from cars where company_id = ${cid} order by sort, created_at`,
    tab === "pay" ? loadWorld({ days: false, pics: false }) : Promise.resolve(null as World | null),
    tab === "pay" ? logoUrl(company.logo_path) : Promise.resolve(null),
  ]);
  const n = (v: unknown) => (v == null ? null : Number(v));
  const logs: LogLite[] = logsRaw.map((l) => ({
    date: l.log_date, work: (l.work ?? []).map((w) => ({ r: w.r, km: n(w.km) })),
    crew: (l.crew ?? []).map((c) => ({ ...c, wage: n(c.wage), ot: n(c.ot) })),
  }));
  // งานของสัปดาห์ (สำหรับหัวใบสำคัญจ่าย): หมวด + เลขใบสั่งจ้าง
  const jobsOf = (ids: string[]) => {
    if (!W) return "";
    const multi = W.agencies.length > 1, seen = new Set<string>(), out: string[] = [];
    for (const o of W.orders) if (o.routes.some((r) => ids.includes(r.id)) && !seen.has(o.id)) {
      seen.add(o.id);
      const A = W.agencies.find((a) => a.id === o.agency_id);
      out.push(`${multi && A ? (A.short_name || A.name) + " " : ""}งวด ${o.round_no}/${o.fy}${o.hmd ? " หมวด" + o.hmd : ""}${o.po_no ? " ใบสั่งจ้าง " + o.po_no : ""}`);
    }
    return out.join(", ");
  };
  return (
    <CrewView
      key={tab + "|" + day}
      tab={tab}
      tabs={tabs}
      day={day}
      today={today}
      crew={crew.map((c) => ({ ...c, wage: n(c.wage) }))}
      logs={logs}
      adv={adv.map((a) => ({ ...a, amt: Number(a.amt) }))}
      pays={pays.map((p) => ({ ...p, ded: n(p.ded), days: n(p.days) ?? undefined, gross: n(p.gross) ?? undefined, ot: n(p.ot) ?? undefined, net: n(p.net) ?? undefined }))}
      fuel={fuel.map((f) => ({ ...f, liters: Number(f.liters), price: Number(f.price), amt: Number(f.amt), odo: n(f.odo) }))}
      cars={[...cars]}
      jobs={tab === "pay" ? jobsOf([...new Set(logs.filter((l) => wk.includes(l.date)).flatMap((l) => l.work.map((w) => w.r)))]) : ""}
      head={{ head: coHead(company), signer: company.signer_name ?? "", name: company.name }}
      logo={company.logo_path && logo ? { [company.logo_path]: logo } : {}}
      can={{ wages: perm.wages, daily: perm.daily, fuel: perm.fuel, cars: perm.orders || perm.daily }}
    />
  );
}
