import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/context";
import { loadDocs, loadWorld } from "@/lib/world";
import { todayBkk } from "@/lib/calc";
import { PosView } from "./PosView";

export const metadata = { title: "ใบสั่งจ้าง · งานตัดหญ้า" };

export default async function PosPage({ searchParams }: { searchParams: Promise<{ ag?: string }> }) {
  const sp = await searchParams;
  const { perm } = await requireCompany();
  if (!perm.docs) redirect("/rounds");
  const [W, docs] = await Promise.all([loadWorld(), loadDocs()]);
  const ag = W.agencies.find((a) => a.id === sp.ag)?.id ?? W.agencies[0]?.id ?? "";
  return <PosView key={ag} W={W} ag={ag} docs={docs} today={todayBkk()} can={{ orders: perm.orders, prices: perm.prices }} />;
}
