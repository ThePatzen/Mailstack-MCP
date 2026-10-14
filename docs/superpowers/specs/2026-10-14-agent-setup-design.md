# Repository-Agenten-Setup – Design

## Ziel

Ein erstes, wartbares Agenten-Setup für Mailstack MCP erstellen. Eine kurze `AGENTS.md` dient als Einstieg und Inhaltsverzeichnis. Ergänzende Repository-Skills vermitteln nach und nach die Technologien, Arbeitsabläufe und Sicherheitskonzepte, die für Änderungen an diesem Projekt wichtig sind.

## Ist-Zustand und Nutzer

Das Setup richtet sich an Codex und andere agentische Werkzeuge, die in diesem Repository Änderungen planen oder umsetzen. Das Projekt ist ein TypeScript-/Node.js-Dienst mit MCP-Endpunkt, IMAP-Anbindung, optionalem SMTP-Versand, Express-Verwaltungsoberfläche und SQLite-Speicherung. Produkt-, Betriebs- und Architekturdetails sind bereits in README, PRODUCT, DESIGN sowie den Spezifikationen und Plänen unter `docs/superpowers/` beschrieben.

Es existiert noch keine `AGENTS.md`; `.agents/` enthält aktuell keine Repository-Skills. `package.json` bietet `start` und `typecheck`, aber kein Testskript. Das Setup soll vorhandene Dokumentation auffindbar machen und deren Regeln nicht unnötig duplizieren.

## Aufbau

### `AGENTS.md`

Die Datei liegt im Repository-Root und bleibt eine knappe Orientierung. Sie enthält:

- Zweck des Tools und groben Laufzeit-/Technologieüberblick.
- Ein Verzeichnis- und Dateiinhaltsverzeichnis für Einstieg, MCP, Webverwaltung, IMAP/SMTP, Sicherheit, Speicherung und Betrieb.
- Links auf README, PRODUCT, DESIGN sowie die relevanten Spezifikationen und Pläne.
- Vorhandene Entwicklungs- und Prüfkommandos, mit einem Hinweis, dass derzeit kein Testskript definiert ist.
- Dauerhafte Sicherheits- und Änderungsinvarianten, insbesondere TLS-Prüfung, Schutz von Zugangsdaten und Tokens, serverseitige Prüfung der Tool-Rechte und korrektes Verhalten bei SMTP-Teilerfolg.
- Verweis auf Skills in `.agents/skills/` für vertiefende Abläufe.

Die Datei beschreibt die Navigation und verbindliche Kurzregeln. Sie kopiert keine vollständigen Bedienungs- oder Architekturabschnitte aus README und Spezifikationen.

### Skills

Repository-Skills liegen unter `.agents/skills/<skill-name>/SKILL.md`. Der erste Skill erklärt Repository-Orientierung und typische Änderungsabläufe: relevante Dateien und Spezifikationen finden, den betroffenen Datenfluss verfolgen, bestehende Konventionen berücksichtigen und die tatsächlich verfügbaren Prüfungen wählen.

Weitere Skills werden als eigenständige, fokussierte Dokumente ergänzt:

1. TypeScript/Node.js und MCP-Tool-Änderungen.
2. IMAP und SMTP einschließlich Verbindungen, Limits, TLS und Versandarchivierung.
3. Sicherheit und Datenhaltung einschließlich Tokens, Verschlüsselung, Sessions, CSRF und SQLite-Migrationen.
4. Konfiguration und Betrieb mit Docker Compose, Reverse Proxy, Backups und Schlüsselverwaltung.

Jeder Skill nennt seinen Anwendungsbereich, verweist auf die tatsächlichen Implementierungsstellen und Projektunterlagen und gibt einen nachvollziehbaren Arbeitsablauf vor. Skills werden nur angelegt, wenn sie nützliche, projektspezifische Hinweise gegenüber `AGENTS.md` liefern.

## Regeln und Grenzen

- `AGENTS.md` und Skills sind Arbeitsanweisungen, keine neue Quelle für Produktverhalten. Bei Konflikten gelten die aktuelle Implementierung und freigegebene Projektspezifikationen; Abweichungen müssen sichtbar gemacht werden.
- Geheimnisse, vollständige Tokens, Passwörter und vollständige Nachrichteninhalte dürfen nicht in Logs oder Beispielen auftauchen.
- IMAP-/SMTP-TLS-Prüfung und bestehende Autorisierungsgrenzen dürfen nicht abgeschwächt werden.
- SMTP-Erfolg mit fehlgeschlagener Sent-Archivierung ist ein möglicher Teilerfolg; ein automatischer erneuter Versand ist nicht zulässig.
- Prüfhinweise nennen nur Kommandos, die im Projekt vorhanden oder ausdrücklich als künftig einzurichten markiert sind. Keine nicht vorhandene Testsuite suggerieren.
- Nicht eingecheckte Nutzerdateien wie `.idea/` und bereits vorhandene Planänderungen bleiben unberührt.

## Geplante Dateien

- Neu: `AGENTS.md` – Repository-Einstieg und Inhaltsverzeichnis.
- Neu: `.agents/skills/repository-workflow/SKILL.md` – Orientierung und allgemeiner Arbeitsablauf.
- Später, bei Bedarf: fokussierte Skills für MCP/TypeScript, Mailprotokolle, Sicherheit/Speicherung sowie Betrieb.

## Abnahmekriterien

- Eine neue Person kann anhand von `AGENTS.md` die maßgeblichen Dateien und Dokumente für eine Aufgabe finden.
- Zweck, Stack, Verzeichnisstruktur, vorhandene Befehle und wesentliche Sicherheitsinvarianten sind korrekt und knapp dargestellt.
- Der erste Skill ergänzt die Root-Anweisungen mit einem konkreten, repository-spezifischen Arbeitsablauf.
- Alle referenzierten Pfade existieren; es werden keine nicht vorhandenen Tests oder Befehle als verfügbar dargestellt.
- Bestehende Nutzeränderungen werden nicht überschrieben.

## Außerhalb des Umfangs

- Änderungen am Produktcode, an der Runtime-Konfiguration oder an der vorhandenen Produktdokumentation.
- Erstellen aller geplanten Technologie-Skills in einem einzigen Schritt; sie sollen entlang des tatsächlichen Arbeitsbedarfs nach und nach folgen.
- Neue Testinfrastruktur oder automatische Installations-/Deployment-Schritte.
