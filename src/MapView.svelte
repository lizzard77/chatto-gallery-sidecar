<script>
  // Startseite: Stadtplan London 1888 mit einem Siegel-Pin pro Abenteuer.
  // Koordinaten in Pixeln der Originalkarte (4800 × 3584), Pins in % positioniert.
  import { tick } from 'svelte';
  import Pin from './Pin.svelte';
  import { getJson, sendJson } from './api.js';

  const W = 4800, H = 3584;
  const stufen = [100, 175, 300, 500]; // Kartenbreite in % des Rahmens

  let pages = $state([]);
  let fehler = $state('');
  let stufe = $state(0);
  let modus = $state(''); // '' | 'setzen' | 'schieben'
  let neu = $state(null); // { x, y } während der Titel-Dialog offen ist
  let titel = $state('');
  let rahmen, karte, dialog;
  let zieht = null; // { p, start, bewegt } beim Verschieben

  async function laden() {
    if (zieht) return;
    try {
      pages = await getJson('/api/pages');
      fehler = '';
    } catch (e) {
      fehler = `Abenteuer konnten nicht geladen werden (${e.message})`;
    }
  }
  laden();

  // Zoomen um die Mitte des sichtbaren Ausschnitts
  async function zoom(d) {
    const neuStufe = Math.max(0, Math.min(stufen.length - 1, stufe + d));
    if (neuStufe === stufe) return;
    const mx = (rahmen.scrollLeft + rahmen.clientWidth / 2) / karte.offsetWidth;
    const my = (rahmen.scrollTop + rahmen.clientHeight / 2) / karte.offsetHeight;
    stufe = neuStufe;
    await tick();
    rahmen.scrollLeft = mx * karte.offsetWidth - rahmen.clientWidth / 2;
    rahmen.scrollTop = my * karte.offsetHeight - rahmen.clientHeight / 2;
  }

  // Bildschirmposition → Originalpixel (begrenzt auf die Karte)
  function aufKarte(e) {
    const r = karte.getBoundingClientRect();
    const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
    return { x: clamp(((e.clientX - r.left) / r.width) * W, W), y: clamp(((e.clientY - r.top) / r.height) * H, H) };
  }

  const umschalten = (m) => (modus = modus === m ? '' : m);

  function kartenKlick(e) {
    if (modus !== 'setzen') return;
    neu = aufKarte(e);
    titel = '';
    modus = '';
    dialog.showModal();
  }

  async function anlegen(e) {
    e.preventDefault();
    if (!titel.trim() || !neu) return;
    try {
      const p = await sendJson('/api/pages', 'POST', { title: titel.trim(), ...neu });
      dialog.close();
      location.hash = `#/wiki/${p.nr}`;
    } catch (err) {
      fehler = `Pin konnte nicht gesetzt werden (${err.message})`;
      dialog.close();
    }
  }

  // Pins verschieben: Zeiger einfangen, Position live mitführen, beim Loslassen speichern
  function greifen(e, p) {
    if (modus !== 'schieben') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    zieht = { p, start: { x: p.x, y: p.y }, bewegt: false };
  }
  function ziehen(e) {
    if (!zieht) return;
    Object.assign(zieht.p, aufKarte(e));
    zieht.bewegt = true;
  }
  async function loslassen() {
    if (!zieht) return;
    const { p, start, bewegt } = zieht;
    zieht = null;
    if (!bewegt) return;
    try {
      await sendJson(`/api/pages/${p.nr}/pos`, 'PUT', { x: p.x, y: p.y });
    } catch (err) {
      Object.assign(p, start);
      fehler = `Pin ${p.nr} konnte nicht verschoben werden (${err.message})`;
    }
  }

  function taste(e) {
    if (e.key === 'Escape' && modus && !dialog.open) modus = '';
  }
</script>

<svelte:window onkeydown={taste} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'visible' && laden()} />

<div class="kartenseite">
  <div class="werkzeuge">
    <div class="kartusche">
      <span class="klein">Plan der Stadt</span>
      <h1>London</h1>
      <span class="klein">Anno Domini 1888</span>
    </div>
    <div class="knoepfe">
      <span class="gruppe">
        <button class="messing" onclick={() => zoom(-1)} disabled={stufe === 0} aria-label="Verkleinern">−</button>
        <span class="stufe">{stufen[stufe]} %</span>
        <button class="messing" onclick={() => zoom(1)} disabled={stufe === stufen.length - 1} aria-label="Vergrößern">+</button>
      </span>
      <button class="messing" class:an={modus === 'setzen'} aria-pressed={modus === 'setzen'} onclick={() => umschalten('setzen')}>
        Pin setzen
      </button>
      <button class="messing" class:an={modus === 'schieben'} aria-pressed={modus === 'schieben'} onclick={() => umschalten('schieben')}>
        Pins verschieben
      </button>
    </div>
    {#if modus === 'setzen'}
      <p class="hinweis">Klicke auf die Karte, wo das Abenteuer spielt. <small>(Esc bricht ab)</small></p>
    {:else if modus === 'schieben'}
      <p class="hinweis">Ziehe die Siegel an ihren neuen Ort. <small>(Esc beendet)</small></p>
    {/if}
    {#if fehler}<p class="hinweis fehler" role="alert">{fehler}</p>{/if}
  </div>

  <div class="rahmen" bind:this={rahmen}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="karte" class:setzen={modus === 'setzen'} class:schieben={modus === 'schieben'}
      style="width: {stufen[stufe]}%" bind:this={karte} onclick={kartenKlick}>
      <img src="/map/london-1888-basis.jpg" alt="Stadtplan von London, 1888" width={W} height={H} draggable="false" />
      <img class="labels" src="/map/london-1888-labels.svg" alt="" width={W} height={H} draggable="false" />

      {#each pages as p (p.nr)}
        <a class="pin" class:links={p.x > W * 0.78} href="#/wiki/{p.nr}"
          style="left: {p.x / 48}%; top: {p.y / 35.84}%" aria-label="Abenteuer {p.nr}: {p.title}"
          draggable="false"
          onclick={(e) => modus && e.preventDefault()}
          onpointerdown={(e) => greifen(e, p)} onpointermove={ziehen} onpointerup={loslassen} onpointercancel={loslassen}>
          <span class="nadel"></span>
          <Pin nr={p.nr} />
          <span class="schild">{p.title}</span>
        </a>
      {/each}
      {#if neu}
        <span class="pin geist" style="left: {neu.x / 48}%; top: {neu.y / 35.84}%"><span class="nadel"></span><Pin nr="?" /></span>
      {/if}
    </div>
  </div>

  {#if pages.length}
    <section class="verzeichnis">
      <h2>Verzeichnis der Abenteuer</h2>
      <ol>
        {#each pages as p (p.nr)}
          <li><a href="#/wiki/{p.nr}"><Pin nr={p.nr} size={26} /><span>{p.title}</span></a></li>
        {/each}
      </ol>
    </section>
  {/if}
</div>

<dialog bind:this={dialog} class="titeldialog" onclose={() => (neu = null)}>
  <form onsubmit={anlegen}>
    <label for="pin-titel">Titel des Abenteuers</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id="pin-titel" bind:value={titel} autofocus required maxlength="200" autocomplete="off" />
    <div class="knoepfe">
      <button type="button" class="messing" onclick={() => dialog.close()}>Abbrechen</button>
      <button class="messing">Pin setzen</button>
    </div>
  </form>
</dialog>

<style>
  .kartenseite {
    --p: var(--papier, #efe2c6);
    --t: var(--tinte, #24180d);
    --s: var(--siegel, #8a2b18);
    min-height: calc(100dvh - 50px);
    padding: 12px clamp(8px, 2vw, 20px) 28px;
    background: var(--p) radial-gradient(ellipse at center, transparent 55%, rgba(120, 80, 30, 0.18));
    color: var(--t);
    font-family: var(--fell, 'IM Fell English', Georgia, serif);
  }

  /* ---------- Kopf: Kartusche + Messingknöpfe ---------- */
  .werkzeuge {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 18px;
    margin-bottom: 12px;
  }
  .kartusche {
    display: grid;
    justify-items: center;
    padding: 6px 22px 7px;
    background: #f6ecd6;
    border: 3px double var(--t);
    outline: 1px solid var(--t);
    outline-offset: 3px;
    border-radius: 2px;
    box-shadow: 0 2px 6px rgba(36, 24, 13, 0.25);
    line-height: 1.05;
  }
  .kartusche h1 {
    margin: 0;
    font: 400 30px/1 var(--fell-sc, 'IM Fell English SC', Georgia, serif);
    letter-spacing: 0.18em;
    padding-left: 0.18em;
  }
  .kartusche .klein { font-style: italic; font-size: 13px; }
  .kartusche .klein:first-child::before, .kartusche .klein:first-child::after { content: ' ~ '; color: var(--s); }

  .knoepfe { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .gruppe { display: inline-flex; align-items: center; gap: 6px; }
  .stufe { min-width: 3.4em; text-align: center; font-style: italic; }

  .messing {
    min-height: 38px;
    min-width: 38px;
    padding: 5px 14px;
    font: 400 16px/1 var(--fell-sc, 'IM Fell English SC', Georgia, serif);
    letter-spacing: 0.04em;
    color: #2a1a08;
    background: linear-gradient(#f0d995, #c99a45 48%, #a87a2c 52%, #d2a95a);
    border: 1px solid #5e4114;
    border-radius: 3px;
    box-shadow: inset 0 1px 0 rgba(255, 248, 220, 0.8), inset 0 -1px 0 rgba(70, 45, 10, 0.4), 0 1px 2px rgba(36, 24, 13, 0.4);
    text-shadow: 0 1px 0 rgba(255, 240, 200, 0.6);
    cursor: pointer;
  }
  .messing:hover:not(:disabled) { filter: brightness(1.07); }
  .messing:active:not(:disabled), .messing.an {
    background: linear-gradient(#a87a2c, #c99a45);
    box-shadow: inset 0 2px 4px rgba(50, 30, 5, 0.55);
  }
  .messing:disabled { opacity: 0.45; cursor: default; }
  .messing:focus-visible { outline: 2px solid var(--s); outline-offset: 2px; }

  /* steht neben den Knöpfen, damit die Karte beim Umschalten nicht springt (auf dem Handy darunter) */
  .hinweis {
    margin: 0;
    font-style: italic;
    font-size: 17px;
  }
  .hinweis small { opacity: 0.7; }
  .fehler { color: var(--s); }

  /* ---------- Karte ---------- */
  .rahmen {
    overflow: auto;
    max-height: calc(100dvh - 70px);
    border: 4px double var(--t);
    padding-top: 44px; /* Platz für Siegel am oberen Kartenrand, Farbe wie der Kartenrand */
    background: #f6e0c3;
    box-shadow: 0 3px 12px rgba(36, 24, 13, 0.3);
    overscroll-behavior: contain;
  }
  .karte { position: relative; line-height: 0; user-select: none; -webkit-user-select: none; }
  .karte img { display: block; width: 100%; height: auto; -webkit-user-drag: none; }
  .karte .labels { position: absolute; inset: 0; pointer-events: none; }
  .karte.setzen { cursor: crosshair; }

  /* Pin: Nadelspitze sitzt exakt auf der Koordinate, Siegel darüber */
  .pin {
    position: absolute;
    display: flex;
    flex-direction: column-reverse;
    align-items: center;
    transform: translate(-50%, -100%);
    text-decoration: none;
    color: var(--t);
    line-height: 1.2;
    -webkit-tap-highlight-color: transparent;
    z-index: 1;
  }
  .pin:hover, .pin:focus-visible { z-index: 3; }
  .pin:focus-visible { outline: none; }
  .pin:focus-visible :global(.siegel) { outline: 2px solid var(--t); outline-offset: 3px; border-radius: 50%; }
  .pin :global(.siegel) { transition: transform 0.12s; }
  .pin:hover :global(.siegel), .pin:focus-visible :global(.siegel) { transform: translateY(-2px) scale(1.08); }
  .nadel {
    width: 4px;
    height: 15px;
    margin-top: -5px;
    background: linear-gradient(90deg, #6b4a17, #f1d48a 45%, #8a6020);
    clip-path: polygon(0 0, 100% 0, 50% 100%);
    filter: drop-shadow(1px 0 0.5px rgba(36, 24, 13, 0.4));
  }
  .karte.setzen .pin { pointer-events: none; }
  .karte.schieben .pin { cursor: grab; touch-action: none; }
  .karte.schieben .pin:active { cursor: grabbing; }
  .geist { opacity: 0.75; pointer-events: none; }

  /* Titelschild: Papier-Kartusche mit Doppelrahmen, rechts vom Siegel (am rechten Rand links) */
  .schild {
    position: absolute;
    left: calc(50% + 24px);
    top: 0;
    padding: 3px 10px 4px;
    white-space: nowrap;
    max-width: 60vw;
    overflow: hidden;
    text-overflow: ellipsis;
    font-style: italic;
    font-size: 16px;
    background: #f6ecd6;
    border: 3px double var(--t);
    box-shadow: 0 2px 5px rgba(36, 24, 13, 0.35);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s, visibility 0.15s;
    pointer-events: none;
  }
  .pin.links .schild { left: auto; right: calc(50% + 24px); }
  .pin:hover .schild, .pin:focus-visible .schild { opacity: 1; visibility: visible; }

  /* ---------- Verzeichnis unter der Karte ---------- */
  .verzeichnis { max-width: 900px; margin: 22px auto 0; }
  .verzeichnis h2 {
    margin: 0 0 10px;
    text-align: center;
    font: 400 22px/1.2 var(--fell-sc, 'IM Fell English SC', Georgia, serif);
    letter-spacing: 0.08em;
  }
  .verzeichnis h2::after { content: '❦'; display: block; font-size: 18px; color: var(--s); }
  .verzeichnis ol {
    list-style: none;
    margin: 0;
    padding: 0;
    columns: 2 280px;
    column-gap: 28px;
  }
  .verzeichnis li { break-inside: avoid; border-bottom: 1px dotted rgba(36, 24, 13, 0.4); }
  .verzeichnis a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 2px;
    color: var(--t);
    text-decoration: none;
    font-size: 18px;
  }
  .verzeichnis a:hover span, .verzeichnis a:focus-visible span { color: var(--s); text-decoration: underline; }

  /* ---------- Dialog „Titel des Abenteuers" ---------- */
  .titeldialog {
    width: min(420px, calc(100vw - 32px));
    padding: 18px 20px;
    color: var(--tinte, #24180d);
    background: #f6ecd6;
    border: 4px double var(--tinte, #24180d);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
    font-family: var(--fell, 'IM Fell English', Georgia, serif);
  }
  .titeldialog::backdrop { background: rgba(36, 24, 13, 0.45); }
  .titeldialog label { display: block; margin-bottom: 8px; font: 400 20px var(--fell-sc, 'IM Fell English SC', Georgia, serif); }
  .titeldialog input {
    width: 100%;
    padding: 6px 2px;
    font: italic 19px var(--fell, 'IM Fell English', Georgia, serif);
    color: inherit;
    background: transparent;
    border: 0;
    border-bottom: 1.5px solid var(--tinte, #24180d);
    outline: none;
  }
  .titeldialog input:focus { border-bottom-color: var(--siegel, #8a2b18); }
  .titeldialog .knoepfe { justify-content: flex-end; margin-top: 16px; }

  @media (max-width: 600px) {
    .werkzeuge { gap: 8px 12px; }
    .kartusche { padding: 4px 14px 5px; }
    .kartusche h1 { font-size: 22px; }
    .kartusche .klein { font-size: 11px; }
    .knoepfe { gap: 6px; }
    .messing { font-size: 14px; padding: 5px 9px; }
    .rahmen { max-height: calc(100dvh - 150px); }
  }
</style>
