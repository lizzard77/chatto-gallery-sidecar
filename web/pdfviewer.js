// PDF-Ansicht mit PDF.js: rendert die Seiten selbst auf Canvas, statt das PDF dem Browser zu
// überlassen. So öffnen sich Bögen überall gleich – auch im In-App-Tab einer PWA auf Android,
// der PDFs sonst nur herunterlädt. PDF.js liegt unter vendor/pdfjs/ (kommt im Docker-Build dazu).

const ZOOMS = [1, 1.5, 2, 3];
// Obergrenze pro Canvas: mobile Browser verweigern größere Flächen oder werden langsam
const MAX_CANVAS_PIXELS = 16_000_000;

let pdfjsPromise;
function loadPdfjs(base) {
  pdfjsPromise ??= import(`${base}vendor/pdfjs/pdf.min.mjs`).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${base}vendor/pdfjs/pdf.worker.min.mjs`;
    return pdfjs;
  });
  return pdfjsPromise;
}

/**
 * Zeigt das PDF unter `url` in `container`. `el` baut DOM-Knoten (wie in app.js).
 * Gibt eine Aufräumfunktion zurück (bricht Laden und Rendern ab, gibt Speicher frei).
 */
export function showPdf(container, { base, url, el }) {
  let destroyed = false;
  let doc = null;
  let loading = null;
  let zoomIndex = 0;
  const pages = [];

  const status = el('p', { class: 'empty' }, 'PDF wird geladen …');
  const zoomLabel = el('span', { class: 'zoom-label' }, '100 %');
  const zoomOut = el('button', { type: 'button', 'aria-label': 'Verkleinern', onclick: () => setZoom(zoomIndex - 1) }, '−');
  const zoomIn = el('button', { type: 'button', 'aria-label': 'Vergrößern', onclick: () => setZoom(zoomIndex + 1) }, '+');
  const pageCount = el('span', { class: 'page-count' });
  const toolbar = el('div', { class: 'pdf-toolbar' },
    el('a', { class: 'doc', href: url, download: '' }, '⬇', 'Herunterladen'),
    el('span', { class: 'spacer' }),
    pageCount,
    el('span', { class: 'zoom' }, zoomOut, zoomLabel, zoomIn));
  const scroller = el('div', { class: 'pdf-scroller' });
  const sheet = el('div', { class: 'pdf-pages' });
  scroller.append(sheet);
  container.replaceChildren(toolbar, status);

  // Seiten nur rendern, solange sie in der Nähe des sichtbaren Bereichs sind
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const page = pages[Number(entry.target.dataset.index)];
      page.visible = entry.isIntersecting;
      if (page.visible) renderPage(page);
      else releasePage(page);
    }
  }, { rootMargin: '100% 0px' });

  function setZoom(index) {
    zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, index));
    zoomLabel.textContent = `${Math.round(ZOOMS[zoomIndex] * 100)} %`;
    zoomOut.disabled = zoomIndex === 0;
    zoomIn.disabled = zoomIndex === ZOOMS.length - 1;
    sheet.style.width = `${ZOOMS[zoomIndex] * 100}%`;
    rerender();
  }

  let rerenderTimer;
  function rerender() {
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => {
      for (const page of pages) {
        page.renderedWidth = 0;
        if (page.visible) renderPage(page);
      }
    }, 150);
  }

  function releasePage(page) {
    page.task?.cancel();
    page.task = null;
    page.renderedWidth = 0;
    page.canvas.width = 0;
    page.canvas.height = 0;
  }

  async function renderPage(page) {
    const cssWidth = page.wrap.clientWidth;
    if (!cssWidth || page.renderedWidth === cssWidth || destroyed) return;
    page.task?.cancel();
    page.renderedWidth = cssWidth;
    const pdfPage = page.pdfPage ??= await doc.getPage(page.index + 1);
    if (destroyed) return;
    const base = pdfPage.getViewport({ scale: 1 });
    let scale = (cssWidth / base.width) * (window.devicePixelRatio || 1);
    const pixels = base.width * base.height * scale * scale;
    if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    const viewport = pdfPage.getViewport({ scale });
    // Erst in einen neuen Canvas rendern, dann tauschen: kein weißes Flackern beim Zoomen
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = pdfPage.render({ canvas, viewport });
    page.task = task;
    try {
      await task.promise;
    } catch {
      return; // abgebrochen (Zoom, weggescrollt, Ansicht verlassen)
    }
    if (page.task !== task) return;
    page.task = null;
    page.canvas.replaceWith(canvas);
    page.canvas = canvas;
  }

  const onResize = () => rerender();
  window.addEventListener('resize', onResize);

  (async () => {
    try {
      const pdfjs = await loadPdfjs(base);
      if (destroyed) return;
      const vendor = `${base}vendor/pdfjs/`;
      loading = pdfjs.getDocument({
        url,
        cMapUrl: `${vendor}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${vendor}standard_fonts/`,
        wasmUrl: `${vendor}wasm/`,
        iccUrl: `${vendor}iccs/`
      });
      doc = await loading.promise;
      if (destroyed) return;
      pageCount.textContent = doc.numPages === 1 ? '1 Seite' : `${doc.numPages} Seiten`;
      // Seitenformat der ersten Seite als Platzhalter, bis die Seite selbst geladen ist
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      for (let index = 0; index < doc.numPages; index++) {
        const canvas = document.createElement('canvas');
        const wrap = el('div', { class: 'pdf-page', 'data-index': String(index) }, canvas);
        wrap.style.aspectRatio = `${first.width} / ${first.height}`;
        const page = { index, wrap, canvas, task: null, pdfPage: null, renderedWidth: 0, visible: false };
        pages.push(page);
        sheet.append(wrap);
        doc.getPage(index + 1).then((p) => {
          const v = p.getViewport({ scale: 1 });
          wrap.style.aspectRatio = `${v.width} / ${v.height}`;
        }).catch(() => {});
      }
      status.replaceWith(scroller);
      setZoom(0);
      for (const page of pages) observer.observe(page.wrap);
    } catch (error) {
      if (destroyed) return;
      status.className = 'error';
      status.replaceChildren(`PDF konnte nicht angezeigt werden (${error?.message || error}). `,
        el('a', { href: url, download: '' }, 'Herunterladen'));
    }
  })();

  return () => {
    destroyed = true;
    clearTimeout(rerenderTimer);
    window.removeEventListener('resize', onResize);
    observer.disconnect();
    for (const page of pages) releasePage(page);
    loading?.destroy();
  };
}
