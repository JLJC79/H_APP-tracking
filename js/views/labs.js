// Lab results: grouped list with flags, per-test trend chart, add/edit form.
// Routes: #/labs · #/labs/test/<name> · #/labs/new[/<name>] · #/labs/edit/<id>
import { getAll, get, put, remove } from '../db.js';
import { lineChart, dataTable } from '../chart.js';
import {
  esc, uid, todayISO, fmtDate, fmtNum, toNum, rangeStatus, statusBadge, rangeText,
  groupBy, byDate, segControl, rangeStart, inRange, isValidISODate, toast,
} from '../util.js';

let detailRange = 'all';

const href = (...parts) => '#/labs/' + parts.map(encodeURIComponent).join('/');

/** Latest entry per test, sorted by test name. */
export function latestByTest(labs) {
  const groups = groupBy(labs, (l) => l.test);
  return [...groups.entries()].map(([test, items]) => {
    const sorted = items.sort(byDate);
    return { test, items: sorted, latest: sorted[sorted.length - 1] };
  }).sort((a, b) => a.test.localeCompare(b.test));
}

export async function render(el, params) {
  const [mode, arg] = params;
  if (mode === 'test') return renderDetail(el, arg);
  if (mode === 'new') return renderForm(el, null, arg);
  if (mode === 'edit') return renderForm(el, await get('labs', arg));
  return renderList(el);
}

export function afterMount(el) {
  const c = el.querySelector('[data-chart]');
  if (c && c._pending) lineChart(c, c._pending);
}

async function renderList(el) {
  const groups = latestByTest(await getAll('labs'));
  const flagged = groups.filter((g) => ['low', 'high'].includes(rangeStatus(g.latest.value, g.latest.low, g.latest.high)));

  if (!groups.length) {
    el.innerHTML = `<div class="card empty-state">
      <h2>No lab results yet</h2>
      <p>Add results by hand, or import a backup file in Settings.</p>
      <a class="btn btn-primary" href="#/labs/new">Add a result</a></div>`;
    return;
  }

  el.innerHTML = `
    <div class="row" style="margin-bottom:1rem">
      <p class="grow" style="margin:0">${groups.length} test${groups.length === 1 ? '' : 's'} ·
        ${flagged.length ? `<strong class="error" style="display:inline">${flagged.length} out of range</strong> (latest)` : 'all latest results in range'}</p>
      <a class="btn btn-primary" href="#/labs/new">+ Add</a>
    </div>
    <div class="field"><label for="lab-filter">Filter tests</label>
      <input id="lab-filter" type="search" placeholder="Type to filter" autocomplete="off"></div>
    <div class="card"><ul class="list" id="lab-list">
      ${groups.map(({ test, items, latest }) => {
        const st = rangeStatus(latest.value, latest.low, latest.high);
        return `<li data-test="${esc(test.toLowerCase())}">
          <a class="grow" href="${href('test', test)}" style="text-decoration:none;color:inherit">
            <strong>${esc(test)}</strong><br>
            <span class="num">${fmtNum(latest.value)} ${esc(latest.units)}</span>
            <small> · ${fmtDate(latest.date)} · ref ${esc(rangeText(latest.low, latest.high))} · ${items.length} result${items.length === 1 ? '' : 's'}</small>
          </a>${statusBadge(st)}</li>`;
      }).join('')}
    </ul></div>`;

  el.querySelector('#lab-filter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('#lab-list li').forEach((li) => { li.hidden = q && !li.dataset.test.includes(q); });
  });
}

async function renderDetail(el, test) {
  const all = (await getAll('labs')).filter((l) => l.test === test).sort(byDate);
  if (!all.length) {
    el.innerHTML = `<div class="card empty-state"><p>No results for “${esc(test)}”.</p><a class="btn" href="#/labs">Back to lab results</a></div>`;
    return;
  }
  const start = rangeStart(detailRange);
  const items = all.filter((l) => inRange(l.date, start));
  const latest = all[all.length - 1];
  const units = latest.units || '';
  const points = items.map((l) => ({ date: l.date, value: l.value, low: l.low, high: l.high }));

  el.innerHTML = `
    <p><a href="#/labs">← All lab results</a></p>
    <div class="card">
      <div class="card-head"><h2>${esc(test)}</h2>${statusBadge(rangeStatus(latest.value, latest.low, latest.high))}</div>
      <p class="muted">Latest ${fmtNum(latest.value)} ${esc(units)} on ${fmtDate(latest.date)} · reference ${esc(rangeText(latest.low, latest.high, units))}</p>
      <div class="row" style="margin-bottom:.5rem">${segControl('range', detailRange)}</div>
      <div data-chart></div>
      <div class="chart-legend"><span><span class="sw" style="background:var(--band);border:1px dashed var(--ok)"></span>Reference range (latest)</span>
        <span><span class="sw" style="background:var(--danger)"></span>Out of range</span></div>
      ${dataTable(points, units)}
    </div>
    <div class="card">
      <div class="card-head"><h3>Results</h3><a class="btn btn-sm btn-primary" href="${href('new', test)}">+ Add</a></div>
      <ul class="list">${[...all].reverse().map((l) => {
        const st = rangeStatus(l.value, l.low, l.high);
        return `<li><a class="grow" href="${href('edit', l.id)}" style="text-decoration:none;color:inherit">
          <span class="num"><strong>${fmtNum(l.value)} ${esc(l.units)}</strong></span>
          <small> · ${fmtDate(l.date)} · ref ${esc(rangeText(l.low, l.high))}</small>
          ${l.notes ? `<br><small>${esc(l.notes)}</small>` : ''}</a>${statusBadge(st)}</li>`;
      }).join('')}</ul>
    </div>`;

  const chartEl = el.querySelector('[data-chart]');
  chartEl._pending = { points, low: latest.low ?? null, high: latest.high ?? null, unit: units, label: test };

  el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', async () => {
    detailRange = b.dataset.range;
    await renderDetail(el, test);
    afterMount(el);
  }));
}

async function renderForm(el, entry, prefillTest) {
  const labs = await getAll('labs');
  const tests = latestByTest(labs);
  const isEdit = Boolean(entry);
  let e = entry || { test: prefillTest || '', value: null, units: '', low: null, high: null, date: todayISO(), notes: '' };
  if (!isEdit && prefillTest) {
    const t = tests.find((g) => g.test === prefillTest);
    if (t) e = { ...e, units: t.latest.units, low: t.latest.low, high: t.latest.high };
  }
  const v = (n) => (n === null || n === undefined ? '' : n);

  el.innerHTML = `
    <p><a href="${e.test ? href('test', e.test) : '#/labs'}">← Back</a></p>
    <form class="card" id="lab-form" novalidate>
      <h2>${isEdit ? 'Edit result' : 'Add lab result'}</h2>
      <div class="field"><label for="f-test">Test name</label>
        <input id="f-test" name="test" list="test-names" required value="${esc(e.test)}" autocomplete="off" autocapitalize="words">
        <datalist id="test-names">${tests.map((t) => `<option value="${esc(t.test)}">`).join('')}</datalist>
        <p class="hint">Pick an existing test to reuse its units and reference range.</p></div>
      <div class="grid-2">
        <div class="field"><label for="f-value">Value</label>
          <input id="f-value" name="value" inputmode="decimal" required value="${v(e.value)}"></div>
        <div class="field"><label for="f-units">Units</label>
          <input id="f-units" name="units" value="${esc(e.units)}" autocomplete="off"></div>
        <div class="field"><label for="f-low">Reference low</label>
          <input id="f-low" name="low" inputmode="decimal" value="${v(e.low)}"></div>
        <div class="field"><label for="f-high">Reference high</label>
          <input id="f-high" name="high" inputmode="decimal" value="${v(e.high)}"></div>
      </div>
      <div class="field"><label for="f-date">Date</label>
        <input id="f-date" name="date" type="date" required value="${esc(e.date)}"></div>
      <div class="field"><label for="f-notes">Notes</label>
        <textarea id="f-notes" name="notes">${esc(e.notes)}</textarea></div>
      <p class="error" id="form-error" role="alert"></p>
      <div class="row">
        <button class="btn btn-primary grow" type="submit">Save</button>
        ${isEdit ? '<button class="btn btn-danger" type="button" id="del">Delete</button>' : ''}
      </div>
    </form>`;

  const form = el.querySelector('#lab-form');
  form.test.addEventListener('change', () => {
    const t = tests.find((g) => g.test.toLowerCase() === form.test.value.trim().toLowerCase());
    if (!t) return;
    form.test.value = t.test;
    if (!form.units.value) form.units.value = t.latest.units || '';
    if (!form.low.value && t.latest.low != null) form.low.value = t.latest.low;
    if (!form.high.value && t.latest.high != null) form.high.value = t.latest.high;
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = form.querySelector('#form-error');
    const rec = {
      id: isEdit ? e.id : uid(),
      test: form.test.value.trim(),
      value: toNum(form.value.value),
      units: form.units.value.trim(),
      low: toNum(form.low.value),
      high: toNum(form.high.value),
      date: form.date.value,
      notes: form.notes.value.trim(),
    };
    if (!rec.test) { err.textContent = 'Enter a test name.'; form.test.focus(); return; }
    if (rec.value === null) { err.textContent = 'Enter a numeric value.'; form.value.focus(); return; }
    if (form.low.value.trim() && rec.low === null) { err.textContent = 'Reference low must be a number.'; return; }
    if (form.high.value.trim() && rec.high === null) { err.textContent = 'Reference high must be a number.'; return; }
    if (rec.low !== null && rec.high !== null && rec.low > rec.high) { err.textContent = 'Reference low is above reference high.'; return; }
    if (!isValidISODate(rec.date)) { err.textContent = 'Enter a valid date.'; return; }
    await put('labs', rec);
    toast('Saved');
    location.hash = href('test', rec.test);
  });

  const del = el.querySelector('#del');
  if (del) del.addEventListener('click', async () => {
    if (!confirm(`Delete this ${e.test} result from ${fmtDate(e.date)}?`)) return;
    await remove('labs', e.id);
    toast('Deleted');
    location.hash = href('test', e.test);
  });
}
