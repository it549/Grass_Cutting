"use client";

// เบิกน้ำมัน: เครื่องตัดหญ้า / รถเดินทาง (แบบเดียวกับระบบบน claude.ai)
import { useState } from "react";
import { Dialog, toast } from "@/components/ui";
import { type Car, type CrewRec, type Fuel, FK, dS, fmt0, fmtN, num, r2 } from "@/lib/model";
import { deleteFuel, saveFuel } from "@/app/(app)/daily/actions";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
const dDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

export function FuelDialog({ f0, date, kind0, crew, cars, recent, onClose }: {
  f0?: Fuel | null; date: string; kind0?: "mower" | "car"; crew: CrewRec[]; cars: Car[]; recent: Fuel[]; onClose: () => void;
}) {
  const carDef = (() => { try { return localStorage.getItem("grass.lastcar") || ""; } catch { return ""; } })();
  const [kind, setKind] = useState<"mower" | "car">(f0?.kind ?? kind0 ?? "mower");
  const [d, setD] = useState(f0?.log_date ?? date ?? today());
  const [by, setBy] = useState(f0?.crew_id ?? "");
  const [car, setCar] = useState(f0?.car_id ?? (cars.some((c) => c.id === carDef && c.active) ? carDef : cars.find((c) => c.active)?.id ?? ""));
  const last = (k: string, c = car) => recent.filter((x) => x.kind === k && (k !== "car" || (x.car_id ?? "") === c) && (!f0 || x.id !== f0.id)).sort((a, b) => b.log_date.localeCompare(a.log_date))[0];
  const [L, setL] = useState(f0 ? String(f0.liters) : "");
  const [P, setP] = useState(f0 ? String(f0.price) : String(last(kind)?.price ?? ""));
  const [A, setA] = useState(f0 ? String(f0.amt) : "");
  const [amtTouched, setAmtTouched] = useState(!!(f0 && Math.abs(num(f0.amt) - r2(num(f0.liters) * num(f0.price))) > 0.01));
  const [pTouched, setPTouched] = useState(false);
  const [odo, setOdo] = useState(f0?.odo ? String(f0.odo) : "");
  const [note, setNote] = useState(f0?.note ?? "");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const calcA = (l: string, p: string) => { if (!amtTouched) { const a = r2(num(l) * num(p)); setA(a ? String(a) : ""); } };
  const pickKind = (k: "mower" | "car") => { setKind(k); if (!f0 && !pTouched) { const l = last(k); const p = l ? String(l.price) : ""; setP(p); calcA(L, p); } };
  const pickCar = (c: string) => { setCar(c); if (!f0 && !pTouched) { const l = last("car", c); if (l) { setP(String(l.price)); calcA(L, String(l.price)); } } };
  const carName = (id: string | null) => { const c = cars.find((x) => x.id === id); return c ? c.plate + (c.name ? " " + c.name : "") : "รถ (ไม่ระบุ)"; };
  const x = last(kind);
  const hint = x
    ? `ครั้งก่อน (${kind === "car" ? carName(x.car_id) : FK[kind]}): ${dS(x.log_date)} · ${fmtN(x.liters)} ลิตร × ${num(x.price).toFixed(2)} = ${fmt0(x.amt)} บาท${x.odo ? " · ไมล์ " + fmt0(x.odo) : ""} · ผ่านมา ${Math.max(0, dDiff(x.log_date, d || today()))} วัน`
    : "ยังไม่เคยบันทึกเบิกน้ำมันประเภทนี้";

  const save = async () => {
    const l = num(L), p = num(P), a = num(A) || r2(l * p);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast("ใส่วันที่เบิก", true); return; }
    if (!(l > 0)) { toast("ใส่จำนวนลิตร", true); return; }
    if (!(a > 0)) { toast("ใส่ราคาต่อลิตร หรือยอดเงิน", true); return; }
    setBusy(true);
    const C = cars.find((c) => c.id === car);
    const r = await saveFuel({ id: f0?.id, date: d, kind, liters: l, price: p || r2(a / l), amt: a, crew_id: by, by_name: crew.find((c) => c.id === by)?.name ?? "", car_id: kind === "car" ? car : "", car_plate: kind === "car" ? C?.plate ?? "" : "", odo: kind === "car" ? odo : "", note });
    setBusy(false);
    if (r.error) { toast(r.error, true); return; }
    if (kind === "car" && car) { try { localStorage.setItem("grass.lastcar", car); } catch {} }
    toast(`บันทึกเบิกน้ำมัน${FK[kind]} ${fmtN(l)} ลิตร ${fmt0(a)} บาทแล้ว`);
    onClose();
  };
  const del = async () => {
    if (!f0) return;
    if (!armed) { setArmed(true); return; }
    const r = await deleteFuel(f0.id);
    if (r.error) { toast(r.error, true); return; }
    toast("ลบรายการเบิกน้ำมันแล้ว"); onClose();
  };

  return (
    <Dialog
      title={f0 ? "แก้ไขการเบิกน้ำมัน" : "เบิกน้ำมัน"}
      onClose={onClose}
      onBackdrop={() => {}}
      foot={<>
        {f0 ? <button className="lnk bad" type="button" onClick={del}>{armed ? "กดอีกครั้งเพื่อยืนยันลบ" : "ลบรายการนี้"}</button> : <span />}
        <div className="acts"><button className="btn" type="button" onClick={onClose}>ยกเลิก</button><button className="btn pr" type="button" disabled={busy} onClick={save}>บันทึก</button></div>
      </>}
    >
      <div className="fdl">
        <div className="seg fk">{(["mower", "car"] as const).map((k) => <button key={k} type="button" className={kind === k ? "y" : ""} onClick={() => pickKind(k)}>{FK[k]}</button>)}</div>
        <div className="grid2">
          <label className="f">วันที่เบิก<input className="in" type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
          <label className="f">ผู้เบิก
            <select className="in" value={by} onChange={(e) => setBy(e.target.value)}>
              <option value="">–</option>
              {crew.filter((c) => c.active || c.id === by).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="f">จำนวน (ลิตร)<input className="in num" autoFocus value={L} inputMode="decimal" placeholder="0" onChange={(e) => { setL(e.target.value); calcA(e.target.value, P); }} /></label>
          <label className="f">ราคาต่อลิตร (บาท)<input className="in num" value={P} inputMode="decimal" placeholder="0.00" onChange={(e) => { setP(e.target.value); setPTouched(true); calcA(L, e.target.value); }} /></label>
          <label className="f">เป็นเงิน (บาท)<input className="in num" value={A} inputMode="decimal" placeholder="คิดให้อัตโนมัติ" onChange={(e) => { setA(e.target.value); setAmtTouched(e.target.value.trim() !== ""); }} /></label>
          {kind === "car" ? <>
            <label className="f">ทะเบียนรถ
              <select className="in" value={car} onChange={(e) => pickCar(e.target.value)}>
                <option value="">ไม่ระบุ</option>
                {cars.filter((c) => c.active || c.id === car).map((c) => <option key={c.id} value={c.id}>{c.plate}{c.name ? " · " + c.name : ""}</option>)}
              </select>
            </label>
            <label className="f">เลขไมล์ตอนเติม <span className="muted small">(ไม่บังคับ)</span><input className="in num" value={odo} inputMode="numeric" placeholder="เช่น 125430" onChange={(e) => setOdo(e.target.value)} /></label>
          </> : null}
          <label className="f" style={{ gridColumn: "1/-1" }}>หมายเหตุ<input className="in" value={note} placeholder="เช่น ปั๊ม ปตท. หน้าอำเภอ" onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <div className="fhint">{hint}</div>
      </div>
    </Dialog>
  );
}
