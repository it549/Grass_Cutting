import { signIn, signUp } from "./actions";

export const metadata = { title: "เข้าสู่ระบบ · งานตัดหญ้า" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string; msg?: string }> }) {
  const { mode, msg } = await searchParams;
  const signup = mode === "signup";
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="mono"><span>ห</span></div>
        <div className="eyebrow">Grass Works</div>
        <h1 className="serif">งานตัดหญ้า</h1>
        <p className="muted">{signup ? "สมัครใช้งาน แล้วสร้างบริษัทของคุณ" : "เข้าสู่ระบบเพื่อจัดการงวดงาน รูปภาพ และเอกสาร"}</p>
        {msg && <p className="alert">{msg}</p>}
        <form action={signup ? signUp : signIn} className="stack">
          {signup && (
            <label>ชื่อ-นามสกุล<input name="full_name" required autoComplete="name" /></label>
          )}
          <label>อีเมล<input name="email" type="email" required autoComplete="email" /></label>
          <label>รหัสผ่าน<input name="password" type="password" required minLength={signup ? 8 : undefined} autoComplete={signup ? "new-password" : "current-password"} /></label>
          <button className="btn dk" type="submit">{signup ? "สมัครใช้งาน" : "เข้าสู่ระบบ"}</button>
        </form>
        <p className="small muted" style={{ marginTop: 18 }}>
          {signup ? <>มีบัญชีแล้ว? <a href="/login">เข้าสู่ระบบ</a></> : <>ยังไม่มีบัญชี? <a href="/login?mode=signup">สมัครใช้งาน</a></>}
        </p>
      </div>
    </main>
  );
}
