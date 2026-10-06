/**
 * Only allow redirects to local paths. Blocks open-redirect tricks such as
 * "https://evil.com", "//evil.com" and "/\evil.com".
 */
export function safeRedirectPath(target: unknown, fallback = "/dashboard"): string {
  if (typeof target !== "string") return fallback;
  if (!target.startsWith("/")) return fallback;
  if (target.startsWith("//") || target.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(target)) return fallback;
  return target;
}
