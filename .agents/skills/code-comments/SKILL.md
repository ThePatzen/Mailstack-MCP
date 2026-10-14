---
name: code-comments
description: Use when creating, changing, or reviewing source code and comments, especially functions, methods, classes, and non-obvious decisions.
---

# Code-Kommentare

## Grundsatz

Schreibe Kommentare so, dass Kolleginnen und Kollegen Zweck und wichtige Entscheidungen im Code ohne Rätselraten verstehen. Jede Klasse und jede Funktion beziehungsweise Methode erhält einen kurzen Kommentar, der ihren Zweck oder Vertrag erklärt. Jede nicht offensichtliche Entscheidung erhält einen Kommentar, der den Grund nennt.

Kommentare stehen in der Sprache, die im betroffenen Modul üblich ist. In diesem Repository ist das in der Regel Englisch. Schreibe einfach und direkt und halte Kommentare aktuell.

## Vorgehen

- Beschreibe bei jeder Klasse ihren Verantwortungsbereich und, falls relevant, ihre Grenze zu anderen Modulen.
- Beschreibe bei jeder Funktion und Methode Zweck, wichtige Eingaben, Rückgabeverhalten oder Fehlerfälle, soweit das für das Verständnis wichtig ist.
- Erkläre bei anonymen Callback-Funktionen ihre Aufgabe direkt am Callback oder durch einen unmittelbar zugehörigen Kommentar an der Registrierung.
- Kommentiere nicht offensichtliche Entscheidungen direkt an der Stelle: Erkläre, warum Reihenfolge, Einschränkung, Berechtigungsprüfung, Wiederholung, Datenform oder Fehlerbehandlung nötig sind.
- Erkläre Sicherheits- und Kontogrenzen sowie Teilfehler ausdrücklich, wenn ein späterer Bearbeiter sie versehentlich entfernen oder ändern könnte.
- Schreibe für die wartende Person: verständlich, konkret und ohne unnötige Fachabkürzungen.
- Passe den Kommentar an, wenn sich das Verhalten ändert; entferne Kommentare, die nicht mehr stimmen.

## Beispiele

```ts
/** Sends one message and archives it after SMTP accepts it. */
class MessageSender {
  /** Sends the message for the given account and reports archival failure separately. */
  async send(accountId: string, message: OutgoingMessage): Promise<SendResult> {
    const accepted = await this.smtp.send(message);

    // SMTP has accepted the message, so retrying after an archive error could send it twice.
    return this.archiveAcceptedMessage(accountId, message, accepted);
  }
}
```

Der Klassenkommentar nennt die Verantwortung, der Methodenkommentar den Vertrag, und der Inline-Kommentar begründet die nicht offensichtliche Fehlerentscheidung.

## Kurzprüfung

Vor Abschluss einer Codeänderung prüfe:

1. Hat jede neue oder wesentlich geänderte Klasse einen verständlichen Zweckkommentar?
2. Hat jede neue oder wesentlich geänderte Funktion und Methode einen verständlichen Zweck- oder Vertragskommentar?
3. Sind nicht offensichtliche Entscheidungen samt Grund kommentiert?
4. Erklärt jeder Kommentar einen Zweck, Vertrag oder Grund, statt nur die nächste Codezeile umzuschreiben?
5. Stimmen Sprache, Inhalt und Position der Kommentare mit dem bestehenden Modul überein?

Auch wenn Typen oder Namen Details bereits klar machen, bleibt ein kurzer Zweckkommentar an jeder Klasse und Funktion erhalten. Er soll deren Rolle benennen, nicht die Signatur paraphrasieren.

## Häufige Fehler

- Nur beschreiben, was die nächste Zeile macht, obwohl der Code das bereits zeigt.
- Eine Sicherheitsprüfung kommentarlos lassen, obwohl ihr Grund oder ihre Platzierung wichtig ist.
- Kommentare so abstrakt formulieren, dass sie keine konkrete Entscheidung erklären.
- Kommentare nach einer Verhaltensänderung unverändert lassen.
- Klassen und Hilfsfunktionen ohne Zweckkommentar hinzufügen.
