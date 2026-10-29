<script>
  // Karte eines Spiels mit einem Siegel-Pin pro Abenteuer.
  // Koordinaten als Anteile 0…1 der Kartenbreite/-höhe; Abenteuer ohne Ort (x = null) stehen nur im Verzeichnis.
  import { tick } from 'svelte';
  import Pin from './Pin.svelte';
  import { api, getJson, sendJson, upload, enc, fileUrl, spielApi } from './api.js';
  import { makeThumb } from './thumb.js';

  let { spiel } = $props();

  const stufen = [1, 1.75, 3, 5]; // Vielfache der eingepassten Größe
  const RAND = 40; // Platz über der Karte für Siegel am oberen Rand
  const BILD = /\.(jpe?g|png|webp)$/i;

  let info = $state(null); // { karte, overlay, vorschau, … } aus /api/spiele/<Spiel>
  let pages = $state([]);
  let fehler = $state('');
  let laedt = $state(''); // Hinweis während des Hochladens
  let stufe = $state(0);
  let modus = $state(''); // '' | 'setzen' | 'schieben' | 'bewegen'
  let menue = $state(false); // Menü „Karte …" offen
  let rw = $state(0), rh = $state(0); // Größe des Rahmens
  let W = $state(0), H = $state(0); // natürliche Größe des Kartenbilds (0 bis es geladen ist)
  // Stufe 1: ganze Karte passt in den Rahmen (contain); darüber wird verschoben
  const breite = $derived(W && H ? Math.max(0, Math.min(rw, ((rh - RAND) * W) / H)) * stufen[stufe] : 0);
  const zuGross = $derived(breite > rw + 1 || (breite * H) / W + RAND > rh + 1);
  const mitOrt = $derived(pages.filter((p) => p.x != null));
  let pan = $state.raw(null); // { x, y, sl, st } beim Verschieben der Ansicht
  let neu = $state(null); // { x, y } während der Titel-Dialog offen ist (beide null = ohne Ort)
  let titel = $state('');
  let rahmen = $state(), karte = $state(), dialog, kartenWahl, overlayWahl, menueKnopf;
  let zieht = null; // { p, start, bewegt } beim Verschieben

  const base = $derived(spielApi(spiel));
  const wikiHref = (nr) => `#/${enc(spiel)}/wiki/${nr}`;

  async function laden() {
    if (zieht) return;
    try {
      [info, pages] = await Promise.all([getJson(base), getJson(`${base}/pages`)]);
      fehler = '';
    } catch (e) {
      fehler = e.status === 404 ? 'Dieses Spiel gibt es nicht.' : `Karte konnte nicht geladen werden (${e.message})`;
    }
  }
  laden();

  // Zoomen um die Mitte des sichtbaren Ausschnitts
  async function zoom(d) {
    const neuStufe = Math.max(0, Math.min(stufen.length - 1, stufe + d));
    if (neuStufe === stufe) return;
    const mx = (rahmen.scrollLeft + rahmen.clientWidth / 2 - karte.offsetLeft) / karte.offsetWidth;
    const my = (rahmen.scrollTop + rahmen.clientHeight / 2 - karte.offsetTop) / karte.offsetHeight;
    stufe = neuStufe;
    await tick();
    rahmen.scrollLeft = karte.offsetLeft + mx * karte.offsetWidth - rahmen.clientWidth / 2;
    rahmen.scrollTop = karte.offsetTop + my * karte.offsetHeight - rahmen.clientHeight / 2;
  }

  // Ansicht verschieben: rechte Maustaste immer, linke Maus/Finger im Modus „bewegen"
  function panStart(e) {
    if (!zuGross || !(e.button === 2 || (modus === 'bewegen' && e.button === 0))) return;
    e.preventDefault();
    rahmen.setPointerCapture(e.pointerId);
    pan = { x: e.clientX, y: e.clientY, sl: rahmen.scrollLeft, st: rahmen.scrollTop };
  }
  function panMove(e) {
    if (!pan) return;
    rahmen.scrollLeft = pan.sl - (e.clientX - pan.x);
    rahmen.scrollTop = pan.st - (e.clientY - pan.y);
  }
  const panEnd = () => (pan = null);
  $effect(() => { if (!zuGross && modus === 'bewegen') modus = ''; });

  // Bildschirmposition → Anteil der Karte (begrenzt auf 0…1, 4 Stellen)
  function aufKarte(e) {
    const r = karte.getBoundingClientRect();
    const anteil = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1e4) / 1e4;
    return { x: anteil((e.clientX - r.left) / r.width), y: anteil((e.clientY - r.top) / r.height) };
  }

  const umschalten = (m) => (modus = modus === m ? '' : m);

  function titelFragen(pos) {
    neu = pos;
    titel = '';
    modus = '';
    dialog.showModal();
  }

  function kartenKlick(e) {
    if (modus === 'setzen') titelFragen(aufKarte(e));
  }

  async function anlegen(e) {
    e.preventDefault();
    if (!titel.trim() || !neu) return;
    try {
      const p = await sendJson(`${base}/pages`, 'POST', { title: titel.trim(), ...neu });
      dialog.close();
      location.hash = wikiHref(p.nr);
    } catch (err) {
      fehler = `Abenteuer konnte nicht angelegt werden (${err.message})`;
      dialog.close();
    }
  }

  // Pins verschieben: Zeiger einfangen, Position live mitführen, beim Loslassen speichern
  function greifen(e, p) {
    if (modus !== 'schieben' || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
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
      await sendJson(`${base}/pages/${p.nr}/pos`, 'PUT', { x: p.x, y: p.y });
    } catch (err) {
      Object.assign(p, start);
      fehler = `Pin ${p.nr} konnte nicht verschoben werden (${err.message})`;
    }
  }

  // Pin vor den anderen verstecken (nur der Ersteller sieht ihn dann noch, blass)
  async function verstecken(p) {
    const vorher = p.versteckt;
    p.versteckt = !vorher;
    try {
      await sendJson(`${base}/pages/${p.nr}/versteckt`, 'PUT', { versteckt: p.versteckt });
    } catch (err) {
      p.versteckt = vorher;
      fehler = `Pin ${p.nr} konnte nicht ${vorher ? 'gezeigt' : 'versteckt'} werden (${err.message})`;
    }
  }

  // ---------- Kartenbild / Beschriftung hochladen ----------
  async function hochladen(arbeit, text) {
    menue = false;
    laedt = text;
    try {
      await arbeit();
      await laden();
    } catch (err) {
      fehler = `${text.replace(/ …$/, '')} fehlgeschlagen (${err.message})`;
    }
    laedt = '';
  }

  function karteGewaehlt(e) {
    const file = e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!file) return;
    const ext = file.name.match(BILD)?.[1].toLowerCase();
    if (!ext) return (fehler = 'Kartenbild muss JPG, PNG oder WebP sein.');
    hochladen(async () => {
      await upload(fileUrl(spiel, `.karte/karte.${ext}`), file);
      // Vorschau für die Übersicht – ohne geht's auch
      const thumb = await makeThumb(file);
      if (thumb) await upload(fileUrl(spiel, '.karte/vorschau.webp'), thumb).catch(() => {});
    }, 'Kartenbild hochladen …');
  }

  function overlayGewaehlt(e) {
    const file = e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (!/\.svg$/i.test(file.name)) return (fehler = 'Beschriftung muss eine SVG-Datei sein.');
    hochladen(() => upload(fileUrl(spiel, '.karte/overlay.svg'), file), 'Beschriftung hochladen …');
  }

  function overlayEntfernen() {
    menue = false;
    if (!confirm('Beschriftung der Karte entfernen?')) return;
    hochladen(() => api(fileUrl(spiel, '.karte/overlay.svg'), { method: 'DELETE' }), 'Beschriftung entfernen …');
  }

  function karteWaehlen() {
    menue = false;
    kartenWahl.click();
  }

  // Menü schließt bei Klick daneben
  function draussen(e) {
    if (menue && !e.target.closest?.('.menuehalter')) menue = false;
  }

  function taste(e) {
    if (e.key !== 'Escape' || dialog.open) return;
    if (menue) { menue = false; menueKnopf.focus(); } else if (modus) modus = '';
  }
</script>

<svelte:window onkeydown={taste} onpointerdown={draussen} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'visible' && laden()} />

<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden bind:this={kartenWahl} onchange={karteGewaehlt} />
<input type="file" accept=".svg,image/svg+xml" hidden bind:this={overlayWahl} onchange={overlayGewaehlt} />

<div class="kartenseite">
  <div class="oben">
  <div class="werkzeuge">
    <div class="kartusche">
      <span class="klein">Karte</span>
      <h1 title={spiel}>{spiel}</h1>
    </div>
    <div class="knoepfe">
      <span class="gruppe">
        <button class="messing" onclick={() => zoom(-1)} disabled={!info?.karte || stufe === 0} aria-label="Verkleinern">−</button>
        <span class="stufe">{Math.round(stufen[stufe] * 100)} %</span>
        <button class="messing" onclick={() => zoom(1)} disabled={!info?.karte || stufe === stufen.length - 1} aria-label="Vergrößern">+</button>
      </span>
      <button class="messing" class:an={modus === 'setzen'} aria-pressed={modus === 'setzen'} disabled={!info?.karte}
        onclick={() => umschalten('setzen')}>
        Pin setzen
      </button>
      <button class="messing" class:an={modus === 'schieben'} aria-pressed={modus === 'schieben'} disabled={!mitOrt.length}
        onclick={() => umschalten('schieben')}>
        <span class="lang">Pins</span> verschieben
      </button>
      <button class="messing hand" class:an={modus === 'bewegen'} aria-pressed={modus === 'bewegen'} disabled={!zuGross}
        title="Karte bewegen (oder mit der rechten Maustaste ziehen)" aria-label="Karte bewegen" onclick={() => umschalten('bewegen')}>
        ✋
      </button>
      <span class="menuehalter">
        <button class="messing" class:an={menue} aria-expanded={menue} aria-haspopup="menu" disabled={!info || !!laedt}
          bind:this={menueKnopf} onclick={() => (menue = !menue)}>
          Karte …
        </button>
        {#if menue}
          <span class="menue" role="menu">
            <button role="menuitem" onclick={karteWaehlen}>{info?.karte ? 'Kartenbild ersetzen' : 'Kartenbild hochladen'}</button>
            <button role="menuitem" onclick={() => { menue = false; overlayWahl.click(); }} disabled={!info?.karte}>
              Beschriftung (SVG) hochladen
            </button>
            {#if info?.overlay}
              <button role="menuitem" onclick={overlayEntfernen}>Beschriftung entfernen</button>
            {/if}
          </span>
        {/if}
      </span>
    </div>
  </div>

  <div class="kartenfeld">
    {#if info && !info.karte}
      <button class="ohnekarte" onclick={() => kartenWahl.click()} disabled={!!laedt}>
        <span class="ornament" aria-hidden="true">❦</span>
        <span>Noch keine Karte – <u>Kartenbild hochladen</u></span>
        <small>JPG, PNG oder WebP</small>
      </button>
    {:else if info}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="rahmen" class:bewegen={modus === 'bewegen'} class:zieht={pan} bind:this={rahmen}
      bind:clientWidth={rw} bind:clientHeight={rh}
      onpointerdown={panStart} onpointermove={panMove} onpointerup={panEnd} onpointercancel={panEnd}
      oncontextmenu={(e) => zuGross && e.preventDefault()}>
    <div class="flaeche">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="karte" class:setzen={modus === 'setzen'} class:schieben={modus === 'schieben'} class:bereit={breite}
      style="width: {breite}px" bind:this={karte} onclick={kartenKlick}>
      <img src={info.karte} alt="Karte: {spiel}" draggable="false" bind:naturalWidth={W} bind:naturalHeight={H} />
      {#if info.overlay}<img class="labels" src={info.overlay} alt="" draggable="false" />{/if}

      {#each mitOrt as p (p.nr)}
        <a class="pin" class:links={p.x > 0.78} class:versteckt={p.versteckt} href={wikiHref(p.nr)}
          style="left: {p.x * 100}%; top: {p.y * 100}%" aria-label="Abenteuer {p.nr}: {p.title}"
          draggable="false"
          onclick={(e) => modus && e.preventDefault()}
          onpointerdown={(e) => greifen(e, p)} onpointermove={ziehen} onpointerup={loslassen} onpointercancel={loslassen}>
          <span class="nadel"></span>
          <Pin nr={p.nr} />
          <span class="schild">{p.title}{#if p.versteckt} <small>(versteckt)</small>{/if}</span>
        </a>
      {/each}
      {#if neu && neu.x != null}
        <span class="pin geist" style="left: {neu.x * 100}%; top: {neu.y * 100}%"><span class="nadel"></span><Pin nr="?" /></span>
      {/if}
    </div>
    </div>
    </div>
    {/if}
    {#if laedt}
      <p class="hinweis">{laedt}</p>
    {:else if modus === 'setzen'}
      <p class="hinweis">Klicke auf die Karte, wo das Abenteuer spielt. <small>(Esc bricht ab)</small></p>
    {:else if modus === 'schieben'}
      <p class="hinweis">Ziehe die Siegel an ihren neuen Ort. <small>(Esc beendet)</small></p>
    {:else if modus === 'bewegen'}
      <p class="hinweis">Ziehe die Karte, um den Ausschnitt zu verschieben. <small>(Esc beendet)</small></p>
    {/if}
    {#if fehler}<p class="hinweis fehler" role="alert">{fehler}</p>{/if}
  </div>
  </div>

  {#if info}
    <section class="verzeichnis">
      <h2>Verzeichnis der Abenteuer</h2>
      {#if pages.length}
        <ol>
          {#each pages as p (p.nr)}
            <li>
              <a href={wikiHref(p.nr)}>
                <Pin nr={p.nr} size={26} /><span>{p.title}</span>
                {#if p.x == null}<small class="ohneort">ohne Ort</small>{/if}
              </a>
              {#if p.meins && p.x != null}
                <button class="auge" class:zu={p.versteckt} onclick={() => verstecken(p)} aria-pressed={!!p.versteckt}
                  title={p.versteckt ? 'Pin ist vor den anderen versteckt – zeigen' : 'Pin vor den anderen verstecken'}
                  aria-label={p.versteckt ? `Pin ${p.nr} zeigen` : `Pin ${p.nr} verstecken`}>
                  {p.versteckt ? '◌' : '◉'}
                </button>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
      <p class="neuohneort">
        <button class="messing" onclick={() => titelFragen({ x: null, y: null })}>+ Abenteuer ohne Ort</button>
      </p>
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
      <button class="messing">{neu?.x == null ? 'Anlegen' : 'Pin setzen'}</button>
    </div>
  </form>
</dialog>

<style>
  .kartenseite {
    --p: var(--papier, #efe2c6);
    --t: var(--tinte, #24180d);
    --s: var(--siegel, #8a2b18);
    padding: 0 clamp(8px, 2vw, 20px) 28px;
    background: var(--p) radial-gradient(ellipse at center, transparent 55%, rgba(120, 80, 30, 0.18));
    color: var(--t);
    font-family: var(--fell, 'IM Fell English', Georgia, serif);
  }

  /* ---------- Kopf: Kartusche + Messingknöpfe ---------- */
  .werkzeuge {
    display: flex;
    padding-top: 10px;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 18px;
    padding-bottom: 10px;
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
    max-width: 14em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  /* Menü „Karte …": Papierzettel unter dem Knopf */
  .menuehalter { position: relative; }
  .menue {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 5;
    display: grid;
    min-width: max-content;
    padding: 4px;
    background: #f6ecd6;
    border: 3px double var(--t);
    box-shadow: 0 4px 12px rgba(36, 24, 13, 0.35);
  }
  .menue button {
    padding: 8px 12px;
    text-align: left;
    font: italic 17px var(--fell, 'IM Fell English', Georgia, serif);
    color: var(--t);
    background: none;
    border: 0;
    cursor: pointer;
  }
  .menue button:hover:not(:disabled), .menue button:focus-visible { color: var(--s); background: rgba(138, 43, 24, 0.08); outline: none; }
  .menue button:disabled { opacity: 0.45; cursor: default; }

  /* Ohne Karte: großes Feld zum Hochladen */
  .ohnekarte {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 6px;
    font: italic 22px var(--fell, 'IM Fell English', Georgia, serif);
    color: var(--t);
    background: #f6e0c3;
    border: 4px double var(--t);
    box-shadow: 0 3px 12px rgba(36, 24, 13, 0.3);
    cursor: pointer;
  }
  .ohnekarte:hover:not(:disabled) u { color: var(--s); }
  .ohnekarte:focus-visible { outline: 2px solid var(--s); outline-offset: 2px; }
  .ohnekarte .ornament { font-size: 54px; font-style: normal; color: var(--s); opacity: 0.6; }
  .ohnekarte small { font-size: 15px; opacity: 0.7; }

  /* schwebt unten über der Karte, damit die Karte beim Umschalten nicht springt */
  .hinweis {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    width: max-content;
    max-width: calc(100% - 24px);
    margin: 0;
    padding: 5px 14px;
    font-style: italic;
    font-size: 17px;
    background: #f6ecd6;
    border: 3px double var(--t);
    box-shadow: 0 2px 6px rgba(36, 24, 13, 0.35);
    pointer-events: none;
  }
  .hinweis.fehler { bottom: auto; top: 14px; }
  .hinweis small { opacity: 0.7; }
  .fehler { color: var(--s); }

  /* ---------- Karte ---------- */
  /* Werkzeuge + Kartenfeld füllen genau den Bildschirm unter der Kopfleiste */
  .oben { display: flex; flex-direction: column; height: calc(100dvh - var(--bar-height, 50px)); min-height: 320px; }
  .kartenfeld { position: relative; flex: 1; min-height: 200px; }
  .rahmen {
    position: absolute;
    inset: 0;
    overflow: auto;
    border: 4px double var(--t);
    background: #f6e0c3; /* Farbe wie der Kartenrand */
    box-shadow: 0 3px 12px rgba(36, 24, 13, 0.3);
    overscroll-behavior: contain;
  }
  .rahmen.bewegen { cursor: grab; touch-action: none; }
  .rahmen.zieht { cursor: grabbing; }
  /* Fläche mindestens so groß wie der Rahmen; margin:auto zentriert, ohne beim Zoomen Teile unerreichbar abzuschneiden */
  .flaeche { position: relative; display: flex; min-width: 100%; min-height: 100%; width: max-content; padding-top: 40px; }
  .karte { flex: none; margin: auto; position: relative; line-height: 0; user-select: none; -webkit-user-select: none; }
  .karte img { display: block; width: 100%; height: auto; -webkit-user-drag: none; }
  .karte .labels { position: absolute; inset: 0; height: 100%; pointer-events: none; }
  .karte:not(.bereit) { visibility: hidden; } /* bis die Bildgröße bekannt ist */
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
  .verzeichnis li { display: flex; align-items: center; break-inside: avoid; border-bottom: 1px dotted rgba(36, 24, 13, 0.4); }
  .verzeichnis a {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 2px;
    color: var(--t);
    text-decoration: none;
    font-size: 18px;
  }
  .verzeichnis a:hover span, .verzeichnis a:focus-visible span { color: var(--s); text-decoration: underline; }
  .verzeichnis .ohneort { margin-left: auto; font-style: italic; font-size: 14px; opacity: 0.65; white-space: nowrap; }
  .auge {
    flex: none;
    padding: 2px 6px;
    border: 0;
    background: none;
    color: var(--t);
    font-size: 18px;
    cursor: pointer;
    opacity: 0.6;
  }
  .auge:hover, .auge:focus-visible { opacity: 1; }
  .auge.zu { color: var(--s); opacity: 0.9; }
  .pin.versteckt :global(.siegel) { opacity: 0.45; }
  .neuohneort { margin: 14px 0 0; text-align: center; }

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
    .knoepfe { gap: 5px; }
    .gruppe { gap: 2px; }
    .stufe { min-width: 2.9em; font-size: 14px; }
    .messing { font-size: 13px; letter-spacing: 0; padding: 4px 7px; min-width: 34px; min-height: 34px; }
    .kartusche { display: none; } /* auf dem Handy zählt jeder Pixel Karte */
  }
  @media (max-width: 420px) {
    /* alle Knöpfe in einer Zeile */
    .lang, .stufe { display: none; }
  }
</style>
