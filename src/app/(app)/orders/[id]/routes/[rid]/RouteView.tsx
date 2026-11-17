"use client";

// หน้าสายทาง + รูปรายงานตาม กม. (แถบเส้นสาย + การ์ดจุด + ถาดรูป) แบบเดียวกับระบบบน claude.ai รุ่น v34
// กติกา: ระบบไม่วางรูปเอง คนวาง · ปุ่ม "เสนอเติมตามลำดับเวลาถ่าย" แค่เสนอ (กรอบส้ม) ยังไม่บันทึกจนกด ยืนยัน
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Chip, Dialog, Stat, Top, toast } from "@/components/ui";
import { PackButton } from "@/components/PackButton";
import { PdfButton } from "@/components/print/PdfButton";
import { addPhotos, deletePhoto, placePhotos, setPhotoLR, setRouteLength, type NewPhoto } from "@/app/(app)/orders/photo-actions";
import { uploadFile } from "@/lib/upload-client";
import { exifDate, shrink } from "@/lib/image";
import { fmt, lineAmt } from "@/lib/calc";
import { fileSafe } from "@/lib/print/fmt";
import { pfPages } from "@/lib/print/pages";
import { type PfKind, type RInfo, type RoundKey, PF, R_ST, WD, dS, dShort, fmt0, fmtKm, fmtN, kmTxt, pct, pfCount, rkName, rkQuery, stations, wdOf } from "@/lib/model";

type Photo = { id: string; kind: string; slot: string | null; url: string; date: string; time: string; name: string; sig: string };
type Props = {
  companyId: string;
  o: { id: string; round_no: number; fy: number; hmd: string; po_no: string | null; k: RoundKey };
  r: { id: string; code: string; descr: string; area: number; rate: number | null; in_po: boolean };
  x: RInfo;
  A: { id: string; name: string; short: string; lr: boolean };
  G: { id: string; amp: string; map: string | null } | null;
  photos: Photo[];
  days: { date: string; km: number | null; fin: boolean; crew: number }[];
  nav: { prev: { id: string; code: string } | null; next: { id: string; code: string } | null; pos: number; n: number };
  can: { work: boolean; orders: boolean; prices: boolean; daily: boolean };
};
const LAB: Record<string, string> = { b: "ก่อนดำเนินการ", a: "หลังดำเนินการ", L: "ด้านซ้ายทาง", R: "ด้านขวาทาง" };
const ts = (p: Photo) => (p.date || "") + " " + (p.time || "");
const shot = (p: Photo, none = "ไม่มีเวลาถ่าย") => (p.date ? dShort(p.date) + (p.time ? " " + p.time : "") : none);
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });

export function RouteView({ companyId, o, r, x, A, G, photos, days, nav, can }: Props) {
  const router = useRouter();
  const [pf, setPf] = useState<PfKind>("ba");
  const [filt, setFilt] = useState<"all" | "miss" | "done">("all");
  const [sel, setSel] = useState<string | null>(null);
  const [prop, setProp] = useState<{ f: PfKind; map: Record<string, string> } | null>(null);
  const [view, setView] = useState<{ k: string; id: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [lr, setLr] = useState(A.lr);
  const [pending, start] = useTransition();
  const pick = useRef<HTMLInputElement>(null);
  const pickTo = useRef<string | null>(null);
  const wk = can.work && !busy && !pending;

  const byId = new Map(photos.map((p) => [p.id, p]));
  const sl: Record<string, string> = {};
  for (const p of photos) if (p.slot) sl[p.slot] = p.id;
  const tray = photos.filter((p) => !p.slot).sort((a, b) => ts(a).localeCompare(ts(b)));
  const selId = sel && tray.some((p) => p.id === sel) ? sel : null;
  const F = PF[pf], ps = stations(x.L, F.step), last = ps[ps.length - 1] ?? 0;
  const pm = prop && prop.f === pf ? prop.map : {};

  // ---------- บันทึก ----------
  const act = (fn: () => Promise<{ error?: string }>, ok?: string) =>
    start(async () => {
      const res = await fn();
      if (res?.error) toast(res.error, true); else if (ok) toast(ok);
      router.refresh();
    });
  async function upload(files: File[], slot?: string) {
    files = files.filter((f) => /^image\//.test(f.type));
    if (!files.length) { toast("เลือกไฟล์รูป (JPG/PNG) เท่านั้น", true); return; }
    const have = new Set(photos.map((p) => p.sig).filter(Boolean)), list: NewPhoto[] = [];
    let dup = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setBusy(files.length > 1 ? `กำลังเพิ่มรูป ${i + 1}/${files.length}…` : "กำลังเพิ่มรูป…");
      try {
        const ex = await exifDate(f), sig = `${f.name}|${f.size}|${ex?.date ?? ""}${ex?.time ?? ""}`;
        if (have.has(sig)) { dup++; continue; }
        have.add(sig);
        const s = await shrink(f), path = `${companyId}/photos/${o.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await uploadFile(path, s.blob);
        if (error) throw new Error(error);
        list.push({ path, w: s.w, h: s.h, taken_date: ex?.date ?? "", taken_time: ex?.time ?? "", name: f.name, sig });
      } catch (e) {
        toast(`${f.name}: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    }
    setBusy("");
    if (!list.length) { if (dup) toast(`รูปทั้งหมดมีอยู่แล้ว (ซ้ำ ${dup} รูป)`, true); return; }
    list.sort((a, b) => (a.taken_date + a.taken_time).localeCompare(b.taken_date + b.taken_time));
    act(() => addPhotos(o.id, r.id, list, slot), slot ? "วางรูปแล้ว" : `เพิ่ม ${list.length} รูปเข้าถาดแล้ว${dup ? ` · ข้ามรูปซ้ำ ${dup} รูป` : ""}`);
  }
  const choose = (slot: string | null) => { pickTo.current = slot; if (pick.current) { pick.current.multiple = !slot; pick.current.click(); } };
  /** วางรูปลงช่อง: ถ้ารูปมาจากช่องอื่น สลับกับรูปเดิมของช่องปลายทาง */
  const place = (k: string, id: string) => {
    const from = Object.keys(sl).find((s) => sl[s] === id), old = sl[k];
    if (from === k) return;
    const map: Record<string, string | null> = { [k]: id };
    if (from) map[from] = old ?? null;
    act(() => placePhotos(r.id, map));
  };
  const unplace = (id: string) => { const from = Object.keys(sl).find((s) => sl[s] === id); if (from) act(() => placePhotos(r.id, { [from]: null }), "ย้ายกลับถาดแล้ว"); };
  const clickEmpty = (k: string) => {
    if (!wk) return;
    if (selId) {
      const cur = byId.get(selId)!, rest = tray.filter((p) => p.id !== selId);
      const nx = rest.find((p) => ts(p) >= ts(cur)) ?? rest[0];
      setSel(nx ? nx.id : null);
      place(k, selId);
    } else choose(k);
  };
  const fill = (c: string) => {
    const empt = ps.filter((m) => !sl[c + "|" + m]), map: Record<string, string> = {};
    // เริ่มเติมจากช่องว่างหลังรูปสุดท้ายที่วางไว้แล้ว เพื่อไม่ข้ามไปเติมรูที่อยู่ก่อนหน้า
    const lastFilled = ps.filter((m) => sl[c + "|" + m]).pop();
    const from = lastFilled == null ? empt : empt.filter((m) => m > lastFilled);
    from.forEach((m, i) => { if (tray[i]) map[c + "|" + m] = tray[i].id; });
    if (!Object.keys(map).length) { toast("ไม่มีช่องว่างต่อจากรูปสุดท้ายในช่องนี้ ลากรูปวางเองได้", true); return; }
    setProp({ f: pf, map }); setFilt("all");
  };
  const drop = (e: React.DragEvent, k: string | null) => {
    e.preventDefault(); setOver(null);
    if (!wk) return;
    const id = e.dataTransfer.getData("text/rp-pid");
    if (id) { if (k) place(k, id); else unplace(id); return; }
    const fs = [...e.dataTransfer.files];
    if (fs.length) upload(k ? [fs[0]] : fs, k ?? undefined);
  };
  const dragOver = (k: string) => (e: React.DragEvent) => { if (!wk) return; e.preventDefault(); if (over !== k) setOver(k); };

  // ---------- คำเตือน: เวลาถ่ายย้อนลำดับ / รูปหลังตัดก่อนวันเริ่มตัด / รูปก่อนตัดหลังวันตัดเสร็จ ----------
  const warn: Record<string, string> = {};
  for (const [c] of F.cols) {
    let prev: { p: Photo; m: number } | null = null;
    for (const m of ps) {
      const p = byId.get(sl[c + "|" + m]);
      if (!p) continue;
      const msg: string[] = [];
      if (prev && p.date && prev.p.date && ts(p) < ts(prev.p)) msg.push(`ถ่ายก่อนรูปจุด ${kmTxt(prev.m)}`);
      if (c === "a" && p.date && x.first && p.date < x.first) msg.push("ถ่ายก่อนวันเริ่มตัด");
      if (c === "b" && p.date && x.finDate && p.date > x.finDate) msg.push("ถ่ายหลังวันตัดเสร็จ");
      if (msg.length) warn[c + "|" + m] = msg.join(" · ");
      if (p.date) prev = { p, m };
    }
  }
  const stOf = (m: number) => { const n = F.cols.filter(([c]) => byId.get(sl[c + "|" + m]) || pm[c + "|" + m]).length; return n === 2 ? "d" : n ? "h" : ""; };
  const cnt = { all: ps.length, miss: ps.filter((m) => stOf(m) !== "d").length, done: ps.filter((m) => stOf(m) === "d").length };
  const vis = ps.filter((m) => filt === "all" || (filt === "miss" ? stOf(m) !== "d" : stOf(m) === "d"));
  const cntOf = (f: PfKind) => pfCount(Object.keys(sl), x.L, f);
  const c0 = cntOf(pf), nW = Object.keys(warn).length, pn = Object.keys(pm).length;
  const goTick = (m: number) => {
    if (!vis.includes(m)) setFilt("all");
    setTimeout(() => { document.getElementById("rpm-" + m)?.scrollIntoView({ block: "center", behavior: "smooth" }); setFlash(m); setTimeout(() => setFlash(null), 1400); }, 30);
  };
  const slotUrl = Object.fromEntries(Object.entries(sl).map(([k, id]) => [k, byId.get(id)?.url ?? ""]).filter(([, u]) => u));

  // ---------- ส่วนต่าง ๆ ----------
  const [stT, stC] = R_ST[x.s];
  const overKm = x.L > 0 && x.km > x.L + 1e-9;
  const slot = (c: string, lab: string, m: number) => {
    const k = c + "|" + m, pid = pm[k] || sl[k], p = pid ? byId.get(pid) : undefined, w = warn[k];
    if (!p) return (
      <div className="rp-sl" key={k}>
        <button type="button" className={"rp-em" + (selId ? " ready" : "") + (over === k ? " over" : "")} data-sk={k} disabled={!can.work}
          title={selId ? "วางรูปที่เลือกไว้" : "เลือกไฟล์รูปใส่ช่องนี้"} onClick={() => clickEmpty(k)}
          onDragOver={dragOver(k)} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, k)}>+</button>
        <span>{lab}</span>
      </div>
    );
    return (
      <div className="rp-sl" key={k}>
        <div className={"rp-im" + (pm[k] ? " prop" : "") + (w ? " warn" : "") + (over === k ? " over" : "")} data-sk={k} data-pid={p.id}
          draggable={can.work && !pm[k]} style={{ backgroundImage: `url('${p.url}')` }}
          onDragStart={(e) => e.dataTransfer.setData("text/rp-pid", p.id)}
          onDragOver={dragOver(k)} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, k)}
          onClick={() => { if (!pm[k]) setView({ k, id: p.id }); }}>
          <i>{shot(p)}</i>
        </div>
        <span>{lab}</span>
      </div>
    );
  };
  const tabs = (Object.keys(PF) as PfKind[]).map((f) => {
    const c = cntOf(f);
    return <button key={f} type="button" className={pf === f ? "on" : ""} onClick={() => { setPf(f); setProp(null); }}>{PF[f].name} · {PF[f].every} <small>{x.L ? c.n + "/" + c.N : ""}</small></button>;
  });
  const lrNote = (
    <label className="rp-need">
      <input type="checkbox" checked={lr} disabled={!can.orders || pending} onChange={(e) => { const on = e.target.checked; setLr(on); act(() => setPhotoLR(A.id, on), on ? "สายในแขวงนี้ต้องมีรูปสำรวจ 250 ม. ครบด้วย" : "แบบสำรวจ 250 ม. ไม่บังคับแล้ว"); }} />
      {" "}{A.short} ต้องใช้แบบสำรวจ 250 ม. ด้วย
    </label>
  );
  const trayBox = (
    <div className="rp-box">
      <div className="h"><b>ถาดรูป</b><span className="muted small">รอวาง {tray.length} รูป</span></div>
      {can.work ? (
        <div className={"rp-dz" + (over === "dz" ? " over" : "")} onDragOver={dragOver("dz")} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, null)}>
          <b>⬆ ลากรูปมาวาง</b> หรือ <button type="button" className="lnk" disabled={!wk} onClick={() => choose(null)}>เลือกไฟล์</button>
          <div className="muted small">{busy || "เลือกได้ทีละหลายรูป · เรียงตามเวลาถ่ายให้"}</div>
        </div>
      ) : null}
      {selId ? <div className="rp-hint">เลือกรูปไว้แล้ว กดช่อง <b>+</b> เพื่อวาง แล้วระบบจะเลือกรูปถัดไปให้</div>
        : tray.length && can.work ? <div className="muted small">กดรูปในถาดเพื่อเลือก แล้วกดช่องที่จะวาง หรือลากรูปไปวางในช่อง</div> : null}
      <div className="rp-tray" onDragOver={(e) => wk && e.preventDefault()} onDrop={(e) => drop(e, null)}>
        {tray.map((p) => (
          <div key={p.id} className={"rp-ti" + (selId === p.id ? " on" : "")} draggable={can.work} data-tp={p.id} style={{ backgroundImage: `url('${p.url}')` }}
            onDragStart={(e) => e.dataTransfer.setData("text/rp-pid", p.id)} onClick={() => can.work && setSel(selId === p.id ? null : p.id)}>
            <i>{shot(p, "ไม่มีเวลา")}</i>
            {can.work ? <button type="button" className="x" title="ลบรูปนี้" onClick={(e) => { e.stopPropagation(); if (window.confirm("ลบรูปนี้?")) act(() => deletePhoto(p.id), "ลบรูปแล้ว"); }}>×</button> : null}
          </div>
        ))}
      </div>
      {tray.length && x.L && can.work ? (
        <div className="rp-fill"><span className="muted small">เสนอเติมตามลำดับเวลาถ่ายลงช่องว่าง:</span>{F.cols.map(([c, , lab]) => <button key={c} type="button" className="btn sm" onClick={() => fill(c)}>ช่อง{lab}</button>)}</div>
      ) : null}
    </div>
  );

  const labs: number[] = [];
  if (last) for (let k = 0; k * 1000 <= last; k += Math.max(1, Math.ceil(x.L / 6))) if ((k * 1000) / last < 0.9 || k === 0) labs.push(k);

  const photoCard = !x.L ? (
    <div className="card rp">
      <div className="ch"><div className="rp-tabs">{tabs}</div></div>
      <div className="rp-main">
        <div className="cb"><div className="rp-nol"><b>ใส่ความยาวสายก่อน</b><div className="muted small">ระบบจะสร้างช่องรูปตาม กม. ให้จากความยาวสาย (ช่อง &quot;ความยาวสาย&quot; ด้านบน หรือในทะเบียนสายทาง)</div></div></div>
        <div className="rp-side">{trayBox}</div>
      </div>
    </div>
  ) : (
    <div className="card rp">
      <div className="ch">
        <div className="rp-tabs">{tabs}</div>
        <div className="rp-acts">
          <PdfButton className="btn sm" label={`🖨 พิมพ์${pf === "ba" ? "ใบรายงานผล" : "แบบสำรวจ 250 ม."}`}
            filename={fileSafe(`${pf === "ba" ? "ใบรายงานผล" : "แบบสำรวจ250ม"}-สาย ${r.code}-งวด${o.round_no}`) + ".pdf"}
            build={(host) => pfPages(r, pf, x.L, slotUrl, host)} />
        </div>
      </div>
      <div className="rp-road">
        <div className="rp-rd"><div className="ln" />
          {ps.map((m, i) => <button key={m} type="button" className={"rp-tk " + stOf(m) + (F.cols.some(([c]) => warn[c + "|" + m]) ? " w" : "")} title={"กม. " + kmTxt(m)} style={{ left: `${ps.length > 1 ? ((i / (ps.length - 1)) * 100).toFixed(3) : 0}%` }} onClick={() => goTick(m)} />)}
        </div>
        <div className="rp-lb">{labs.map((k) => <span key={k} style={{ left: `${((k * 1000) / last * 100).toFixed(2)}%` }}>{k}+000</span>)}<span style={{ left: "100%" }}>{kmTxt(last)}</span></div>
        <div className="rp-lg"><span><i className="d" />ครบ</span><span><i className="h" />ขาด 1 รูป</span><span><i />ยังไม่มี</span><span><i className="w" />มีคำเตือน</span><span className="muted">กดขีดเพื่อไปที่จุดนั้น</span></div>
      </div>
      {pn ? (
        <div className="rp-prop">
          <b>ระบบเสนอวาง {pn} รูป</b> (กรอบสีส้ม) ตรวจดูวันเวลาใต้รูปให้ตรงจุด แล้วกดยืนยัน · ยังไม่ได้บันทึก<span style={{ flex: 1 }} />
          <button type="button" className="btn sm" onClick={() => setProp(null)}>ยกเลิก</button>
          <button type="button" className="btn sm pr" disabled={!wk} onClick={() => { const m = pm; setProp(null); act(() => placePhotos(r.id, m), `วางรูป ${Object.keys(m).length} รูปแล้ว`); }}>ยืนยันวาง {pn} รูป</button>
        </div>
      ) : null}
      <div className="rp-main">
        <div>
          <div className="rp-bar">
            <div className="tabs">{([["all", "ทั้งหมด"], ["miss", "ขาดรูป"], ["done", "ครบ"]] as const).map(([k, t]) => <button key={k} type="button" className={filt === k ? "on" : ""} onClick={() => setFilt(k)}>{t} <span className="muted small">{cnt[k]}</span></button>)}</div>
            <span className="muted small">{F.every} · {ps.length} จุด ถึงปลายสาย {kmTxt(last)}</span>
          </div>
          <div className="rp-grid">
            {vis.length ? vis.map((m) => {
              const s = stOf(m), w = F.cols.map(([c]) => warn[c + "|" + m]).filter(Boolean);
              return (
                <div key={m} className={"rp-cd" + (s === "d" ? "" : " miss") + (flash === m ? " flash" : "")} id={"rpm-" + m}>
                  <div className="t"><b>{kmTxt(m)}{m === last ? <> <small className="muted">ปลายสาย</small></> : null}</b>{s === "d" ? <Chip c="g">ครบ</Chip> : s === "h" ? <Chip c="w">ขาด 1</Chip> : <Chip c="nd">ว่าง</Chip>}</div>
                  <div className="two">{F.cols.map(([c, , lab]) => slot(c, lab, m))}</div>
                  {w.length ? <div className="rp-w">⚠ {w.join(" · ")}</div> : null}
                </div>
              );
            }) : <div className="muted" style={{ padding: 20 }}>ไม่มีจุดในตัวกรองนี้</div>}
          </div>
        </div>
        <div className="rp-side">
          {trayBox}
          <div className="rp-box">
            <div className="h"><b>ความครบของรูป</b></div>
            {(Object.keys(PF) as PfKind[]).map((f) => { const c = cntOf(f); return (
              <div key={f}>
                <div className="rp-pr"><span>{PF[f].name}{f === "lr" && !lr ? <> <small className="muted">(ไม่บังคับ)</small></> : null}</span><b>{c.n} / {c.N}</b></div>
                <div className="rp-pb"><i style={{ width: `${c.N ? (c.n / c.N) * 100 : 0}%` }} /></div>
              </div>
            ); })}
            {nW ? <div className="rp-hint warn">⚠ มี {nW} รูปที่ควรตรวจ (เวลาถ่ายไม่เข้าลำดับ) ดูกรอบสีแดงในการ์ด</div> : c0.n === c0.N ? <div className="rp-hint ok">✓ {F.name}ครบทุกจุดแล้ว</div> : null}
            {lrNote}
          </div>
        </div>
      </div>
    </div>
  );

  const vp = view ? byId.get(view.id) : null;
  return (
    <div className="ax"><div className="pg">
      <Top
        crumb={<><Link className="lnk" href={`/rounds?${rkQuery(o.k)}&o=${o.id}`}>งาน › {rkName(o.k)}</Link> › <Link className="lnk" href={`/rounds?${rkQuery(o.k)}&o=${o.id}`}>{o.hmd ? "หมวด" + o.hmd : "ไม่ระบุหมวด"}</Link> › <b>{r.code}</b></>}
        title={r.code || "ไม่มีเลขสาย"}
        sub={[r.descr, G?.amp ? "อ." + G.amp : "", A.short].filter(Boolean).join(" · ")}
        acts={<>
          {G?.map && /^https?:\/\//i.test(G.map) ? <a className="btn maplnk" href={G.map} target="_blank" rel="noopener noreferrer">📍 เปิดแผนที่</a> : null}
          {nav.prev ? <Link className="btn" href={`/orders/${o.id}/routes/${nav.prev.id}`} title={`สายก่อนหน้า (${nav.pos - 1}/${nav.n})`}>‹ {nav.prev.code}</Link> : null}
          {nav.next ? <Link className="btn" href={`/orders/${o.id}/routes/${nav.next.id}`} title={`สายถัดไป (${nav.pos + 1}/${nav.n})`}>{nav.next.code} ›</Link> : null}
          <Link className="btn" href={`/rounds?${rkQuery(o.k)}&o=${o.id}`}>← กลับงวด</Link>
          <PackButton className="btn pr" orderIds={[o.id]} mode="route" routeId={r.id} label="PDF รายงานภาพถ่ายสายนี้" filename={`รายงานภาพถ่าย-สาย ${r.code}-งวด${o.round_no}`} />
        </>}
      />
      <div className="body">
        <div className="stats">
          <Stat l="ระยะที่ตัด" v={fmtKm(x.km)} u={x.L ? "/ " + fmtKm(x.L) + " กม." : "กม."} p={x.L ? pct(x.km, x.L) : undefined}
            s={<span style={overKm ? { color: "var(--bad)" } : undefined}>{overKm ? "เกินความยาวสาย · " : ""}ความยาวสาย{" "}
              <input key={String(x.L)} className="in inl" defaultValue={x.L || ""} placeholder="–" disabled={!wk} aria-label="ความยาวสาย (กม.)"
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(x.L || "")) act(() => setRouteLength(r.id, v), "บันทึกความยาวสายแล้ว ใช้กับสายนี้ทุกงวด"); }} /> กม.</span>} />
          <Stat l="รูปรายงาน (ก่อน/หลัง)" v={x.ph ? `${x.ph.ba.n} / ${x.ph.ba.N}` : "–"} u="รูป" p={x.ph ? pct(x.ph.ba.n, x.ph.ba.N) : undefined}
            s={x.ph ? (x.pics ? "รูปครบแล้ว" : `${x.ph.ba.pts} จุด ทุก 500 ม.`) : "ใส่ความยาวสายก่อน"} />
          <div className="st">
            <div className="l">สถานะ</div>
            <div className="v" style={{ fontSize: 16, marginTop: 6 }}><Chip c={stC}>{stT}</Chip></div>
            <div className="s" style={{ marginTop: 6 }}>
              {x.cut ? `จบ ${dS(x.finDate)} · ${x.fin ? "จากบันทึกรายวัน" : "กม. ครบความยาวสาย"}`
                : <>ติ๊ก &quot;จบสายนี้&quot; ในบันทึกรายวันเมื่อตัดครบ {can.daily ? <Link className="lnk" href={`/daily?d=${today()}&add=${r.id}`}>+ ลงงานวันนี้</Link> : null}</>}
            </div>
          </div>
          {o.po_no && r.in_po
            ? <Stat l={"ตามใบสั่งจ้าง " + o.po_no} v={fmt0(r.area)} u="ตร.ม." s={can.prices && r.rate != null ? `${fmt(lineAmt({ area: r.area, rate: r.rate }))} บาท · ${fmt(r.rate)} บาท/ตร.ม.` : undefined} />
            : <Stat l="พื้นที่ / มูลค่า" v="รอ" u="ใบสั่งจ้าง" s={o.po_no ? "สายนี้ไม่อยู่ในใบสั่งจ้าง จะไม่ขึ้นในเอกสาร" : "ตร.ม. และราคามาจากใบสั่งจ้างเท่านั้น"} />}
        </div>
        {!can.work ? <div className="hint" style={{ marginBottom: 10 }}>ดูได้อย่างเดียว</div> : null}
        {photoCard}
        <div className="card rp-days">
          <div className="ch"><h3>วันที่เข้าตัด <span className="m">{days.length} วัน</span></h3></div>
          {days.length ? (
            <table className="tb">
              <thead><tr><th>วันที่</th><th className="n">ตัด (กม.)</th><th className="n">คนงานทั้งวัน</th></tr></thead>
              <tbody>{days.map((d) => (
                <tr key={d.date} className="click" onClick={() => router.push(`/daily?d=${d.date}`)}>
                  <td>{WD[wdOf(d.date)]}. {dS(d.date)}{d.fin ? <> <Chip c="g">จบสาย</Chip></> : null}</td>
                  <td className="n num">{d.km != null ? fmtKm(d.km) : "–"}</td>
                  <td className="n num">{fmtN(d.crew)} คน</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="emp">ยังไม่มีบันทึกรายวันของสายนี้</div>}
          <div className="cf">
            <span className="small muted">{G ? "ความยาวสายเก็บที่ทะเบียนสายทาง ใช้ทุกงวด" : "สายนี้ยังไม่อยู่ในทะเบียนสายทาง"}</span>
            {G ? <Link className="btn sm gh" href={`/roads?ag=${A.id}&g=${G.id}`}>เปิดในทะเบียน →</Link> : null}
          </div>
        </div>
      </div>
      <input ref={pick} type="file" accept="image/*" multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) upload(pickTo.current ? [fs[0]] : fs, pickTo.current ?? undefined); }} />
      {view && vp ? (
        <Dialog title={`กม. ${kmTxt(Number(view.k.split("|")[1]))} · ${LAB[view.k[0]]}`} onClose={() => setView(null)}
          foot={<>
            {can.work ? <><button type="button" className="btn" onClick={() => { setView(null); unplace(vp.id); }}>ย้ายกลับถาด</button>
              <button type="button" className="btn" onClick={() => { const k = view.k; setView(null); choose(k); }}>เปลี่ยนรูป…</button></> : null}
            <span style={{ flex: 1 }} /><button type="button" className="btn pr" onClick={() => setView(null)}>ปิด</button>
          </>}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={vp.url} alt="" style={{ width: "100%", maxHeight: "62vh", objectFit: "contain", background: "#111", borderRadius: 8 }} />
          <div className="muted small" style={{ marginTop: 8 }}>ถ่ายเมื่อ {vp.date ? dS(vp.date) + (vp.time ? " " + vp.time + " น." : "") : "ไม่มีข้อมูลเวลาถ่าย"} · {vp.name}</div>
        </Dialog>
      ) : null}
    </div></div>
  );
}
