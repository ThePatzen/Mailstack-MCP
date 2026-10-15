# Mailstack MCP

Mailstack MCP stellt eine Webverwaltung und einen MCP-Endpunkt für ein Dovecot-IMAP-Postfach bereit. Der Dienst läuft als einzelner Docker-Compose-Container. Nginx übernimmt den öffentlichen HTTPS-Zugang.

Die Verwaltungsoberfläche liegt unter `/`, der MCP-Endpunkt unter `/mcp`. Aufrufe des früheren Pfads `/manage` werden auf `/` umgeleitet. Der optionale MCP-Mailversand wird aktiviert, wenn `SMTP_HOST` gesetzt ist. Sind `SMTP_HOST` und alle drei `SMTP_SYSTEM_*`-Werte konfiguriert, ist E-Mail-Code die vorausgewählte Anmeldemethode; die Anmeldung mit Verwaltungstoken bleibt auswählbar.

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

Standardmäßig bindet Compose das Verzeichnis `./data` als Datenverzeichnis ein und veröffentlicht den HTTP-Port nur auf `127.0.0.1:3000`. Die SQLite-Datei liegt darin unter `database/mailstack.sqlite`; der Ordner `database` wird bei Bedarf angelegt. Für einen anderen Host-Port setzen Sie `APP_PORT`, für einen anderen Datenpfad `DATA_DIR`. Der Quellordner des Bind-Mounts muss vor dem Start existieren und für den Prozess `node` im Container beschreibbar sein. Im offiziellen Node-Container läuft `node` mit UID 1000. Ein Beispiel für ein neues Datenverzeichnis:

```sh
mkdir -p ./data
sudo chown 1000:1000 ./data
chmod 700 ./data
```

Schützen Sie den Ordner und seine Backups vor Zugriff durch andere Benutzer. Für einen lokalen Start aus dem Quellcode-Checkout bauen und starten Sie anschließend:

```sh
docker compose up -d --build
docker compose logs -f mailstack-mcp
```

Der Container legt SQLite-Dateien nicht selbst an, wenn der Datenpfad fehlt oder nicht beschreibbar ist, sondern beendet den Start mit einer Fehlermeldung. Der Health-Endpunkt ist lokal unter `http://127.0.0.1:${APP_PORT:-3000}/health` erreichbar.

## Nginx als HTTPS-Reverse-Proxy

Leiten Sie `/mcp` und alle übrigen Pfade, einschließlich `/` und der Verwaltungsassets, an den Loopback-Port weiter. Die übermittelten Host- und Protokollinformationen werden für sichere Verwaltungssitzungen benötigt. Für den Streamable-HTTP-MCP-Verkehr sind deaktiviertes Buffering und großzügige Timeouts wichtig.

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

    location / {
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
| `APP_TITLE` | Name in Seitentiteln, Kopfbereich und Anmeldecode-E-Mails | `Mailstack MCP` |
| `APP_LOGO_FILENAME` | Optionaler Bilddateiname in `DATA_DIR/image/`; PNG, JPEG, WebP, GIF oder ICO | nicht gesetzt (M-Symbol) |
| `PLUGIN_NAME` | Anzeigename des Codex-Marketplace-Plugins; die Paket-ID wird daraus erzeugt | `Mailstack MCP` |
| `APP_PORT` | Nur auf Loopback veröffentlichter Host-Port | `3000` |
| `SMTP_HOST` | SMTP-/Submission-Host; aktiviert den Mailversand, wenn gesetzt | nicht gesetzt |
| `SMTP_PORT` | SMTP-Port | `465` bei `implicit`, `587` bei `starttls` |
| `SMTP_TLS_MODE` | `implicit` oder `starttls`; SMTP-TLS-Modus | `implicit` |
| `SMTP_SYSTEM_USER` | Benutzername für Verifizierungsmails bei der Verwaltungsanmeldung | nicht gesetzt |
| `SMTP_SYSTEM_PASSWORD` | Passwort für Verifizierungsmails; umgebender Leerraum wird entfernt | nicht gesetzt |
| `SMTP_SYSTEM_FROM` | Absenderadresse der Verifizierungsmails | nicht gesetzt |
| `IMAP_SENT_FOLDER` | Optionaler exakter Name des Sent-Ordners | automatische Suche nach `\Sent` |

Wenn SMTP nicht benötigt wird, lassen Sie `SMTP_HOST` leer. Dann werden weder `send_email` noch dessen Berechtigung in der Verwaltung angeboten. Für SMTP mit implizitem TLS ist Port 465 üblich; für STARTTLS Port 587. `send_email` verwendet weiterhin die IMAP-Zugangsdaten des angemeldeten Kontos. Verifizierungsmails für den E-Mail-Code bei der Verwaltungsanmeldung werden nur versendet, wenn `SMTP_HOST` und alle drei `SMTP_SYSTEM_*`-Werte gesetzt sind. `SMTP_SYSTEM_USER`, `SMTP_SYSTEM_PASSWORD` und `SMTP_SYSTEM_FROM` dienen ausschließlich diesen Verifizierungsmails. Unvollständige System-Mail-Werte verhindern den Serverstart nicht und lassen die Anmeldung mit Verwaltungstoken verfügbar. TLS-Zertifikate werden geprüft.

Beim Versand mit `send_email` sucht der Dienst den vom Mailserver mit `\Sent` markierten Ordner. `IMAP_SENT_FOLDER` kann stattdessen einen exakten Ordnernamen angeben, der für die jeweiligen Nutzerkonten verfügbar sein muss. Ohne auflösbaren Sent-Ordner wird `send_email` nicht ausgeführt. Diese Suche und Archivierung betreffen ausschließlich `send_email`; Verifizierungsmails für die Verwaltungsanmeldung werden nicht im Sent-Ordner abgelegt.

## Schlüssel, Daten und Backups

Das IMAP-Passwort wird nach erfolgreicher Anmeldung mit AES-256-GCM verschlüsselt in SQLite gespeichert. Tokens und Sitzungskennungen werden nur als Hash gespeichert. Der Verschlüsselungsschlüssel liegt getrennt von der Datenbank und wird für jeden Neustart benötigt. Bewahren Sie ihn sicher und unabhängig von den SQLite-Backups auf. Geht er verloren oder wird er ersetzt, können die gespeicherten Passwörter nicht mehr entschlüsselt werden; stellen Sie dann den ursprünglichen Schlüssel aus dem geschützten Backup wieder her.

Die Datenbank liegt in `DATA_DIR/database/mailstack.sqlite`. Beim ersten Start mit dieser Version wird eine vorhandene `DATA_DIR/mailstack.sqlite` automatisch in den neuen Ordner verschoben. Existieren alter und neuer Datenbankpfad gleichzeitig, stoppt der Dienst, ohne eine der Dateien zu überschreiben; sichern und bereinigen Sie die Dateien dann manuell. Für ein eigenes Logo legen Sie eine Rasterbilddatei unter `DATA_DIR/image/` ab und setzen `APP_LOGO_FILENAME` nur auf den Dateinamen, zum Beispiel `logo.png`. Der Dienst liefert ausschließlich diese einzelne konfigurierte Datei aus.

Stoppen Sie den Container vor einem konsistenten Dateikopier-Backup oder verwenden Sie ein SQLite-kompatibles Backup-Verfahren. Sichern Sie Datenbank und Verschlüsselungsschlüssel getrennt und schützen Sie beide Backups. Ein Beispiel für ein gestopptes Backup:

```sh
docker compose stop mailstack-mcp
cp -a ./data ./data-backup
docker compose start mailstack-mcp
```

Der Beispielbefehl setzt `DATA_DIR=./data` voraus. Wenn Sie in `.env` einen anderen `DATA_DIR` gesetzt haben, ersetzen Sie `./data` durch genau diesen Host-Pfad; Docker Compose exportiert Werte aus `.env` nicht in Ihre Shell.

## Anmeldung und User-Token

Öffnen Sie `https://mail-mcp.example.net/`. Vorhandene Links auf `/manage` werden auf `/` umgeleitet. Durch die Änderung des Cookie-Pfads müssen Sie sich nach dem Update einmal neu anmelden. Wenn SMTP und alle `SMTP_SYSTEM_*`-Werte vollständig gesetzt sind, ist **E-Mail-Code** vorausgewählt. Sie können stattdessen **Verwaltungstoken** auswählen. Ohne vollständige System-Mail-Konfiguration steht nur der Verwaltungstoken-Weg zur Verfügung.

Bei E-Mail-Code geben Sie den IMAP-Benutzernamen und das IMAP-Passwort ein. Der Dienst prüft zuerst die Zugangsdaten beim IMAP-Server und sendet dann einen einmalig verwendbaren sechsstelligen Code an die E-Mail-Adresse dieses Benutzernamens. Der Code ist zehn Minuten gültig; nach fünf falschen Eingaben muss die Anmeldung neu begonnen werden. Für einen neuen Code starten Sie den Vorgang erneut und geben die IMAP-Zugangsdaten noch einmal ein; dadurch wird der vorherige Code ungültig. Diese Anmeldemethode setzt voraus, dass der IMAP-Benutzername selbst eine erreichbare E-Mail-Adresse ist. Verwenden Sie bei kurzen IMAP-Benutzernamen ohne zustellbare Adresse die Anmeldung mit Verwaltungstoken.

Bei Verwaltungstoken geben Sie ein statisches Verwaltungstoken aus `MCP_STATIC_TOKENS` sowie den IMAP-Benutzernamen und das IMAP-Passwort ein. Auch dieser Weg prüft das Postfach beim IMAP-Server. Nach erfolgreicher Anmeldung wird das Passwort verschlüsselt gespeichert. Die statischen Tokens autorisieren ausschließlich den Zugang zur Verwaltung; sie sind keine MCP-Bearer-Tokens und gewähren für sich allein keinen Zugriff auf ein Postfach.

Anmeldeversuche werden pro IP-Adresse und normalisiertem Benutzernamen begrenzt: höchstens 30 Versuche je IP-Adresse und 8 je Konto innerhalb von 15 Minuten. Die Zähler liegen im Arbeitsspeicher des Prozesses und werden bei einem Neustart zurückgesetzt; bei mehreren Dienstinstanzen werden sie nicht gemeinsam genutzt. Die Anwendung vertraut genau einem Reverse-Proxy-Hop. Konfigurieren Sie den Proxy so, dass die tatsächliche Client-IP am Ende von `X-Forwarded-For` steht (wie im Nginx-Beispiel), und verlassen Sie sich nicht auf einen vom Client gelieferten Wert. Abgelaufene E-Mail-Code-Anfragen werden beim Erstellen einer neuen Anfrage opportunistisch aus SQLite entfernt.

Nach der Anmeldung erstellen Sie unter **Zugriffstoken** ein benanntes User-Token und schalten die gewünschten Funktionen frei. Der vollständige Wert wird nur einmal angezeigt. Für direkte MCP-Konfigurationen benötigen Sie diesen Wert als Bearer-Token. Beim OAuth-Login wählen Sie das User-Token im Zustimmungsdialog; der Server stellt dafür ein kurzlebiges OAuth-Token aus. Beide Zugriffswege verwenden dieselben User-Token-Berechtigungen. Ein Widerruf des User-Tokens beendet alle davon abhängigen OAuth-Verbindungen. Einzelne OAuth-Verbindungen können Sie ebenfalls in der Token-Verwaltung widerrufen. Widerrufene User-Token-Einträge lassen sich dauerhaft löschen.

Der MCP-Server stellt einen Streamable-HTTP-Endpunkt unter `https://mail-mcp.example.net/mcp` bereit. Er unterstützt OAuth Authorization Code mit PKCE und weiterhin direkte User-Token als Bearer-Token (`Authorization: Bearer <USER_TOKEN>`). Das statische Verwaltungstoken aus `MCP_STATIC_TOKENS` dient nur zur Anmeldung in der Verwaltungsoberfläche und kann nicht für MCP-Aufrufe verwendet werden.

### Codex konfigurieren

Für die native Plugin-Installation mit OAuth verwenden Sie den Abschnitt [Marketplace-Plugin in Codex installieren](#marketplace-plugin-in-codex-installieren). Die folgende Konfiguration verbindet den MCP-Server direkt mit einem User-Token.

Fügen Sie in `~/.codex/config.toml` folgenden Eintrag ein und ersetzen Sie die Beispiel-URL durch Ihre öffentliche HTTPS-Adresse:

```toml
[mcp_servers.mailstack-mcp]
url = "https://mail-mcp.example.net/mcp"
bearer_token_env_var = "MAILSTACK_MCP_MAILSTACK_MCP_TOKEN"
```

Setzen Sie `MAILSTACK_MCP_MAILSTACK_MCP_TOKEN` in der Umgebung, in der Codex gestartet wird, auf das zuvor erzeugte User-Token. Der Variablenname wird aus `PLUGIN_NAME` gebildet: `MAILSTACK_MCP_` plus Pluginname als Großbuchstaben mit Unterstrichen plus `_TOKEN`. Für den Standardnamen `Mailstack MCP` lautet er daher `MAILSTACK_MCP_MAILSTACK_MCP_TOKEN`. Speichern Sie das Token nicht direkt in der TOML-Datei. Starten Sie Codex neu, damit die Konfiguration geladen wird. Weitere Informationen stehen in der [Codex MCP-Dokumentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) und der [Codex-Konfigurationsreferenz](https://learn.chatgpt.com/docs/config-file/config-reference).

### ChatGPT verbinden

In ChatGPT öffnen Sie **Einstellungen → Apps → Erstellen** und fügen einen benutzerdefinierten MCP-Server hinzu. Verwenden Sie `https://mail-mcp.example.net/mcp` und wählen Sie OAuth. Melden Sie sich im Mailstack-Fenster an und wählen Sie ein aktives User-Token sowie die gewünschten Funktionen aus. Scannen Sie die Tools und erstellen Sie die App. Die Verfügbarkeit benutzerdefinierter MCP-Apps hängt vom ChatGPT-Plan und den Workspace-Einstellungen ab. Details stehen in der [ChatGPT-MCP-Dokumentation](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt).

### Marketplace-Plugin in Codex installieren

Fügen Sie den dynamisch erzeugten Marketplace Ihrer Instanz in Codex hinzu:

```sh
codex plugin marketplace add https://mail-mcp.example.net/marketplace.git
```

Öffnen Sie anschließend in Codex `/plugins` und installieren Sie das Mailstack-Plugin aus diesem Marketplace. Der Marketplace-Katalog ist öffentlich unter `https://mail-mcp.example.net/marketplace.json` einsehbar. Git-Zugriff und Katalog enthalten nur das für diese Instanz erzeugte Plugin samt MCP-Adresse, kein User-Token und kein Verwaltungstoken. Beim Verbinden startet OAuth: Melden Sie sich mit Ihrem Mailstack-Konto an und wählen Sie ein aktives User-Token sowie die gewünschten Funktionen. Der Server stellt ein kurzlebiges OAuth-Token aus und prüft bei jedem MCP-Aufruf weiterhin die aktuellen Rechte des gewählten User-Tokens.

Falls Ihr MCP-Client OAuth nicht unterstützt, können Sie den MCP-Server direkt mit einer Umgebungsvariable registrieren. Der Name wird aus `PLUGIN_NAME` gebildet: `MAILSTACK_MCP_` plus Pluginname als Großbuchstaben mit Unterstrichen plus `_TOKEN`. Für `Mailstack MCP` lautet er `MAILSTACK_MCP_MAILSTACK_MCP_TOKEN`:

```sh
codex mcp add mailstack-mcp --url https://mail-mcp.example.net/mcp --bearer-token-env-var MAILSTACK_MCP_MAILSTACK_MCP_TOKEN
```

Wenn Sie die Variable nach dem Start von Codex setzen, starten Sie Codex neu. Geben Sie das Token nicht im Chat oder als Befehlszeilenargument ein.

Der Reverse-Proxy muss `/marketplace.json`, `/marketplace.git/` sowie die OAuth-Metadaten unter `/.well-known/` und `/oauth/` ohne zusätzliche Authentifizierung an die Anwendung weiterleiten. OAuth erfordert eine von außen erreichbare HTTPS-Adresse; die Proxy-Header für Protokoll und Host müssen korrekt gesetzt sein. Die Instanz unterstützt öffentliche OAuth-Clients über Dynamic Client Registration (DCR); CIMD und private Client-Secrets werden nicht verwendet. Ungenutzte Client-Registrierungen ohne Grants können nach 180 Tagen entfernt werden; abgelaufene Grant-Einträge bleiben 90 Tage für die Verwaltung sichtbar. Der Nginx-Beispielproxy oben leitet bereits alle Pfade unter `/` weiter. `/plugin.zip` bleibt als öffentliche Kompatibilitätsadresse für bereits verteilte Links verfügbar; die Verwaltungsoberfläche bietet keinen ZIP-Download mehr an.

`APP_TITLE` passt den Namen der Verwaltungsoberfläche und der Anmeldecode-E-Mails an. Für ein Logo setzen Sie `APP_LOGO_FILENAME` auf einen Dateinamen im Unterordner `image` des Datenverzeichnisses; ohne Logo bleibt das Standardzeichen sichtbar. `PLUGIN_NAME` legt den Anzeigenamen des Plugins fest. Der Paketordner und die Plugin-ID werden daraus als kleingeschriebener ASCII-Name mit Bindestrichen abgeleitet.

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

Bei abgelehnten OAuth-Clientregistrierungen enthält das Container-Log ein `oauth_client_registration_rejected`-Ereignis mit HTTP-Status, OAuth-Fehlercode und sicherer Fehlerkategorie. Bei einer Ablehnung von `grant_types` protokolliert es zusätzlich bis zu acht bekannte OAuth-Grant-Namen; unbekannte Werte erscheinen als `<other>`. Andere Client-Metadaten und Redirect-URIs werden nicht protokolliert.

`docker compose down` entfernt den Container, nicht den über `DATA_DIR` eingebundenen Datenordner. Entfernen Sie diesen Ordner nur, wenn Sie die gespeicherten Konten und Tokens bewusst löschen möchten.

## Versionen und Docker Hub

Die Anwendungs-Version steht in `package.json` und `package-lock.json`. Verwenden Sie Versionsnummern nach `MAJOR.MINOR.PATCH`, zum Beispiel `0.1.1` für eine Fehlerkorrektur oder `0.2.0` für eine neue Funktion. Vor `1.0.0` kennzeichnet die Versionsnummer noch den Entwicklungsstand.

Der GitHub-Actions-Workflow `.github/workflows/publish-dockerhub.yml` veröffentlicht bei jedem Tag im Format `vX.Y.Z` automatisch ein Image auf Docker Hub. Er prüft, ob die Tag-Version mit `package.json` übereinstimmt, und veröffentlicht beide Tags `X.Y.Z` und `latest`.

Richten Sie einmalig Folgendes ein:

1. Das Docker-Hub-Repository [`thepatzen/mailstack-mcp`](https://hub.docker.com/repository/docker/thepatzen/mailstack-mcp) ist das Ziel der Veröffentlichung.
2. Erstellen Sie in Docker Hub einen Access Token mit Schreibrechten.
3. Legen Sie im GitHub-Repository unter **Settings → Secrets and variables → Actions** das Secret `DOCKERHUB_TOKEN` mit diesem Access Token an.

Für ein Release committen Sie zuerst die Änderungen, die in die Version gehören. Aktualisieren Sie danach Version und Lockfile mit einem der folgenden Befehle:

```sh
npm version patch   # Fehlerkorrektur, z. B. 0.1.0 → 0.1.1
npm version minor   # neue Funktion, z. B. 0.1.0 → 0.2.0
npm version major   # inkompatible Änderung, z. B. 0.1.0 → 1.0.0
```

`npm version` erstellt einen Commit und den passenden Git-Tag, zum Beispiel `v0.1.1`. Pushen Sie Commit und Tag:

```sh
git push origin main --follow-tags
```

Der Workflow baut und veröffentlicht anschließend `thepatzen/mailstack-mcp:0.1.1` und `thepatzen/mailstack-mcp:latest` im öffentlichen [Docker-Hub-Repository](https://hub.docker.com/repository/docker/thepatzen/mailstack-mcp). Für die Installation und Updates über Docker Hub ersetzen Sie in `compose.yaml` `build: .` durch das gewünschte Image. Der Service-Eintrag sieht dann zum Beispiel so aus:

```yaml
services:
  mailstack-mcp:
    image: thepatzen/mailstack-mcp:0.1.1
```

Verwenden Sie für reproduzierbare Deployments einen festen Versionstag. Der Tag `latest` wird bei jedem erfolgreichen Release auf das neue Image gesetzt; ein laufender Container wechselt erst nach einem Pull und Neustart. Ein Docker-Hub-Login ist für das öffentliche Image nicht erforderlich. `.env` und das persistente Datenverzeichnis bleiben separat auf Ihrem Server.

### Erstinstallation

Richten Sie `.env` und das Datenverzeichnis wie oben beschrieben ein. Nachdem `compose.yaml` auf das Docker-Hub-Image umgestellt ist, laden Sie das Image und starten den Dienst:

```sh
docker compose pull mailstack-mcp
docker compose up -d mailstack-mcp
docker compose logs -f mailstack-mcp
```

### Update auf eine neue Version

Ändern Sie zuerst in `compose.yaml` den Image-Tag auf die neue Version, zum Beispiel `thepatzen/mailstack-mcp:0.1.2`. Bei Verwendung von `latest` ist diese Änderung nicht nötig. Laden Sie das neue Image, solange die bisherige Version noch läuft. Bei der Standardkonfiguration liegt das Datenverzeichnis unter `./data`; stoppen Sie den Dienst anschließend kurz, um eine konsistente Dateikopie zu sichern:

```sh
docker compose pull mailstack-mcp
docker compose stop mailstack-mcp
tar -czf "mailstack-data-backup-$(date +%F-%H%M%S).tar.gz" ./data
```

Starten Sie den Dienst danach mit dem neuen Image:

```sh
docker compose up -d mailstack-mcp
docker compose logs --tail=100 mailstack-mcp
```

Bei einem abweichenden `DATA_DIR` sichern Sie statt `./data` den dort eingestellten Host-Pfad. Das Datenverzeichnis nicht löschen: Es enthält die SQLite-Datenbank mit Konten und Tokens und bleibt beim Austausch des Containers erhalten.
