# Mailstack MCP

Mailstack MCP stellt eine Webverwaltung und einen MCP-Endpunkt für ein Dovecot-IMAP-Postfach bereit. Der Dienst läuft als einzelner Docker-Compose-Container. Nginx übernimmt den öffentlichen HTTPS-Zugang.

Die Verwaltung liegt unter `/manage`, der MCP-Endpunkt unter `/mcp`. Der optionale MCP-Mailversand wird aktiviert, wenn `SMTP_HOST` gesetzt ist. Der optionale E-Mail-Code für die Verwaltungsanmeldung benötigt zusätzlich `SMTP_SYSTEM_USER`, `SMTP_SYSTEM_PASSWORD` und `SMTP_SYSTEM_FROM`.

## Voraussetzungen

- Docker Engine mit Docker Compose v2
- Ein erreichbarer IMAP-Server mit TLS (hier für Dovecot vorgesehen)
- Nginx und ein gültiges öffentliches HTTPS-Zertifikat
- Ein privater Ordner für die SQLite-Datenbank und Backups

## Einrichten und starten

Im Projektverzeichnis die Beispielkonfiguration kopieren:

```sh
cp .env.example .env
```

Erzeugen Sie zwei voneinander unabhängige Geheimnisse. Der Verschlüsselungsschlüssel muss genau 32 zufällige Bytes enthalten und wird als Base64 gespeichert. Ein statisches Verwaltungstoken muss mindestens 32 Zeichen lang sein. Die folgenden Befehle geben die Werte im Terminal aus:

```sh
openssl rand -base64 32
openssl rand -base64 32
```

Tragen Sie den ersten Wert als `ENCRYPTION_KEY` und den zweiten als einziges Element der JSON-Liste `MCP_STATIC_TOKENS` in `.env` ein, zum Beispiel:

```dotenv
MCP_STATIC_TOKENS=["HIER_DAS_ZWEITE_GENERIERTE_TOKEN_EINTRAGEN"]
ENCRYPTION_KEY=HIER_DEN_ERSTEN_GENERIERTEN_BASE64_WERT_EINTRAGEN
```

Die Beispielwerte durch echte Ausgaben ersetzen. `.env` enthält Zugangsschlüssel und darf weder eingecheckt noch öffentlich lesbar sein. Alternativ kann `ENCRYPTION_KEY_FILE` einen bereits im Container erreichbaren Textdateipfad angeben. Die mitgelieferte Compose-Datei bindet dafür keinen Host-Pfad ein; bei dieser Variante muss der Schlüssel über eine eigene Compose-Erweiterung als schreibgeschützte Datei in den Container eingebunden werden. `ENCRYPTION_KEY` und `ENCRYPTION_KEY_FILE` dürfen nicht gleichzeitig gesetzt sein.

Setzen Sie mindestens `IMAP_HOST` auf den Hostnamen Ihres Dovecot-Servers. Für den üblichen IMAPS-Port 993 ist `IMAP_PORT=993` und `IMAP_TLS_MODE=implicit` passend. Für einen Dienst, der STARTTLS auf Port 143 erwartet, verwenden Sie `IMAP_PORT=143` und `IMAP_TLS_MODE=starttls`. Der Server prüft TLS-Zertifikate; Klartextverbindungen und das Abschalten der Zertifikatsprüfung sind nicht vorgesehen.

Standardmäßig speichert Compose die Daten im Verzeichnis `./data` und veröffentlicht den HTTP-Port nur auf `127.0.0.1:3000`. Für einen anderen Host-Port setzen Sie `APP_PORT`; für einen anderen Datenpfad setzen Sie `DATA_DIR`. Der Quellordner des Bind-Mounts muss vor dem Start existieren und für den Prozess `node` im Container beschreibbar sein. Im offiziellen Node-Container läuft `node` mit UID 1000. Ein Beispiel für ein neues Datenverzeichnis:

```sh
mkdir -p ./data
sudo chown 1000:1000 ./data
chmod 700 ./data
```

Schützen Sie den Ordner und seine Backups vor Zugriff durch andere Benutzer. Starten Sie anschließend:

```sh
docker compose up -d --build
docker compose logs -f mailstack-mcp
```

Der Container legt SQLite-Dateien nicht selbst an, wenn der Datenpfad fehlt oder nicht beschreibbar ist, sondern beendet den Start mit einer Fehlermeldung. Der Health-Endpunkt ist lokal unter `http://127.0.0.1:${APP_PORT:-3000}/health` erreichbar.

## Nginx als HTTPS-Reverse-Proxy

Leiten Sie `/mcp`, `/manage` und dessen statische Dateien an den Loopback-Port weiter. Die übermittelten Host- und Protokollinformationen werden für sichere Verwaltungssitzungen benötigt. Für den Streamable-HTTP-MCP-Verkehr sind deaktiviertes Buffering und großzügige Timeouts wichtig.

```nginx
server {
    listen 443 ssl http2;
    server_name mail-mcp.example.net;

    # ssl_certificate und ssl_certificate_key hier passend konfigurieren.

    location = /mcp {
        proxy_pass http://127.0.0.1:3000/mcp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location = /manage {
        proxy_pass http://127.0.0.1:3000/manage;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /manage/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ersetzen Sie `mail-mcp.example.net` durch Ihren Hostnamen und ergänzen Sie Ihre Zertifikatspfade. Der Compose-Port bleibt an Loopback gebunden; veröffentlichen Sie den Container-Port nicht zusätzlich direkt im Internet. Bei containerisiertem Nginx muss die Compose-Portbindung und das Netzwerk so angepasst werden, dass Nginx den Dienst intern erreicht, ohne den MCP-Server öffentlich freizugeben.

## IMAP und optionale SMTP-Konfiguration

Die folgenden Einstellungen sind in `.env.example` vorbereitet:

| Variable | Zweck | Standard |
| --- | --- | --- |
| `IMAP_HOST` | Hostname des IMAP-Servers; erforderlich | – |
| `IMAP_PORT` | IMAP-Port | `993` |
| `IMAP_TLS_MODE` | `implicit` für implizites TLS oder `starttls` | `implicit` |
| `MCP_STATIC_TOKENS` | JSON-Liste der Verwaltungstoken, jedes mindestens 32 Zeichen | erforderlich |
| `ENCRYPTION_KEY` | Base64-kodierter 32-Byte-Schlüssel | alternativ zu `ENCRYPTION_KEY_FILE` erforderlich |
| `ENCRYPTION_KEY_FILE` | Pfad zu einer Textdatei mit dem Base64-Schlüssel, im Container erreichbar | alternativ zu `ENCRYPTION_KEY` |
| `DATA_DIR` | Host-Verzeichnis für persistente SQLite-Daten | `./data` |
| `APP_PORT` | Nur auf Loopback veröffentlichter Host-Port | `3000` |
| `SMTP_HOST` | SMTP-/Submission-Host; aktiviert den Mailversand, wenn gesetzt | nicht gesetzt |
| `SMTP_PORT` | SMTP-Port | `465` bei `implicit`, `587` bei `starttls` |
| `SMTP_TLS_MODE` | `implicit` oder `starttls`; SMTP-TLS-Modus | `implicit` |
| `SMTP_SYSTEM_USER` | Benutzername für Verifizierungsmails bei der Verwaltungsanmeldung | nicht gesetzt |
| `SMTP_SYSTEM_PASSWORD` | Passwort für Verifizierungsmails; wird unverändert als SMTP-Passwort verwendet | nicht gesetzt |
| `SMTP_SYSTEM_FROM` | Absenderadresse der Verifizierungsmails | nicht gesetzt |
| `IMAP_SENT_FOLDER` | Optionaler exakter Name des Sent-Ordners | automatische Suche nach `\Sent` |

Wenn SMTP nicht benötigt wird, lassen Sie `SMTP_HOST` leer. Dann werden weder `send_email` noch dessen Berechtigung in der Verwaltung angeboten. Für SMTP mit implizitem TLS ist Port 465 üblich; für STARTTLS Port 587. `send_email` verwendet weiterhin die IMAP-Zugangsdaten des angemeldeten Kontos. Verifizierungsmails für den optionalen E-Mail-Code bei der Verwaltungsanmeldung werden nur versendet, wenn `SMTP_HOST` und alle drei `SMTP_SYSTEM_*`-Werte gesetzt sind. Ohne vollständige System-Mail-Konfiguration bleibt die bestehende Token- und IMAP-Anmeldung verfügbar. TLS-Zertifikate werden geprüft.

Vor dem Versand sucht der Dienst den vom Mailserver mit `\Sent` markierten Ordner. `IMAP_SENT_FOLDER` kann stattdessen einen exakten Ordnernamen angeben, der für die jeweiligen Nutzerkonten verfügbar sein muss. Ohne auflösbaren Sent-Ordner wird nicht gesendet.

## Schlüssel, Daten und Backups

Das IMAP-Passwort wird nach erfolgreicher Anmeldung mit AES-256-GCM verschlüsselt in SQLite gespeichert. Tokens und Sitzungskennungen werden nur als Hash gespeichert. Der Verschlüsselungsschlüssel liegt getrennt von der Datenbank und wird für jeden Neustart benötigt. Bewahren Sie ihn sicher und unabhängig von den SQLite-Backups auf. Geht er verloren oder wird er ersetzt, können die gespeicherten Passwörter nicht mehr entschlüsselt werden; stellen Sie dann den ursprünglichen Schlüssel aus dem geschützten Backup wieder her.

Stoppen Sie den Container vor einem konsistenten Dateikopier-Backup oder verwenden Sie ein SQLite-kompatibles Backup-Verfahren. Sichern Sie Datenbank und Verschlüsselungsschlüssel getrennt und schützen Sie beide Backups. Ein Beispiel für ein gestopptes Backup:

```sh
docker compose stop mailstack-mcp
cp -a ./data ./data-backup
docker compose start mailstack-mcp
```

Der Beispielbefehl setzt `DATA_DIR=./data` voraus. Wenn Sie in `.env` einen anderen `DATA_DIR` gesetzt haben, ersetzen Sie `./data` durch genau diesen Host-Pfad; Docker Compose exportiert Werte aus `.env` nicht in Ihre Shell.

## Anmeldung und User-Token

Öffnen Sie `https://mail-mcp.example.net/manage`. Für die Anmeldung werden beide Zugangsdaten benötigt:

1. Ein statisches Verwaltungstoken aus `MCP_STATIC_TOKENS`.
2. Der Benutzername und das Passwort des IMAP-Postfachs.

Der Dienst prüft das Postfach beim IMAP-Server und speichert nach erfolgreicher Anmeldung das Passwort verschlüsselt. Die statischen Tokens autorisieren ausschließlich den Zugang zur Verwaltung; sie sind keine MCP-Bearer-Tokens und gewähren für sich allein keinen Zugriff auf ein Postfach.

Nach der Anmeldung erstellen Sie unter **Zugriffstoken** ein benanntes User-Token. Der vollständige Wert wird nur einmal angezeigt. Kopieren Sie ihn sofort in die MCP-Client-Konfiguration und speichern Sie ihn wie ein Passwort. Verlorene Werte können nicht erneut angezeigt werden; erstellen Sie in diesem Fall ein neues Token und widerrufen Sie das alte. Für jedes Token können Sie einzelne Funktionen erlauben oder sperren. Ein Widerruf macht das Token unbrauchbar. Widerrufene Einträge lassen sich anschließend dauerhaft löschen.

Der MCP-Server stellt einen Streamable-HTTP-Endpunkt unter `https://mail-mcp.example.net/mcp` bereit. Der MCP-Client muss diesen Endpunkt mit dem erstellten User-Token als Bearer-Token aufrufen (`Authorization: Bearer <USER_TOKEN>`). Das statische Verwaltungstoken aus `MCP_STATIC_TOKENS` dient nur zur Anmeldung in der Verwaltungsoberfläche und gehört nicht in die MCP-Client-Konfiguration.

### Codex konfigurieren

Fügen Sie in `~/.codex/config.toml` folgenden Eintrag ein und ersetzen Sie die Beispiel-URL durch Ihre öffentliche HTTPS-Adresse:

```toml
[mcp_servers.mailstack]
url = "https://mail-mcp.example.net/mcp"
bearer_token_env_var = "MAILSTACK_MCP_TOKEN"
```

Setzen Sie `MAILSTACK_MCP_TOKEN` in der Umgebung, in der Codex gestartet wird, auf das zuvor erzeugte User-Token. Speichern Sie das Token nicht direkt in der TOML-Datei. Starten Sie Codex neu, damit die Konfiguration geladen wird. Weitere Informationen stehen in der [Codex MCP-Dokumentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) und der [Codex-Konfigurationsreferenz](https://learn.chatgpt.com/docs/config-file/config-reference).

Alternativ bietet die Token-Verwaltung nach der Anmeldung einen Download für ein installierbares Plugin der ChatGPT-Desktop-App und Codex. Das Paket enthält die beim Download verwendete HTTPS-Adresse, aber keine Zugangsdaten. Geben Sie beim Verbinden das User-Token ein und installieren Sie das Paket anhand der enthaltenen `INSTALL.md`-Anleitung über einen persönlichen Marketplace.

## Verfügbare MCP-Funktionen

Jedes User-Token erhält eigene Rechte. Nur freigegebene Tools werden für dieses Token angeboten und bei jedem Aufruf autorisiert.

- `list_mailboxes`, `create_mailbox`, `rename_mailbox`, `delete_mailbox`
- `list_messages`, `search_messages`, `read_message`, `get_attachment`
- `set_message_flags`, `copy_message`, `move_message`, `delete_message`, `expunge_messages`
- `send_email` nur bei konfiguriertem SMTP

Nachrichtenlisten sind seitenweise abrufbar und liefern bis zu 50 Ergebnisse je Aufruf. Suchanfragen scannen höchstens 100.000 UID-Werte rückwärts; grenzen Sie seltene Suchen bei Bedarf mit Absender, Betreff oder Datum ein. `read_message` begrenzt die gelesene Nachricht auf 2 MiB und Text- beziehungsweise HTML-Inhalt jeweils auf 100.000 Zeichen; die Antwort kennzeichnet gekürzte Inhalte. Anhänge werden beim Lesen nur als Metadaten ausgegeben und müssen mit `get_attachment` einzeln abgerufen werden. Ein einzelner Anhang ist dabei auf 1 MiB begrenzt. Mailbox-Auflistungen zeigen höchstens 500 Einträge.

`delete_message` verschiebt eine Nachricht in einen erkannten Papierkorb. Gibt es keinen erkannten Papierkorb, markiert der Dienst die Nachricht als gelöscht. `expunge_messages` ist eine separate, irreversible Aktion und entfernt im ausgewählten Ordner Nachrichten, die dort als gelöscht markiert sind. `delete_mailbox` löscht den ausgewählten Ordner samt Inhalt.

Bei `send_email` sind bis zu 100 Empfänger und 10 Anhänge erlaubt; Anhänge dürfen zusammen höchstens 5 MiB groß sein. Der Nachrichtentext ist auf 100.000 Zeichen je Text- beziehungsweise HTML-Feld begrenzt. Nach erfolgreicher Annahme durch SMTP legt der Dienst dieselben MIME-Daten einmal im Sent-Ordner ab. Der SMTP-Server kann einzelne Empfänger ablehnen und andere annehmen: In diesem Fall bleibt `sent: true`, und `rejectedRecipients` nennt die Anzahl der abgelehnten Empfänger. Prüfen Sie diese Zahl separat; `sent: true` bedeutet nicht, dass alle Empfänger angenommen wurden. Schlägt das Archivieren fehl, meldet das Tool außerdem `archived: false`. Senden Sie in beiden Fällen nicht automatisch erneut, da die Nachricht bereits an mindestens einen Empfänger versendet worden sein kann.

## Betrieb

```sh
docker compose ps
docker compose logs --tail=100 mailstack-mcp
docker compose restart mailstack-mcp
docker compose down
```

`docker compose down` entfernt den Container, nicht den über `DATA_DIR` eingebundenen Datenordner. Entfernen Sie diesen Ordner nur, wenn Sie die gespeicherten Konten und Tokens bewusst löschen möchten.
