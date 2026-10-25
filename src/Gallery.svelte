<script>
  // Dateien eines Spiels: liest Ordnerlisten als JSON unter /files/<Spiel>/ und zeigt Unterordner
  // als Karten, PDFs/Dokumente als Buttons und Bilder als Raster. Ein PDF öffnet sich als
  // #/<Spiel>/dateien/Ordner/Datei.pdf (ohne Schrägstrich am Ende) im PDF-Viewer.
  // Hochladen per Knopf oder Drag & Drop; für Bilder baut der Browser gleich ein Vorschaubild.
  import { getJson, upload, enc } from './api.js';
  import { makeThumb } from './thumb.js';
  import { showPdf } from './pdfviewer.js';
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
  const thumbUrl = (segments, entry) => THUMBABLE.test(entry.name)
    ? `/thumb/${enc(spiel, ...segments)}?v=${encodeURIComponent(entry.mtime || '')}`
    : rawUrl(segments);

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
  const canUpload = $derived(!isPdf);

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
    const key = enc(spiel, ...segs);
    const current = () => key === enc(spiel, ...segments);
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
    // PDFs zuerst, dann andere Dateien
    docs = files.filter((e) => !IMAGE.test(e.name))
      .sort((a, b) => Number(PDF.test(b.name)) - Number(PDF.test(a.name)) || byName(a, b))
      .map((e) => ({ ...e, pdf: PDF.test(e.name), url: rawUrl([...segs, e.name]), href: fileHref([...segs, e.name]) }));
    images = files.filter((e) => IMAGE.test(e.name))
      .map((e) => ({ name: e.name, url: rawUrl([...segs, e.name]), thumb: thumbUrl([...segs, e.name], e) }));
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

  // Neuer Pfad: Lightbox zu, Ordner laden (den Seitentitel setzt App.svelte)
  $effect(() => {
    const segs = segments;
    lightbox = null;
    if (isPdf) window.scrollTo(0, 0);
    else load(segs, true);
  });

  $effect(() => {
    if (isPdf && pdfBox) return showPdf(pdfBox, { url: rawUrl(segments) });
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
        const blob = THUMBABLE.test(name) && await makeThumb(file);
        // ohne Vorschaubild geht's auch
        if (blob) await upload(rawUrl([...segs, '.thumbs', `${name}.webp`]), blob).catch(() => {});
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
