// Small shared helpers.

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escapes text for safe interpolation into HTML templates. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Local date as YYYY-MM-DD (not UTC, so "today" matches the phone's clock). */
export function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO() { return isoDate(new Date()); }

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return isoDate(parseISO(s)) === s;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso, { year = true } = {}) {
  if (!iso) return '';
  const d = parseISO(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`;
}
export function fmtMonth(d) { return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; }
export function fmtDay(d) { return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }

/** Parses a user-entered number; accepts a comma decimal separator. Returns null if blank/invalid. */
export function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function fmtNum(n, maxDigits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return n.toLocaleString(undefined, { maximumFractionDigits: maxDigits });
}

/** 'low' | 'high' | 'ok' | null (no range). */
export function rangeStatus(value, low, high) {
  if (value === null || value === undefined) return null;
  const hasLow = low !== null && low !== undefined;
  const hasHigh = high !== null && high !== undefined;
  if (!hasLow && !hasHigh) return null;
  if (hasLow && value < low) return 'low';
  if (hasHigh && value > high) return 'high';
  return 'ok';
}

export function statusBadge(status) {
  if (status === 'high') return '<span class="badge badge-high">High ▲</span>';
  if (status === 'low') return '<span class="badge badge-low">Low ▼</span>';
  if (status === 'ok') return '<span class="badge badge-ok">In range</span>';
  return '';
}

export function rangeText(low, high, units = '') {
  const u = units ? ` ${units}` : '';
  const hasLow = low !== null && low !== undefined;
  const hasHigh = high !== null && high !== undefined;
  if (hasLow && hasHigh) return `${fmtNum(low)}–${fmtNum(high)}${u}`;
  if (hasLow) return `≥ ${fmtNum(low)}${u}`;
  if (hasHigh) return `≤ ${fmtNum(high)}${u}`;
  return 'no range';
}

export const RANGES = [
  { key: '1m', label: '1M', months: 1 },
  { key: '6m', label: '6M', months: 6 },
  { key: '1y', label: '1Y', months: 12 },
  { key: 'all', label: 'All', months: null },
];

/** First ISO date included in a time range, or null for "all". */
export function rangeStart(key) {
  const r = RANGES.find((x) => x.key === key);
  if (!r || r.months === null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - r.months);
  return isoDate(d);
}

export function inRange(iso, startIso) { return !startIso || iso >= startIso; }

export function segControl(name, current) {
  return `<div class="seg" role="group" aria-label="Time range">${RANGES.map((r) =>
    `<button type="button" data-${name}="${r.key}" aria-pressed="${r.key === current}">${r.label}</button>`).join('')}</div>`;
}

export function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }

export function downloadFile(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Pretty label for a metric key like "resting_hr" → "Resting hr". */
export function prettyName(s) {
  const t = String(s).replace(/[_]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
