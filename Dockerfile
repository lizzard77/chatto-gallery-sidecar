# Galerie für Charakterbögen: nginx liefert Seite, Ordnerlisten (JSON) und Vorschaubilder

# PDF.js (Version in package.json) für die PDF-Ansicht
FROM node:22-alpine AS pdfjs
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && mkdir -p /out \
 && cd node_modules/pdfjs-dist \
 && cp build/pdf.min.mjs build/pdf.worker.min.mjs LICENSE /out/ \
 && cp -r cmaps standard_fonts wasm iccs /out/

FROM nginx:alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY web/ /usr/share/nginx/html/
COPY --from=pdfjs /out/ /usr/share/nginx/html/vendor/pdfjs/
# Dateien:       /srv/gallery (read-only mounten)
# Passwortdatei: /etc/nginx/auth/htpasswd (Pflicht, sonst startet nginx nicht)
EXPOSE 8080
