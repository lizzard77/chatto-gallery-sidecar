<script>
  // Abenteuer-Seite zu Pin <nr>: immer bearbeitbar, speichert 1 s nach der letzten Änderung.
  // Gleichzeitiges Bearbeiten: der Server lehnt mit 409 ab, wenn `updated` nicht mehr stimmt – dann kein Merge,
  // sondern Hinweis + „Neu laden".
  import { onDestroy, untrack } from 'svelte';
  import Pin from './Pin.svelte';
  import BlockEditor from './editor/BlockEditor.svelte';
  import { api, getJson } from './api.js';
  import { withIds, stripIds } from './editor/blocks.js';
  import { readText, setCaret } from './editor/caret.js';

  let { nr, me } = $props();

  let page = $state(null);
  let error = $state(null); // 404 bzw. Fehlermeldung beim Laden
  let status = $state(''); // „Speichert …", „Gespeichert", Fehler
  let conflict = $state(null); // aktuelle Seite vom Server nach 409
  let timer, saving = null, dirty = false, deleted = false;

  const edited = $derived(page?.updated && new Date(page.updated).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' }));

  async function load() {
    clearTimeout(timer);
    page = null;
    dirty = false;
    conflict = null;
    status = '';
    try {
      const p = await getJson(`/api/pages/${nr}`);
      p.blocks = withIds(p.blocks);
      page = p;
    } catch (e) {
      error = e.status === 404 ? 404 : e.message;
    }
  }
  load();

  function changed() {
    dirty = true;
    status = '';
    clearTimeout(timer);
    timer = setTimeout(save, 1000);
  }

  /** Speichern; `leaving` = Seite wird verlassen (fetch mit keepalive, solange klein genug). */
  async function save(leaving = false) {
    clearTimeout(timer);
    if (!dirty || conflict || deleted || !page) return;
    if (saving) {
      // läuft noch – danach nochmal (beim Verlassen direkt anhängen, ein Timer käme nicht mehr dran)
      if (leaving === true) saving.then(() => save(true), () => save(true));
      else timer = setTimeout(save, 300);
      return;
    }
    dirty = false;
    status = 'Speichert …';
    const body = JSON.stringify({ title: page.title, blocks: stripIds(page.blocks), updated: page.updated });
    try {
      saving = api(`/api/pages/${nr}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
        keepalive: leaving === true && body.length < 60000
      });
      const saved = await saving;
      page.updated = saved.updated;
      page.updatedBy = saved.updatedBy;
      status = dirty ? '' : 'Gespeichert';
    } catch (e) {
      if (e.status === 409) {
        try { conflict = JSON.parse(e.message); } catch { conflict = {}; }
        status = '';
      } else {
        dirty = true;
        status = `Nicht gespeichert (${e.message})`;
        timer = setTimeout(save, 5000);
      }
    } finally {
      saving = null;
    }
  }

  onDestroy(() => save(true));

  async function remove() {
    if (!confirm(`Abenteuer ${nr} „${page.title}" wirklich löschen? Hochgeladene Bilder und Dateien sind dann auch weg.`)) return;
    deleted = true;
    clearTimeout(timer);
    try {
      await api(`/api/pages/${nr}`, { method: 'DELETE' });
      location.hash = '#/';
    } catch (e) {
      deleted = false;
      alert(`Löschen fehlgeschlagen: ${e.message}`);
    }
  }

  // Titel: Text nur beim Erzeugen setzen, bei Eingabe zurücklesen (wie die Blöcke)
  const setTitle = (el) => { el.textContent = untrack(() => page.title); };
  function onTitleKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = document.querySelector('.wiki .editor .txt');
    if (first) setCaret(first, 0);
  }
</script>

<svelte:window onpagehide={() => save(true)} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'hidden' && save(true)} />

<main class="wiki">
  {#if error === 404}
    <article class="sheet">
      <p class="missing">Kein Abenteuer mit Nummer {nr}.</p>
      <p><a href="#/">↩ Zur Karte</a></p>
    </article>
  {:else if error}
    <p class="error">Seite konnte nicht geladen werden: {error}</p>
  {:else if !page}
    <p class="empty">Lade …</p>
  {:else}
    {#if conflict}
      <div class="conflict" role="alert">
        <span>{conflict.updatedBy ?? 'Jemand'} hat die Seite inzwischen geändert.</span>
        <button type="button" onclick={load}>Neu laden</button>
      </div>
    {/if}
    <article class="sheet">
      <header>
        <a class="back" href="#/">↩ Zur Karte</a>
        <span class="status" role="status">{status}</span>
        <div class="title-row">
          <Pin {nr} size={58} />
          <!-- svelte-ignore a11y_missing_content -->
          <h1 contenteditable="plaintext-only" data-placeholder="Titel des Abenteuers" {@attach setTitle}
            oninput={(e) => { page.title = readText(e.currentTarget); changed(); }} onkeydown={onTitleKey}></h1>
        </div>
        {#if page.updatedBy && edited}
          <p class="edited">zuletzt bearbeitet von {page.updatedBy} am {edited}</p>
        {/if}
      </header>

      <BlockEditor bind:blocks={page.blocks} {nr} onchange={changed} />

      <footer>
        <button type="button" class="delete" onclick={remove}>Abenteuer löschen</button>
      </footer>
    </article>
  {/if}
</main>

<style>
  .wiki { max-width: 860px; margin: 0 auto; padding: 24px 16px 48px; }

  /* Papierbogen – auch im Dunkelmodus hell */
  .sheet {
    position: relative;
    padding: 36px 56px 28px 64px;
    color: var(--tinte);
    background:
      radial-gradient(ellipse at 15% 10%, rgba(255, 255, 255, 0.35), transparent 55%),
      radial-gradient(ellipse at 90% 95%, rgba(120, 80, 30, 0.14), transparent 60%),
      var(--papier);
    box-shadow: 0 0 0 1px rgba(36, 24, 13, 0.18), 0 2px 4px rgba(0, 0, 0, 0.25), 0 12px 32px rgba(0, 0, 0, 0.3),
      inset 0 0 70px rgba(120, 80, 30, 0.18);
    font-family: var(--fell);
    color-scheme: light;
  }
  .sheet a { color: var(--siegel); }

  header { margin-bottom: 18px; }
  .back { font-size: 16px; text-decoration: none; }
  .back:hover { text-decoration: underline; }
  .status { float: right; font-size: 14px; font-style: italic; opacity: 0.6; }

  .title-row { display: flex; align-items: center; gap: 16px; margin-top: 18px; }
  h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 2px;
    font: 40px/1.15 var(--fell-sc);
    outline: none;
    overflow-wrap: anywhere;
  }
  h1:empty::before { content: attr(data-placeholder); opacity: 0.38; }
  .edited {
    margin: 10px 0 0;
    padding-bottom: 12px;
    border-bottom: 3px double color-mix(in srgb, var(--tinte) 35%, transparent);
    font-size: 15px;
    font-style: italic;
    opacity: 0.7;
  }

  footer { margin-top: 12px; text-align: right; }
  .delete {
    border: 0;
    background: none;
    color: var(--siegel);
    font: italic 14px var(--fell);
    opacity: 0.6;
    cursor: pointer;
  }
  .delete:hover { opacity: 1; text-decoration: underline; }

  .missing { font-size: 22px; }

  .conflict {
    position: sticky;
    top: 60px;
    z-index: 4;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    padding: 10px 16px;
    background: var(--siegel);
    color: #f3e3c3;
    font: 17px var(--fell);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .conflict button {
    margin-left: auto;
    padding: 4px 14px;
    border: 1px solid #f3e3c3;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .conflict button:hover { background: #f3e3c3; color: var(--siegel); }

  @media (max-width: 600px) {
    .wiki { padding: 12px 6px 32px; }
    .sheet { padding: 22px 16px 20px 32px; }
    h1 { font-size: 30px; }
  }
</style>
