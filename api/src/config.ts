// One .env.local at the repo root configures both tiers (Next.js reads it automatically).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENV_FILE = path.join(REPO_ROOT, ".env.local");

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Run \`npm run env:init\` (or \`npm run db:reset\`) from the repo root.`);
  return v;
}

export const config = {
  get databaseUrl() { return process.env.DATABASE_URL ?? "postgres://cardiolens:cardiolens@localhost:5432/cardiolens"; },
  get sessionSecret() { return required("SESSION_SECRET"); },
  get serviceKey() { return required("SERVICE_KEY"); },
  port: Number(process.env.API_PORT ?? 4000),
  host: process.env.API_HOST ?? "127.0.0.1",          // internal tier: not exposed beyond this machine by default
  production: process.env.NODE_ENV === "production",
  schema: "cardiolens",
};
