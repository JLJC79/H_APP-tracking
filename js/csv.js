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

export const DATE_FORMATS = [
  { key: 'iso', label: 'YYYY-MM-DD (ISO, also with time)' },
  { key: 'dmy', label: 'DD/MM/YYYY' },
  { key: 'mdy', label: 'MM/DD/YYYY' },
];

const pad = (n) => String(n).padStart(2, '0');

/** Converts a date string in the given format to YYYY-MM-DD, or null. Any time part is ignored. */
export function parseDate(s, format = 'iso') {
  if (!s) return null;
  s = String(s).trim();
  let y, m, d;
  if (format === 'iso') {
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

export function guessColumn(headers, patterns) {
  const i = headers.findIndex((h) => patterns.some((p) => p.test(h)));
  return i >= 0 ? i : null;
}

/**
 * Applies a mapping to data rows (header excluded).
 * mapping: { format: 'long'|'wide', dateCol, metricCol, valueCol, valueCols, dateFormat, agg: 'mean'|'sum'|'last' }
 * Returns { records: [{metric, date, value}], skipped, total }.
 */
export function applyMapping(headers, rows, mapping) {
  const buckets = new Map(); // "metric|date" -> values[]
  let skipped = 0, total = 0;
  const add = (metric, date, value) => {
    const k = `${metric}|${date}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(value);
  };
  for (const r of rows) {
    const date = parseDate(r[mapping.dateCol], mapping.dateFormat);
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
        add(headers[c].trim(), date, value);
      }
    }
  }
  const records = [];
  for (const [k, vals] of buckets) {
    const [metric, date] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
    let value;
    if (mapping.agg === 'sum') value = vals.reduce((a, b) => a + b, 0);
    else if (mapping.agg === 'last') value = vals[vals.length - 1];
    else value = vals.reduce((a, b) => a + b, 0) / vals.length;
    records.push({ metric, date, value: Math.round(value * 1000) / 1000 });
  }
  return { records, skipped, total };
}
