import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt, SESSION_COOKIE } from "./token";

/**
 * Data Access Layer auth check. The proxy is only a fast first gate;
 * every page, route handler and server action that touches data calls this too
 * (and the GraphQL API verifies the forwarded token yet again).
 * cache() de-duplicates the check within a single request.
 */
export const verifySession = cache(async () => {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
});

/** Same check without the redirect, for JSON route handlers that must answer 401 instead. */
export const verifyApiSession = cache(getSession);

async function getSession() {
  return decrypt((await cookies()).get(SESSION_COOKIE)?.value);
}
