import { logoUrl, requireCompany } from "@/lib/context";
import { Flash } from "@/components/Flash";
import { saveCompany } from "./actions";

export const metadata = { title: "ตั้งค่าบริษัท · งานตัดหญ้า" };

export default async function CompanySettings({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const { company: c, perm } = await requireCompany();
  const logo = await logoUrl(c.logo_path);
  const ro = !perm.orders;
  const F = (name: keyof typeof c, label: string, opts: { wide?: boolean; area?: boolean; ph?: string } = {}) => (
    <label className={opts.wide ? "wide" : ""}>
      {label}
      {opts.area ? (
        <textarea name={name} defaultValue={(c[name] as string) ?? ""} rows={2} disabled={ro} placeholder={opts.ph} />
      ) : (
        <input name={name} defaultValue={(c[name] as string) ?? ""} disabled={ro} placeholder={opts.ph} />
      )}
    </label>
  );

  return (
    <>
      <Flash {...sp} />
      <div className="two">
        <form action={saveCompany} className="card">
          <div className="serif h3">ข้อมูลบริษัท</div>
          {ro && <p className="small muted">ดูได้อย่างเดียว แก้ได้เฉพาะธุรการหรือเจ้าของ</p>}
          <div className="grid2">
            {F("name", "ชื่อบริษัท (ไทย)", { wide: true })}
            {F("name_en", "ชื่อบริษัท (อังกฤษ)", { wide: true })}
            {F("tax_id", "เลขประจำตัวผู้เสียภาษี", { ph: "13 หลัก" })}
            {F("branch", "สาขา", { ph: "สำนักงานใหญ่" })}
            {F("address", "ที่อยู่", { wide: true, area: true })}
            {F("phone", "โทรศัพท์")}
            {F("email", "อีเมล")}
          </div>
          <div className="serif h3" style={{ marginTop: 18 }}>ผู้ลงนามในเอกสาร</div>
          <div className="grid2">
            {F("signer_name", "ชื่อผู้ลงนาม", { ph: "นาย ..." })}
            {F("signer_title", "ตำแหน่ง", { ph: "กรรมการผู้จัดการ" })}
          </div>
          <div className="serif h3" style={{ marginTop: 18 }}>บัญชีรับเงิน (แสดงในใบแจ้งหนี้)</div>
          <div className="grid2">
            {F("bank_name", "ธนาคาร")}
            {F("bank_account_no", "เลขที่บัญชี")}
            {F("bank_account_name", "ชื่อบัญชี", { wide: true })}
          </div>
          <div className="serif h3" style={{ marginTop: 18 }}>โลโก้</div>
          <div className="logo-row">
            {logo ? <img src={logo} alt="โลโก้" className="logo-prev" /> : <div className="logo-prev empty">ไม่มีโลโก้</div>}
            {!ro && (
              <div className="stack">
                <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" />
                {logo && <label className="chk"><input type="checkbox" name="remove_logo" value="1" /> ลบโลโก้</label>}
                <span className="small muted">PNG หรือ JPG ไม่เกิน 2MB พื้นหลังโปร่งใสจะสวยที่สุด</span>
              </div>
            )}
          </div>
          {!ro && <div className="acts" style={{ marginTop: 18 }}><button className="btn dk" type="submit">บันทึก</button></div>}
        </form>

        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>ตัวอย่างหัวกระดาษ</div>
          <div className="paper">
            <div className="lh">
              {logo ? <img src={logo} alt="" /> : <div className="lh-ph">LOGO</div>}
              <div>
                <b>{c.name}</b>
                {c.name_en && <div className="en">{c.name_en}</div>}
                <div>{c.address || "ที่อยู่บริษัท"}</div>
                <div>
                  {[c.phone && `โทร ${c.phone}`, c.email].filter(Boolean).join(" · ") || "โทร · อีเมล"}
                </div>
                <div>เลขประจำตัวผู้เสียภาษี {c.tax_id || "-"} {c.branch ? `(${c.branch})` : ""}</div>
              </div>
            </div>
            <div className="lh-title">ใบเสนอราคา</div>
            <div className="lh-lines"><i /><i /><i style={{ width: "60%" }} /></div>
            <div className="lh-sign">
              <div>ลงชื่อ ....................................</div>
              <div>({c.signer_name || "ชื่อผู้ลงนาม"})</div>
              <div>{c.signer_title || "ตำแหน่ง"}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
