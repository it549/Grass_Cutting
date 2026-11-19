import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// อ่านเอกสาร (PDF/รูป/ข้อความ) เป็นข้อมูลตาม schema
// ใช้ Gemini (ฟรี) ก่อนถ้ามี GEMINI_API_KEY — ถ้าไม่มีหรืออ่านไม่สำเร็จ จะใช้ Claude แทนถ้ามี ANTHROPIC_API_KEY

export type AiFile = { mediaType: string; base64: string };

const GEMINI_MODEL = () => process.env.GEMINI_MODEL || "gemini-flash-latest";
// รุ่นสำรองเมื่อรุ่นหลักเต็ม/โควตาหมด (ฟรีทั้งคู่ โควตานับแยกรุ่น)
const GEMINI_BACKUPS = ["gemini-flash-lite-latest", "gemini-3.8-flash"];
const CLAUDE_MODEL = "claude-opus-5-5";
// Gemini รับไฟล์แนบในคำขอได้รวมไม่เกิน ~20MB (นับหลังแปลงเป็น base64)
const GEMINI_MAX_B64 = 19 * 1024 * 1024;

export const aiConfigured = () => Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);

/** ข้อผิดพลาดที่ข้อความพร้อมแสดงให้ผู้ใช้ */
export class AiError extends Error {}

export async function extractWithAI<S extends z.ZodType>(schema: S, files: AiFile[], prompt: string): Promise<z.infer<S>> {
  const gemini = process.env.GEMINI_API_KEY;
  const claude = process.env.ANTHROPIC_API_KEY;
  if (!gemini && !claude) throw new AiError("ยังไม่ได้ตั้งค่า GEMINI_API_KEY หรือ ANTHROPIC_API_KEY (ดู README)");

  if (gemini) {
    try {
      return await viaGemini(gemini, schema, files, prompt);
    } catch (e) {
      if (!claude) throw e;
      console.warn("[ai-extract] Gemini อ่านไม่สำเร็จ ใช้ Claude แทน:", e instanceof Error ? e.message : e);
    }
  }
  return viaClaude(claude!, schema, files, prompt);
}

async function viaGemini<S extends z.ZodType>(apiKey: string, schema: S, files: AiFile[], prompt: string): Promise<z.infer<S>> {
  if (files.reduce((s, f) => s + f.base64.length, 0) > GEMINI_MAX_B64)
    throw new AiError("ไฟล์ใหญ่เกินกว่าที่ Gemini รับได้ (ประมาณ 14MB) ลองแยกเป็นหลายไฟล์");

  const { $schema: _drop, ...rawSchema } = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  void _drop;
  const jsonSchema = forGemini(rawSchema);
  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [...files.map((f) => ({ inline_data: { mime_type: f.mediaType, data: f.base64 } })), { text: prompt }],
      },
    ],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: jsonSchema, temperature: 0 },
  });
  const call = (model: string) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body,
      signal: AbortSignal.timeout(180_000),
    });

  // โมเดลหลักคนใช้เยอะจนเต็ม (503) หรือโควตาฟรีของรุ่นนั้นหมด (429) ได้บ่อย → ลองซ้ำ แล้วเปลี่ยนไปรุ่นสำรอง
  const models = [...new Set([GEMINI_MODEL(), ...GEMINI_BACKUPS])];
  let res: Response | undefined;
  let lastStatus = 0;
  let lastModel = models[0];
  outer: for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2000));
      lastModel = model;
      const r = await call(model);
      if (r.ok) { res = r; break outer; }
      lastStatus = r.status;
      const detail = await r.text().catch(() => "");
      if (r.status === 400 && /API key/i.test(detail)) throw new AiError("GEMINI_API_KEY ไม่ถูกต้อง");
      if (r.status === 401 || r.status === 403) throw new AiError("GEMINI_API_KEY ไม่ถูกต้องหรือไม่มีสิทธิ์");
      console.warn(`[ai-extract] Gemini ${model} ตอบ ${r.status}`);
      if (r.status === 404 || r.status === 429) break; // ลองซ้ำรุ่นเดิมไม่ช่วย ไปรุ่นถัดไป
      if (r.status !== 503 && r.status !== 500) throw new AiError(`Gemini อ่านไฟล์นี้ไม่ได้ (${r.status})`);
    }
  }
  if (!res) {
    if (lastStatus === 429) throw new AiError("ใช้ Gemini ฟรีครบโควตาแล้ว รอสักครู่หรือพรุ่งนี้แล้วลองใหม่");
    if (lastStatus === 404) throw new AiError(`ไม่พบโมเดล Gemini "${lastModel}" ตรวจค่า GEMINI_MODEL`);
    throw new AiError("Gemini มีคนใช้เยอะจนเต็มชั่วคราว รอ 1–2 นาทีแล้วลองใหม่");
  }

  type GeminiRes = {
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
  };
  const out = (await res.json()) as GeminiRes;
  if (out.promptFeedback?.blockReason) throw new AiError("Gemini ไม่สามารถอ่านเอกสารนี้ได้");
  const cand = out.candidates?.[0];
  if (cand?.finishReason === "MAX_TOKENS") throw new AiError("เอกสารยาวเกินไป ลองแยกเป็นหลายไฟล์");
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiError("อ่านผลลัพธ์จาก Gemini ไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AiError("Gemini ตอบกลับไม่ครบตามรูปแบบ ลองใหม่อีกครั้ง");
  return parsed.data;
}

/** zod เขียนค่าที่เป็น null ได้เป็น type: ["number","null"] — แปลงเป็น anyOf ซึ่ง Gemini รองรับแน่นอนกว่า */
function forGemini(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(forGemini);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = forGemini(v);
  if (Array.isArray(out.type)) {
    const { type, ...rest } = out;
    return { ...rest, anyOf: (type as string[]).map((t) => ({ type: t })) };
  }
  return out;
}

async function viaClaude<S extends z.ZodType>(apiKey: string, schema: S, files: AiFile[], prompt: string): Promise<z.infer<S>> {
  const client = new Anthropic({ apiKey });
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = files.map((f) =>
    f.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } }
      : {
          type: "image",
          source: { type: "base64", media_type: f.mediaType as "image/jpeg" | "image/png" | "image/webp", data: f.base64 },
        },
  );
  const res = await client.beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content: [...blocks, { type: "text", text: prompt }] }],
  });
  if (res.stop_reason === "refusal") throw new AiError("Claude ไม่สามารถอ่านเอกสารนี้ได้");
  if (res.stop_reason === "max_tokens") throw new AiError("เอกสารยาวเกินไป ลองแยกเป็นหลายไฟล์");
  if (!res.parsed_output) throw new AiError("อ่านผลลัพธ์ไม่สำเร็จ ลองใหม่อีกครั้ง");
  return res.parsed_output as z.infer<S>;
}

/** แปลงข้อผิดพลาดเป็นข้อความภาษาไทยสำหรับแสดงในหน้าเว็บ */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof AiError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "ANTHROPIC_API_KEY ไม่ถูกต้อง";
  if (e instanceof Anthropic.RateLimitError) return "ใช้งาน Claude ถี่เกินไป รอสักครู่แล้วลองใหม่";
  if (e instanceof Anthropic.BadRequestError) return "Claude อ่านไฟล์นี้ไม่ได้: " + e.message;
  if (e instanceof Anthropic.APIError) return `Claude ขัดข้อง (${e.status}) ลองใหม่อีกครั้ง`;
  if (e instanceof Error && e.name === "TimeoutError") return "AI ใช้เวลาอ่านนานเกินไป ลองใหม่อีกครั้ง";
  return e instanceof Error ? e.message : String(e);
}
