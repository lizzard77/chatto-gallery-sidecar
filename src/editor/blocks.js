// Reine Block-Logik (ohne DOM), damit sie sich mit `node --test` prüfen lässt.
// Ein Block ist { type, text?, file? }; im Speicher kommt eine `id` für Sveltes keyed each dazu.

/** Blöcke, deren Text direkt bearbeitet wird (Bild hat nur eine Bildunterschrift). */
export const TEXT_TYPES = ['p', 'h2', 'h3', 'entry', 'quote', 'li'];
export const isText = (block) => TEXT_TYPES.includes(block?.type);

let lastId = 0;
export const newBlock = (type = 'p', text = '', extra = {}) =>
  ({ id: `b${++lastId}`, type, ...(type === 'hr' ? {} : { text }), ...extra });

/** Beim Laden: jede Seite bekommt ids; eine neue Seite startet mit Eintrag + Absatz. */
export function withIds(blocks) {
  if (!blocks?.length) return [newBlock('entry'), newBlock('p')];
  return blocks.map((b) => ({ ...b, id: `b${++lastId}` }));
}

/** Zum Speichern: ids weg, nur die Felder, die der Typ braucht. Zeilenumbrüche am Ende (Shift+Enter) fallen weg. */
export const stripIds = (blocks) =>
  blocks.map(({ type, text = '', file }) => {
    text = text.replace(/\n+$/, '');
    return type === 'hr' ? { type } : type === 'file' ? { type, file } : type === 'image' ? { type, file, text } : { type, text };
  });

/**
 * Enter: teilt blocks[i] bei `offset`. Rest landet in einem neuen Block danach
 * (nach `li` wieder `li`, sonst `p`). Enter auf leerem `li` macht daraus nur ein `p`.
 * Gibt den Index des Blocks zurück, in den der Cursor (an den Anfang) soll.
 */
export function splitBlock(blocks, i, offset) {
  const b = blocks[i];
  if (b.type === 'li' && !b.text) {
    b.type = 'p';
    return i;
  }
  const rest = b.text.slice(offset);
  b.text = b.text.slice(0, offset);
  blocks.splice(i + 1, 0, newBlock(b.type === 'li' ? 'li' : 'p', rest));
  return i + 1;
}

/**
 * Backspace am Blockanfang. Gibt { index, offset } für den Cursor zurück oder null (nichts zu tun).
 * Leere Nicht-`p`-Blöcke (und Listenpunkte) werden erst zu `p`, sonst verschmilzt der Block
 * mit dem vorherigen Textblock. Ein Trenner davor wird gelöscht.
 */
export function mergeBack(blocks, i) {
  const b = blocks[i];
  if (b.type !== 'p' && (!b.text || b.type === 'li')) {
    b.type = 'p';
    return { index: i, offset: 0 };
  }
  const prev = blocks[i - 1];
  if (!prev) return null;
  if (prev.type === 'hr') {
    blocks.splice(i - 1, 1);
    return { index: i - 1, offset: 0 };
  }
  if (!isText(prev)) {
    // Bild/Datei davor bleibt stehen; ein leerer Absatz verschwindet aber
    if (b.text) return null;
    blocks.splice(i, 1);
    return { index: i - 1, offset: -1 };
  }
  const offset = prev.text.length;
  prev.text += b.text;
  blocks.splice(i, 1);
  return { index: i - 1, offset };
}

/** Block um eine Stelle verschieben (dir = -1 hoch, +1 runter). Gibt den neuen Index zurück. */
export function moveBlock(blocks, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= blocks.length) return i;
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  return j;
}

/** Dateiname bei Namenskonflikt: `karte.jpg` → `karte-2.jpg`. */
export const numbered = (name, n) => (n < 2 ? name : name.replace(/(\.[^.]*)?$/, (ext) => `-${n}${ext}`));

/** Upload-Namen entschärfen: keine Pfade, kein führender Punkt. */
export const safeName = (name) => name.replace(/[/\\]/g, '_').replace(/^\.+/, '') || 'datei';

/** Slash-Befehle mit Kürzeln. */
export const COMMANDS = [
  { type: 'p', label: 'Text', icon: '¶', alias: ['absatz', 'p'] },
  { type: 'h2', label: 'Überschrift', icon: 'H', alias: ['h1', 'h2', 'titel'] },
  { type: 'h3', label: 'Zwischenüberschrift', icon: 'h', alias: ['h3', 'unter'] },
  { type: 'entry', label: 'Tagebucheintrag', icon: '✒', alias: ['eintrag', 'datum', 'log', 'tag'] },
  { type: 'quote', label: 'Zitat', icon: '❝', alias: ['notiz', 'quote'] },
  { type: 'li', label: 'Liste', icon: '•', alias: ['li', 'punkt', 'aufzahlung', '-'] },
  { type: 'hr', label: 'Trenner', icon: '❦', alias: ['hr', 'linie', '---'] },
  { type: 'image', label: 'Bild', icon: '🖼', alias: ['foto', 'img'] },
  { type: 'file', label: 'Datei', icon: '📎', alias: ['pdf', 'anhang'] }
];

const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** `/ein` → Tagebucheintrag: Teilstring im Namen oder Anfang eines Kürzels. */
export function filterCommands(query) {
  const q = plain(query.trim());
  return COMMANDS.filter((c) => plain(c.label).includes(q) || c.alias.some((a) => a.startsWith(q)));
}
