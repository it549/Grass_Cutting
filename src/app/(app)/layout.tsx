import Link from "next/link";
import { requireCompany } from "@/lib/context";
import { roleText } from "@/lib/types";
import { Rail } from "@/components/Nav";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { sql } from "@/lib/db/sql";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company, roles, perm, memberships, email } = await requireCompany();
  const agencies = await sql<{ id: string; name: string; short_name: string; hmds: string[] }[]>`
    select id, name, short_name, hmds from agencies where company_id = ${company.id} order by sort, created_at
  `;
  const ords = await sql<{ agency_id: string; round_no: number }[]>`
    select agency_id, round_no from orders where company_id = ${company.id}
  `;
  const roundsOf = (aid: string) => [...new Set(ords.filter((o) => o.agency_id === aid).map((o) => o.round_no))].sort((x, y) => y - x);

  return (
    <div id="app">
      <Rail docs={perm.docs} />
      <aside className="side">
        <div className="eyebrow">Company</div>
        <h1>{company.name}</h1>
        <div className="sub">{email} · {roleText(roles)}</div>
        <CompanySwitcher current={company.id} options={memberships.map((m) => ({ id: m.company.id, name: m.company.name }))} />
        <div className="side-h">แขวงที่รับงาน</div>
        {agencies.length === 0 && perm.orders && (
          <p className="small muted">ยังไม่มีแขวง <Link href="/settings/agencies">เพิ่มแขวง</Link></p>
        )}
        {agencies.map((a) => (
          <div key={a.id} className="gv">
            <b>{a.name}</b>
            <small>{a.hmds.length ? `${a.hmds.length} หมวด · ${a.hmds.join(" · ")}` : "ยังไม่ได้ใส่หมวด"}</small>
            <div className="rlinks">
              {roundsOf(a.id).slice(0, 8).map((n) => (
                <Link key={n} href={`/rounds/${a.id}/${n}`}>งวดที่ {n}</Link>
              ))}
            </div>
          </div>
        ))}
        <p className="small muted" style={{ marginTop: 16 }}>
          <Link href="/onboarding?add=1">+ สร้างบริษัทใหม่</Link>
        </p>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
