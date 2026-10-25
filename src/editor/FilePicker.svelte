<script>
  // Datei-Auswahl für Links: Uploads dieser Seite, alle Dateien des Spiels (rekursiv), externe Adresse oder neu hochladen.
  // onpick(ziel) mit Pfad relativ zum Spiel-Ordner bzw. https://…; Schließen (Esc, ✕) → onclose().
  import { getJson, fileUrl } from '../api.js';

  let { spiel, nr, upload, onpick, onclose } = $props();

  let picker;
  let query = $state('');
  let address = $state('');
  let seite = $state(null), spielDateien = $state(null); // null = lädt noch
  let busy = $state('');

  const sort = (list) => list.sort((a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' }));
  /** Alle Dateipfade unter `prefix` (z. B. "Mira/"), versteckte Ordner liefert der Server nicht. */
  async function walk(prefix) {
    const entries = await getJson(fileUrl(spiel, prefix || '/')).catch(() => []);
    const nested = await Promise.all(entries.map((e) => (e.type === 'directory' ? walk(`${prefix}${e.name}/`) : [prefix + e.name])));
    return nested.flat();
  }
  function load() {
    // .wiki/<nr>/ gibt's erst nach dem ersten Upload: vorher nachsehen (sonst 404 in der Konsole)
    getJson(fileUrl(spiel, '.wiki/'))
      .then((l) => (l.some((e) => e.type === 'directory' && e.name === String(nr)) ? walk(`.wiki/${nr}/`) : []), () => [])
      .then((l) => (seite = sort(l)));
    walk('').then((l) => (spielDateien = sort(l)));
  }
  load();

  const match = (list) => {
    const q = query.trim().toLowerCase();
    return (list ?? []).filter((p) => p.toLowerCase().includes(q));
  };
  const sections = $derived([
    { title: 'Diese Seite', list: match(seite), loading: !seite, strip: `.wiki/${nr}/` },
    { title: 'Spiel-Ordner', list: match(spielDateien), loading: !spielDateien, strip: '' }
  ]);
  const icon = (p) => (/\.pdf$/i.test(p) ? '📄' : /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(p) ? '🖼' : '📎');
  const isUrl = $derived(/^https?:\/\/\S+$/i.test(address.trim()));

  function onsearchkey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = sections.find((s) => s.list.length)?.list[0];
    if (first) onpick(first);
  }

  async function onfile() {
    const file = picker.files[0];
    picker.value = '';
    if (!file) return;
    busy = 'Lade hoch …';
    try {
      onpick(`.wiki/${nr}/${await upload(file)}`);
    } catch (err) {
      busy = `Hochladen fehlgeschlagen: ${err.message}`;
    }
  }

  const show = (el) => el.showModal();
</script>

<dialog class="filepicker" {@attach show} {onclose} aria-label="Link zu Datei">
  <header>
    <h2>Link zu Datei</h2>
    <button type="button" class="close" aria-label="Schließen" onclick={onclose}>✕</button>
  </header>
  <!-- svelte-ignore a11y_autofocus -->
  <input type="search" placeholder="Datei suchen …" bind:value={query} onkeydown={onsearchkey} autofocus />
  <div class="list">
    {#each sections as s (s.title)}
      <h3>{s.title}</h3>
      {#if s.loading}
        <p class="hint">Lade …</p>
      {:else if !s.list.length}
        <p class="hint">{query ? 'Nichts gefunden' : 'Keine Dateien'}</p>
      {:else}
        <ul>
          {#each s.list.slice(0, 300) as p (p)}
            {@const name = p.slice(s.strip.length)}
            <li>
              <button type="button" onclick={() => onpick(p)} title={p}>
                <span class="icon">{icon(p)}</span>
                <span class="name">{name.split('/').pop()}</span>
                {#if name.includes('/')}<span class="dir">{name.slice(0, name.lastIndexOf('/'))}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  </div>
  <form class="address" onsubmit={(e) => { e.preventDefault(); if (isUrl) onpick(address.trim()); }}>
    <input type="url" placeholder="oder Adresse (https://…)" bind:value={address} />
    <button type="submit" disabled={!isUrl}>Verlinken</button>
  </form>
  <footer>
    <button type="button" class="upload" onclick={() => picker.click()}>Datei hochladen …</button>
    {#if busy}<span class="busy" role="status">{busy}</span>{/if}
  </footer>
  <input type="file" hidden bind:this={picker} onchange={onfile} />
</dialog>

<style>
  .filepicker {
    width: min(560px, calc(100vw - 24px));
    max-height: min(640px, calc(100dvh - 24px));
    padding: 18px 20px 16px;
    border: 1px solid color-mix(in srgb, var(--tinte) 45%, transparent);
    outline: 3px double color-mix(in srgb, var(--tinte) 25%, transparent);
    outline-offset: -7px;
    background: var(--papier);
    color: var(--tinte);
    box-shadow: 0 10px 30px rgba(36, 24, 13, 0.45);
    font: 17px/1.3 var(--fell);
    color-scheme: light;
  }
  .filepicker[open] { display: flex; flex-direction: column; gap: 10px; }
  .filepicker::backdrop { background: rgba(20, 12, 4, 0.45); }
  header { display: flex; align-items: center; }
  h2 { flex: 1; margin: 0; font: 24px var(--fell-sc); }
  .close { border: 0; background: none; color: inherit; font-size: 20px; cursor: pointer; opacity: 0.6; }
  .close:hover { opacity: 1; }
  input[type='search'], input[type='url'] {
    min-width: 0;
    padding: 6px 10px;
    border: 1px solid color-mix(in srgb, var(--tinte) 40%, transparent);
    background: color-mix(in srgb, var(--papier) 60%, white);
    color: inherit;
    font: inherit;
  }
  .list { flex: 1; min-height: 120px; overflow: auto; }
  h3 { margin: 6px 0 2px; font: italic 15px var(--fell); color: var(--siegel); border-bottom: 1px solid color-mix(in srgb, var(--siegel) 30%, transparent); }
  ul { margin: 0; padding: 0; list-style: none; }
  li button {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 4px 6px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  li button:hover, li button:focus-visible { background: color-mix(in srgb, var(--siegel) 12%, transparent); color: var(--siegel); outline: none; }
  .icon { flex: none; width: 1.3em; text-align: center; }
  .name { overflow-wrap: anywhere; }
  .dir { margin-left: auto; padding-left: 8px; font-size: 14px; font-style: italic; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
  .hint { margin: 4px 6px; font-style: italic; opacity: 0.6; }
  .address { display: flex; gap: 8px; }
  .address input { flex: 1; }
  .address button, .upload {
    padding: 5px 14px;
    border: 1px solid color-mix(in srgb, var(--tinte) 45%, transparent);
    background: linear-gradient(#e9cf8a, #c9a24e);
    color: var(--tinte);
    font: inherit;
    cursor: pointer;
  }
  .address button:disabled { opacity: 0.45; cursor: default; }
  footer { display: flex; align-items: center; gap: 12px; }
  .busy { font-style: italic; color: var(--siegel); }
</style>
