import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt, SESSION_COOKIE } from "./token";

/**
 * Data Access Layer auth check. The proxy is only a fast first gate;
 * every page, route handler and server action that touches data calls this too.
 * cache() de-duplicates the check within a single request.
 */
export const verifySession = cache(async () => {
  const session = await decrypt((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  return session;
});
