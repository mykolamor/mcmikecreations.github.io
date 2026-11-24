---
title: Grundlagen von Datenbanken
description: Alles, was ihr wissen müsst, um meine Beiträge zum Thema Datenbanken zu verstehen.
---
# Grundlagen von Datenbanken

Ich habe mich kürzlich mit einem Freund über meine aktuellen Schwierigkeiten mit
Datenbanken unterhalten und dabei festgestellt, dass es eine große Wissenslücke darüber gibt, was
Datenbanken eigentlich sind. Ich schreibe diesen Beitrag aus zwei Gründen: um das Bild bei
denjenigen zu korrigieren, die sich nur vage mit Datenbanken auskennen, und um denjenigen, die
noch gar nichts darüber wissen, eine Einführung zu geben.

## Was ist eine Datenbank?

Es gibt viele Begriffe, die im Zusammenhang mit DBs synonym verwendet werden.
Auch ich werde sie im weiteren Verlauf manchmal durcheinanderbringen, aber speziell in diesem Beitrag werde ich
darauf achten, den richtigen Begriff zu verwenden.

- **Datenbank** – die Regeln und die Struktur, die in einer Sammlung von
Daten zu finden sind (der Entwurf/das Schema, das logische Modell).
- **Datenbankinstanz** – ein konkretes Beispiel für diese strukturierten Daten, die den
vorgegebenen Regeln unterliegen (die nach dem Entwurf aufgebauten Daten).
- **Datenbank-Engine** – die spezifische Software zur Verarbeitung der Rohdaten,
einschließlich der Speicherung (Erstellen, Lesen, Aktualisieren, Sichern von Daten sowie Durchsetzen der
Regeln).
- **Datenbankmanagementsystem** (DBMS) – das vollständige Softwarepaket, einschließlich
Netzwerkprotokollen, Benutzerverwaltung, Datensicherungen, Anforderungsverarbeitung usw.

Meiner subjektiven Einschätzung nach findet der Großteil der interessanten Forschungsarbeit auf der Seite der Datenbank-Engine statt,
weshalb in zukünftigen Beiträgen die Begriffe „DB“ und „Datenbank-Engine“ synonym verwendet werden.
Nun zu einem konkreteren Beispiel.

Die folgende Definition einer Tabelle ist eigentlich eine **Datenbank**.
- Die Kennung ist eine ganze natürliche Zahl im Bereich von $1$ bis $2^{32}$;
- die Ländercodes müssen aus drei lateinischen Kleinbuchstaben bestehen und
  dem Standard ISO 3166-1 Alpha-3 folgen (usa, ukr, deu usw.);
- die Währungscodes müssen aus drei lateinischen Kleinbuchstaben bestehen und
  dem Standard ISO 4217 folgen (eur, usd, uah).

|Kennung|Ländercode|Währungscode|
|--|--|--|
|  |  |  |

Sobald wir diese Tabelle tatsächlich mit Daten füllen, wird sie zu einer **Datenbankinstanz**:

|Kennung|Ländercode|Währungscode|
|--|--|--|
|1|deu|eur|
|2|usa|usd|
|3|ukr|uah|

Um Zeilen zu dieser Tabelle hinzuzufügen oder daraus zu entfernen und die Tabelle auf der Festplatte zu speichern, würden wir
eine **Datenbank-Engine** verwenden. Und wenn unser Systemadministrator automatische
Sicherungen der Datenbankinstanz über das Netzwerk hinweg als Teil seines
zentralen Verwaltungssystems einrichten möchte, würde er mit dem **DBMS** interagieren.

Ich möchte an dieser Stelle betonen, dass strukturierte Daten *NICHT* in Form einer Tabelle vorliegen müssen.
Daten gibt es in vielen Formen, und es gibt zahlreiche Möglichkeiten, sie zu organisieren (Graphen,
verschachtelte Strukturen, Dokumente).

## Datenbankmanagementsysteme

Nachdem wir nun oberflächlich geklärt haben, was das ist, müssen wir
über die Komponenten eines typischen DBMS sprechen.

Sie lassen sich im Wesentlichen in drei Kategorien unterteilen:
- Frontend
- Backend
- Steuerung

Zu den **Frontend**-Komponenten gehören unter anderem:
- Client-Zugriffsschnittstellen wie CLI (reine Text-Terminalsteuerung), GUI
(interaktive Anwendungen), Webkonsole (lokal ausgeführte Website mit Verbindung zum DBMS);
- APIs und Treiber wie ODBC, JDBC, Wire-Protokoll (Verbindungen, über die Programmierer
in ihren Programmen auf das DBMS zugreifen können);
- Verwaltung von Client-Verbindungen (wie viele Benutzer sich mit welchem DBMS auf
welchem Computer verbinden können);
- Abfrageverarbeitung (Parsen und Transformieren der Abfrage, die das DBMS als Text oder
in anderer Form erhält);
- Analyse und Schätzung (Überprüfung der in der Datenbankinstanz gespeicherten Informationen,
um schnellere Wege zur Verarbeitung dieser Informationen zu finden, wobei die Eigenschaften und
Statistiken der Daten genutzt werden);
- je nach Sichtweise auch Optimierung, Erstellung des endgültigen Ausführungsplans (mehr dazu in den folgenden Beiträgen);
- Verwaltung von Erweiterungen und Plugins.

Einfach ausgedrückt unterstützen Frontend-Komponenten das DBMS, die umgebenden Systeme und
die Benutzer dabei, miteinander zu interagieren. Die Anfragen zur Datenverarbeitung gehen bei den
Frontend-Komponenten ein, werden in den Steuerungskomponenten aufbereitet und von
den Backend-Komponenten ausgeführt.

Zu den **Backend**-Komponenten gehören dann:
- Abfrageoptimierung und/oder -kompilierung auf niedriger Ebene (mehr dazu in den folgenden Beiträgen);
- Implementierungen der eigentlichen Verarbeitungsoperationen im Code;
- Datenspeicherverwaltung (Speichern und Laden von Informationen auf Festplatte oder über das Internet);
- Berechnung und Nutzung zusätzlicher Informationen (sortierte Kopien von Daten,
vorberechnete Beziehungen zwischen Informationselementen);
- Komprimierung, Kodierung, Verschlüsselung, Low-Level-Sicherheit;
- Arbeitsspeicherverwaltung (Zuweisung und Belegung neuer Speicherblöcke auf dem Computer,
auf dem das DBMS läuft, sowie Bereinigung nach der Datenverarbeitung).

Kurz gesagt sind Backend-Komponenten das Rückgrat des DBMS; sie führen tatsächlich
die von Benutzern oder anderen Systemen erteilten Befehle zur Informationsverarbeitung aus.
Es gab bereits einige erfolgreiche Systeme, die auf Frontend-Komponenten verzichteten und
sich darauf konzentrierten, die Backend-Komponenten benutzerfreundlich zu gestalten und in andere Systeme zu integrieren
(da diese Datenverarbeitungsvorgänge, die Speicherverwaltung usw. auch
außerhalb von Datenbanken Anwendung finden, beispielsweise in medizinischen Programmen, Textverarbeitungsprogrammen, Dashboards zur
Statistikerfassung und so weiter). Frontend-Komponenten ergeben jedoch keinen Sinn,
wenn sie nicht von Backend-Komponenten unterstützt werden.

Die Steuerungskomponenten halten alles zusammen und helfen Komponenten aus anderen
Kategorien dabei, miteinander zu kommunizieren und Aufgaben zu erledigen. Dazu gehören:
- Transaktionen (die Zusammenfassung mehrerer Änderungen, sodass entweder alle oder
keine davon ausgeführt werden, z. B. wenn Geld von einem Konto abgebucht und auf einem anderen gutgeschrieben wird);
- Nebenläufigkeitskontrolle (die es vielen Benutzern ermöglicht, Daten gleichzeitig zu lesen und zu ändern,
ohne dass die Änderungen eines Benutzers die eines anderen beschädigen oder überschreiben);
- Deadlock-Erkennung (wenn viele Benutzer versuchen, dieselben Informationen zu ändern, und das
System dabei ins Stocken gerät);
- Wiederherstellung (Neustart bei einem Systemabsturz, Erstellung von Checkpoints zur Wiederaufnahme,
Verfolgung und Meldung des Fortschritts);
- Authentifizierung/Autorisierung, Benutzerzugriff;
- Auditing und Datenmaskierung zum Schutz der Privatsphäre;
- Verwaltung von Computerressourcen und deren Zuweisung zu verschiedenen Vorgängen;
- Leistungs-, Fehler- und Ereignisüberwachung;
- Automatisierung von Sicherungen und Wiederherstellungen, Reorganisation durch Tools (z. B. Neuberechnung der
vorberechneten, sortierten Daten, wenn sich diese ändern);
- Verteilung von Aufgaben und Vorgängen auf verschiedene Datenbank-Engines,
Computer, auf denen das DBMS läuft, usw.

Obwohl der Kategorie „Steuerung“ viele Komponenten zugeordnet werden, sind diese
hauptsächlich dafür zuständig, sicherzustellen, dass die Benutzeranfragen ausgeführt werden, das System
zuverlässig funktioniert und die Computer, auf denen das DBMS läuft, ihre Aufgaben erfüllen.

## Datenbanktypen

Nachdem wir nun Themen besprochen haben, die für alle Arten von Datenbanken gelten, müssen wir
herausfinden, welche der oben genannten Datenbankarten es gibt. Es gibt sehr viele
davon und auch zahlreiche Einteilungen, aber hier ist die, die ich gerne verwende.

**Relationale (SQL-)Datenbanken**. Die darin gespeicherten Informationen sind in
Tabellen/Datensätzen (Informationsobjekten) organisiert, und die Beziehungen zwischen ihnen werden beschrieben.
Die obige Tabelle ist ein Beispiel für eine relationale Datenbankinstanz. Zu den modernen DBMS,
die in diese Kategorie fallen, gehören *PostgreSQL, MySQL, Oracle Database, SQLite* und
weitere. Da diese Kategorie stark strukturiert und in separate
Tabellen unterteilt ist, kann die Verarbeitung dieser Daten und das Auffinden relevanter Informationen recht
komplex werden.

**Dokumentendatenbanken**. Die Informationen werden in semistrukturierten Dokumenten gespeichert, in der
Praxis meist im JSON-/BSON-Format. Diese Datenbanken ermöglichen die Speicherung von
vielfältigeren und frei strukturierten Daten, enthalten jedoch häufig Duplikate und tief verschachtelte
Datenstrukturen, was ihre Verarbeitung erschwert. Beispiele hierfür sind
*MongoDB, Couchbase, Firestore*.

**Schlüssel-Wert-Datenbanken**. Jeder Information wird ein Schlüssel zugewiesen, wenn sie
der Datenbankinstanz hinzugefügt wird. Dieser Schlüssel kann dann verwendet werden, um diese Information abzurufen oder
zu ändern. Diese Kategorie von Datenbanken ist zwar weniger flexibel, kann jedoch
besondere Annahmen und Optimierungen nutzen, um die Datenverarbeitung zu
beschleunigen. Zu dieser Kategorie gehören *Redis, DynamoDB, RocksDB* usw.

**Graphdatenbanken**. Die in einer Instanz einer Graphdatenbank gespeicherten Informationen
stellen ein Netzwerk aus verschiedenen Objekten und deren Verbindungen dar. Operationen
an diesen Datenbanken sind oft komplexer, da sie das Netzwerk durchlaufen und
Informationen sammeln. Es gibt bedeutende Untertypen von Graphdatenbanken, wie bei allen
anderen Kategorien auch, aber darauf werde ich hier nicht näher eingehen.

Es gibt noch viele weitere spezialisierte Kategorien, auf die ich hier vorerst nicht eingehen werde und die sich oft
auf bestimmte Datenformate, Workloads oder Anwendungsfälle konzentrieren. Um nur einige zu nennen:
Vektordatenbanken arbeiten mit mehrdimensionalen Vektoren, die Informationspunkte
im mehrdimensionalen Raum darstellen; Zeitreihendatenbanken erfassen alle Daten anhand von
Ereignissen oder Messungen, die zu einem bestimmten Zeitpunkt stattfinden; Geodatenbanken konzentrieren sich auf die
Darstellung und Verarbeitung geografischer Daten oder allgemein aller Daten, die an
eine bestimmte Position im Raum gebunden sind; Blockchain-/Ledger-Datenbanken speichern Informationen
in unveränderlichen Blöcken, die nur gelesen oder hinzugefügt, aber nicht geändert oder entfernt werden können;
Flat-File-Datenbanken arbeiten direkt im Dateisystem eines Computers. Ich hoffe,
dass ich all diese Themen irgendwann in der Zukunft behandeln kann, aber konzentrieren wir uns vorerst auf die
Grundlagen.

Es gibt weitere Einteilungen von Datenbanken, die unabhängig von (oder ergänzend
zu) den oben genannten sind. Man kann Datenbanken nach ihrem Speicherort (auf Festplatte oder
ausschließlich im Arbeitsspeicher eines Computers), nach Workload (viele kleine
Transaktionen zum Hinzufügen, Aktualisieren und Löschen von Daten; umfangreiche statistische Berechnungen
über unveränderliche Daten; gemischte Workloads; Daten, die kontinuierlich aus externen
Quellen einströmen und laufend verarbeitet werden), nach der Architektur (eingebettet,
Client-Server, verteilt auf viele Computer und zentral verwaltet,
föderiert und Aufgaben über mehrere unabhängige Computer hinweg ausführend) sowie nach der
Bereitstellung (wo das DBMS läuft, also lokal/selbst gehostet, in der Cloud usw.).

Heutzutage gibt es zahlreiche DBMS, daher müssen Entwickler bei der Entwicklung eines neuen Systems
klären, auf welche Kategorien sie sich konzentrieren wollen und wie sie
ihr neues System von den bereits vorhandenen abheben können.

In Zukunft warten noch viele weitere Themen, Kategorisierungen und interessante Fakten zum Thema Datenbanken auf uns,
aber an dieser Stelle ist es sinnvoll, erst einmal eine Pause einzulegen. Die gesamte
Zeitleiste zur Datenbankforschung, die ich ausgewertet habe, findet ihr auf der [SmackDB-Projektseite](/projects/smackdb/).
