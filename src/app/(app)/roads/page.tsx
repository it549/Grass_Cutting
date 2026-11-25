import { requireCompany } from "@/lib/context";
import { aiConfigured } from "@/lib/ai-extract";
import { loadWorld } from "@/lib/world";
import { RoadsView } from "./RoadsView";

export const metadata = { title: "ทะเบียนสายทาง" };

export default async function RoadsPage({ searchParams }: { searchParams: Promise<{ ag?: string; h?: string; g?: string }> }) {
  const sp = await searchParams;
  const { perm } = await requireCompany();
  const W = await loadWorld();
  return (
    <RoadsView
      W={W}
      can={{ edit: perm.roads, len: false, prices: perm.prices }}
      canRead={aiConfigured()}
      init={{ ag: sp.ag, h: sp.h, sel: sp.g }}
    />
  );
}
