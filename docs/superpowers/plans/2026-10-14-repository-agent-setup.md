# Repository-Agenten-Setup – Implementierungsplan

> **Für agentische Entwickler:** Zur Umsetzung diesen Plan Aufgabe für Aufgabe abarbeiten. Schritte verwenden Checkboxen (`- [ ]`).

**Ziel:** Eine kurze Repository-Orientierung in `AGENTS.md` und einen ersten projektspezifischen Workflow-Skill für Mailstack MCP bereitstellen.

**Architektur:** `AGENTS.md` ist der dauerhafte Einstieg und verweist auf maßgebliche Dateien und Dokumente. Vertiefende, wiederverwendbare Abläufe liegen getrennt unter `.agents/skills/`; zunächst wird nur der allgemeine Repository-Workflow-Skill erstellt.

**Technologien:** Markdown, TypeScript/Node.js-Repository, MCP, IMAP/SMTP, Express, SQLite, Docker Compose.

**Spezifikation:** `docs/superpowers/specs/2026-10-14-agent-setup-design.md`

## Globale Vorgaben

- Keine Produktcode-, Runtime- oder bestehenden Produktdokumentationsänderungen.
- Keine nicht vorhandenen Testskripte oder Prüfverfahren als verfügbar darstellen.
- Geheimnisse, Tokens, Passwörter und vollständige Nachrichteninhalte nicht in Beispielen oder Logs wiedergeben.
- TLS-Prüfung und Autorisierungsgrenzen nicht abschwächen.
- SMTP-Teilerfolg nach Annahme ohne automatischen Neuversand darstellen.
- Bestehende Nutzeränderungen unangetastet lassen.

## Prüfschwerpunkte

- Pfade in der Orientierung müssen existieren; alle betroffenen Verzeichnisgruppen sind vor dem Schreiben anhand der aktuellen Repo-Struktur zu prüfen.
- Start- und Prüfkommandos müssen exakt mit `package.json` übereinstimmen; aktuell gibt es kein Testskript.
- Regeln zu Tokens und Rechten müssen statischem Verwaltungstoken, User-Bearer-Token und Tool-Berechtigungen die richtigen Aufgaben zuordnen.
- Bei ungeklärten Konflikten zwischen Bestandsdokumentation und Implementierung keine Regel als eindeutig geklärt darstellen; auf die maßgeblichen Dateien verweisen und die Abweichung kenntlich machen.
- Die Skills müssen `AGENTS.md` ergänzen, statt dieselben Informationen umfangreich zu wiederholen.

---

### Aufgabe 1: Repository-Einstieg in `AGENTS.md`

**Dateien:**
- Neu: `AGENTS.md`

- [x] Vorhandene Repo-Verzeichnisse und `package.json` prüfen; die Übersicht auf echte Einstiegspunkte begrenzen.
- [x] Zweck, Stack und kurze Verzeichnisübersicht für `src/mcp`, `src/web`, `src/imap`, `src/smtp`, `src/security`, `src/storage` und Betriebskonfiguration dokumentieren.
- [x] Auf README, PRODUCT, DESIGN sowie relevante Spezifikationen und Pläne unter `docs/superpowers/` verweisen.
- [x] `npm start` und `npm run typecheck` als vorhandene Kommandos aufführen und kenntlich machen, dass kein Testskript definiert ist.
- [x] Sicherheits- und Änderungsinvarianten knapp festhalten: TLS-Verifikation, Geheimnisschutz, MCP-Berechtigungsprüfung und SMTP-Teilerfolg ohne automatischen Neuversand.
- [x] Auf `.agents/skills/` für vertiefende Projektabläufe verweisen.

### Aufgabe 2: Ersten Workflow-Skill anlegen

**Dateien:**
- Neu: `.agents/skills/repository-workflow/SKILL.md`

- [x] Skill-Metadaten und Auslöser auf Repo-Orientierung und allgemeine Änderungen an Mailstack MCP ausrichten.
- [x] Einen Ablauf beschreiben, der von der Aufgabe aus die betroffenen Dateien, Datenflüsse und einschlägigen Spezifikationen auffindet.
- [x] Vorgehen zum Abgleich von Implementierung, freigegebenen Designs und Betriebshinweisen festhalten.
- [x] Nur vorhandene Prüfkommandos nennen und die Einschränkung der derzeit fehlenden Testsuite erläutern.
- [x] Für spezialisierte Aufgaben die geplanten künftigen Themen (MCP/TypeScript, Mailprotokolle, Sicherheit/Speicherung, Betrieb) als mögliche Folge-Skills benennen, ohne sie bereits vorzutäuschen.

### Aufgabe 3: Konsistenz und Pfade prüfen

**Dateien:**
- Prüfen: `AGENTS.md`
- Prüfen: `.agents/skills/repository-workflow/SKILL.md`

- [x] Alle lokalen Pfade in beiden Dateien gegen das Repository prüfen.
- [x] Befehle gegen `package.json` abgleichen und sicherstellen, dass kein Testlauf behauptet wird.
- [x] Formulierungen zu Authentifizierung, SMTP-Verhalten und Geheimnissen mit Implementierung und Spezifikationen abgleichen.
- [x] Git-Status prüfen, um zu bestätigen, dass bestehende nicht eingecheckte Nutzerdateien nicht verändert wurden.
