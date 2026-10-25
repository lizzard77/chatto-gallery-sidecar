<script>
  // Block-Editor der Abenteuer-Seite: Textblöcke (contenteditable mit Inline-Formatierung), Slash-Befehle,
  // Bilder/Dateien mit Upload, Griff-Menü, Werkzeugleiste für markierten Text, Datei-Links.
  // Tasten und Eingaben kommen per Delegation hier an.
  import { tick, untrack } from 'svelte';
  import Block from './Block.svelte';
  import FilePicker from './FilePicker.svelte';
  import Lightbox from '../Lightbox.svelte';
  import { upload, fileUrl } from '../api.js';
  import { showPdf } from '../pdfviewer.js';
  import { isText, newBlock, splitBlock, mergeBack, moveBlock, numbered, safeName, filterCommands } from './blocks.js';
  import { readText, caretOffset, setCaret, atEdgeLine, renderInline, selectionOffsets, selectOffsets, offsetAtPoint } from './caret.js';
  import { toggleMark, linkMarkdown, linkAction } from './inline.js';

  let { blocks = $bindable(), spiel, nr, onchange } = $props();

  let root;
  let picker;
  let pdfDialog, pdfBox, closePdf;
  let slash = $state(null); // { id, query, active } solange das Menü offen ist
  let menuFor = $state(null); // Block mit offenem Griff-Menü
  let busy = $state(''); // Upload-Fortschritt bzw. Fehler
  let dragging = $state(false);
  let lightboxIndex = $state(null);
  let linkImages = $state(null); // Bild aus einem Link in der Lightbox (statt der Bilder der Seite)
  let bar = $state(null); // Werkzeugleiste über markiertem Text: { x, y }
  let linkReq = $state(null); // offene Datei-Auswahl: { id, start, end } (Auswahl bzw. Cursor im Block)
  let linkClick = null; // Link, auf den in einem Block ohne Fokus gedrückt wurde
  let clickAt = null; // Klick in einen Block ohne Fokus: { el, offset } (s. onpointerdown)
  let current = null; // zuletzt fokussierter Block (Einfügestelle für Uploads)
  let pickAt = null, pickKind = null;

  const slashItems = $derived(slash ? filterCommands(slash.query) : []);
  const images = $derived(blocks.filter((b) => b.type === 'image')
    .map((b) => ({ id: b.id, name: b.file, url: fileUrl(spiel, `.wiki/${nr}/${b.file}`) })));
  $effect(() => { if (lightboxIndex === null) linkImages = null; });

  /** URL zu einem Link { ziel, art }: Dateien liegen im Spiel-Ordner */
  const href = (link) => (link.art === 'datei' ? fileUrl(spiel, link.ziel) : link.ziel);
  /** Text in Block-Daten und DOM setzen (DOM mit Formatierung, Auswahl bleibt) */
  function setText(el, b, text) {
    b.text = text;
    renderInline(el, text, href);
  }

  // Rückgängig/Wiederholen für die ganze Seite. Das Strg+Z des Browsers greift nicht mehr, sobald ein Block für die
  // Formatierung neu aufgebaut wurde – daher eigene Schnappschüsse: nach jeder Änderung kommt der vorige Stand auf den Stapel
  // (Tippen im selben Block innerhalb 1 s zählt als ein Schritt).
  let history = [], future = [], prev = null, lastTyping = null;
  const snap = () => {
    const hit = hitOf(getSelection().anchorNode);
    return { blocks: structuredClone($state.snapshot(blocks)), id: hit?.id, sel: hit && selectionOffsets(hit.el) };
  };
  $effect.pre(() => { blocks; untrack(() => { history = []; future = []; prev = snap(); }); }); // neue Seite / neu geladen
  function changed(typingId) {
    const now = Date.now();
    const merge = typingId && lastTyping?.id === typingId && now - lastTyping.t < 1000;
    if (!merge && prev) history.push(prev), history.length > 200 && history.shift();
    lastTyping = typingId ? { id: typingId, t: now } : null;
    future = [];
    prev = snap();
    onchange();
  }
  async function undo(redo = false) {
    const state = (redo ? future : history).pop();
    if (!state) return;
    (redo ? history : future).push(snap());
    blocks.splice(0, blocks.length, ...state.blocks);
    slash = null;
    await tick();
    for (const b of blocks) { const el = textEl(b.id); if (el) renderInline(el, b.text ?? '', href); }
    const el = state.id && textEl(state.id);
    if (el) { el.focus(); if (state.sel) selectOffsets(el, state.sel.anchor, state.sel.focus); }
    prev = snap();
    lastTyping = null;
    onchange();
  }

  const indexOf = (id) => blocks.findIndex((b) => b.id === id);
  const textEl = (id) => root?.querySelector(`[data-id="${id}"] .txt`);
  async function focusBlock(id, offset = 0) {
    await tick();
    const el = textEl(id);
    if (el) setCaret(el, offset);
  }
  /** Block zum Ereignis (Element oder Textknoten): Textelement, id, Index */
  function hitOf(target) {
    if (target?.nodeType === Node.TEXT_NODE) target = target.parentElement;
    const el = target?.closest?.('.txt');
    const id = el?.closest('[data-id]')?.dataset.id;
    return id ? { el, id, i: indexOf(id) } : null;
  }

  function oninput(e) {
    const hit = hitOf(e.target);
    if (!hit) return;
    const text = readText(hit.el);
    const b = blocks[hit.i];
    b.text = text;
    // Formatierung neu aufbauen (während IME-Eingabe nicht, dann bei compositionend); räumt auch Reste wie <br> weg
    if (!e.isComposing) renderInline(hit.el, text, href);
    // "/" in leerem Block öffnet das Menü, weiteres Tippen filtert
    const isSlash = isText(b) && /^\/[^\s/]*$/.test(text) && (text === '/' || slash?.id === hit.id);
    slash = isSlash ? { id: hit.id, query: text.slice(1), active: 0 } : null;
    changed(hit.id);
  }

  function onkeydown(e) {
    if (e.key === 'Escape' && menuFor) menuFor = null;
    const hit = hitOf(e.target);
    if (!hit || e.isComposing) return;
    const { el, id, i } = hit;
    const b = blocks[i];

    // Strg/Cmd+Z: rückgängig, Strg/Cmd+Umschalt+Z bzw. Strg+Y: wiederholen
    const z = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase();
    if (z === 'z' || z === 'y') {
      e.preventDefault();
      undo(z === 'y' || e.shiftKey);
      return;
    }

    // Strg/Cmd+B/I: fett/kursiv, Strg/Cmd+K: Link zu Datei
    const key = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase();
    if (key === 'b' || key === 'i' || key === 'k') {
      e.preventDefault();
      if (key === 'k') openLink(hit);
      else if (!getSelection().isCollapsed) format(key === 'b' ? '**' : '*');
      return;
    }

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
        renderInline(el, b.text, href);
        focusBlock(blocks[j].id, 0);
      }
      changed();
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
      if (to.index !== i && tEl) renderInline(tEl, target.text, href);
      focusBlock(target.id, to.offset);
      changed();
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
    } else if (cmd.type === 'link') {
      linkReq = { id: b.id, start: 0, end: 0 };
    } else if (cmd.type === 'hr') {
      const p = newBlock();
      blocks.splice(i, 1, newBlock('hr'), p);
      focusBlock(p.id);
    } else {
      b.type = cmd.type;
      focusBlock(b.id);
    }
    changed();
  }

  /** Lädt unter freiem Namen hoch (bei 409: name-2, name-3 …) und gibt den Namen zurück. */
  async function uploadFile(file) {
    const name = safeName(file.name);
    for (let n = 1; ; n++) {
      try {
        await upload(fileUrl(spiel, `.wiki/${nr}/${numbered(name, n)}`), file);
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
        changed();
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
    changed();
  }
  function remove(id) {
    blocks.splice(indexOf(id), 1);
    if (!blocks.length) blocks.push(newBlock());
    menuFor = null;
    changed();
  }

  /** Klick unter den letzten Block: dort weiterschreiben. */
  function onTail() {
    const last = blocks.at(-1);
    if (isText(last)) return focusBlock(last.id, -1);
    const p = newBlock();
    blocks.push(p);
    focusBlock(p.id);
    changed();
  }

  /** Werkzeugleiste zeigen, solange nicht-leerer Text in genau einem Block markiert ist. */
  function onselectionchange() {
    const sel = getSelection();
    const a = !sel.isCollapsed && sel.rangeCount && !linkReq && hitOf(sel.anchorNode);
    if (!a || !root.contains(a.el) || hitOf(sel.focusNode)?.el !== a.el || !sel.toString().trim()) return (bar = null);
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const box = root.getBoundingClientRect();
    bar = { x: Math.max(60, Math.min(box.width - 60, r.left + r.width / 2 - box.left)), y: r.top - box.top };
  }

  /** Block mit der aktuellen Auswahl (oder null) */
  function selHit() {
    const sel = getSelection();
    const hit = sel.rangeCount ? hitOf(sel.anchorNode) : null;
    return hit && root.contains(hit.el) ? hit : null;
  }

  /** F/K: Markierung um die Auswahl setzen oder entfernen; der Text bleibt markiert. */
  function format(mark) {
    const hit = selHit();
    const off = hit && selectionOffsets(hit.el);
    if (!off || off.start === off.end) return;
    const r = toggleMark(readText(hit.el), off.start, off.end, mark);
    setText(hit.el, blocks[hit.i], r.text);
    selectOffsets(hit.el, r.start, r.end);
    changed();
  }

  /** Datei-Auswahl öffnen; markierter Text wird zum Link, sonst wird an der Cursorposition eingefügt. */
  function openLink(hit = selHit()) {
    if (!hit) return;
    const off = selectionOffsets(hit.el) ?? { start: 0, end: 0 };
    linkReq = { id: hit.id, start: off.start, end: off.end };
    bar = null;
  }
  async function insertLink(ziel) {
    const { id, start, end } = linkReq;
    linkReq = null;
    await tick();
    const i = indexOf(id), el = textEl(id);
    if (!el) return;
    const text = readText(el);
    let [a, z] = [start, end];
    while (a < z && /\s/.test(text[a])) a++;
    while (z > a && /\s/.test(text[z - 1])) z--;
    // ohne Auswahl: Dateiname ohne Endung bzw. Adresse ohne https://
    const label = a < z ? text.slice(a, z)
      : /^https?:/i.test(ziel) ? ziel.replace(/^https?:\/\//i, '') : ziel.split('/').pop().replace(/(.)\.[^.]+$/, '$1');
    // ohne Auswahl: nicht direkt an ein Wort kleben
    const md = (a === z && a > 0 && !/\s/.test(text[a - 1]) ? ' ' : '') + linkMarkdown(label, ziel);
    el.focus();
    setText(el, blocks[i], text.slice(0, a) + md + text.slice(z));
    selectOffsets(el, a + md.length);
    changed();
  }
  async function cancelLink() {
    if (!linkReq) return;
    const { id, start, end } = linkReq;
    linkReq = null;
    await tick();
    const el = textEl(id);
    if (!el) return;
    el.focus();
    selectOffsets(el, start, end);
  }

  /** Link öffnen statt Cursor setzen: in Blöcken ohne Fokus per Klick, im bearbeiteten Block mit Strg/Cmd+Klick. */
  function onpointerdown(e) {
    const el = e.target.closest?.('.txt');
    const a = e.target.closest?.('a.md-link');
    const unfocused = el && e.button === 0 && el !== document.activeElement;
    linkClick = unfocused && a ? a : null;
    if (linkClick) e.preventDefault();
    // Mit dem Fokus werden die Markierungszeichen sichtbar und der Text verschiebt sich – Cursor-Stelle vorher merken
    clickAt = unfocused && !a ? { el, offset: offsetAtPoint(el, e.clientX, e.clientY) } : null;
  }
  function onclick(e) {
    if (clickAt?.offset != null && getSelection().isCollapsed && document.activeElement === clickAt.el) selectOffsets(clickAt.el, clickAt.offset);
    clickAt = null;
    const a = e.target.closest?.('a.md-link');
    if (!a) return;
    e.preventDefault();
    if (a === linkClick || e.ctrlKey || e.metaKey) openTarget(a);
    linkClick = null;
  }
  function openTarget(a) {
    const url = a.getAttribute('href');
    const art = url.startsWith('#/') ? 'intern' : a.target === '_blank' ? 'extern' : 'datei';
    const action = linkAction({ ziel: url.replace(/[?#].*$/, ''), art });
    if (action === 'intern') location.hash = url;
    else if (action === 'pdf') openPdf(url);
    else if (action === 'bild') {
      linkImages = [{ url, name: a.textContent }];
      lightboxIndex = 0;
    } else window.open(url, '_blank', 'noopener');
  }

  function openPdf(url) {
    pdfDialog.showModal();
    closePdf = showPdf(pdfBox, { url });
  }
  function onPdfClose() {
    closePdf?.();
    closePdf = null;
    pdfBox?.replaceChildren(); // beim Verlassen der Seite schon weg
  }
</script>

<svelte:document {onselectionchange} />
<svelte:window {ondragover} {ondrop}
  ondragleave={(e) => { if (!e.relatedTarget) dragging = false; }}
  onclick={(e) => { if (menuFor && !e.target.closest?.('.handle, .block-menu')) menuFor = null; }} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor" class:dragging bind:this={root} {oninput} {onkeydown}
  onbeforeinput={(e) => { if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); undo(e.inputType === 'historyRedo'); } }} {onpaste} {onpointerdown} {onclick}
  onmousedown={(e) => { if (linkClick) e.preventDefault(); }}
  oncompositionend={(e) => { const hit = hitOf(e.target); if (hit) renderInline(hit.el, readText(hit.el), href); }}
  onfocusin={(e) => { current = hitOf(e.target)?.id ?? current; if (slash && hitOf(e.target)?.id !== slash.id) slash = null; }}>
  {#each blocks as block (block.id)}
    <Block {block} {spiel} {nr} {href}
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
  {#if bar}
    <!-- mousedown verhindern: die Auswahl im Block bleibt -->
    <div class="format-bar" role="toolbar" tabindex="-1" aria-label="Formatierung" style:left="{bar.x}px" style:top="{bar.y}px"
      onmousedown={(e) => e.preventDefault()}>
      <button type="button" class="bold" title="Fett (Strg+B)" onclick={() => format('**')}>F</button>
      <button type="button" class="italic" title="Kursiv (Strg+I)" onclick={() => format('*')}>K</button>
      <button type="button" title="Link zu Datei (Strg+K)" onclick={() => openLink()}>🔗</button>
    </div>
  {/if}
</div>

{#if linkReq}
  <FilePicker {spiel} {nr} upload={uploadFile} onpick={insertLink} onclose={cancelLink} />
{/if}

<input type="file" hidden bind:this={picker} onchange={onpicked} />

<Lightbox images={linkImages ?? images} bind:index={lightboxIndex} />

<dialog class="pdf-overlay" bind:this={pdfDialog} onclose={onPdfClose} aria-label="PDF">
  <button type="button" class="pdf-close" aria-label="Schließen" onclick={() => pdfDialog.close()}>✕</button>
  <div class="pdf-box" bind:this={pdfBox}></div>
</dialog>

<style>
  .editor { position: relative; }
  .editor.dragging { outline: 2px dashed var(--siegel); outline-offset: 10px; }
  .tail { min-height: 80px; cursor: text; }
  .busy { margin: 0; font: italic 16px var(--fell); color: var(--siegel); }

  /* Schwebende Werkzeugleiste: Papier mit Messingknöpfen */
  .format-bar {
    position: absolute;
    z-index: 7;
    display: flex;
    gap: 3px;
    padding: 3px;
    transform: translate(-50%, calc(-100% - 8px));
    background: var(--papier);
    border: 1px solid color-mix(in srgb, var(--tinte) 50%, transparent);
    box-shadow: 0 4px 12px rgba(36, 24, 13, 0.35);
  }
  .format-bar button {
    min-width: 32px;
    height: 30px;
    padding: 0 8px;
    border: 1px solid color-mix(in srgb, var(--tinte) 40%, transparent);
    background: linear-gradient(#ecd595, #c9a24e);
    color: var(--tinte);
    font: 18px/1 var(--fell);
    cursor: pointer;
  }
  .format-bar button:hover { background: linear-gradient(#f4e2ad, #d6b062); }
  .format-bar .bold { font-weight: bold; }
  .format-bar .italic { font-style: italic; }

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
