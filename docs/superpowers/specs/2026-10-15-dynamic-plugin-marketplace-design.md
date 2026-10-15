# Dynamischer Mailstack-Plugin-Marktplatz – Design

## Ziel

Nutzer sollen Mailstack MCP direkt aus Codex installieren können, ohne ein ZIP manuell herunterzuladen, und dieselbe MCP-Instanz in ChatGPT verbinden können. Jede Installation muss auf genau die Mailstack-Instanz zeigen, von der aus der Marketplace aufgerufen wurde. Marketplace und Pluginpaket sind öffentlich abrufbar; User-Tokens werden nur vom MCP-Server als Bearer-Authentifizierung verwendet.

Auf der Token-Verwaltungsseite ersetzt eine Anleitung mit zwei Wegen den bisherigen ZIP-Download:

1. MCP-Server direkt in Codex konfigurieren.
2. Den Marketplace der Mailstack-Instanz in Codex hinzufügen und das Plugin dort installieren.

`/marketplace.json` bleibt als lesbare, öffentliche JSON-Datei erreichbar. Die bestehende öffentliche ZIP-Route bleibt für bereits geteilte Links verfügbar, wird aber nicht mehr als Installationsweg in der Oberfläche angeboten.

## Ausgangslage

`src/web/plugin-package.ts` erzeugt bereits ein Pluginpaket mit der MCP-URL der aktuellen Anfrage. `src/web/routes.ts` leitet `/plugin.zip` derzeit durch die Management-Session-Prüfung. Die Token-Seite erklärt ZIP-Download und lokale Marketplace-Datei. Der README-Eintrag für direkte Codex-MCP-Konfiguration zeigt bereits die erforderliche `bearer_token_env_var`-Konfiguration.

Codex-Marktplätze beziehen Plugins aus lokalen, Git- oder npm-Quellen. Ein gehostetes JSON oder ZIP ist keine unterstützte Marketplace-Pluginquelle. Eine GitHub-Quelle kann außerdem nicht die individuelle URL jeder selbst gehosteten Instanz enthalten. Deshalb muss jede Instanz selbst einen Git-Endpunkt bereitstellen, der ihr dynamisch generiertes Pluginpaket als schreibgeschütztes Repository ausliefert.

## Architektur

### Öffentlicher Marketplace-Katalog

- `GET /marketplace.json` gibt ohne Anmeldung einen gültigen Marketplace-Katalog zurück.
- Der Katalog enthält genau ein Plugin und verweist als Git-Quelle auf `https://<Instanz>/marketplace.git`.
- Plugin-ID, Anzeigename und Beschreibung verwenden dieselben `PLUGIN_NAME`-Regeln wie das bestehende ZIP-Paket.
- Der JSON-Endpunkt enthält keine Zugangsdaten und keine kontobezogenen Daten.
- Der Endpunkt ist auch direkt im Browser abrufbar. Die Oberfläche verlinkt ihn zur Einsicht.

### Schreibgeschützter Git-Marktplatz

- `GET`- und `POST`-Anfragen unter `/marketplace.git/` bedienen den Git-Smart-HTTP-Lesezugriff, den Codex zum Klonen der Quelle benötigt.
- Das Repository wird anhand der validierten öffentlichen HTTPS-Origin der Anfrage erzeugt. Das darin enthaltene MCP-Manifest verwendet die zugehörige `/mcp`-Adresse.
- Das Repository enthält am Root das installierbare Pluginpaket sowie `.agents/plugins/marketplace.json`, damit derselbe Git-Root als Marketplace-Quelle verwendet werden kann.
- Unterstützt werden nur Leseoperationen. Pushes, `git-receive-pack` und beliebige Dateipfade sind nicht verfügbar.
- Generierte Repositorydaten liegen in einem privaten temporären Verzeichnis, nicht im Datenbankverzeichnis. Die Speicherung ist flüchtig; nach einem Containerneustart wird das Repository bei Bedarf neu erzeugt.
- Der Cache ist begrenzt und bereinigt alte Origins, damit frei gewählte Host-Header keine unbegrenzte Speicherung verursachen.
- Der Docker-Laufzeitcontainer enthält den benötigten Git-HTTP-Backend-Prozess. Die Anwendung führt ausschließlich die fest definierten Git-Backend-Aufrufe für den Marketplace-Endpunkt aus.

### Plugin-Authentifizierung

- Das Paket enthält die öffentliche MCP-URL, aber kein Token.
- Das Marketplace-Paket enthält eine `mcp.json` mit der öffentlichen MCP-URL und Bearer-API-Key-Authentifizierung. `policy.authentication` steht auf `ON_INSTALL`, damit Codex das User-Token bei der Plugin-Installation abfragt.
- ChatGPT wird über „Add custom MCP server“ mit derselben öffentlichen MCP-URL und dem User-Token als Bearer-API-Key verbunden. Benutzerdefinierte MCP-Apps hängen von ChatGPT-Plan und Workspace-Einstellungen ab.
- Für die direkte Codex-Konfiguration lautet der Variablenname `MAILSTACK_MCP_<PLUGINNAME>_TOKEN`; `<PLUGINNAME>` ist der normalisierte Pluginname in Großbuchstaben mit Unterstrichen (zum Beispiel `MAILSTACK_MCP_MAILSTACK_MCP_TOKEN`).
- Das statische Verwaltungstoken wird weder in Plugin-Dateien noch in Marketplace-Metadaten verwendet.
- Die serverseitige Token- und Tool-Berechtigungsprüfung bleibt unverändert.

### Token-Verwaltungsoberfläche

Die bisherige dreistufige ZIP-Anleitung wird durch zwei klar getrennte Konfigurationswege ersetzt:

- **ChatGPT oder Codex direkt verbinden:** zeigt die MCP-URL, erklärt ChatGPTs benutzerdefinierten MCP-Server und bietet die Codex-TOML-Konfiguration mit `bearer_token_env_var` als Alternative.
- **Marketplace in Codex verwenden:** verlinkt `/marketplace.json` zur Einsicht und zeigt den Befehl `codex plugin marketplace add https://<Instanz>/marketplace.git`. Die Installation des Plugins bindet den MCP-Server ein und fragt nach dem User-Token.

Der ZIP-Button und Hinweise auf manuelles Entpacken verschwinden aus der Oberfläche. `/plugin.zip` bleibt als öffentliche Kompatibilitätsroute bestehen.

## Fehlerverhalten und Sicherheitsgrenzen

- Marketplace-Endpunkte bleiben unabhängig von Management-Session und CSRF erreichbar.
- Die öffentlichen Antworten enthalten ausschließlich generierte Plugin-Metadaten und Plugin-Dateien.
- Nur HTTPS-Anfragen mit einem gültigen Host dürfen eine MCP-URL für das Paket erzeugen. Ungültige Host- oder Proxy-Informationen erhalten eine `400`-Antwort.
- Der Git-Backend-Prozess erhält ausschließlich die benötigten CGI-Variablen und den festen temporären Repository-Pfad. Benutzereingaben werden nicht als Shell-Befehl oder Dateisystempfad eingesetzt.
- Nicht unterstützte Git-Services und Push-Versuche werden abgelehnt.
- Fehler beim Erzeugen oder Lesen des Repositorys liefern einen generischen Serverfehler; keine Umgebungsvariablen, Tokens oder Prozessdetails werden an den Aufrufer zurückgegeben.
- Der Reverse-Proxy muss die HTTPS- und Host-Header korrekt weiterreichen sowie GET und POST für `/marketplace.git/` an den Dienst leiten.

## Dokumentation

README und Token-Verwaltungsoberfläche werden auf die zwei Installationswege aktualisiert. Die Betriebsanleitung beschreibt, dass `/marketplace.json` und `/marketplace.git/` öffentliche, schreibgeschützte Installationsendpunkte sind und dass der Reverse-Proxy beide Pfade ohne zusätzliche Authentifizierung durchleiten muss.

## Abnahmekriterien

- `/marketplace.json` ist ohne Management-Anmeldung erreichbar, valides JSON und verweist auf den Git-Marktplatz derselben HTTPS-Origin.
- Codex kann das Repository über Git Smart HTTP klonen und findet darin einen gültigen Marketplace-Katalog sowie das Pluginpaket.
- Das installierte MCP-Manifest enthält die URL der aufrufenden Mailstack-Instanz und die Bearer-API-Key-Authentifizierung, aber kein User- oder Verwaltungstoken.
- Git-Schreibzugriffe und andere Repositorypfade sind nicht verfügbar.
- `PLUGIN_NAME` mit gültigen und ungültigen Zeichenfolgen folgt weiterhin den bestehenden Slug- und Validierungsregeln.
- `/plugin.zip` bleibt erreichbar, erfordert aber keine Management-Anmeldung.
- Die Token-Seite erklärt ChatGPTs direkte MCP-Verbindung, direkte Codex-Konfiguration und Codex-Marketplace-Installation; der ZIP-Download wird dort nicht angeboten.
- README und Nginx-Hinweise beschreiben die öffentlichen Endpunkte und die erforderliche Proxy-Weiterleitung korrekt.

## Außerhalb des Umfangs

- Veröffentlichung im universellen Codex- oder ChatGPT-Plugin-Verzeichnis.
- Installation aus einer beliebigen HTTP-ZIP-URL oder direkt aus einer rohen JSON-Datei.
- Benutzerdefinierte Plugins oder mehrere Einträge pro Marketplace.
- Änderungen an MCP-Authentifizierung, Token-Berechtigungen oder Verwaltungssitzungen.
