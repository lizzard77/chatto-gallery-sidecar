# chatto-gallery-sidecar

„Spielrunden“: Karte, Abenteuer-Wiki und Galerie für Charakterbögen neben
[Chatto](https://github.com/lizzard77/chatto). Spieler öffnen es als Seitenleisten-Link in einem
eigenen Tab, gewürfelt und geredet wird weiter in Chatto. Angemeldet wird über das Chatto-Konto.

- **Karte** (Startseite): London 1888 mit nummerierten Siegel-Pins, je einer pro Abenteuer. Pins
  setzen und verschieben direkt auf der Karte; darunter eine kurze Liste aller Abenteuer.
- **Abenteuer-Seite** (`#/wiki/<nr>`): Papierbogen mit Block-Editor (Text, Überschriften,
  Tagebucheinträge, Zitate, Listen, Trenner, Bilder, Dateien; `/` für Befehle). Speichert von
  selbst; hat jemand anders inzwischen geändert, gibt es einen Hinweis statt stillem Überschreiben.
- **Galerie** (`#/galerie/<pfad>/`): pro Charakter ein Ordner mit PDF(s) und Bildern. Ordnerkärtchen
  mit Titelbild (`portrait.*`/`cover.*`/`titel.*`, sonst das erste Bild), Bilder mit Lightbox
  (Pfeiltasten, Wischen), Hochladen per Knopf oder Drag & Drop.
- PDFs zeigt die Seite selbst an (PDF.js) – auch im In-App-Tab einer Android-PWA, der PDFs sonst nur
  herunterlädt. Direktlink: `#/galerie/Ordner/Datei.pdf`. Alte Links (`#/Mira/`) leiten weiter.
- Neue Dateien erscheinen ohne Neustart; beim Zurückwechseln in den Tab lädt die Seite neu.

## Aufbau

Ein Node-Prozess (`server/server.js`, nur Standardbibliothek) und eine Svelte-5-Seite (Vite, `src/`).
Keine Datenbank: Abenteuer sind JSON-Dateien, Galerie-Dateien liegen einfach im Ordner.

```
$DATA/files/<Kampagne>/<Charakter>/…      Galerie (per scp/rsync oder Hochladen)
$DATA/files/<ordner>/.thumbs/<name>.webp   Vorschaubild (erzeugt der Browser beim Hochladen)
$DATA/wiki/<nr>.json                       Abenteuer-Seite zu Pin <nr>
$DATA/wiki/<nr>/<datei>                    Bilder und Dateien dieser Seite
$DATA/.secret                              Schlüssel für die Sitzungs-Cookies (beim ersten Start erzeugt)
```

| Pfad | |
|---|---|
| `/`, `/assets/`, `/map/`, `/fonts/` | die Seite (`dist/`, öffentlich) |
| `/vendor/pdfjs/` | PDF.js aus `node_modules/pdfjs-dist` (öffentlich) |
| `/oauth/login`, `/oauth/callback`, `/oauth/logout`, `/oauth/client.json` | Login über Chatto |
| `GET /api/me` | angemeldeter Nutzer `{ id, login, name }` |
| `GET /api/pages`, `POST /api/pages` | alle Pins `[{ nr, title, x, y }]` / neues Abenteuer `{ title, x, y }` |
| `GET`, `PUT`, `DELETE /api/pages/<nr>` | eine Seite; `PUT` mit altem `updated`, sonst 409 |
| `PUT /api/pages/<nr>/pos` | Pin verschieben `{ x, y }` |
| `GET /files/<pfad>/` | Ordnerliste als JSON (`[{ name, type, mtime, size }]`, wie nginx `autoindex_format json`) |
| `GET`, `PUT /files/<pfad>/<name>` | Datei (mit Range) / hochladen (roher Body, max. 100 MB, 409 falls vorhanden) |
| `GET /thumb/<pfad>` | Vorschaubild aus `.thumbs/`, sonst das Original (30 Tage Cache) |
| `GET`, `PUT /wiki/<nr>/<name>` | Bilder und Dateien einer Abenteuer-Seite |

Alles außer Seite, PDF.js und `/oauth/` braucht eine Sitzung, sonst 401 – die Seite leitet dann
selbst zum Login. Versteckte Dateien (`.xyz`) werden weder gelistet noch ausgeliefert.

## Login über Chatto

Chatto ist der OAuth-Server (Authorization Code + PKCE), Spielrunden ein öffentlicher Client. Eine
Registrierung in Chatto braucht es nicht: die `client_id` ist die URL des eigenen
Client-Metadaten-Dokuments (`<PUBLIC_URL>/oauth/client.json`), das Chatto selbst abruft. Deshalb muss
`PUBLIC_URL` für Chatto per HTTPS erreichbar sein (lokal geht auch `http://localhost`).

1. `/oauth/login` leitet zu Chatto; wer dort angemeldet ist, bestätigt beim ersten Mal einmalig,
   danach geht es ohne Klick zurück.
2. `/oauth/callback` tauscht den Code gegen Token + Nutzer (`id`, `login`, `displayName`), gibt das
   Token sofort wieder frei und setzt ein signiertes Cookie (30 Tage).
3. Jeder Chatto-Nutzer darf alles – die Spielrunde sind vertraute Leute.

Seitenleisten-Link in Chatto: einfach `https://files.he1.lizzard77.dev/` (oder ein Direktlink wie
`https://files.he1.lizzard77.dev/#/galerie/Mira/`) als Link im Space eintragen. Beim ersten Öffnen
geht es einmal über die Chatto-Zustimmung, danach direkt auf die Seite.

## Betrieb

Image: `ghcr.io/lizzard77/chatto-gallery-sidecar:latest` (GitHub Action bei Push auf `main`).

```yaml
services:
  gallery:
    image: ghcr.io/lizzard77/chatto-gallery-sidecar:latest
    volumes:
      - /data/gallery:/data                  # files/, wiki/, .secret – beschreibbar für uid 1000
    environment:
      CHATTO_URL: https://chat.he1.lizzard77.dev
      PUBLIC_URL: https://files.he1.lizzard77.dev
    # Port 8080
```

Ohne `CHATTO_URL` und `PUBLIC_URL` startet der Server nicht. Der Container läuft als `node`
(uid 1000), dem müssen die Daten gehören. Dateien per `scp`/`rsync` nach
`/data/gallery/files/<Kampagne>/<Charakter>/` oder über „Hochladen“ in der Galerie. `.secret`
löschen meldet alle ab.

Deployment auf he1: `selfhosted-services/he1/gallery/`.

## Lokale Vorschau

```sh
npm install
mkdir -p dev/data/files/Test                                 # Beispieldaten (gitignored)
DEV_USER=Phil DATA=./dev/data PORT=8090 node server/server.js   # API auf :8090
npm run dev                                                  # http://localhost:5173/
```

`DEV_USER=<Name>` meldet jeden Request ohne Login als diesen Nutzer an – nur lokal benutzen. Oder wie
in Produktion: `npm run build`, dann den Server starten und http://localhost:8090/ öffnen.

Echter Login gegen ein lokales Chatto (http://localhost:4400): statt `DEV_USER`
`CHATTO_URL=http://localhost:4400 PUBLIC_URL=http://localhost:8090` setzen und die gebaute Seite
auf :8090 öffnen.
