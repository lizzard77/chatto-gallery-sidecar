<script>
  // Siegellack-Siegel mit Nummer (Karte, Liste, Kopf der Abenteuer-Seite).
  // Der Rand ist pro Nummer leicht anders unregelmäßig – wie echter Lack.
  let { nr, size = 34 } = $props();
  const id = $props.id();

  // Ausgelaufener Lackrand: 15 Punkte mit zufälligem (aber je Nummer festem) Radius, weich verbunden
  const rand = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const blob = $derived.by(() => {
    const r = rand((Number(nr) || 7) * 7919 + 13), n = 15;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = ((i + r() * 0.5) / n) * 2 * Math.PI, d = 42 + r() * 7;
      return [50 + d * Math.cos(a), 50 + d * Math.sin(a)];
    });
    const mid = (p, q) => `${((p[0] + q[0]) / 2).toFixed(1)} ${((p[1] + q[1]) / 2).toFixed(1)}`;
    let d = `M${mid(pts[0], pts[1])}`;
    for (let i = 1; i <= n; i++) d += ` Q${pts[i % n].map((v) => v.toFixed(1)).join(' ')} ${mid(pts[i % n], pts[(i + 1) % n])}`;
    return d + 'Z';
  });
  const fs = $derived(String(nr).length > 2 ? 32 : 46);
</script>

<svg class="siegel" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <!-- Lack: Licht von oben links -->
    <radialGradient id="{id}-lack" cx="38%" cy="32%" r="75%">
      <stop offset="0" stop-color="#b8432a" />
      <stop offset=".55" stop-color="#8a2b18" />
      <stop offset="1" stop-color="#561307" />
    </radialGradient>
    <!-- Prägefläche liegt tiefer: Schatten oben links, Licht unten rechts -->
    <linearGradient id="{id}-mulde" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6a1a0c" />
      <stop offset="1" stop-color="#9c3520" />
    </linearGradient>
    <linearGradient id="{id}-wulst" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e07a5c" stop-opacity=".9" />
      <stop offset=".5" stop-color="#8a2b18" stop-opacity="0" />
      <stop offset="1" stop-color="#3a0c04" stop-opacity=".8" />
    </linearGradient>
    <radialGradient id="{id}-glanz" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff" stop-opacity=".55" />
      <stop offset="1" stop-color="#fff" stop-opacity="0" />
    </radialGradient>
  </defs>
  <path d={blob} fill="url(#{id}-lack)" stroke="#4a1006" stroke-width="1.2" />
  <!-- Wulst um den Stempel, dann die vertiefte Prägefläche -->
  <circle cx="50" cy="50" r="34" fill="none" stroke="url(#{id}-wulst)" stroke-width="5" />
  <circle cx="50" cy="50" r="31.5" fill="url(#{id}-mulde)" />
  <circle cx="50" cy="50" r="31.5" fill="none" stroke="#3a0c04" stroke-opacity=".55" stroke-width="1.2" />
  <!-- Perlrand wie bei einem Petschaft -->
  <circle cx="50" cy="50" r="27" fill="none" stroke="#c9604a" stroke-opacity=".7" stroke-width="2.2"
    stroke-dasharray="0 4.24" stroke-linecap="round" />
  <g class="nr" font-size={fs} text-anchor="middle" dominant-baseline="central">
    <text x="49.3" y="50.8" fill="#3a0c04" opacity=".7">{nr}</text>
    <text x="50.7" y="52.2" fill="#2a0802" opacity=".35">{nr}</text>
    <text x="50" y="51.5" fill="#f3e3c3">{nr}</text>
  </g>
  <ellipse cx="35" cy="27" rx="15" ry="8" transform="rotate(-30 35 27)" fill="url(#{id}-glanz)" />
</svg>

<style>
  .siegel {
    display: block;
    flex: none;
    overflow: visible;
    filter: drop-shadow(0 1.5px 1.5px rgba(36, 24, 13, 0.55));
  }
  .nr { font-family: var(--fell-sc, 'IM Fell English SC', 'IM Fell English', Georgia, serif); }
</style>
