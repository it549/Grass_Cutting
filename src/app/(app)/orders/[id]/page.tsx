import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { fileUrl as toFileUrl } from "@/lib/data/files";
import { loadAgencies, loadCosts, loadOrders, loadPhotos } from "@/lib/orders";
import { fmt, fmt0, fmtKm, hmdFull, lineAmt, thaiDate, totals } from "@/lib/calc";
import { routeState, STATE_LABEL } from "@/lib/progress";
import { KIND, STATUS_LABEL, type DocKind, type DocStatus } from "@/lib/docs";
import { OrderEditor } from "@/components/OrderEditor";
import { PackButton } from "@/components/PackButton";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteOrder } from "../actions";
import { createDoc } from "../../docs/actions";

export const metadata = { title: "ใบสั่งจ้าง · งานตัดหญ้า" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { perm, company } = await requireCompany();
  const [agencies, orders] = await Promise.all([loadAgencies(), loadOrders()]);
  const o = orders.find((x) => x.id === id);
  if (!o) notFound();
  const ag = agencies.find((a) => a.id === o.agency_id);
  const manage = perm.orders;
  const [photos, { costs, km }, docList] = await Promise.all([
    loadPhotos({ orderIds: [o.id] }),
    loadCosts([o.id]),
    perm.docs
      ? sql<{ id: string; kind: DocKind; no: string; doc_date: string; status: DocStatus; total: number }[]>`
          select id, kind, no, doc_date, status, total from documents where company_id = ${company.id} and order_id = ${o.id} order by no
        `
      : Promise.resolve([]),
  ]);
  const fileUrl = o.po_file_path && perm.prices ? toFileUrl(o.po_file_path) : null;
  const t = totals(o.routes, o.vat_incl);
  const rs = o.routes.map((r) => ({ r, st: routeState(r, photos.filter((p) => p.route_id === r.id)) }));
  const doneN = rs.filter((x) => x.st.s === 2).length;
  const doneArea = rs.filter((x) => x.st.s === 2).reduce((s, x) => s + x.r.area, 0);
  const c = costs[o.id] ?? { lab: 0, oth: 0, md: 0, days: 0 };
  const label = `งวดที่ ${o.round_no} ${hmdFull(o.hmd)}`;

  return (
    <div className="pad">
      <div className="hd">
        <div>
          <div className="eyebrow">Purchase order</div>
          <h2>{hmdFull(o.hmd)}</h2>
          <div className="meta">
            <Link href={`/rounds/${o.agency_id}/${o.round_no}`}>← {ag?.name ?? "แขวง"} งวดที่ {o.round_no}</Link>
            {" · "}ใบสั่งจ้าง {o.po_no || "–"}{o.po_date ? ` ลงวันที่ ${thaiDate(o.po_date)}` : ""}
          </div>
        </div>
        <div className="acts" style={{ alignItems: "flex-start" }}>
          {fileUrl && <a className="btn" href={fileUrl} target="_blank" rel="noreferrer">เปิดไฟล์ใบสั่งจ้าง</a>}
          {perm.prices && <>
          <PackButton className="btn" orderIds={[o.id]} mode="summary" label="PDF ใบสรุปงวด" filename={`ใบสรุปงวด-งวดที่ ${o.round_no}-${o.hmd}`} />
          <PackButton orderIds={[o.id]} mode="pack" label="PDF ชุดส่งงวด (สรุป + รูปทุกสาย)" filename={`ชุดส่งงวด-งวดที่ ${o.round_no}-ใบสั่งจ้าง ${o.po_no || ""}`} />
          </>}
        </div>
      </div>
      <Flash {...sp} />

      <div className={"kp" + (perm.prices ? " kp4" : "")}>
        <div className="k"><div className="lab">ผลงาน</div><div className="v num">{doneN}<small>/ {rs.length} สาย</small></div><div className="s">{fmt0(doneArea)} / {fmt0(t.area)} ตร.ม.</div></div>
        {perm.prices && <div className="k"><div className="lab">มูลค่า (รวม VAT)</div><div className="v num">{fmt0(Math.round(t.total))}<small>บาท</small></div><div className="s">ก่อนภาษี {fmt(t.pre)} · หัก 1% {fmt(t.wht)}</div></div>}
        {perm.wages && <>
        <div className="k"><div className="lab">ค่าแรง + น้ำมัน/อื่น ๆ</div><div className="v num">{fmt0(Math.round(c.lab + c.oth))}<small>บาท</small></div><div className="s">{+c.md.toFixed(1)} คน-วัน · {+c.days.toFixed(1)} วันทำงาน · <Link href="/daily">บันทึกรายวัน</Link></div></div>
        <div className="k"><div className="lab">กำไรขั้นต้นโดยประมาณ</div><div className="v num" style={t.pre - c.lab - c.oth < 0 ? { color: "var(--bad)" } : undefined}>{fmt0(Math.round(t.pre - c.lab - c.oth))}<small>บาท</small></div><div className="s">ยอดก่อนภาษี − ค่าแรง − ค่าใช้จ่าย</div></div>
        </>}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="serif h3">สายทางและรูปก่อน/หลัง</div>
        {rs.length === 0 ? (
          <p className="small muted">ยังไม่มีสายทาง กรอกในส่วน “แก้ไขใบสั่งจ้าง” ด้านล่าง</p>
        ) : (
          <table className="tbl">
            <thead><tr><th style={{ width: 40 }}>#</th><th style={{ width: 110 }}>สายทาง</th><th>ชื่อสายทาง</th><th className="n" style={{ width: 110 }}>พื้นที่</th>{perm.prices && <th className="n" style={{ width: 120 }}>จำนวนเงิน</th>}<th className="c" style={{ width: 90 }}>รูป ก่อน/หลัง</th><th className="n" style={{ width: 110 }}>ตัดแล้ว (กม.)</th><th style={{ width: 100 }}>สถานะ</th><th style={{ width: 110 }}>วันที่เสร็จ</th><th style={{ width: 70 }} /></tr></thead>
            <tbody>
              {rs.map(({ r, st }, i) => (
                <tr key={r.id}>
                  <td className="c muted">{i + 1}</td>
                  <td>{r.code}</td>
                  <td>{r.descr}</td>
                  <td className="n">{fmt0(r.area)}</td>
                  {perm.prices && <td className="n">{fmt(lineAmt(r))}</td>}
                  <td className="c">{st.b} / {st.a}</td>
                  <td className="n">{km[r.id] || r.length_km ? `${fmtKm(km[r.id] ?? 0)}${r.length_km ? " / " + fmtKm(r.length_km) : ""}` : "–"}</td>
                  <td><span className={"st s" + st.s}>{STATE_LABEL[st.s]}</span></td>
                  <td>{thaiDate(st.doneDate) || "–"}</td>
                  <td><Link href={`/orders/${o.id}/routes/${r.id}`}>รูป →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {perm.docs && <div className="card" style={{ marginTop: 18 }}>
        <div className="serif h3">เอกสารของใบสั่งจ้างนี้</div>
        <div className="grid3">
          {(["qt", "dl", "rc"] as DocKind[]).map((k) => (
            <div key={k} className="dcol">
              <div className="eyebrow">{KIND[k].en || "Delivery letter"}</div>
              <b className="serif">{KIND[k].t}</b>
              {docList.filter((d) => d.kind === k).map((d) => (
                <Link key={d.id} href={`/docs/${d.id}`} className="dl-row">
                  <span>{d.no}</span>
                  <span className={"st " + STATUS_LABEL[d.status][1]}>{STATUS_LABEL[d.status][0]}</span>
                  <small className="muted">{thaiDate(d.doc_date)} · {fmt(d.total)}</small>
                </Link>
              ))}
              {!docList.some((d) => d.kind === k) && <p className="small muted" style={{ margin: "6px 0" }}>ยังไม่มี</p>}
              {perm.docKind(k) && (
                <form action={createDoc}>
                  <input type="hidden" name="kind" value={k} />
                  <input type="hidden" name="order" value={o.id} />
                  <button className="btn sm dk" type="submit">+ สร้าง{KIND[k].short}</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>}

      {perm.prices && <details className="card" style={{ marginTop: 18 }} open={o.routes.length === 0}>
        <summary className="serif h3" style={{ cursor: "pointer", marginBottom: 0 }}>{manage ? "แก้ไขใบสั่งจ้างและสายทาง" : "ข้อมูลใบสั่งจ้าง"}</summary>
        <div style={{ marginTop: 14 }}>
          <OrderEditor
            key={o.id + o.po_no + o.routes.length}
            agencies={agencies}
            readOnly={!manage}
            canRead={Boolean(process.env.ANTHROPIC_API_KEY)}
            initial={{
              id: o.id, agency_id: o.agency_id, round_no: o.round_no, hmd: o.hmd, po_no: o.po_no ?? "", po_date: o.po_date ?? "",
              proj_no: o.proj_no ?? "", due_days: o.due_days ? String(o.due_days) : "", due_date: o.due_date ?? "", penalty: o.penalty ?? "",
              vat_incl: o.vat_incl, note: o.note ?? "", po_file_path: "", routes: o.routes,
            }}
          />
          {manage && (
            <form action={deleteOrder} style={{ marginTop: 28 }}>
              <input type="hidden" name="id" value={o.id} />
              <ConfirmButton className="link bad" message={`ลบใบสั่งจ้าง ${o.po_no || ""} ของ${hmdFull(o.hmd)} พร้อมสายทางและรูปทั้งหมด?`}>ลบใบสั่งจ้างนี้</ConfirmButton>
            </form>
          )}
        </div>
      </details>}
      <p className="small muted" style={{ marginTop: 10 }}>{label}</p>
    </div>
  );
}
