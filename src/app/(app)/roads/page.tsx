import { requireCompany } from "@/lib/context";
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
      can={{ edit: perm.orders, len: perm.work, prices: perm.prices }}
      canRead={Boolean(process.env.ANTHROPIC_API_KEY)}
      init={{ ag: sp.ag, h: sp.h, sel: sp.g }}
    />
  );
}
