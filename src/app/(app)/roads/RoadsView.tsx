"use client";

// ทะเบียนสายทาง: ต้นไม้ แขวง › หมวด | ตารางสาย | รายละเอียด (แบบเดียวกับระบบบน claude.ai)
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Chip, MapA, Top, toast } from "@/components/ui";
import {
  type Agency, type Order, type Road, type Route, type World,
  R_ST, cNorm, dShort, dateRange, fmt0, fmtKm, hasPo, hmdName, kmText, mapSearch, num, rInfo, regFind, rkName, rkOf, workIndex,
} from "@/lib/model";
import { addHmd, deleteRoad, updateRoad } from "./actions";
import { RoadGrid } from "./RoadGrid";
import { RoadImport } from "./RoadImport";

export type RoadCan = { edit: boolean; len: boolean; prices: boolean };
type Use = { o: Order; r: Route };

/** หมวดของแขวง + หมวดที่สายในทะเบียนใช้แต่ยังไม่อยู่ในแขวง */
export const hmdsOf = (W: World, A: Agency) => {
  const hs = [...A.hmds];
  for (const g of W.roads) if (g.agency_id === A.id && !hs.includes(g.hmd || "")) hs.push(g.hmd || "");
  return hs;
};

export function RoadsView({ W, can, canRead, init }: { W: World; can: RoadCan; canRead: boolean; init: { ag?: string; h?: string; sel?: string } }) {
  const [agSt, setAg] = useState(init.ag ?? "");
  const [hSt, setH] = useState<string | null>(init.h ?? null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(init.sel ?? null);
  const [dlg, setDlg] = useState<null | "add" | "edit" | "imp">(null);
  const [newH, setNewH] = useState("");

  const wi = useMemo(() => workIndex(W.days), [W.days]);
  // สาย → งวดที่เคยอยู่ (ใหม่สุดก่อน)
  const uses = useMemo(() => {
    const m = new Map<string, Use[]>();
    for (const o of W.orders)
      for (const r of o.routes) {
        const id = r.road_id || regFind(W, o.agency_id, r.code)?.id;
        if (!id) continue;
        const l = m.get(id) ?? [];
        l.push({ o, r });
        m.set(id, l);
      }
    for (const l of m.values()) l.sort((a, b) => b.o.fy - a.o.fy || b.o.round_no - a.o.round_no);
    return m;
  }, [W]);

  if (!W.agencies.length)
    return (
      <div className="ax"><div className="pg">
        <Top crumb={<>ข้อมูลหลัก › <b>สายทาง</b></>} title="ทะเบียนสายทาง" />
        <div className="body"><div className="card"><div className="emp big"><h3>ยังไม่มีแขวง</h3><p>เพิ่มแขวงและหมวดที่หน้าตั้งค่าก่อน แล้วจึงบันทึกสายทาง</p>
          {can.edit ? <Link className="btn pr" href="/settings/agencies">ไปหน้าแขวงและหมวด</Link> : null}</div></div></div>
      </div></div>
    );

  const A = W.agencies.find((a) => a.id === agSt) ?? W.agencies[0];
  const hs = hmdsOf(W, A);
  const h = hSt !== null && hs.includes(hSt) ? hSt : hs[0] ?? "";
  const qn = cNorm(q);
  const regs = W.roads.filter((g) => g.agency_id === A.id);
  const list = (qn ? W.roads.filter((g) => cNorm(g.code).includes(qn) || cNorm(g.name).includes(qn) || cNorm(g.amp).includes(qn)) : regs.filter((g) => (g.hmd || "") === h))
    .sort((a, b) => a.code.localeCompare(b.code, "th"));
  const G = sel ? W.roads.find((g) => g.id === sel) ?? null : null;
  const GA = G ? W.agencies.find((a) => a.id === G.agency_id) ?? A : A;

  const lastCut = (g: Road) => {
    for (const { o, r } of uses.get(g.id) ?? []) {
      const x = rInfo(W, wi, r);
      if (x.last || x.s !== "todo") return <Chip c={x.cut ? "g" : "b"}>{rkName(rkOf(o))}{x.last ? " · " + dShort(x.last) : ""}</Chip>;
    }
    return <span className="muted small">–</span>;
  };
  const pick = (ag: string, hh: string) => { setAg(ag); setH(hh); setQ(""); setSel(null); };
  const addH = async () => {
    const v = newH.trim();
    if (!v) return;
    const r = await addHmd(A.id, v);
    if (!r.ok) { toast(r.error, true); return; }
    const hv = v.replace(/^หมวด(บำรุงทางหลวงชนบท)?\s*/, "");
    setNewH(""); setH(hv); toast("เพิ่มหมวด" + hv + "แล้ว");
  };

  return (
    <div className="ax"><div className="pg">
      <Top
        crumb={<>ข้อมูลหลัก › <b>สายทาง</b></>}
        title="ทะเบียนสายทาง"
        sub="บันทึกครั้งเดียว ใช้ทุกงวด · เก็บความยาวเป็น กม. ส่วนพื้นที่ ตร.ม. มาจากใบสั่งจ้าง"
        acts={can.edit ? <>
          <button className="btn" type="button" onClick={() => setDlg("imp")}>วางรายการ / รูป ให้ Claude อ่าน</button>
          <button className="btn pr" type="button" onClick={() => setDlg("add")}>+ เพิ่มสายทาง</button>
        </> : null}
      />
      <div className="body"><div className="g3">
        <div className="card tree">
          {W.agencies.map((a) => {
            const rs = W.roads.filter((g) => g.agency_id === a.id);
            return (
              <div key={a.id}>
                <div className="th"><span>{a.short_name || a.name}</span><span className="muted small">{rs.length} สาย</span></div>
                {hmdsOf(W, a).map((hh) => (
                  <button key={hh} type="button" className={"ti" + (a.id === A.id && hh === h && !qn ? " on" : "")} onClick={() => pick(a.id, hh)}>
                    {hmdName(hh)}<span>{rs.filter((g) => (g.hmd || "") === hh).length}</span>
                  </button>
                ))}
                {a.id === A.id && can.edit ? (
                  <div className="tadd"><input className="in" placeholder="+ เพิ่มหมวด เช่น พนัสนิคม" value={newH} onChange={(e) => setNewH(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addH(); }} /></div>
                ) : null}
              </div>
            );
          })}
          {can.edit ? <div style={{ padding: "10px 12px 4px" }}><Link className="btn sm" href="/settings/agencies" style={{ width: "100%" }}>+ เพิ่มแขวง</Link></div> : null}
        </div>

        <div className="card">
          <div className="ch">
            <h3>{qn ? "ผลการค้นหา" : hmdName(h)} <span className="m">{list.length} สาย{!qn ? " · รวม " + fmtKm(list.reduce((s, g) => s + num(g.len_km), 0)) + " กม." : ""}</span></h3>
            <input className="in" placeholder="ค้นหาเลขสาย / ชื่อสาย / อำเภอ" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
          </div>
          {list.length ? (
            <div className="tscroll"><table className="tb">
              <thead><tr><th>เลขสาย</th><th>ชื่อสาย</th><th>อำเภอ</th><th className="n">ความยาว</th>{qn ? <th>หมวด</th> : null}<th>ตัดล่าสุด</th></tr></thead>
              <tbody>
                {list.map((g) => (
                  <tr key={g.id} className={"click" + (g.id === sel ? " sel" : "")} onClick={() => setSel(g.id)}>
                    <td><b className="code">{g.code}</b></td>
                    <td><MapA url={g.map_url}>{g.name}</MapA></td>
                    <td className="muted">{g.amp}</td>
                    <td className="n num">{g.len_km ? fmtKm(g.len_km) + " กม." : "–"}</td>
                    {qn ? <td className="muted small">{hmdName(g.hmd)}{g.agency_id !== A.id ? " · " + (W.agencies.find((a) => a.id === g.agency_id)?.short_name ?? "") : ""}</td> : null}
                    <td>{lastCut(g)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : (
            <div className="emp">{qn ? "ไม่พบสายที่ค้นหา" : <>ยังไม่มีสายทางในหมวดนี้{can.edit ? <div style={{ marginTop: 12 }}><button className="btn pr" type="button" onClick={() => setDlg("add")}>+ เพิ่มสายทาง</button></div> : null}</>}</div>
          )}
          {qn || !list.length || !(can.edit || can.len) ? null : (
            <div className="cf"><span className="small muted">คลิกสายเพื่อแก้ทีละเส้น หรือแก้หลายเส้นพร้อมกัน</span><button className="btn sm" type="button" onClick={() => setDlg("edit")}>แก้หลายเส้น (ใส่ กม.)</button></div>
          )}
        </div>

        <div className="card">
          {G ? (
            <RoadDetail key={G.id} W={W} G={G} A={GA} can={can} uses={uses.get(G.id) ?? []} wi={wi}
              onHmd={(hh) => { setAg(G.agency_id); setH(hh); }} onDeleted={() => setSel(null)} />
          ) : (
            <div className="emp">เลือกสายทางจากตาราง<br />เพื่อดูรายละเอียดและประวัติ</div>
          )}
        </div>
      </div></div>

      {dlg === "add" || dlg === "edit" ? (
        <RoadGrid W={W} A={A} hmd={h} mode={dlg} can={can} onClose={() => setDlg(null)} onSaved={(hh) => { setDlg(null); setH(hh); setQ(""); }} />
      ) : null}
      {dlg === "imp" ? (
        <RoadImport W={W} A={A} hmd={h} canRead={canRead} onClose={() => setDlg(null)} onSaved={(hh) => { setDlg(null); setH(hh); setQ(""); }} />
      ) : null}
    </div></div>
  );
}

type F = { code: string; name: string; amp: string; len: string; hmd: string; map: string; note: string };

function RoadDetail({ W, G, A, can, uses, wi, onHmd, onDeleted }: {
  W: World; G: Road; A: Agency; can: RoadCan; uses: Use[]; wi: ReturnType<typeof workIndex>; onHmd: (h: string) => void; onDeleted: () => void;
}) {
  const [f, setF] = useState<F>({ code: G.code, name: G.name, amp: G.amp, len: G.len_km == null ? "" : String(G.len_km), hmd: G.hmd || "", map: G.map_url ?? "", note: G.note });
  const [st, setSt] = useState("");
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ro = !can.edit;

  const save = async (v: F) => {
    if (!v.code.trim()) { setSt("เลขสายว่างไม่ได้"); return; }
    if (v.map.trim() && !/^https?:\/\//i.test(v.map.trim())) { setSt("ลิงก์ต้องขึ้นต้นด้วย https://"); return; }
    const t = kmText(v.len);
    if (t && !(Number.isFinite(Number(t)) && Number(t) >= 0)) { setSt("กม. ต้องเป็นตัวเลข"); return; }
    if (W.roads.some((x) => x.id !== G.id && x.agency_id === G.agency_id && cNorm(x.code) === cNorm(v.code))) { setSt("เลขสายซ้ำกับที่มีอยู่"); return; }
    const r = await updateRoad(G.id, { agency_id: G.agency_id, hmd: v.hmd, code: v.code, name: v.name, amp: v.amp, len_km: t === "" ? null : Number(t), map_url: v.map, note: v.note });
    if (!r.ok) { setSt(""); toast(r.error, true); return; }
    if (v.hmd !== (G.hmd || "")) onHmd(v.hmd);
    setSt("✓ บันทึกแล้ว");
  };
  const set = (k: keyof F, val: string, now = false) => {
    const n = { ...f, [k]: val };
    setF(n); setSt("กำลังบันทึก…"); setArmed(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(n), now ? 0 : 600);
  };
  const del = async () => {
    if (uses.length) { toast(`${G.code} อยู่ใน ${uses.length} งวดแล้ว ลบไม่ได้ (เอาออกจากงวดก่อน)`, true); return; }
    if (!armed) { setArmed(true); return; }
    const r = await deleteRoad(G.id);
    if (!r.ok) { toast(r.error, true); return; }
    toast("ลบ " + G.code + " แล้ว"); onDeleted();
  };
  const mapU = /^https?:\/\//i.test(f.map.trim()) ? f.map.trim() : "";
  const inp = (k: keyof F, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, dis = ro) => (
    <input className="in" value={f[k]} disabled={dis} onChange={(e) => set(k, e.target.value)} {...extra} />
  );

  return (
    <>
      <div className="ch"><h3>{G.code}</h3><span className="small" style={{ color: /^✓|กำลัง/.test(st) ? "var(--acc)" : "var(--bad)" }}>{st}</span></div>
      <div className="cb gform">
        <label className="f">เลขสาย{inp("code")}</label>
        <label className="f">ชื่อสาย{inp("name")}</label>
        <div className="grid2">
          <label className="f">อำเภอ{inp("amp")}</label>
          <label className="f">ความยาว (กม.){inp("len", { style: { textAlign: "right" }, inputMode: "decimal" }, !(can.edit || can.len))}</label>
        </div>
        <label className="f">หมวด
          <select className="in" value={f.hmd} disabled={ro} onChange={(e) => set("hmd", e.target.value, true)}>
            {[...new Set([...A.hmds, G.hmd || ""])].map((hh) => <option key={hh} value={hh}>{hmdName(hh)}</option>)}
          </select>
        </label>
        <label className="f">ลิงก์ Google Maps{inp("map", { placeholder: "วางลิงก์ เช่น https://maps.app.goo.gl/…" })}</label>
        <div className="small muted" style={{ marginTop: -6 }}>
          {mapU ? <><a className="maplnk" href={mapU} target="_blank" rel="noopener noreferrer">เปิดแผนที่ ↗</a> · </> : null}
          <a className="maplnk" href={mapSearch(G, A)} target="_blank" rel="noopener noreferrer">ค้นหาใน Google Maps ↗</a>{ro ? null : " แล้วกดแชร์ › คัดลอกลิงก์ มาวางที่ช่องนี้"}
        </div>
        <label className="f">หมายเหตุ{inp("note")}</label>
        <div className="hh">ประวัติ</div>
        {uses.length ? uses.map(({ o, r }) => {
          const x = rInfo(W, wi, r), pics = x.b + x.a;
          return (
            <Link key={r.id} className="hr click" href={`/orders/${o.id}/routes/${r.id}`}>
              <span>{rkName(rkOf(o))}</span>
              <span className="muted small">{x.first ? dateRange(x.first, x.last) : R_ST[x.s][0]}{pics ? " · รูป " + pics : ""}{can.prices && hasPo(o) && num(r.area) && r.rate != null ? " · " + fmt0(num(r.area) * num(r.rate)) : ""}</span>
            </Link>
          );
        }) : <div className="muted small">ยังไม่เคยอยู่ในงวดไหน</div>}
        {can.edit ? <div style={{ marginTop: 16 }}><button className="lnk bad" type="button" onClick={del}>{armed ? "กดอีกครั้งเพื่อยืนยันลบ" : "ลบสายนี้ออกจากทะเบียน"}</button></div> : null}
      </div>
    </>
  );
}
