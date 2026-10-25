# chatto-gallery-sidecar

„Spielrunden“: Karte, Abenteuer-Wiki und Galerie für Charakterbögen neben
[Chatto](https://github.com/lizzard77/chatto). Spieler öffnen es als Seitenleisten-Link in einem
eigenen Tab, gewürfelt und geredet wird weiter in Chatto. Angemeldet wird über das Chatto-Konto.

- **Spiele**: jeder Ordner unter `files/` ist ein Spiel mit eigener Karte, eigenen Abenteuern und
  eigenen Dateien. Die Startseite (`#/`) zeigt alle Spiele als Kacheln.
- **Karte** (`#/<Spiel>/`): Kartenbild mit optionaler SVG-Beschriftung darüber und nummerierten
  Siegel-Pins, je einer pro Abenteuer. Pins setzen und verschieben direkt auf der Karte; darunter
  ein Verzeichnis aller Abenteuer (auch solche ohne Ort). Kartenbild und Beschriftung lädt man über
  „Karte …“ hoch.
- **Abenteuer-Seite** (`#/<Spiel>/wiki/<nr>`): Papierbogen mit Block-Editor (Text, Überschriften,
  Tagebucheinträge, Zitate, Listen, Trenner, Bilder, Dateien; `/` für Befehle; `**fett**`,
  `*kursiv*`, `[Text](Datei)`). Speichert von selbst; hat jemand anders inzwischen geändert, gibt es
  einen Hinweis statt stillem Überschreiben.
- **Dateien** (`#/<Spiel>/dateien/<pfad>/`): pro Charakter ein Ordner mit PDF(s) und Bildern.
  Ordnerkärtchen mit Titelbild (`portrait.*`/`cover.*`/`titel.*`, sonst das erste Bild), Bilder mit
  Lightbox (Pfeiltasten, Wischen), Hochladen per Knopf oder Drag & Drop.
- PDFs zeigt die Seite selbst an (PDF.js) – auch im In-App-Tab einer Android-PWA, der PDFs sonst nur
  herunterlädt. Direktlink: `#/<Spiel>/dateien/Ordner/Datei.pdf`. Alte Links (`#/galerie/…`,
  `#/<Spiel>/Mira/`) leiten weiter.
- Neue Dateien erscheinen ohne Neustart; beim Zurückwechseln in den Tab lädt die Seite neu.

## Aufbau

Ein Node-Prozess (`server/server.js`, nur Standardbibliothek) und eine Svelte-5-Seite (Vite, `src/`).
Keine Datenbank: alles zu einem Spiel liegt in seinem Ordner, Abenteuer sind JSON-Dateien.

```
$DATA/files/<Spiel>/…                                Dateien (per scp/rsync oder Hochladen)
$DATA/files/<Spiel>/.karte/karte.(jpg|jpeg|png|webp) Kartenbild (genau eins)
$DATA/files/<Spiel>/.karte/overlay.svg               Beschriftung über der Karte (optional, gleiches Seitenverhältnis)
$DATA/files/<Spiel>/.karte/vorschau.webp             Kartenvorschau für die Startseite (erzeugt der Browser)
$DATA/files/<Spiel>/.wiki/<nr>.json                  Abenteuer-Seite zu Pin <nr>
$DATA/files/<Spiel>/.wiki/<nr>/<datei>               Bilder und Dateien dieser Seite
$DATA/files/<ordner>/.thumbs/<name>.webp             Vorschaubild (erzeugt der Browser beim Hochladen)
$DATA/.secret                                        Schlüssel für die Sitzungs-Cookies (beim ersten Start erzeugt)
```

Eine Seite ist `{ nr, title, x, y, blocks, updated, updatedBy }`; `x`, `y` sind Anteile (0…1) der
Kartenbreite/-höhe oder beide `null` (Abenteuer ohne Ort).

| Pfad | |
|---|---|
| `/`, `/assets/`, `/fonts/` | die Seite (`dist/`, öffentlich) |
| `/vendor/pdfjs/` | PDF.js aus `node_modules/pdfjs-dist` (öffentlich) |
| `/oauth/login`, `/oauth/callback`, `/oauth/logout`, `/oauth/client.json` | Login über Chatto |
| `GET /api/me` | angemeldeter Nutzer `{ id, login, name }` |
| `GET /api/spiele` | alle Spiele `[{ name, karte, overlay, vorschau, abenteuer }]` (URLs mit `?v=<mtime>` oder `null`, Anzahl Abenteuer) |
| `GET /api/spiele/<Spiel>` | ein Spiel wie oben |
| `GET`, `POST /api/spiele/<Spiel>/pages` | alle Pins `[{ nr, title, x, y }]` / neues Abenteuer `{ title, x, y }` |
| `GET`, `PUT`, `DELETE /api/spiele/<Spiel>/pages/<nr>` | eine Seite; `PUT` mit altem `updated`, sonst 409; `DELETE` löscht auch ihre Dateien |
| `PUT /api/spiele/<Spiel>/pages/<nr>/pos` | Pin verschieben `{ x, y }` |
| `GET /files/<pfad>/` | Ordnerliste als JSON (`[{ name, type, mtime, size }]`, wie nginx `autoindex_format json`) |
| `GET`, `PUT /files/<Spiel>/<pfad>/<name>` | Datei (mit Range) / hochladen (roher Body, max. 100 MB, 409 falls vorhanden) |
| `PUT /files/<Spiel>/.karte/<name>` | Kartenbild `karte.*`, `overlay.svg`, `vorschau.webp` (überschreibt; neues `karte.*` ersetzt die anderen) |
| `DELETE /files/<Spiel>/.karte/overlay.svg` | Beschriftung entfernen |
| `PUT /files/<Spiel>/.wiki/<nr>/<name>` | Bild/Datei einer Abenteuer-Seite (Seite muss existieren, 409 falls vorhanden) |
| `GET /thumb/<pfad>` | Vorschaubild aus `.thumbs/`, sonst das Original (30 Tage Cache) |

`<Spiel>` ist URL-kodiert und muss ein Ordner direkt unter `files/` sein, sonst 404. Alles außer
Seite, PDF.js und `/oauth/` braucht eine Sitzung, sonst 401 – die Seite leitet dann selbst zum
Login. Versteckte Dateien (`.xyz`) werden weder gelistet noch ausgeliefert; einzige Ausnahmen sind
`.karte/` und `.wiki/` direkt im Spiel-Ordner (lesen; schreiben nur wie oben) und `.thumbs/` (nur
hochladen). Andere `PUT`s darunter geben 403.

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
`https://files.he1.lizzard77.dev/#/London%201888/` für die Karte eines Spiels oder
`…/#/London%201888/dateien/Mira/` für einen Charakter) als Link im Space eintragen. Beim ersten Öffnen
geht es einmal über die Chatto-Zustimmung, danach direkt auf die Seite.

## Betrieb

Image: `ghcr.io/lizzard77/chatto-gallery-sidecar:latest` (GitHub Action bei Push auf `main`).

```yaml
services:
  gallery:
    image: ghcr.io/lizzard77/chatto-gallery-sidecar:latest
    volumes:
      - /data/gallery:/data                  # files/, .secret – beschreibbar für uid 1000
    environment:
      CHATTO_URL: https://chat.he1.lizzard77.dev
      PUBLIC_URL: https://files.he1.lizzard77.dev
    # Port 8080
```

Ohne `CHATTO_URL` und `PUBLIC_URL` startet der Server nicht. Der Container läuft als `node`
(uid 1000), dem müssen die Daten gehören. Dateien per `scp`/`rsync` nach
`/data/gallery/files/<Spiel>/<Charakter>/` oder über „Hochladen“ unter Dateien. Ein neues Spiel ist
einfach ein neuer Ordner unter `files/`; Karte und Abenteuer liegen darin in `.karte/` und `.wiki/`
(beim Kopieren mit `rsync -a` kommen die versteckten Ordner mit). `.secret` löschen meldet alle ab.

Deployment auf he1: `selfhosted-services/he1/gallery/`.

## Lokale Vorschau

```sh
npm install
mkdir -p dev/data/files/Testspiel                            # Beispieldaten (gitignored)
DEV_USER=Phil DATA=./dev/data PORT=8090 node server/server.js   # API auf :8090
npm run dev                                                  # http://localhost:5173/
```

`DEV_USER=<Name>` meldet jeden Request ohne Login als diesen Nutzer an – nur lokal benutzen. Oder wie
in Produktion: `npm run build`, dann den Server starten und http://localhost:8090/ öffnen.

Echter Login gegen ein lokales Chatto (http://localhost:4400): statt `DEV_USER`
`CHATTO_URL=http://localhost:4400 PUBLIC_URL=http://localhost:8090` setzen und die gebaute Seite
auf :8090 öffnen.
