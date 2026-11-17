/** บทบาท (คนเดียวมีได้หลายบทบาท) ดู supabase/migrations/0005_roles.sql */
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
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "เจ้าของ",
  office: "ธุรการ",
  account: "บัญชี",
  field: "หัวหน้าชุด",
  viewer: "ดูอย่างเดียว",
};

export const ROLE_HELP: Record<Role, string> = {
  owner: "ทำได้ทุกอย่าง เชิญและจัดการสมาชิก ย้ายข้อมูล",
  office: "ใบสั่งจ้าง สายทาง แขวง ข้อมูลบริษัท ใบเสนอราคา หนังสือส่งมอบ และร่างใบกำกับภาษี/ใบเสร็จ ไม่เห็นค่าแรงและน้ำมัน",
  account: "ค่าแรง น้ำมัน รายชื่อลูกจ้าง ใบสำคัญจ่าย ออก/ยกเลิกใบกำกับภาษี/ใบเสร็จ ดูเอกสารทั้งหมด แก้ใบสั่งจ้างไม่ได้",
  field: "บันทึกรายวัน (ไม่เห็นค่าแรง) รูปก่อน/หลัง สถานะสาย ค่าน้ำมัน ไม่เห็นราคาและเอกสาร",
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
    orders: has("office"), // สร้าง/แก้ใบสั่งจ้าง สายทาง แขวง ข้อมูลบริษัท
    prices: has("office", "account"), // เห็นราคา มูลค่า เอกสาร
    docs: has("office", "account"),
    docKind: (k: string) => (k === "rc" ? has("office", "account") : has("office")),
    rcIssue: has("account"), // ออก/ยกเลิกใบกำกับภาษี
    wages: has("account"), // ค่าแรง รายชื่อลูกจ้าง ใบสำคัญจ่าย ต้นทุน
    daily: has("account", "field"), // บันทึกรายวัน
    fuel: has("account", "field"),
    work: has("office", "account", "field"), // รูป สถานะสาย ความยาวสาย
    scoped: !has("office", "account") && scope.length > 0,
  };
}
export type Perms = ReturnType<typeof perms>;
