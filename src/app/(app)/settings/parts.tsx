import Link from "next/link";

/** ป้ายช่องที่เอกสารต้องใช้แต่ยังว่าง */
export const Miss = () => <span className="miss">ยังไม่กรอก</span>;

/** ค่าในหน้าสรุป: ว่าง + จำเป็น = ป้ายยังไม่กรอก, ว่าง + ไม่จำเป็น = – */
export function Val({ v, need }: { v?: string | null; need?: boolean }) {
  const t = (v ?? "").trim();
  if (t) return <>{t}</>;
  return need ? <Miss /> : <span className="muted">–</span>;
}

/** หัวการ์ดหน้าสรุป + ปุ่มด้านขวา (เช่น แก้ไข) */
export function CardHead({ title, href, label = "แก้ไข" }: { title: React.ReactNode; href?: string | null; label?: string }) {
  return (
    <div className="sethd">
      <div className="serif h3">{title}</div>
      {href ? <Link className="btn sm" href={href}>{label}</Link> : null}
    </div>
  );
}
