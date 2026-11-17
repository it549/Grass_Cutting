import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { crewPaysV, crewV, dailyV } from "@/lib/data/views";
import { loadWorld } from "@/lib/world";
import { todayBkk } from "@/lib/calc";
import { type Advance, type Car, type CrewDay, type CrewRec, type DayRec, type Fuel, weekOf } from "@/lib/model";
import { DailyView } from "./DailyView";

export const metadata = { title: "บันทึกรายวัน · งานตัดหญ้า" };

const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
type Raw = { log_date: string; work: DayRec["work"] | null; crew: CrewDay[] | null; fuel: number | null; fuel_car: number | null; water: number | null; other: number | null; note: string | null };
const toRec = (l: Raw): DayRec => ({
  date: l.log_date, work: l.work ?? [], crew: (l.crew ?? []).map((c) => ({ ...c, wage: c.wage == null ? null : Number(c.wage), ot: c.ot == null ? null : Number(c.ot) })),
  fuel: Number(l.fuel ?? 0), fuel_car: Number(l.fuel_car ?? 0), water: Number(l.water ?? 0), other: Number(l.other ?? 0), note: l.note ?? "",
});

export default async function DailyPage({ searchParams }: { searchParams: Promise<{ d?: string; add?: string }> }) {
  const sp = await searchParams;
  const { company, perm, who } = await requireCompany();
  const cid = company.id;
  const today = todayBkk();
  const day = isDate(sp.d) ? sp.d! : today;
  const wk = weekOf(day);
  const [W, weekRows, prevRows, crew, pays, adv, fuel, cars] = await Promise.all([
    loadWorld(),
    dailyV(who, sql`and log_date >= ${wk[0]} and log_date <= ${wk[6]}`),
    dailyV(who, sql`and log_date < ${day}`, sql`order by log_date desc limit 14`),
    crewV(who),
    crewPaysV(who, sql`and week_start = ${wk[0]}`),
    perm.daily
      ? sql<Advance[]>`select id, crew_id, adv_date, amt, note from crew_advances where company_id = ${cid} and adv_date = ${day} order by created_at`
      : Promise.resolve([] as Advance[]),
    perm.fuel
      ? sql<Fuel[]>`
          select id, log_date, kind, liters, price, amt, crew_id, by_name, car_id, car_plate, odo, note, pic_path
          from fuel_logs where company_id = ${cid} and log_date >= ${wk[0]} and log_date <= ${wk[6]} order by created_at
        `
      : Promise.resolve([] as Fuel[]),
    sql<Car[]>`select id, plate, name, note, active, sort from cars where company_id = ${cid} order by sort, created_at`,
  ]);
  const week = (weekRows as Raw[]).map(toRec);
  const prev = (prevRows as Raw[]).map(toRec).find((r) => r.crew.some((c) => c.on));
  const add = String(sp.add ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  return (
    <DailyView
      key={day + "|" + add.join(",")}
      W={W}
      day={day}
      today={today}
      week={week}
      prev={prev ?? null}
      crew={(crew as CrewRec[]).map((c) => ({ ...c, wage: c.wage == null ? null : Number(c.wage) }))}
      paid={pays.map((p) => p.crew_id)}
      adv={adv.map((a) => ({ ...a, amt: Number(a.amt) }))}
      fuel={fuel.map((f) => ({ ...f, liters: Number(f.liters), price: Number(f.price), amt: Number(f.amt), odo: f.odo == null ? null : Number(f.odo) }))}
      cars={[...cars]}
      add={add}
      can={{ edit: perm.daily, wages: perm.wages, fuel: perm.fuel }}
    />
  );
}
