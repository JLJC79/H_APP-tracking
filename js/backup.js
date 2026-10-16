// Full backup export/import. Format documented in README ("Backup file format").
import { getAll, getSetting, bulkWrite } from './db.js';
import { uid, isValidISODate, toNum, todayISO } from './util.js';

export const FORMAT = 'health-dashboard-backup';
export const VERSION = 1;
const TYPES = ['number', 'scale', 'bool', 'text'];

export async function buildBackup() {
  const [labs, metrics, logFields, logEntries] = await Promise.all(
    ['labs', 'metrics', 'logFields', 'logEntries'].map((s) => getAll(s)));
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    labs,
    metrics,
    logFields,
    logEntries,
    // The PIN is deliberately not exported.
    settings: {
      csvMappings: await getSetting('csvMappings', []),
      overviewKeys: await getSetting('overviewKeys', []),
    },
  };
}

export function backupFileName() { return `health-backup-${todayISO()}.json`; }

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const optNum = (v) => (v === null || v === undefined || v === '' ? null : toNum(v));

/**
 * Validates and normalises a parsed backup object. Invalid records are skipped, not fatal.
 * Returns { data: {store: records[]}, counts, skipped: [messages], settings }.
 * Throws if the file is not a backup at all.
 */
export function validateBackup(obj, existingFields = []) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Not a backup file (expected a JSON object).');
  if (obj.format !== FORMAT) throw new Error(`Not a Health Dashboard backup ("format" must be "${FORMAT}").`);
  if (typeof obj.version !== 'number' || obj.version > VERSION) {
    throw new Error(`Unsupported backup version ${obj.version}. This app reads version ${VERSION}.`);
  }
  const skipped = [];
  const skip = (section, i, why) => skipped.push(`${section}[${i}]: ${why}`);
  const arr = (k) => {
    if (obj[k] === undefined) return [];
    if (!Array.isArray(obj[k])) { skipped.push(`${k}: not a list, ignored`); return []; }
    return obj[k];
  };

  const labs = [];
  arr('labs').forEach((r, i) => {
    if (!r || typeof r !== 'object') return skip('labs', i, 'not an object');
    const test = str(r && r.test);
    const value = toNum(r && r.value);
    const low = optNum(r.low), high = optNum(r.high);
    if (!test) return skip('labs', i, 'missing "test"');
    if (value === null) return skip('labs', i, 'missing or non-numeric "value"');
    if (!isValidISODate(r.date)) return skip('labs', i, '"date" must be YYYY-MM-DD');
    if ((r.low != null && r.low !== '' && low === null) || (r.high != null && r.high !== '' && high === null)) return skip('labs', i, '"low"/"high" must be numbers or null');
    labs.push({ id: str(r.id) || uid(), test, value, units: str(r.units), low, high, date: r.date, notes: str(r.notes) });
  });

  const metrics = [];
  arr('metrics').forEach((r, i) => {
    if (!r || typeof r !== 'object') return skip('metrics', i, 'not an object');
    const metric = str(r && r.metric);
    const value = toNum(r && r.value);
    if (!metric) return skip('metrics', i, 'missing "metric"');
    if (value === null) return skip('metrics', i, 'missing or non-numeric "value"');
    if (!isValidISODate(r.date)) return skip('metrics', i, '"date" must be YYYY-MM-DD');
    metrics.push({ id: `${metric}|${r.date}`, metric, date: r.date, value, source: str(r.source) || 'import' });
  });

  const logFields = [];
  arr('logFields').forEach((r, i) => {
    if (!r || typeof r !== 'object') return skip('logFields', i, 'not an object');
    const name = str(r && r.name);
    if (!name) return skip('logFields', i, 'missing "name"');
    if (!TYPES.includes(r.type)) return skip('logFields', i, `"type" must be one of ${TYPES.join(', ')}`);
    const step = toNum(r.step);
    logFields.push({
      id: str(r.id) || uid(), name, type: r.type, unit: str(r.unit),
      step: step && step > 0 ? step : 1,
      order: Number.isFinite(r.order) ? r.order : i,
      archived: r.archived === true,
    });
  });

  // Entries may reference a field by "fieldId" or, for hand-made files, by "field" (its name).
  const allFields = [...existingFields.filter((f) => !logFields.some((x) => x.id === f.id)), ...logFields];
  const byId = new Map(allFields.map((f) => [f.id, f]));
  const byName = new Map(allFields.map((f) => [f.name.toLowerCase(), f]));
  const logEntries = [];
  arr('logEntries').forEach((r, i) => {
    if (!r || typeof r !== 'object') return skip('logEntries', i, 'not an object');
    if (!r || !isValidISODate(r.date)) return skip('logEntries', i, '"date" must be YYYY-MM-DD');
    const f = byId.get(str(r.fieldId)) || byName.get(str(r.field).toLowerCase());
    if (!f) return skip('logEntries', i, `unknown field "${str(r.fieldId) || str(r.field)}"`);
    let v = r.value;
    if (f.type === 'number' || f.type === 'scale') {
      v = toNum(v);
      if (v === null) return skip('logEntries', i, 'value must be a number');
      if (f.type === 'scale' && (v < 1 || v > 10 || !Number.isInteger(v))) return skip('logEntries', i, 'scale value must be a whole number 1–10');
    } else if (f.type === 'bool') {
      const s = String(v).toLowerCase();
      if (v === true || ['true', 'yes', 'y', '1'].includes(s)) v = true;
      else if (v === false || ['false', 'no', 'n', '0'].includes(s)) v = false;
      else return skip('logEntries', i, 'yes/no value must be true or false');
    } else {
      v = str(v);
      if (!v) return skip('logEntries', i, 'empty text');
    }
    logEntries.push({ id: `${r.date}|${f.id}`, date: r.date, fieldId: f.id, value: v });
  });

  const s = obj.settings && typeof obj.settings === 'object' ? obj.settings : {};
  const settings = [];
  if (Array.isArray(s.csvMappings)) settings.push({ key: 'csvMappings', value: s.csvMappings });
  if (Array.isArray(s.overviewKeys)) settings.push({ key: 'overviewKeys', value: s.overviewKeys.filter((k) => typeof k === 'string') });

  const data = { labs, metrics, logFields, logEntries, settings };
  return {
    data,
    counts: { labs: labs.length, metrics: metrics.length, logFields: logFields.length, logEntries: logEntries.length },
    skipped,
  };
}

/** Writes validated data. replace=true wipes data stores first (PIN and preferences are kept). */
export async function applyBackup(data, { replace }) {
  if (replace) {
    const { settings, ...rest } = data;
    await bulkWrite(rest, { replace: true });
    await bulkWrite({ settings }, { replace: false });
  } else {
    await bulkWrite(data, { replace: false });
  }
}
