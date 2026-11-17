"use client";

import { getPack } from "@/app/(app)/orders/photo-actions";
import { PdfButton } from "@/components/print/PdfButton";
import { fileSafe } from "@/lib/print/fmt";
import { registerUrls, routePhotoPages, summaryPages } from "@/lib/print/pages";

type Mode = "summary" | "pack" | "route" | "photos";

/** PDF ใบสรุปงวด / ชุดส่งงวด (สรุป + รูปทุกสาย) / รายงานภาพถ่ายสายเดียว */
export function PackButton({ orderIds, mode, routeId, label, filename, className }: {
  orderIds: string[];
  mode: Mode;
  routeId?: string;
  label: string;
  filename: string;
  className?: string;
}) {
  return (
    <PdfButton
      label={label}
      className={className}
      filename={fileSafe(filename) + ".pdf"}
      prepare={() => getPack(orderIds, mode === "route" ? routeId : undefined, mode === "photos")}
      build={(host, pack) => {
        registerUrls(pack.urls);
        const out: HTMLElement[] = [];
        for (const o of pack.orders) {
          if (mode === "summary" || mode === "pack") out.push(...summaryPages(pack.company, o, host));
          if (mode !== "summary") for (const r of o.routes) if (mode === "route" || r.photos.length || Object.keys(r.slotUrl).length) out.push(...routePhotoPages(pack.company, o, r, host));
        }
        return out;
      }}
    />
  );
}
