"use client";

import { useState } from "react";

/** ช่องลิงก์อ่านอย่างเดียว + ปุ่มคัดลอก */
export function CopyLink({ url }: { url: string }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch { return; }
    setOk(true);
    setTimeout(() => setOk(false), 2000);
  };
  return (
    <div className="copyl">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="ลิงก์ชวน" />
      <button className="btn sm dk" type="button" onClick={copy}>{ok ? "คัดลอกแล้ว ✓" : "คัดลอก"}</button>
    </div>
  );
}
