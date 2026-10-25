// Cursor-Helfer für contenteditable-Blöcke (reiner Text, Zeilenumbrüche als "\n" im Textknoten).

/** Text eines Blocks; ein <br>, das manche Browser einfügen, zählt als Zeilenumbruch. */
export function readText(el) {
  return el.querySelector('br, div') ? el.innerText.replace(/\n$/, '') : el.textContent;
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
