import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { joinInfo, requestJoin, validCode } from "@/lib/data/join";

export const metadata = { title: "ลิงก์ชวนเข้าบริษัท · งานตัดหญ้า" };

// เปิดลิงก์ชวน: ยังไม่เข้าสู่ระบบ = ให้สมัคร/เข้าสู่ระบบก่อน · เข้าแล้ว = ส่งคำขอเข้าร่วม (ซ้ำได้ ไม่สร้างคำขอซ้อน)
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const name = validCode(code) ? await joinInfo(code) : null;
  const session = await getSession();
  let err = "";
  let isMember = false;
  if (name && session) {
    try {
      const r = await requestJoin(session.userId, session.email, code);
      isMember = r?.status === "member";
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
  }
  if (isMember) redirect("/");
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="eyebrow">ลิงก์ชวนเข้าบริษัท</div>
        {!name ? (
          <>
            <h1 className="serif">ลิงก์นี้ใช้ไม่ได้แล้ว</h1>
            <p className="muted">เจ้าของบริษัทอาจสร้างลิงก์ใหม่หรือปิดลิงก์ไปแล้ว ขอลิงก์ล่าสุดจากเจ้าของบริษัท</p>
            <Link className="btn" href="/login">ไปหน้าเข้าสู่ระบบ</Link>
          </>
        ) : !session ? (
          <>
            <h1 className="serif">{name}</h1>
            <p className="muted">สมัครใช้งานหรือเข้าสู่ระบบก่อน แล้วระบบจะส่งคำขอเข้าร่วมให้เจ้าของบริษัทอนุมัติ</p>
            <div className="stack">
              <Link className="btn dk" href={`/login?mode=signup&join=${code}`}>สมัครใช้งาน</Link>
              <Link className="btn" href={`/login?join=${code}`}>มีบัญชีแล้ว เข้าสู่ระบบ</Link>
            </div>
          </>
        ) : err ? (
          <>
            <h1 className="serif">{name}</h1>
            <p className="alert bad">{err}</p>
          </>
        ) : (
          <>
            <h1 className="serif">ส่งคำขอแล้ว</h1>
            <p className="muted">รอเจ้าของ <b>{name}</b> อนุมัติ ระหว่างนี้ยังเห็นข้อมูลบริษัทไม่ได้ เมื่ออนุมัติแล้วกดปุ่มด้านล่างเพื่อเข้าใช้งาน</p>
            <Link className="btn dk" href="/" prefetch={false}>ตรวจอีกครั้ง</Link>
          </>
        )}
        {session && (
          <>
            <p className="small muted" style={{ marginTop: 18 }}>เข้าสู่ระบบอยู่ในชื่อ {session.email}</p>
            <form action="/auth/signout" method="post"><input type="hidden" name="join" value={code} /><button className="link" type="submit">ออกจากระบบ (ใช้บัญชีอื่น)</button></form>
          </>
        )}
      </div>
    </main>
  );
}
