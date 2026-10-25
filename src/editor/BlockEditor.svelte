<script>
  // Block-Editor der Abenteuer-Seite: reine Textblöcke (contenteditable), Slash-Befehle,
  // Bilder/Dateien mit Upload, Griff-Menü. Tasten und Eingaben kommen per Delegation hier an.
  import { tick } from 'svelte';
  import Block from './Block.svelte';
  import Lightbox from '../Lightbox.svelte';
  import { upload } from '../api.js';
  import { showPdf } from '../pdfviewer.js';
  import { isText, newBlock, splitBlock, mergeBack, moveBlock, numbered, safeName, filterCommands } from './blocks.js';
  import { readText, caretOffset, setCaret, atEdgeLine } from './caret.js';

  let { blocks = $bindable(), nr, onchange } = $props();

  let root;
  let picker;
  let pdfDialog, pdfBox, closePdf;
  let slash = $state(null); // { id, query, active } solange das Menü offen ist
  let menuFor = $state(null); // Block mit offenem Griff-Menü
  let busy = $state(''); // Upload-Fortschritt bzw. Fehler
  let dragging = $state(false);
  let lightboxIndex = $state(null);
  let current = null; // zuletzt fokussierter Block (Einfügestelle für Uploads)
  let pickAt = null, pickKind = null;

  const slashItems = $derived(slash ? filterCommands(slash.query) : []);
  const images = $derived(blocks.filter((b) => b.type === 'image')
    .map((b) => ({ id: b.id, name: b.file, url: `/wiki/${nr}/${encodeURIComponent(b.file)}` })));

  const indexOf = (id) => blocks.findIndex((b) => b.id === id);
  const textEl = (id) => root.querySelector(`[data-id="${id}"] .txt`);
  async function focusBlock(id, offset = 0) {
    await tick();
    const el = textEl(id);
    if (el) setCaret(el, offset);
  }
  /** Block zum Ereignis: Textelement, id, Index */
  function hitOf(target) {
    const el = target.closest?.('.txt');
    const id = el?.closest('[data-id]')?.dataset.id;
    return id ? { el, id, i: indexOf(id) } : null;
  }

  function oninput(e) {
    const hit = hitOf(e.target);
    if (!hit) return;
    const text = readText(hit.el);
    if (!text && hit.el.firstChild) hit.el.textContent = ''; // Reste wie <br> weg, sonst fehlt der Platzhalter
    const b = blocks[hit.i];
    b.text = text;
    // "/" in leerem Block öffnet das Menü, weiteres Tippen filtert
    const isSlash = isText(b) && /^\/[^\s/]*$/.test(text) && (text === '/' || slash?.id === hit.id);
    slash = isSlash ? { id: hit.id, query: text.slice(1), active: 0 } : null;
    onchange();
  }

  function onkeydown(e) {
    if (e.key === 'Escape' && menuFor) menuFor = null;
    const hit = hitOf(e.target);
    if (!hit || e.isComposing) return;
    const { el, id, i } = hit;
    const b = blocks[i];

    if (slash?.id === id && slashItems.length) {
      const n = slashItems.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        slash.active = (slash.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        pick(slashItems[Math.min(slash.active, n - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        slash = null;
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      slash = null;
      if (b.type === 'image') {
        // Enter in der Bildunterschrift: neuer Absatz unter dem Bild
        const p = newBlock();
        blocks.splice(i + 1, 0, p);
        focusBlock(p.id);
      } else {
        const sel = getSelection();
        if (!sel.isCollapsed) {
          sel.deleteFromDocument();
          b.text = readText(el);
        }
        const j = splitBlock(blocks, i, caretOffset(el));
        el.textContent = b.text;
        focusBlock(blocks[j].id, 0);
      }
      onchange();
      return;
    }

    if (e.key === 'Backspace' && b.type !== 'image' && getSelection().isCollapsed && caretOffset(el) === 0) {
      const to = mergeBack(blocks, i);
      if (!to) return;
      e.preventDefault();
      slash = null;
      const target = blocks[to.index];
      // Verschmolzenen Text ins DOM des vorherigen Blocks schreiben (Typwechsel baut das Element neu)
      const tEl = textEl(target.id);
      if (to.index !== i && tEl) tEl.textContent = target.text;
      focusBlock(target.id, to.offset);
      onchange();
      return;
    }

    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !(e.shiftKey || e.altKey || e.ctrlKey || e.metaKey)) {
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      if (!atEdgeLine(el, dir)) return;
      for (let j = i + dir; j >= 0 && j < blocks.length; j += dir) {
        const next = textEl(blocks[j].id);
        if (next) {
          e.preventDefault();
          setCaret(next, dir < 0 ? -1 : 0);
          return;
        }
      }
    }
  }

  /** Slash-Befehl ausführen: der Block (nur "/…") wird umgewandelt bzw. ersetzt. */
  function pick(cmd) {
    const i = indexOf(slash.id);
    slash = null;
    const b = blocks[i];
    b.text = '';
    textEl(b.id).textContent = '';
    if (cmd.type === 'image' || cmd.type === 'file') {
      pickAt = b.id;
      pickKind = cmd.type;
      picker.accept = cmd.type === 'image' ? 'image/*' : '';
      picker.multiple = cmd.type === 'image';
      picker.click();
    } else if (cmd.type === 'hr') {
      const p = newBlock();
      blocks.splice(i, 1, newBlock('hr'), p);
      focusBlock(p.id);
    } else {
      b.type = cmd.type;
      focusBlock(b.id);
    }
    onchange();
  }

  /** Lädt unter freiem Namen hoch (bei 409: name-2, name-3 …) und gibt den Namen zurück. */
  async function uploadFile(file) {
    const name = safeName(file.name);
    for (let n = 1; ; n++) {
      try {
        await upload(`/wiki/${nr}/${encodeURIComponent(numbered(name, n))}`, file);
        return numbered(name, n);
      } catch (err) {
        if (err.status !== 409 || n >= 100) throw err;
      }
    }
  }

  /** Dateien hochladen und als Blöcke nach `atId` einfügen (ein leerer Absatz dort wird ersetzt). */
  async function insertFiles(files, atId, kind = null) {
    files = [...files];
    const errors = [];
    for (const [k, file] of files.entries()) {
      busy = files.length > 1 ? `Lade ${k + 1}/${files.length} hoch …` : 'Lade hoch …';
      try {
        const name = await uploadFile(file);
        const type = kind ?? (file.type.startsWith('image/') ? 'image' : 'file');
        const block = type === 'image' ? newBlock('image', '', { file: name }) : { id: newBlock().id, type, file: name };
        let i = atId ? indexOf(atId) : -1;
        if (i < 0) i = blocks.length - 1; // Block inzwischen gelöscht → ans Ende
        const at = blocks[i];
        if (at?.type === 'p' && !at.text) blocks.splice(i, 1, block);
        else blocks.splice(i + 1, 0, block);
        atId = block.id;
        onchange();
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }
    busy = errors.length ? `Hochladen fehlgeschlagen – ${errors.join('; ')}` : '';
  }

  function onpicked() {
    if (picker.files.length) insertFiles(picker.files, pickAt, pickKind);
    picker.value = '';
  }

  function onpaste(e) {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    insertFiles(files, hitOf(e.target)?.id ?? current);
  }

  // Dateien auf die Seite ziehen
  const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
  function ondragover(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragging = true;
  }
  function ondrop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragging = false;
    insertFiles(e.dataTransfer.files, e.target.closest?.('[data-id]')?.dataset.id ?? current);
  }

  function move(id, dir) {
    moveBlock(blocks, indexOf(id), dir);
    onchange();
  }
  function remove(id) {
    blocks.splice(indexOf(id), 1);
    if (!blocks.length) blocks.push(newBlock());
    menuFor = null;
    onchange();
  }

  /** Klick unter den letzten Block: dort weiterschreiben. */
  function onTail() {
    const last = blocks.at(-1);
    if (isText(last)) return focusBlock(last.id, -1);
    const p = newBlock();
    blocks.push(p);
    focusBlock(p.id);
    onchange();
  }

  function openPdf(url) {
    pdfDialog.showModal();
    closePdf = showPdf(pdfBox, { url });
  }
  function onPdfClose() {
    closePdf?.();
    closePdf = null;
    pdfBox.replaceChildren();
  }
</script>

<svelte:window {ondragover} {ondrop}
  ondragleave={(e) => { if (!e.relatedTarget) dragging = false; }}
  onclick={(e) => { if (menuFor && !e.target.closest?.('.handle, .block-menu')) menuFor = null; }} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor" class:dragging bind:this={root} {oninput} {onkeydown} {onpaste}
  onfocusin={(e) => { current = hitOf(e.target)?.id ?? current; if (slash && hitOf(e.target)?.id !== slash.id) slash = null; }}>
  {#each blocks as block (block.id)}
    <Block {block} {nr}
      slash={slash?.id === block.id ? { items: slashItems, active: slash.active, onpick: pick } : null}
      menuOpen={menuFor === block.id}
      ontogglemenu={() => (menuFor = menuFor === block.id ? null : block.id)}
      onmove={(dir) => move(block.id, dir)}
      ondelete={() => remove(block.id)}
      onimage={() => (lightboxIndex = images.findIndex((img) => img.id === block.id))}
      onpdf={openPdf} />
  {/each}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="tail" onclick={onTail}></div>
  {#if busy}<p class="busy" role="status">{busy}</p>{/if}
</div>

<input type="file" hidden bind:this={picker} onchange={onpicked} />

<Lightbox {images} bind:index={lightboxIndex} />

<dialog class="pdf-overlay" bind:this={pdfDialog} onclose={onPdfClose} aria-label="PDF">
  <button type="button" class="pdf-close" aria-label="Schließen" onclick={() => pdfDialog.close()}>✕</button>
  <div class="pdf-box" bind:this={pdfBox}></div>
</dialog>

<style>
  .editor { position: relative; }
  .editor.dragging { outline: 2px dashed var(--siegel); outline-offset: 10px; }
  .tail { min-height: 80px; cursor: text; }
  .busy { margin: 0; font: italic 16px var(--fell); color: var(--siegel); }

  .pdf-overlay {
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: var(--bg, #0d1626);
    color: var(--text, #e8e4d8);
  }
  .pdf-overlay::backdrop { background: rgba(5, 9, 18, 0.8); }
  .pdf-box { height: 100%; overflow: auto; padding: 16px 16px 24px; }
  .pdf-overlay :global(.pdf-toolbar) { padding-right: 56px; }
  .pdf-close {
    position: fixed;
    top: 6px;
    right: 8px;
    z-index: 3;
    border: 0;
    background: none;
    color: inherit;
    font-size: 26px;
    cursor: pointer;
    opacity: 0.8;
  }
  .pdf-close:hover { opacity: 1; }
</style>
