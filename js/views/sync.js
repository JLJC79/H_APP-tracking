// OneDrive sync: imports files that Cowork (or you) put in the app's OneDrive folder.
//   Apps/Health Dashboard/inbox/wearables/*.csv → imported with saved or built-in mappings
//   Apps/Health Dashboard/inbox/labs/*.json     → shown for review before saving
// Processed files move to done/. Route: #/sync
import { getAll, putMany } from '../db.js';
import { validateBackup, FORMAT, VERSION } from '../backup.js';
import {
  getClientId, isConnected, signIn, ensureFolders, listFiles, downloadText, moveToDone, SignInNeeded,
} from '../onedrive.js';
import { importCsvText, queueFilesForImport } from './metrics.js';
import { esc, fmtDate, fmtNum, rangeText, rangeStatus, statusBadge, toast } from '../util.js';

export const LABS_FORMAT = 'health-dashboard-labs';

let state = null; // { wearables: [...results], needsMapping: [{item, text}], labFiles: [...], errors: [] }

export async function render(el) {
  const [clientId, connected] = await Promise.all([getClientId(), isConnected()]);
  if (!clientId || !connected) {
    el.innerHTML = `<div class="card empty-state"><h2>OneDrive is not connected</h2>
      <p>Connect the app's OneDrive folder in Settings first.</p>
      <a class="btn btn-primary" href="#/settings">Open Settings</a></div>`;
    return;
  }
  // Coming back later: start fresh unless lab results are still waiting for review.
  if (state && !state.labFiles.length) state = null;
  if (!state) {
    el.innerHTML = `<div class="card"><h2>Sync from OneDrive</h2>
      <p class="muted">Imports new files from the app's OneDrive folder (<em>Apps/Health Dashboard/inbox</em>). Wearable files are imported straight away; lab results are shown to you before anything is saved.</p>
      <button class="btn btn-primary btn-block" id="sync">Sync now</button>
      <p class="error" id="sync-error" role="alert"></p></div>`;
    el.querySelector('#sync').addEventListener('click', () => runSync(el));
    return;
  }
  renderResults(el);
}

/** Reads a lab file and validates its rows with the same rules as a backup import. */
export function parseLabFile(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
  if (!obj || obj.format !== LABS_FORMAT) throw new Error(`Not a lab results file ("format" must be "${LABS_FORMAT}").`);
  const { data, skipped } = validateBackup({ format: FORMAT, version: VERSION, labs: obj.labs });
  return { source: typeof obj.source === 'string' ? obj.source : '', labs: data.labs, skipped };
}

async function runSync(el) {
  const btn = el.querySelector('#sync');
  const err = el.querySelector('#sync-error');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  err.textContent = '';
  try {
    await ensureFolders();
    const s = { wearables: [], needsMapping: [], labFiles: [], errors: [] };

    for (const item of (await listFiles('inbox/wearables')).filter((f) => /\.csv$/i.test(f.name))) {
      btn.textContent = `Importing ${item.name}…`;
      const text = await downloadText(item);
      const r = await importCsvText(item.name, text, { auto: true });
      if (r.imported) { s.wearables.push(r.imported); await moveToDone(item, 'wearables'); }
      else if (r.error) s.errors.push(`${item.name}: ${r.error}`);
      else s.needsMapping.push({ item, text });
    }

    const existing = await getAll('labs');
    const known = new Set(existing.map((l) => l.test.toLowerCase()));
    const same = new Set(existing.map((l) => `${l.test.toLowerCase()}|${l.date}|${l.value}`));
    for (const item of (await listFiles('inbox/labs')).filter((f) => /\.json$/i.test(f.name))) {
      btn.textContent = `Reading ${item.name}…`;
      try {
        const f = parseLabFile(await downloadText(item));
        s.labFiles.push({
          item, source: f.source, skipped: f.skipped,
          rows: f.labs.map((l) => ({
            ...l,
            newTest: !known.has(l.test.toLowerCase()),
            duplicate: same.has(`${l.test.toLowerCase()}|${l.date}|${l.value}`),
          })),
        });
      } catch (e) {
        s.errors.push(`${item.name}: ${e.message}`);
      }
    }
    state = s;
    renderResults(el);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Sync now';
    if (e instanceof SignInNeeded) {
      err.innerHTML = 'Your OneDrive sign-in has expired. <button class="btn btn-sm" id="resign">Sign in again</button>';
      err.querySelector('#resign').addEventListener('click', () => signIn('#/sync'));
    } else {
      err.textContent = e.message || String(e);
    }
  }
}

function renderResults(el) {
  const s = state;
  const total = s.wearables.reduce((a, r) => a + r.count, 0);
  const nothing = !s.wearables.length && !s.needsMapping.length && !s.labFiles.length && !s.errors.length;
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Sync results</h2><button class="btn btn-sm" id="again">Sync again</button></div>
      ${nothing ? '<p>No new files in the OneDrive inbox.</p>' : ''}
      ${s.wearables.length ? `<p><strong>${total}</strong> wearable value${total === 1 ? '' : 's'} imported from ${s.wearables.length} file${s.wearables.length === 1 ? '' : 's'}.</p>
        <ul class="list">${s.wearables.map((r) => `<li><span class="grow"><strong>${esc(r.fileName)}</strong><br><small>${r.count} values · ${esc(r.how)}</small>
          ${r.metrics.map((m) => `<br><small>${esc(m.metric)}: ${m.days} day${m.days === 1 ? '' : 's'}, ${fmtDate(m.from)} – ${fmtDate(m.to)}</small>`).join('')}</span></li>`).join('')}</ul>` : ''}
      ${s.needsMapping.length ? `<div class="card" style="background:var(--surface-2)">
        <p><strong>${s.needsMapping.length} file${s.needsMapping.length === 1 ? '' : 's'}</strong> need${s.needsMapping.length === 1 ? 's' : ''} a one-time column mapping: ${s.needsMapping.map((n) => esc(n.item.name)).join(', ')}.
        After you map them, the next sync imports them automatically.</p>
        <button class="btn" id="map-now">Map them now</button></div>` : ''}
      ${s.errors.length ? `<p class="error">Could not read:</p><ul>${s.errors.map((e) => `<li><small>${esc(e)}</small></li>`).join('')}</ul>` : ''}
    </div>
    ${s.labFiles.map((f, fi) => labFileCard(f, fi)).join('')}`;

  el.querySelector('#again').addEventListener('click', async () => { state = null; await render(el); el.querySelector('#sync').click(); });
  const mapNow = el.querySelector('#map-now');
  if (mapNow) mapNow.addEventListener('click', () => {
    queueFilesForImport(s.needsMapping.map((n) => new File([n.text], n.item.name, { type: 'text/csv' })));
    location.hash = '#/metrics/import';
  });

  el.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => {
    const fi = +b.dataset.save;
    const f = s.labFiles[fi];
    const card = b.closest('.card');
    const ticked = [...card.querySelectorAll('[data-row]:checked')].map((c) => f.rows[+c.dataset.row]);
    b.disabled = true;
    try {
      if (ticked.length) {
        await putMany('labs', ticked.map(({ newTest, duplicate, ...l }) => l));
      }
      await moveToDone(f.item, 'labs');
      toast(`Saved ${ticked.length} result${ticked.length === 1 ? '' : 's'}`);
      s.labFiles.splice(fi, 1);
      renderResults(el);
    } catch (e) {
      b.disabled = false;
      toast(e.message || String(e));
    }
  }));
  el.querySelectorAll('[data-later]').forEach((b) => b.addEventListener('click', () => {
    s.labFiles.splice(+b.dataset.later, 1);
    toast('Left in the OneDrive inbox for next time');
    renderResults(el);
  }));
}

function labFileCard(f, fi) {
  const dates = [...new Set(f.rows.map((r) => r.date))];
  return `<section class="card">
    <h3>Lab results to review</h3>
    <p class="muted">${esc(f.item.name)}${f.source ? `<br>From ${esc(f.source)}` : ''}<br>
      ${dates.map((d) => fmtDate(d)).join(', ')} · ${f.rows.length} result${f.rows.length === 1 ? '' : 's'}</p>
    <p class="hint">Check each value against the report. Untick anything that looks wrong; you can add it by hand later.</p>
    <ul class="list">${f.rows.map((r, i) => `<li>
      <label class="check grow" style="font-weight:400">
        <input type="checkbox" data-row="${i}" ${r.duplicate ? '' : 'checked'}>
        <span><strong>${esc(r.test)}</strong> <span class="num">${fmtNum(r.value)} ${esc(r.units)}</span><br>
          <small>${fmtDate(r.date)} · ref ${esc(rangeText(r.low, r.high))}${r.notes ? ` · ${esc(r.notes)}` : ''}</small>
          ${r.newTest ? '<br><small class="badge">New test name</small>' : ''}
          ${r.duplicate ? '<br><small class="badge">Already saved</small>' : ''}</span>
      </label>${statusBadge(rangeStatus(r.value, r.low, r.high))}</li>`).join('')}</ul>
    ${f.skipped.length ? `<details><summary>${f.skipped.length} row${f.skipped.length === 1 ? '' : 's'} could not be read</summary><ul>${f.skipped.map((x) => `<li><small>${esc(x)}</small></li>`).join('')}</ul></details>` : ''}
    <div class="row" style="margin-top:.75rem">
      <button class="btn grow" data-later="${fi}">Not now</button>
      <button class="btn btn-primary grow" data-save="${fi}">Save ticked</button>
    </div></section>`;
}
