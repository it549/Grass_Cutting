import { requireCompany } from "@/lib/context";
import { loadWorld } from "@/lib/world";
import { currentRound, roundKeys, rkSame, workIndex, type RoundKey } from "@/lib/model";
import { WorkView } from "./WorkView";

export const metadata = { title: "งาน · งานตัดหญ้า" };

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ ag?: string; fy?: string; no?: string; h?: string; o?: string; new?: string }> }) {
  const sp = await searchParams;
  const { perm } = await requireCompany();
  const W = await loadWorld();
  const ag = sp.ag && W.agencies.some((a) => a.id === sp.ag) ? sp.ag : "";
  const want: RoundKey | null = ag && sp.fy && sp.no ? { ag, fy: Number(sp.fy), no: Number(sp.no) } : null;
  const k = (want && roundKeys(W, ag).find((x) => rkSame(x, want))) || currentRound(W, workIndex(W.days), ag || undefined);
  return (
    <WorkView
      key={k ? `${k.ag}~${k.fy}~${k.no}` : "none"}
      W={W}
      k={k}
      agSel={ag}
      focus={{ h: sp.h ?? null, o: sp.o ?? null }}
      openNew={sp.new === "1"}
      can={{ orders: perm.orders, roads: perm.roads, prices: perm.prices, docs: perm.docs, daily: perm.daily }}
    />
  );
}
