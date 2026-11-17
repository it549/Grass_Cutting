import Link from "next/link";
import { requireCompany } from "@/lib/context";
import { loadAgencies, loadOrders } from "@/lib/orders";
import { fmt, fmt0, totals } from "@/lib/calc";

export const metadata = { title: "งวดงาน · งานตัดหญ้า" };

export default async function Rounds() {
  const { perm } = await requireCompany();
  const [agencies, orders] = await Promise.all([loadAgencies(), loadOrders()]);
  const manage = perm.orders;
  return (
    <div className="pad">
      <div className="hd"><div><div className="eyebrow">Installments</div><h2>งวดงาน</h2><div className="meta">แต่ละงวดมีใบสั่งจ้างแยกตามหมวด</div></div></div>
      {!agencies.length && <div className="card empty-card"><p>ยังไม่มีแขวง <Link href="/settings/agencies">เพิ่มแขวงก่อน</Link></p></div>}
      {agencies.map((a) => {
        const os = orders.filter((o) => o.agency_id === a.id);
        const rounds = [...new Set(os.map((o) => o.round_no))].sort((x, y) => y - x);
        const next = (rounds[0] ?? 0) + 1;
        return (
          <section key={a.id} style={{ marginBottom: 30 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <div className="serif" style={{ fontSize: 18 }}>{a.name}</div>
              {manage && <Link className="btn sm dk" href={`/orders/new?agency=${a.id}&round=${next}`}>+ สร้างงวดที่ {next}</Link>}
            </div>
            {!rounds.length && <p className="small muted">ยังไม่มีงวด กดสร้างงวดแรกแล้วแนบใบสั่งจ้าง</p>}
            <div className="hc">
              {rounds.map((n) => {
                const xs = os.filter((o) => o.round_no === n);
                const T = xs.reduce((s, o) => { const t = totals(o.routes, o.vat_incl); return { n: s.n + t.n, area: s.area + t.area, total: s.total + t.total }; }, { n: 0, area: 0, total: 0 });
                return (
                  <Link key={n} href={`/rounds/${a.id}/${n}`} className="card cardlink">
                    <div className="eyebrow">Installment {n}</div>
                    <div className="serif" style={{ fontSize: 20 }}>งวดที่ {n}</div>
                    <div className="small muted">{xs.length}/{Math.max(a.hmds.length, xs.length)} หมวด · {xs.map((x) => x.hmd).join(" · ")}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
                      <span className="num" style={{ fontSize: 26 }}>{T.n}<small className="muted" style={{ fontSize: 13 }}> สาย · {fmt0(T.area)} ตร.ม.</small></span>
                      {perm.prices && <span className="num" style={{ fontSize: 20 }}>{fmt(T.total)}</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
