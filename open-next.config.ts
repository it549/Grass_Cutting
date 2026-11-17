// ตั้งค่าสำหรับขึ้นเว็บบน Cloudflare Workers
// ทุกหน้าในระบบเป็นข้อมูลสด (ไม่ cache) จึงไม่ต้องใช้ R2
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
