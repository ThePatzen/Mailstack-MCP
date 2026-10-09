# IMAP MCP Server – Design

## Ziel und Rahmen

Der Server läuft als Docker-Compose-Anwendung auf dem Mailserver des Betreibers. Nginx übernimmt den öffentlichen HTTPS-Zugang. Der Dienst verbindet sich mit einem per Umgebungsvariablen konfigurierten Dovecot-IMAP-Server. Nutzer melden sich in einer Weboberfläche mit ihren IMAP-Zugangsdaten an und erhalten eigene, widerrufbare MCP-Tokens. Optional kann derselbe Mailserver oder ein separat konfigurierter Submission-Dienst für SMTP verwendet werden.

Die erste Version bietet gängige IMAP-Basisfunktionen und SMTP-Versand nur bei aktivierter SMTP-Konfiguration. Sie beansprucht keine vollständige Abdeckung sämtlicher IMAP-Erweiterungen.

## Vorgeschlagener Stack und Betrieb

- TypeScript und Node.js; das MCP-SDK stellt Streamable HTTP bereit, ImapFlow übernimmt IMAP und Nodemailer optional SMTP.
- SQLite als anwendungsinterner Speicher für eine einzelne Compose-Instanz.
- Docker Compose startet den Dienst und bindet einen konfigurierbaren Host-Pfad als Datenverzeichnis ein, zum Beispiel `${DATA_DIR:-./data}:/app/data`.
- MCP ist unter `/mcp`, die Verwaltung unter `/manage` erreichbar. Der Container-Port wird nicht öffentlich freigegeben. Läuft Nginx auf dem Host, darf Compose ihn ausschließlich an Loopback binden; bei containerisiertem Nginx erfolgt die Verbindung über ein internes Docker-Netzwerk.
- TLS-Zertifikate des IMAP- und SMTP-Servers werden geprüft. Unsichere Klartextverbindungen und deaktivierte Zertifikatsprüfung sind nicht vorgesehen.

## Konfiguration

Erforderlich sind `IMAP_HOST`, optional `IMAP_PORT` (Standard 993) und ein TLS-Modus (implizites TLS oder STARTTLS). Eine statische Liste von Verwaltungs-Tokens wird über `MCP_STATIC_TOKENS` konfiguriert. `DATA_DIR` bestimmt den Host-Pfad des Bind-Mounts. Ein zufälliger Verschlüsselungsschlüssel wird über ein Docker-Secret oder eine Umgebungsvariable bereitgestellt.

SMTP wird ausschließlich aktiviert, wenn `SMTP_HOST` gesetzt ist. `SMTP_PORT` und der TLS-Modus werden separat konfiguriert; für die Authentifizierung werden die beim Nutzer gespeicherten IMAP-Zugangsdaten verwendet. `IMAP_SENT_FOLDER` kann den vom Server mit `\Sent` ausgezeichneten Ordner überschreiben.

Der Verschlüsselungsschlüssel muss außerhalb des Datenverzeichnisses gesichert werden. Ohne ihn können gespeicherte IMAP-Passwörter nach einem Verlust nicht entschlüsselt werden.

## Anmeldung und Tokenverwaltung

1. Die Verwaltungsoberfläche verlangt einen gültigen statischen Token.
2. Der Nutzer meldet sich mit IMAP-Benutzername und Passwort an. Der Server prüft die Zugangsdaten durch eine TLS-gesicherte Verbindung zum konfigurierten IMAP-Server.
3. Nach erfolgreicher Anmeldung kann der Nutzer Tokens für genau dieses IMAP-Konto verwalten. Die IMAP-Zugangsdaten werden verschlüsselt gespeichert, damit spätere Tool-Aufrufe sich gegenüber IMAP und optional SMTP authentifizieren können.
4. Ein neu erzeugtes User-Token besteht aus zufälligem, ausreichend langem Material. Das vollständige Token wird einmal angezeigt und danach nur gehasht gespeichert. Es kann jederzeit widerrufen werden.
5. Für jedes User-Token lassen sich einzelne Tools freigeben oder sperren. In der UI sind Token-Metadaten, Erstellungszeit und Rechte einsehbar; das Geheimnis wird nicht erneut ausgegeben.

Der statische Token schützt die Verwaltung, identifiziert aber keinen Postfachnutzer und gewährt selbst keinen Postfachzugriff. MCP-Aufrufe authentifizieren sich mit dem jeweiligen User-Token als Bearer-Token. Die Zuordnung zum IMAP-Konto und die Tool-Rechte werden serverseitig aufgelöst.

Webanmeldungen werden begrenzt. Verwaltungssitzungen nach erfolgreicher IMAP-Prüfung verwenden kurzlebige, sichere, HttpOnly- und SameSite-Cookies; zustandsändernde UI-Aktionen sind gegen CSRF geschützt. Zugangsdaten und vollständige Nachrichtentexte werden nicht protokolliert.

## MCP- und Mailfunktionen

Jede Funktion wird als eigenes typisiertes MCP-Tool angeboten. `tools/list` zeigt nur Tools, die dem User-Token gestattet sind; der Server prüft die Berechtigung zusätzlich bei jedem Tool-Aufruf.

Die IMAP-Basis-Tools umfassen:

- Mailboxen auflisten, anlegen, umbenennen und löschen.
- Nachrichten auflisten, suchen und lesen; Header, Textteile und Anhänge können gezielt abgerufen werden.
- Übliche Nachrichten-Flags (gelesen/ungelesen und markiert) setzen oder entfernen.
- Nachrichten kopieren und verschieben.
- Nachrichten löschen; wenn ein `\Trash`-Ordner erkannt wird, wird dorthin verschoben. Endgültiges Entfernen/Expunge ist ein eigenes, explizit berechtigbares Tool.

Es gibt kein frei ausführbares IMAP-Kommando-Tool. Nicht unterstützte Operationen oder Serverfehler werden verständlich zurückgegeben. Jede Aktion verwendet eine eigene IMAP-Verbindung, damit Sitzungszustand nicht zwischen Nutzerkonten geteilt wird.

Wenn SMTP aktiviert ist, wird zusätzlich `send_email` registriert. Das Tool akzeptiert Empfänger, Betreff, Text- oder HTML-Inhalt und optionale Anhänge. Als Absenderadresse wird standardmäßig der IMAP-Benutzername verwendet. Das Tool besitzt ein eigenes Recht pro User-Token.

Vor dem SMTP-Versand wird der `\Sent`-Ordner über IMAP-SPECIAL-USE gesucht; `IMAP_SENT_FOLDER` kann ihn explizit festlegen. Nach SMTP-Annahme wird dieselbe MIME-Nachricht mit IMAP APPEND dort abgelegt. Ist vor dem Versand kein Sent-Ordner auflösbar, wird der Versand abgelehnt. Scheitert APPEND nach erfolgreichem SMTP-Versand, meldet das Tool eindeutig „versendet, aber nicht archiviert“ und sendet nicht erneut.

## Datenfluss und Fehlerbehandlung

Für jeden MCP-Aufruf prüft der Server Bearer-Token, Widerrufsstatus und Tool-Recht. Danach entschlüsselt er nur die Zugangsdaten des zugeordneten Kontos, öffnet eine neue TLS-gesicherte Verbindung, führt die Operation aus und schließt die Verbindung.

Fehler werden mindestens als Authentifizierungsfehler, fehlende Berechtigung, ungültige Eingabe, nicht verfügbare Funktion oder vorübergehender IMAP/SMTP-Fehler unterschieden. Teilfehler beim Senden und Archivieren werden als solche dargestellt. Geheimnisse und Nachrichteninhalte erscheinen nicht in Logs.

## Offizielle technische Referenzen

- [MCP TypeScript SDK: Server und Streamable HTTP](https://ts.sdk.modelcontextprotocol.io/server)
- [ImapFlow Dokumentation](https://imapflow.com/docs/)
- [Nodemailer Dokumentation](https://nodemailer.com/)
- [Dovecot IMAP SPECIAL-USE-Konfiguration](https://doc.dovecot.org/latest/core/config/namespaces/)
