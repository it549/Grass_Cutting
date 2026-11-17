import "server-only";
import postgres from "postgres";

declare global {
  var __gcSql: ReturnType<typeof postgres> | undefined;
}

// ให้คอลัมน์ date เป็น string "YYYY-MM-DD" เหมือนของเดิม (PostgREST) แทนที่จะเป็น JS Date object
// (ค่า fallback ของ postgres.js) เพราะทั้งแอปเทียบ/ตัด/ต่อสตริงวันที่แบบนี้อยู่ทั่วไป
const types = { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } };

export const sql = global.__gcSql ?? postgres(process.env.DATABASE_URL!, { max: 10, types });
if (process.env.NODE_ENV !== "production") global.__gcSql = sql;
