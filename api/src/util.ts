/** snake_case row from Postgres -> camelCase object for GraphQL. */
export function camel<T extends Record<string, any>>(row: T): any {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())] = v;
  return out;
}

export function groupBy<K, V>(rows: V[], keyOf: (r: V) => K): Map<K, V[]> {
  const m = new Map<K, V[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = m.get(k);
    if (list) list.push(r); else m.set(k, [r]);
  }
  return m;
}

/** Escapes LIKE wildcards so a search for "50%" means the characters, not a pattern. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/** GraphQL enum (FULL_FLOW) <-> database value (full_flow). */
export const toDb = (e: string) => e.toLowerCase();
export const fromDb = (v: string) => v.toUpperCase();
