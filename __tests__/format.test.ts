import { duration, num, parseChannels, zoomWindow } from "@/lib/format";

describe("duration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(duration(45)).toBe("45s");
    expect(duration(250)).toBe("4m 10s");
    expect(duration(3900)).toBe("1h 05m");
    expect(duration(null)).toBe("-");
  });
});

describe("num", () => {
  it("fixes decimals and adds the unit", () => {
    expect(num(37.25, 1, "°C")).toBe("37.3 °C");
    expect(num(undefined)).toBe("-");
  });
});

describe("parseChannels", () => {
  const known = ["DO2I", "MAP", "SVO2"];
  it("keeps known codes in order, de-duplicated and case-insensitive", () => {
    expect(parseChannels("map,do2i,MAP", known, ["DO2I"])).toEqual(["MAP", "DO2I"]);
  });
  it("drops unknown or hostile input and falls back to the defaults", () => {
    expect(parseChannels("DROP TABLE,<script>", known, ["DO2I"])).toEqual(["DO2I"]);
    expect(parseChannels(undefined, known, ["SVO2"])).toEqual(["SVO2"]);
  });
  it("caps the number of channels", () => {
    expect(parseChannels("DO2I,MAP,SVO2", known, [], 2)).toEqual(["DO2I", "MAP"]);
  });
});

describe("zoomWindow", () => {
  const min = Date.UTC(2026, 0, 1, 10), max = min + 3_600_000;
  it("centres a ten-minute window on the clicked moment", () => {
    const z = zoomWindow(min + 30 * 60_000, min, max);
    expect(z).toEqual({ from: new Date(min + 25 * 60_000).toISOString(), to: new Date(min + 35 * 60_000).toISOString() });
  });
  it("slides the window to stay inside the recording", () => {
    expect(zoomWindow(min + 60_000, min, max).from).toBe(new Date(min).toISOString());
    expect(zoomWindow(max - 60_000, min, max).to).toBe(new Date(max).toISOString());
  });
});
