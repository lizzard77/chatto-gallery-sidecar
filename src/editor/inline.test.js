// node --test src/editor/inline.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, linkTarget, toggleMark, linkMarkdown, linkAction } from './inline.js';

// Kurzform: md-Teile als „|…|", fett als B(…), kursiv als I(…), Link als L(…)
const show = (text) => parseInline(text).map((p) => {
  if (p.md) return `|${p.text}|`;
  let t = p.text;
  if (p.i) t = `I(${t})`;
  if (p.b) t = `B(${t})`;
  if (p.link) t = `L(${t})`;
  return t;
}).join('');

test('Text bleibt exakt erhalten', () => {
  for (const t of ['', 'abc', '**a** *b* ***c***', '[x](Mira/Bogen.pdf) und **[y](#/a)**', '* a *', '2*3*4', '[a](javascript:x)', 'a\n*b*'])
    assert.equal(parseInline(t).map((p) => p.text).join(''), t);
});

test('fett, kursiv, beides', () => {
  assert.equal(show('ein *aufrecht* Mann'), 'ein |*|I(aufrecht)|*| Mann');
  assert.equal(show('**fett** und ***beides***'), '|**|B(fett)|**| und |***|B(I(beides))|***|');
  assert.equal(show('**fett *und kursiv* text**'), '|**|B(fett )|*|B(I(und kursiv))|*|B( text)|**|');
  assert.equal(show('**A** x **b**'), '|**|B(A)|**| x |**|B(b)|**|');
  assert.equal(show('**a *b***'), '|**|B(a )|*|B(I(b))|*||**|');
});

test('keine Formatierung bei Leerraum am Rand, Zeilenumbruch oder ohne Ende', () => {
  assert.equal(show('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(show('** a**'), '** a**');
  assert.equal(show('*a\nb*'), '*a\nb*');
  assert.equal(show('**offen'), '**offen');
  assert.equal(show('****'), '****');
});

test('Links', () => {
  assert.equal(show('siehe [Bogen](Mira/Bogen.pdf).'), 'siehe |[|L(Bogen)|](Mira/Bogen.pdf)|.');
  assert.equal(show('[**fett**](https://x.de)'), '|[||**|L(B(fett))|**||](https://x.de)|');
  assert.equal(show('[Foto](Bilder/Foto (2).jpg)'), '|[|L(Foto)|](Bilder/Foto (2).jpg)|');
  assert.equal(show('[böse](javascript:alert(1))'), '[böse](javascript:alert(1))');
  assert.equal(show('[hoch](../geheim)'), '[hoch](../geheim)');
  const [, label] = parseInline('[x](.wiki/3/foto.jpg)');
  assert.deepEqual(label.link, { ziel: '.wiki/3/foto.jpg', art: 'datei' });
});

test('linkTarget und linkAction', () => {
  assert.equal(linkTarget('https://example.org/a?b').art, 'extern');
  assert.equal(linkTarget('#/London%201888/wiki/3').art, 'intern');
  assert.equal(linkTarget('Mira/Bogen 1.pdf').art, 'datei');
  for (const z of ['javascript:alert(1)', 'data:text/html,x', '/etc/passwd', 'a//b', 'a/./b', '..', 'a\\b', 'mailto:x@y'])
    assert.equal(linkTarget(z), null, z);
  assert.equal(linkAction(linkTarget('Mira/Bogen.PDF')), 'pdf');
  assert.equal(linkAction(linkTarget('.wiki/3/foto.jpg')), 'bild');
  assert.equal(linkAction(linkTarget('notiz.txt')), 'tab');
  assert.equal(linkAction(linkTarget('https://x.de/a.pdf')), 'tab');
  assert.equal(linkAction(linkTarget('#/x/')), 'intern');
});

test('toggleMark umschließt und entfernt', () => {
  assert.deepEqual(toggleMark('ein Wort hier', 4, 8, '**'), { text: 'ein **Wort** hier', start: 6, end: 10 });
  assert.deepEqual(toggleMark('ein **Wort** hier', 6, 10, '**'), { text: 'ein Wort hier', start: 4, end: 8 });
  assert.deepEqual(toggleMark('ein Wort hier', 4, 9, '*'), { text: 'ein *Wort* hier', start: 5, end: 9 }); // Leerzeichen bleibt draußen
  assert.deepEqual(toggleMark('ein *Wort* hier', 5, 9, '*'), { text: 'ein Wort hier', start: 4, end: 8 });
  // kursiv in fett und zurück
  assert.deepEqual(toggleMark('**Wort**', 2, 6, '*'), { text: '***Wort***', start: 3, end: 7 });
  assert.deepEqual(toggleMark('***Wort***', 3, 7, '**'), { text: '*Wort*', start: 1, end: 5 });
  assert.deepEqual(toggleMark('***Wort***', 3, 7, '*'), { text: '**Wort**', start: 2, end: 6 });
  // fett auf kursiven Text
  assert.deepEqual(toggleMark('*Wort*', 1, 5, '**'), { text: '***Wort***', start: 3, end: 7 });
  // Auswahl mit Sternen
  assert.deepEqual(toggleMark('a **Wort** b', 2, 10, '**'), { text: 'a Wort b', start: 2, end: 6 });
  assert.deepEqual(toggleMark('a **Wort** b', 2, 10, '*'), { text: 'a ***Wort*** b', start: 5, end: 9 });
  assert.deepEqual(toggleMark('  ', 0, 2, '**'), { text: '  ', start: 0, end: 2 });
});

test('linkMarkdown', () => {
  assert.equal(linkMarkdown('Bogen [alt]', 'Mira/Bogen.pdf'), '[Bogen alt](Mira/Bogen.pdf)');
});

test('F/K mit einseitig markierten Sternen entfernt statt zu verdoppeln', () => {
  assert.equal(toggleMark('x *kursiv* y', 2, 9, '*').text, 'x kursiv y');
  assert.equal(toggleMark('**fett**', 0, 6, '**').text, 'fett');
});
