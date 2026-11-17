"use client";

import Link from "next/link";
import { Suspense, use } from "react";
import { usePathname } from "next/navigation";
import type { Badges } from "@/lib/badges";

const ICO: Record<string, string> = {
  dash: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  work: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/>',
  daily: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  crew: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/>',
  pos: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  docs: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  roads: '<path d="M8 3L4 21M16 3l4 18M12 4v3M12 10v3M12 16v3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
};

type Item = { k: string; href: string; label: string; match?: string; show?: keyof NavCan; badge?: keyof Badges } | { group: string; show?: keyof NavCan };
export type NavCan = { docs: boolean; crew: boolean };

const NAV: Item[] = [
  { k: "dash", href: "/", label: "หน้าหลัก" },
  { group: "หน้างาน" },
  { k: "work", href: "/rounds", label: "งาน", match: "/rounds|/orders" },
  { k: "daily", href: "/daily", label: "บันทึกรายวัน", match: "/daily" },
  { k: "crew", href: "/crew", label: "คนงานและค่าแรง", match: "/crew", show: "crew", badge: "crew" },
  { group: "สำนักงาน", show: "docs" },
  { k: "pos", href: "/pos", label: "ใบสั่งจ้าง", match: "/pos", show: "docs", badge: "pos" },
  { k: "docs", href: "/docs", label: "เอกสาร", match: "/docs", show: "docs", badge: "docs" },
  { group: "ข้อมูลหลัก" },
  { k: "roads", href: "/roads", label: "สายทาง", match: "/roads" },
  { k: "settings", href: "/settings/company", label: "ตั้งค่า", match: "/settings" },
];

const Icon = ({ k }: { k: string }) => <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: ICO[k] }} />;

/** ตัวเลขค้างข้างเมนู (โหลดตามมาทีหลัง ไม่ให้หน้าช้า) */
function Badge({ p, k }: { p: Promise<Badges>; k: keyof Badges }) {
  const v = use(p)[k];
  if (!v) return null;
  return <span className="bd">{k === "crew" ? "รอจ่าย" : k === "pos" ? `${v} ค้าง` : String(v)}</span>;
}

/** แถบเมนูซ้าย แบบเดียวกับระบบบน claude.ai */
export function Sidebar({ can, company, footer, badges }: { can: NavCan; company: string; footer: React.ReactNode; badges: Promise<Badges> }) {
  const path = usePathname();
  const initial = (company || "ณ").replace(/^บริษัท\s*/, "").slice(0, 1);
  return (
    <nav className="sb">
      <div className="brand"><i>{initial}</i><div><b>งานตัดหญ้า</b><small>{company}</small></div></div>
      {NAV.filter((it) => !it.show || can[it.show]).map((it) => {
        if ("group" in it) return <div key={it.group} className="grp">{it.group}</div>;
        const on = it.match ? it.match.split("|").some((m) => path.startsWith(m)) : path === it.href;
        return (
          <Link key={it.k} href={it.href} className={"mi" + (on ? " on" : "")}><Icon k={it.k} /><span>{it.label}</span>{it.badge ? <Suspense fallback={null}><Badge p={badges} k={it.badge} /></Suspense> : null}</Link>
        );
      })}
      <div className="sp" />
      <div className="me">{footer}</div>
      <form action="/auth/signout" method="post"><button className="mi" type="submit"><Icon k="out" /><span>ออกจากระบบ</span></button></form>
    </nav>
  );
}

export function SettingsTabs({ owner = false }: { owner?: boolean }) {
  const path = usePathname();
  const tabs = [
    ["/settings/company", "บริษัทและหัวกระดาษ"],
    ["/settings/agencies", "แขวงและหมวด"],
    ["/settings/members", "สมาชิก"],
    ...(owner ? [["/settings/import", "ย้ายข้อมูล"]] : []),
  ];
  return (
    <div className="tabs">
      {tabs.map(([h, t]) => (
        <Link key={h} href={h} className={path === h ? "on" : ""}>{t}</Link>
      ))}
    </div>
  );
}
