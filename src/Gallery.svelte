<script>
  // Dateien eines Spiels: liest Ordnerlisten als JSON unter /files/<Spiel>/ und zeigt Unterordner
  // als Karten, PDFs/Dokumente als Buttons und Bilder als Raster. Ein PDF öffnet sich als
  // #/<Spiel>/dateien/Ordner/Datei.pdf (ohne Schrägstrich am Ende) im PDF-Viewer.
  // Hochladen per Knopf oder Drag & Drop; für Bilder und PDFs baut der Browser gleich ein Vorschaubild
  // (fehlende auch nachträglich beim Anzeigen). Eigene Uploads lassen sich über ✕ löschen.
  import { api, getJson, upload, enc } from './api.js';
  import { makeThumb } from './thumb.js';
  import { pdfThumb } from './pdfviewer.js';
  import PdfOverlay from './PdfOverlay.svelte';
  import Lightbox from './Lightbox.svelte';

  /** spiel = Ordner unter files/; path = roher Hash-Rest hinter dateien/, URL-kodiert, z. B. "Mira/" */
  let { spiel, path } = $props();

  const IMAGE = /\.(jpe?g|png|webp|gif|avif|svg|heic)$/i;
  // Für diese Formate gibt es Vorschaubilder (.thumbs/*.webp); alles andere wird direkt geladen
  const THUMBABLE = /\.(jpe?g|png|webp|gif)$/i;
  const PDF = /\.pdf$/i;

  const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const byName = (a, b) => collator.compare(a.name, b.name);
  const stripExt = (name) => name.replace(/\.[^.]+$/, '');
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

  // segments = Pfad relativ zum Spiel-Ordner
  const fileHref = (segments) => `#/${enc(spiel)}/dateien/${enc(...segments)}`;
  const folderHref = (segments) => fileHref(segments) + (segments.length ? '/' : '');
  const rawUrl = (segments) => `/files/${enc(spiel, ...segments)}`;
  const thumbUrl = (segments, entry) => entry.thumb || THUMBABLE.test(entry.name)
    ? `/thumb/${enc(spiel, ...segments)}?v=${encodeURIComponent(entry.mtime || '')}${entry.thumb ? '' : '-'}`
    : rawUrl(segments);
  const thumbPut = (segments) => rawUrl([...segments.slice(0, -1), '.thumbs', `${segments.at(-1)}.webp`]);

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  }

  // Ordnerlisten zwischenspeichern (auch für die Titelbilder der Ordnerkarten)
  const listings = new Map();
  function list(segments) {
    const key = enc(spiel, ...segments);
    if (!listings.has(key)) {
      const promise = getJson(`/files/${key}/`)
        .catch((error) => { throw error.status === 404 ? new Error('Ordner nicht gefunden') : error; })
        .then((entries) => entries.filter((e) => !e.name.startsWith('.')));
      listings.set(key, promise);
      promise.catch(() => listings.delete(key));
    }
    return listings.get(key);
  }

  const segments = $derived(path.split('/').filter(Boolean).map(decode));
  const isPdf = $derived(!path.endsWith('/') && PDF.test(segments.at(-1) ?? ''));
  // Ein PDF öffnet als Overlay über seinem Ordner
  const dir = $derived(isPdf ? segments.slice(0, -1) : segments);
  const canUpload = true;

  let error = $state('');
  let loaded = $state(false);
  let folders = $state([]);
  let pdfs = $state.raw([]);
  let docs = $state.raw([]);
  let images = $state.raw([]);
  let lightbox = $state(null);
  let status = $state('');
  let dragging = $state(false);

  async function load(segs, scroll) {
    const key = enc(spiel, ...segs);
    const current = () => key === enc(spiel, ...dir);
    let entries;
    try {
      entries = await list(segs);
    } catch (e) {
      if (current()) { error = `Fehler: ${e.message}`; loaded = true; }
      return;
    }
    if (!current()) return; // inzwischen weiternavigiert
    const files = entries.filter((e) => e.type === 'file').sort(byName);
    error = '';
    // PDFs als Kacheln mit Vorschau der ersten Seite, andere Dateien als Knöpfe
    pdfs = files.filter((e) => PDF.test(e.name))
      .map((e) => ({ ...e, url: rawUrl([...segs, e.name]), href: fileHref([...segs, e.name]), thumb: e.thumb ? thumbUrl([...segs, e.name], e) : null }));
    docs = files.filter((e) => !IMAGE.test(e.name) && !PDF.test(e.name))
      .map((e) => ({ ...e, url: rawUrl([...segs, e.name]) }));
    images = files.filter((e) => IMAGE.test(e.name))
      .map((e) => ({ name: e.name, meins: e.meins, url: rawUrl([...segs, e.name]), thumb: thumbUrl([...segs, e.name], e) }));
    nachbauen(segs, files.filter((e) => !e.thumb && (PDF.test(e.name) || THUMBABLE.test(e.name))));
    folders = entries.filter((e) => e.type === 'directory').sort(byName)
      .map((e) => ({ name: e.name, href: folderHref([...segs, e.name]), cover: null, meta: '' }));
    // Titelbild und Zähler der Ordnerkarten kommen nachträglich
    for (const card of folders) {
      const sub = [...segs, card.name];
      list(sub).then((entries) => Object.assign(card, summarize(sub, entries))).catch(() => {});
    }
    loaded = true;
    if (scroll) window.scrollTo(0, 0);
  }

  // Fehlende Vorschaubilder (ältere Uploads, per scp kopierte Dateien) im Browser bauen, eins nach dem anderen
  let baut = Promise.resolve();
  function nachbauen(segs, entries) {
    for (const e of entries) baut = baut.then(async () => {
      if (enc(spiel, ...segs) !== enc(spiel, ...dir)) return;
      const segments = [...segs, e.name];
      const blob = PDF.test(e.name) ? await pdfThumb(rawUrl(segments))
        : await fetch(rawUrl(segments)).then((r) => (r.ok ? r.blob() : null)).then((b) => b && makeThumb(b)).catch(() => null);
      if (!blob || !await upload(thumbPut(segments), blob).then(() => true, () => false)) return;
      const thumb = thumbUrl(segments, { ...e, thumb: true });
      listings.delete(enc(spiel, ...segs));
      if (PDF.test(e.name)) pdfs = pdfs.map((p) => (p.name === e.name ? { ...p, thumb } : p));
      else images = images.map((i) => (i.name === e.name ? { ...i, thumb } : i));
    }).catch(() => {});
  }

  async function loeschen(name) {
    if (!confirm(`„${name}“ wirklich löschen?`)) return;
    const segs = dir;
    try {
      await api(rawUrl([...segs, name]), { method: 'DELETE' });
      status = '';
    } catch (e) {
      status = `Fehler beim Löschen: ${e.message}`;
    }
    listings.clear();
    load(segs, false);
  }

  function summarize(segs, entries) {
    const imgs = entries.filter((e) => e.type === 'file' && IMAGE.test(e.name)).sort(byName);
    const docCount = entries.filter((e) => e.type === 'file' && !IMAGE.test(e.name)).length;
    const folderCount = entries.filter((e) => e.type === 'directory').length;
    // Ein Bild namens portrait/cover/titel wird bevorzugt
    const preferred = imgs.find((e) => /^(portrait|cover|titel|title|avatar)\./i.test(e.name)) ?? imgs[0];
    return {
      cover: preferred ? thumbUrl([...segs, preferred.name], preferred) : null,
      meta: [
        docCount && `${docCount} ${docCount === 1 ? 'Dokument' : 'Dokumente'}`,
        imgs.length && `${imgs.length} ${imgs.length === 1 ? 'Bild' : 'Bilder'}`,
        folderCount && `${folderCount} Ordner`
      ].filter(Boolean).join(' · ') || 'leer'
    };
  }

  // Neuer Pfad: Lightbox zu, Ordner laden (den Seitentitel setzt App.svelte)
  $effect(() => {
    const segs = dir;
    lightbox = null;
    load(segs, !isPdf);
  });

  // Beim Zurückkehren in den Tab (z. B. aus Chatto) neu laden, damit frisch hochgeladene
  // Dateien erscheinen – ohne Scrollposition oder offenes Bild zu verlieren
  function onvisibilitychange() {
    if (document.visibilityState !== 'visible' || lightbox !== null || isPdf) return;
    listings.clear();
    load(dir, false);
  }

  /** Lädt Dateien in den aktuellen Ordner; vorhandene Namen bekommen " (2)", " (3)" … */
  async function uploadFiles(files) {
    files = [...files];
    if (!files.length || !canUpload) return;
    const segs = dir;
    try {
      for (const [i, file] of files.entries()) {
        status = `Lade ${i + 1}/${files.length} hoch …`;
        const name = await uploadUnique(segs, file);
        const blob = THUMBABLE.test(name) ? await makeThumb(file)
          : PDF.test(name) ? await pdfThumb(await file.arrayBuffer()) : null;
        // ohne Vorschaubild geht's auch
        if (blob) await upload(thumbPut([...segs, name]), blob).catch(() => {});
      }
      status = '';
    } catch (e) {
      status = e.status === 413 ? 'Fehler: Datei zu groß (max. 100 MB)' : `Fehler beim Hochladen: ${e.message}`;
    }
    listings.clear();
    load(dir, false);
  }

  async function uploadUnique(segs, file) {
    const stem = stripExt(file.name) || file.name;
    const ext = file.name.slice(stem.length);
    for (let n = 1; ; n++) {
      const name = n === 1 ? file.name : `${stem} (${n})${ext}`;
      try {
        await upload(rawUrl([...segs, name]), file);
        return name;
      } catch (e) {
        if (e.status !== 409) throw e;
      }
    }
  }

  const hasFiles = (ev) => canUpload && ev.dataTransfer?.types.includes('Files');
  function ondragover(ev) {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    dragging = true;
  }
  function ondrop(ev) {
    dragging = false;
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    uploadFiles(ev.dataTransfer.files);
  }
</script>

<svelte:window {ondragover} {ondrop} ondragleave={(ev) => { if (!ev.relatedTarget) dragging = false; }} />
<svelte:document {onvisibilitychange} />

<div class="gallery-head">
  <nav class="crumbs" aria-label="Pfad">
    {#if segments.length}
      <a href={folderHref([])}>Dateien</a>
      {#each segments as name, i}
        <span class="sep">›</span>
        {#if i === segments.length - 1}
          <span class="current">{PDF.test(name) ? stripExt(name) : name}</span>
        {:else}
          <a href={folderHref(segments.slice(0, i + 1))}>{name}</a>
        {/if}
      {/each}
    {:else}
      <span class="current">Dateien</span>
    {/if}
  </nav>
  {#if canUpload}
    <span class="spacer"></span>
    {#if status}<span class="upload-status" class:error={status.startsWith('Fehler')}>{status}</span>{/if}
    <label class="upload">
      ⬆ Hochladen
      <input type="file" multiple hidden onchange={(ev) => { uploadFiles(ev.target.files); ev.target.value = ''; }}>
    </label>
  {/if}
</div>

<main class="gallery" class:dragging aria-live="polite">
  {#if error}
    <p class="error">{error}</p>
  {:else if loaded}
    {#if pdfs.length || docs.length}
      <h2 class="section-title">{pdfs.length + docs.length === 1 ? 'Dokument' : 'Dokumente'}</h2>
      {#if pdfs.length}
        <div class="pdfs">
          {#each pdfs as d (d.name)}
            <div class="kachel">
              <a class="pdf" href={d.href}>
                <span class="seite">{#if d.thumb}<img src={d.thumb} alt="" loading="lazy">{:else}<span aria-hidden="true">📄</span>{/if}</span>
                <span class="name">{stripExt(d.name)}</span><span class="size">{formatSize(d.size)}</span>
              </a>
              {#if d.meins}<button class="del" type="button" title="Löschen" aria-label="{d.name} löschen" onclick={() => loeschen(d.name)}>✕</button>{/if}
            </div>
          {/each}
        </div>
      {/if}
      {#if docs.length}
        <div class="docs">
          {#each docs as d (d.name)}
            <span class="kachel">
              <a class="doc other" href={d.url} target="_blank" rel="noopener">
                <span aria-hidden="true">📎</span>{stripExt(d.name)}<span class="size">{formatSize(d.size)}</span>
              </a>
              {#if d.meins}<button class="del" type="button" title="Löschen" aria-label="{d.name} löschen" onclick={() => loeschen(d.name)}>✕</button>{/if}
            </span>
          {/each}
        </div>
      {/if}
    {/if}
    {#if images.length}
      <h2 class="section-title">Bilder</h2>
      <div class="images">
        {#each images as img, i (img.name)}
          <div class="kachel">
            <button class="thumb" type="button" title={stripExt(img.name)} onclick={() => (lightbox = i)}>
              <!-- HEIC & Co. kann der Browser evtl. nicht – dann zumindest das Original versuchen -->
              <img src={img.thumb} alt={stripExt(img.name)} loading="lazy"
                onerror={(ev) => { if (!ev.target.dataset.fallback) { ev.target.dataset.fallback = '1'; ev.target.src = img.url; } }}>
            </button>
            {#if img.meins}<button class="del" type="button" title="Löschen" aria-label="{img.name} löschen" onclick={() => loeschen(img.name)}>✕</button>{/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if folders.length}
      <h2 class="section-title">Ordner</h2>
      <div class="folders">
        {#each folders as card (card.name)}
          <a class="card" href={card.href}>
            <div class="cover" style:background-image={card.cover && `url("${card.cover}")`}>{card.cover ? '' : '📁'}</div>
            <div class="label"><div class="name">{card.name}</div><div class="meta">{card.meta}</div></div>
          </a>
        {/each}
      </div>
    {/if}
    {#if !pdfs.length && !docs.length && !images.length && !folders.length}
      <p class="empty">Dieser Ordner ist leer.{#if canUpload} Dateien hierher ziehen oder „Hochladen“ wählen.{/if}</p>
    {/if}
  {/if}
</main>

<Lightbox {images} bind:index={lightbox} />
{#if isPdf}<PdfOverlay url={rawUrl(segments)} onclose={() => (location.hash = folderHref(dir))} />{/if}
