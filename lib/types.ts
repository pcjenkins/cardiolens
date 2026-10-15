// Shapes of the GraphQL results the pages use (hand-written; GraphQL Code Generator could derive these from the schema).

export type Staff = { id: string; name: string };

export type Channel = {
  id: string; code: string; name: string; unit: string; kind: string; formula: string | null;
  lowLimit: number | null; highLimit: number | null; decimals: number;
};

export type CaseQuality = {
  do2iNadir: number | null; pctTimeDo2iBelowTarget: number | null; secondsDo2iBelowTarget: number | null;
  svo2Nadir: number | null; secondsMapBelow50: number | null; maxArterialTemp: number | null;
  secondsArterialAbove37: number | null; hctNadir: number | null; emboliCount: number; alarmCount: number; artifactPct: number | null;
};

export type CaseListItem = {
  id: string; caseDate: string; procedure: string; source: string; surgeon: Staff | null; perfusionist: Staff | null;
  facility: string; room: string; bypassMin: number | null; crossClampMin: number | null; losDays: number | null;
  outcome: string | null; quality: Pick<CaseQuality, "pctTimeDo2iBelowTarget"> | null;
};

export type SeriesPoint = { t: string; avg: number | null; min: number | null; max: number | null };
export type Series = {
  resolution: "RAW" | "MINUTE" | "HOUR" | "DAY"; stepSeconds: number; from: string; to: string;
  channels: { channel: Channel; points: SeriesPoint[] }[];
};
export type PhaseWindow = { phase: string; start: string; end: string };

export type MaintenanceStatus = "CURRENT" | "DUE_SOON" | "IN_GRACE" | "OVERDUE";
export type DeviceSummary = {
  id: string; assetTag: string; model: string; type: string; facility: string; room: string | null; location: string | null;
  runningHours: number; cases: number; maintenanceStatus: MaintenanceStatus;
};
