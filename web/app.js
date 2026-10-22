// Galerie: liest Ordnerlisten als JSON (nginx autoindex_format json) unter /files/
// und zeigt Unterordner als Karten, PDFs/Dokumente als Buttons und Bilder als Raster.
// Navigation über den Hash (#/Ordner/Unterordner/), damit Links auf einen Charakter gehen.
// Ein PDF öffnet sich als #/Ordner/Datei.pdf (ohne Schrägstrich am Ende) im PDF-Viewer.

import { showPdf } from './pdfviewer.js';

const IMAGE = /\.(jpe?g|png|webp|gif|avif|svg|heic)$/i;
// Diese Formate verkleinert nginx (image_filter); alles andere wird direkt geladen
const THUMBABLE = /\.(jpe?g|png|webp|gif)$/i;
const PDF = /\.pdf$/i;

const view = document.getElementById('view');
const crumbs = document.getElementById('crumbs');
const lightbox = document.getElementById('lightbox');

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const byName = (a, b) => collator.compare(a.name, b.name);

/** Ist der Hash ein PDF (letztes Segment ohne Schrägstrich am Ende)? */
const isPdfHash = () => !location.hash.endsWith('/') && PDF.test(currentPath().at(-1) ?? '');
const fileHref = (segments) => `#/${segments.map(encodeURIComponent).join('/')}`;

/** Pfadsegmente aus dem Hash, z. B. "#/Mira/Bilder/" → ["Mira", "Bilder"] */
function currentPath() {
  return decodeURIComponent(location.hash.replace(/^#\/?/, ''))
    .split('/')
    .filter(Boolean);
}

// Absolute Adressen ohne Zugangsdaten: wer die Galerie als https://user:pw@host/ öffnet, bekäme
// sonst relative URLs mit eingebetteten Zugangsdaten, und fetch() lehnt die ab. Das Login hat der
// Browser nach dem ersten Aufruf ohnehin für die Seite gespeichert.
const BASE = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;

const encodePath = (segments) => segments.map(encodeURIComponent).join('/');
const folderHref = (segments) => `#/${segments.map(encodeURIComponent).join('/')}${segments.length ? '/' : ''}`;
const fileUrl = (segments) => `${BASE}files/${encodePath(segments)}`;

function thumbUrl(segments, entry) {
  if (!THUMBABLE.test(entry.name)) return fileUrl(segments);
  return `${BASE}thumb/${encodePath(segments)}?v=${encodeURIComponent(entry.mtime || '')}`;
}

const listings = new Map();

async function list(segments) {
  const key = segments.join('/');
  if (!listings.has(key)) {
    const promise = fetch(`${BASE}files/${encodePath(segments)}${segments.length ? '/' : ''}`, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Ordner nicht gefunden' : `HTTP ${res.status}`);
        return res.json();
      })
      .then((entries) => entries.filter((e) => !e.name.startsWith('.')));
    listings.set(key, promise);
    promise.catch(() => listings.delete(key));
  }
  return listings.get(key);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const stripExt = (name) => name.replace(/\.[^.]+$/, '');

function renderCrumbs(segments) {
  crumbs.replaceChildren(
    ...segments.flatMap((name, i) => {
      const last = i === segments.length - 1;
      const sep = i > 0 ? [el('span', { class: 'sep' }, '›')] : [];
      return [...sep, last
        ? el('span', { class: 'current' }, PDF.test(name) ? stripExt(name) : name)
        : el('a', { href: folderHref(segments.slice(0, i + 1)) }, name)];
    })
  );
  if (!segments.length) crumbs.replaceChildren(el('span', { class: 'current' }, 'Spielrunden'));
  const title = segments.length ? segments.at(-1).replace(PDF, '') : '';
  document.title = title ? `${title} – Spielrunden` : 'Spielrunden';
}

/** Karte für einen Unterordner; Titelbild und Zähler kommen nachträglich. */
function folderCard(parent, entry) {
  const segments = [...parent, entry.name];
  const cover = el('div', { class: 'cover' }, '📁');
  const meta = el('div', { class: 'meta' }, '');
  list(segments).then((entries) => {
    const images = entries.filter((e) => e.type === 'file' && IMAGE.test(e.name)).sort(byName);
    const docs = entries.filter((e) => e.type === 'file' && !IMAGE.test(e.name));
    const folders = entries.filter((e) => e.type === 'directory');
    // Ein Bild namens portrait/cover/titel wird bevorzugt
    const preferred = images.find((e) => /^(portrait|cover|titel|title|avatar)\./i.test(e.name)) ?? images[0];
    if (preferred) {
      cover.textContent = '';
      cover.style.backgroundImage = `url("${thumbUrl([...segments, preferred.name], preferred)}")`;
    }
    meta.textContent = [
      docs.length && `${docs.length} ${docs.length === 1 ? 'Dokument' : 'Dokumente'}`,
      images.length && `${images.length} ${images.length === 1 ? 'Bild' : 'Bilder'}`,
      folders.length && `${folders.length} ${folders.length === 1 ? 'Ordner' : 'Ordner'}`
    ].filter(Boolean).join(' · ') || 'leer';
  }).catch(() => { meta.textContent = ''; });
  return el('a', { class: 'card', href: folderHref(segments) },
    cover,
    el('div', { class: 'label' }, el('div', { class: 'name' }, entry.name), meta));
}

let gallery = [];
let galleryIndex = 0;

function showImage(index) {
  galleryIndex = (index + gallery.length) % gallery.length;
  const { url, name } = gallery[galleryIndex];
  const img = lightbox.querySelector('img');
  img.src = url;
  img.alt = name;
  lightbox.querySelector('figcaption').textContent =
    gallery.length > 1 ? `${stripExt(name)} (${galleryIndex + 1}/${gallery.length})` : stripExt(name);
  if (!lightbox.open) lightbox.showModal();
}

let closePdf = null;

async function render({ scroll = true } = {}) {
  const segments = currentPath();
  closePdf?.();
  closePdf = null;
  renderCrumbs(segments);
  if (isPdfHash()) {
    closePdf = showPdf(view, { base: BASE, url: fileUrl(segments), el });
    if (scroll) window.scrollTo(0, 0);
    return;
  }
  let entries;
  try {
    entries = await list(segments);
  } catch (error) {
    view.replaceChildren(el('p', { class: 'error' }, `Fehler: ${error.message}`));
    return;
  }
  if (currentPath().join('/') !== segments.join('/')) return; // inzwischen weiternavigiert

  const folders = entries.filter((e) => e.type === 'directory').sort(byName);
  const files = entries.filter((e) => e.type === 'file').sort(byName);
  const images = files.filter((e) => IMAGE.test(e.name));
  // PDFs zuerst, dann andere Dateien
  const docs = files.filter((e) => !IMAGE.test(e.name))
    .sort((a, b) => Number(PDF.test(b.name)) - Number(PDF.test(a.name)) || byName(a, b));

  gallery = images.map((e) => ({ url: fileUrl([...segments, e.name]), name: e.name }));

  const parts = [];
  if (docs.length) {
    parts.push(el('h2', { class: 'section-title' }, docs.length === 1 ? 'Dokument' : 'Dokumente'));
    parts.push(el('div', { class: 'docs' }, docs.map((e) => el('a', {
      class: PDF.test(e.name) ? 'doc' : 'doc other',
      href: PDF.test(e.name) ? fileHref([...segments, e.name]) : fileUrl([...segments, e.name]),
      target: PDF.test(e.name) ? undefined : '_blank',
      rel: 'noopener'
    }, PDF.test(e.name) ? '📄' : '📎', stripExt(e.name), el('span', { class: 'size' }, formatSize(e.size))))));
  }
  if (images.length) {
    parts.push(el('h2', { class: 'section-title' }, 'Bilder'));
    parts.push(el('div', { class: 'images' }, images.map((e, i) => el('button', {
      class: 'thumb',
      type: 'button',
      title: stripExt(e.name),
      onclick: () => showImage(i)
    }, el('img', {
      src: thumbUrl([...segments, e.name], e),
      alt: stripExt(e.name),
      loading: 'lazy',
      // HEIC & Co. kann der Browser evtl. nicht – dann zumindest das Original versuchen
      onerror: (ev) => { if (!ev.target.dataset.fallback) { ev.target.dataset.fallback = '1'; ev.target.src = fileUrl([...segments, e.name]); } }
    })))));
  }
  if (folders.length) {
    parts.push(el('h2', { class: 'section-title' }, 'Ordner'));
    parts.push(el('div', { class: 'folders' }, folders.map((e) => folderCard(segments, e))));
  }
  if (!parts.length) parts.push(el('p', { class: 'empty' }, 'Dieser Ordner ist leer.'));
  view.replaceChildren(...parts);
  if (scroll) window.scrollTo(0, 0);
}

lightbox.querySelector('.lb-close').addEventListener('click', () => lightbox.close());
lightbox.querySelector('.lb-prev').addEventListener('click', () => showImage(galleryIndex - 1));
lightbox.querySelector('.lb-next').addEventListener('click', () => showImage(galleryIndex + 1));
// Klick neben das Bild schließt
lightbox.addEventListener('click', (ev) => {
  if (ev.target === lightbox || ev.target.tagName === 'FIGURE') lightbox.close();
});
lightbox.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowLeft') showImage(galleryIndex - 1);
  if (ev.key === 'ArrowRight') showImage(galleryIndex + 1);
});
// Wischen auf Touch-Geräten
let touchX = null;
lightbox.addEventListener('touchstart', (ev) => { touchX = ev.touches[0].clientX; }, { passive: true });
lightbox.addEventListener('touchend', (ev) => {
  if (touchX === null) return;
  const dx = ev.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) showImage(galleryIndex + (dx < 0 ? 1 : -1));
});

window.addEventListener('hashchange', () => {
  if (lightbox.open) lightbox.close();
  render();
});
// Beim Zurückkehren in den Tab (z. B. aus Chatto) neu laden, damit frisch hochgeladene
// Dateien erscheinen – ohne Scrollposition oder offenes Bild zu verlieren
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || lightbox.open || isPdfHash()) return;
  listings.clear();
  render({ scroll: false });
});

render();
