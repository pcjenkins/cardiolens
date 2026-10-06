import "server-only";
import { cookies } from "next/headers";
import { encrypt, MAX_AGE_SECONDS, SESSION_COOKIE, type SessionPayload } from "./token";

export async function createSession(payload: SessionPayload) {
  const token = await encrypt(payload);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,                                   // not readable by browser JavaScript
    secure: process.env.NODE_ENV === "production",    // HTTPS only in production
    sameSite: "lax",                                  // blocks most cross-site request forgery
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function deleteSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
