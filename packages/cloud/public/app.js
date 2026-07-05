// Shared helpers for the Whats On cloud web UI. Same-origin API (/api).
const API = '/api';
const TOKEN_KEY = 'whatson_cloud_token';

function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch {} }
function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }
function authHeaders() { const t = getToken(); return t ? { Authorization: 'Bearer ' + t } : {}; }

async function apiPost(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body || {}),
  });
  const b = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: b };
}

async function apiGet(path) {
  const res = await fetch(API + path, { headers: { ...authHeaders() } });
  const b = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: b };
}

function setMsg(text, kind) {
  const el = document.getElementById('msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

// Redirect to sign-in (preserving where we were headed) when not authenticated.
function requireAuth() {
  if (!getToken()) {
    location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
    return false;
  }
  return true;
}

function signOut() {
  clearToken();
  location.replace('/');
}
