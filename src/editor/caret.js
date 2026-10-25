// Cursor-Helfer für contenteditable-Blöcke (reiner Text, Zeilenumbrüche als "\n" im Textknoten).
import { parseInline } from './inline.js';

/** Text eines Blocks; ein <br>, das manche Browser einfügen, zählt als Zeilenumbruch (nicht unser eigenes am Ende, s. renderInline). */
export function readText(el) {
  const extra = el.querySelectorAll('br, div');
  const own = extra.length === 1 && extra[0] === el.lastChild && el.textContent.endsWith('\n');
  return extra.length && !own ? el.innerText.replace(/\n$/, '') : el.textContent;
}

/** Cursor-Position als Zeichen-Offset im Block (Anfang der Auswahl). */
export function caretOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return 0;
  const range = sel.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

/** Cursor an Offset setzen (-1 = Ende) und Block fokussieren. */
export function setCaret(el, offset = 0) {
  el.focus();
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = offset < 0 ? Infinity : offset;
  let node, last = null;
  while ((node = walker.nextNode())) {
    last = node;
    if (left <= node.length) break;
    left -= node.length;
  }
  if (!last) range.setStart(el, offset < 0 ? el.childNodes.length : 0);
  else range.setStart(last, Math.min(left, last.length));
  range.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Steht der Cursor in der ersten (dir < 0) bzw. letzten (dir > 0) Zeile des Blocks? */
export function atEdgeLine(el, dir) {
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed || !el.contains(sel.anchorNode)) return false;
  const offset = caretOffset(el);
  if (dir < 0 ? offset === 0 : offset === el.textContent.length) return true;
  // sonst: liegt das Cursor-Rechteck in der ersten/letzten Zeile?
  const rect = sel.getRangeAt(0).getClientRects()[0];
  if (!rect) return false;
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return dir < 0
    ? rect.top - box.top - parseFloat(style.paddingTop) < rect.height / 2
    : box.bottom - parseFloat(style.paddingBottom) - rect.bottom < rect.height / 2;
}

/** Zeichen-Offset von (node, off) im Block. */
export function offsetIn(el, node, off) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(node, off);
  return r.toString().length;
}

/** Auswahl im Block als Zeichen-Offsets { start, end, anchor, focus } oder null, wenn sie nicht (ganz) im Block liegt. */
export function selectionOffsets(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return null;
  const anchor = offsetIn(el, sel.anchorNode, sel.anchorOffset);
  const focus = offsetIn(el, sel.focusNode, sel.focusOffset);
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), anchor, focus };
}

/** Zeichen-Offset im Block an Bildschirmposition (x, y) oder null */
export function offsetAtPoint(el, x, y) {
  const pos = document.caretPositionFromPoint?.(x, y);
  const [node, off] = pos ? [pos.offsetNode, pos.offset] : [document.caretRangeFromPoint?.(x, y)?.startContainer];
  if (!node || !el.contains(node)) return null;
  return offsetIn(el, node, pos ? off : document.caretRangeFromPoint(x, y).startOffset);
}

/** Textknoten + Offset zu Zeichen-Offset (an Grenzen: Ende des vorderen Knotens). */
function pointAt(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, last = null;
  while ((node = walker.nextNode())) {
    last = node;
    if (offset <= node.length) return [node, offset];
    offset -= node.length;
  }
  return last ? [last, last.length] : [el, 0];
}

/** Auswahl von `anchor` bis `focus` (Zeichen-Offsets) setzen, ohne den Fokus zu ändern. */
export function selectOffsets(el, anchor, focus = anchor) {
  getSelection().setBaseAndExtent(...pointAt(el, anchor), ...pointAt(el, focus));
}

/**
 * Block-Inhalt aus dem Text neu aufbauen: Markierungszeichen in <span class="md">, fett/kursiv in <strong>/<em>,
 * Links als <a class="md-link">. textContent bleibt exakt `text`. Auswahl bleibt (als Offsets) erhalten.
 * Ist der Inhalt schon so aufgebaut, bleibt das DOM unangetastet (dann funktioniert auch Strg+Z des Browsers weiter).
 * `href(link)` macht aus { ziel, art } die URL.
 */
export function renderInline(el, text, href) {
  const box = el.cloneNode(false);
  for (const p of parseInline(text)) {
    let node = document.createTextNode(p.text);
    const wrap = (tag, cls) => {
      const w = document.createElement(tag);
      if (cls) w.className = cls;
      w.append(node);
      node = w;
    };
    if (p.md) wrap('span', 'md');
    else {
      if (p.i) wrap('em');
      if (p.b) wrap('strong');
      if (p.link) {
        wrap('a', 'md-link');
        node.href = href(p.link);
        if (p.link.art === 'extern') Object.assign(node, { target: '_blank', rel: 'noopener' });
      }
    }
    box.append(node);
  }
  // Zeilenumbruch am Ende: ein <br> des Browsers (Firefox) bleibt, sonst stünde der Cursor in der Zeile davor.
  // Chrome schreibt stattdessen ein zweites "\n" in den Text.
  if (text.endsWith('\n') && el.lastChild?.nodeName === 'BR') box.append(document.createElement('br'));
  if (box.isEqualNode(el)) return false;
  const sel = selectionOffsets(el);
  el.replaceChildren(...box.childNodes);
  if (sel) selectOffsets(el, sel.anchor, sel.focus);
  return true;
}
