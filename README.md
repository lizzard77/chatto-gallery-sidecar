# chatto-gallery-sidecar

Kleine Galerie für Charakterbögen neben [Chatto](https://github.com/lizzard77/chatto): pro Charakter
ein Ordner mit PDF(s) und Bildern. Spieler öffnen sie als Seitenleisten-Link in einem eigenen Tab,
gewürfelt und geredet wird weiter in Chatto.

- Startseite: ein Kärtchen pro Ordner (z. B. Kampagne → Charakter) (Titelbild = `portrait.*`/`cover.*`/`titel.*`, sonst das erste Bild).
- Ordner: PDFs als Buttons (öffnen im PDF-Viewer des Browsers), Bilder als Raster mit Lightbox
  (Pfeiltasten, Wischen), Unterordner als Kärtchen.
- Direktlinks per Hash, z. B. `https://files.he1.lizzard77.dev/#/Mira/` – praktisch als Link pro Spieler.
- Neue Dateien erscheinen ohne Neustart; beim Zurückwechseln in den Tab lädt die Seite die Liste neu.
- Farben nach dem Nachtgold-Schema, hell/dunkel nach Systemeinstellung.

## Aufbau

Nur nginx (`nginx:alpine`) und eine statische Seite, keine Datenbank, kein Build-Schritt:

| Pfad | |
|---|---|
| `/` | die Seite (`web/`) |
| `/files/<pfad>/` | Ordnerliste als JSON (`autoindex_format json`), Dateien direkt |
| `/thumb/<pfad>` | verkleinertes Bild (640 px, `image_filter`), 30 Tage zwischengespeichert |

Alles liegt hinter HTTP Basic Auth (ein gemeinsames Login für alle Spieler). Ohne Passwortdatei
startet nginx nicht – die Galerie ist also nie aus Versehen offen.

## Betrieb

Image: `ghcr.io/lizzard77/chatto-gallery-sidecar:latest` (GitHub Action bei Push auf `main`).

```yaml
services:
  gallery:
    image: ghcr.io/lizzard77/chatto-gallery-sidecar:latest
    volumes:
      - /data/gallery/files:/srv/gallery:ro       # Ordner pro Charakter
      - /data/gallery/auth:/etc/nginx/auth:ro     # htpasswd
    # Port 8080
```

Passwortdatei anlegen bzw. Passwort ändern (Benutzer `spieler`):

```sh
printf 'spieler:%s\n' "$(openssl passwd -apr1 'geheim')" > /data/gallery/auth/htpasswd
```

Dateien hochladen: `scp`/`rsync` nach `/data/gallery/files/<Charakter>/`. Dateien und Ordner müssen für
nginx lesbar sein (`644`/`755`). Versteckte Dateien (`.xyz`) werden nicht angezeigt.

Deployment auf he1: `selfhosted-services/he1/gallery/`.

## Lokale Vorschau

Ohne Docker, mit einem Ordner Beispieldaten:

```sh
node dev/serve.mjs ~/irgendwo/galerie 8090   # http://localhost:8090/
```

`dev/serve.mjs` bildet die JSON-Ordnerliste von nginx nach; Vorschaubilder sind dort die Originale.
