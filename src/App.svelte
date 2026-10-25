<script>
  // Router über den Hash (Segmente URL-kodiert, erstes Segment = Spiel):
  //   #/                        Übersicht aller Spiele
  //   #/<Spiel>/                Karte des Spiels + Verzeichnis
  //   #/<Spiel>/wiki/<nr>       Abenteuer-Seite
  //   #/<Spiel>/dateien/<pfad>  Assets des Spiels (…/Datei.pdf = PDF-Ansicht)
  // Alte Links: #/galerie/<rest> → #/<rest>, #/<Spiel>/<x…> → #/<Spiel>/dateien/<x…>, #/wiki/<nr> → #/
  import Home from './Home.svelte';
  import MapView from './MapView.svelte';
  import WikiPage from './WikiPage.svelte';
  import Gallery from './Gallery.svelte';
  import { getJson, enc } from './api.js';

  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

  /** Alte Hash-Form → neue (oder unverändert) */
  function umleiten(h) {
    let r = h.replace(/^#\/?/, '');
    if (r.startsWith('galerie/') || r === 'galerie') r = r.replace(/^galerie\/?/, '');
    if (/^wiki(\/|$)/.test(r)) r = '';
    const [s, x, ...rest] = r.split('/');
    if (s && x && x !== 'wiki' && x !== 'dateien') r = [s, 'dateien', x, ...rest].join('/');
    return `#/${r}`;
  }

  let hash = $state('');
  function hashLesen() {
    const ziel = umleiten(location.hash);
    if (ziel !== location.hash && !(ziel === '#/' && !location.hash)) location.replace(ziel);
    hash = ziel;
  }
  hashLesen();

  let me = $state(null);
  const teile = $derived(hash.slice(2).split('/'));
  const spiel = $derived(teile[0] ? decode(teile[0]) : '');
  const ansicht = $derived(!spiel ? 'home' : teile[1] === 'wiki' ? 'wiki' : teile[1] === 'dateien' ? 'dateien' : 'karte');
  const spielHref = $derived(`#/${enc(spiel)}/`);

  $effect(() => { document.title = spiel ? `${spiel} – Spielrunden` : 'Spielrunden'; });
  getJson('/api/me').then((u) => (me = u)).catch(() => {});
</script>

<svelte:window onhashchange={hashLesen} />

<header class="bar">
  <a class="logo" href="#/" title="Alle Spielrunden">📜 <span>Spielrunden</span></a>
  {#if spiel}
    <a class="spiel" href={spielHref} title={spiel}>› {spiel}</a>
    <nav class="tabs">
      <a href={spielHref} class:active={ansicht === 'karte' || ansicht === 'wiki'}>Karte</a>
      <a href="{spielHref}dateien/" class:active={ansicht === 'dateien'}>Dateien</a>
    </nav>
  {/if}
  <span class="spacer"></span>
  {#if me}<span class="me" title={me.login}>{me.name}</span>{/if}
</header>

{#if ansicht === 'home'}
  <Home />
{:else if ansicht === 'karte'}
  {#key spiel}<MapView {spiel} />{/key}
{:else if ansicht === 'wiki'}
  {#key hash}<WikiPage {spiel} nr={Number(teile[2])} {me} />{/key}
{:else}
  {#key spiel}<Gallery {spiel} path={teile.slice(2).join('/')} />{/key}
{/if}
