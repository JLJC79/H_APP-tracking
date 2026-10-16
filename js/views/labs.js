// Lab results: grouped list with flags, per-test trend chart, add/edit form.
// Routes: #/labs · #/labs/test/<name> · #/labs/new[/<name>] · #/labs/edit/<id> · #/labs/visit · #/labs/import
import { getAll, get, put, putMany, remove } from '../db.js';
import { lineChart, dataTable } from '../chart.js';
import { prepareLabFile, labFileCard, saveTicked } from '../labfiles.js';
import {
  esc, uid, todayISO, fmtDate, fmtNum, toNum, rangeStatus, statusBadge, rangeText,
  groupBy, byDate, segControl, rangeStart, inRange, isValidISODate, toast, readFileText,
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
  if (mode === 'visit') return renderVisit(el);
  if (mode === 'import') return renderLabImport(el);
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
      <div class="row" style="justify-content:center">
        <a class="btn btn-primary" href="#/labs/visit">Add a visit</a>
        <a class="btn" href="#/labs/new">Add one result</a>
        <a class="btn" href="#/labs/import">Import lab file</a></div></div>`;
    return;
  }

  el.innerHTML = `
    <div class="row" style="margin-bottom:1rem">
      <p class="grow" style="margin:0">${groups.length} test${groups.length === 1 ? '' : 's'} ·
        ${flagged.length ? `<strong class="error" style="display:inline">${flagged.length} out of range</strong> (latest)` : 'all latest results in range'}</p>
      <a class="btn" href="#/labs/new">+ Add</a>
      <a class="btn" href="#/labs/import">Import</a>
      <a class="btn btn-primary" href="#/labs/visit">+ Visit</a>
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

// ---- Visit form: several results from one doctor visit, saved together ----

async function renderVisit(el) {
  const labs = await getAll('labs');
  const tests = latestByTest(labs);
  const known = new Map(tests.map((t) => [t.test.toLowerCase(), t]));
  const visits = [...groupBy(labs, (l) => l.date).entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const v = (n) => (n === null || n === undefined ? '' : n);

  const rowHtml = (r = {}) => `<div class="visit-row">
      <div class="row"><div class="field grow" style="margin:0"><label aria-hidden="true">Test</label>
        <input name="test" aria-label="Test" list="test-names" value="${esc(r.test || '')}" autocomplete="off" autocapitalize="words"></div>
        <button class="btn btn-sm btn-ghost" type="button" data-remove aria-label="Remove this row">✕</button></div>
      <div class="grid-4">
        <div class="field"><label aria-hidden="true">Value</label><input name="value" aria-label="Value" inputmode="decimal" value="${v(r.value)}"></div>
        <div class="field"><label aria-hidden="true">Units</label><input name="units" aria-label="Units" value="${esc(r.units || '')}" autocomplete="off"></div>
        <div class="field"><label aria-hidden="true">Ref low</label><input name="low" aria-label="Ref low" inputmode="decimal" value="${v(r.low)}"></div>
        <div class="field"><label aria-hidden="true">Ref high</label><input name="high" aria-label="Ref high" inputmode="decimal" value="${v(r.high)}"></div>
      </div></div>`;

  el.innerHTML = `
    <p><a href="#/labs">← All lab results</a></p>
    <form class="card" id="visit-form" novalidate>
      <h2>Add a visit</h2>
      <p class="muted">Enter all results from one visit or lab report. Rows without a value are ignored.</p>
      <div class="grid-2">
        <div class="field"><label for="v-date">Date</label>
          <input id="v-date" name="date" type="date" required value="${esc(todayISO())}"></div>
        <div class="field"><label for="v-clinic">Clinic / lab</label>
          <input id="v-clinic" name="clinic" autocomplete="off" autocapitalize="words" placeholder="Optional"></div>
      </div>
      ${visits.length ? `<div class="field"><label for="v-repeat">Repeat tests from a previous visit</label>
        <select id="v-repeat"><option value="">Choose a date…</option>
          ${visits.map(([d, items]) => `<option value="${esc(d)}">${fmtDate(d)} · ${items.length} test${items.length === 1 ? '' : 's'}</option>`).join('')}
        </select><p class="hint">Fills in the test names, units and ranges; you only type the new values.</p></div>` : ''}
      <datalist id="test-names">${tests.map((t) => `<option value="${esc(t.test)}">`).join('')}</datalist>
      <div id="rows">${rowHtml()}${rowHtml()}${rowHtml()}</div>
      <button class="btn" type="button" id="add-row" style="width:100%;margin-bottom:.85rem">+ Add another test</button>
      <p class="error" id="form-error" role="alert"></p>
      <button class="btn btn-primary" type="submit" style="width:100%">Save all</button>
    </form>`;

  const form = el.querySelector('#visit-form');
  const rowsEl = el.querySelector('#rows');
  const rowEls = () => [...rowsEl.querySelectorAll('.visit-row')];
  const q = (row, name) => row.querySelector(`[name="${name}"]`);
  const isBlank = (row) => ['test', 'value', 'units', 'low', 'high'].every((n) => !q(row, n).value.trim());

  const fillFromKnown = (row) => {
    const t = known.get(q(row, 'test').value.trim().toLowerCase());
    if (!t) return;
    q(row, 'test').value = t.test;
    if (!q(row, 'units').value) q(row, 'units').value = t.latest.units || '';
    if (!q(row, 'low').value && t.latest.low != null) q(row, 'low').value = t.latest.low;
    if (!q(row, 'high').value && t.latest.high != null) q(row, 'high').value = t.latest.high;
  };
  rowsEl.addEventListener('change', (e) => { if (e.target.name === 'test') fillFromKnown(e.target.closest('.visit-row')); });
  rowsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    b.closest('.visit-row').remove();
    if (!rowEls().length) rowsEl.insertAdjacentHTML('beforeend', rowHtml());
  });
  el.querySelector('#add-row').addEventListener('click', () => {
    rowsEl.insertAdjacentHTML('beforeend', rowHtml());
    const rs = rowEls();
    q(rs[rs.length - 1], 'test').focus();
  });

  const repeat = el.querySelector('#v-repeat');
  if (repeat) repeat.addEventListener('change', () => {
    const date = repeat.value;
    if (!date) return;
    const have = new Set(rowEls().map((r) => q(r, 'test').value.trim().toLowerCase()).filter(Boolean));
    rowEls().filter(isBlank).forEach((r) => r.remove());
    const names = [...new Set(labs.filter((l) => l.date === date).map((l) => l.test))].sort((a, b) => a.localeCompare(b));
    const add = names.filter((n) => !have.has(n.toLowerCase())).map((n) => {
      const t = known.get(n.toLowerCase()).latest; // latest units/range, which may have changed since
      return rowHtml({ test: n, units: t.units, low: t.low, high: t.high });
    });
    rowsEl.insertAdjacentHTML('beforeend', add.join(''));
    if (!rowEls().length) rowsEl.insertAdjacentHTML('beforeend', rowHtml());
    toast(`Added ${add.length} test${add.length === 1 ? '' : 's'}`);
    repeat.value = '';
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = form.querySelector('#form-error');
    err.textContent = '';
    rowEls().forEach((r) => r.classList.remove('row-error'));
    const date = form.date.value;
    if (!isValidISODate(date)) { err.textContent = 'Enter a valid date.'; form.date.focus(); return; }
    const notes = form.clinic.value.trim();
    const recs = [];
    const seen = new Set();
    for (const [i, row] of rowEls().entries()) {
      const raw = (n) => q(row, n).value.trim();
      if (!raw('value')) continue; // blank value: row ignored
      const fail = (msg, field) => { row.classList.add('row-error'); err.textContent = `Row ${i + 1}: ${msg}`; q(row, field).focus(); };
      const rec = {
        id: uid(), test: raw('test'), value: toNum(raw('value')), units: raw('units'),
        low: toNum(raw('low')), high: toNum(raw('high')), date, notes,
      };
      if (!rec.test) return fail('enter a test name.', 'test');
      if (rec.value === null) return fail('the value must be a number.', 'value');
      if (raw('low') && rec.low === null) return fail('reference low must be a number.', 'low');
      if (raw('high') && rec.high === null) return fail('reference high must be a number.', 'high');
      if (rec.low !== null && rec.high !== null && rec.low > rec.high) return fail('reference low is above reference high.', 'low');
      if (seen.has(rec.test.toLowerCase())) return fail(`${rec.test} is entered twice.`, 'test');
      seen.add(rec.test.toLowerCase());
      recs.push(rec);
    }
    if (!recs.length) { err.textContent = 'Enter at least one value.'; return; }
    await putMany('labs', recs);
    toast(`Saved ${recs.length} result${recs.length === 1 ? '' : 's'}`);
    location.hash = '#/labs';
  });
}

// ---- Import lab results files (e.g. written by Cowork), reviewed before saving ----

async function renderLabImport(el) {
  el.innerHTML = `
    <p><a href="#/labs">← All lab results</a></p>
    <div class="card">
      <h2>Import lab results file</h2>
      <p>Choose one or more lab results files (<em>.json</em>, for example the ones Cowork writes from your pathology reports).
        On Android, tap <strong>Browse</strong> and pick <strong>OneDrive</strong> to open them straight from your OneDrive.
        Nothing is saved until you review each file.</p>
      <div class="field"><label for="lab-files">Lab results files</label>
        <input id="lab-files" type="file" multiple accept=".json,application/json"></div>
      <p class="error" id="lab-file-error" role="alert"></p>
    </div>
    <div id="reviews"></div>`;
  const reviews = el.querySelector('#reviews');
  let files = [];
  const draw = () => {
    reviews.innerHTML = files.map((f, i) => (f ? labFileCard(f, i) : '')).join('');
    if (files.length && files.every((f) => !f)) reviews.innerHTML = '<div class="card"><p>All files done.</p><a class="btn btn-primary" href="#/labs">View lab results</a></div>';
    reviews.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => {
      const i = +b.dataset.save;
      b.disabled = true;
      const n = await saveTicked(b.closest('.card'), files[i]);
      toast(`Saved ${n} result${n === 1 ? '' : 's'}`);
      files[i] = null;
      draw();
    }));
    reviews.querySelectorAll('[data-later]').forEach((b) => b.addEventListener('click', () => {
      files[+b.dataset.later] = null;
      draw();
    }));
  };
  el.querySelector('#lab-files').addEventListener('change', async (e) => {
    const err = el.querySelector('#lab-file-error');
    const problems = [];
    files = [];
    for (const file of e.target.files) {
      try { files.push(await prepareLabFile(file.name, await readFileText(file))); }
      catch (ex) { problems.push(`${file.name}: ${ex.message}`); }
    }
    err.textContent = problems.join(' · ');
    draw();
  });
}
