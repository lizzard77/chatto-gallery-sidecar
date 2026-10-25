<script>
  // Bilder groß ansehen: Pfeiltasten und Wischen blättern, Klick neben das Bild oder Esc schließt.
  // images = [{ url, name }], index = aktuelles Bild (null = geschlossen).
  let { images, index = $bindable(null) } = $props();

  let dialog;
  let touchX = null;
  const current = $derived(index === null ? null : images[index]);
  const caption = $derived(current && (images.length > 1
    ? `${stripExt(current.name)} (${index + 1}/${images.length})`
    : stripExt(current.name)));

  function stripExt(name) { return name.replace(/\.[^.]+$/, ''); }
  const go = (step) => (index = (index + step + images.length) % images.length);

  $effect(() => {
    if (current && !dialog.open) dialog.showModal();
    if (!current && dialog.open) dialog.close();
  });

  function onkeydown(ev) {
    if (ev.key === 'ArrowLeft') go(-1);
    if (ev.key === 'ArrowRight') go(1);
  }
  // Klick neben das Bild schließt
  function onclick(ev) {
    if (ev.target === dialog || ev.target.tagName === 'FIGURE') dialog.close();
  }
  // Wischen auf Touch-Geräten
  function ontouchend(ev) {
    if (touchX === null) return;
    const dx = ev.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog class="lightbox" bind:this={dialog} aria-label="Bild" onclose={() => (index = null)}
  {onclick} {onkeydown} ontouchstart={(ev) => (touchX = ev.touches[0].clientX)} {ontouchend}>
  <button class="lb-close" type="button" aria-label="Schließen" onclick={() => dialog.close()}>✕</button>
  <button class="lb-nav" type="button" aria-label="Vorheriges Bild" onclick={() => go(-1)}>‹</button>
  <figure>
    {#if current}
      <img src={current.url} alt={stripExt(current.name)}>
      <figcaption>{caption}</figcaption>
    {/if}
  </figure>
  <button class="lb-nav" type="button" aria-label="Nächstes Bild" onclick={() => go(1)}>›</button>
</dialog>
