// Overview: key metrics and latest lab flags for a selectable time range.
import { getAll, getSetting } from '../db.js';
import { sparkline } from '../chart.js';
import { latestByTest } from './labs.js';
import {
  esc, fmtDate, fmtNum, rangeStatus, statusBadge, rangeText, segControl, rangeStart, inRange,
  byDate, mean, groupBy, prettyName, todayISO,
} from '../util.js';

let range = '1m';
const MAX_DEFAULT_TILES = 8;

export async function render(el) {
  const [labs, metrics, fields, entries] = await Promise.all(['labs', 'metrics', 'logFields', 'logEntries'].map(getAll));
  const starred = await getSetting('overviewKeys', []);
  const start = rangeStart(range);

  if (!labs.length && !metrics.length && !fields.length) {
    el.innerHTML = `<div class="card">
      <h2>Welcome</h2>
      <p>This dashboard keeps your health data on this phone only. Nothing is uploaded.</p>
      <ul class="list">
        <li><a href="#/labs/new">Add a lab result</a></li>
        <li><a href="#/log">Set up a daily log</a></li>
        <li><a href="#/metrics/import">Import wearable data (CSV)</a></li>
        <li><a href="#/settings">Restore a backup, or load fake demo data to explore</a></li>
      </ul></div>`;
    return;
  }

  // Candidate tiles: wearable metrics and numeric/scale log fields.
  const activeFields = fields.filter((f) => !f.archived && (f.type === 'number' || f.type === 'scale'));
  const candidates = [
    ...[...groupBy(metrics, (m) => m.metric).entries()].map(([metric, items]) => ({
      key: `metric:${metric}`, label: prettyName(metric), unit: '', href: '#/metrics',
      points: items.map((m) => ({ date: m.date, value: m.value })),
    })),
    ...activeFields.map((f) => ({
      key: `log:${f.id}`, label: f.name, unit: f.unit || (f.type === 'scale' ? '/10' : ''), href: '#/log/history',
      points: entries.filter((e) => e.fieldId === f.id).map((e) => ({ date: e.date, value: Number(e.value) })),
    })),
  ];
  const chosen = starred.length
    ? starred.map((k) => candidates.find((c) => c.key === k)).filter(Boolean)
    : candidates.slice(0, MAX_DEFAULT_TILES);

  const tiles = chosen.map((c) => {
    const pts = c.points.filter((p) => inRange(p.date, start)).sort(byDate);
    const last = pts[pts.length - 1];
    const avg = mean(pts.map((p) => p.value));
    return `<a class="tile" href="${c.href}" style="color:inherit;text-decoration:none">
      <div class="label">${esc(c.label)}</div>
      <div class="value">${last ? fmtNum(last.value, 1) : '–'}<small style="font-size:.85rem;font-weight:500"> ${esc(c.unit)}</small></div>
      <div class="sub">${last ? `avg ${fmtNum(avg, 1)} · ${fmtDate(last.date, { year: false })}` : 'no data in range'}</div>
      ${sparkline(pts.map((p) => p.value))}
    </a>`;
  }).join('');

  // Lab flags: latest result per test within the range.
  const labGroups = latestByTest(labs.filter((l) => inRange(l.date, start)));
  const flagged = labGroups.filter((g) => ['low', 'high'].includes(rangeStatus(g.latest.value, g.latest.low, g.latest.high)));
  const okCount = labGroups.length - flagged.length;

  // Today's log progress.
  const today = todayISO();
  const logFields = fields.filter((f) => !f.archived);
  const doneToday = new Set(entries.filter((e) => e.date === today).map((e) => e.fieldId));
  const loggedToday = logFields.filter((f) => doneToday.has(f.id)).length;

  el.innerHTML = `
    <div class="row" style="margin-bottom:1rem">${segControl('range', range)}</div>

    ${logFields.length ? `<a class="card row" href="#/log" style="color:inherit;text-decoration:none">
      <span class="grow"><strong>Today's log</strong><br><small>${loggedToday} of ${logFields.length} fields filled</small></span>
      <span class="btn btn-primary btn-sm">${loggedToday ? 'Continue' : 'Log today'}</span></a>` : ''}

    <section class="card">
      <div class="card-head"><h2>Lab flags</h2><a href="#/labs">All labs</a></div>
      ${!labGroups.length ? '<p class="muted">No lab results in this period.</p>' : `
        <p class="muted">Latest result per test in this period: ${flagged.length} out of range, ${okCount} in range or without a range.</p>
        ${flagged.length ? `<ul class="list">${flagged.map(({ test, latest }) => `<li>
          <a class="grow" href="#/labs/test/${encodeURIComponent(test)}" style="color:inherit;text-decoration:none">
          <strong>${esc(test)}</strong> <span class="num">${fmtNum(latest.value)} ${esc(latest.units)}</span><br>
          <small>${fmtDate(latest.date)} · ref ${esc(rangeText(latest.low, latest.high))}</small></a>
          ${statusBadge(rangeStatus(latest.value, latest.low, latest.high))}</li>`).join('')}</ul>`
          : '<p><span class="badge badge-ok">All in range</span></p>'}`}
    </section>

    <section>
      <div class="card-head"><h2>Key metrics</h2>
        <small class="muted">${starred.length ? 'Starred metrics' : 'Star metrics on Wearables or Log history to choose'}</small></div>
      ${chosen.length ? `<div class="tiles">${tiles}</div>` : '<div class="card empty-state">No metrics yet.</div>'}
    </section>`;

  el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', async () => {
    range = b.dataset.range;
    await render(el);
  }));
}
