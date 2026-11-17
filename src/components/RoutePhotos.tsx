"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPhotos, deletePhoto, reorderPhotos, setRouteLength, setRouteStatus, updatePhoto, type NewPhoto } from "@/app/(app)/orders/photo-actions";
import { uploadFile } from "@/lib/upload-client";
import { routeState, STATE_LABEL } from "@/lib/progress";
import { exifDate, shrink } from "@/lib/image";
import { fmt, fmt0, fmtKm, lineAmt, thaiDate } from "@/lib/calc";

type Photo = { id: string; kind: "b" | "a"; url: string; taken_date: string | null; taken_time: string | null; caption: string; name: string | null };
type Route = { id: string; area: number; rate: number; done: boolean | null; done_date: string | null; length_km: number | null; km_done: number };

/** can.work = เพิ่ม/แก้รูปและสถานะได้, can.money = เห็นมูลค่า */
export function RoutePhotos({ companyId, orderId, route, photos, can }: { companyId: string; orderId: string; route: Route; photos: Photo[]; can: { work: boolean; money: boolean } }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const st = routeState(route, photos);

  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setErr("");
      const r = await fn();
      if (r?.error) setErr(r.error);
      router.refresh();
    });

  async function add(kind: "b" | "a", files: File[]) {
    files = files.filter((f) => /^image\//.test(f.type));
    if (!files.length) { setErr("เลือกไฟล์รูป (JPG/PNG) เท่านั้น"); return; }
    setErr("");
    setBusy(true);
    const done: NewPhoto[] = [];
    const bad: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setMsg(`กำลังเพิ่มรูป ${i + 1}/${files.length}…`);
      try {
        const ex = await exifDate(f);
        const s = await shrink(f);
        const path = `${companyId}/photos/${orderId}/${crypto.randomUUID()}.jpg`;
        const { error } = await uploadFile(path, s.blob);
        if (error) throw new Error(error);
        done.push({ path, kind, w: s.w, h: s.h, taken_date: ex?.date ?? "", taken_time: ex?.time ?? "", name: f.name });
      } catch (e) {
        bad.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    done.sort((a, b) => (a.taken_date + a.taken_time).localeCompare(b.taken_date + b.taken_time));
    if (done.length) {
      const r = await addPhotos(orderId, route.id, done);
      if (r.error) bad.push(r.error);
    }
    setBusy(false);
    setMsg(done.length ? `เพิ่ม ${done.length} รูปแล้ว` : "");
    if (bad.length) setErr(bad.join(" · "));
    router.refresh();
  }

  const zone = (kind: "b" | "a", title: string, hint: string) => {
    const list = photos.filter((p) => p.kind === kind);
    return (
      <Zone key={kind} title={title} hint={hint} count={list.length} disabled={busy} onFiles={(fs) => add(kind, fs)}>
        <div className="pics">
          {list.map((p, i) => (
            <div key={p.id} className="pic">
              {p.url ? <img src={p.url} alt="" loading="lazy" /> : <div className="noimg">โหลดรูปไม่ได้</div>}
              <div className="pm">
                <div className="row">
                  <span>ภาพที่ {i + 1} · {p.taken_date ? thaiDate(p.taken_date) + (p.taken_time ? " " + p.taken_time : "") : "ไม่มีวันที่ในรูป"}</span>
                  <span className="acts" style={{ gap: 6 }}>
                    <button type="button" className="link" title="เลื่อนขึ้น" disabled={i === 0 || pending} onClick={() => run(() => reorderPhotos(swapIds(list, i, i - 1)))}>↑</button>
                    <button type="button" className="link" title="เลื่อนลง" disabled={i === list.length - 1 || pending} onClick={() => run(() => reorderPhotos(swapIds(list, i, i + 1)))}>↓</button>
                    <button type="button" className="link" title="ย้ายไปอีกฝั่ง" disabled={pending} onClick={() => run(() => updatePhoto(p.id, { kind: kind === "a" ? "b" : "a" }))}>⇄</button>
                  </span>
                </div>
                <input defaultValue={p.caption} placeholder="คำบรรยาย เช่น กม. 2+150 ซ้ายทาง" onBlur={(e) => e.target.value !== p.caption && run(() => updatePhoto(p.id, { caption: e.target.value }))} />
                <div className="row">
                  <input type="date" defaultValue={p.taken_date ?? ""} onChange={(e) => run(() => updatePhoto(p.id, { taken_date: e.target.value }))} />
                  <button type="button" className="link bad" disabled={pending} onClick={() => window.confirm("ลบรูปนี้?") && run(() => deletePhoto(p.id))}>ลบ</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Zone>
    );
  };

  return (
    <fieldset disabled={!can.work} className="stack" style={{ gap: 16, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {!can.work && <p className="alert" style={{ margin: 0 }}>ดูได้อย่างเดียว</p>}
      <div className={"kp" + (can.money ? " kp4" : "")}>
        <div className="k">
          <div className="lab">พื้นที่</div><div className="v num">{fmt0(route.area)}<small>ตร.ม.</small></div>
          <div className="s kmrow">
            ความยาว <input className="n" inputMode="decimal" defaultValue={route.length_km ?? ""} placeholder="–" disabled={pending}
              onBlur={(e) => { if (e.target.value.trim() !== String(route.length_km ?? "")) run(() => setRouteLength(route.id, e.target.value)); }} /> กม.
          </div>
          <div className="s muted" style={route.length_km && route.km_done > route.length_km ? { color: "var(--bad, #a33)" } : undefined}>
            ตัดแล้ว {fmtKm(route.km_done)}{route.length_km ? ` / ${fmtKm(route.length_km)} กม. (${Math.round((route.km_done / route.length_km) * 100)}%)` : " กม."}
            {route.length_km && route.km_done > route.length_km ? " · เกินความยาวสาย ตรวจบันทึกรายวัน" : " · จากบันทึกรายวัน"}
          </div>
        </div>
        {can.money && <div className="k"><div className="lab">มูลค่า</div><div className="v num">{fmt(lineAmt(route))}<small>บาท</small></div><div className="s">{fmt(route.rate)} บาท/ตร.ม.</div></div>}
        <div className="k">
          <div className="lab">สถานะ</div>
          <div style={{ margin: "10px 0 8px" }}><span className={"st s" + st.s} style={{ fontSize: 15 }}>{STATE_LABEL[st.s]}</span></div>
          <label className="chk small"><input type="checkbox" checked={route.done === true} disabled={pending} onChange={(e) => run(() => setRouteStatus(route.id, e.target.checked ? true : null, route.done_date ?? ""))} /> ทำเครื่องหมายว่าเสร็จแล้ว</label>
          <div className="s muted">ไม่ติ๊ก = มีรูปทั้งก่อนและหลังถือว่าเสร็จ</div>
        </div>
        <div className="k">
          <div className="lab">วันที่แล้วเสร็จ</div>
          <input type="date" defaultValue={route.done_date ?? ""} style={{ marginTop: 10, maxWidth: 180 }} onChange={(e) => run(() => setRouteStatus(route.id, route.done, e.target.value))} />
          <div className="s muted">{route.done_date ? "กำหนดเอง" : st.doneDate ? `ตามรูปหลังตัดล่าสุด ${thaiDate(st.doneDate)}` : "ว่างไว้ = ใช้วันที่ของรูปหลังตัดล่าสุด"}</div>
        </div>
      </div>
      {msg && <p className="alert ok" style={{ margin: 0 }}>{msg}</p>}
      {err && <p className="alert bad" style={{ margin: 0 }}>{err}</p>}
      <div className="drops">
        {zone("b", "ก่อนตัด", "ลากรูปมาวาง หรือกดเลือกรูป ระบบอ่านวันที่ถ่ายจากรูปให้")}
        {zone("a", "หลังตัด", "ถ่ายมุมเดียวกับรูปก่อนตัด รายงานจับคู่ตามลำดับ (เลื่อน ↑ ↓ ได้)")}
      </div>
      <p className="small muted">รูปที่ส่งผ่าน LINE มักไม่มีวันที่ในไฟล์ ใส่วันที่เองได้ใต้รูป · รูปถูกย่อเหลือด้านยาว 1600px ก่อนเก็บ · ทุกบทบาทยกเว้นดูอย่างเดียวเพิ่มรูปได้</p>
    </fieldset>
  );
}

function swapIds(list: { id: string }[], i: number, j: number) {
  const ids = list.map((x) => x.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

function Zone({ title, hint, count, disabled, onFiles, children }: { title: string; hint: string; count: number; disabled: boolean; onFiles: (f: File[]) => void; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  return (
    <div
      className={"zone" + (over ? " over" : "")}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFiles([...e.dataTransfer.files]); }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <b className="serif" style={{ fontSize: 17 }}>{title}</b>
        <span className="small muted">{count} รูป</span>
      </div>
      <div className="small muted">{hint}</div>
      <div className="acts" style={{ marginTop: 8 }}>
        <button type="button" className="btn sm" disabled={disabled} onClick={() => inp.current?.click()}>+ เลือกรูป</button>
        <input ref={inp} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
      {children}
    </div>
  );
}
