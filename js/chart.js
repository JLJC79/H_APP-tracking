// Dependency-free SVG charts sized to their container, themed via CSS variables.
import { esc, fmtNum, fmtDate, fmtDay, fmtMonth, parseISO, rangeStatus } from './util.js';

const DAY = 86400000;

function niceStep(span, target) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function yTicks(min, max) {
  const step = niceStep(max - min || 1, 4);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function xTicks(t0, t1, width) {
  const n = Math.max(2, Math.min(6, Math.floor(width / 90)));
  const span = t1 - t0;
  const ticks = [];
  for (let i = 0; i < n; i++) ticks.push(t0 + (span * i) / (n - 1));
  const fmt = span > 120 * DAY ? fmtMonth : fmtDay;
  return ticks.map((t) => ({ t, label: fmt(new Date(t)) }));
}

/**
 * Renders a time-series line chart into `el`.
 * opts: { points: [{date, value}], low?, high?, unit?, label, height? }
 * The reference range (low/high) is drawn as a shaded band; out-of-range points are highlighted.
 */
export function lineChart(el, opts) {
  el._chartOpts = opts;
  el.classList.add('chart');
  const width = Math.max(260, Math.floor(el.clientWidth || 320));
  const height = opts.height || 200;
  const m = { top: 10, right: 12, bottom: 24, left: 44 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const pts = (opts.points || []).filter((p) => Number.isFinite(p.value))
    .map((p) => ({ ...p, t: parseISO(p.date).getTime() }))
    .sort((a, b) => a.t - b.t);
  const { low = null, high = null, unit = '', label = 'Chart' } = opts;

  if (!pts.length) {
    el.innerHTML = `<svg viewBox="0 0 ${width} 80" width="${width}" height="80" role="img" aria-label="${esc(label)}: no data in this range">
      <text class="empty" x="${width / 2}" y="44" text-anchor="middle">No data in this range</text></svg>`;
    return;
  }

  let t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  if (t0 === t1) { t0 -= DAY; t1 += DAY; }
  const values = pts.map((p) => p.value);
  let lo = Math.min(...values), hi = Math.max(...values);
  if (low !== null) lo = Math.min(lo, low);
  if (high !== null) hi = Math.max(hi, high);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const ticks = yTicks(lo, hi);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);

  const x = (t) => m.left + ((t - t0) / (t1 - t0)) * iw;
  const y = (v) => m.top + ih - ((v - lo) / (hi - lo)) * ih;

  let band = '';
  if (low !== null || high !== null) {
    const yTop = y(high !== null ? high : hi);
    const yBot = y(low !== null ? low : lo);
    band = `<rect class="band" x="${m.left}" y="${yTop}" width="${iw}" height="${Math.max(0, yBot - yTop)}"/>`;
    if (high !== null) band += `<line class="band-edge" x1="${m.left}" x2="${m.left + iw}" y1="${y(high)}" y2="${y(high)}"/>`;
    if (low !== null) band += `<line class="band-edge" x1="${m.left}" x2="${m.left + iw}" y1="${y(low)}" y2="${y(low)}"/>`;
  }

  const grid = ticks.map((v) => `<line x1="${m.left}" x2="${m.left + iw}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
  const yAxis = ticks.map((v) => `<text x="${m.left - 6}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v)}</text>`).join('');
  const xAxis = xTicks(t0, t1, iw).map(({ t, label: l }, i, arr) => {
    const anchor = i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle';
    return `<text x="${x(t)}" y="${height - 6}" text-anchor="${anchor}">${l}</text>`;
  }).join('');

  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const r = pts.length > 90 ? 1.8 : pts.length > 40 ? 2.5 : 3.5;
  const dots = pts.map((p) => {
    const st = rangeStatus(p.value, low, high);
    const out = st === 'low' || st === 'high';
    return `<circle class="pt${out ? ' out' : ''}" cx="${x(p.t).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${out ? r + 1.5 : r}"><title>${fmtDate(p.date)}: ${fmtNum(p.value)} ${esc(unit)}${out ? ' (' + st + ')' : ''}</title></circle>`;
  }).join('');

  const last = pts[pts.length - 1];
  const aria = `${label}: ${pts.length} reading${pts.length === 1 ? '' : 's'} from ${fmtDate(pts[0].date)} to ${fmtDate(last.date)}. Latest ${fmtNum(last.value)} ${unit}.`;

  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(aria)}">
    <g class="grid">${grid}</g>${band}
    <g class="axis">${yAxis}${xAxis}</g>
    ${pts.length > 1 ? `<path class="line" d="${path}"/>` : ''}${dots}
  </svg>`;
}

/** Small inline trend line for overview tiles. */
export function sparkline(values) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return '';
  const w = 120, h = 36;
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((n, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 3 - ((n - lo) / span) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--series)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Accessible table alternative for a chart, inside a <details>. */
export function dataTable(points, unit = '', { low = null, high = null } = {}) {
  const rows = [...points].sort((a, b) => (a.date < b.date ? 1 : -1)).map((p) => {
    const st = rangeStatus(p.value, low, high);
    const out = st === 'low' || st === 'high';
    return `<tr><td>${fmtDate(p.date)}</td><td class="num${out ? ' flag' : ''}">${fmtNum(p.value)} ${esc(unit)}${out ? ' (' + st + ')' : ''}</td></tr>`;
  }).join('');
  return `<details><summary>Show data (${points.length})</summary><div class="table-wrap"><table><thead><tr><th>Date</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

// Redraw charts when the viewport width changes (e.g. rotation).
let lastWidth = window.innerWidth;
let resizeTimer;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    document.querySelectorAll('.chart').forEach((el) => { if (el._chartOpts) lineChart(el, el._chartOpts); });
  }, 150);
});
