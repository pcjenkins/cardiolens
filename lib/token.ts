// JWT sign/verify only - no cookies, no React. Shared by the proxy and the session module.
import { SignJWT, jwtVerify } from "jose";

export type SessionPayload = { userId: number; name: string; role: "clinician" | "admin" };

export const SESSION_COOKIE = "session";
export const MAX_AGE_SECONDS = 60 * 60 * 8; // 8-hour session

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET missing - run `npm run seed` to generate .env.local");
  return new TextEncoder().encode(secret);
}

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());
}

export async function decrypt(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload as unknown as SessionPayload;
  } catch {
    return null; // expired, tampered, or wrong key
  }
}
