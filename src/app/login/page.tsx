import Link from "next/link";
import { signIn, signUp } from "./actions";
import { Logo } from "@/components/Logo";
import { joinInfo, signupAllowed, validCode } from "@/lib/data/join";

export const metadata = { title: "เข้าสู่ระบบ · งานตัดหญ้า" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string; msg?: string; join?: string; invite?: string }> }) {
  const { mode, msg, join: j, invite: inv } = await searchParams;
  const join = j && validCode(j) ? j : "";
  const invite = !join && inv === "1";
  const q = join ? `&join=${join}` : invite ? "&invite=1" : "";
  const company = join ? await joinInfo(join) : null;
  // ปุ่มสมัครมีเฉพาะ: ระบบใหม่ยังไม่มีบริษัท (คนแรกเป็นเจ้าของ) / มาจากลิงก์ชวน / ลิงก์คำเชิญ
  const firstRun = await signupAllowed("", "");
  const canSignup = Boolean(company) || invite || firstRun;
  const signup = mode === "signup" && canSignup;
  return (
    <main className="auth">
      <div className="auth-card">
        <Logo size={44} className="mono" />
        <div className="eyebrow">Grass Works</div>
        <h1 className="serif">งานตัดหญ้า</h1>
        <p className="muted">{signup ? "สมัครใช้งานด้วยอีเมลของคุณ" : "เข้าสู่ระบบเพื่อจัดการงวดงาน รูปภาพ และเอกสาร"}</p>
        {company && <p className="alert">ลิงก์ชวนเข้า <b>{company}</b> · {signup ? "สมัคร" : "เข้าสู่ระบบ"}แล้ว ระบบจะส่งคำขอให้เจ้าของบริษัทอนุมัติ</p>}
        {invite && signup && <p className="alert">สมัครด้วยอีเมลที่เจ้าของบริษัทเชิญไว้ แล้วจะเข้าบริษัทให้อัตโนมัติ</p>}
        {firstRun && signup && <p className="alert">ยังไม่มีบริษัทในระบบ คนแรกที่สมัครและสร้างบริษัทจะเป็นเจ้าของ</p>}
        {mode === "signup" && !canSignup && !msg && <p className="alert">สมัครใช้งานได้เฉพาะคนที่ได้ลิงก์ชวนหรือคำเชิญจากเจ้าของบริษัท ถ้ามีบัญชีแล้วเข้าสู่ระบบได้เลย</p>}
        {msg && <p className="alert">{msg}</p>}
        <form action={signup ? signUp : signIn} className="stack">
          {join && <input type="hidden" name="join" value={join} />}
          {invite && <input type="hidden" name="invite" value="1" />}
          {signup && (
            <label>ชื่อ-นามสกุล<input name="full_name" required autoComplete="name" /></label>
          )}
          <label>อีเมล<input name="email" type="email" required autoComplete="email" /></label>
          <label>รหัสผ่าน<input name="password" type="password" required minLength={signup ? 8 : undefined} autoComplete={signup ? "new-password" : "current-password"} /></label>
          <button className="btn dk" type="submit">{signup ? "สมัครใช้งาน" : "เข้าสู่ระบบ"}</button>
        </form>
        <p className="small muted" style={{ marginTop: 18 }}>
          {signup ? <>มีบัญชีแล้ว? <Link href={`/login?mode=login${q}`}>เข้าสู่ระบบ</Link></>
            : <>ยังไม่มีบัญชี? {canSignup ? <Link href={`/login?mode=signup${q}`}>สมัครใช้งาน</Link> : "ขอลิงก์ชวนจากเจ้าของบริษัท"}</>}
        </p>
      </div>
    </main>
  );
}
