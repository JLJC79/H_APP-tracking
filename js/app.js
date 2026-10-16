// App entry: router, lock screen, service worker registration.
import { openDb, getSetting, requestPersistence } from './db.js';
import { hasPin, verifyPin } from './pin.js';
import * as overview from './views/overview.js';
import * as labs from './views/labs.js';
import * as log from './views/log.js';
import * as metrics from './views/metrics.js';
import * as settings from './views/settings.js';
import * as sync from './views/sync.js';
import { handleRedirect } from './onedrive.js';
import { toast } from './util.js';

const ROUTES = {
  overview: { title: 'Overview', view: overview },
  labs: { title: 'Lab results', view: labs },
  log: { title: 'Daily log', view: log },
  metrics: { title: 'Wearables', view: metrics },
  settings: { title: 'Settings & data', view: settings },
  sync: { title: 'OneDrive sync', view: sync },
};

const main = document.getElementById('main');
let renderSeq = 0;

function parseHash() {
  const [route = 'overview', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { route: ROUTES[route] ? route : 'overview', params: rest.map(decodeURIComponent) };
}

export async function render() {
  const seq = ++renderSeq;
  const { route, params } = parseHash();
  const r = ROUTES[route];
  document.getElementById('page-title').textContent = r.title;
  document.title = `${r.title} · Health Dashboard`;
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  try {
    const container = document.createElement('div');
    // Views render into a detached node; afterMount runs once it is in the page
    // (charts need real widths).
    await r.view.render(container, params);
    if (seq !== renderSeq) return; // a newer navigation won
    main.replaceChildren(container);
    window.scrollTo(0, 0);
    if (r.view.afterMount) await r.view.afterMount(container, params);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="error"></p></div>`;
    main.querySelector('.error').textContent = String(err.message || err);
  }
  updateDemoBadge();
}

async function updateDemoBadge() {
  document.getElementById('demo-badge').hidden = !(await getSetting('demoLoaded', false));
}

// ---- PIN lock ----------------------------------------------------------
const LOCK_AFTER_MS = 60 * 1000;
let hiddenAt = null;

function isLocked() { return !document.getElementById('lock').hidden; }

export function showLock() {
  const lock = document.getElementById('lock');
  lock.hidden = false;
  // Remove rendered data from the page while locked.
  main.replaceChildren();
  main.inert = true;
  const input = document.getElementById('lock-pin');
  input.value = '';
  document.getElementById('lock-error').textContent = '';
  setTimeout(() => input.focus(), 50);
}

function hideLock() {
  document.getElementById('lock').hidden = true;
  main.inert = false;
}

document.getElementById('lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('lock-pin');
  if (await verifyPin(input.value)) {
    hideLock();
    render();
  } else {
    document.getElementById('lock-error').textContent = 'Incorrect PIN';
    input.value = '';
    input.focus();
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
  } else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && !isLocked() && (await hasPin())) {
    showLock();
  }
});

// ---- Boot --------------------------------------------------------------
async function boot() {
  await openDb();
  requestPersistence();
  // Returning from Microsoft sign-in (OneDrive sync)?
  const od = await handleRedirect();
  if (od) toast(od.error ? `OneDrive: ${od.error}` : 'OneDrive connected');
  window.addEventListener('hashchange', () => { if (!isLocked()) render(); });
  if (await hasPin()) showLock();
  else render();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // Activate a new version as soon as it is installed; it serves the next launch.
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage('skipWaiting');
        });
      });
    }).catch((err) => console.warn('Service worker registration failed', err));
  });
}

boot();
