// Reference data for the demo. Every organisation, product, person and patient here is invented.

export const HEALTH_SYSTEM = "Piedmont Valley Health (fictitious)";

export const FACILITIES = [
  {
    key: "RB", name: "Riverbend Heart Institute", city: "Charlotte", state: "NC",
    ors: ["CV OR 1", "CV OR 2", "CV OR 3"],
  },
  {
    key: "NG", name: "Northgate Medical Center", city: "Rock Hill", state: "SC",
    ors: ["CV OR 1", "CV OR 2"],
  },
] as const;

export const MANUFACTURERS = ["Helix Perfusion Systems", "Halcyon Monitoring", "Thermacore Medical", "Meridian Disposables"];

export const DEVICE_MODELS = [
  { key: "WS",  maker: "Helix Perfusion Systems", name: "Helix 15 Perfusion Workstation", type: "perfusion_workstation", udi: "00860000100015", cls: "Class II" },
  { key: "MON", maker: "Halcyon Monitoring",      name: "VitalLink M8 Patient Monitor",  type: "patient_monitor",       udi: "00860000200008", cls: "Class II" },
  { key: "HC",  maker: "Thermacore Medical",      name: "Thermacore HC-2 Heater-Cooler", type: "heater_cooler",         udi: "00860000300002", cls: "Class II" },
] as const;

export const MODULE_MODELS = [
  { key: "hub",   maker: "Helix Perfusion Systems", name: "Helix Sensor Hub",               type: "sensor_hub" },
  { key: "hbso2", maker: "Helix Perfusion Systems", name: "Helix Hb/SO2 Sensor Pair",       type: "hb_so2_sensor" },
  { key: "gas",   maker: "Helix Perfusion Systems", name: "Helix Gas Blender",              type: "gas_blender" },
  { key: "vent",  maker: "Helix Perfusion Systems", name: "Helix Ventilation Diagnostics",  type: "ventilation_diagnostics" },
  { key: "drive", maker: "Helix Perfusion Systems", name: "Helix Centrifugal Drive",        type: "centrifugal_drive" },
  { key: "vitals",maker: "Halcyon Monitoring",      name: "VitalLink Hemodynamics Module",  type: "vital_signs" },
] as const;

export const WORKSTATION_MODULES = [
  { key: "hub", position: "Sensor hub" }, { key: "hbso2", position: "Arterial/venous Hb-SO2" },
  { key: "gas", position: "Gas blender" }, { key: "vent", position: "Ventilation diagnostics" },
  { key: "drive", position: "Arterial pump drive" },
] as const;

export const MAINTENANCE_PLANS = [
  { model: "WS", name: "Annual preventive maintenance", days: 365, grace: 30, regulatory: true, tasks: [
      ["Electrical safety test (IEC 62353)", "Leakage < 100 µA"], ["Battery runtime test", "≥ 90 min on battery"],
      ["Pump drive speed accuracy", "± 1% of set RPM"], ["Alarm and audio verification", "All alarms annunciate"]] },
  { model: "WS", name: "Flow and pressure sensor calibration", days: 180, grace: 14, regulatory: true, tasks: [
      ["Flow sensor accuracy vs. reference", "± 2% of reading"], ["Pressure transducer zero and span", "± 2 mmHg"],
      ["Hb/SO2 sensor verification", "Within factory tolerance"]] },
  { model: "WS", name: "Battery capacity check", days: 90, grace: 7, regulatory: false, tasks: [
      ["Battery runtime under load", "≥ 90 min"]] },
  { model: "WS", name: "Centrifugal drive service", hours: 250, grace: 0, regulatory: false, tasks: [
      ["Drive bearing noise and temperature", "Within limits"], ["Magnetic coupling inspection", "No wear"]] },
  { model: "MON", name: "Annual safety inspection", days: 365, grace: 30, regulatory: true, tasks: [
      ["Electrical safety test", "Leakage < 100 µA"], ["Invasive pressure channel calibration", "± 1 mmHg"]] },
  { model: "MON", name: "Temperature channel verification", days: 180, grace: 14, regulatory: false, tasks: [
      ["Temperature accuracy vs. reference", "± 0.1 °C"]] },
  { model: "HC", name: "Weekly disinfection", days: 7, grace: 0, regulatory: true, tasks: [
      ["Drain, disinfect and refill water circuits", "Per IFU"], ["Disinfectant concentration check", "Within IFU range"]] },
  { model: "HC", name: "Quarterly deep clean and water culture", days: 90, grace: 7, regulatory: true, tasks: [
      ["Deep clean and descale", "Per IFU"], ["Water culture sample sent", "No NTM growth"]] },
] as const;

export const DISPOSABLES = [
  { name: "Meridian OxyFlow 300 Oxygenator",       kind: "oxygenator",       udi: "00860000400300", prefix: "OX" },
  { name: "Meridian Custom Tubing Pack CP-7",      kind: "tubing_pack",      udi: "00860000400007", prefix: "TP" },
  { name: "Meridian 22Fr Arterial Cannula",        kind: "cannula",          udi: "00860000400022", prefix: "AC" },
  { name: "Meridian 36/46Fr Two-Stage Venous Cannula", kind: "cannula",      udi: "00860000403646", prefix: "VC" },
  { name: "Meridian Cardioplegia Delivery Set",    kind: "cardioplegia_set", udi: "00860000400100", prefix: "CP" },
  { name: "Helix Hb/SO2 Cuvette 3/8\"",            kind: "hb_so2_cuvette",   udi: "00860000100038", prefix: "CU" },
] as const;

export const SURGEONS = ["Dr. Imani Okafor", "Dr. Theo Lindqvist", "Dr. Priya Raman", "Dr. Marcus Bell"];
// proactive = responds to rising demand on rewarming (more flow, more sweep, earlier transfusion)
export const PERFUSIONISTS = [
  { name: "Jordan Ellis, CCP",  facility: "RB", proactive: true,  ci: 2.5 },
  { name: "Sam Whitaker, CCP",  facility: "RB", proactive: false, ci: 2.2 },
  { name: "Morgan Price, CCP",  facility: "RB", proactive: true,  ci: 2.4 },
  { name: "Riley Chen, CCP",    facility: "NG", proactive: true,  ci: 2.4 },
  { name: "Casey Moreno, CCP",  facility: "NG", proactive: false, ci: 2.3 },
] as const;
export const ANESTHESIOLOGISTS = ["Dr. Elena Vasquez", "Dr. Kwame Mensah", "Dr. Hannah Brooks"];
export const TECHNICIANS = [
  { name: "Luis Ortega",    company: "Riverbend Clinical Engineering" },
  { name: "Dana Kowalski",  company: "Northgate Biomedical Services" },
  { name: "Arjun Patel",    company: "Helix Field Service" },
];

export const FIRST_NAMES_F = ["Mary", "Linda", "Patricia", "Barbara", "Susan", "Carol", "Denise", "Gloria", "Ruth", "Anita", "Joyce", "Paula"];
export const FIRST_NAMES_M = ["James", "Robert", "William", "Charles", "Thomas", "Donald", "Kenneth", "Gary", "Ronald", "Larry", "Walter", "Raymond", "Curtis", "Harold"];
export const LAST_NAMES = ["Hartley", "Pruitt", "Gaines", "Whitfield", "Lowery", "Banks", "Coble", "Hensley", "McAllister", "Tolliver",
  "Rhyne", "Stroupe", "Ingram", "Kiser", "Faulkner", "Mabry", "Dellinger", "Huffstetler", "Carpenter", "Bolick"];

export const USERS = [
  { email: "demo@cardiolens.test",  name: "Dana Demo",  role: "clinician", password: "Demo123!" },
  { email: "admin@cardiolens.test", name: "Alex Admin", role: "admin",     password: "Admin123!" },
] as const;
