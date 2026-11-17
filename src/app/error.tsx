"use client";

/** หน้าแทน error ของเซิร์ฟเวอร์: บอกสิ่งที่ควรตรวจเป็นภาษาไทย พร้อมรหัสไว้หาใน log ของเซิร์ฟเวอร์ */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="eyebrow">Error</div>
        <h1 className="serif">เปิดหน้านี้ไม่สำเร็จ</h1>
        <p className="small">ลองตรวจตามนี้</p>
        <ol className="small" style={{ lineHeight: 1.8 }}>
          <li>PostgreSQL เปิดอยู่ และ <code>DATABASE_URL</code> ในไฟล์ <code>.env</code> ถูกต้อง</li>
          <li>รัน <code>scripts/local_postgres_schema.sql</code> กับฐานข้อมูลแล้ว (รันซ้ำได้)</li>
          <li>ถ้ายังไม่หาย ดูข้อความ error ในหน้าต่างที่รันเซิร์ฟเวอร์ แล้วส่งให้ผู้ดูแล</li>
        </ol>
        {error.digest && <p className="small muted">รหัส: {error.digest}</p>}
        <button className="btn dk" onClick={() => reset()}>ลองใหม่</button>
      </div>
    </main>
  );
}
