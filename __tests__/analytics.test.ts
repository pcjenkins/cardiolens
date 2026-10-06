import { buildTrendSeries, linearRegression, movingAverage, zScoreOutliers } from "@/lib/analytics";

describe("movingAverage", () => {
  it("averages a trailing window, using what is available at the start", () => {
    expect(movingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
  });
});

describe("linearRegression", () => {
  it("recovers a perfect line", () => {
    const { slope, intercept, r2 } = linearRegression([10, 8, 6, 4]);
    expect(slope).toBeCloseTo(-2);
    expect(intercept).toBeCloseTo(10);
    expect(r2).toBeCloseTo(1);
  });
  it("handles a single point without dividing by zero", () => {
    expect(linearRegression([5])).toEqual({ slope: 0, intercept: 5, r2: 0 });
  });
});

describe("zScoreOutliers", () => {
  it("flags the one extreme value", () => {
    const values = [100, 98, 102, 101, 99, 100, 97, 103, 100, 200];
    expect(zScoreOutliers(values, 2.5)).toEqual([9]);
  });
  it("returns nothing when every value is identical", () => {
    expect(zScoreOutliers([5, 5, 5, 5])).toEqual([]);
  });
});

describe("buildTrendSeries", () => {
  it("produces one chart point per week with a fitted trend", () => {
    const weekly = [
      { week: "2026-01-05", mean: 100, cases: 5 },
      { week: "2026-01-12", mean: 98, cases: 6 },
      { week: "2026-01-19", mean: 96, cases: 4 },
    ];
    const { series, fit } = buildTrendSeries(weekly, 2);
    expect(series).toHaveLength(3);
    expect(fit.slope).toBeCloseTo(-2);
    expect(series[2]).toMatchObject({ week: "2026-01-19", mean: 96, movingAvg: 97, trend: 96 });
  });
});
