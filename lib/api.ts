import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./token";

// Tier 2 -> tier 3. The web server is the GraphQL client; the browser never talks to the data service.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000/graphql";

export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Query as the signed-in user: their session token is forwarded and the API authorizes every field. */
export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return request<T>(query, variables, token ? { authorization: `Bearer ${token}` } : {});
}

/** Service-to-service call (login only), authenticated with the shared service key, not a user. */
export async function gqlService<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const key = process.env.SERVICE_KEY;
  if (!key) throw new ApiError("SERVICE_KEY is not set - run `npm run env:init`");
  return request<T>(query, variables, { "x-service-key": key });
}

async function request<T>(query: string, variables: Record<string, unknown> | undefined, headers: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",                            // clinical data: always current, never served from a cache
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError("The data service is not reachable. Is the API running (`npm run api`)?", "UNAVAILABLE");
  }
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] } | null;
  const first = body?.errors?.[0];
  if (first) {
    if (first.extensions?.code === "UNAUTHENTICATED") redirect("/login");   // session expired between proxy check and query
    throw new ApiError(first.message, first.extensions?.code);
  }
  if (!res.ok || !body?.data) throw new ApiError(`Data service error (HTTP ${res.status})`);
  return body.data;
}
