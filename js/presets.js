// Built-in column mappings for known exports, recognised by file name, so these files import
// without the mapping form. A mapping the person saved for the same columns takes precedence.
//
// Columns are named by their cleaned header (see cleanHeader in csv.js). Metric names match the
// ones used elsewhere in the app so new data joins existing history.
import { cleanHeader } from './csv.js';

const MIN_TO_H = 1 / 60;

export const PRESETS = [
  {
    id: 'samsung-steps', name: 'Samsung Health · daily steps',
    file: /shealth\.step_daily_trend\./i, date: ['day_time'], dateFormat: 'epoch',
    // One row per device per day plus a combined total (source_type -2): read only the total.
    filter: { col: 'source_type', values: ['-2'] },
    cols: [
      { col: 'count', as: 'Steps', agg: 'max' },
      { col: 'distance', as: 'Distance (km)', scale: 1 / 1000, agg: 'max' },
    ],
  },
  {
    id: 'samsung-heart-rate', name: 'Samsung Health · heart rate',
    file: /shealth\.tracker\.heart_rate\./i, date: ['heart_rate_start_time', 'start_time'],
    cols: [{ col: 'heart_rate', as: 'Heart rate avg (bpm)', agg: 'mean' }],
  },
  {
    id: 'samsung-sleep', name: 'Samsung Health · sleep',
    // shealth.sleep.<timestamp>.csv only, not sleep_data / sleep_combined / sleep_goal…
    file: /shealth\.sleep\.\d+\.csv$/i,
    // Counted on the day you wake up.
    date: ['sleep_end_time', 'end_time'],
    cols: [
      { col: 'sleep_duration', as: 'Sleep (hours)', scale: MIN_TO_H, agg: 'sum' },
      { col: 'sleep_score', as: 'Sleep score', agg: 'mean' },
    ],
  },
  {
    id: 'samsung-weight', name: 'Samsung Health · weight',
    file: /health\.weight\.\d+\.csv$/i, date: ['weight_start_time', 'start_time'],
    cols: [
      { col: 'weight', as: 'Weight (kg)', agg: 'mean' },
      { col: 'body_fat', as: 'Body fat (%)', agg: 'mean' },
      { col: 'skeletal_muscle_mass', as: 'Skeletal muscle (kg)', agg: 'mean' },
    ],
  },
  {
    id: 'samsung-blood-pressure', name: 'Samsung Health · blood pressure',
    file: /shealth\.blood_pressure\.\d+\.csv$/i, date: ['blood_pressure_start_time', 'start_time'],
    cols: [
      { col: 'blood_pressure_systolic', as: 'BP systolic (mmHg)', agg: 'mean' },
      { col: 'blood_pressure_diastolic', as: 'BP diastolic (mmHg)', agg: 'mean' },
    ],
  },
  {
    id: 'samsung-spo2', name: 'Samsung Health · blood oxygen',
    file: /shealth\.tracker\.oxygen_saturation\./i, date: ['oxygen_saturation_start_time', 'start_time'],
    cols: [{ col: 'oxygen_saturation_spo2', as: 'SpO2 (%)', agg: 'mean' }],
  },
  {
    id: 'samsung-respiratory-rate', name: 'Samsung Health · respiratory rate',
    file: /health\.respiratory_rate\./i, date: ['start_time'],
    cols: [{ col: 'average', as: 'Respiratory rate (breaths/min)', agg: 'mean' }],
  },
  {
    id: 'samsung-skin-temperature', name: 'Samsung Health · skin temperature',
    file: /health\.skin_temperature\./i, date: ['start_time'],
    cols: [{ col: 'temperature', as: 'Skin temperature (°C)', agg: 'mean' }],
  },
  {
    id: 'samsung-stress', name: 'Samsung Health · stress',
    file: /shealth\.stress\.\d+\.csv$/i, date: ['start_time'],
    cols: [{ col: 'score', as: 'Stress score', agg: 'mean' }],
  },
];

/**
 * Returns a mapping (same shape as a saved one) for a known file, or null.
 * Null too when the file's columns don't match what the preset expects (e.g. a changed export
 * format), so the mapping form is shown instead of importing something wrong.
 */
export function resolvePreset(fileName, headers) {
  const p = PRESETS.find((x) => x.file.test(fileName));
  if (!p) return null;
  const clean = headers.map((h) => cleanHeader(h).toLowerCase());
  const idx = (name) => { const i = clean.indexOf(name.toLowerCase()); return i >= 0 ? i : null; };
  const dateCol = p.date.map(idx).find((i) => i !== null);
  if (dateCol === undefined) return null;
  const cols = p.cols.map((c) => ({ ...c, i: idx(c.col) })).filter((c) => c.i !== null);
  if (!cols.length) return null;
  const filterCol = p.filter ? idx(p.filter.col) : null;
  return {
    id: `preset:${p.id}`,
    name: p.name,
    preset: p.id,
    format: 'wide',
    dateCol,
    dateFormat: p.dateFormat || 'iso',
    utc: p.utc !== false,
    valueCols: cols.map((c) => c.i),
    names: Object.fromEntries(cols.map((c) => [c.i, c.as])),
    scale: Object.fromEntries(cols.filter((c) => c.scale).map((c) => [c.i, c.scale])),
    aggs: Object.fromEntries(cols.map((c) => [c.i, c.agg])),
    agg: 'auto',
    filter: filterCol !== null ? { col: filterCol, values: p.filter.values } : null,
    metricCol: 0,
    valueCol: 0,
  };
}
