import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { loadAgencies, loadOrders, loadPhotos } from "@/lib/orders";
import { routeState } from "@/lib/progress";
import { PackButton } from "@/components/PackButton";
import { dayDiff, fmt, fmt0, hmdFull, thaiDate, todayBkk, totals } from "@/lib/calc";
import { Flash } from "@/components/Flash";

export const metadata = { title: "งวดงาน · งานตัดหญ้า" };

export default async function RoundPage({ params, searchParams }: { params: Promise<{ agency: string; no: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { agency, no } = await params;
  const sp = await searchParams;
  const n = parseInt(no, 10);
  const { perm } = await requireCompany();
  const agencies = await loadAgencies();
  const A = agencies.find((a) => a.id === agency);
  if (!A || !(n > 0)) notFound();
  const xs = await loadOrders({ agency, round: n });
  const photos = await loadPhotos({ orderIds: xs.map((x) => x.id) });
  const doneOf = (x: (typeof xs)[number]) => x.routes.filter((r) => routeState(r, photos.filter((p) => p.route_id === r.id)).s === 2).length;
  const manage = perm.orders;
  const today = todayBkk();
  const ks = xs.map((x) => ({ x, t: totals(x.routes, x.vat_incl) }));
  const T = ks.reduce((s, { t }) => ({ n: s.n + t.n, area: s.area + t.area, pre: s.pre + t.pre, vat: s.vat + t.vat, total: s.total + t.total, wht: s.wht + t.wht }), { n: 0, area: 0, pre: 0, vat: 0, total: 0, wht: 0 });
  const dues = xs.map((x) => x.due_date).filter((d): d is string => Boolean(d)).sort();
  const left = dues[0] ? dayDiff(today, dues[0]) : null;
  const slots: ({ empty: string } | (typeof ks)[number])[] = [
    ...A.hmds.map((h) => ks.find((k) => k.x.hmd === h) ?? { empty: h }),
    ...ks.filter((k) => !A.hmds.includes(k.x.hmd)),
  ];

  return (
    <div className="pad">
      <div className="hd">
        <div>
          <div className="eyebrow">Installment {n}</div>
          <h2>งวดที่ {n}</h2>
          <div className="meta"><Link href="/rounds">← งวดงาน</Link> · {A.name} · {xs.length} หมวด</div>
        </div>
        {xs.length > 0 && perm.prices && (
          <div className="acts" style={{ alignItems: "flex-start" }}>
            <PackButton className="btn" orderIds={xs.map((x) => x.id)} mode="summary" label="PDF ใบสรุปทุกหมวด" filename={`ใบสรุปงวด-งวดที่ ${n}-${A.short_name || A.name}`} />
            <PackButton orderIds={xs.map((x) => x.id)} mode="pack" label="PDF ชุดส่งงวดทุกหมวด" filename={`ชุดส่งงวด-งวดที่ ${n}-${A.short_name || A.name}`} />
          </div>
        )}
      </div>
      <Flash {...sp} />
      <div className={"kp" + (perm.prices ? " kp4" : "")}>
        <div className="k"><div className="lab">สายทางทั้งงวด</div><div className="v num">{T.n}<small>สาย</small></div><div className="s">{fmt0(T.area)} ตร.ม.</div></div>
        {perm.prices && <>
        <div className="k"><div className="lab">มูลค่ารวม (รวม VAT)</div><div className="v num">{fmt0(Math.round(T.total))}<small>บาท</small></div><div className="s">ก่อนภาษี {fmt(T.pre)}</div></div>
        <div className="k"><div className="lab">หัก ณ ที่จ่าย 1%</div><div className="v num">{fmt0(Math.round(T.wht))}<small>บาท</small></div><div className="s">รับสุทธิ {fmt(T.total - T.wht)}</div></div>
        </>}
        <div className="k"><div className="lab">{left === null ? "กำหนดส่งมอบ" : left >= 0 ? "หมวดที่ต้องส่งก่อน" : "เลยกำหนด"}</div><div className="v num" style={left !== null && left < 0 ? { color: "var(--bad)" } : undefined}>{left === null ? "–" : Math.abs(left)}<small>{left === null ? "" : "วัน"}</small></div><div className="s">{thaiDate(dues[0]) || "ยังไม่ระบุ"}</div></div>
      </div>
      <div className="hc" style={{ marginTop: 18 }}>
        {slots.map((s) =>
          "empty" in s ? (
            <div key={"e" + s.empty} className="card empty-card">
              <div className="eyebrow">Pending</div>
              <div className="serif" style={{ fontSize: 17 }}>{hmdFull(s.empty)}</div>
              <div className="small muted">ยังไม่มีใบสั่งจ้างของหมวดนี้ในงวดที่ {n}</div>
              {manage && <Link className="btn sm dk" style={{ marginTop: 8 }} href={`/orders/new?agency=${A.id}&round=${n}&hmd=${encodeURIComponent(s.empty)}`}>+ แนบใบสั่งจ้าง</Link>}
            </div>
          ) : (
            <Link key={s.x.id} href={`/orders/${s.x.id}`} className="card cardlink">
              <div className="serif" style={{ fontSize: 17, lineHeight: 1.35 }}>{hmdFull(s.x.hmd)}</div>
              <div className="small muted">ใบสั่งจ้าง {s.x.po_no || "–"} · ลงวันที่ {thaiDate(s.x.po_date) || "–"}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
                <span className="num" style={{ fontSize: 28 }}>{s.t.n}<small className="muted" style={{ fontSize: 13 }}> สาย</small></span>
                {perm.prices && <span className="num" style={{ fontSize: 22 }}>{fmt(s.t.total)}</span>}
              </div>
              <div className="small muted">
                เสร็จ {doneOf(s.x)}/{s.t.n} สาย · {fmt0(s.t.area)} ตร.ม. ·{" "}
                {s.x.due_date ? (dayDiff(today, s.x.due_date) >= 0 ? `ส่งมอบใน ${dayDiff(today, s.x.due_date)} วัน (${thaiDate(s.x.due_date)})` : <span style={{ color: "var(--bad)" }}>เลยกำหนด {-dayDiff(today, s.x.due_date)} วัน</span>) : "ไม่ระบุกำหนดส่ง"}
              </div>
            </Link>
          ),
        )}
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>กดการ์ดหมวดเพื่อดูสายทาง ใส่รูปก่อน/หลัง{perm.docs ? " และออกเอกสารของหมวดนั้น" : ""}</p>
    </div>
  );
}
