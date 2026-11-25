import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { canCreateCompany, NO_CREATE_MSG } from "@/lib/data/company";
import { createCompany } from "./actions";

export const metadata = { title: "สร้างบริษัท · งานตัดหญ้า" };

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ msg?: string; add?: string }> }) {
  const { msg, add } = await searchParams;
  const ctx = await getContext();
  if (ctx.memberships.length && !add) redirect("/");
  if (!(await canCreateCompany(ctx.userId))) {
    return (
      <main className="auth">
        <div className="auth-card">
          <h1 className="serif">สร้างบริษัทไม่ได้</h1>
          <p className="alert">{NO_CREATE_MSG}</p>
          {ctx.memberships.length ? <p><Link href="/">← กลับไปที่บริษัท {ctx.active?.company.name}</Link></p>
            : <p className="muted">มีคำเชิญเข้าบริษัทรออยู่ ออกจากระบบแล้วเข้าสู่ระบบใหม่ ระบบจะพาเข้าบริษัทนั้นเอง</p>}
          <p className="small muted" style={{ marginTop: 18 }}>เข้าสู่ระบบอยู่ในชื่อ {ctx.email}</p>
          <form action="/auth/signout" method="post"><button className="link" type="submit">ออกจากระบบ</button></form>
        </div>
      </main>
    );
  }
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="eyebrow">Step 1</div>
        <h1 className="serif">สร้างบริษัทของคุณ</h1>
        <p className="muted">ชื่อนี้จะขึ้นบนหัวกระดาษเอกสารทุกฉบับ แก้ไขภายหลังได้ ถ้าได้รับเชิญจากบริษัทอื่น ให้เข้าสู่ระบบด้วยอีเมลที่ถูกเชิญ ระบบจะพาเข้าบริษัทนั้นเอง</p>
        {msg && <p className="alert">{msg}</p>}
        <form action={createCompany} className="stack">
          <label>ชื่อบริษัท<input name="name" required placeholder="เช่น บริษัท ตัวอย่าง จำกัด" /></label>
          <button className="btn dk" type="submit">สร้างบริษัท</button>
        </form>
        <p className="small muted" style={{ marginTop: 18 }}>เข้าสู่ระบบอยู่ในชื่อ {ctx.email}</p>
        <form action="/auth/signout" method="post"><button className="link" type="submit">ออกจากระบบ</button></form>
      </div>
    </main>
  );
}
