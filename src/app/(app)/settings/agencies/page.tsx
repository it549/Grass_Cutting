import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { inScopeFor } from "@/lib/data/perm-db";
import type { Agency } from "@/lib/types";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { addAgency, addSampleAgency, deleteAgency, saveAgency } from "./actions";

export const metadata = { title: "แขวงและหมวด · งานตัดหญ้า" };

function Fields({ a, ro }: { a?: Agency; ro: boolean }) {
  return (
    <div className="grid2">
      <label className="wide">ชื่อแขวง (ผู้ว่าจ้าง)<input name="name" required defaultValue={a?.name ?? ""} disabled={ro} placeholder="แขวงทางหลวงชนบท..." /></label>
      <label>ชื่อย่อ<input name="short_name" defaultValue={a?.short_name ?? ""} disabled={ro} placeholder="เช่น ชลบุรี" /></label>
      <label>โทรศัพท์<input name="phone" defaultValue={a?.phone ?? ""} disabled={ro} /></label>
      <label className="wide">ที่อยู่<textarea name="address" rows={2} defaultValue={a?.address ?? ""} disabled={ro} /></label>
      <label>เลขผู้เสียภาษี<input name="tax_id" defaultValue={a?.tax_id ?? ""} disabled={ro} /></label>
      <label>เรียน (ในหนังสือ)<input name="director" defaultValue={a?.director ?? ""} disabled={ro} placeholder="ผู้อำนวยการแขวง..." /></label>
      <label className="wide">
        หมวดในแขวงนี้ (บรรทัดละ 1 หมวด)
        <textarea name="hmds" rows={3} defaultValue={(a?.hmds ?? []).join("\n")} disabled={ro} placeholder={"ชลบุรี\nบ่อทอง\nบางละมุง"} />
        <span className="small muted">ใส่แค่ชื่อหมวด ระบบเติม &quot;หมวดบำรุงทางหลวงชนบท&quot; ให้เอง</span>
      </label>
      <label className="chk wide"><input type="checkbox" name="photo_lr" defaultChecked={Boolean(a?.photo_lr)} disabled={ro} /> ต้องมีแบบสำรวจรูปซ้าย/ขวาทาง ทุก 250 ม. ครบด้วย จึงนับว่ารูปครบ (นอกจากรูปก่อน/หลัง ทุก 500 ม.)</label>
    </div>
  );
}

export default async function AgenciesPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const { company, perm, roles, scope } = await requireCompany();
  const ro = !perm.orders;
  const rows = await sql<Agency[]>`select * from agencies where company_id = ${company.id} order by sort, created_at`;
  const list = rows.filter((a) => inScopeFor(roles, scope, a.id, null));

  return (
    <>
      <Flash {...sp} />
      <p className="muted" style={{ maxWidth: 720 }}>
        แต่ละแขวงคือผู้ว่าจ้าง 1 ราย มีหมวดของตัวเอง ใบสั่งจ้างแต่ละใบเป็นของหมวดเดียว เลขงวดนับแยกตามแขวง
      </p>
      {list.length === 0 && !ro && (
        <div className="card empty-card">
          <div className="serif" style={{ fontSize: 17 }}>ยังไม่มีแขวง</div>
          <p className="small muted">เพิ่มเองด้านล่าง หรือเริ่มจากตัวอย่างแขวงทางหลวงชนบทชลบุรี (3 หมวด)</p>
          <form action={addSampleAgency}><button className="btn sm" type="submit">ใช้ตัวอย่าง ขทช.ชลบุรี</button></form>
        </div>
      )}
      <div className="hc">
        {list.map((a) => (
          <div key={a.id} className="card">
            <form action={saveAgency}>
              <input type="hidden" name="id" value={a.id} />
              <div className="serif h3">{a.name}</div>
              <Fields a={a} ro={ro} />
              {!ro && <div className="acts" style={{ marginTop: 12 }}><button className="btn sm dk" type="submit">บันทึก</button></div>}
            </form>
            {!ro && (
              <form action={deleteAgency} style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={a.id} />
                <ConfirmButton className="link bad" message={`ลบ ${a.name}? งานที่ผูกกับแขวงนี้ในอนาคตจะไม่มีผู้ว่าจ้าง`}>ลบแขวงนี้</ConfirmButton>
              </form>
            )}
          </div>
        ))}
        {!ro && (
          <form action={addAgency} className="card dashed">
            <div className="serif h3">+ เพิ่มแขวงใหม่</div>
            <Fields ro={false} />
            <div className="acts" style={{ marginTop: 12 }}><button className="btn sm" type="submit">เพิ่มแขวง</button></div>
          </form>
        )}
      </div>
    </>
  );
}
