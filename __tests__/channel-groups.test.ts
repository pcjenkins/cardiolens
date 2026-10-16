import { CHANNEL_GROUPS, recordQuery, recordVariables } from "@/lib/channel-groups";

// The 22 channels the data service publishes (api/src/seed/channels.ts).
const ALL = ["ART_P", "VEN_P", "FLOW_ART", "PUMP_RPM", "RES_LVL", "T_ART", "T_VEN", "SAO2", "SVO2", "HB", "HCT",
  "FIO2", "SWEEP", "PAO2", "PACO2", "CI", "DO2I", "VO2I", "MAP", "CVP", "HR", "T_NASO"];

describe("full record channel groups", () => {
  const codes = CHANNEL_GROUPS.flatMap((g) => g.codes);

  it("shows every channel exactly once", () => {
    expect([...codes].sort()).toEqual([...ALL].sort());
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("keeps each group within the API's 8-channel limit", () => {
    for (const g of CHANNEL_GROUPS) expect(g.codes.length).toBeLessThanOrEqual(8);
  });

  it("builds one query with an aliased series field and a variable per group", () => {
    const q = recordQuery(CHANNEL_GROUPS);
    for (const [i, g] of CHANNEL_GROUPS.entries()) {
      expect(q).toContain(`${g.key}: series(channels: $g${i}`);
      expect(q).toContain(`$g${i}: [String!]!`);
    }
    expect(recordVariables(CHANNEL_GROUPS)).toEqual(Object.fromEntries(CHANNEL_GROUPS.map((g, i) => [`g${i}`, g.codes])));
  });
});
