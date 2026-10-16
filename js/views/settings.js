// Settings & data: backup export/import, PIN, theme, demo data, storage.
import { getAll, getSetting, setSetting, clear, STORES } from '../db.js';
import { buildBackup, backupFileName, validateBackup, applyBackup } from '../backup.js';
import { hasPin, setPin, clearPin, isValidPin, verifyPin } from '../pin.js';
import { loadDemo, removeDemo } from '../demo.js';
import { esc, downloadFile, readFileText, toast, fmtDate } from '../util.js';

let pendingImport = null; // { fileName, result }

function currentTheme() {
  try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; }
}

function applyTheme(t) {
  try {
    if (t === 'system') localStorage.removeItem('theme'); else localStorage.setItem('theme', t);
  } catch { /* ignore */ }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

async function storageInfo() {
  let persisted = null, usage = null;
  try {
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) usage = (await navigator.storage.estimate()).usage;
  } catch { /* unsupported */ }
  return { persisted, usage };
}

export async function render(el) {
  const [labs, metrics, fields, entries] = await Promise.all(['labs', 'metrics', 'logFields', 'logEntries'].map(getAll));
  const pin = await hasPin();
  const demo = await getSetting('demoLoaded', false);
  const lastExport = await getSetting('lastExport', null);
  const { persisted, usage } = await storageInfo();
  const theme = currentTheme();
  const hasData = labs.length + metrics.length + fields.length + entries.length > 0;

  el.innerHTML = `
    <section class="card">
      <h2>Backup</h2>
      <p>Your data is stored only in this browser on this device. If you uninstall the app or clear Chrome's site data, it is gone. Export a backup regularly and keep it somewhere private.</p>
      <p class="muted">${labs.length} lab results · ${metrics.length} wearable values · ${fields.length} log fields · ${entries.length} log entries<br>
        Last backup: ${lastExport ? fmtDate(lastExport.slice(0, 10)) : 'never'}</p>
      <button class="btn btn-primary btn-block" id="export">Export backup (.json)</button>
      <div class="field" style="margin-top:1rem"><label for="import-file">Import a backup file</label>
        <input id="import-file" type="file" accept=".json,application/json"></div>
      <div id="import-panel"></div>
    </section>

    <section class="card">
      <h2>PIN lock</h2>
      <p class="muted">The PIN hides the app behind a lock screen when it opens and after 1 minute in the background.
        It is a privacy screen, not encryption: it does not protect the data from someone with full access to the unlocked phone.
        Use your phone's own screen lock as well. If you forget the PIN, clear Chrome's site data for this app (which deletes the data), then restore a backup.</p>
      <form id="pin-form" novalidate>
        ${pin ? `<div class="field"><label for="pin-old">Current PIN</label><input id="pin-old" type="password" inputmode="numeric" autocomplete="off"></div>` : ''}
        <div class="grid-2">
          <div class="field"><label for="pin-new">${pin ? 'New PIN' : 'PIN'} (4–12 digits)</label><input id="pin-new" type="password" inputmode="numeric" autocomplete="off"></div>
          <div class="field"><label for="pin-confirm">Repeat</label><input id="pin-confirm" type="password" inputmode="numeric" autocomplete="off"></div>
        </div>
        <p class="error" id="pin-error" role="alert"></p>
        <div class="row">
          <button class="btn btn-primary grow" type="submit">${pin ? 'Change PIN' : 'Set PIN'}</button>
          ${pin ? '<button class="btn btn-danger grow" type="button" id="pin-remove">Remove PIN</button>' : ''}
        </div>
      </form>
    </section>

    <section class="card">
      <h2>Appearance</h2>
      <div class="seg" role="group" aria-label="Theme">
        ${['system', 'light', 'dark'].map((t) => `<button type="button" data-theme-choice="${t}" aria-pressed="${t === theme}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
    </section>

    <section class="card">
      <h2>Demo data</h2>
      <p class="muted">Load clearly fake sample data to try the app. It is tagged and can be removed in one tap without touching your own data.</p>
      ${demo ? '<button class="btn btn-block" id="demo-remove">Remove demo data</button>'
        : `<button class="btn btn-block" id="demo-load" ${hasData ? 'disabled' : ''}>Load demo data</button>
           ${hasData ? '<p class="hint">Only available while the app is empty, so demo values can never mix with your own.</p>' : ''}`}
    </section>

    <section class="card">
      <h2>Storage</h2>
      <p class="muted">Protected from automatic clean-up: ${persisted === null ? 'unknown' : persisted ? 'yes' : 'not yet (installing the app usually enables this)'}
        ${usage !== null && usage !== undefined ? `<br>Space used: ${(usage / 1024 / 1024).toFixed(1)} MB` : ''}</p>
      <button class="btn btn-danger btn-block" id="wipe">Delete all data on this device…</button>
    </section>

    <section class="card">
      <h2>About &amp; privacy</h2>
      <p class="muted">Health Dashboard keeps everything on this device. It has no account, no server, no analytics and makes no network requests with your data.
        The app's own files are cached for offline use.</p>
    </section>`;

  // Export
  el.querySelector('#export').addEventListener('click', async () => {
    const backup = await buildBackup();
    downloadFile(backupFileName(), JSON.stringify(backup, null, 2));
    await setSetting('lastExport', backup.exportedAt);
    toast('Backup downloaded');
  });

  // Import
  el.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const panel = el.querySelector('#import-panel');
    try {
      const obj = JSON.parse(await readFileText(file));
      pendingImport = { fileName: file.name, result: validateBackup(obj, fields) };
    } catch (err) {
      pendingImport = null;
      panel.innerHTML = `<p class="error" role="alert"></p>`;
      panel.firstChild.textContent = err instanceof SyntaxError ? 'This file is not valid JSON.' : err.message;
      return;
    }
    const { counts, skipped } = pendingImport.result;
    panel.innerHTML = `<div class="card" style="background:var(--surface-2)">
      <p><strong>${esc(pendingImport.fileName)}</strong>: ${counts.labs} lab results, ${counts.metrics} wearable values, ${counts.logFields} log fields, ${counts.logEntries} log entries.</p>
      ${skipped.length ? `<details><summary>${skipped.length} record${skipped.length === 1 ? '' : 's'} will be skipped</summary><ul>${skipped.slice(0, 50).map((s) => `<li><small>${esc(s)}</small></li>`).join('')}</ul></details>` : ''}
      <fieldset style="border:0;padding:0;margin:.5rem 0">
        <legend style="font-weight:600;font-size:.9rem">How to import</legend>
        <label class="check"><input type="radio" name="mode" value="merge" checked> Merge: add to my data (same records are updated)</label>
        <label class="check"><input type="radio" name="mode" value="replace"> Replace: delete my current data first</label>
      </fieldset>
      <div class="row"><button class="btn btn-primary grow" id="import-go">Import</button><button class="btn grow" id="import-cancel">Cancel</button></div></div>`;
    panel.querySelector('#import-cancel').addEventListener('click', () => { pendingImport = null; panel.innerHTML = ''; e.target.value = ''; });
    panel.querySelector('#import-go').addEventListener('click', async () => {
      const replace = panel.querySelector('[name="mode"]:checked').value === 'replace';
      if (replace && !confirm('Replace ALL current data with this backup? Export a backup first if unsure.')) return;
      await applyBackup(pendingImport.result.data, { replace });
      pendingImport = null;
      toast('Import complete');
      await render(el);
    });
  });

  // PIN
  const pinForm = el.querySelector('#pin-form');
  const pinErr = el.querySelector('#pin-error');
  pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    pinErr.textContent = '';
    const nw = el.querySelector('#pin-new').value;
    if (pin && !(await verifyPin(el.querySelector('#pin-old').value))) { pinErr.textContent = 'Current PIN is wrong.'; return; }
    if (!isValidPin(nw)) { pinErr.textContent = 'PIN must be 4–12 digits.'; return; }
    if (nw !== el.querySelector('#pin-confirm').value) { pinErr.textContent = 'The two PINs do not match.'; return; }
    await setPin(nw);
    toast(pin ? 'PIN changed' : 'PIN set');
    await render(el);
  });
  const rm = el.querySelector('#pin-remove');
  if (rm) rm.addEventListener('click', async () => {
    if (!(await verifyPin(el.querySelector('#pin-old').value))) { pinErr.textContent = 'Enter your current PIN to remove it.'; return; }
    await clearPin();
    toast('PIN removed');
    await render(el);
  });

  // Theme
  el.querySelectorAll('[data-theme-choice]').forEach((b) => b.addEventListener('click', () => {
    applyTheme(b.dataset.themeChoice);
    el.querySelectorAll('[data-theme-choice]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));

  // Demo
  el.querySelector('#demo-load')?.addEventListener('click', async () => {
    await loadDemo();
    toast('Demo data loaded');
    location.hash = '#/overview';
  });
  el.querySelector('#demo-remove')?.addEventListener('click', async () => {
    await removeDemo();
    toast('Demo data removed');
    await render(el);
    document.getElementById('demo-badge').hidden = true;
  });

  // Wipe
  el.querySelector('#wipe').addEventListener('click', async () => {
    const typed = prompt('This permanently deletes all lab results, wearable data, log fields and entries, saved mappings and the PIN on this device.\n\nType DELETE to confirm.');
    if (typed !== 'DELETE') return;
    for (const s of STORES) await clear(s);
    toast('All data deleted');
    location.hash = '#/overview';
  });
}
