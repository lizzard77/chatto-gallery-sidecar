// Spielrunden: ein Node-Prozess für SPA (dist/), Galerie-Dateien, Abenteuer-Seiten und Login über Chatto.
// Nur Node-Standardbibliothek. Konfiguration per Env:
//   CHATTO_URL, PUBLIC_URL   Login über Chatto (OAuth + PKCE, wir sind CIMD-Client)
//   DEV_USER=<Name>          nur lokal: jeder Request ist als dieser Nutzer angemeldet
//   DATA (./data), PORT (8080)
import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const dist = join(app, 'dist');
const pdfjs = join(app, 'node_modules/pdfjs-dist');
const data = resolve(process.env.DATA || 'data');
const filesDir = join(data, 'files');
const wikiDir = join(data, 'wiki');
const port = Number(process.env.PORT || 8080);
const chatto = process.env.CHATTO_URL?.replace(/\/+$/, '');
const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, '');
const devUser = process.env.DEV_USER;
const maxUpload = 100 * 1024 * 1024;
const sessionDays = 30;

if (!devUser && !(chatto && publicUrl)) {
    console.error('CHATTO_URL und PUBLIC_URL fehlen (oder DEV_USER=<Name> nur für lokale Tests).');
    process.exit(1);
}
if (devUser) console.warn(`\n  ACHTUNG: DEV_USER=${devUser} – jeder Request ist ohne Login angemeldet. Nur lokal benutzen!\n`);

await mkdir(filesDir, { recursive: true });
await mkdir(wikiDir, { recursive: true });
// HMAC-Schlüssel für die Sitzungs-Cookies, beim ersten Start erzeugt
const secretFile = join(data, '.secret');
const secret = await readFile(secretFile, 'utf8').catch(async () => {
    const s = randomBytes(32).toString('hex');
    await writeFile(secretFile, s, { mode: 0o600 });
    return s;
});

const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm'
};

// ---- Hilfen ----

class HttpError extends Error {
    constructor(status, message = '') { super(message); this.status = status; }
}

function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}

function html(res, status, text, link = '/oauth/login', label = 'Nochmal anmelden') {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Spielrunden</title><p>${text}</p><p><a href="${link}">${label}</a></p>`);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** URL-Pfad (noch kodiert) → absoluter Pfad unter root, oder HttpError 404. Versteckte Segmente verboten. */
function safePath(root, raw, allowThumbs = false) {
    let rel;
    try { rel = decodeURIComponent(raw); } catch { throw new HttpError(400); }
    const parts = rel.split('/').filter(Boolean);
    // Einzige Ausnahme: <ordner>/.thumbs/<name>.webp (Vorschaubilder)
    const hidden = parts.some((p, i) => p.startsWith('.') && !(allowThumbs && p === '.thumbs' && i === parts.length - 2));
    if (hidden || rel.includes('\0') || rel.includes('\\')) throw new HttpError(404);
    const full = resolve(root, '.' + sep + parts.join(sep));
    if (full !== root && !full.startsWith(root + sep)) throw new HttpError(404);
    return full;
}

/** Datei ausliefern, mit einfachem Range-Support (ein Bereich) für PDF.js. */
async function sendFile(req, res, file, cache = 'no-cache', userContent = false) {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404);
    const ext = extname(file).toLowerCase();
    const headers = {
        'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': cache,
        'Accept-Ranges': 'bytes', 'Last-Modified': info.mtime.toUTCString()
    };
    // Hochgeladenes SVG/HTML darf im eigenen Origin kein Skript ausführen
    if (userContent && ['.svg', '.html', '.htm', '.xml'].includes(ext)) headers['Content-Security-Policy'] = 'sandbox';
    let start = 0, end = info.size - 1, status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        if (start > end || start >= info.size) {
            res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
            return res.end();
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || info.size === 0) return res.end();
    await pipeline(createReadStream(file, { start, end }), res).catch(() => {});
}

async function readJson(req) {
    // Nur echtes JSON: ein Formular (text/plain) von einer Nachbar-Subdomain käme ohne CORS-Preflight durch
    if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415);
    let body = '';
    for await (const chunk of req) {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) throw new HttpError(413);
    }
    try { return JSON.parse(body || '{}'); } catch { throw new HttpError(400, 'Ungültiges JSON'); }
}

/** Upload: roher Body → verstecktes .<name>.part, dann an den Zielnamen. Ohne overwrite: 409, falls es den schon gibt. */
async function receive(req, target, overwrite = false) {
    if (Number(req.headers['content-length']) > maxUpload) throw new HttpError(413);
    const dir = resolve(target, '..');
    const name = target.slice(dir.length + 1);
    if (!overwrite && await stat(target).then(() => true, () => false)) throw new HttpError(409);
    const part = join(dir, `.${name}.${randomBytes(4).toString('hex')}.part`);
    let size = 0;
    const limit = new Transform({
        transform(chunk, _, done) {
            size += chunk.length;
            done(size > maxUpload ? new HttpError(413) : null, chunk);
        }
    });
    try {
        await pipeline(req, limit, createWriteStream(part));
        // link() schlägt atomar fehl, wenn inzwischen jemand anders die Datei angelegt hat
        if (overwrite) await rename(part, target);
        else await link(part, target).catch((e) => { throw e.code === 'EEXIST' ? new HttpError(409) : e; });
    } finally {
        await unlink(part).catch(() => {});
    }
}

const isDir = (p) => stat(p).then((s) => s.isDirectory(), () => false);

// ---- Sitzung (signiertes Cookie) ----

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');

function sessionCookie(user) {
    const exp = Math.floor(Date.now() / 1000) + sessionDays * 86400;
    const payload = b64(JSON.stringify({ ...user, exp }));
    const secure = publicUrl?.startsWith('http://') ? '' : '; Secure';
    return `session=${payload}.${sign(payload)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${sessionDays * 86400}`;
}

const cookieValue = (req, name) => (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1);
const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function currentUser(req) {
    if (devUser) return { id: 'dev', login: devUser.toLowerCase(), name: devUser };
    const [payload, sig] = (cookieValue(req, 'session') || '').split('.');
    if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
    try {
        const { id, login, name, exp } = JSON.parse(Buffer.from(payload, 'base64url'));
        return exp > Date.now() / 1000 ? { id, login, name } : null;
    } catch { return null; }
}

// ---- Login über Chatto ----

// state + PKCE-Verifier liegen bis zum Callback in einem Cookie dieses Browsers (gegen Login-CSRF).
// __Host- verhindert, dass eine Nachbar-Subdomain das Cookie unterschiebt (nur mit HTTPS möglich).
const oauthCookie = publicUrl?.startsWith('https://') ? '__Host-oauth' : 'oauth';
const clientId = `${publicUrl}/oauth/client.json`;
const redirectUri = `${publicUrl}/oauth/callback`;

async function oauth(req, res, url) {
    const route = url.pathname.slice('/oauth/'.length);
    if (route === 'logout') {
        res.writeHead(302, { Location: '/', 'Set-Cookie': 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
        return res.end();
    }
    if (devUser || !chatto) throw new HttpError(404);
    if (route === 'client.json') {
        return json(res, 200, {
            client_id: clientId, client_name: 'Spielrunden', client_uri: publicUrl, redirect_uris: [redirectUri],
            token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], application_type: 'web'
        });
    }
    if (route === 'login') {
        const state = b64(randomBytes(24)), verifier = b64(randomBytes(32));
        const q = new URLSearchParams({
            response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
            code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state
        });
        const secure = oauthCookie.startsWith('__Host-') ? '; Secure' : '';
        res.writeHead(302, {
            Location: `${chatto}/oauth/authorize?${q}`, 'Cache-Control': 'no-store',
            'Set-Cookie': `${oauthCookie}=${state}.${verifier}${url.searchParams.has('popup') ? '.p' : ''}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=600`
        });
        return res.end();
    }
    if (route === 'callback') {
        const p = url.searchParams;
        if (p.get('error')) return html(res, 400, `Anmeldung bei Chatto fehlgeschlagen (${esc(p.get('error'))}).`);
        const [state, verifier, popup] = (cookieValue(req, oauthCookie) || '').split('.');
        if (!state || !safeEqual(state, p.get('state') || '') || !p.get('code')) return html(res, 400, 'Die Anmeldung ist abgelaufen oder ungültig.');
        const token = await fetch(`${chatto}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code', code: p.get('code'), code_verifier: verifier,
                redirect_uri: redirectUri, client_id: clientId
            })
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!token?.user?.id) return html(res, 502, 'Chatto hat die Anmeldung nicht bestätigt.');
        // Token wird nicht gebraucht: gleich wieder freigeben, damit keine Bearer-Sitzung herumliegt
        await fetch(`${chatto}/auth/revoke-token`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.access_token })
        }).catch(() => {});
        const { id, login, displayName } = token.user;
        const cookies = [sessionCookie({ id, login, name: displayName || login }), `${oauthCookie}=; Path=/; Max-Age=0${oauthCookie.startsWith('__Host-') ? '; Secure' : ''}`];
        // Popup (Wiki im Chatto-iframe, dort darf Chattos Login-Seite nicht laden): dem iframe Bescheid geben und schließen
        if (popup) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': cookies });
            return res.end(`<!doctype html><meta charset="utf-8"><title>Spielrunden</title><p>Angemeldet – das Fenster kann zu.</p>
<script>new BroadcastChannel('login').postMessage(1); close();</script>`);
        }
        res.writeHead(302, { Location: '/', 'Set-Cookie': cookies });
        return res.end();
    }
    throw new HttpError(404);
}

// ---- Abenteuer-Seiten ($DATA/wiki/<nr>.json) ----

const pageFile = (nr) => join(wikiDir, `${nr}.json`);
const readPage = (nr) => readFile(pageFile(nr), 'utf8').then(JSON.parse, () => { throw new HttpError(404); });

async function writePage(page) {
    const tmp = pageFile(page.nr) + '.tmp';
    await writeFile(tmp, JSON.stringify(page, null, 2));
    await rename(tmp, pageFile(page.nr));
    return page;
}

// Schreibzugriffe nacheinander, damit Prüfen-und-Speichern (409) und „nächste Nummer" nicht überlappen
let queue = Promise.resolve();
function serial(fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
}

const coord = (v) => {
    if (!Number.isFinite(v)) throw new HttpError(400, 'x/y fehlen');
    return Math.round(v);
};
const str = (v) => (v == null ? '' : String(v));

async function pagesApi(req, res, url, me) {
    const [, nrRaw, sub] = url.pathname.match(/^\/api\/pages(?:\/([^/]+))?(?:\/([^/]+))?$/) || [];
    if (nrRaw !== undefined && !/^\d+$/.test(nrRaw)) throw new HttpError(404);
    const nr = Number(nrRaw);
    const m = req.method;
    const stamp = (page) => ({ ...page, updated: new Date().toISOString(), updatedBy: me.name });

    if (nrRaw === undefined && m === 'GET') {
        const names = (await readdir(wikiDir)).filter((n) => /^\d+\.json$/.test(n));
        const pages = await Promise.all(names.map((n) => readPage(parseInt(n)).catch(() => null)));
        return json(res, 200, pages.filter(Boolean).map(({ nr, title, x, y }) => ({ nr, title, x, y })).sort((a, b) => a.nr - b.nr));
    }
    if (nrRaw === undefined && m === 'POST') {
        const body = await readJson(req);
        const x = coord(body.x), y = coord(body.y);
        const page = await serial(async () => {
            const nrs = (await readdir(wikiDir)).filter((n) => /^\d+\.json$/.test(n)).map((n) => parseInt(n));
            return writePage(stamp({ nr: Math.max(0, ...nrs) + 1, title: str(body.title).trim(), x, y, blocks: [] }));
        });
        return json(res, 201, page);
    }
    if (nrRaw !== undefined && !sub && m === 'GET') return json(res, 200, await readPage(nr));
    if (nrRaw !== undefined && !sub && m === 'PUT') {
        const body = await readJson(req);
        if (!Array.isArray(body.blocks)) throw new HttpError(400, 'blocks fehlt');
        // Nur bekannte Felder als Text speichern
        const blocks = body.blocks.map(({ type, text, file }) => ({
            type: str(type), ...(text != null && { text: str(text) }), ...(file != null && { file: str(file) })
        }));
        return serial(async () => {
            const page = await readPage(nr);
            if (body.updated !== page.updated) return json(res, 409, page);
            json(res, 200, await writePage(stamp({ ...page, title: str(body.title), blocks })));
        });
    }
    if (nrRaw !== undefined && sub === 'pos' && m === 'PUT') {
        const body = await readJson(req);
        const x = coord(body.x), y = coord(body.y);
        return json(res, 200, await serial(async () => writePage({ ...await readPage(nr), x, y })));
    }
    if (nrRaw !== undefined && !sub && m === 'DELETE') {
        await serial(async () => {
            await readPage(nr);
            await rm(pageFile(nr));
            await rm(join(wikiDir, String(nr)), { recursive: true, force: true });
        });
        res.writeHead(204);
        return res.end();
    }
    throw new HttpError(m === 'GET' ? 404 : 405);
}

// ---- Galerie ($DATA/files) ----

async function listDir(dir) {
    const names = (await readdir(dir)).filter((n) => !n.startsWith('.'));
    const entries = await Promise.all(names.map(async (name) => {
        const s = await stat(join(dir, name)).catch(() => null);
        if (!s) return null;
        return s.isDirectory()
            ? { name, type: 'directory', mtime: s.mtime.toUTCString() }
            : { name, type: 'file', mtime: s.mtime.toUTCString(), size: s.size };
    }));
    return entries.filter(Boolean);
}

async function files(req, res, url) {
    const raw = url.pathname.slice('/files'.length);
    if (req.method === 'PUT') {
        const target = safePath(filesDir, raw, true);
        const dir = resolve(target, '..');
        if (raw.endsWith('/') || target === filesDir) throw new HttpError(400);
        const thumb = dir.endsWith(sep + '.thumbs');
        if (thumb && !target.endsWith('.webp')) throw new HttpError(400);
        if (!await isDir(thumb ? resolve(dir, '..') : dir)) throw new HttpError(404, 'Ordner fehlt');
        if (thumb) await mkdir(dir, { recursive: true });
        await receive(req, target, thumb);
        res.writeHead(201);
        return res.end();
    }
    const target = safePath(filesDir, raw);
    if (await isDir(target)) {
        if (!raw.endsWith('/')) {
            res.writeHead(301, { Location: url.pathname + '/' });
            return res.end();
        }
        return json(res, 200, await listDir(target));
    }
    return sendFile(req, res, target, 'no-cache', true);
}

async function thumb(req, res, url) {
    const target = safePath(filesDir, url.pathname.slice('/thumb'.length));
    const dir = resolve(target, '..');
    const small = join(dir, '.thumbs', target.slice(dir.length + 1) + '.webp');
    const cache = 'private, max-age=2592000';
    return sendFile(req, res, await stat(small).then(() => small, () => target), cache, true);
}

async function wikiFiles(req, res, url) {
    const [, nrRaw, name] = url.pathname.match(/^\/wiki\/(\d+)\/([^/]+)$/) || [];
    if (!nrRaw) throw new HttpError(404);
    const nr = String(Number(nrRaw));
    const target = safePath(wikiDir, `/${nr}/${name}`);
    if (req.method === 'PUT') {
        await readPage(nr);
        await mkdir(join(wikiDir, nr), { recursive: true });
        await receive(req, target);
        res.writeHead(201);
        return res.end();
    }
    return sendFile(req, res, target, 'no-cache', true);
}

// ---- Statisches: dist/ und PDF.js ----

async function vendor(req, res, url) {
    const rest = url.pathname.slice('/vendor/pdfjs/'.length);
    const file = rest.endsWith('.mjs') && !rest.includes('/')
        ? safePath(join(pdfjs, 'build'), rest)
        : /^(cmaps|standard_fonts|wasm|iccs)\//.test(rest) ? safePath(pdfjs, rest) : null;
    if (!file) throw new HttpError(404);
    return sendFile(req, res, file, 'public, max-age=86400');
}

function staticFile(req, res, url) {
    const p = url.pathname === '/' ? '/index.html' : url.pathname;
    const cache = /^\/assets\//.test(p) ? 'public, max-age=31536000, immutable'
        : /^\/(map|fonts)\//.test(p) ? 'public, max-age=86400' : 'no-cache';
    return sendFile(req, res, safePath(dist, p), cache);
}

// ---- Server ----

createServer(async (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
        const url = new URL(req.url, 'http://x');
        const p = url.pathname;
        const read = req.method === 'GET' || req.method === 'HEAD';
        if (p.startsWith('/oauth/')) return await oauth(req, res, url);
        if (p.startsWith('/vendor/pdfjs/') && read) return await vendor(req, res, url);
        const area = p.match(/^\/(api|files|thumb|wiki)\//)?.[1];
        if (!area) {
            if (!read) throw new HttpError(405);
            return await staticFile(req, res, url);
        }
        // Alles andere nur mit Sitzung; die SPA leitet bei 401 selbst zum Login
        const me = currentUser(req);
        if (!me) throw new HttpError(401, 'Nicht angemeldet');
        if (area === 'api') {
            if (p === '/api/me' && read) return json(res, 200, me);
            if (/^\/api\/pages(\/|$)/.test(p)) return await pagesApi(req, res, url, me);
            throw new HttpError(404);
        }
        if (!read && req.method !== 'PUT') throw new HttpError(405);
        if (area === 'files') return await files(req, res, url);
        if (area === 'wiki') return await wikiFiles(req, res, url);
        if (read) return await thumb(req, res, url);
        throw new HttpError(405);
    } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) console.error(req.method, req.url, e);
        if (res.headersSent) return res.destroy();
        // Bei abgelehntem Upload den Rest des Bodys nicht mehr lesen
        if (req.method === 'PUT' && !req.complete) res.setHeader('Connection', 'close');
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(e instanceof HttpError ? e.message : 'Serverfehler');
    }
}).listen(port, () => console.log(`Spielrunden: http://localhost:${port}/  (Daten: ${data})`));
