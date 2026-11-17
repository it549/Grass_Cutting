import Link from "next/link";
import { requireCompany } from "@/lib/context";
import { roleText } from "@/lib/types";
import { Sidebar } from "@/components/Nav";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { Toaster } from "@/components/ui";
import { navBadges } from "@/lib/badges";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company, roles, perm, memberships, email } = await requireCompany();
  return (
    <div id="app">
      <Sidebar
        badges={navBadges()}
        can={{ docs: perm.docs, crew: perm.wages || perm.daily || perm.fuel }}
        company={company.name}
        footer={
          <>
            <CompanySwitcher current={company.id} options={memberships.map((m) => ({ id: m.company.id, name: m.company.name }))} />
            <div className="small muted" style={{ wordBreak: "break-all" }}>{email}</div>
            <div className="small muted">{roleText(roles)}</div>
            <Link className="small" href="/onboarding?add=1">+ สร้างบริษัทใหม่</Link>
          </>
        }
      />
      <main className="main">{children}</main>
      <Toaster />
    </div>
  );
}
