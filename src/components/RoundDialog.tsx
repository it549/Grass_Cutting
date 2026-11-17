"use client";

// สร้างงวดใหม่จากทะเบียนสายทาง / เพิ่มหมวดเข้างวด / แก้สายในงวด (แบบเดียวกับระบบบน claude.ai)
import Link from "next/link";
import { useMemo, useState } from "react";
import { Dialog, toast } from "@/components/ui";
import { type RoundKey, type World, fmtKm, fyOf, hmdName, num, regOf, rkName, rkSame, roundKeys, roundOf } from "@/lib/model";
import { saveRoundPlan } from "@/app/(app)/rounds/actions";

type Mode = "same" | "type" | "pick";
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });

export function RoundDialog({ W, editK, initAg, focusH, onClose, onDone }: {
  W: World; editK?: RoundKey | null; initAg?: string; focusH?: string | null; onClose: () => void; onDone: (k: RoundKey, firstH?: string) => void;
}) {
  const fy0 = fyOf(today());
  const nextNo = (ag: string, fy: number) => W.orders.filter((o) => o.agency_id === ag && o.fy === fy).reduce((m, o) => Math.max(m, o.round_no), 0) + 1;
  const regIdsOf = (k: RoundKey | null) => {
    const s = new Set<string>();
    if (!k) return s;
    for (const o of roundOf(W, k)) for (const r of o.routes) { const g = regOf(W, o, r); if (g) s.add(g.id); }
    return s;
  };
  const prevOf = (ag: string) => roundKeys(W, ag).find((x) => !(editK && rkSame(x, editK))) ?? null;

  const ag0 = editK?.ag ?? (initAg && W.agencies.some((a) => a.id === initAg) ? initAg : W.agencies[0]?.id ?? "");
  const [ag, setAg] = useState(ag0);
  const [noS, setNo] = useState(String(editK?.no ?? nextNo(ag0, fy0)));
  const [fyS, setFy] = useState(String(editK?.fy ?? fy0));
  const [mode, setMode] = useState<Mode>(editK ? "pick" : prevOf(ag0) ? "same" : "pick");
  const [sel, setSel] = useState<Set<string>>(() => (editK ? regIdsOf(editK) : regIdsOf(prevOf(ag0))));
  const [typed, setTyped] = useState("");
  const [miss, setMiss] = useState<string[]>([]);
  const [hv, setHv] = useState<string | null>(focusH ?? null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const A = W.agencies.find((a) => a.id === ag) ?? W.agencies[0];
  const regs = useMemo(() => W.roads.filter((g) => g.agency_id === ag).sort((a, b) => a.code.localeCompare(b.code, "th")), [W.roads, ag]);
  const hmdList = (() => { const hs = [...(A?.hmds ?? [])]; for (const g of regs) if (!hs.includes(g.hmd || "")) hs.push(g.hmd || ""); return hs; })();
  const pk = prevOf(ag);
  const no = Math.trunc(num(noS)), fy = Math.trunc(num(fyS));

  const changeAg = (v: string) => {
    setAg(v); const p = prevOf(v);
    setMode(p ? "same" : "pick"); setSel(regIdsOf(p)); setNo(String(nextNo(v, fy || fy0))); setHv(null); setQ("");
  };
  const changeMode = (m: Mode) => {
    if (m === "same" && !pk) return;
    setMode(m); setQ(""); setHv(null);
    setSel(m === "same" ? regIdsOf(pk) : new Set());
    if (m === "type") applyTyped(typed);
  };
  const applyTyped = (t: string) => {
    setTyped(t); setHv(null);
    const toks = (t.match(/[ก-ฮ]{0,3}\.?\s*\d{3,5}/g) || []).map((x) => x.trim()), ms: string[] = [], s = new Set<string>();
    for (const tk of toks) {
      const dg = tk.replace(/\D/g, ""), al = tk.replace(/[\d\s.]/g, "");
      const m = regs.filter((g) => g.code.replace(/\D/g, "") === dg && (!al || g.code.replace(/[\d\s.]/g, "") === al));
      if (m.length) m.forEach((g) => s.add(g.id)); else ms.push(tk);
    }
    setSel(s); setMiss(ms);
  };
  const toggle = (id: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  // ช่องเลือกสาย
  const hs = hmdList.filter((h) => regs.some((g) => (g.hmd || "") === h));
  const hvE = hv != null && hs.includes(hv) ? hv : hs.find((h) => regs.some((g) => (g.hmd || "") === h && sel.has(g.id))) ?? hs[0] ?? "";
  const cnt = (h: string) => { const gs = regs.filter((g) => (g.hmd || "") === h); return [gs.filter((g) => sel.has(g.id)).length, gs.length]; };
  const ql = q.trim().toLowerCase(), qd = ql.replace(/\D/g, "");
  const hit = (g: (typeof regs)[number]) => !ql || g.code.toLowerCase().includes(ql) || (!!qd && g.code.replace(/\D/g, "").includes(qd)) || g.name.toLowerCase().includes(ql) || g.amp.toLowerCase().includes(ql);

  // สรุป + งวดที่มีอยู่แล้ว
  const gsSel = regs.filter((g) => sel.has(g.id));
  const ex = !editK && no && fy ? roundOf(W, { ag, fy, no }) : [];
  const have = ex.map((o) => o.hmd || ""), selH = [...new Set(gsSel.map((g) => g.hmd || ""))];
  const add = selH.filter((h) => !have.includes(h)), skip = selH.filter((h) => have.includes(h));
  const nm = (a: string[]) => a.map((h) => h || "ไม่ระบุหมวด").join(", ");
  const okText = editK ? "บันทึก" : ex.length ? `เพิ่มเข้า${rkName({ no, fy })}` : `สร้างงวด ${no || "?"}/${fy || "?"}`;

  const save = async () => {
    if (!no || !fy) { toast("ใส่งวดที่และปีงบประมาณ", true); return; }
    if (!gsSel.length && !editK) { toast("เลือกสายอย่างน้อย 1 สาย", true); return; }
    setBusy(true);
    const r = await saveRoundPlan({ ag, fy, no, edit: !!editK, sel: [...sel] });
    setBusy(false);
    if (!r.ok) { toast(r.error, true); return; }
    toast(r.msg, !!r.warn);
    onDone({ ag, fy, no }, r.firstH);
  };

  const opts: [Mode, string, string, boolean][] = [
    ["same", pk ? `เหมือนงวดก่อน (${rkName(pk)})` : "เหมือนงวดก่อน", pk ? `${regIdsOf(pk).size} สาย · ติ๊กออกได้ถ้างวดนี้ไม่ตัดบางสาย` : "ยังไม่มีงวดก่อนหน้าของแขวงนี้", !pk],
    ["type", "พิมพ์เลขสายที่ลูกค้าแจ้ง", "เช่น 3083, 4036, 1015 ระบบหาในทะเบียนให้", false],
    ["pick", "เลือกเองจากทะเบียน", "ติ๊กทีละสาย แยกตามหมวด", false],
  ];
  const item = (g: (typeof regs)[number], tag: boolean) => (
    <label key={g.id} className="pr">
      <input type="checkbox" checked={sel.has(g.id)} onChange={(e) => toggle(g.id, e.target.checked)} />
      <span><b>{g.code}</b>{tag ? <> <span className="chip nd" style={{ fontSize: 11 }}>{g.hmd || "ไม่ระบุ"}</span></> : null}<br />
        <span className="muted small">{g.name}{g.len_km ? " · " + fmtKm(g.len_km) + " กม." : ""}</span></span>
    </label>
  );

  return (
    <Dialog
      title={editK ? "แก้สายใน" + rkName(editK) : "สร้างงวดใหม่"}
      onClose={onClose}
      foot={<>
        <span className="muted small">{gsSel.length} สาย · {fmtKm(gsSel.reduce((s, g) => s + num(g.len_km), 0))} กม.</span>
        <div className="acts"><button className="btn" type="button" onClick={onClose}>ยกเลิก</button><button className="btn pr" type="button" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : okText}</button></div>
      </>}
    >
      <div className="grid3">
        <label className="f">แขวง
          <select className="in" value={ag} disabled={!!editK} onChange={(e) => changeAg(e.target.value)}>
            {W.agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="f">งวดที่<input className="in" value={noS} disabled={!!editK} onChange={(e) => setNo(e.target.value)} /></label>
        <label className="f">ปีงบประมาณ<input className="in" value={fyS} disabled={!!editK} onChange={(e) => { setFy(e.target.value); setNo(String(nextNo(ag, Math.trunc(num(e.target.value))))); }} /></label>
      </div>
      <div className="f" style={{ marginTop: 14 }}>สายที่ตัดในงวดนี้</div>
      {editK ? null : opts.map(([m, t, s, dis]) => (
        <div key={m} className={"opt" + (mode === m ? " on" : "") + (dis ? " dis" : "")} onClick={(e) => { if ((e.target as HTMLElement).closest("textarea")) return; changeMode(m); }}>
          <span className="r" />
          <div><b>{t}</b><div>{s}</div>
            {m === "type" && mode === "type" ? <>
              <textarea className="in" autoFocus value={typed} onChange={(e) => applyTyped(e.target.value)} placeholder="วางหรือพิมพ์เลขสาย คั่นด้วยจุลภาคหรือขึ้นบรรทัดใหม่" style={{ marginTop: 8, minHeight: 60 }} />
              {miss.length ? <div className="small" style={{ color: "var(--warn)" }}>ไม่พบในทะเบียน: {miss.join(", ")} · เพิ่มที่เมนูสายทางก่อน</div> : null}
            </> : null}
          </div>
        </div>
      ))}
      {ex.length ? (
        <div className={add.length ? "okbox" : "warnbox"} style={{ marginTop: 10 }}>
          {rkName({ no, fy })} มีหมวด{nm(have)}อยู่แล้ว · {add.length ? `จะเพิ่มหมวด${nm(add)} เข้างวดนี้` : "เลือกสายของหมวดที่ยังไม่มีในงวด"}
          {skip.length ? ` · สายของหมวด${nm(skip)}จะไม่ถูกแตะ (แก้ได้ที่ปุ่ม แก้สายในงวด)` : ""}
        </div>
      ) : null}
      <div className="pick">
        {!regs.length ? (
          <div className="emp">แขวงนี้ยังไม่มีสายทางในทะเบียน <Link className="lnk" href={`/roads?ag=${ag}`}>ไปเพิ่มที่ทะเบียนสายทาง →</Link></div>
        ) : <>
          <div className="pktop">
            <div className="pktabs">
              {hs.map((h) => { const [n, t] = cnt(h); return (
                <button key={h} type="button" className={"pkt" + (!ql && h === hvE ? " on" : "") + (n ? " has" : "")} onClick={() => { setHv(h); setQ(""); }}>{h || "ไม่ระบุ"} <span>{n}/{t}</span></button>
              ); })}
            </div>
            <input className="in" placeholder="ค้นหาเลขสาย / ชื่อสาย / อำเภอ" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setQ(""); } }} />
          </div>
          {ql ? (() => { const gs = regs.filter(hit); return <>
            <div className="ph"><span>ผลค้นหา &quot;{q}&quot; ทุกหมวด</span><span className="muted small">{gs.length} สาย</span></div>
            {gs.length ? <div className="pkg">{gs.map((g) => item(g, true))}</div> : <div className="emp">ไม่พบสายที่ตรงกับคำค้น</div>}
          </>; })() : (() => { const gs = regs.filter((g) => (g.hmd || "") === hvE), [n, t] = cnt(hvE); return <>
            <div className="ph"><span>{hmdName(hvE)} · เลือก {n}/{t} สาย</span>
              <span className="acts">
                <button className="lnk small" type="button" onClick={() => setSel((s) => { const x = new Set(s); gs.forEach((g) => x.add(g.id)); return x; })}>เลือกทั้งหมวด</button>
                <button className="lnk small" type="button" onClick={() => setSel((s) => { const x = new Set(s); gs.forEach((g) => x.delete(g.id)); return x; })}>ล้างหมวดนี้</button>
              </span>
            </div>
            <div className="pkg">{gs.map((g) => item(g, false))}</div>
          </>; })()}
        </>}
      </div>
    </Dialog>
  );
}
