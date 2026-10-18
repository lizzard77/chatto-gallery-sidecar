# Galerie für Charakterbögen: nginx liefert Seite, Ordnerlisten (JSON) und Vorschaubilder
FROM nginx:alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY web/ /usr/share/nginx/html/
# Dateien:       /srv/gallery (read-only mounten)
# Passwortdatei: /etc/nginx/auth/htpasswd (Pflicht, sonst startet nginx nicht)
EXPOSE 8080
