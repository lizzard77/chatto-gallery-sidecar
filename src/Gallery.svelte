<script>
  // Galerie: liest Ordnerlisten als JSON unter /files/ und zeigt Unterordner als Karten,
  // PDFs/Dokumente als Buttons und Bilder als Raster. Ein PDF öffnet sich als
  // #/galerie/Ordner/Datei.pdf (ohne Schrägstrich am Ende) im PDF-Viewer.
  // Hochladen per Knopf oder Drag & Drop; für Bilder baut der Browser gleich ein Vorschaubild.
  import { getJson, upload } from './api.js';
  import { showPdf } from './pdfviewer.js';
  import Lightbox from './Lightbox.svelte';

  /** Roher Hash-Rest hinter #/galerie/, URL-kodiert, z. B. "London%201888/Mira/" */
  let { path } = $props();

  const IMAGE = /\.(jpe?g|png|webp|gif|avif|svg|heic)$/i;
  // Für diese Formate gibt es Vorschaubilder (.thumbs/*.webp); alles andere wird direkt geladen
  const THUMBABLE = /\.(jpe?g|png|webp|gif)$/i;
  const PDF = /\.pdf$/i;
  const THUMB_SIZE = 640;

  const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const byName = (a, b) => collator.compare(a.name, b.name);
  const stripExt = (name) => name.replace(/\.[^.]+$/, '');
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

  const encodePath = (segments) => segments.map(encodeURIComponent).join('/');
  const folderHref = (segments) => `#/galerie/${encodePath(segments)}${segments.length ? '/' : ''}`;
  const fileHref = (segments) => `#/galerie/${encodePath(segments)}`;
  const fileUrl = (segments) => `/files/${encodePath(segments)}`;
  const thumbUrl = (segments, entry) => THUMBABLE.test(entry.name)
    ? `/thumb/${encodePath(segments)}?v=${encodeURIComponent(entry.mtime || '')}`
    : fileUrl(segments);

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  }

  // Ordnerlisten zwischenspeichern (auch für die Titelbilder der Ordnerkarten)
  const listings = new Map();
  function list(segments) {
    const key = segments.join('/');
    if (!listings.has(key)) {
      const promise = getJson(`/files/${encodePath(segments)}${segments.length ? '/' : ''}`)
        .catch((error) => { throw error.status === 404 ? new Error('Ordner nicht gefunden') : error; })
        .then((entries) => entries.filter((e) => !e.name.startsWith('.')));
      listings.set(key, promise);
      promise.catch(() => listings.delete(key));
    }
    return listings.get(key);
  }

  const segments = $derived(path.split('/').filter(Boolean).map(decode));
  const isPdf = $derived(!path.endsWith('/') && PDF.test(segments.at(-1) ?? ''));
  const canUpload = $derived(segments.length > 0 && !isPdf);

  let error = $state('');
  let loaded = $state(false);
  let folders = $state([]);
  let docs = $state.raw([]);
  let images = $state.raw([]);
  let lightbox = $state(null);
  let status = $state('');
  let dragging = $state(false);
  let pdfBox = $state();

  async function load(segs, scroll) {
    const key = segs.join('/');
    let entries;
    try {
      entries = await list(segs);
    } catch (e) {
      if (key === segments.join('/')) { error = `Fehler: ${e.message}`; loaded = true; }
      return;
    }
    if (key !== segments.join('/')) return; // inzwischen weiternavigiert
    const files = entries.filter((e) => e.type === 'file').sort(byName);
    error = '';
    // PDFs zuerst, dann andere Dateien
    docs = files.filter((e) => !IMAGE.test(e.name))
      .sort((a, b) => Number(PDF.test(b.name)) - Number(PDF.test(a.name)) || byName(a, b))
      .map((e) => ({ ...e, pdf: PDF.test(e.name), url: fileUrl([...segs, e.name]), href: fileHref([...segs, e.name]) }));
    images = files.filter((e) => IMAGE.test(e.name))
      .map((e) => ({ name: e.name, url: fileUrl([...segs, e.name]), thumb: thumbUrl([...segs, e.name], e) }));
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

  // Neuer Pfad: Lightbox zu, Titel setzen, Ordner laden
  $effect(() => {
    const segs = segments;
    lightbox = null;
    const title = segs.length ? segs.at(-1).replace(PDF, '') : 'Galerie';
    document.title = `${title} – Spielrunden`;
    if (isPdf) window.scrollTo(0, 0);
    else load(segs, true);
  });

  $effect(() => {
    if (isPdf && pdfBox) return showPdf(pdfBox, { url: fileUrl(segments) });
  });

  // Beim Zurückkehren in den Tab (z. B. aus Chatto) neu laden, damit frisch hochgeladene
  // Dateien erscheinen – ohne Scrollposition oder offenes Bild zu verlieren
  function onvisibilitychange() {
    if (document.visibilityState !== 'visible' || lightbox !== null || isPdf) return;
    listings.clear();
    load(segments, false);
  }

  /** Lädt Dateien in den aktuellen Ordner; vorhandene Namen bekommen " (2)", " (3)" … */
  async function uploadFiles(files) {
    files = [...files];
    if (!files.length || !canUpload) return;
    const segs = segments;
    try {
      for (const [i, file] of files.entries()) {
        status = `Lade ${i + 1}/${files.length} hoch …`;
        const name = await uploadUnique(segs, file);
        if (THUMBABLE.test(name)) {
          await makeThumb(file)
            .then((blob) => upload(fileUrl([...segs, '.thumbs', `${name}.webp`]), blob))
            .catch(() => {}); // ohne Vorschaubild geht's auch
        }
      }
      status = '';
    } catch (e) {
      status = e.status === 413 ? 'Fehler: Datei zu groß (max. 100 MB)' : `Fehler beim Hochladen: ${e.message}`;
    }
    listings.clear();
    load(segments, false);
  }

  async function uploadUnique(segs, file) {
    const stem = stripExt(file.name) || file.name;
    const ext = file.name.slice(stem.length);
    for (let n = 1; ; n++) {
      const name = n === 1 ? file.name : `${stem} (${n})${ext}`;
      try {
        await upload(fileUrl([...segs, name]), file);
        return name;
      } catch (e) {
        if (e.status !== 409) throw e;
      }
    }
  }

  /** Vorschaubild: längste Seite 640 px, WebP */
  async function makeThumb(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    // Safari kann kein WebP erzeugen und liefert dann PNG – lieber kein Vorschaubild
    if (blob?.type !== 'image/webp') throw new Error('Kein WebP');
    return blob;
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
      <a href="#/galerie/">Galerie</a>
      {#each segments as name, i}
        <span class="sep">›</span>
        {#if i === segments.length - 1}
          <span class="current">{PDF.test(name) ? stripExt(name) : name}</span>
        {:else}
          <a href={folderHref(segments.slice(0, i + 1))}>{name}</a>
        {/if}
      {/each}
    {:else}
      <span class="current">Galerie</span>
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
  {#if isPdf}
    <div bind:this={pdfBox}></div>
  {:else if error}
    <p class="error">{error}</p>
  {:else if loaded}
    {#if docs.length}
      <h2 class="section-title">{docs.length === 1 ? 'Dokument' : 'Dokumente'}</h2>
      <div class="docs">
        {#each docs as d (d.name)}
          <a class={d.pdf ? 'doc' : 'doc other'} href={d.pdf ? d.href : d.url}
            target={d.pdf ? undefined : '_blank'} rel="noopener">
            <span aria-hidden="true">{d.pdf ? '📄' : '📎'}</span>{stripExt(d.name)}<span class="size">{formatSize(d.size)}</span>
          </a>
        {/each}
      </div>
    {/if}
    {#if images.length}
      <h2 class="section-title">Bilder</h2>
      <div class="images">
        {#each images as img, i (img.name)}
          <button class="thumb" type="button" title={stripExt(img.name)} onclick={() => (lightbox = i)}>
            <!-- HEIC & Co. kann der Browser evtl. nicht – dann zumindest das Original versuchen -->
            <img src={img.thumb} alt={stripExt(img.name)} loading="lazy"
              onerror={(ev) => { if (!ev.target.dataset.fallback) { ev.target.dataset.fallback = '1'; ev.target.src = img.url; } }}>
          </button>
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
    {#if !docs.length && !images.length && !folders.length}
      <p class="empty">Dieser Ordner ist leer.{#if canUpload} Dateien hierher ziehen oder „Hochladen“ wählen.{/if}</p>
    {/if}
  {/if}
</main>

<Lightbox {images} bind:index={lightbox} />
