// Display helpers. Pure, unit-tested.

export const PHASE_LABEL: Record<string, string> = {
  PRE_CPB: "Pre-bypass", CPB: "Bypass", FULL_FLOW: "Full-flow bypass", CROSS_CLAMP: "Cross-clamp",
  REWARM: "Rewarming", POST_CPB: "Post-bypass",
};

export const STATUS_LABEL: Record<string, string> = {
  CURRENT: "Current", DUE_SOON: "Due soon", IN_GRACE: "In grace period", OVERDUE: "Overdue",
};

/** "1h 05m", "4m 10s", "45s". */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(r).padStart(2, "0")}s`;
}

/** Number with a fixed number of decimals, or a dash when missing. */
export function num(v: number | null | undefined, decimals = 0, unit = ""): string {
  if (v == null || Number.isNaN(v)) return "-";
  return `${v.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
}

/** Wall-clock time in the facility's time zone (all demo facilities are US Eastern). */
export function clock(iso: string, withSeconds = false): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined, hourCycle: "h23",
  });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric" });
}

/** A ten-minute zoom window centred on a moment, clamped to the recording. */
export function zoomWindow(centerMs: number, minMs: number, maxMs: number, widthMs = 10 * 60_000): { from: string; to: string } {
  const half = widthMs / 2;
  let from = centerMs - half, to = centerMs + half;
  if (from < minMs) { to += minMs - from; from = minMs; }
  if (to > maxMs) { from -= to - maxMs; to = maxMs; }
  return { from: new Date(Math.max(minMs, from)).toISOString(), to: new Date(to).toISOString() };
}

/** Parses the ?ch= list against the known channel codes, keeping order and dropping unknowns. */
export function parseChannels(raw: string | undefined, known: string[], fallback: string[], max = 6): string[] {
  const picked = (raw ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((c) => known.includes(c));
  const unique = [...new Set(picked)].slice(0, max);
  return unique.length ? unique : fallback;
}
