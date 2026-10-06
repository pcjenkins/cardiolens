// Pure functions, no database or React, so they are trivially unit-testable.

export type WeeklyPoint = { week: string; mean: number; cases: number };

/** Simple moving average over `window` points. Early points average what is available. */
export function movingAverage(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Ordinary least-squares fit y = intercept + slope * x, with x = 0..n-1. */
export function linearRegression(values: number[]) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, ssTot = 0;
  values.forEach((y, x) => {
    sxy += (x - xMean) * (y - yMean);
    sxx += (x - xMean) ** 2;
    ssTot += (y - yMean) ** 2;
  });
  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;
  const ssRes = values.reduce((acc, y, x) => acc + (y - (intercept + slope * x)) ** 2, 0);
  return { slope, intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
}

/** Indexes of values more than `threshold` standard deviations from the mean. */
export function zScoreOutliers(values: number[], threshold = 2.5): number[] {
  if (values.length < 3) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
  if (sd === 0) return [];
  return values.flatMap((v, i) => (Math.abs((v - mean) / sd) > threshold ? [i] : []));
}

/** Build the chart series: weekly mean, 4-week moving average and fitted trend line. */
export function buildTrendSeries(weekly: WeeklyPoint[], window = 4) {
  const means = weekly.map((w) => w.mean);
  const ma = movingAverage(means, window);
  const fit = linearRegression(means);
  return {
    fit,
    series: weekly.map((w, i) => ({
      week: w.week,
      cases: w.cases,
      mean: round1(w.mean),
      movingAvg: round1(ma[i]),
      trend: round1(fit.intercept + fit.slope * i),
    })),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
