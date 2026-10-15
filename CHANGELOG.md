# Changelog

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
