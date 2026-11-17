import Link from "next/link";
export const metadata = { title: "ตั้งค่าฐานข้อมูล · งานตัดหญ้า" };

/** หน้าบอกวิธีแก้เมื่อฐานข้อมูลยังไม่ตรงกับโค้ด หรือต่อ PostgreSQL ไม่ได้ (ห้ามเรียก getContext ในหน้านี้) */
export default async function SetupNeeded({ searchParams }: { searchParams: Promise<{ code?: string; e?: string }> }) {
  const { code = "", e = "" } = await searchParams;
  const schema = code === "42703" || code === "42P01" || code === "42883" || /column|relation|does not exist/i.test(e);
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="eyebrow">Setup</div>
        <h1 className="serif">{schema ? "ฐานข้อมูลยังไม่ได้อัปเดต" : "เชื่อมต่อฐานข้อมูลไม่สำเร็จ"}</h1>
        {schema ? (
          <>
            <p>โค้ดเว็บเป็นรุ่นใหม่ แต่ฐานข้อมูล PostgreSQL ยังไม่ได้รัน SQL รุ่นเดียวกัน</p>
            <ol className="small" style={{ lineHeight: 1.8 }}>
              <li>รันไฟล์ <code>scripts/local_postgres_schema.sql</code> กับฐานข้อมูลใน <code>DATABASE_URL</code> (รันซ้ำได้ ข้อมูลเดิมไม่หาย)</li>
              <li>กลับมากดปุ่มด้านล่าง</li>
            </ol>
          </>
        ) : (
          <p className="small">ตรวจว่า PostgreSQL เปิดอยู่ และค่า <code>DATABASE_URL</code> ในไฟล์ <code>.env</code> ถูกต้อง แล้วรีสตาร์ทเว็บ</p>
        )}
        {e && <p className="small muted" style={{ wordBreak: "break-word" }}>รายละเอียด: {code ? code + " · " : ""}{e}</p>}
        <Link className="btn dk" href="/">ลองใหม่</Link>
        <form action="/auth/signout" method="post" style={{ marginTop: 12 }}><button className="link" type="submit">ออกจากระบบ</button></form>
      </div>
    </main>
  );
}
