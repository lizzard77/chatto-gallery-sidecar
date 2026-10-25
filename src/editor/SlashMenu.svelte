<script>
  // Menü der Slash-Befehle. Die Tastatur (↑/↓/Enter/Esc) bleibt im Block, siehe BlockEditor.
  let { items, active, onpick } = $props();
</script>

<!-- mousedown statt click: der Block behält den Fokus -->
<ul class="slash" role="listbox" aria-label="Block-Typ">
  {#each items as item, i (item.type)}
    <li role="option" aria-selected={i === active} class:active={i === active}
      onmousedown={(e) => { e.preventDefault(); onpick(item); }}>
      <span class="icon">{item.icon}</span>{item.label}
    </li>
  {/each}
</ul>

<style>
  .slash {
    position: absolute;
    left: 0;
    top: 100%;
    z-index: 5;
    min-width: 220px;
    margin: 2px 0 0;
    padding: 4px;
    list-style: none;
    background: var(--papier);
    color: var(--tinte);
    border: 1px solid color-mix(in srgb, var(--tinte) 45%, transparent);
    outline: 3px double color-mix(in srgb, var(--tinte) 25%, transparent);
    outline-offset: -6px;
    box-shadow: 0 6px 18px rgba(36, 24, 13, 0.3);
    font: 17px/1.3 var(--fell);
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 10px;
    cursor: pointer;
  }
  li.active { background: color-mix(in srgb, var(--siegel) 14%, transparent); color: var(--siegel); }
  .icon { width: 1.4em; text-align: center; opacity: 0.8; }
</style>
