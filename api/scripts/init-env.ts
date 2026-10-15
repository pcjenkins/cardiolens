// Creates or completes .env.local at the repo root. Never overwrites a value that is already set.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ENV_FILE } from "../src/config.ts";

const defaults: Record<string, () => string> = {
  SESSION_SECRET: () => randomBytes(32).toString("hex"),   // signs the login cookie; shared by web and API
  SERVICE_KEY: () => randomBytes(24).toString("hex"),      // web tier -> API for login only
  DATABASE_URL: () => "postgres://cardiolens:cardiolens@localhost:5432/cardiolens",
  API_URL: () => "http://127.0.0.1:4000/graphql",
};

export function initEnv(): string[] {
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const added: string[] = [];
  let next = current && !current.endsWith("\n") ? current + "\n" : current;
  for (const [key, make] of Object.entries(defaults)) {
    if (!new RegExp(`^${key}=`, "m").test(current) && !process.env[key]) {
      const value = make();
      next += `${key}=${value}\n`;
      process.env[key] = value;
      added.push(key);
    }
  }
  if (added.length) {
    try {
      writeFileSync(ENV_FILE, next);
    } catch {
      // read-only filesystem (e.g. a container where config comes from the environment): use the values for this run only
      console.warn(`Could not write ${ENV_FILE}; using generated values for this process only.`);
    }
  }
  return added;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const added = initEnv();
  console.log(added.length ? `Added ${added.join(", ")} to ${ENV_FILE}` : `${ENV_FILE} already complete`);
}
