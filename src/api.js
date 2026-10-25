// Fetch-Helfer für den Node-Server. Ohne Sitzung (401) geht's über Chatto zum Login;
// der Hash (#/London%201888/wiki/3 …) überlebt den Umweg in sessionStorage.

export async function api(path, options = {}) {
  const res = await fetch(path, { cache: 'no-cache', ...options });
  if (res.status === 401) login();
  if (!res.ok) throw Object.assign(new Error((await res.text()) || `HTTP ${res.status}`), { status: res.status });
  // Antwort immer lesen (sonst zeigt der Browser den Request als abgebrochen)
  return res.headers.get('Content-Type')?.includes('json') ? res.json() : res.text();
}

export const getJson = (path) => api(path);
export const sendJson = (path, method, body) =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
/** Lädt eine Datei roh hoch (PUT auf die Ziel-URL, kein multipart). */
export const upload = (path, file) => api(path, { method: 'PUT', body: file });

export function login() {
  // Im Chatto-iframe darf Chattos Login-Seite nicht laden: Anmeldung im Popup, danach neu laden
  if (window.top !== window) {
    if (!document.querySelector('.login-popup')) {
      const a = Object.assign(document.createElement('a'), {
        className: 'login-popup', href: '/oauth/login?popup', target: '_blank', textContent: 'Mit Chatto anmelden'
      });
      document.body.replaceChildren(a);
      new BroadcastChannel('login').onmessage = () => location.reload();
    }
    throw new Error('Anmeldung …');
  }
  sessionStorage.setItem('return', location.hash);
  location.href = '/oauth/login';
  throw new Error('Anmeldung …');
}

// Nach dem Login zurück zur ursprünglichen Seite
const back = sessionStorage.getItem('return');
if (back !== null) {
  sessionStorage.removeItem('return');
  if (!location.hash) history.replaceState(null, '', back || '#/');
}

/** Pfadsegmente URL-kodieren und mit / verbinden: enc('London 1888', 'wiki', 3) */
export const enc = (...segs) => segs.map((s) => encodeURIComponent(s)).join('/');
/** Datei im Spiel-Ordner: fileUrl('London 1888', 'Mira/Bogen.pdf') */
export const fileUrl = (spiel, pfad = '') => `/files/${enc(spiel, ...pfad.split('/').filter(Boolean))}${pfad.endsWith('/') ? '/' : ''}`;
export const spielApi = (spiel) => `/api/spiele/${enc(spiel)}`;
