// Lab results files ("health-dashboard-labs" JSON, e.g. written by Cowork from a pathology
// report) and the review card shown before any of their rows are saved.
// Used by Labs → Import lab file and by OneDrive sync.
import { getAll, putMany, getSetting, setSetting } from './db.js';
import { validateBackup, FORMAT, VERSION } from './backup.js';
import { esc, fmtDate, fmtNum, rangeText, rangeStatus, statusBadge, todayISO } from './util.js';

export const LABS_FORMAT = 'health-dashboard-labs';

/** Reads a lab file and validates its rows with the same rules as a backup import. */
export function parseLabFile(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
  if (!obj || obj.format !== LABS_FORMAT) throw new Error(`Not a lab results file ("format" must be "${LABS_FORMAT}").`);
  const { data, skipped } = validateBackup({ format: FORMAT, version: VERSION, labs: obj.labs });
  return { source: typeof obj.source === 'string' ? obj.source : '', labs: data.labs, skipped };
}

/** Parses a lab file and flags rows against what is already saved. */
export async function prepareLabFile(name, text) {
  const f = parseLabFile(text);
  const existing = await getAll('labs');
  const known = new Set(existing.map((l) => l.test.toLowerCase()));
  const same = new Set(existing.map((l) => `${l.test.toLowerCase()}|${l.date}|${l.value}`));
  return {
    name, source: f.source, skipped: f.skipped,
    previously: await importedBefore(name),
    rows: f.labs.map((l) => ({
      ...l,
      newTest: !known.has(l.test.toLowerCase()),
      duplicate: same.has(`${l.test.toLowerCase()}|${l.date}|${l.value}`),
    })),
  };
}

export function labFileCard(f, fi) {
  const dates = [...new Set(f.rows.map((r) => r.date))];
  return `<section class="card" data-labfile="${fi}">
    <h3>Lab results to review</h3>
    <p class="muted">${esc(f.name)}${f.source ? `<br>From ${esc(f.source)}` : ''}<br>
      ${dates.map((d) => fmtDate(d)).join(', ')} · ${f.rows.length} result${f.rows.length === 1 ? '' : 's'}</p>
    ${f.previously ? `<p class="badge">This file was imported before, on ${fmtDate(f.previously)}</p>` : ''}
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
      <button class="btn grow" type="button" data-later="${fi}">Not now</button>
      <button class="btn btn-primary grow" type="button" data-save="${fi}">Save ticked</button>
    </div></section>`;
}

/** Saves the ticked rows of a review card. Returns the number saved. */
export async function saveTicked(card, f) {
  const ticked = [...card.querySelectorAll('[data-row]:checked')].map((c) => f.rows[+c.dataset.row]);
  if (ticked.length) await putMany('labs', ticked.map(({ newTest, duplicate, ...l }) => l));
  await markImported(f.name);
  return ticked.length;
}

// ---- Which files were imported before (by file name), so picking files by hand is easy ----

export async function importedBefore(name) {
  return (await getSetting('importedFiles', {}))[name] || null;
}

export async function markImported(name) {
  const all = await getSetting('importedFiles', {});
  all[name] = todayISO();
  // Keep the list from growing without limit.
  const entries = Object.entries(all).sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 2000);
  await setSetting('importedFiles', Object.fromEntries(entries));
}
