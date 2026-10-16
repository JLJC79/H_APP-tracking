// Wearable metrics: per-metric charts and the CSV importer with reusable column mappings.
// Routes: #/metrics · #/metrics/import
import { getAll, getAllByIndex, putMany, removeMany, removeByIndex, getSetting, setSetting } from '../db.js';
import { lineChart, dataTable } from '../chart.js';
import { parseCSV, parseDate, DATE_FORMATS, guessDateFormat, headerSignature, guessColumn, applyMapping } from '../csv.js';
import {
  esc, uid, fmtDate, fmtNum, groupBy, byDate, segControl, rangeStart, inRange, mean,
  readFileText, toast, prettyName,
} from '../util.js';

let range = '6m';
let imp = null; // { fileName, headers, rows }

export async function render(el, params) {
  if (params[0] === 'import') return renderImport(el);
  return renderList(el);
}

export function afterMount(el) {
  el.querySelectorAll('[data-chart]').forEach((c) => c._pending && lineChart(c, c._pending));
}

export async function toggleOverviewKey(key) {
  const keys = new Set(await getSetting('overviewKeys', []));
  if (keys.has(key)) keys.delete(key); else keys.add(key);
  await setSetting('overviewKeys', [...keys]);
  return keys.has(key);
}

/** Moves all values of one metric to another name (merging if it exists). Returns the count moved. */
async function renameMetric(from, to) {
  const rows = await getAllByIndex('metrics', 'metric', from);
  await putMany('metrics', rows.map((r) => ({ ...r, id: `${to}|${r.date}`, metric: to })));
  await removeMany('metrics', rows.map((r) => r.id));
  const keys = await getSetting('overviewKeys', []);
  if (keys.includes(`metric:${from}`)) {
    await setSetting('overviewKeys', [...new Set(keys.map((k) => (k === `metric:${from}` ? `metric:${to}` : k)))]);
  }
  return rows.length;
}

async function renderList(el) {
  const all = await getAll('metrics');
  const starred = new Set(await getSetting('overviewKeys', []));
  const groups = [...groupBy(all, (m) => m.metric).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const start = rangeStart(range);

  if (!groups.length) {
    el.innerHTML = `<div class="card empty-state">
      <h2>No wearable data yet</h2>
      <p>Export a CSV from your wearable's app (or Google Fit / Health Connect tools), then import it here.
      You map the columns once and the mapping is saved for next time.</p>
      <a class="btn btn-primary" href="#/metrics/import">Import CSV</a></div>`;
    return;
  }

  el.innerHTML = `
    <div class="row" style="margin-bottom:1rem">
      <div class="grow">${segControl('range', range)}</div>
      <a class="btn btn-primary" href="#/metrics/import">Import CSV</a>
    </div>
    ${groups.map(([metric, items]) => {
      const pts = items.filter((p) => inRange(p.date, start)).sort(byDate);
      const last = items.sort(byDate)[items.length - 1];
      const avg = mean(pts.map((p) => p.value));
      const key = `metric:${metric}`;
      return `<section class="card">
        <div class="card-head"><h2>${esc(prettyName(metric))}</h2>
          <button class="btn btn-sm btn-ghost" data-star="${esc(key)}" aria-pressed="${starred.has(key)}"
            aria-label="Show ${esc(prettyName(metric))} on overview">${starred.has(key) ? '★ On overview' : '☆ Overview'}</button></div>
        <p class="muted">Latest ${fmtNum(last.value)} on ${fmtDate(last.date)} · average in range ${fmtNum(avg)} · ${pts.length} day${pts.length === 1 ? '' : 's'}</p>
        <div data-chart data-metric="${esc(metric)}"></div>
        ${dataTable(pts)}
        <p class="hint">Stored as “${esc(metric)}”</p>
        <div class="row" style="margin-top:.5rem">
          <button class="btn btn-sm" data-rename="${esc(metric)}">Rename / merge</button>
          <button class="btn btn-sm btn-danger" data-del="${esc(metric)}">Delete all data</button>
        </div>
      </section>`;
    }).join('')}`;

  el.querySelectorAll('[data-chart]').forEach((c) => {
    const metric = c.dataset.metric;
    const pts = all.filter((p) => p.metric === metric && inRange(p.date, start));
    c._pending = { points: pts, label: prettyName(metric) };
  });
  el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', async () => {
    range = b.dataset.range;
    await renderList(el);
    afterMount(el);
  }));
  el.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', async () => {
    const on = await toggleOverviewKey(b.dataset.star);
    b.setAttribute('aria-pressed', on);
    b.textContent = on ? '★ On overview' : '☆ Overview';
  }));
  el.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', async () => {
    const from = b.dataset.rename;
    const others = groups.map(([k]) => k).filter((k) => k !== from);
    const to = (prompt(`Rename “${from}” to:\n(Use an existing name to merge — e.g. ${others.slice(0, 3).join(', ') || 'steps'}. Values on the same day are replaced.)`, from) || '').trim();
    if (!to || to === from) return;
    const n = await renameMetric(from, to);
    toast(`Moved ${n} values to “${to}”`);
    await renderList(el);
    afterMount(el);
  }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const metric = b.dataset.del;
    if (!confirm(`Delete all imported data for “${metric}”? This cannot be undone.`)) return;
    const n = await removeByIndex('metrics', 'metric', metric);
    toast(`Deleted ${n} values`);
    await renderList(el);
    afterMount(el);
  }));
}

// ---- Importer ------------------------------------------------------------

async function renderImport(el) {
  const mappings = await getSetting('csvMappings', []);
  if (!imp) {
    el.innerHTML = `
      <p><a href="#/metrics">← Wearables</a></p>
      <div class="card">
        <h2>Import wearable CSV</h2>
        <p>Choose a CSV exported from your wearable or health app. The file is read on this device only; nothing is uploaded.</p>
        <div class="field"><label for="csv-file">CSV file</label>
          <input id="csv-file" type="file" accept=".csv,text/csv,text/plain"></div>
        <p class="hint">Works with “long” files (one row per date + metric + value) and “wide” files (one row per date, one column per metric).</p>
        <p class="error" id="file-error" role="alert"></p>
      </div>
      ${mappingsCard(mappings)}`;
    el.querySelector('#csv-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const rows = parseCSV(await readFileText(file));
      if (rows.length < 2) {
        el.querySelector('#file-error').textContent = 'This file has no data rows.';
        return;
      }
      imp = { fileName: file.name, headers: rows[0], rows: rows.slice(1) };
      await renderImport(el);
    });
    bindMappingDeletes(el);
    return;
  }

  const { headers, rows, fileName } = imp;
  const sig = headerSignature(headers);
  const saved = mappings.find((m) => m.signature === sig);
  const m = saved || guessMapping(headers, rows);
  const opts = (sel) => headers.map((h, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('');
  const preview = rows.slice(0, 5);

  el.innerHTML = `
    <p><a href="#/metrics">← Wearables</a></p>
    <div class="card">
      <div class="card-head"><h2>Map columns</h2><button class="btn btn-sm" id="other-file">Other file</button></div>
      <p class="muted">${esc(fileName)} · ${rows.length} data rows</p>
      ${saved ? `<p class="badge badge-ok">Using saved mapping “${esc(saved.name)}”</p>` : ''}
      <details ${saved ? '' : 'open'}><summary>Preview first rows</summary>
        <div class="table-wrap preview"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${preview.map((r) => `<tr>${headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      </details>
    </div>
    <form class="card" id="map-form">
      <fieldset style="border:0;padding:0;margin:0 0 .85rem">
        <legend style="font-weight:600;font-size:.9rem;margin-bottom:.35rem">File layout</legend>
        <label class="check"><input type="radio" name="format" value="long" ${m.format === 'long' ? 'checked' : ''}> Long: date, metric, value columns</label>
        <label class="check"><input type="radio" name="format" value="wide" ${m.format === 'wide' ? 'checked' : ''}> Wide: one column per metric</label>
      </fieldset>
      <div class="field"><label for="m-date">Date column</label><select id="m-date" name="dateCol">${opts(m.dateCol)}</select></div>
      <div class="field"><label for="m-datefmt">Date format</label>
        <select id="m-datefmt" name="dateFormat">${DATE_FORMATS.map((f) => `<option value="${f.key}"${f.key === m.dateFormat ? ' selected' : ''}>${f.label}</option>`).join('')}</select>
        <p class="hint">First value: “<span id="date-sample"></span>” → <strong id="date-check"></strong></p></div>
      <div id="long-fields">
        <div class="field"><label for="m-metric">Metric name column</label><select id="m-metric" name="metricCol">${opts(m.metricCol)}</select></div>
        <div class="field"><label for="m-value">Value column</label><select id="m-value" name="valueCol">${opts(m.valueCol)}</select></div>
      </div>
      <fieldset id="wide-fields" style="border:0;padding:0;margin:0 0 .85rem">
        <legend style="font-weight:600;font-size:.9rem;margin-bottom:.35rem">Metric columns to import</legend>
        ${headers.map((h, i) => `<label class="check"><input type="checkbox" name="valueCols" value="${i}" ${m.valueCols.includes(i) ? 'checked' : ''}> ${esc(h || `Column ${i + 1}`)}</label>`).join('')}
      </fieldset>
      <div class="field"><label for="m-agg">If a metric has several values on one day</label>
        <select id="m-agg" name="agg">
          <option value="auto"${m.agg === 'auto' ? ' selected' : ''}>Automatic: add up steps, calories, distance, minutes; average the rest</option>
          <option value="mean"${m.agg === 'mean' ? ' selected' : ''}>Average them (heart rate, HRV)</option>
          <option value="sum"${m.agg === 'sum' ? ' selected' : ''}>Add them up (steps, minutes)</option>
          <option value="last"${m.agg === 'last' ? ' selected' : ''}>Keep the last one</option>
        </select></div>
      <div class="field"><label for="m-name">Mapping name</label>
        <input id="m-name" name="mapName" value="${esc(saved ? saved.name : fileName.replace(/\.[^.]+$/, ''))}"></div>
      <label class="check field"><input type="checkbox" name="save" checked> Save this mapping for files with the same columns</label>
      <p class="error" id="map-error" role="alert"></p>
      <div id="summary"></div>
      <div class="row"><button class="btn grow" type="button" id="check">Check</button>
        <button class="btn btn-primary grow" type="submit">Import</button></div>
    </form>`;

  const form = el.querySelector('#map-form');
  const read = () => ({
    id: saved ? saved.id : uid(),
    name: form.mapName.value.trim() || fileName,
    signature: sig,
    format: form.format.value,
    dateCol: +form.dateCol.value,
    dateFormat: form.dateFormat.value,
    metricCol: +form.metricCol.value,
    valueCol: +form.valueCol.value,
    valueCols: [...form.querySelectorAll('[name="valueCols"]:checked')].map((c) => +c.value),
    agg: form.agg.value,
  });
  const sync = () => {
    const cur = read();
    el.querySelector('#long-fields').hidden = cur.format !== 'long';
    el.querySelector('#wide-fields').hidden = cur.format !== 'wide';
    const d = parseDate(rows[0][cur.dateCol], cur.dateFormat);
    el.querySelector('#date-check').textContent = d ? fmtDate(d) : 'not recognised';
    el.querySelector('#date-sample').textContent = rows[0][cur.dateCol] ?? '';
  };
  const check = () => {
    const cur = read();
    const err = el.querySelector('#map-error');
    err.textContent = '';
    if (cur.format === 'wide' && !cur.valueCols.length) { err.textContent = 'Tick at least one metric column.'; return null; }
    const result = applyMapping(headers, rows, cur);
    const byMetric = groupBy(result.records, (r) => r.metric);
    el.querySelector('#summary').innerHTML = `<div class="card" style="background:var(--surface-2)">
      <p><strong>${result.records.length}</strong> daily values across <strong>${byMetric.size}</strong> metric${byMetric.size === 1 ? '' : 's'}${result.skipped ? ` · <span class="error" style="display:inline">${result.skipped} value${result.skipped === 1 ? '' : 's'} skipped</span> (unreadable date or number)` : ''}</p>
      <ul class="list">${[...byMetric.entries()].map(([k, v]) => {
        const s = v.sort(byDate);
        return `<li><span class="grow">${esc(k)}</span><small>${s.length} days · ${fmtDate(s[0].date)} – ${fmtDate(s[s.length - 1].date)}</small></li>`;
      }).join('')}</ul></div>`;
    if (!result.records.length) { err.textContent = 'Nothing could be read with this mapping. Check the columns and date format.'; return null; }
    return { cur, result };
  };

  form.addEventListener('change', sync);
  sync();
  el.querySelector('#check').addEventListener('click', check);
  el.querySelector('#other-file').addEventListener('click', async () => { imp = null; await renderImport(el); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = check();
    if (!ok) return;
    const { cur, result } = ok;
    await putMany('metrics', result.records.map((r) => ({ id: `${r.metric}|${r.date}`, ...r, source: fileName })));
    if (form.save.checked) {
      const list = (await getSetting('csvMappings', [])).filter((x) => x.signature !== sig);
      list.push(cur);
      await setSetting('csvMappings', list);
    }
    toast(`Imported ${result.records.length} values`);
    imp = null;
    location.hash = '#/metrics';
  });
}

function guessMapping(headers, rows) {
  const dateCol = guessColumn(headers, [/date/i, /day/i, /time/i]) ?? 0;
  const metricCol = guessColumn(headers, [/metric/i, /type/i, /name/i, /measure/i]);
  const valueCol = guessColumn(headers, [/^value$/i, /value/i, /amount/i, /qty/i]);
  const isLong = metricCol !== null && valueCol !== null;
  return {
    format: isLong ? 'long' : 'wide',
    dateCol,
    dateFormat: guessDateFormat(rows.slice(0, 50).map((r) => r[dateCol])),
    metricCol: metricCol ?? 0,
    valueCol: valueCol ?? Math.min(1, headers.length - 1),
    valueCols: isLong ? [] : headers.map((_, i) => i).filter((i) => i !== dateCol && rows.slice(0, 20).some((r) => r[i] && !Number.isNaN(Number(String(r[i]).replace(',', '.'))))),
    agg: 'auto',
  };
}

function mappingsCard(mappings) {
  if (!mappings.length) return '';
  return `<div class="card"><h3>Saved mappings</h3>
    <p class="muted">A saved mapping is applied automatically when a file has exactly the same columns.</p>
    <ul class="list">${mappings.map((m) => `<li><span class="grow"><strong>${esc(m.name)}</strong><br><small>${m.format} · ${esc(m.signature.split('|').join(', '))}</small></span>
      <button class="btn btn-sm btn-danger" data-delmap="${esc(m.id)}">Delete</button></li>`).join('')}</ul></div>`;
}

function bindMappingDeletes(el) {
  el.querySelectorAll('[data-delmap]').forEach((b) => b.addEventListener('click', async () => {
    const list = (await getSetting('csvMappings', [])).filter((m) => m.id !== b.dataset.delmap);
    await setSetting('csvMappings', list);
    toast('Mapping deleted');
    await renderImport(el);
  }));
}
