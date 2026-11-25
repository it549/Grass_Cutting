"use client";

// หน้างาน: งวด = แขวง + ปีงบ + งวดที่ · ช่องหมวด · ตารางสายของหมวดที่เลือก (แบบเดียวกับระบบบน claude.ai)
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bar, Chip, MapA, Stat, Top } from "@/components/ui";
import { RoundDialog } from "@/components/RoundDialog";
import { PackButton } from "@/components/PackButton";
import { totals } from "@/lib/calc";
import {
  type Order, type RInfo, type RoundKey, type World,
  RK_COL, R_ST, dS, dShort, dateRange, fmt0, fmtKm, hasPo, hmdName, orderAgg, pct, poRoutes, rInfo, regOf, rkName, rkQuery, rkSame, rkStat,
  roundKeys, roundOf, roundSlots, workIndex,
} from "@/lib/model";

type Can = { orders: boolean; roads: boolean; prices: boolean; docs: boolean; daily: boolean };
type WF = "all" | "open" | "cut" | "done";
const WFS: [WF, string][] = [["all", "ทั้งหมด"], ["open", "ยังไม่เสร็จ"], ["cut", "ตัดครบ รอรูป"], ["done", "ครบ"]];
const wfOk = (s: RInfo["s"], f: WF) => f === "all" || (f === "open" ? s === "todo" || s === "wip" : s === f);
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });

export function WorkView({ W, k, agSel, focus, openNew, can }: {
  W: World; k: RoundKey | null; agSel: string; focus: { h: string | null; o: string | null }; openNew: boolean; can: Can;
}) {
  const router = useRouter();
  const wi = useMemo(() => workIndex(W.days), [W.days]);
  const [dlg, setDlg] = useState<null | { edit: boolean; h?: string | null }>(openNew && can.orders ? { edit: false } : null);
  const fo = focus.o ? W.orders.find((o) => o.id === focus.o) : null;
  const [hSel, setHSel] = useState<string | null>(fo ? fo.hmd || "" : focus.h);
  const [wf, setWf] = useState<WF>("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [wDate, setWDate] = useState(today());

  const goK = (x: RoundKey, h?: string) => router.push(`/rounds?${rkQuery(x)}${h != null ? "&h=" + encodeURIComponent(h) : ""}`);
  const agPick = W.agencies.length > 1 ? (
    <select className="in" style={{ width: "auto" }} value={agSel} onChange={(e) => router.push(e.target.value ? `/rounds?ag=${e.target.value}` : "/rounds")}>
      <option value="">ทุกแขวง</option>
      {W.agencies.map((a) => <option key={a.id} value={a.id}>{a.short_name || a.name}</option>)}
    </select>
  ) : null;
  const dialog = dlg ? (
    <RoundDialog W={W} editK={dlg.edit ? k : null} initAg={agSel || k?.ag} focusH={dlg.h ?? null}
      onClose={() => setDlg(null)} onDone={(x, h) => { setDlg(null); if (h != null) setHSel(h); goK(x, h); }} />
  ) : null;

  if (!k) {
    const A = agSel ? W.agencies.find((a) => a.id === agSel) : null;
    return (
      <div className="ax"><div className="pg">
        <Top crumb={<>หน้างาน › <b>งาน</b></>} title="งาน" acts={<>{agPick}{can.orders ? <button className="btn pr" type="button" onClick={() => setDlg({ edit: false })}>+ สร้างงวดใหม่</button> : null}</>} />
        <div className="body"><div className="card"><div className="emp big">
          {!W.agencies.length ? <><h3>ยังไม่มีแขวง</h3><p>เพิ่มแขวงและหมวดที่หน้าตั้งค่าก่อน</p>{can.orders ? <Link className="btn pr" href="/settings/agencies">ไปหน้าแขวงและหมวด</Link> : null}</>
            : W.roads.length ? <><h3>{A ? (A.short_name || A.name) + " ยังไม่มีงวดงาน" : "ยังไม่มีงวดงาน"}</h3><p>สร้างงวดแรกโดยเลือกสายทางจากทะเบียน ลูกค้าแจ้งเลขสายมาก็พิมพ์ได้เลย</p>{can.orders ? <button className="btn pr" type="button" onClick={() => setDlg({ edit: false })}>+ สร้างงวดแรก</button> : null}</>
              : <><h3>เริ่มจากทะเบียนสายทาง</h3><p>บันทึกสายทางของแต่ละหมวดครั้งเดียว (เลขสาย ชื่อสาย อำเภอ ความยาว) แล้วสร้างงวดโดยเลือกจากทะเบียน</p><Link className="btn pr" href="/roads">ไปที่ทะเบียนสายทาง</Link></>}
        </div></div></div>
        {dialog}
      </div></div>
    );
  }

  const A = W.agencies.find((a) => a.id === k.ag)!;
  const xs = roundOf(W, k), gs = new Map(xs.map((o) => [o.id, orderAgg(W, wi, o)]));
  const T = [...gs.values()].reduce((t, g) => ({ n: t.n + g.n, cut: t.cut + g.cut, pics: t.pics + g.pics, km: t.km + g.km, L: t.L + g.L }), { n: 0, cut: 0, pics: 0, km: 0, L: 0 });
  const poN = xs.filter(hasPo).length, start = xs.map((o) => o.start_date).filter(Boolean).sort()[0];
  const slots = roundSlots(W, k);
  const hv = hSel != null && slots.some((s) => s.h === hSel) ? hSel
    : (slots.find((s) => s.o && gs.get(s.o.id)!.cut < gs.get(s.o.id)!.n) ?? slots[0])?.h ?? "";
  const cur = slots.find((s) => s.h === hv) ?? { h: "", o: null };

  const toDaily = (ids: string[], d: string) => router.push(`/daily?d=${d}&add=${ids.join(",")}`);
  const card = (o: Order) => {
    const g = gs.get(o.id)!;
    const stage = g.done === g.n && g.n ? 3 : g.started ? 2 : 1;
    const sb: [string, number][] = [["รับแผน", 1], [g.started ? `ตัดหญ้า · ${g.cut}/${g.n} สาย` : "ตัดหญ้า", 2], ["ตัดครบและรูปครบ", 3]];
    const vis = o.routes.map((r) => ({ r, x: rInfo(W, wi, r) })).filter(({ x }) => wfOk(x.s, wf));
    const openR = vis.filter(({ x }) => !x.cut), key = (rid: string) => o.id + "|" + rid;
    const selN = o.routes.filter((r) => sel.has(key(r.id))).length;
    const setK = (ids: string[], on: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
    const val = can.prices && hasPo(o) ? totals(poRoutes(o).map((r) => ({ area: r.area, rate: r.rate ?? 0 })), o.vat_incl).total : 0;
    return (
      <div className={"card" + (focus.o === o.id ? " focus" : "")} id={"c-" + o.id}>
        <div className="ch">
          <h3>{hmdName(o.hmd)} <span className="m">{g.n} สาย{g.L ? " · " + fmtKm(g.L) + " กม." : ""}</span></h3>
          <div className="acts">
            {hasPo(o) ? <Chip c="g">ใบสั่งจ้าง {o.po_no}</Chip> : <Chip c="w">ยังไม่ได้ใบสั่งจ้าง</Chip>}
            <Chip c={g.pics === g.n && g.n ? "b" : "nd"}>รูปครบ {g.pics}/{g.n}</Chip>
            {can.orders ? <button className="btn sm" type="button" onClick={() => setDlg({ edit: true, h: o.hmd })}>แก้สาย</button> : null}
            {can.orders ? <Link className="btn sm" href={`/orders/${o.id}`}>{hasPo(o) ? "ใบสั่งจ้าง" : "+ อัปโหลดใบสั่งจ้าง"}</Link> : null}
            {can.docs ? <Link className="btn sm" href={`/docs?${rkQuery(k)}`}>เอกสาร →</Link> : null}
          </div>
        </div>
        <div className="cb" style={{ paddingBottom: 4 }}>
          <div className="stage">{sb.map(([t, i]) => { const dn = i < stage || stage === 3; return <div key={i} className={dn ? "dn" : i === stage ? "cu" : ""}>{dn ? "✓ " : ""}{t}</div>; })}</div>
        </div>
        {selN && can.daily ? (
          <div className="selbar">
            <b>เลือก {selN} สาย</b><span className="small">ลงงานวันที่</span>
            <input type="date" className="in inl" value={wDate} onChange={(e) => setWDate(e.target.value || today())} />
            <button className="btn sm pr" type="button" onClick={() => toDaily(o.routes.filter((r) => sel.has(key(r.id))).map((r) => r.id), wDate)}>เปิดบันทึกรายวันพร้อม {selN} สายนี้ →</button>
            <button className="lnk small" type="button" onClick={() => setK(o.routes.map((r) => key(r.id)), false)}>ล้างที่เลือก</button>
          </div>
        ) : null}
        <div className="tscroll"><table className="tb">
          <thead><tr>
            <th className="ck">{openR.length && can.daily ? <input type="checkbox" title="เลือกทุกสายที่ยังไม่เสร็จ" checked={openR.every(({ r }) => sel.has(key(r.id)))} onChange={(e) => setK(openR.map(({ r }) => key(r.id)), e.target.checked)} /> : null}</th>
            <th>สายทาง</th><th style={{ width: "20%" }}>ระยะที่ตัด (กม.)</th><th>วันที่ตัด</th><th>รูปก่อน / หลัง</th><th>สถานะ</th><th style={{ width: 118 }}></th>
          </tr></thead>
          <tbody>
            {vis.length ? vis.map(({ r, x }) => {
              const [st, c] = R_ST[x.s], g2 = regOf(W, o, r);
              return (
                <tr key={r.id} className={"click" + (sel.has(key(r.id)) ? " sel" : "")} onClick={() => router.push(`/orders/${o.id}/routes/${r.id}`)}>
                  <td className="ck" onClick={(e) => e.stopPropagation()}>{x.cut || !can.daily ? null : <input type="checkbox" checked={sel.has(key(r.id))} onChange={(e) => setK([key(r.id)], e.target.checked)} />}</td>
                  <td>
                    <div className="rn1" title={r.code + " " + r.descr}><b className="code">{r.code || "–"}</b> <span className="muted small"><MapA url={g2?.map_url}>{r.descr}</MapA></span></div>
                    {hasPo(o) && r.in_po === false ? <> <Chip c="r nd">ไม่อยู่ในใบสั่งจ้าง</Chip></> : null}
                  </td>
                  <td><div className="kmb"><Bar p={x.L ? pct(x.km, x.L) : x.cut ? 100 : 0} /><span className="num small">{fmtKm(x.km)}{x.L ? "/" + fmtKm(x.L) : ""}</span></div></td>
                  <td className="small">{dateRange(x.first, x.last)}</td>
                  <td className="num small">{x.b || x.a ? `${x.b} / ${x.a}` : "–"}</td>
                  <td><Chip c={c}>{st}</Chip></td>
                  <td className="wact" onClick={(e) => e.stopPropagation()}>
                    {x.cut ? <span className="small muted">{x.finDate ? "จบ " + dShort(x.finDate) : "ตัดครบแล้ว"}</span>
                      : can.daily ? <button className="btn sm" type="button" title="เปิดบันทึกรายวันวันนี้พร้อมสายนี้" onClick={() => toDaily([r.id], today())}>+ ลงงานวันนี้</button> : null}
                  </td>
                </tr>
              );
            }) : <tr><td colSpan={7} className="muted small" style={{ padding: "14px 18px" }}>ไม่มีสายในตัวกรองนี้</td></tr>}
          </tbody>
        </table></div>
        <div className="cf">
          <span>{val ? <>มูลค่าตามใบสั่งจ้าง <b className="num">{fmt0(val)}</b> บาท</> : hasPo(o) ? `ใบสั่งจ้าง ${o.po_no}${o.po_date ? " ลงวันที่ " + dS(o.po_date) : ""}` : "ยอดเงินขึ้นเมื่อได้ใบสั่งจ้าง"}</span>
          {g.pics ? <PackButton className="btn sm gh" orderIds={[o.id]} mode="photos" label="PDF รายงานภาพถ่ายทั้งหมวด" filename={`รายงานภาพถ่าย-${o.hmd || ""}-${rkName(k)}`} /> : null}
        </div>
      </div>
    );
  };

  return (
    <div className="ax"><div className="pg">
      <Top
        crumb={<>งาน › {A.short_name || A.name} › <b>{rkName(k)}</b></>}
        title={rkName(k)}
        sub={`${A.name}${start ? " · เริ่ม " + dS(start) : ""} · ${T.n} สาย ${xs.length} หมวด`}
        acts={<>
          {agPick}
          <RoundTabs W={W} wi={wi} k={k} onGo={(x) => goK(x)} onNew={can.orders ? () => setDlg({ edit: false }) : undefined} />
          {can.orders ? <><button className="btn" type="button" onClick={() => setDlg({ edit: true })}>แก้สายในงวด</button><button className="btn pr" type="button" onClick={() => setDlg({ edit: false })}>+ สร้างงวดใหม่</button></> : null}
        </>}
      />
      <div className="body">
        <div className="stats">
          <Stat l="สายที่ตัดครบ" v={T.cut} u={"/ " + T.n + " สาย"} p={pct(T.cut, T.n)} />
          <Stat l="ระยะที่ตัด" v={fmtKm(T.km)} u={T.L ? "/ " + fmtKm(T.L) + " กม." : "กม."} s={T.L ? undefined : can.roads ? <Link className="lnk" href={`/roads?ag=${k.ag}`}>ใส่ความยาวสายที่ทะเบียนสายทาง</Link> : "รอ CEO ใส่ความยาวสาย"} p={pct(T.km, T.L)} />
          <Stat l="รูปครบ" v={T.pics} u={"/ " + T.n + " สาย"} p={pct(T.pics, T.n)} />
          <Stat l="ใบสั่งจ้าง" v={poN} u={"/ " + xs.length + " หมวด"} s={poN < xs.length ? "ยอดเงินขึ้นเมื่อได้ใบสั่งจ้าง" : "ได้ครบทุกหมวดแล้ว"} />
        </div>
        <div className="htiles" style={{ marginTop: 14 }}>
          {slots.map(({ h, o }) => {
            const g = o ? gs.get(o.id)! : null;
            return (
              <button key={h + (o?.id ?? "")} type="button" className={"htile" + (h === hv ? " on" : "") + (o ? "" : " empty")} onClick={() => setHSel(h)}>
                <div className="hn"><b>{hmdName(h)}</b>{o ? (hasPo(o) ? <Chip c="g">{o.po_no}</Chip> : <Chip c="w">รอใบสั่งจ้าง</Chip>) : <Chip c="nd">ยังไม่มีในงวด</Chip>}</div>
                {g ? <><div className="hs"><span>ตัดครบ <b>{g.cut}</b>/{g.n}</span><span>รูปครบ <b>{g.pics}</b>/{g.n}</span></div><Bar p={pct(g.cut, g.n)} /></>
                  : <div className="hs muted">{can.orders ? "กดเพื่อเลือกสายหรืออัปโหลดใบสั่งจ้าง" : "ยังไม่มีสายในงวดนี้"}</div>}
              </button>
            );
          })}
        </div>
        {cur.o ? (
          <div className="wfil">
            <div className="tabs">
              {WFS.map(([f, t]) => <button key={f} type="button" className={wf === f ? "on" : ""} onClick={() => setWf(f)}>{t} <span className="muted small">{cur.o!.routes.filter((r) => wfOk(rInfo(W, wi, r).s, f)).length}</span></button>)}
            </div>
            <span className="small muted">สายจะ &quot;จบ&quot; เมื่อติ๊ก จบสายนี้ ในบันทึกรายวัน หรือ กม. สะสมครบความยาวสาย</span>
          </div>
        ) : null}
        {cur.o ? card(cur.o) : (
          <div className="card slotc"><div className="ch">
            <h3>{hmdName(cur.h)} <span className="m">ยังไม่มีในงวดนี้</span></h3>
            <div className="acts">
              <Chip c="nd">ยังไม่ได้ใบสั่งจ้าง</Chip>
              {can.orders ? <>
                <button className="btn sm" type="button" onClick={() => setDlg({ edit: true, h: cur.h })}>เลือกสายจากทะเบียน</button>
                <Link className="btn sm pr" href={`/orders/new?${rkQuery(k)}&hmd=${encodeURIComponent(cur.h)}`}>+ อัปโหลดใบสั่งจ้าง</Link>
              </> : null}
            </div>
          </div></div>
        )}
      </div>
      {dialog}
    </div></div>
  );
}

/** แท็บงวดใกล้เคียง + ปุ่ม "ทุกงวด" เปิดตารางงวดทั้งปีงบ */
export function RoundTabs({ W, wi, k, onGo, onNew }: { W: World; wi: ReturnType<typeof workIndex>; k: RoundKey; onGo: (x: RoundKey) => void; onNew?: () => void }) {
  const ks = roundKeys(W, k.ag), i = ks.findIndex((x) => rkSame(x, k));
  const near = (i < 0 ? ks.slice(0, 3) : ks.slice(Math.max(0, i - 1), i + 2)).reverse();
  const multiYr = new Set(near.map((x) => x.fy)).size > 1 || near.some((x) => x.fy !== k.fy);
  const [open, setOpen] = useState(false);
  const [yr, setYr] = useState(k.fy);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", off);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", off); };
  }, [open]);
  const yrs = [...new Set(ks.map((x) => x.fy))].sort((a, b) => a - b);
  const y = yrs.includes(yr) ? yr : yrs[yrs.length - 1], yi = yrs.indexOf(y);
  const my = ks.filter((x) => x.fy === y).sort((a, b) => a.no - b.no).map((x) => ({ x, s: rkStat(W, wi, x) }));
  const poN = my.reduce((t, o) => t + o.s.po, 0), poT = my.reduce((t, o) => t + o.s.tot, 0);
  return (
    <div style={{ position: "relative" }} ref={box}>
      <div className="tabs rtabs">
        {near.map((x) => { const s = rkStat(W, wi, x); return (
          <button key={`${x.fy}~${x.no}`} type="button" className={rkSame(x, k) ? "on" : ""} title={`${rkName(x)} · ${s.txt}`} onClick={() => onGo(x)}>
            <span className="sd" style={{ background: RK_COL[s.st] }} />งวด {x.no}{multiYr ? "/" + x.fy : ""}
          </button>
        ); })}
        <button type="button" className="more" onClick={() => { setYr(k.fy); setOpen((v) => !v); }}>ทุกงวด ▾</button>
      </div>
      {open ? (
        <div className="rpop" style={{ right: 0 }}>
          <div className="yhd">
            <button type="button" disabled={yi <= 0} onClick={() => setYr(yrs[yi - 1])}>‹</button>
            <b>ปีงบประมาณ {y}</b>
            <button type="button" disabled={yi >= yrs.length - 1} onClick={() => setYr(yrs[yi + 1])}>›</button>
          </div>
          <div className="gg2">
            {my.map(({ x, s }) => (
              <button key={x.no} type="button" className={"gt2" + (rkSame(x, k) ? " on" : "")} onClick={() => { setOpen(false); onGo(x); }}>
                <div className="n">งวด {x.no}<small>{s.po}/{s.tot} ใบ</small></div>
                <div className="pb"><i style={{ width: `${s.st === "miss" ? Math.max(s.pc, 6) : s.pc}%`, background: RK_COL[s.st] }} /></div>
                <div className="s">{s.txt}</div>
              </button>
            ))}
            {onNew ? <button type="button" className="gt2 no" onClick={() => { setOpen(false); onNew(); }}>+ งวดใหม่</button> : null}
          </div>
          <div className="ft"><span>ใบสั่งจ้างปีนี้ได้แล้ว {poN}/{poT} ใบ</span></div>
        </div>
      ) : null}
    </div>
  );
}
