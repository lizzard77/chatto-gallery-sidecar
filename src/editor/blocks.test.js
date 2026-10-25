// node --test src/editor/blocks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBlock, mergeBack, moveBlock, numbered, safeName, filterCommands, withIds, stripIds } from './blocks.js';

const plainBlocks = (blocks) => blocks.map(({ id, ...b }) => b);

test('Enter teilt den Block, Rest wird Absatz bzw. Listenpunkt', () => {
  const blocks = withIds([{ type: 'h2', text: 'Hallo Welt' }, { type: 'li', text: 'ab' }]);
  assert.equal(splitBlock(blocks, 0, 5), 1);
  assert.deepEqual(plainBlocks(blocks).slice(0, 2), [{ type: 'h2', text: 'Hallo' }, { type: 'p', text: ' Welt' }]);
  assert.equal(splitBlock(blocks, 2, 2), 3);
  assert.deepEqual(plainBlocks(blocks)[3], { type: 'li', text: '' });
  // Enter auf leerem Listenpunkt beendet die Liste
  assert.equal(splitBlock(blocks, 3, 0), 3);
  assert.equal(blocks[3].type, 'p');
  assert.equal(blocks.length, 4);
  assert.equal(new Set(blocks.map((b) => b.id)).size, 4);
});

test('Backspace verschmilzt oder wandelt um', () => {
  const blocks = withIds([{ type: 'p', text: 'Eins' }, { type: 'p', text: 'Zwei' }, { type: 'quote', text: '' }]);
  assert.deepEqual(mergeBack(blocks, 2), { index: 2, offset: 0 });
  assert.equal(blocks[2].type, 'p');
  assert.deepEqual(mergeBack(blocks, 1), { index: 0, offset: 4 });
  assert.deepEqual(plainBlocks(blocks), [{ type: 'p', text: 'EinsZwei' }, { type: 'p', text: '' }]);
  assert.equal(mergeBack(blocks, 0), null);
  const withHr = withIds([{ type: 'p', text: 'a' }, { type: 'hr' }, { type: 'p', text: 'b' }]);
  assert.deepEqual(mergeBack(withHr, 2), { index: 1, offset: 0 });
  assert.deepEqual(plainBlocks(withHr), [{ type: 'p', text: 'a' }, { type: 'p', text: 'b' }]);
  const withImg = withIds([{ type: 'image', file: 'x.jpg', text: '' }, { type: 'p', text: 'b' }, { type: 'p', text: '' }]);
  assert.equal(mergeBack(withImg, 1), null);
  assert.deepEqual(mergeBack(withImg, 2), { index: 1, offset: 1 });
  // leerer Absatz nach Bild verschwindet, Cursor ans Ende der Bildunterschrift
  const afterImg = withIds([{ type: 'image', file: 'x.jpg', text: '' }, { type: 'p', text: '' }]);
  assert.deepEqual(mergeBack(afterImg, 1), { index: 0, offset: -1 });
  assert.equal(afterImg.length, 1);
});

test('Verschieben, Namen, Befehle, Speichern', () => {
  const blocks = withIds([{ type: 'p', text: 'a' }, { type: 'hr' }]);
  assert.equal(moveBlock(blocks, 0, -1), 0);
  assert.equal(moveBlock(blocks, 0, 1), 1);
  assert.deepEqual(stripIds(blocks), [{ type: 'hr' }, { type: 'p', text: 'a' }]);
  assert.equal(numbered('karte.jpg', 1), 'karte.jpg');
  assert.equal(numbered('karte.jpg', 3), 'karte-3.jpg');
  assert.equal(numbered('README', 2), 'README-2');
  assert.equal(safeName('../.x/y.png'), '_.x_y.png');
  assert.deepEqual(filterCommands('ein').map((c) => c.type), ['entry']);
  assert.ok(filterCommands('uber').some((c) => c.type === 'h2'));
  assert.equal(filterCommands('').length, 10);
  assert.deepEqual(filterCommands('link').map((c) => c.type), ['link']);
  assert.equal(withIds([]).map((b) => b.type).join(), 'entry,p');
});
