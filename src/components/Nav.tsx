"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string | null; icon: string; label: string; match?: string; soon?: string }[] = [
  { href: "/", icon: "◈", label: "หน้าหลัก" },
  { href: "/rounds", icon: "▦", label: "งวดงาน", match: "/rounds|/orders" },
  { href: "/daily", icon: "◐", label: "รายวัน", match: "/daily" },
  { href: "/docs", icon: "❑", label: "เอกสาร", match: "/docs" },
  { href: "/settings/company", icon: "⚙", label: "ตั้งค่า", match: "/settings" },
];

export function Rail({ docs = true }: { docs?: boolean }) {
  const path = usePathname();
  return (
    <nav className="rail">
      <div className="mono"><span>ห</span></div>
      {ITEMS.filter((it) => docs || it.href !== "/docs").map((it) => {
        const on = it.href && (it.match ? it.match.split("|").some((m) => path.startsWith(m)) : path === it.href);
        return it.href ? (
          <Link key={it.label} href={it.href} className={"ri" + (on ? " on" : "")}><i>{it.icon}</i>{it.label}</Link>
        ) : (
          <span key={it.label} className="ri off" title={`จะมาใน${it.soon}`}><i>{it.icon}</i>{it.label}</span>
        );
      })}
      <div className="sp" />
      <form action="/auth/signout" method="post"><button className="ri" type="submit"><i>⎋</i>ออก</button></form>
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
