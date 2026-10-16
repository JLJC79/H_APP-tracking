// CSV parsing and column mapping for wearable exports.
import { isValidISODate, toNum } from './util.js';

/** Guesses the delimiter from the first line: comma, semicolon or tab. */
function detectDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

/** RFC 4180-style parser: quoted fields, escaped quotes, CRLF/LF. Returns an array of rows. */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

/**
 * Index of the row holding the column names. Some exports (e.g. Samsung Health) put a short
 * metadata line above the real header, so skip leading rows narrower than the typical row.
 */
export function detectHeaderRow(rows) {
  const sample = rows.slice(0, 60);
  const counts = new Map();
  for (const r of sample) counts.set(r.length, (counts.get(r.length) || 0) + 1);
  const typical = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const i = rows.findIndex((r) => r.length >= typical);
  return i >= 0 && i < 10 ? i : 0;
}

/**
 * Readable column name without the dotted package prefix, keeping the data type so generic
 * names stay clear: "com.samsung.health.heart_rate.max" → "heart_rate_max",
 * "com.samsung.health.heart_rate.heart_rate" → "heart_rate".
 */
export function cleanHeader(h) {
  const s = String(h || '').trim();
  if (!/^[a-z0-9_]+(\.[a-z0-9_]+){2,}$/i.test(s)) return s;
  const parts = s.split('.');
  const [type, leaf] = parts.slice(-2);
  return leaf === type || leaf.startsWith(type + '_') ? leaf : `${type}_${leaf}`;
}

export const DATE_FORMATS = [
  { key: 'iso', label: 'YYYY-MM-DD (ISO, also with time)' },
  { key: 'dmy', label: 'DD/MM/YYYY' },
  { key: 'mdy', label: 'MM/DD/YYYY' },
  { key: 'epoch', label: 'Unix timestamp (seconds or milliseconds)' },
];

const pad = (n) => String(n).padStart(2, '0');

/**
 * Converts a date string in the given format to YYYY-MM-DD, or null.
 * With utc=true, a value that includes a time is read as UTC and converted to this device's
 * local date (Samsung Health stores times in UTC). Otherwise any time part is ignored.
 */
export function parseDate(s, format = 'iso', utc = false) {
  if (s === null || s === undefined || s === '') return null;
  s = String(s).trim();
  let y, m, d;
  if (format === 'epoch') {
    if (!/^\d{9,13}$/.test(s)) return null;
    const ms = s.length > 11 ? Number(s) : Number(s) * 1000;
    const dt = new Date(ms);
    // Day-level timestamps (exact UTC midnight) are calendar days, not instants.
    const midnight = dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0;
    return (utc && !midnight)
      ? `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
      : `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  if (format === 'iso') {
    const withTime = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (utc && withTime) {
      const [, Y, M, D, h, mi, sec] = withTime.map(Number);
      const dt = new Date(Date.UTC(Y, M - 1, D, h, mi, sec || 0));
      const iso = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      return isValidISODate(iso) ? iso : null;
    }
    const mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!mt) return null;
    [, y, m, d] = mt;
  } else {
    const mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!mt) return null;
    if (format === 'dmy') [, d, m, y] = mt; else [, m, d, y] = mt;
    if (y.length === 2) y = '20' + y;
  }
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isValidISODate(iso) ? iso : null;
}

/** Guesses the date format from sample values. */
export function guessDateFormat(samples) {
  const vals = samples.filter(Boolean);
  if (vals.length && vals.every((v) => /^\d{9,13}$/.test(String(v).trim()))) return 'epoch';
  if (vals.length && vals.every((v) => parseDate(v, 'iso'))) return 'iso';
  // If any first component is > 12, it must be the day.
  for (const v of vals) {
    const mt = String(v).match(/^(\d{1,2})[-/.](\d{1,2})[-/.]/);
    if (mt && +mt[1] > 12) return 'dmy';
    if (mt && +mt[2] > 12) return 'mdy';
  }
  return vals.some((v) => parseDate(v, 'dmy')) ? 'dmy' : 'iso';
}

/** Stable key for a CSV's header row, used to find a saved mapping. */
export function headerSignature(headers) {
  return headers.map((h) => h.trim().toLowerCase()).join('|');
}

/** Index of the first header matching the earliest pattern in the list (patterns are in priority order). */
export function guessColumn(headers, patterns) {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return null;
}

/** For agg 'auto': counts and totals are summed per day, everything else is averaged. */
export function autoAgg(metric) {
  if (/score|rate|avg|mean|pct|percent|weight|temp|spo2|pressure|systolic|diastolic/i.test(metric)) return 'mean';
  return /step|calor|kcal|distance|floor|minute|active|duration|count/i.test(metric) ? 'sum' : 'mean';
}

/** Columns that are ids, versions or bookkeeping, not measurements — not ticked by default. */
export function isBookkeepingColumn(name) {
  return /(^|_)(id|uuid|ver|version|offset|pkg|pkg_name|type|source|comment|tag|binning|deviceuuid|custom)$|_time$|^time$|uuid|create_sh_ver|modify_sh_ver/i
    .test(cleanHeader(name));
}

/**
 * Applies a mapping to data rows (header excluded).
 * mapping: { format: 'long'|'wide', dateCol, metricCol, valueCol, valueCols, names, dateFormat, utc,
 *            agg: 'auto'|'mean'|'sum'|'last' }
 * names (wide only, optional): { [columnIndex]: metric name to save as } — defaults to the cleaned header.
 * Returns { records: [{metric, date, value}], skipped, total }.
 */
export function metricNameFor(headers, mapping, c) {
  const n = mapping.names && mapping.names[c];
  return (n && String(n).trim()) || cleanHeader(headers[c]) || `Column ${c + 1}`;
}

export function applyMapping(headers, rows, mapping) {
  const buckets = new Map(); // "metric|date" -> values[]
  let skipped = 0, total = 0;
  const add = (metric, date, value) => {
    const k = `${metric}|${date}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(value);
  };
  for (const r of rows) {
    const date = parseDate(r[mapping.dateCol], mapping.dateFormat, Boolean(mapping.utc));
    if (mapping.format === 'long') {
      total++;
      const metric = (r[mapping.metricCol] || '').trim();
      const value = toNum(r[mapping.valueCol]);
      if (!date || !metric || value === null) { skipped++; continue; }
      add(metric, date, value);
    } else {
      for (const c of mapping.valueCols) {
        const raw = r[c];
        if (raw === undefined || raw === '') continue; // blank cell: not an error
        total++;
        const value = toNum(raw);
        if (!date || value === null) { skipped++; continue; }
        add(metricNameFor(headers, mapping, c), date, value);
      }
    }
  }
  const records = [];
  for (const [k, vals] of buckets) {
    const [metric, date] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
    const agg = mapping.agg === 'auto' ? autoAgg(metric) : mapping.agg;
    let value;
    if (agg === 'sum') value = vals.reduce((a, b) => a + b, 0);
    else if (agg === 'last') value = vals[vals.length - 1];
    else value = vals.reduce((a, b) => a + b, 0) / vals.length;
    records.push({ metric, date, value: Math.round(value * 1000) / 1000 });
  }
  return { records, skipped, total };
}
