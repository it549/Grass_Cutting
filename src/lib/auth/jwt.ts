import { SignJWT, jwtVerify } from "jose";

// แยกจาก session.ts เพราะไฟล์นี้ต้องใช้ใน middleware (proxy.ts) ด้วย ซึ่งห้าม import next/headers

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET!);
export const SESSION_COOKIE = "gc_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 วัน

export type SessionUser = { userId: string; email: string };

export async function signSessionToken(user: SessionUser) {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (!payload.sub || typeof payload.email !== "string") return null;
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
