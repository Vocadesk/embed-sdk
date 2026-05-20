// RMS → bar level. 6 segments, log-scaled so quiet speech still moves the meter.

const BARS = 6;
// dBFS thresholds (lowest to highest). Below MIN_DB the meter shows zero;
// above MAX_DB it pegs at the top. Calibrated so room tone sits at ~1 bar
// and a normal speaking voice fills 4-5.
const MIN_DB = -60;
const MAX_DB = -15;

export function rmsToBars(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  if (db <= MIN_DB) return 0;
  if (db >= MAX_DB) return BARS;
  const norm = (db - MIN_DB) / (MAX_DB - MIN_DB);
  return Math.round(norm * BARS);
}

export const BAR_COUNT = BARS;
