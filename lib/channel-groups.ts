// How the full perfusion record page groups the channels. Pure data, unit-tested:
// every channel appears exactly once, and no group asks the API for more than 8 channels.

export type ChannelGroup = { key: string; title: string; note: string; codes: string[] };

export const CHANNEL_GROUPS: ChannelGroup[] = [
  { key: "gases", title: "Gases and oxygenation", note: "Blender settings, non-invasive blood gases and saturations",
    codes: ["FIO2", "SWEEP", "PAO2", "PACO2", "SAO2", "SVO2"] },
  { key: "delivery", title: "Oxygen delivery (calculated)", note: "Indices the workstation derives from flow, Hb and saturations",
    codes: ["CI", "DO2I", "VO2I"] },
  { key: "blood", title: "Blood", note: "Continuous in-line hemoglobin and hematocrit",
    codes: ["HB", "HCT"] },
  { key: "flow", title: "Flow and pump", note: "Arterial pump flow, drive speed and reservoir level",
    codes: ["FLOW_ART", "PUMP_RPM", "RES_LVL"] },
  { key: "pressures", title: "Circuit pressures", note: "Arterial line pressure and vacuum-assisted venous drainage",
    codes: ["ART_P", "VEN_P"] },
  { key: "temps", title: "Temperatures", note: "Arterial outlet, venous blood and patient core",
    codes: ["T_ART", "T_VEN", "T_NASO"] },
  { key: "monitor", title: "Patient monitor", note: "Hemodynamics from the anesthesia monitor, the whole time in the room",
    codes: ["MAP", "CVP", "HR"] },
];

/** Case milestones drawn as vertical markers on every chart. */
export const MARKER_EVENTS: Record<string, string> = {
  cpb_on: "On bypass",
  xclamp_on: "Clamp",
  rewarm_start: "Rewarm",
  xclamp_off: "Unclamp",
  cpb_off: "Off bypass",
};

/** One GraphQL query with an aliased `series` field per group (each within the API's 8-channel limit). */
export function recordQuery(groups: ChannelGroup[]): string {
  const vars = groups.map((g, i) => `$g${i}: [String!]!`).join(", ");
  const fields = groups.map((g, i) => `
    ${g.key}: series(channels: $g${i}, from: $from, to: $to, maxPoints: 1500) {
      resolution stepSeconds from to
      channels { channel { id code name unit kind formula lowLimit highLimit decimals } points { t avg min max } }
    }`).join("");
  return `query FullRecord($id: ID!, $from: DateTime, $to: DateTime, ${vars}) {
  case(id: $id) {
    id caseDate procedure source room facility perfusionist { name }
    sessions { startedAt endedAt }
    events { ts type }
    phaseWindows { phase start end }
    phases { phase channel { code decimals } min p50 max }${fields}
  }
}`;
}

export const recordVariables = (groups: ChannelGroup[]) =>
  Object.fromEntries(groups.map((g, i) => [`g${i}`, g.codes]));
