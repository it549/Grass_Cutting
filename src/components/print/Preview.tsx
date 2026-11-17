"use client";

import { useEffect, useRef } from "react";

/** แสดงหน้ากระดาษ A4 ย่อให้พอดีความกว้าง สร้างใหม่ทุกครั้งที่ deps เปลี่ยน (หน่วงเล็กน้อย) */
export function Preview({ build, deps }: { build: (host: HTMLElement) => HTMLElement[]; deps: unknown[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      await document.fonts.ready;
      const host = box.current;
      if (!alive || !host) return;
      const w = host.clientWidth || 700, k = Math.min(1, (w - 10) / 794);
      host.innerHTML = "";
      const inner = document.createElement("div");
      inner.className = "pgwrap";
      inner.style.cssText = `width:794px;transform:scale(${k});transform-origin:top left;margin-left:${Math.max(0, (w - 794 * k) / 2)}px`;
      host.appendChild(inner);
      const pages = build(inner);
      host.style.height = pages.length * (1123 + 16) * k + 10 + "px";
    }, 200);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <div ref={box} className="pvbox" />;
}
