// Oxygen delivery and consumption on bypass. Standard formulas, no database or I/O, so they are unit-tested.

/** Arterial O2 content, mL O2 per dL blood: 1.34 × Hb × SaO2 + 0.003 × PaO2. */
export function oxygenContent(hbGdl: number, satPct: number, po2mmHg: number): number {
  return 1.34 * hbGdl * (satPct / 100) + 0.003 * po2mmHg;
}

/** Cardiac index, L/min/m²: pump flow divided by body surface area. */
export function cardiacIndex(flowLmin: number, bsaM2: number): number {
  return bsaM2 > 0 ? flowLmin / bsaM2 : 0;
}

/** Indexed O2 delivery, mL/min/m²: CI × CaO2 × 10. The goal-directed perfusion target is about 280. */
export function do2i(ci: number, cao2: number): number {
  return ci * cao2 * 10;
}

/** O2 demand falls roughly 7% per °C of cooling (Q10 ≈ 2). Baseline about 110 mL/min/m² at 37 °C. */
export function vo2iAtTemp(tempC: number, vo2iAt37 = 110): number {
  return vo2iAt37 * Math.pow(0.93, 37 - tempC);
}

/**
 * Mixed venous saturation from the O2 balance: SvO2 ≈ SaO2 × (1 − VO2/DO2).
 * When delivery falls below what is needed, extraction is capped and consumption becomes supply-dependent.
 */
export function venousSaturation(satPct: number, do2: number, vo2: number, maxExtraction = 0.6): number {
  if (do2 <= 0) return 0;
  const extraction = Math.min(vo2 / do2, maxExtraction);
  return satPct * (1 - extraction);
}

/** Mosteller body surface area. */
export function bsaMosteller(heightCm: number, weightKg: number): number {
  return Math.sqrt((heightCm * weightKg) / 3600);
}
