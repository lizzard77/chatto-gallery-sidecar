<script>
  // Übersicht: eine Papier-Kachel pro Spiel (Ordner unter files/) mit Kartenvorschau
  import { getJson, enc } from './api.js';

  let spiele = $state(null);
  let fehler = $state('');

  getJson('/api/spiele')
    .then((s) => (spiele = s))
    .catch((e) => (fehler = `Spiele konnten nicht geladen werden (${e.message})`));
</script>

<div class="uebersicht">
  <h1>Spielrunden</h1>
  {#if fehler}
    <p class="leer fehler" role="alert">{fehler}</p>
  {:else if spiele && !spiele.length}
    <p class="leer">Noch keine Spiele – Ordner unter files/ anlegen.</p>
  {:else if spiele}
    <ul class="kacheln">
      {#each spiele as s (s.name)}
        <li>
          <a class="kachel" href="#/{enc(s.name)}/">
            <span class="bild">
              {#if s.vorschau || s.karte}
                <img src={s.vorschau || s.karte} alt="" loading="lazy" />
              {:else}
                <span class="ornament" aria-hidden="true">❦</span>
              {/if}
            </span>
            <span class="name">{s.name}</span>
            <span class="zahl">{s.abenteuer} Abenteuer</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .uebersicht {
    min-height: calc(100dvh - var(--bar-height, 54px));
    padding: 18px clamp(10px, 3vw, 32px) 32px;
    background: var(--papier) radial-gradient(ellipse at center, transparent 55%, rgba(120, 80, 30, 0.18));
    color: var(--tinte);
    font-family: var(--fell);
  }
  h1 {
    margin: 0 0 18px;
    text-align: center;
    font: 400 28px/1.2 var(--fell-sc);
    letter-spacing: 0.12em;
  }
  h1::after { content: '❦'; display: block; font-size: 20px; color: var(--siegel); }
  .leer { text-align: center; font-style: italic; font-size: 19px; }
  .fehler { color: var(--siegel); }

  .kacheln {
    list-style: none;
    margin: 0 auto;
    padding: 0;
    max-width: 1100px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 22px;
  }
  .kachel {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 10px 10px 12px;
    color: var(--tinte);
    text-decoration: none;
    background: #f6ecd6;
    border: 3px double var(--tinte);
    outline: 1px solid var(--tinte);
    outline-offset: 3px;
    border-radius: 2px;
    box-shadow: 0 2px 6px rgba(36, 24, 13, 0.25);
    transition: transform 0.12s, box-shadow 0.12s;
  }
  .kachel:hover, .kachel:focus-visible { transform: translateY(-2px); box-shadow: 0 6px 14px rgba(36, 24, 13, 0.3); }
  .kachel:focus-visible { outline-color: var(--siegel); }
  .bild {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 4 / 3;
    margin-bottom: 8px;
    overflow: hidden;
    background: #f6e0c3;
    border: 1px solid rgba(36, 24, 13, 0.5);
  }
  .bild img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ornament { font-size: 64px; color: var(--siegel); opacity: 0.55; }
  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 400 22px/1.2 var(--fell-sc);
    letter-spacing: 0.06em;
  }
  .zahl { font-style: italic; font-size: 15px; opacity: 0.8; }
</style>
