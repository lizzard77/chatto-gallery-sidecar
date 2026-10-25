# Spielrunden: Node-Server (server/) liefert die Svelte-SPA (dist/), Galerie, Abenteuer-Seiten und Login über Chatto

# SPA bauen (Vite)
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src/ src/
COPY public/ public/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA=/data PORT=8080
# Zur Laufzeit nur pdfjs-dist (wird unter /vendor/pdfjs/ ausgeliefert)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force \
 && mkdir -p /data && chown node:node /data
COPY server/ server/
COPY --from=build /src/dist/ dist/
# Daten: /data (files/, wiki/, .secret) – beschreibbar für uid 1000
USER node
EXPOSE 8080
CMD ["node", "server/server.js"]
