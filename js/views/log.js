// Daily log: user-defined fields, one-handed quick entry, history charts.
// Routes: #/log[/YYYY-MM-DD] · #/log/history · #/log/fields · #/log/fields/<id>
import { getAll, get, put, putMany, remove, removeByIndex, getAllByIndex, getSetting } from '../db.js';
import { lineChart, dataTable } from '../chart.js';
import { toggleOverviewKey } from './metrics.js';
import {
  esc, uid, todayISO, addDays, fmtDate, fmtNum, toNum, isValidISODate, segControl, rangeStart,
  inRange, byDate, mean, toast,
} from '../util.js';

export const FIELD_TYPES = {
  number: 'Number',
  scale: 'Scale 1–10',
  bool: 'Yes / No',
  text: 'Text',
};

const SUGGESTED = [
  { name: 'Mood', type: 'scale' },
  { name: 'Energy', type: 'scale' },
  { name: 'Sleep', type: 'number', unit: 'h', step: 0.5 },
  { name: 'Weight', type: 'number', unit: 'kg', step: 0.1 },
  { name: 'Exercised', type: 'bool' },
  { name: 'Notes', type: 'text' },
];

let day = null;
let range = '1m';

export async function activeFields() {
  return (await getAll('logFields')).filter((f) => !f.archived).sort((a, b) => a.order - b.order);
}

function subnav(current) {
  const item = (key, label, hrefStr) => `<a class="btn btn-sm${current === key ? ' btn-primary' : ''}" href="${hrefStr}" ${current === key ? 'aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="row" aria-label="Daily log" style="margin-bottom:.75rem">
    ${item('entry', 'Entry', '#/log')}${item('history', 'History', '#/log/history')}${item('fields', 'Fields', '#/log/fields')}</nav>`;
}

export async function render(el, params) {
  const [p0, p1] = params;
  if (p0 === 'history') return renderHistory(el);
  if (p0 === 'fields') return p1 ? renderFieldForm(el, p1 === 'new' ? null : await get('logFields', p1)) : renderFields(el);
  if (p0 && isValidISODate(p0)) day = p0;
  return renderEntry(el);
}

export function afterMount(el) {
  el.querySelectorAll('[data-chart]').forEach((c) => c._pending && lineChart(c, c._pending));
}

// ---- Quick entry -----------------------------------------------------------

async function renderEntry(el) {
  if (!day) day = todayISO();
  const fields = await activeFields();
  const entries = new Map((await getAllByIndex('logEntries', 'date', day)).map((e) => [e.fieldId, e.value]));
  // Most recent earlier value per number field: the stepper starts from it when today is empty.
  const prev = new Map();
  for (const f of fields.filter((x) => x.type === 'number')) {
    const before = (await getAllByIndex('logEntries', 'fieldId', f.id)).filter((e) => e.date < day).sort(byDate);
    if (before.length) prev.set(f.id, before[before.length - 1].value);
  }

  if (!fields.length) {
    el.innerHTML = `${subnav('entry')}<div class="card empty-state">
      <h2>Set up your daily log</h2>
      <p>Choose what you want to track each day. You can change these at any time.</p>
      <button class="btn btn-primary btn-block" id="suggest">Add suggested fields</button>
      <p class="hint">Mood, Energy (1–10), Sleep (h), Weight (kg), Exercised (yes/no), Notes</p>
      <a class="btn btn-block" style="margin-top:.5rem" href="#/log/fields/new">Create my own field</a></div>`;
    el.querySelector('#suggest').addEventListener('click', async () => {
      await putMany('logFields', SUGGESTED.map((f, i) => ({ id: uid(), unit: '', step: 1, ...f, order: i, archived: false })));
      await renderEntry(el);
    });
    return;
  }

  const isToday = day === todayISO();
  el.innerHTML = `${subnav('entry')}
    <div class="qe-date">
      <button class="btn" id="prev" aria-label="Previous day">‹</button>
      <div><input id="qe-day" type="date" value="${day}" max="${todayISO()}" aria-label="Date"></div>
      <button class="btn" id="next" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button>
    </div>
    <p class="muted" style="text-align:center;margin:.25rem 0 .75rem">${isToday ? 'Today' : fmtDate(day)} · changes save automatically</p>
    ${fields.map((f) => fieldControl(f, entries.get(f.id), prev.get(f.id))).join('')}`;

  const go = (d) => { location.hash = `#/log/${d}`; };
  el.querySelector('#prev').addEventListener('click', () => go(addDays(day, -1)));
  el.querySelector('#next').addEventListener('click', () => { if (!isToday) go(addDays(day, 1)); });
  el.querySelector('#qe-day').addEventListener('change', (e) => { if (isValidISODate(e.target.value)) go(e.target.value); });

  for (const f of fields) bindField(el.querySelector(`[data-field="${f.id}"]`), f);
}

function fieldControl(f, value, prevValue) {
  const label = `<div class="qe-label"><span id="lbl-${f.id}">${esc(f.name)}${f.unit ? ` <small>(${esc(f.unit)})</small>` : ''}</span><span class="qe-saved" aria-live="polite"></span></div>`;
  let control = '';
  if (f.type === 'scale') {
    control = `<div class="scale" role="group" aria-labelledby="lbl-${f.id}">${Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
      `<button type="button" data-v="${n}" aria-pressed="${value === n}">${n}</button>`).join('')}</div>`;
  } else if (f.type === 'bool') {
    control = `<div class="yn" role="group" aria-labelledby="lbl-${f.id}">
      <button type="button" data-v="true" aria-pressed="${value === true}">Yes</button>
      <button type="button" data-v="false" aria-pressed="${value === false}">No</button></div>`;
  } else if (f.type === 'number') {
    control = `<div class="stepper">
      <button type="button" data-step="-1" aria-label="Decrease ${esc(f.name)}">−</button>
      <input type="text" inputmode="decimal" aria-labelledby="lbl-${f.id}" value="${value ?? ''}" placeholder="${prevValue !== undefined ? 'last ' + prevValue : '–'}" data-prev="${prevValue ?? ''}">
      <button type="button" data-step="1" aria-label="Increase ${esc(f.name)}">+</button></div>
      ${value !== undefined ? '<button type="button" class="btn btn-sm btn-ghost clear-btn" data-clear>Clear</button>' : ''}`;
  } else {
    control = `<textarea aria-labelledby="lbl-${f.id}" placeholder="Optional">${esc(value ?? '')}</textarea>`;
  }
  return `<div class="qe-field" data-field="${f.id}">${label}${control}</div>`;
}

async function saveValue(fieldId, value) {
  const id = `${day}|${fieldId}`;
  if (value === null || value === '' || value === undefined) await remove('logEntries', id);
  else await put('logEntries', { id, date: day, fieldId, value });
}

function bindField(box, f) {
  const savedEl = box.querySelector('.qe-saved');
  let flashTimer;
  const flash = (msg = 'Saved ✓') => {
    savedEl.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { savedEl.textContent = ''; }, 1500);
  };

  if (f.type === 'scale' || f.type === 'bool') {
    box.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => {
      const wasOn = b.getAttribute('aria-pressed') === 'true';
      box.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      const v = f.type === 'scale' ? Number(b.dataset.v) : b.dataset.v === 'true';
      if (wasOn) { await saveValue(f.id, null); flash('Cleared'); return; } // tap again to clear
      b.setAttribute('aria-pressed', 'true');
      await saveValue(f.id, v);
      flash();
    }));
  } else if (f.type === 'number') {
    const input = box.querySelector('input');
    const commit = async () => {
      const raw = input.value.trim();
      const n = toNum(raw);
      if (raw && n === null) { flash('Not a number'); return; }
      await saveValue(f.id, n);
      flash(n === null ? 'Cleared' : 'Saved ✓');
    };
    input.addEventListener('change', commit);
    box.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const step = Number(f.step) || 1;
      const cur = toNum(input.value);
      const base = cur ?? toNum(input.dataset.prev);
      const next = base === null ? 0 : cur === null ? base : base + step * Number(b.dataset.step);
      input.value = String(Math.round(next * 1000) / 1000);
      commit();
    }));
    const clear = box.querySelector('[data-clear]');
    if (clear) clear.addEventListener('click', () => { input.value = ''; commit(); });
  } else {
    const ta = box.querySelector('textarea');
    let t;
    ta.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => { await saveValue(f.id, ta.value.trim()); flash(); }, 600);
    });
    ta.addEventListener('blur', async () => { clearTimeout(t); await saveValue(f.id, ta.value.trim()); });
  }
}

// ---- History -----------------------------------------------------------------

async function renderHistory(el) {
  const fields = await activeFields();
  const entries = await getAll('logEntries');
  const starred = new Set(await getSetting('overviewKeys', []));
  const start = rangeStart(range);
  const inR = entries.filter((e) => inRange(e.date, start));

  el.innerHTML = `${subnav('history')}
    <div style="margin-bottom:1rem">${segControl('range', range)}</div>
    ${fields.length ? '' : '<div class="card empty-state">No fields yet.</div>'}
    ${fields.map((f) => {
      const es = inR.filter((e) => e.fieldId === f.id).sort(byDate);
      const key = `log:${f.id}`;
      const star = f.type === 'number' || f.type === 'scale'
        ? `<button class="btn btn-sm btn-ghost" data-star="${key}" aria-pressed="${starred.has(key)}">${starred.has(key) ? '★ On overview' : '☆ Overview'}</button>` : '';
      let body;
      if (f.type === 'number' || f.type === 'scale') {
        const pts = es.map((e) => ({ date: e.date, value: Number(e.value) }));
        body = `<p class="muted">${es.length} entries · average ${fmtNum(mean(pts.map((p) => p.value)))} ${esc(f.unit || '')}</p>
          <div data-chart data-field="${f.id}"></div>${dataTable(pts, f.unit || '')}`;
      } else if (f.type === 'bool') {
        const yes = es.filter((e) => e.value === true).length;
        body = `<p><strong>Yes on ${yes} of ${es.length} logged day${es.length === 1 ? '' : 's'}</strong>${es.length ? ` (${Math.round((yes / es.length) * 100)}%)` : ''}</p>
          <div class="table-wrap"><p class="muted">${es.slice(-14).reverse().map((e) => `${fmtDate(e.date, { year: false })}: ${e.value ? 'Yes' : 'No'}`).join(' · ') || 'No entries in this range.'}</p></div>`;
      } else {
        body = es.length ? `<ul class="list">${es.slice(-10).reverse().map((e) => `<li><small style="min-width:5.5rem">${fmtDate(e.date)}</small><span>${esc(e.value)}</span></li>`).join('')}</ul>`
          : '<p class="muted">No entries in this range.</p>';
      }
      return `<section class="card"><div class="card-head"><h2>${esc(f.name)}</h2>${star}</div>${body}</section>`;
    }).join('')}`;

  el.querySelectorAll('[data-chart]').forEach((c) => {
    const f = fields.find((x) => x.id === c.dataset.field);
    const pts = inR.filter((e) => e.fieldId === f.id).map((e) => ({ date: e.date, value: Number(e.value) }));
    c._pending = { points: pts, unit: f.unit || '', label: f.name };
  });
  el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', async () => {
    range = b.dataset.range;
    await renderHistory(el);
    afterMount(el);
  }));
  el.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', async () => {
    const on = await toggleOverviewKey(b.dataset.star);
    b.setAttribute('aria-pressed', on);
    b.textContent = on ? '★ On overview' : '☆ Overview';
  }));
}

// ---- Field manager -------------------------------------------------------------

async function renderFields(el) {
  const all = (await getAll('logFields')).sort((a, b) => a.order - b.order);
  const active = all.filter((f) => !f.archived);
  const archived = all.filter((f) => f.archived);

  el.innerHTML = `${subnav('fields')}
    <div class="card">
      <div class="card-head"><h2>Fields</h2><a class="btn btn-sm btn-primary" href="#/log/fields/new">+ New field</a></div>
      ${active.length ? `<ul class="list">${active.map((f, i) => `<li>
        <a class="grow" href="#/log/fields/${f.id}" style="color:inherit;text-decoration:none"><strong>${esc(f.name)}</strong><br><small>${FIELD_TYPES[f.type]}${f.unit ? ' · ' + esc(f.unit) : ''}</small></a>
        <button class="btn btn-sm" data-move="${f.id}" data-dir="-1" aria-label="Move ${esc(f.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-sm" data-move="${f.id}" data-dir="1" aria-label="Move ${esc(f.name)} down" ${i === active.length - 1 ? 'disabled' : ''}>↓</button>
      </li>`).join('')}</ul>` : '<p class="muted">No active fields.</p>'}
    </div>
    ${archived.length ? `<div class="card"><h3>Archived</h3><p class="muted">Hidden from quick entry; their history is kept.</p>
      <ul class="list">${archived.map((f) => `<li><span class="grow">${esc(f.name)}</span>
        <button class="btn btn-sm" data-restore="${f.id}">Restore</button></li>`).join('')}</ul></div>` : ''}`;

  el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
    const i = active.findIndex((f) => f.id === b.dataset.move);
    const j = i + Number(b.dataset.dir);
    if (j < 0 || j >= active.length) return;
    [active[i], active[j]] = [active[j], active[i]];
    await putMany('logFields', active.map((f, k) => ({ ...f, order: k })));
    await renderFields(el);
  }));
  el.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
    const f = all.find((x) => x.id === b.dataset.restore);
    await put('logFields', { ...f, archived: false, order: active.length });
    await renderFields(el);
  }));
}

async function renderFieldForm(el, field) {
  const isEdit = Boolean(field);
  const f = field || { name: '', type: 'scale', unit: '', step: 1 };
  const count = isEdit ? (await getAllByIndex('logEntries', 'fieldId', f.id)).length : 0;

  el.innerHTML = `${subnav('fields')}
    <form class="card" id="field-form" novalidate>
      <h2>${isEdit ? 'Edit field' : 'New field'}</h2>
      <div class="field"><label for="ff-name">Name</label><input id="ff-name" name="fieldName" required value="${esc(f.name)}" autocapitalize="sentences"></div>
      <div class="field"><label for="ff-type">Type</label>
        <select id="ff-type" name="type" ${count ? 'disabled' : ''}>${Object.entries(FIELD_TYPES).map(([k, v]) => `<option value="${k}"${k === f.type ? ' selected' : ''}>${v}</option>`).join('')}</select>
        ${count ? `<p class="hint">Type can't change once there are entries (${count}).</p>` : ''}</div>
      <div id="num-opts" class="grid-2">
        <div class="field"><label for="ff-unit">Unit</label><input id="ff-unit" name="unit" value="${esc(f.unit || '')}" placeholder="e.g. kg, h, mg"></div>
        <div class="field"><label for="ff-step">Step for − / +</label><input id="ff-step" name="step" inputmode="decimal" value="${f.step ?? 1}"></div>
      </div>
      <p class="error" id="ff-error" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">Save</button>
      ${isEdit ? `<div class="row" style="margin-top:.75rem">
        <button class="btn grow" type="button" id="archive">Archive</button>
        <button class="btn btn-danger grow" type="button" id="delete">Delete</button></div>` : ''}
    </form>`;

  const form = el.querySelector('#field-form');
  const sync = () => { el.querySelector('#num-opts').hidden = form.type.value !== 'number'; };
  form.type.addEventListener('change', sync);
  sync();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.fieldName.value.trim();
    if (!name) { el.querySelector('#ff-error').textContent = 'Enter a name.'; return; }
    const type = form.type.value;
    const step = toNum(form.step.value);
    const rec = {
      ...f,
      id: isEdit ? f.id : uid(),
      name,
      type,
      unit: type === 'number' ? form.unit.value.trim() : '',
      step: type === 'number' && step && step > 0 ? step : 1,
      archived: Boolean(f.archived),
      order: isEdit ? f.order : (await activeFields()).length,
    };
    await put('logFields', rec);
    toast('Field saved');
    location.hash = '#/log/fields';
  });

  if (isEdit) {
    el.querySelector('#archive').addEventListener('click', async () => {
      await put('logFields', { ...f, archived: true });
      toast('Field archived');
      location.hash = '#/log/fields';
    });
    el.querySelector('#delete').addEventListener('click', async () => {
      if (!confirm(`Delete “${f.name}” and all ${count} of its entries? This cannot be undone. (Archive keeps the history.)`)) return;
      await removeByIndex('logEntries', 'fieldId', f.id);
      await remove('logFields', f.id);
      toast('Field deleted');
      location.hash = '#/log/fields';
    });
  }
}
