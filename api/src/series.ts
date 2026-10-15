// Picks where a time series is read from, so a chart never pulls more points than it can draw.
// Pure: no database, unit-tested.

export type Resolution = "AUTO" | "RAW" | "MINUTE" | "HOUR" | "DAY";
export type SeriesPlan = { resolution: Exclude<Resolution, "AUTO">; source: "raw" | "agg_minute" | "agg_hour" | "agg_day"; stepSeconds: number };

const GRAINS = [
  { resolution: "MINUTE", source: "agg_minute", seconds: 60 },
  { resolution: "HOUR", source: "agg_hour", seconds: 3600 },
  { resolution: "DAY", source: "agg_day", seconds: 86400 },
] as const;

export class SeriesRangeError extends Error {}

/**
 * AUTO: raw samples when they fit in maxPoints, otherwise the finest aggregate whose step fits,
 * re-binned to a multiple of its grain (e.g. 3-minute points read from the minute table).
 * An explicit RAW request that would exceed maxPoints is refused rather than silently truncated.
 */
export function planSeries(rangeSeconds: number, maxPoints: number, requested: Resolution = "AUTO", sampleRateHz = 1): SeriesPlan {
  if (!(rangeSeconds > 0)) throw new SeriesRangeError("`to` must be after `from`");
  if (!(maxPoints >= 10 && maxPoints <= 20000)) throw new SeriesRangeError("maxPoints must be between 10 and 20000");

  const rawPoints = rangeSeconds * sampleRateHz;
  if (requested === "RAW") {
    if (rawPoints > maxPoints) throw new SeriesRangeError(`RAW would return ${Math.ceil(rawPoints)} points per channel (max ${maxPoints}); narrow the window or use AUTO`);
    return { resolution: "RAW", source: "raw", stepSeconds: 1 / sampleRateHz };
  }
  if (requested === "AUTO" && rawPoints <= maxPoints) return { resolution: "RAW", source: "raw", stepSeconds: 1 / sampleRateHz };

  const needed = rangeSeconds / maxPoints;                          // seconds per point to stay within budget
  // AUTO: minutes until a point would span more than an hour, then hours until it would span more than a day
  const grain = requested === "AUTO"
    ? needed <= 3600 ? GRAINS[0] : needed <= 86400 ? GRAINS[1] : GRAINS[2]
    : GRAINS.find((g) => g.resolution === requested)!;
  const multiple = Math.max(1, Math.ceil(needed / grain.seconds));
  return { resolution: grain.resolution, source: grain.source, stepSeconds: grain.seconds * multiple };
}
