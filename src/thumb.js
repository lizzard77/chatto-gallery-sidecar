/** Vorschaubild im Browser: längste Seite `size` px, WebP. null, wenn's nicht geht
 *  (kein Bild, oder Safari kann kein WebP erzeugen und liefert PNG). */
export async function makeThumb(file, size = 640) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    return blob?.type === 'image/webp' ? blob : null;
  } catch {
    return null;
  }
}
