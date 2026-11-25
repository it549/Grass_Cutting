import { headers } from "next/headers";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { ROLE_HELP, ROLE_LABEL, ROLES, roleText, type Role } from "@/lib/types";
import { loadAgencies } from "@/lib/orders";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyLink } from "@/components/CopyLink";
import { originOf } from "@/lib/origin";
import { thaiDate } from "@/lib/calc";
import { getJoinCode, listJoinRequests } from "@/lib/data/join";
import { approveJoin, cancelInvite, closeJoin, invite, rejectJoin, removeMember, resetJoin, setMember } from "./actions";

export const metadata = { title: "สมาชิก · งานตัดหญ้า" };

type Ag = { id: string; name: string; short_name: string | null; hmds: string[] };

/** ติ๊กบทบาท (หลายอย่างได้) */
function RoleBoxes({ value, owner }: { value: Role[]; owner: boolean }) {
  return (
    <div className="rolebox">
      {ROLES.filter((r) => owner || r !== "owner").map((r) => (
        <label key={r} className="chk" title={ROLE_HELP[r]}>
          <input type="checkbox" name="roles" value={r} defaultChecked={value.includes(r)} /> {ROLE_LABEL[r]}
        </label>
      ))}
    </div>
  );
}

/** ขอบเขตแขวง/หมวด ใช้กับคนที่มีแค่หัวหน้าชุด/ดูอย่างเดียว */
function ScopeBoxes({ value, ags }: { value: string[]; ags: Ag[] }) {
  if (!ags.length) return null;
  return (
    <details className="scopebox" open={value.length > 0}>
      <summary className="small">ขอบเขตงาน: {value.length ? scopeText(value, ags) : "ทุกแขวงทุกหมวด"}</summary>
      <p className="small muted" style={{ margin: "4px 0" }}>ใช้กับหัวหน้าชุดและดูอย่างเดียวเท่านั้น ไม่ติ๊กเลย = เห็นทุกแขวงทุกหมวด</p>
      {ags.map((a) => (
        <div key={a.id} className="scopeag">
          <label className="chk"><input type="checkbox" name="scope" value={a.id} defaultChecked={value.includes(a.id)} /> <b>{a.short_name || a.name}</b> ทั้งแขวง</label>
          {a.hmds.map((h) => (
            <label key={h} className="chk small"><input type="checkbox" name="scope" value={`${a.id}|${h}`} defaultChecked={value.includes(`${a.id}|${h}`)} /> หมวด{h}</label>
          ))}
        </div>
      ))}
    </details>
  );
}

function scopeText(scope: string[], ags: Ag[]) {
  return scope
    .map((s) => {
      const [id, h] = s.split("|");
      const a = ags.find((x) => x.id === id);
      const n = a ? a.short_name || a.name : "แขวงที่ลบไปแล้ว";
      return h ? `${n} หมวด${h}` : `${n} ทั้งแขวง`;
    })
    .join(", ");
}

const onlyField = (rs: Role[]) => !rs.some((r) => r === "owner" || r === "office" || r === "account");

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const { company, perm, userId } = await requireCompany();
  const manage = perm.members;
  const [mem, ags] = await Promise.all([
    sql<{ user_id: string; roles: Role[]; scope: string[]; created_at: string }[]>`
      select user_id, roles, scope, created_at from company_members where company_id = ${company.id} order by created_at
    `,
    loadAgencies(),
  ]);
  const ids = mem.map((m) => m.user_id);
  const profs = ids.length
    ? await sql<{ id: string; email: string; full_name: string | null }[]>`select id, email, full_name from users where id in ${sql(ids)}`
    : [];
  const P = new Map(profs.map((p) => [p.id, p]));
  const invites = manage
    ? await sql<{ id: string; email: string; roles: Role[]; scope: string[]; created_at: string }[]>`
        select id, email, roles, scope, created_at from invites where company_id = ${company.id} order by created_at
      `
    : [];

  const [code, pend] = manage ? await Promise.all([getJoinCode(company.id), listJoinRequests(company.id)]) : [null, []];
  const origin = originOf(await headers());

  return (
    <>
      <Flash {...sp} />
      {pend.length > 0 && (
        <div className="card pend" style={{ marginBottom: 14 }}>
          <div className="serif h3">รออนุมัติเข้าบริษัท ({pend.length})</div>
          <p className="small muted" style={{ marginTop: 0 }}>คนเหล่านี้กดลิงก์ชวนแล้วสมัครเข้ามา ยังไม่เห็นข้อมูลบริษัทจนกว่าคุณจะเลือกบทบาทแล้วกดอนุมัติ</p>
          {pend.map((r) => (
            <div key={r.id} className="joinreq">
              <div>
                <b>{r.full_name || r.email}</b>
                <div className="small muted">{r.email}</div>
                <div className="small muted">ขอเมื่อ {thaiDate(String(r.created_at))}</div>
              </div>
              <div>
                <form action={approveJoin}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="who" value={r.full_name || r.email} />
                  <RoleBoxes value={["field"]} owner={false} />
                  <ScopeBoxes value={[]} ags={ags} />
                  <div className="acts" style={{ marginTop: 8 }}><button className="btn sm dk" type="submit">อนุมัติ</button></div>
                </form>
                <form action={rejectJoin} style={{ marginTop: 6 }}>
                  <input type="hidden" name="id" value={r.id} />
                  <ConfirmButton className="link bad" message={`ปฏิเสธคำขอของ ${r.email}?`}>ปฏิเสธ</ConfirmButton>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="two">
        <div className="card">
          <div className="serif h3">สมาชิกของ {company.name}</div>
          <div className="tscroll"><table className="tbl">
            <thead><tr><th style={{ width: "34%" }}>ชื่อ / อีเมล</th><th>บทบาท</th><th style={{ width: 70 }}></th></tr></thead>
            <tbody>
              {(mem ?? []).map((m) => {
                const p = P.get(m.user_id);
                const rs = (m.roles ?? []) as Role[];
                const sc = (m.scope ?? []) as string[];
                const me = m.user_id === userId;
                return (
                  <tr key={m.user_id}>
                    <td><b>{p?.full_name || p?.email || "ผู้ใช้"}</b>{me && <span className="small muted"> (คุณ)</span>}<div className="small muted">{p?.email}</div></td>
                    <td>
                      {manage ? (
                        <form action={setMember}>
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <RoleBoxes value={rs} owner />
                          {onlyField(rs) ? <ScopeBoxes value={sc} ags={ags} /> : <div className="small muted" style={{ marginTop: 4 }}>เห็นทุกแขวงทุกหมวด (จำกัดขอบเขตได้เฉพาะหัวหน้าชุด/ดูอย่างเดียว)</div>}
                          <button className="btn sm" type="submit" style={{ marginTop: 6 }}>บันทึก</button>
                        </form>
                      ) : (
                        <>
                          {roleText(rs)}
                          {onlyField(rs) && sc.length > 0 && <div className="small muted">เฉพาะ {scopeText(sc, ags)}</div>}
                        </>
                      )}
                    </td>
                    <td>
                      {(me || manage) && (
                        <form action={removeMember}>
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <ConfirmButton className="link bad" message={me ? "ออกจากบริษัทนี้?" : `นำ ${p?.email ?? "คนนี้"} ออกจากบริษัท?`}>{me ? "ออก" : "นำออก"}</ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <div className="small muted" style={{ marginTop: 12 }}>
            {ROLES.map((r) => <div key={r} style={{ marginTop: 4 }}><b>{ROLE_LABEL[r]}</b> · {ROLE_HELP[r]}</div>)}
            <div style={{ marginTop: 8 }}>คนเดียวมีได้หลายบทบาท ระบบล็อกสิทธิ์ที่ฐานข้อมูลด้วย ไม่ใช่แค่ซ่อนปุ่ม</div>
          </div>
        </div>

        {manage && (
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="serif h3">ลิงก์ชวนเข้าบริษัท</div>
              {code ? (
                <>
                  <p className="small muted" style={{ margin: 0 }}>ส่งลิงก์นี้เข้ากลุ่ม LINE ได้เลย คนที่กดแล้วสมัครจะขึ้นในรายการรออนุมัติ และยังไม่เห็นข้อมูลจนกว่าคุณจะอนุมัติ</p>
                  <CopyLink url={`${origin}/join/${code}`} />
                  <div className="acts">
                    <form action={resetJoin}><ConfirmButton className="btn sm" message="สร้างลิงก์ใหม่? ลิงก์เดิมที่ส่งไปแล้วจะใช้ไม่ได้">สร้างลิงก์ใหม่</ConfirmButton></form>
                    <form action={closeJoin}><ConfirmButton className="link bad" message="ปิดลิงก์ชวน? ลิงก์เดิมจะใช้ไม่ได้">ปิดลิงก์</ConfirmButton></form>
                  </div>
                </>
              ) : (
                <>
                  <p className="small muted" style={{ marginTop: 0 }}>สร้างลิงก์แล้วส่งเข้ากลุ่ม LINE ให้คนงานกดสมัครเอง ไม่ต้องพิมพ์อีเมลทีละคน ทุกคนต้องรอคุณอนุมัติก่อน</p>
                  <form action={resetJoin}><button className="btn dk" type="submit">สร้างลิงก์ชวน</button></form>
                </>
              )}
            </div>
            <form action={invite} className="card">
              <div className="serif h3">เชิญด้วยอีเมล</div>
              <div className="stack">
                <label>อีเมล<input name="email" type="email" required placeholder="name@example.com" /></label>
                <div>
                  <div className="small muted" style={{ marginBottom: 4 }}>บทบาท (เลือกได้หลายอย่าง)</div>
                  <RoleBoxes value={[]} owner={false} />
                </div>
                <ScopeBoxes value={[]} ags={ags} />
                <button className="btn dk" type="submit">เชิญ</button>
              </div>
              <p className="small muted">ระบบไม่ส่งอีเมลเชิญเอง ส่งลิงก์เว็บไซต์ให้เขา แล้วให้สมัครหรือเข้าสู่ระบบด้วยอีเมลนี้ จะเข้าบริษัทนี้อัตโนมัติ · ตั้งเป็นเจ้าของได้หลังเขาเข้ามาแล้ว</p>
            </form>
            {(invites ?? []).length > 0 && (
              <div className="card" style={{ marginTop: 14 }}>
                <div className="serif h3">คำเชิญที่รอ</div>
                <p className="small muted" style={{ margin: 0 }}>ส่งลิงก์นี้ให้คนที่เชิญ แล้วสมัครด้วยอีเมลที่เชิญไว้</p>
                <CopyLink url={`${origin}/login?mode=signup&invite=1`} />
                {(invites ?? []).map((i) => (
                  <form key={i.id} action={cancelInvite} className="inv">
                    <input type="hidden" name="id" value={i.id} />
                    <span>{i.email} <span className="small muted">· {roleText((i.roles ?? []) as Role[])}{(i.scope ?? []).length ? ` · เฉพาะ ${scopeText(i.scope as string[], ags)}` : ""}</span></span>
                    <button className="link bad" type="submit">ยกเลิก</button>
                  </form>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
