"use client";

// ใบสั่งจ้าง: ตาราง งวด × หมวด ของแต่ละแขวง (แบบเดียวกับระบบบน claude.ai)
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Chip, Stat, Top } from "@/components/ui";
import { type DocLite, lateDays, orderTotal, poLate, poParts, poStat, poStep } from "@/lib/docboard";
import { type Order, type World, cNorm, fmt0, fyOf, hasPo, rkQuery, roundKeys, roundOf } from "@/lib/model";

type F = "all" | "docs" | "bill" | "done";
const NEXT = ["", "ทำใบเสนอราคา", "ทำหนังสือส่งมอบ", "ออกใบกำกับ/ใบเสร็จ", "ครบแล้ว"];

function Dots({ P }: { P: ("d" | "r" | "")[] }) {
  const nx = P.findIndex((x) => x !== "d");
  return <span className="dots">{P.map((x, i) => <i key={i} className={x === "d" ? "d" : x === "r" ? "r" : i === nx ? "p" : ""} />)}</span>;
}
const dotsN = (s: number) => <Dots P={[0, 1, 2, 3].map((i) => (i < s ? "d" : ""))} />;

export function PosView({ W, ag, docs, today, can }: { W: World; ag: string; docs: DocLite[]; today: string; can: { orders: boolean; prices: boolean } }) {
  const router = useRouter();
  const [f, setF] = useState<F>("all");
  const [yr, setYr] = useState("");
  const [qs, setQ] = useState("");
  const [more, setMore] = useState(false);
  const A = W.agencies.find((a) => a.id === ag);

  if (!A) return (
    <div className="ax"><div className="pg">
      <Top crumb={<>สำนักงาน › <b>ใบสั่งจ้าง</b></>} title="ใบสั่งจ้าง" />
      <div className="body"><div className="card"><div className="emp big"><h3>ยังไม่มีแขวง</h3><p>เพิ่มแขวงและหมวดที่หน้าตั้งค่าก่อน</p>{can.orders ? <Link className="btn pr" href="/settings/agencies">ไปหน้าแขวงและหมวด</Link> : null}</div></div></div>
    </div></div>
  );

  const ks = roundKeys(W, A.id), yrs = [...new Set(ks.map((k) => k.fy))].sort((a, b) => b - a);
  const all = W.orders.filter((o) => o.agency_id === A.id), q = cNorm(qs);
  const hitQ = (o: Order) => !q || cNorm(o.po_no).includes(q) || o.routes.some((r) => cNorm(r.code).includes(q));
  const cnt = (s: string) => all.filter((o) => hasPo(o) && poStat(o, docs) === s).length;
  const fy = yr ? Number(yr) : yrs[0] || fyOf(today), inY = all.filter((o) => o.fy === fy && hasPo(o));
  const val = (xs: Order[]) => (can.prices ? xs.reduce((s, o) => s + orderTotal(o), 0) : 0);
  const late = all.filter((o) => poLate(o, docs, today)).length, pend = inY.filter((o) => poStep(o, docs) < 4);
  const hs = (() => { const h2 = [...(A.hmds || [])]; for (const o of all) if (!h2.includes(o.hmd || "")) h2.push(o.hmd || ""); return h2.filter((h) => h || all.some((o) => !o.hmd)); })();
  const kY = ks.filter((k) => k.fy === fy);
  const miss = kY.reduce((n, k) => { const xs = roundOf(W, k); return n + hs.filter((h) => { const o = xs.find((x) => (x.hmd || "") === h); return !o || !hasPo(o); }).length; }, 0);
  const okF = (o: Order | null) => f === "all" || (!!o && hasPo(o) && poStat(o, docs) === f);
  const billed = inY.filter((o) => poStep(o, docs) === 4);

  const cell = (k: (typeof ks)[number], h: string, o: Order | null) => {
    if (!o || !hasPo(o)) return (
      <td key={h}>
        {can.orders ? (
          <Link className="pc none" href={o ? `/orders/${o.id}` : `/orders/new?${rkQuery(k)}&hmd=${encodeURIComponent(h)}`}>
            + อัปโหลดใบสั่งจ้าง{o ? <small>&nbsp;(มีแผน {o.routes.length} สาย)</small> : null}
          </Link>
        ) : <div className="pc none">ยังไม่มีใบสั่งจ้าง</div>}
      </td>
    );
    const s = poStep(o, docs), lt = poLate(o, docs, today), dim = !okF(o) || !hitQ(o);
    return (
      <td key={h}>
        <Link className={"pc" + (lt ? " late" : "") + (dim ? " dim" : "")} href={`/docs?${rkQuery(k)}`} title={NEXT[s]}>
          <div><b>{o.po_no}</b><div className="v">{can.prices ? `${fmt0(orderTotal(o))} บาท` : null}{lt ? <>{can.prices ? " · " : ""}<span style={{ color: "var(--bad)" }}>เลยกำหนด {lateDays(o.due_date!, today)} วัน</span></> : null}</div></div>
          <Dots P={poParts(o, docs)} />
        </Link>
      </td>
    );
  };

  let shown = 0, hidden = 0, lastY = 0;
  const rows: React.ReactNode[] = [];
  for (const k of ks) {
    if (yr && k.fy !== Number(yr)) continue;
    const xs = roundOf(W, k), sl = hs.map((h) => ({ h, o: xs.find((o) => (o.hmd || "") === h) ?? null }));
    if (f !== "all" && !xs.some((o) => okF(o))) continue;
    if (q && !xs.some(hitQ)) continue;
    const done = sl.every((s) => s.o && poStep(s.o, docs) === 4);
    if (done && !more && !q && f === "all" && shown >= 6) { hidden++; continue; }
    if (k.fy !== lastY) { rows.push(<tr key={"y" + k.fy} className="yr"><td colSpan={hs.length + 2}>ปีงบประมาณ {k.fy}</td></tr>); lastY = k.fy; }
    shown++;
    const sum = val(xs.filter(hasPo)), missK = sl.some((s) => !s.o || !hasPo(s.o));
    rows.push(
      <tr key={`${k.fy}~${k.no}`}>
        <td className="rk"><Link className="lnk" href={`/rounds?${rkQuery(k)}`}>งวด {k.no}</Link><small>{xs.reduce((n, o) => n + o.routes.length, 0)} สาย</small></td>
        {sl.map((s) => cell(k, s.h, s.o))}
        <td className="n"><b className="num">{sum ? fmt0(sum) : "–"}</b><div style={{ marginTop: 3 }}>{done ? <Chip c="g">ครบ</Chip> : missK ? <Chip c="w">ขาดใบสั่งจ้าง</Chip> : <Chip c="b">กำลังทำ</Chip>}</div></td>
      </tr>,
    );
  }
  const FS: [F, string, number | null][] = [["all", "ทั้งหมด", null], ["docs", "ค้างเอกสาร", cnt("docs")], ["bill", "รอออกใบกำกับ", cnt("bill")], ["done", "ครบ", cnt("done")]];

  return (
    <div className="ax"><div className="pg">
      <Top
        crumb={<>สำนักงาน › <b>ใบสั่งจ้าง</b></>}
        title={"ใบสั่งจ้าง · " + A.name}
        sub="แถว = งวด · คอลัมน์ = หมวด · จุด 4 ดวง = ใบสั่งจ้าง › เสนอราคา › ส่งมอบ › ใบกำกับ · กดช่องเพื่อไปหน้าเอกสารของงวดนั้น"
        acts={<>
          {W.agencies.length > 1 ? (
            <select className="in" style={{ width: "auto" }} value={A.id} onChange={(e) => router.push(`/pos?ag=${e.target.value}`)}>
              {W.agencies.map((a) => <option key={a.id} value={a.id}>{a.short_name || a.name}</option>)}
            </select>
          ) : null}
          {can.orders ? <Link className="btn pr" href={`/orders/new?ag=${A.id}`}>+ อัปโหลดใบสั่งจ้าง</Link> : null}
        </>}
      />
      <div className="body">
        <div className="stats">
          <Stat l={"ใบสั่งจ้างปีงบ " + fy} v={inY.length} u={`ใบ · ${kY.length} งวด`} s={miss ? `ยังขาด ${miss} หมวด` : " "} />
          <Stat l="มูลค่ารวม" v={can.prices ? fmt0(val(inY)) : "–"} u="บาท" s="รวม VAT" />
          <Stat l="ออกใบกำกับแล้ว" v={can.prices ? fmt0(val(billed)) : "–"} u="บาท" s={`${billed.length} ใบ`} />
          <Stat l="ค้างดำเนินการ" v={pend.length} u="ใบ" s={late ? <span style={{ color: "var(--bad)" }}>{late} ใบเลยกำหนดส่งมอบ</span> : " "} />
        </div>
        <div className="card">
          <div className="cb pbar">
            <div className="tabs">
              {FS.map(([k, t, n]) => <button key={k} type="button" className={f === k ? "on" : ""} onClick={() => setF(k)}>{t}{n != null ? <> <span className="muted small">{n}</span></> : null}</button>)}
            </div>
            <select className="in" style={{ width: "auto" }} value={yr} onChange={(e) => setYr(e.target.value)}>
              <option value="">ปีงบ: ทุกปี</option>
              {yrs.map((y) => <option key={y} value={y}>ปีงบ {y}</option>)}
            </select>
            <input className="in" placeholder="ค้นหาเลขที่ใบสั่งจ้าง / เลขสาย" value={qs} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
          </div>
          {ks.length ? (
            <>
              <div className="tscroll"><table className="tb mx">
                <thead><tr><th style={{ width: 92 }}>งวด</th>{hs.map((h) => <th key={h}>{h ? "หมวด" + h : "ไม่ระบุหมวด"}</th>)}<th className="n" style={{ width: 130 }}>รวมงวด</th></tr></thead>
                <tbody>{rows.length ? rows : <tr><td colSpan={hs.length + 2} className="muted" style={{ padding: 18 }}>ไม่มีงวดที่ตรงกับตัวกรอง</td></tr>}</tbody>
              </table></div>
              {hidden ? <div className="more"><button className="lnk" type="button" onClick={() => setMore(true)}>แสดงงวดที่ครบแล้วอีก {hidden} งวด ▾</button></div>
                : more ? <div className="more"><button className="lnk" type="button" onClick={() => setMore(false)}>ซ่อนงวดเก่าที่ครบแล้ว ▴</button></div> : null}
              <div className="legend">
                <span>{dotsN(1)} ได้ใบสั่งจ้าง</span><span>{dotsN(2)} เสนอราคาแล้ว</span><span>{dotsN(3)} ส่งมอบแล้ว</span><span>{dotsN(4)} ออกใบกำกับแล้ว</span>
                <span><i className="ldot" /> ขั้นถัดไปที่ต้องทำ</span><span><span className="dots"><i className="r" /></span> มีแต่ฉบับร่าง</span>
              </div>
            </>
          ) : (
            <div className="emp big"><h3>{A.short_name || A.name} ยังไม่มีงวดงาน</h3><p>สร้างงวดที่หน้า งาน หรือกด + อัปโหลดใบสั่งจ้าง</p></div>
          )}
        </div>
      </div>
    </div></div>
  );
}
