// The channel catalogue, shared by the seed (to create the rows) and the simulator (to emit samples).
// Modelled on what a modern perfusion workstation and a patient monitor report. All 1 Hz.

export type ChannelDef = {
  id: number; code: string; name: string; unit: string; kind: "measured" | "device_calculated";
  formula?: string; low?: number; high?: number; decimals: number; source: "workstation" | "monitor";
  module: ModuleType;
};

export type ModuleType =
  | "sensor_hub" | "hb_so2_sensor" | "gas_blender" | "ventilation_diagnostics"
  | "centrifugal_drive" | "vital_signs";

export const CHANNELS: ChannelDef[] = [
  { id: 1,  code: "ART_P",    name: "Arterial line pressure",     unit: "mmHg",      kind: "measured", high: 300, decimals: 0, source: "workstation", module: "sensor_hub" },
  { id: 2,  code: "VEN_P",    name: "Venous line pressure (VAVD)", unit: "mmHg",     kind: "measured", low: -80,  decimals: 0, source: "workstation", module: "sensor_hub" },
  { id: 3,  code: "FLOW_ART", name: "Arterial pump flow",         unit: "L/min",     kind: "measured", decimals: 2, source: "workstation", module: "sensor_hub" },
  { id: 4,  code: "PUMP_RPM", name: "Pump speed",                 unit: "rpm",       kind: "measured", decimals: 0, source: "workstation", module: "centrifugal_drive" },
  { id: 5,  code: "RES_LVL",  name: "Reservoir level (1 = above low-level sensor)", unit: "state", kind: "measured", low: 0.5, decimals: 0, source: "workstation", module: "sensor_hub" },
  { id: 6,  code: "T_ART",    name: "Arterial outlet temperature", unit: "°C",       kind: "measured", high: 37, decimals: 1, source: "workstation", module: "sensor_hub" },
  { id: 7,  code: "T_VEN",    name: "Venous blood temperature",   unit: "°C",        kind: "measured", decimals: 1, source: "workstation", module: "sensor_hub" },
  { id: 8,  code: "SAO2",     name: "Arterial O2 saturation",     unit: "%",         kind: "measured", low: 95, decimals: 1, source: "workstation", module: "hb_so2_sensor" },
  { id: 9,  code: "SVO2",     name: "Venous O2 saturation",       unit: "%",         kind: "measured", low: 65, decimals: 1, source: "workstation", module: "hb_so2_sensor" },
  { id: 10, code: "HB",       name: "Hemoglobin",                 unit: "g/dL",      kind: "measured", low: 7, decimals: 1, source: "workstation", module: "hb_so2_sensor" },
  { id: 11, code: "HCT",      name: "Hematocrit",                 unit: "%",         kind: "measured", low: 21, decimals: 0, source: "workstation", module: "hb_so2_sensor" },
  { id: 12, code: "FIO2",     name: "Blender FiO2",               unit: "%",         kind: "measured", decimals: 0, source: "workstation", module: "gas_blender" },
  { id: 13, code: "SWEEP",    name: "Sweep gas flow",             unit: "L/min",     kind: "measured", decimals: 1, source: "workstation", module: "gas_blender" },
  { id: 14, code: "PAO2",     name: "PaO2 (non-invasive)",        unit: "mmHg",      kind: "device_calculated", formula: "From inlet gas flow and concentration, gas pressure and oxygenator exit CO2", low: 100, high: 300, decimals: 0, source: "workstation", module: "ventilation_diagnostics" },
  { id: 15, code: "PACO2",    name: "PaCO2 (non-invasive)",       unit: "mmHg",      kind: "device_calculated", formula: "From inlet gas flow and concentration, gas pressure and oxygenator exit CO2", low: 35, high: 45, decimals: 0, source: "workstation", module: "ventilation_diagnostics" },
  { id: 16, code: "CI",       name: "Cardiac index (ec)",         unit: "L/min/m²",  kind: "device_calculated", formula: "FLOW_ART / BSA", low: 2.2, decimals: 2, source: "workstation", module: "ventilation_diagnostics" },
  { id: 17, code: "DO2I",     name: "Indexed O2 delivery (ec)",   unit: "mL/min/m²", kind: "device_calculated", formula: "CI × (1.34 × HB × SAO2/100 + 0.003 × PAO2) × 10", low: 280, decimals: 0, source: "workstation", module: "ventilation_diagnostics" },
  { id: 18, code: "VO2I",     name: "Indexed O2 consumption (ec)", unit: "mL/min/m²", kind: "device_calculated", formula: "CI × (CaO2 − CvO2) × 10", decimals: 0, source: "workstation", module: "ventilation_diagnostics" },
  { id: 19, code: "MAP",      name: "Mean arterial pressure",     unit: "mmHg",      kind: "measured", low: 50, high: 90, decimals: 0, source: "monitor", module: "vital_signs" },
  { id: 20, code: "CVP",      name: "Central venous pressure",    unit: "mmHg",      kind: "measured", high: 15, decimals: 0, source: "monitor", module: "vital_signs" },
  { id: 21, code: "HR",       name: "Heart rate",                 unit: "bpm",       kind: "measured", decimals: 0, source: "monitor", module: "vital_signs" },
  { id: 22, code: "T_NASO",   name: "Nasopharyngeal temperature", unit: "°C",        kind: "measured", high: 37.5, decimals: 1, source: "monitor", module: "vital_signs" },
];

export const CHANNEL_BY_CODE = Object.fromEntries(CHANNELS.map((c) => [c.code, c])) as Record<string, ChannelDef>;

export const QUALITY = { valid: 0, artifact: 1, sensor_off: 2, line_flush: 3, interpolated: 4 } as const;
