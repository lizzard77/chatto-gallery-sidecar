// Inline-Formatierung im Text der Blöcke (rein funktional, mit `node --test` geprüft):
// **fett**, *kursiv*, ***beides***, [Text](ziel). Kein Escaping, keine weitere Syntax.

/**
 * Text → Liste von Teilen { text, md?, b?, i?, link? }. `md` = Markierungszeichen selbst.
 * `link` = { ziel, art } (art: 'datei' | 'extern' | 'intern'). Alle `text` zusammen ergeben genau den Eingabetext.
 */
export function parseInline(text, fmt = {}) {
  const parts = [];
  const push = (t, f) => {
    if (!t) return;
    const last = parts.at(-1);
    // gleich formatierten normalen Text zusammenfassen
    if (last && !last.md && !f.md && last.b === f.b && last.i === f.i && last.link === f.link) last.text += t;
    else parts.push({ text: t, ...f });
  };
  const base = { b: !!fmt.b, i: !!fmt.i, link: fmt.link };
  const md = (t) => push(t, { ...base, md: true });
  let plain = '';
  const flush = () => { push(plain, base); plain = ''; };

  for (let pos = 0; pos < text.length; ) {
    const rest = text.slice(pos);
    let m;
    if (!fmt.link && (m = LINK.exec(rest)) && linkTarget(m[2])) {
      flush();
      const link = linkTarget(m[2]);
      md('[');
      for (const p of parseInline(m[1], { ...base, link })) push(p.text, p);
      md(`](${m[2]})`);
      pos += m[0].length;
    } else if ((m = (!fmt.b && !fmt.i && BOTH.exec(rest)) || (!fmt.b && BOLD.exec(rest)) || (!fmt.i && ITALIC.exec(rest)))) {
      flush();
      const n = m[0].length - m[1].length >> 1; // Anzahl Sterne je Seite
      const inner = { ...base, b: base.b || n >= 2, i: base.i || n !== 2 };
      md('*'.repeat(n));
      for (const p of parseInline(m[1], inner)) push(p.text, p);
      md('*'.repeat(n));
      pos += m[0].length;
    } else {
      plain += text[pos++];
    }
  }
  flush();
  return parts;
}

// Inhalt beginnt und endet nicht mit Leerraum („2 * 3 * 4" bleibt Text), keine Zeilenumbrüche
const LINK = /^\[([^\]\n]+)\]\(((?:[^()\n]|\([^()\n]*\))+)\)/;
const BOTH = /^\*\*\*([^\s*](?:[^\n*]*[^\s*])?)\*\*\*/;
const BOLD = /^\*\*(\S(?:[^\n]*?\S)??)\*\*(?!\*)/;
const ITALIC = /^\*([^\s*](?:[^\n*]*[^\s*])?)\*/;

/** Linkziel prüfen: Pfad im Spiel-Ordner, http(s)-Adresse oder #/-Link; sonst null (wird nicht verlinkt). */
export function linkTarget(ziel) {
  if (/^https?:\/\/\S+$/i.test(ziel)) return { ziel, art: 'extern' };
  if (/^#\/\S*$/.test(ziel)) return { ziel, art: 'intern' };
  const segs = ziel.split('/');
  if (/^[a-z][\w+.-]*:/i.test(ziel) || ziel.includes('\\') || segs.some((s) => !s.trim() || s === '.' || s === '..')) return null;
  return { ziel, art: 'datei' };
}

/**
 * F/K: Auswahl [start, end) mit `**` bzw. `*` umschließen oder – wenn schon so umschlossen – die Markierung entfernen.
 * Leerraum am Rand der Auswahl bleibt draußen. Gibt { text, start, end } mit der neuen Auswahl zurück.
 */
export function toggleMark(text, start, end, mark) {
  if (!text.slice(start, end).trim()) return { text, start, end };
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  const stars = (s) => s.match(/\**$/)[0].length;
  // Auswahl samt Sternen („**Wort**" markiert) → nur den Inhalt betrachten
  const sel = text.slice(start, end);
  const lead = sel.match(/^\**/)[0].length, trail = stars(sel);
  if (sel.length > lead + trail) { start += lead; end -= trail; } // Sterne je Seite einzeln (auch nur einseitig markiert)
  const s = Math.min(stars(text.slice(0, start)), stars([...text.slice(end)].reverse().join('')));
  const n = mark === '**' ? 2 : 1;
  const on = n === 2 ? s >= 2 : s % 2 === 1;
  if (on) return { text: text.slice(0, start - n) + text.slice(start, end) + text.slice(end + n), start: start - n, end: end - n };
  return { text: text.slice(0, start) + mark + text.slice(start, end) + mark + text.slice(end), start: start + n, end: end + n };
}

/** Link-Markdown aus Text und Ziel; `[`/`]` im Text würden die Syntax brechen. */
export const linkMarkdown = (label, ziel) => `[${label.replace(/[[\]\n]/g, '')}](${ziel})`;

const IMAGE = /\.(jpe?g|png|gif|webp|avif|svg)$/i;
/** Was ein Klick auf einen Link tut: 'pdf' | 'bild' | 'intern' | 'tab'. */
export const linkAction = ({ ziel, art }) =>
  art === 'intern' ? 'intern' : art === 'extern' ? 'tab' : /\.pdf$/i.test(ziel) ? 'pdf' : IMAGE.test(ziel) ? 'bild' : 'tab';
