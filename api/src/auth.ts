import { timingSafeEqual } from "node:crypto";
import { GraphQLError } from "graphql";
import { jwtVerify } from "jose";
import { config } from "./config.ts";

export type SessionUser = { userId: number; name: string; role: "clinician" | "admin" };

/** The web tier signs the session cookie; this tier verifies the same token (shared secret, HS256). */
export async function userFromAuthHeader(header: string | undefined): Promise<SessionUser | null> {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.sessionSecret), { algorithms: ["HS256"] });
    const p = payload as Partial<SessionUser>;
    if (typeof p.userId !== "number" || (p.role !== "clinician" && p.role !== "admin")) return null;
    return { userId: p.userId, name: String(p.name ?? ""), role: p.role };
  } catch {
    return null;                                     // expired, tampered, wrong key
  }
}

export function isServiceCall(header: string | undefined): boolean {
  if (!header) return false;
  const a = Buffer.from(header), b = Buffer.from(config.serviceKey);
  return a.length === b.length && timingSafeEqual(a, b);   // constant time: no timing side channel
}

export const unauthenticated = () => new GraphQLError("Not signed in", { extensions: { code: "UNAUTHENTICATED", http: { status: 401 } } });
export const forbidden = () => new GraphQLError("Not allowed", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
export const badInput = (message: string) => new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
