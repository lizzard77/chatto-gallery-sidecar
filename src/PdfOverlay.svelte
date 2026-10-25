<script>
  // PDF im Vollbild über der Seite (Wiki-Links und Dateien). ✕ oder Esc schließt → onclose.
  import { showPdf } from './pdfviewer.js';

  let { url, onclose } = $props();
  let dialog, box;

  $effect(() => {
    dialog.showModal();
    const close = showPdf(box, { url });
    return () => close();
  });
</script>

<dialog class="pdf-overlay" bind:this={dialog} {onclose} aria-label="PDF">
  <button type="button" class="pdf-close" aria-label="Schließen" onclick={() => dialog.close()}>✕</button>
  <div class="pdf-box" bind:this={box}></div>
</dialog>

<style>
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
