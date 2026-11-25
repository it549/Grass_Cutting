import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { loadDocs, loadWorld } from "@/lib/world";
import { currentRound, roundKeys, rkSame, workIndex, type RoundKey } from "@/lib/model";
import { DocsView } from "./DocsView";

export const metadata = { title: "เอกสาร · งานตัดหญ้า" };

export default async function DocsPage({ searchParams }: { searchParams: Promise<{ ag?: string; fy?: string; no?: string; tab?: string; msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const { perm } = await requireCompany();
  if (!perm.docs) redirect("/rounds");
  const [W, docs] = await Promise.all([loadWorld(), loadDocs()]);
  const ag = sp.ag && W.agencies.some((a) => a.id === sp.ag) ? sp.ag : "";
  const want: RoundKey | null = ag && sp.fy && sp.no ? { ag, fy: Number(sp.fy), no: Number(sp.no) } : null;
  const k = (want && roundKeys(W, ag).find((x) => rkSame(x, want))) || currentRound(W, workIndex(W.days), ag || undefined);
  return (
    <DocsView
      key={(k ? `${k.ag}~${k.fy}~${k.no}` : "none") + (sp.tab === "list" ? "~list" : "")}
      W={W}
      k={k}
      agSel={ag}
      docs={docs}
      tab={sp.tab === "list" ? "list" : "board"}
      flash={{ msg: sp.msg ?? null, err: sp.err ?? null }}
      can={{ orders: perm.orders, prices: perm.prices, qt: perm.docs, dl: perm.docs, rc: perm.docs }}
    />
  );
}
