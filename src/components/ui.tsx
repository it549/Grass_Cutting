"use client";

// ชิ้นส่วนหน้าตาที่ใช้ร่วมกัน (แบบเดียวกับระบบบน claude.ai) ใช้ภายใน <div className="ax">
import { useEffect, useRef, useState } from "react";

export const Chip = ({ c = "", children, title }: { c?: string; children: React.ReactNode; title?: string }) => (
  <span className={"chip " + c} title={title}>{children}</span>
);

export const Bar = ({ p, cls = "" }: { p: number; cls?: string }) => (
  <div className={"bar " + cls}><i style={{ width: `${Math.max(0, Math.min(100, p || 0))}%` }} /></div>
);

export function Stat({ l, v, u, s, p }: { l: string; v: React.ReactNode; u?: string; s?: React.ReactNode; p?: number }) {
  return (
    <div className="st">
      <div className="l">{l}</div>
      <div className="v num">{v}{u ? <small>{u}</small> : null}</div>
      {s ? <div className="s">{s}</div> : null}
      {p != null ? <Bar p={p} /> : null}
    </div>
  );
}

/** หัวหน้า: เส้นทาง ชื่อหน้า คำอธิบาย ปุ่มด้านขวา */
export function Top({ crumb, title, sub, acts }: { crumb?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; acts?: React.ReactNode }) {
  return (
    <div className="top">
      <div>
        {crumb ? <div className="crumb">{crumb}</div> : null}
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {acts ? <div className="acts">{acts}</div> : null}
    </div>
  );
}

/** กล่องโต้ตอบ: หัว (ชื่อ + ปิด) เนื้อหา ท้าย */
export function Dialog({ title, onClose, onBackdrop, foot, children, wide }: { title: React.ReactNode; onClose: () => void; onBackdrop?: () => void; foot?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="dlg" onMouseDown={(e) => { if (e.target === e.currentTarget) (onBackdrop ?? onClose)(); }}>
      <div className="box" style={wide ? undefined : { width: "min(720px,100%)" }}>
        <div className="dh"><h2>{title}</h2><button className="x" type="button" onClick={onClose}>✕</button></div>
        <div className="db">{children}</div>
        {foot ? <div className="df">{foot}</div> : null}
      </div>
    </div>
  );
}

/** ข้อความแจ้งสั้น ๆ ด้านล่างจอ */
export function toast(msg: string, bad = false) {
  window.dispatchEvent(new CustomEvent("gc-toast", { detail: { msg, bad } }));
}
export function Toaster() {
  const [t, setT] = useState<{ msg: string; bad: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { msg: string; bad: boolean };
      setT(d);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setT(null), d.bad ? 6000 : 3200);
    };
    window.addEventListener("gc-toast", on);
    return () => window.removeEventListener("gc-toast", on);
  }, []);
  if (!t) return null;
  return <div className="ax"><div className={"toast" + (t.bad ? " bad" : "")} role="status">{t.msg}</div></div>;
}

/** แผนที่ Google: ลิงก์ที่มีเส้นประใต้ + หมุด */
export function MapA({ url, children }: { url?: string | null; children: React.ReactNode }) {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return <>{children}</>;
  return (
    <a className="maplnk" href={u} target="_blank" rel="noopener noreferrer" title="เปิดใน Google Maps" onClick={(e) => e.stopPropagation()}>
      {children}
      <svg viewBox="0 0 24 24" className="pin"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
    </a>
  );
}
