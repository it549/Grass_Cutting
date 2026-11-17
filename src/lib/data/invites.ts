import "server-only";
import { sql } from "@/lib/db/sql";

// พอร์ตจาก public.accept_invites() — เดิมใช้ auth.uid()/auth.jwt()->>'email' ตอนนี้รับมาตรงๆ
export async function acceptInvites(userId: string, email: string) {
  return sql.begin(async (tx) => {
    const invites = await tx<{ company_id: string; roles: string[]; scope: string[] }[]>`
      delete from invites where email = ${email.toLowerCase()} returning company_id, roles, scope
    `;
    let n = 0;
    for (const inv of invites) {
      const res = await tx`
        insert into company_members (company_id, user_id, roles, scope)
        values (${inv.company_id}, ${userId}, ${inv.roles}, ${inv.scope})
        on conflict (company_id, user_id) do nothing
      `;
      n += res.count;
    }
    return n;
  });
}
