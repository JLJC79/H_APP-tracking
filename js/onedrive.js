// OneDrive connection: sign-in (OAuth 2.0 authorization code + PKCE, no library, no server) and
// the few Microsoft Graph calls sync needs.
//
// Access is limited to the app's own folder (scope Files.ReadWrite.AppFolder), which OneDrive
// creates as "Apps/<app registration name>". The app cannot see anything else in OneDrive.
// Tokens are kept in this device's IndexedDB, like everything else.
import { getSetting, setSetting, deleteSetting } from './db.js';

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'Files.ReadWrite.AppFolder offline_access';
const ROOT = '/me/drive/special/approot';

export const FOLDERS = ['inbox', 'inbox/wearables', 'inbox/labs', 'done', 'done/wearables', 'done/labs'];

const redirectUri = () => location.origin + location.pathname;

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(n = 48) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }

export async function getClientId() { return (await getSetting('odClientId', '')) || ''; }
export async function setClientId(id) { return setSetting('odClientId', id.trim()); }
export async function isConnected() { return Boolean(await getSetting('odToken', null)); }

/** Sends the browser to Microsoft's sign-in page. Comes back to this page with ?code=…&state=…. */
export async function signIn(returnHash = '#/settings') {
  const clientId = await getClientId();
  if (!clientId) throw new Error('Enter the application (client) ID first.');
  const verifier = randomString();
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(16);
  sessionStorage.setItem('od-auth', JSON.stringify({ verifier, state, returnHash }));
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
    scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  location.assign(`${AUTHORITY}/authorize?${q}`);
}

async function tokenRequest(params) {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: await getClientId(), scope: SCOPE, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description || body.error || `Sign-in failed (${res.status})`);
  const token = {
    access: body.access_token,
    refresh: body.refresh_token || null,
    expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60000,
  };
  await setSetting('odToken', token);
  return token;
}

/**
 * Call once at start-up. If this page load is the return from Microsoft sign-in, finishes it,
 * cleans the address bar and returns { done: true, returnHash } (or { error }). Otherwise null.
 */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  const saved = JSON.parse(sessionStorage.getItem('od-auth') || 'null');
  sessionStorage.removeItem('od-auth');
  const returnHash = (saved && saved.returnHash) || '#/settings';
  history.replaceState(null, '', location.pathname + returnHash);
  if (q.has('error')) return { error: q.get('error_description') || q.get('error'), returnHash };
  if (!saved || saved.state !== q.get('state')) return { error: 'Sign-in could not be verified. Please try again.', returnHash };
  try {
    await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: saved.verifier });
    return { done: true, returnHash };
  } catch (e) {
    return { error: e.message, returnHash };
  }
}

export async function signOut() { await deleteSetting('odToken'); }

/** A valid access token, refreshing if needed; null when the person must sign in again. */
async function accessToken() {
  const t = await getSetting('odToken', null);
  if (!t) return null;
  if (t.access && Date.now() < t.expires) return t.access;
  if (!t.refresh) return null;
  try {
    return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh })).access;
  } catch {
    await signOut(); // refresh tokens for browser apps expire after a day; sign in again
    return null;
  }
}

export class SignInNeeded extends Error {}

async function graph(path, { method = 'GET', body, raw = false } = {}) {
  const token = await accessToken();
  if (!token) throw new SignInNeeded('Sign in to OneDrive again.');
  const res = await fetch(GRAPH + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { await signOut(); throw new SignInNeeded('Sign in to OneDrive again.'); }
  if (raw) {
    if (!res.ok) throw new Error(`OneDrive download failed (${res.status})`);
    return res;
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || `OneDrive request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const enc = (path) => path.split('/').map(encodeURIComponent).join('/');

/** Creates the inbox/done folders in the app folder if missing. */
export async function ensureFolders() {
  const childFolders = async (path) => {
    try {
      const page = await graph(`${path ? `${ROOT}:/${enc(path)}:` : ROOT}/children?$select=name,folder&$top=200`);
      return new Set(page.value.filter((x) => x.folder).map((x) => x.name));
    } catch (e) {
      if (e.status === 404) return new Set();
      throw e;
    }
  };
  const known = new Map(); // parent path -> Set of child folder names
  for (const f of FOLDERS) {
    const i = f.lastIndexOf('/');
    const parentPath = i < 0 ? '' : f.slice(0, i);
    const name = f.slice(i + 1);
    if (!known.has(parentPath)) known.set(parentPath, await childFolders(parentPath));
    if (known.get(parentPath).has(name)) continue;
    const parent = parentPath ? `${ROOT}:/${enc(parentPath)}:` : ROOT;
    try {
      await graph(`${parent}/children`, { method: 'POST', body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' } });
    } catch (e) {
      if (e.status !== 409) throw e; // 409: created meanwhile
    }
    known.get(parentPath).add(name);
    known.set(f, new Set()); // just created: no children yet
  }
}

/** Files (not folders) directly inside a folder of the app folder, e.g. "inbox/labs". */
export async function listFiles(folder) {
  const out = [];
  let next = `${ROOT}:/${enc(folder)}:/children?$top=200&$select=id,name,size,file,lastModifiedDateTime`;
  while (next) {
    const page = await graph(next);
    out.push(...page.value.filter((x) => x.file));
    next = page['@odata.nextLink'] ? page['@odata.nextLink'].replace(GRAPH, '') : null;
  }
  return out;
}

export async function downloadText(item) {
  const res = await graph(`/me/drive/items/${encodeURIComponent(item.id)}/content`, { raw: true });
  return res.text();
}

const folderIds = new Map();
async function folderId(folder) {
  if (!folderIds.has(folder)) folderIds.set(folder, (await graph(`${ROOT}:/${enc(folder)}`)).id);
  return folderIds.get(folder);
}

/** Moves a processed file to done/<kind>, prefixed with the date so same-named exports don't clash. */
export async function moveToDone(item, kind) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  await graph(`/me/drive/items/${encodeURIComponent(item.id)}`, {
    method: 'PATCH',
    body: { parentReference: { id: await folderId(`done/${kind}`) }, name: `${stamp}_${item.name}` },
  });
}
