import "server-only";
import postgres from "postgres";

declare global {
  var __gcSqlV2: ReturnType<typeof postgres> | undefined;
}

// แปลงชนิดข้อมูลให้เหมือนที่ PostgREST (Supabase) เคยส่งมา เพราะโค้ดหน้าเว็บเขียนไว้แบบนั้น
// · date → string "YYYY-MM-DD" (ไม่ใช่ JS Date) เพราะทั้งแอปเทียบ/ตัด/ต่อสตริงวันที่แบบนี้อยู่ทั่วไป
// · numeric / bigint (เช่น count) → number
// · timestamptz → ISO string
const types = {
  date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
  numeric: { to: 1700, from: [1700], serialize: (x: number | string) => String(x), parse: (x: string) => Number(x) },
  bigint: { to: 20, from: [20], serialize: (x: number | string) => String(x), parse: (x: string) => Number(x) },
  timestamptz: {
    to: 1184,
    from: [1184, 1114],
    serialize: (x: string | Date) => (x instanceof Date ? x.toISOString() : x),
    parse: (x: string) => new Date(x.includes("T") ? x : x.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString(),
  },
};

export const sql = global.__gcSqlV2 ?? postgres(process.env.DATABASE_URL!, { max: 10, types });
if (process.env.NODE_ENV !== "production") global.__gcSqlV2 = sql;

export type Sql = typeof sql;
