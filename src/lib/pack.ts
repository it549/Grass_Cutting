import "server-only";
import { requireCompany } from "@/lib/context";
import { coHead } from "@/lib/docs";
import { loadAgencies, loadOrders, loadPhotos, signUrls } from "@/lib/orders";
import { loadWorld } from "@/lib/world";
import { rInfo, workIndex } from "@/lib/model";
import type { PackCompany, PackOrder } from "@/lib/print/pages";

export type Pack = { company: PackCompany; orders: PackOrder[]; urls: Record<string, string> };

/** ข้อมูลสำหรับพิมพ์รายงานรูป/ใบสรุปงวด ของใบสั่งจ้างที่เลือก (พร้อม URL รูปชั่วคราว) */
export async function buildPack(orderIds: string[], onlyRoute?: string): Promise<Pack> {
  const { company } = await requireCompany();
  const [agencies, all, W] = await Promise.all([loadAgencies(), loadOrders(), loadWorld()]);
  const wi = workIndex(W.days);
  const orders = all.filter((o) => orderIds.includes(o.id));
  const photos = await loadPhotos({ orderIds: orders.map((o) => o.id) });
  const urls = await signUrls([...photos.map((p) => p.path), company.logo_path ?? ""]);
  const multi = agencies.length > 1;
  return {
    urls: company.logo_path && urls[company.logo_path] ? { [company.logo_path]: urls[company.logo_path] } : {},
    company: { head: coHead(company), signer: company.signer_name ?? "", name: company.name },
    orders: orders.map((o) => {
      const A = agencies.find((a) => a.id === o.agency_id);
      return {
        id: o.id,
        label: `${multi && A ? (A.short_name || A.name) + " · " : ""}งวดที่ ${o.round_no}${o.hmd ? " · หมวด" + o.hmd : ""}`,
        round_no: o.round_no, hmd: o.hmd, po_no: o.po_no, po_date: o.po_date, proj_no: o.proj_no, due_date: o.due_date, vat_incl: o.vat_incl,
        agencyName: A?.name ?? "", agencyAddr: A?.address ?? "",
        routes: o.routes
          .filter((r) => !onlyRoute || r.id === onlyRoute)
          .map((r) => {
            const ps = photos.filter((p) => p.route_id === r.id);
            // สถานะ/วันที่ตามบันทึกรายวัน (แบบเดียวกับหน้างาน)
            const wr = W.orders.find((x) => x.id === o.id)?.routes.find((x) => x.id === r.id);
            const x = wr ? rInfo(W, wi, wr) : null;
            return {
              id: r.id, code: r.code, descr: r.descr, area: r.area, rate: r.rate, in_po: r.in_po !== false,
              s: x?.s ?? "todo", doneDate: x?.finDate ?? "", startDate: x?.first ?? "",
              L: x?.L ?? 0, lrNeed: x?.ph?.lrNeed ?? false,
              slotUrl: Object.fromEntries(ps.filter((p) => p.slot && urls[p.path]).map((p) => [p.slot as string, urls[p.path]])),
              photos: ps.filter((p) => urls[p.path] && (p.kind === "b" || p.kind === "a")).map((p) => ({ url: urls[p.path], kind: p.kind, date: p.taken_date, time: p.taken_time, caption: p.caption })),
            };
          }),
      };
    }),
  };
}
