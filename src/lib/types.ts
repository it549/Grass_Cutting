/** บทบาท (คนเดียวมีได้หลายบทบาท) ดู scripts/local_postgres_schema.sql */
export type Role = "owner" | "office" | "account" | "field" | "viewer";
export const ROLES: Role[] = ["owner", "office", "account", "field", "viewer"];

export type Company = {
  id: string;
  name: string;
  name_en: string | null;
  tax_id: string | null;
  branch: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  signer_name: string | null;
  signer_title: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  logo_path: string | null;
};

export type Agency = {
  id: string;
  company_id: string;
  name: string;
  short_name: string | null;
  address: string | null;
  phone: string | null;
  tax_id: string | null;
  director: string | null;
  hmds: string[];
  sort: number;
  /** ต้องมีแบบสำรวจซ้าย/ขวา ทุก 250 ม. ด้วย */
  photo_lr?: boolean;
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "เจ้าของ",
  office: "ธุรการ",
  account: "บัญชี",
  field: "หัวหน้าชุด",
  viewer: "ดูอย่างเดียว",
};

export const ROLE_HELP: Record<Role, string> = {
  owner: "ทำได้ทุกอย่าง ใส่สายทางและความยาวสาย (คนเดียว) เชิญและจัดการสมาชิก ย้ายข้อมูล",
  office: "ส่วนใบสั่งจ้าง: ใบสั่งจ้าง แขวง ข้อมูลบริษัท ใบเสนอราคา หนังสือส่งมอบ ใบกำกับภาษี/ใบเสร็จ ไม่เห็นค่าแรงและน้ำมัน",
  account: "ส่วนคนงานและค่าแรง: รายชื่อลูกจ้าง ค่าแรง เบิกล่วงหน้า น้ำมัน ใบสำคัญจ่าย ไม่เห็นราคาและเอกสาร",
  field: "ส่วนบันทึกรูป: บันทึกรายวัน (ไม่เห็นค่าแรง) รูปรายงาน ค่าน้ำมัน ไม่เห็นราคาและเอกสาร",
  viewer: "เห็นความคืบหน้า แก้ไม่ได้ ไม่เห็นเงิน",
};

export const roleText = (roles: Role[]) => ROLES.filter((r) => roles.includes(r)).map((r) => ROLE_LABEL[r]).join(" + ");

/** สิทธิ์ที่หน้าเว็บใช้ซ่อน/แสดง (ฐานข้อมูลตรวจซ้ำเสมอ) */
export function perms(roles: Role[], scope: string[] = []) {
  const owner = roles.includes("owner");
  const has = (...rs: Role[]) => owner || rs.some((r) => roles.includes(r));
  return {
    owner,
    members: owner, // เชิญ/แก้สมาชิก ย้ายข้อมูล
    roads: owner, // ทะเบียนสายทาง ความยาวสาย
    orders: has("office"), // สร้าง/แก้ใบสั่งจ้าง แขวง ข้อมูลบริษัท
    prices: has("office"), // เห็นราคา มูลค่า ไฟล์ใบสั่งจ้าง
    docs: has("office"), // เอกสารทุกใบ รวมออก/ยกเลิกใบกำกับภาษี
    wages: has("account"), // ค่าแรง รายชื่อลูกจ้าง ใบสำคัญจ่าย ต้นทุน
    daily: has("account", "field"), // บันทึกรายวัน
    fuel: has("account", "field"),
    work: has("office", "account", "field"), // รูป สถานะสาย
    scoped: !has("office", "account") && scope.length > 0,
  };
}
export type Perms = ReturnType<typeof perms>;
