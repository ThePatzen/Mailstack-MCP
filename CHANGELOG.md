# Changelog

## [0.1.4] - 2026-10-15

### Added
- OAuth-Anmeldung für MCP mit PKCE; Nutzer wählen ein bestehendes User-Token und dessen erlaubte Funktionen.
- OAuth-Verbindungen lassen sich einzeln in der Token-Verwaltung widerrufen.

### Changed
- Das Codex-Plugin nutzt OAuth. Direkte Bearer-Token-Konfiguration bleibt als Alternative verfügbar.

## [0.1.3] - 2026-10-15

### Added
- Einrichtungsanleitung für ChatGPT und Codex; die Codex-Token-Umgebungsvariable wird aus `PLUGIN_NAME` abgeleitet.

### Fixed
- Das Marketplace-Plugin bündelt wieder die MCP-Konfiguration und fordert das User-Token bei der Installation an.

## [0.1.2] - 2026-10-15

### Added
- Öffentlicher, instanzspezifischer Codex Marketplace mit schreibgeschütztem Git-Zugriff und einsehbarer `/marketplace.json`.

### Changed
- Die Token-Verwaltung erklärt jetzt direkte MCP-Konfiguration und Marketplace-Installation statt ZIP-Downloads; `/plugin.zip` bleibt für bestehende Links verfügbar.

## [0.1.1] - 2026-10-14

### Added
- README-Anleitung für Installation und Updates über Docker Hub.

### Changed
- Die Verwaltungsoberfläche liegt jetzt unter `/`; Aufrufe von `/manage` werden auf `/` umgeleitet.
- Nginx-Beispiel und Plugin-Links verwenden den Root-Pfad der Verwaltungsoberfläche.
