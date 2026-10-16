// Generates clearly FAKE demo data for trying the app. Every record is tagged so it can be removed.
// Lab ids start with "demo-", metrics have source "demo", log fields have ids starting "demo-field-".
import { getAll, putMany, removeMany, setSetting, deleteSetting } from './db.js';
import { todayISO, addDays } from './util.js';

// Small seeded PRNG so the demo looks the same every time.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const LAB_TESTS = [
  { test: 'Fasting glucose', units: 'mmol/L', low: 3.9, high: 5.6, base: 5.2, sd: 0.4, dp: 1 },
  { test: 'LDL cholesterol', units: 'mmol/L', low: null, high: 3.0, base: 3.1, sd: 0.3, dp: 1 },
  { test: 'Haemoglobin', units: 'g/L', low: 130, high: 170, base: 145, sd: 8, dp: 0 },
  { test: 'TSH', units: 'mIU/L', low: 0.4, high: 4.0, base: 2.1, sd: 0.8, dp: 2 },
  { test: 'Vitamin D', units: 'nmol/L', low: 50, high: 125, base: 55, sd: 14, dp: 0 },
];

export function generateDemo() {
  const r = rng(42);
  const gauss = () => (r() + r() + r() + r() - 2) * 1.2;
  const today = todayISO();
  const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

  const labs = [];
  for (let k = 0; k < 6; k++) {
    const date = addDays(today, -(k * 75 + 10));
    for (const t of LAB_TESTS) {
      labs.push({
        id: `demo-${t.test}-${date}`, test: t.test, value: round(t.base + gauss() * t.sd, t.dp), units: t.units,
        low: t.low, high: t.high, date, notes: 'DEMO – fake value',
      });
    }
  }

  const metrics = [];
  for (let d = 400; d >= 1; d--) {
    const date = addDays(today, -d);
    const season = Math.sin(d / 40);
    metrics.push(
      { metric: 'resting_hr', value: Math.round(58 + season * 3 + gauss() * 2) },
      { metric: 'hrv_ms', value: Math.round(48 - season * 5 + gauss() * 6) },
      { metric: 'sleep_hours', value: round(7.1 + gauss() * 0.7, 1) },
      { metric: 'steps', value: Math.max(800, Math.round(8200 + season * 1500 + gauss() * 2600)) },
    );
    for (const m of metrics.slice(-4)) Object.assign(m, { id: `${m.metric}|${date}`, date, source: 'demo' });
  }

  const logFields = [
    { id: 'demo-field-mood', name: 'Mood', type: 'scale', unit: '', step: 1, order: 0, archived: false },
    { id: 'demo-field-energy', name: 'Energy', type: 'scale', unit: '', step: 1, order: 1, archived: false },
    { id: 'demo-field-weight', name: 'Weight', type: 'number', unit: 'kg', step: 0.1, order: 2, archived: false },
    { id: 'demo-field-exercise', name: 'Exercised', type: 'bool', unit: '', step: 1, order: 3, archived: false },
    { id: 'demo-field-notes', name: 'Notes', type: 'text', unit: '', step: 1, order: 4, archived: false },
  ];
  const logEntries = [];
  const add = (date, fieldId, value) => logEntries.push({ id: `${date}|${fieldId}`, date, fieldId, value });
  for (let d = 90; d >= 1; d--) {
    if (r() < 0.15) continue; // some missed days
    const date = addDays(today, -d);
    add(date, 'demo-field-mood', Math.min(10, Math.max(1, Math.round(6.5 + gauss() * 1.4))));
    add(date, 'demo-field-energy', Math.min(10, Math.max(1, Math.round(6 + gauss() * 1.6))));
    add(date, 'demo-field-weight', round(74 + d * 0.012 + gauss() * 0.4, 1));
    add(date, 'demo-field-exercise', r() < 0.55);
    if (d % 9 === 0) add(date, 'demo-field-notes', 'Demo note (fake data)');
  }
  return { labs, metrics, logFields, logEntries };
}

export async function loadDemo() {
  const d = generateDemo();
  for (const [store, rows] of Object.entries(d)) await putMany(store, rows);
  await setSetting('demoLoaded', true);
  return d;
}

export async function removeDemo() {
  const ids = async (store, pred) => (await getAll(store)).filter(pred).map((x) => x.id);
  await removeMany('labs', await ids('labs', (l) => String(l.id).startsWith('demo-')));
  await removeMany('metrics', await ids('metrics', (m) => m.source === 'demo'));
  await removeMany('logEntries', await ids('logEntries', (e) => String(e.fieldId).startsWith('demo-field-')));
  await removeMany('logFields', await ids('logFields', (f) => String(f.id).startsWith('demo-field-')));
  await deleteSetting('demoLoaded');
}
