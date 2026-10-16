// Wearable metrics: per-metric charts and the CSV importer with reusable column mappings.
// Routes: #/metrics · #/metrics/import
import { getAll, getAllByIndex, putMany, removeMany, removeByIndex, getSetting, setSetting } from '../db.js';
import { lineChart, dataTable } from '../chart.js';
import {
  parseCSV, parseDate, DATE_FORMATS, guessDateFormat, headerSignature, guessColumn, applyMapping,
  detectHeaderRow, cleanHeader, isBookkeepingColumn,
} from '../csv.js';
import {
  esc, uid, fmtDate, fmtNum, groupBy, byDate, segControl, rangeStart, inRange, mean,
  readFileText, toast, prettyName,
} from '../util.js';

let range = '6m';
let imp = null; // { queue: File[], results: [], current: { fileName, rows, headerRow } | null }

export async function render(el, params) {
  if (params[0] === 'import') {
    if (imp && !imp.current) resetImport(); // don't show a stale summary when coming back
    return renderImport(el);
  }
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
// Several files can be chosen at once; they are processed as a queue. A file whose columns match
// a saved mapping is imported straight away (if that setting is on); otherwise the mapping form
// is shown for it. A summary of every file is shown at the end.

function resetImport() {
  imp = { queue: [], results: [], current: null };
}

/** Finds a saved mapping for these rows: by its saved header row first, then the detected one. */
function findSavedMapping(rows, mappings, detected) {
  for (const m of mappings) {
    const hr = Number.isInteger(m.headerRow) ? m.headerRow : detected;
    if (rows[hr] && headerSignature(rows[hr]) === m.signature) return { mapping: m, headerRow: hr };
  }
  return null;
}

async function saveRecords(result, fileName) {
  await putMany('metrics', result.records.map((r) => ({ id: `${r.metric}|${r.date}`, ...r, source: fileName })));
}

function resultFor(fileName, result, how) {
  const byMetric = groupBy(result.records, (r) => r.metric);
  return {
    fileName, how, count: result.records.length, skipped: result.skipped,
    metrics: [...byMetric.entries()].map(([k, v]) => {
      const s = v.sort(byDate);
      return { metric: k, days: s.length, from: s[0].date, to: s[s.length - 1].date };
    }),
  };
}

/** Works through the queue until a file needs the mapping form, or the queue is empty. */
async function processQueue(el) {
  const mappings = await getSetting('csvMappings', []);
  const auto = await getSetting('csvAutoImport', true);
  while (imp.queue.length) {
    const file = imp.queue.shift();
    let rows;
    try { rows = parseCSV(await readFileText(file)); } catch { rows = []; }
    if (rows.length < 2) { imp.results.push({ fileName: file.name, error: 'No data rows found.' }); continue; }
    const detected = detectHeaderRow(rows);
    const found = findSavedMapping(rows, mappings, detected);
    if (found && auto) {
      const headers = rows[found.headerRow];
      const result = applyMapping(headers, rows.slice(found.headerRow + 1), found.mapping);
      if (result.records.length) {
        await saveRecords(result, file.name);
        imp.results.push(resultFor(file.name, result, `saved mapping “${found.mapping.name}”`));
        continue;
      }
      // Saved mapping read nothing (e.g. an empty export): let the person look at it.
    }
    imp.current = { fileName: file.name, rows, headerRow: found ? found.headerRow : detected };
    return renderImport(el);
  }
  imp.current = null;
  return renderImport(el);
}

async function renderImport(el) {
  if (!imp) resetImport();
  if (imp.current) return renderMapping(el);
  if (imp.results.length) return renderSummary(el);

  const mappings = await getSetting('csvMappings', []);
  const auto = await getSetting('csvAutoImport', true);
  el.innerHTML = `
    <p><a href="#/metrics">← Wearables</a></p>
    <div class="card">
      <h2>Import wearable CSV</h2>
      <p>Choose one or more CSV files exported from your wearable or health app (for Samsung Health, the files in <em>Download/Samsung Health</em>). Files are read on this device only; nothing is uploaded.</p>
      <div class="field"><label for="csv-file">CSV files</label>
        <input id="csv-file" type="file" multiple accept=".csv,text/csv,text/plain"></div>
      <p class="hint">Works with “long” files (one row per date + metric + value) and “wide” files (one row per date, one column per metric).</p>
      <label class="check field"><input type="checkbox" id="auto-import" ${auto ? 'checked' : ''}> Import files with saved mappings automatically</label>
      <p class="error" id="file-error" role="alert"></p>
    </div>
    ${mappingsCard(mappings)}`;
  el.querySelector('#auto-import').addEventListener('change', (e) => setSetting('csvAutoImport', e.target.checked));
  el.querySelector('#csv-file').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    resetImport();
    imp.queue = files;
    await processQueue(el);
  });
  bindMappingDeletes(el);
}

function renderSummary(el) {
  const ok = imp.results.filter((r) => !r.error && !r.skippedFile);
  const total = ok.reduce((a, r) => a + r.count, 0);
  el.innerHTML = `
    <p><a href="#/metrics">← Wearables</a></p>
    <div class="card">
      <h2>Import finished</h2>
      <p><strong>${total}</strong> daily value${total === 1 ? '' : 's'} imported from <strong>${ok.length}</strong> of ${imp.results.length} file${imp.results.length === 1 ? '' : 's'}.</p>
      <ul class="list">${imp.results.map((r) => `<li><span class="grow"><strong>${esc(r.fileName)}</strong><br>
        ${r.error ? `<span class="error" style="display:inline">${esc(r.error)}</span>`
          : r.skippedFile ? '<small>Skipped</small>'
          : `<small>${r.count} values · ${esc(r.how)}${r.skipped ? ` · ${r.skipped} unreadable value${r.skipped === 1 ? '' : 's'} skipped` : ''}</small>
             ${r.metrics.map((m) => `<br><small>${esc(m.metric)}: ${m.days} day${m.days === 1 ? '' : 's'}, ${fmtDate(m.from)} – ${fmtDate(m.to)}</small>`).join('')}`}
      </span></li>`).join('')}</ul>
      <div class="row" style="margin-top:.75rem">
        <button class="btn grow" id="more">Import more</button>
        <a class="btn btn-primary grow" href="#/metrics" id="done">View wearables</a></div>
    </div>`;
  el.querySelector('#more').addEventListener('click', async () => { resetImport(); await renderImport(el); });
  el.querySelector('#done').addEventListener('click', () => resetImport());
}

async function renderMapping(el) {
  const mappings = await getSetting('csvMappings', []);
  const existing = [...new Set((await getAll('metrics')).map((r) => r.metric))].sort((a, b) => a.localeCompare(b));
  const { fileName, rows, headerRow } = imp.current;
  const headers = rows[headerRow];
  const data = rows.slice(headerRow + 1);
  const shown = headers.map((h, i) => cleanHeader(h) || `Column ${i + 1}`);
  const sig = headerSignature(headers);
  const saved = mappings.find((m) => m.signature === sig);
  const m = saved || guessMapping(headers, data);
  const opts = (sel) => shown.map((h, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(h)}</option>`).join('');
  const preview = data.slice(0, 5);
  const left = imp.queue.length;
  const rowChoices = rows.slice(0, Math.min(10, rows.length - 1)).map((r, i) =>
    `<option value="${i}"${i === headerRow ? ' selected' : ''}>Row ${i + 1}: ${esc(r.slice(0, 3).join(', ').slice(0, 50))}</option>`).join('');

  el.innerHTML = `
    <p><a href="#/metrics">← Wearables</a></p>
    <div class="card">
      <div class="card-head"><h2>Map columns</h2>
        <button class="btn btn-sm" id="skip-file">${left ? 'Skip this file' : 'Cancel'}</button></div>
      <p class="muted">${esc(fileName)} · ${data.length} data rows${left ? ` · ${left} more file${left === 1 ? '' : 's'} after this` : ''}</p>
      ${saved ? `<p class="badge badge-ok">Using saved mapping “${esc(saved.name)}”</p>` : ''}
      <div class="field"><label for="m-hrow">Column names are on</label>
        <select id="m-hrow">${rowChoices}</select>
        <p class="hint">Some apps put a line of information above the column names. Pick the row that holds them.</p></div>
      <details ${saved ? '' : 'open'}><summary>Preview first rows</summary>
        <div class="table-wrap preview"><table><thead><tr>${shown.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
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
      <label class="check field"><input type="checkbox" name="utc" ${m.utc ? 'checked' : ''}> Times are UTC (convert to this phone's local day)</label>
      <div id="long-fields">
        <div class="field"><label for="m-metric">Metric name column</label><select id="m-metric" name="metricCol">${opts(m.metricCol)}</select></div>
        <div class="field"><label for="m-value">Value column</label><select id="m-value" name="valueCol">${opts(m.valueCol)}</select></div>
      </div>
      <fieldset id="wide-fields" style="border:0;padding:0;margin:0 0 .85rem">
        <legend style="font-weight:600;font-size:.9rem;margin-bottom:.35rem">Metric columns to import</legend>
        <p class="hint">“Save as” lets new data join a metric you already have — pick its name from the list.</p>
        <datalist id="metric-names">${existing.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        ${headers.map((_, i) => `<div class="map-col">
          <label class="check"><input type="checkbox" name="valueCols" value="${i}" ${m.valueCols.includes(i) ? 'checked' : ''}> ${esc(shown[i])}</label>
          <input class="save-as" data-col="${i}" list="metric-names" aria-label="Save ${esc(shown[i])} as" placeholder="Save as: ${esc(shown[i])}"
            value="${esc((m.names && m.names[i]) || '')}" autocomplete="off" ${m.valueCols.includes(i) ? '' : 'hidden'}>
        </div>`).join('')}
      </fieldset>
      <div class="field"><label for="m-agg">If a metric has several values on one day</label>
        <select id="m-agg" name="agg">
          <option value="auto"${m.agg === 'auto' ? ' selected' : ''}>Automatic: add up steps, calories, distance, minutes; average the rest</option>
          <option value="mean"${m.agg === 'mean' ? ' selected' : ''}>Average them (heart rate, HRV)</option>
          <option value="sum"${m.agg === 'sum' ? ' selected' : ''}>Add them up (steps, minutes)</option>
          <option value="last"${m.agg === 'last' ? ' selected' : ''}>Keep the last one</option>
        </select></div>
      <div class="field"><label for="m-name">Mapping name</label>
        <input id="m-name" name="mapName" value="${esc(saved ? saved.name : fileName.replace(/\.[^.]+$/, '').replace(/\.\d{8,}$/, ''))}"></div>
      <label class="check field"><input type="checkbox" name="save" checked> Save this mapping for files with the same columns</label>
      <p class="error" id="map-error" role="alert"></p>
      <div id="summary"></div>
      <div class="row"><button class="btn grow" type="button" id="check">Check</button>
        <button class="btn btn-primary grow" type="submit">Import</button></div>
    </form>`;

  const form = el.querySelector('#map-form');
  const read = () => {
    const valueCols = [...form.querySelectorAll('[name="valueCols"]:checked')].map((c) => +c.value);
    const names = {};
    form.querySelectorAll('.save-as').forEach((inp) => {
      const c = +inp.dataset.col;
      if (valueCols.includes(c) && inp.value.trim()) names[c] = inp.value.trim();
    });
    return {
      id: saved ? saved.id : uid(),
      name: form.mapName.value.trim() || fileName,
      signature: sig,
      headerRow,
      format: form.format.value,
      dateCol: +form.dateCol.value,
      dateFormat: form.dateFormat.value,
      utc: form.utc.checked,
      metricCol: +form.metricCol.value,
      valueCol: +form.valueCol.value,
      valueCols,
      names,
      agg: form.agg.value,
    };
  };
  const sync = () => {
    const cur = read();
    el.querySelector('#long-fields').hidden = cur.format !== 'long';
    el.querySelector('#wide-fields').hidden = cur.format !== 'wide';
    form.querySelectorAll('.save-as').forEach((inp) => { inp.hidden = !cur.valueCols.includes(+inp.dataset.col); });
    const first = data[0] ? data[0][cur.dateCol] : '';
    const d = parseDate(first, cur.dateFormat, cur.utc);
    el.querySelector('#date-check').textContent = d ? fmtDate(d) : 'not recognised';
    el.querySelector('#date-sample').textContent = first ?? '';
  };
  const check = () => {
    const cur = read();
    const err = el.querySelector('#map-error');
    err.textContent = '';
    if (cur.format === 'wide' && !cur.valueCols.length) { err.textContent = 'Tick at least one metric column.'; return null; }
    const result = applyMapping(headers, data, cur);
    const byMetric = groupBy(result.records, (r) => r.metric);
    el.querySelector('#summary').innerHTML = `<div class="card" style="background:var(--surface-2)">
      <p><strong>${result.records.length}</strong> daily values across <strong>${byMetric.size}</strong> metric${byMetric.size === 1 ? '' : 's'}${result.skipped ? ` · <span class="error" style="display:inline">${result.skipped} value${result.skipped === 1 ? '' : 's'} skipped</span> (unreadable date or number)` : ''}</p>
      <ul class="list">${[...byMetric.entries()].map(([k, v]) => {
        const s = v.sort(byDate);
        return `<li><span class="grow">${esc(k)}${existing.includes(k) ? ' <small>(joins existing)</small>' : ''}</span><small>${s.length} days · ${fmtDate(s[0].date)} – ${fmtDate(s[s.length - 1].date)}</small></li>`;
      }).join('')}</ul></div>`;
    if (!result.records.length) { err.textContent = 'Nothing could be read with this mapping. Check the columns and date format.'; return null; }
    return { cur, result };
  };

  form.addEventListener('change', sync);
  sync();
  el.querySelector('#m-hrow').addEventListener('change', async (e) => {
    imp.current.headerRow = +e.target.value;
    await renderMapping(el);
  });
  el.querySelector('#check').addEventListener('click', check);
  el.querySelector('#skip-file').addEventListener('click', async () => {
    imp.results.push({ fileName, skippedFile: true });
    imp.current = null;
    if (!imp.queue.length && imp.results.every((r) => r.skippedFile)) { resetImport(); return renderImport(el); }
    await processQueue(el);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = check();
    if (!ok) return;
    const { cur, result } = ok;
    await saveRecords(result, fileName);
    if (form.save.checked) {
      const list = (await getSetting('csvMappings', [])).filter((x) => x.signature !== sig);
      list.push(cur);
      await setSetting('csvMappings', list);
    }
    imp.results.push(resultFor(fileName, result, saved ? `mapping “${cur.name}”` : 'new mapping'));
    imp.current = null;
    await processQueue(el);
  });
}

function guessMapping(headers, rows) {
  const clean = headers.map(cleanHeader);
  const named = clean.map((h, i) => (isBookkeepingColumn(headers[i]) ? '' : h)); // e.g. skip pkg_name for "name"
  const dateCol = guessColumn(clean, [/(^|_)day_time$/i, /(^|[_\s])date/i, /(^|_)start_time$/i, /day/i, /time/i]) ?? 0;
  const metricCol = guessColumn(named, [/metric/i, /^type$/i, /name/i, /measure/i]);
  const valueCol = guessColumn(named, [/^value$/i, /value/i, /amount/i, /qty/i]);
  const isLong = metricCol !== null && valueCol !== null;
  const numeric = (i) => rows.slice(0, 20).some((r) => r[i] && !Number.isNaN(Number(String(r[i]).replace(',', '.'))));
  return {
    format: isLong ? 'long' : 'wide',
    dateCol,
    dateFormat: guessDateFormat(rows.slice(0, 50).map((r) => r[dateCol])),
    utc: clean.some((h) => /(^|_)time_offset$/i.test(h)),
    metricCol: metricCol ?? 0,
    valueCol: valueCol ?? Math.min(1, headers.length - 1),
    valueCols: isLong ? [] : headers.map((_, i) => i).filter((i) => i !== dateCol && !isBookkeepingColumn(headers[i]) && numeric(i)),
    names: {},
    agg: 'auto',
  };
}

function mappingsCard(mappings) {
  if (!mappings.length) return '';
  return `<div class="card"><h3>Saved mappings</h3>
    <p class="muted">A saved mapping is used whenever a file has exactly the same columns.</p>
    <ul class="list">${mappings.map((m) => `<li><span class="grow"><strong>${esc(m.name)}</strong><br><small>${m.format} · ${esc(m.signature.split('|').map(cleanHeader).join(', ').slice(0, 160))}</small></span>
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
