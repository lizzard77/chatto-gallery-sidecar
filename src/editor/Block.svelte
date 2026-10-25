<script>
  // Ein Block der Abenteuer-Seite. Tasten und Eingaben behandelt der BlockEditor (Event-Delegation),
  // hier nur Darstellung, Griff-Menü und Bild/Datei.
  import { untrack } from 'svelte';
  import SlashMenu from './SlashMenu.svelte';
  import { fileUrl } from '../api.js';
  import { renderInline } from './caret.js';

  let { block, spiel, nr, href, slash = null, menuOpen = false, ontogglemenu, onmove, ondelete, onimage, onpdf } = $props();

  const TAGS = { p: 'p', h2: 'h2', h3: 'h3', entry: 'div', quote: 'blockquote', li: 'div' };
  const PLACEHOLDER = {
    p: 'Schreibe … oder / für Befehle', h2: 'Überschrift', h3: 'Zwischenüberschrift',
    entry: 'Datum, Ort …', quote: 'Zitat', li: 'Listenpunkt'
  };
  const url = $derived(fileUrl(spiel, `.wiki/${nr}/${block.file ?? ''}`));
  const isPdf = $derived(/\.pdf$/i.test(block.file ?? ''));

  // Text nur beim Erzeugen des Elements setzen – danach baut der BlockEditor ihn bei Eingaben neu auf (sonst springt der Cursor)
  const setText = (el) => { renderInline(el, untrack(() => block.text) ?? '', href); };
</script>

<div class="block {block.type}" data-id={block.id}>
  <button type="button" class="handle" aria-label="Block-Menü" aria-expanded={menuOpen} tabindex="-1"
    onclick={ontogglemenu}>⋮⋮</button>
  {#if menuOpen}
    <div class="block-menu" role="menu">
      <button type="button" role="menuitem" onclick={() => onmove(-1)}>↑ Nach oben</button>
      <button type="button" role="menuitem" onclick={() => onmove(1)}>↓ Nach unten</button>
      <button type="button" role="menuitem" class="danger" onclick={ondelete}>✕ Löschen</button>
    </div>
  {/if}

  {#if block.type === 'hr'}
    <div class="ornament" role="separator">❦</div>
  {:else if block.type === 'image'}
    <figure>
      <button type="button" class="photo" onclick={() => onimage(url)} aria-label="Bild groß anzeigen">
        <img src={url} alt={block.text || block.file} loading="lazy" />
      </button>
      <figcaption class="txt" contenteditable="plaintext-only" data-placeholder="Bildunterschrift …"
        {@attach setText}></figcaption>
    </figure>
  {:else if block.type === 'file'}
    {#if isPdf}
      <button type="button" class="attachment" onclick={() => onpdf(url)}>📄 {block.file}</button>
    {:else}
      <a class="attachment" href={url} download={block.file}>📎 {block.file}</a>
    {/if}
  {:else}
    <svelte:element this={TAGS[block.type] ?? 'p'} class="txt" contenteditable="plaintext-only"
      data-placeholder={PLACEHOLDER[block.type]} {@attach setText}></svelte:element>
  {/if}

  {#if slash?.items.length}<SlashMenu {...slash} />{/if}
</div>

<style>
  .block { position: relative; }

  /* Griff links am Rand, nur bei Hover/Fokus */
  .handle {
    position: absolute;
    left: -30px;
    top: 0.25em;
    width: 24px;
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--tinte);
    font: 14px/1 system-ui, sans-serif;
    letter-spacing: -3px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .block:hover > .handle, .block:focus-within > .handle, .handle[aria-expanded='true'] { opacity: 0.45; }
  .handle:hover { opacity: 1 !important; color: var(--siegel); }
  @media (hover: none) { .handle { opacity: 0.25; } }

  .block-menu {
    position: absolute;
    left: -30px;
    top: 1.8em;
    z-index: 6;
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: var(--papier);
    border: 1px solid color-mix(in srgb, var(--tinte) 45%, transparent);
    box-shadow: 0 6px 18px rgba(36, 24, 13, 0.3);
  }
  .block-menu button {
    padding: 5px 12px;
    border: 0;
    background: none;
    color: var(--tinte);
    font: 16px var(--fell);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .block-menu button:hover { background: color-mix(in srgb, var(--siegel) 12%, transparent); }
  .block-menu .danger { color: var(--siegel); }

  /* Textblöcke */
  .txt {
    margin: 0;
    padding: 3px 2px;
    outline: none;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    min-height: 1.5em;
  }
  .txt:empty::before {
    content: attr(data-placeholder);
    color: color-mix(in srgb, var(--tinte) 38%, transparent);
    font-style: italic;
    pointer-events: none;
  }
  /* Der Absatz-Hinweis nur im gerade bearbeiteten Block */
  .p .txt:not(:focus):empty::before { content: none; }

  /* Inline-Formatierung: Markierungszeichen nur im bearbeiteten Block sichtbar (gedämpft, klein) */
  .txt :global(.md) { font-size: 0.8em; opacity: 0.45; font-style: normal; font-weight: normal; }
  .txt:not(:focus) :global(.md) { display: none; }
  .txt :global(strong) { font-weight: bold; }
  .txt :global(.md-link) { color: var(--siegel); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  .txt:not(:focus) :global(.md-link) { cursor: pointer; }

  .p .txt { font-size: 19px; line-height: 1.55; }
  .h2 .txt { margin-top: 0.8em; font: 32px/1.2 var(--fell-sc); color: var(--tinte); text-align: center; }
  .h3 .txt { margin-top: 0.6em; font: italic 24px/1.25 var(--fell); }
  .h2 .txt:empty::before, .h3 .txt:empty::before { font-style: normal; }

  /* Tagebucheintrag: kursiver Kopf zwischen doppelten Linien */
  .entry .txt {
    margin: 1.1em 0 0.3em;
    padding: 4px 8px;
    border-block: 3px double color-mix(in srgb, var(--siegel) 55%, transparent);
    font: italic 21px/1.3 var(--fell);
    color: var(--siegel);
    text-align: center;
  }

  .quote .txt {
    margin: 0.4em 0;
    padding: 4px 14px;
    border-left: 3px double var(--siegel);
    font: italic 19px/1.5 var(--fell);
  }

  .li .txt { position: relative; padding-left: 28px; font-size: 19px; line-height: 1.5; }
  .li .txt::after { content: '❧'; position: absolute; left: 4px; top: 3px; color: var(--siegel); }

  .ornament {
    margin: 0.6em 0;
    text-align: center;
    font-size: 26px;
    color: var(--siegel);
    user-select: none;
  }
  .ornament::before, .ornament::after {
    content: '';
    display: inline-block;
    width: 28%;
    margin: 0 14px;
    vertical-align: middle;
    border-top: 1px solid color-mix(in srgb, var(--tinte) 40%, transparent);
  }

  /* Bild wie ein eingeklebtes Foto */
  figure { margin: 1em 0; }
  .photo {
    display: block;
    width: 100%;
    padding: 10px 10px 12px;
    border: 0;
    background: #fbf6ea;
    box-shadow: 0 1px 2px rgba(36, 24, 13, 0.35), 0 4px 12px rgba(36, 24, 13, 0.2);
    transform: rotate(-0.4deg);
    cursor: zoom-in;
  }
  .photo img { display: block; width: 100%; height: auto; filter: sepia(0.15); }
  figcaption.txt { margin-top: 8px; text-align: center; font: italic 16px/1.4 var(--fell); }

  .attachment {
    display: inline-flex;
    gap: 8px;
    margin: 0.3em 0;
    padding: 6px 14px;
    border: 1px solid color-mix(in srgb, var(--tinte) 45%, transparent);
    background: color-mix(in srgb, var(--papier) 70%, white);
    color: var(--tinte);
    font: 17px var(--fell);
    text-decoration: none;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .attachment:hover { border-color: var(--siegel); color: var(--siegel); }
</style>
