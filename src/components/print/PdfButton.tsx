"use client";

import { useState } from "react";
import { savePdf } from "@/lib/print/pdf";

/** ปุ่มสร้าง PDF: build รับกล่องที่ซ่อนไว้แล้วคืนรายการหน้า, prepare (ถ้ามี) โหลดข้อมูลก่อน */
export function PdfButton<T>({ label, filename, prepare, build, className = "btn dk" }: {
  label: string;
  filename: string;
  prepare?: () => Promise<T>;
  build: (host: HTMLElement, data: T) => HTMLElement[];
  className?: string;
}) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  async function go() {
    setErr("");
    setBusy("กำลังเตรียมข้อมูล…");
    try {
      const data = prepare ? await prepare() : (undefined as T);
      await savePdf((h) => build(h, data), filename, setBusy);
    } catch (e) {
      setErr("สร้าง PDF ไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy("");
    }
  }
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button type="button" className={className} disabled={Boolean(busy)} onClick={go}>{busy || label}</button>
      {err && <span className="small" style={{ color: "var(--bad)" }}>{err}</span>}
    </span>
  );
}
