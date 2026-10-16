// Optional PIN lock. The PIN is stored only as a salted PBKDF2 hash.
// NOTE: this is a screen lock, not encryption — the data in IndexedDB is not encrypted.
import { getSetting, setSetting, deleteSetting } from './db.js';

const ITERATIONS = 150000;

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex) {
  return new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
}

async function derive(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return toHex(bits);
}

export function isValidPin(pin) { return /^\d{4,12}$/.test(pin); }

export async function hasPin() { return Boolean(await getSetting('pin')); }

export async function setPin(pin) {
  if (!isValidPin(pin)) throw new Error('PIN must be 4–12 digits');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await setSetting('pin', { salt: toHex(salt), hash: await derive(pin, salt), iterations: ITERATIONS });
}

export async function verifyPin(pin) {
  const rec = await getSetting('pin');
  if (!rec) return true;
  return (await derive(String(pin), fromHex(rec.salt))) === rec.hash;
}

export async function clearPin() { await deleteSetting('pin'); }
