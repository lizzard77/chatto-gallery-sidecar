<script>
  // Router über den Hash:
  //   #/                  Karte (Startseite des Wikis)
  //   #/wiki/<nr>         Abenteuer-Seite zu Pin <nr>
  //   #/galerie/<pfad>/   Galerie-Ordner, #/galerie/<pfad>/Datei.pdf = PDF-Ansicht
  // Alte Galerie-Links (#/Mira/) leiten auf #/galerie/Mira/ um.
  import MapView from './MapView.svelte';
  import WikiPage from './WikiPage.svelte';
  import Gallery from './Gallery.svelte';
  import { getJson } from './api.js';

  let hash = $state(location.hash);
  let me = $state(null);
  const route = $derived(hash.replace(/^#\/?/, ''));

  $effect(() => {
    const legacy = !/^(wiki|galerie)(\/|$)/.test(route) && route;
    if (legacy) location.replace(`#/galerie/${route}`);
  });
  getJson('/api/me').then((u) => (me = u)).catch(() => {});
</script>

<svelte:window onhashchange={() => (hash = location.hash)} />

<header class="bar">
  <nav class="tabs">
    <a href="#/" class:active={!route}>Karte</a>
    <a href="#/galerie/" class:active={route.startsWith('galerie')}>Galerie</a>
  </nav>
  <span class="spacer"></span>
  {#if me}<span class="me" title={me.login}>{me.name}</span>{/if}
</header>

{#if !route}
  <MapView />
{:else if route.startsWith('wiki/')}
  {#key route}<WikiPage nr={Number(route.split('/')[1])} {me} />{/key}
{:else if route.startsWith('galerie')}
  <Gallery path={route.replace(/^galerie\/?/, '')} />
{/if}
