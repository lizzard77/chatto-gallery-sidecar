// Lokale Vorschau ohne Docker: liefert web/ aus und bildet die nginx-Endpunkte nach
// (/files/<ordner>/ als JSON-Liste wie autoindex_format json, /thumb/ = Originalbild).
//   node dev/serve.mjs [<datenordner>] [<port>]   (Standard: dev/sample, 8090)
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const data = process.argv[2] || join(root, 'dev/sample');
const port = Number(process.argv[3] || 8090);
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml'
};

function send(res, file) {
    res.setHeader('Content-Type', types[extname(file).toLowerCase()] || 'application/octet-stream');
    createReadStream(file).on('error', () => { res.statusCode = 404; res.end(); }).pipe(res);
}

createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const match = path.match(/^\/(files|thumb)\/(.*)$/);
    if (!match) return send(res, join(root, 'web', path === '/' ? 'index.html' : path));
    const target = join(data, match[2]);
    try {
        const info = await stat(target);
        if (!info.isDirectory()) return send(res, target);
        const entries = await Promise.all((await readdir(target)).map(async (name) => {
            const s = await stat(join(target, name));
            return s.isDirectory()
                ? { name, type: 'directory', mtime: s.mtime.toUTCString() }
                : { name, type: 'file', mtime: s.mtime.toUTCString(), size: s.size };
        }));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(entries));
    } catch {
        res.statusCode = 404;
        res.end();
    }
}).listen(port, () => console.log(`Galerie: http://localhost:${port}/  (Daten: ${data})`));
