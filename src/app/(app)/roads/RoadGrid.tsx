"use client";

// เพิ่มสายทางหลายเส้น / แก้หลายเส้น (ตารางแบบ Excel: วางหลายแถว, Enter ลงแถวถัดไป, เติมรหัสจังหวัดให้)
import { useEffect, useRef, useState } from "react";
import { Chip, Dialog, toast } from "@/components/ui";
import { type Agency, type Road, type World, cNorm, codePrefix, fmtKm, hmdName, kmText, num } from "@/lib/model";
import { saveRoads } from "./actions";
import type { RoadCan } from "./RoadsView";

type Row = { id: string; code: string; name: string; amp: string; len: string; hmd: string; map: string; o?: Road };
type Fk = "code" | "name" | "amp" | "len" | "map";
const blank = (): Row => ({ id: "", code: "", name: "", amp: "", len: "", hmd: "", map: "" });
const PH: Record<Fk, string> = { code: "เลขสาย", name: "แยก ทล.3 – บ้าน…", amp: "อำเภอ", len: "–", map: "https://maps.app.goo.gl/…" };

export function RoadGrid({ W, A, hmd, mode, can, onClose, onSaved }: {
  W: World; A: Agency; hmd: string; mode: "add" | "edit"; can: RoadCan; onClose: () => void; onSaved: (h: string) => void;
}) {
  const edit = mode === "edit", pre = codePrefix(W, A.id), lenOnly = edit && !can.edit;
  const F: Fk[] = edit ? ["code", "name", "amp", "len", "map"] : ["code", "name", "amp", "len"];
  const [rows, setRows] = useState<Row[]>(() =>
    edit
      ? W.roads.filter((g) => g.agency_id === A.id && (g.hmd || "") === (hmd || "")).sort((a, b) => a.code.localeCompare(b.code, "th"))
        .map((g) => ({ id: g.id, code: g.code, name: g.name, amp: g.amp, len: g.len_km == null ? "" : String(g.len_km), hmd: g.hmd || "", map: g.map_url ?? "", o: g }))
      : Array.from({ length: 5 }, blank),
  );
  const [tH, setTH] = useState(hmd || "");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nAdd, setNAdd] = useState("10");
  const focusTo = useRef<[number, Fk] | null>(edit ? null : [0, "code"]);
  const setFocus = (f: [number, Fk]) => { focusTo.current = f; };
  const body = useRef<HTMLTableSectionElement>(null);

  // ย้ายเคอร์เซอร์หลังวาดตารางใหม่ (Enter ลงแถวถัดไป / เพิ่มแถว)
  useEffect(() => {
    const f = focusTo.current;
    if (!f) return;
    focusTo.current = null;
    const el = body.current?.querySelector<HTMLInputElement>(`tr[data-i="${f[0]}"] [data-f="${f[1]}"]`);
    if (el) { el.focus(); el.select(); }
  });

  const fixCode = (v: string) => { v = String(v || "").trim().replace(/\s+/g, ""); return /^\d{3,5}$/.test(v) && pre ? pre + v : v; };
  const filled = (r: Row) => F.some((f) => String(r[f] || "").trim());
  const changed = (r: Row) => !r.o ? filled(r)
    : r.code !== r.o.code || r.name !== r.o.name || r.amp !== r.o.amp || r.len !== (r.o.len_km == null ? "" : String(r.o.len_km)) || r.hmd !== (r.o.hmd || "") || r.map !== (r.o.map_url ?? "");
  const dirty = rows.some(changed);

  // สถานะแต่ละแถว: g = พร้อม/แก้แล้ว, w = เตือน, r = ต้องแก้
  const st = (() => {
    const seen: Record<string, number> = {}, out = rows.map(() => "");
    rows.forEach((r, i) => {
      if (!filled(r)) return;
      const c = cNorm(r.code);
      if (!c) { out[i] = "w:ใส่เลขสาย"; return; }
      if (seen[c] != null) { out[i] = "r:ซ้ำกับแถว " + (seen[c] + 1); return; }
      seen[c] = i;
      const g = W.roads.find((x) => x.agency_id === A.id && cNorm(x.code) === c && x.id !== r.id);
      if (g) { out[i] = `r:มีในทะเบียนแล้ว (${hmdName(g.hmd)})`; return; }
      const t = kmText(r.len);
      if (t && !(Number.isFinite(Number(t)) && Number(t) >= 0)) { out[i] = "r:กม. ต้องเป็นตัวเลข"; return; }
      if (r.map.trim() && !/^https?:\/\//i.test(r.map.trim())) { out[i] = "r:ลิงก์ต้องขึ้นต้นด้วย https://"; return; }
      if (edit && changed(r)) out[i] = "g:แก้แล้ว";
      else if (!edit) out[i] = t ? "g:พร้อม" : "w:ยังไม่มี กม. (ใส่ทีหลังได้)";
    });
    return out;
  })();
  const ok = rows.filter((r, i) => changed(r) && !/^r:/.test(st[i]) && cNorm(r.code));
  const bad = st.filter((x) => /^r:/.test(x)).length;
  const km = ok.reduce((s, r) => s + (Number(kmText(r.len)) || 0), 0);

  const setCell = (i: number, f: Fk, v: string) => {
    setArmed(false);
    setRows((rs) => {
      const n = rs.map((r, k) => (k === i ? { ...r, [f]: v } : r));
      if (!edit && i === n.length - 1 && filled(n[i])) n.push(blank());
      return n;
    });
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number, f: Fk) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    setRows((rs) => {
      const n = rs.map((r, k) => (k === i ? { ...r, code: fixCode(r.code) } : r));
      if (i + 1 >= n.length) { if (edit) return n; n.push(blank()); }
      return n;
    });
    if (i + 1 < rows.length || !edit) setFocus([i + 1, edit ? f : "code"]);
  };
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, i0: number, f: Fk) => {
    const t = e.clipboardData.getData("text");
    if (!/\t|\n/.test(t.trim())) return;
    e.preventDefault();
    const lines = t.replace(/\r/g, "").split("\n").filter((l) => l.trim()), f0 = F.indexOf(f);
    setArmed(false);
    setRows((rs) => {
      const n = rs.map((r) => ({ ...r }));
      lines.forEach((l, k) => {
        const i = i0 + k;
        if (!n[i]) { if (edit) return; n.push(blank()); }
        l.split("\t").forEach((v, c) => {
          const ff = F[f0 + c];
          if (!ff || (lenOnly && ff !== "len")) return;
          n[i][ff] = ff === "code" ? fixCode(v) : ff === "len" ? kmText(v.replace(/[^\d.,]/g, "")) : v.trim();
        });
      });
      if (!edit && filled(n[n.length - 1])) n.push(blank());
      return n;
    });
    toast(`วาง ${lines.length} แถวแล้ว ตรวจก่อนบันทึก`);
  };
  const close = () => {
    if (dirty && !armed) { setArmed(true); return; }
    onClose();
  };
  const save = async () => {
    const fixed = rows.map((r) => ({ ...r, code: fixCode(r.code) }));
    setRows(fixed);
    if (bad) { toast("มีแถวที่ต้องแก้ก่อนบันทึก", true); return; }
    const L = fixed.filter((r) => changed(r) && cNorm(r.code));
    if (!L.length) return;
    setBusy(true);
    const t = (r: Row) => kmText(r.len);
    const res = await saveRoads(L.map((r) => ({
      id: r.id || undefined, agency_id: A.id, hmd: edit ? r.hmd : tH, code: r.code, name: r.name, amp: r.amp,
      len_km: t(r) === "" ? null : num(t(r)), map_url: r.map, note: r.o?.note ?? "",
    })));
    setBusy(false);
    if (!res.ok) { toast(res.error, true); return; }
    toast(edit ? `แก้ ${res.n} เส้นแล้ว` : `เพิ่ม ${res.n} เส้นเข้าทะเบียนแล้ว`);
    onSaved(edit ? hmd : tH);
  };

  const hOpts = (cur: string) => [...new Set([...A.hmds, cur])];
  return (
    <Dialog
      wide
      title={edit ? "แก้สายทางหลายเส้น" : "เพิ่มสายทาง"}
      onClose={close}
      onBackdrop={() => { if (dirty) toast("ยังไม่ได้บันทึก กดปุ่มปิดถ้าจะทิ้งข้อมูล", true); else onClose(); }}
      foot={<>
        <span className="small">
          {ok.length || bad ? <>{ok.length ? <><b>{edit ? "แก้" : "พร้อมบันทึก"} {ok.length} เส้น</b>{km ? " · รวม " + fmtKm(km) + " กม." : ""}</> : null}{bad ? <span style={{ color: "var(--bad)" }}> · {bad} แถวต้องแก้ก่อน</span> : null}</>
            : <span className="muted">{edit ? "ยังไม่ได้แก้" : "ยังไม่ได้กรอก"}</span>}
        </span>
        <div className="acts">
          <button className="btn" type="button" onClick={close}>{armed ? "กดอีกครั้งเพื่อปิดโดยไม่บันทึก" : "ปิด"}</button>
          <button className="btn pr" type="button" disabled={!ok.length || !!bad || busy} onClick={save}>{busy ? "กำลังบันทึก…" : ok.length ? `บันทึก ${ok.length} เส้น` : "บันทึก"}</button>
        </div>
      </>}
    >
      <div className="grid3">
        <label className="f">แขวง<input className="in" value={A.name} disabled /></label>
        <label className="f">หมวด
          <select className="in" value={tH} disabled={edit} onChange={(e) => setTH(e.target.value)}>
            {hOpts(hmd || "").map((h) => <option key={h} value={h}>{hmdName(h)}</option>)}
          </select>
        </label>
        <div className="f">&nbsp;<span className="small muted" style={{ lineHeight: 1.5 }}>
          {lenOnly ? "ใส่ความยาว (กม.) ได้ทุกแถว · วางหลายแถวจาก Excel ได้ · กด Enter ลงแถวถัดไป"
            : edit ? "แก้ได้ทุกช่อง รวมถึงลิงก์แผนที่และย้ายหมวด · วางลิงก์หลายแถวจาก Excel ได้ · กด Enter ลงแถวถัดไป"
              : `พิมพ์แค่เลขสาย เช่น 3083 ระบบเติม ${pre || "รหัสจังหวัด"} ให้ · ก๊อปหลายแถวจาก Excel มาวางได้`}
        </span></div>
      </div>
      <div className="tscroll"><table className="tb rgt" style={{ marginTop: 14 }}>
        <colgroup><col style={{ width: 36 }} /><col style={{ width: 150 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 96 }} />{edit ? <col style={{ width: 170 }} /> : null}<col style={{ width: 150 }} /><col style={{ width: 34 }} /></colgroup>
        <thead><tr><th>#</th><th>เลขสาย</th><th>ชื่อสาย</th><th>อำเภอ</th><th className="n">กม.</th>{edit ? <th>ลิงก์ Google Maps</th> : null}<th>{edit ? "หมวด" : ""}</th><th></th></tr></thead>
        <tbody ref={body}>
          {rows.map((r, i) => {
            const [c, t] = (st[i] || "").split(/:(.*)/);
            const chip = t ? <Chip c={c === "g" ? "g" : c === "w" ? "w" : "r"}>{t}</Chip> : null;
            return (
              <tr key={i} data-i={i} className={c === "r" ? "bad" : undefined}>
                <td className="muted small">{i + 1}</td>
                {F.map((f) => (
                  <td key={f}>
                    <input className="in" data-f={f} value={r[f]} placeholder={f === "code" && pre ? pre + "3083" : PH[f]} disabled={lenOnly && f !== "len"}
                      style={f === "len" ? { textAlign: "right" } : undefined} inputMode={f === "len" ? "decimal" : undefined}
                      onChange={(e) => setCell(i, f, e.target.value)} onKeyDown={(e) => onKey(e, i, f)} onPaste={(e) => onPaste(e, i, f)}
                      onBlur={f === "code" ? (e) => { const v = fixCode(e.target.value); if (v !== e.target.value) setCell(i, "code", v); } : undefined} />
                  </td>
                ))}
                <td className="rs">
                  {edit ? <>
                    <select className="in" value={r.hmd} disabled={lenOnly} onChange={(e) => { const v = e.target.value; setArmed(false); setRows((rs) => rs.map((x, k) => (k === i ? { ...x, hmd: v } : x))); }}>
                      {hOpts(r.hmd).map((h) => <option key={h} value={h}>{h || "ไม่ระบุ"}</option>)}
                    </select>
                    <div className="rsc">{chip}</div>
                  </> : chip}
                </td>
                <td>{edit ? null : <button className="lnk bad" type="button" title="ลบแถว" onClick={() => setRows((rs) => { const n = rs.filter((_, k) => k !== i); return n.length ? n : [blank()]; })}>✕</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {edit ? null : (
        <div className="acts" style={{ marginTop: 10 }}>
          <span className="small muted">เพิ่ม</span>
          <input className="in" value={nAdd} onChange={(e) => setNAdd(e.target.value)} style={{ width: 64, textAlign: "right" }} />
          <button className="btn sm" type="button" onClick={() => {
            const n = Math.min(100, Math.max(1, Math.round(num(nAdd)) || 0)), at = rows.length;
            setRows((rs) => [...rs, ...Array.from({ length: n }, blank)]); setFocus([at, "code"]);
          }}>แถว</button>
          <span className="small muted">· กรอกแถวสุดท้ายแล้วระบบเพิ่มแถวให้เอง</span>
        </div>
      )}
    </Dialog>
  );
}
