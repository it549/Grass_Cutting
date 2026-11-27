import "server-only";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { dailyV } from "@/lib/data/views";
import { loadDocs, loadWorld } from "@/lib/world";
import { docTodos, poStep } from "@/lib/docboard";
import { currentRound, hasPo, payWeekDay, weekOf, workIndex } from "@/lib/model";
import { todayBkk } from "@/lib/calc";
import { pendingJoins } from "@/lib/data/join";

export type Badges = { docs: number; pos: number; crew: boolean; join: number };

/** ตัวเลขที่เมนูซ้าย: เอกสารค้างของงวดปัจจุบัน · ใบสั่งจ้างที่ยังทำเอกสารไม่ครบ · ค่าแรงสัปดาห์นี้ที่ยังไม่จ่าย */
export async function navBadges(): Promise<Badges> {
  const { company, perm, who } = await requireCompany();
  const out: Badges = { docs: 0, pos: 0, crew: false, join: 0 };
  try {
    const jobs: Promise<void>[] = [];
    if (perm.docs) {
      jobs.push((async () => {
        const [W, docs] = await Promise.all([loadWorld(), loadDocs()]);
        const wi = workIndex(W.days);
        out.docs = docTodos(W, wi, currentRound(W, wi), docs).length;
        out.pos = W.orders.filter((o) => hasPo(o) && poStep(o, docs) < 4).length;
      })());
    }
    if (perm.wages) {
      jobs.push((async () => {
        const wk = weekOf(payWeekDay(todayBkk()));
        const [logs, pays] = await Promise.all([
          dailyV(who, sql`and log_date >= ${wk[0]} and log_date <= ${wk[6]}`),
          sql<{ crew_id: string }[]>`select crew_id from crew_pays where company_id = ${company.id} and week_start = ${wk[0]}`,
        ]);
        const paid = new Set(pays.map((p) => p.crew_id));
        const worked = new Set<string>();
        for (const l of logs) for (const c of (l.crew ?? []) as { id: string; on: boolean; ot?: number | null }[]) if (c.on || Number(c.ot) > 0) worked.add(c.id);
        out.crew = [...worked].some((id) => !paid.has(id));
      })());
    }
    if (perm.members) jobs.push(pendingJoins(company.id).then((n) => { out.join = n; }));
    await Promise.all(jobs);
  } catch {
    // ตัวเลขที่เมนูเป็นแค่ตัวช่วย ถ้าอ่านไม่ได้ก็ไม่แสดง
  }
  return out;
}
