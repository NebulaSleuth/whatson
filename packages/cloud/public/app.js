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

/**
 * Wire a two-box code input (XXXX-XXXX): auto-uppercase, strip non-alphanumerics,
 * auto-advance to the 2nd box at 4 chars (and split a pasted full code),
 * backspace from an empty 2nd box returns to the 1st, and the 1st box is
 * focused on load. Returns () => the combined "XXXX-XXXX" value (or '').
 */
function wireCodeInput(box1Id, box2Id, onComplete, autoFocus) {
  const b1 = document.getElementById(box1Id);
  const b2 = document.getElementById(box2Id);
  const clean = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const maybeComplete = () => {
    if (onComplete && b1.value.length === 4 && b2.value.length === 4) onComplete();
  };
  b1.addEventListener('input', () => {
    const v = clean(b1.value);
    if (v.length > 4) {
      b1.value = v.slice(0, 4);
      b2.value = v.slice(4, 8);
      b2.focus();
    } else {
      b1.value = v;
      if (v.length === 4) b2.focus();
    }
    maybeComplete();
  });
  b2.addEventListener('input', () => {
    b2.value = clean(b2.value).slice(0, 4);
    maybeComplete();
  });
  b2.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && b2.value === '') b1.focus();
  });
  if (autoFocus !== false) b1.focus();
  return () => (b1.value.length || b2.value.length ? b1.value + '-' + b2.value : '');
}

/** Split a full "XXXX-XXXX" code into the two boxes. */
function fillCodeInput(box1Id, box2Id, code) {
  const parts = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  document.getElementById(box1Id).value = parts.slice(0, 4);
  document.getElementById(box2Id).value = parts.slice(4, 8);
}
