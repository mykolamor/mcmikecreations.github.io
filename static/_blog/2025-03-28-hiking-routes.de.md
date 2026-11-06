---
title: Wie ich die Wanderrouten für die Website erstelle
description: Wie ich meine Wanderungen kartiere – auf einen Blick.
---
# Wie ich die Wanderrouten für die Website erstelle

Da die Wanderrouten ein wichtiger Bestandteil meiner Reise in die Welt der Datenvisualisierung sind, möchte ich
kurz beschreiben, wie ich die von mir zurückgelegten Routen für die Website aufbereite. Der Prozess
gliedert sich in einige einzelne Schritte:
1. Eine interessante Wanderroute finden und diese absolvieren.
2. Meine Tour auf irgendeine Weise aufzeichnen.
3. Die erfassten Daten sammeln und online eine Route für die Wanderung erstellen.
4. Alle Daten exportieren und auf meiner Website veröffentlichen.

Es gibt zahlreiche Möglichkeiten, das zu erreichen, was ich tue, aber hier sind die Schritte, die ich
normalerweise unternehme.

## Eine Wanderung finden

Auch wenn die Auswahl an Wanderungen, insbesondere in Deutschland und Österreich, zunächst
eher überwältigend erscheinen mag, grenzt sich der Suchraum im Laufe der Zeit schnell ein. Für einen
stärker automatisierten Ansatz ist es möglich, mithilfe der [Overpass-API](https://overpass-turbo.eu/) nach Berggipfeln mit einer nahegelegenen
Almhütte zu suchen.
Auch Vorschläge von Freunden werden berücksichtigt. Im Extremfall
kann man vom Gipfel eines Berges aus den Schwierigkeitsgrad
und den Reiz der umliegenden Gipfel auf einen Blick einschätzen, was als Orientierung für zukünftige
Entscheidungen dienen kann.

Auch die Steilheit, die Länge und die Dauer der Wanderung spielen eine entscheidende Rolle.
Wenn ich weiß, dass ich einen Zug verpasst habe und eine Wanderung nicht möglich ist, würde ich vielleicht
eine kürzere Wanderung in der Nähe der ursprünglich geplanten Route in Betracht ziehen.

## Die Wanderung aufzeichnen

Hier nutze ich ein paar Methoden, um die nächsten Schritte zu vereinfachen. Erstens: Wenn ich
weiß, dass ich unterwegs viele zufällige Abzweigungen nehmen werde, wie bei meiner
[Wanderung von Herrsching nach Tutzing](/projects/data-viz/hikes/herrsching_tutzing/),
aktiviere ich manchmal die GPS-Funktion meines Fitnessarmbands, damit es die Route
für mich aufzeichnet. Das funktioniert auf den meisten Strecken gut, aber der Akku entlädt sich sehr schnell und
das GPS-Signal ist in der Nähe von steilen Klippen oder Berghängen sehr ungenau.

Ein weiterer Trick, den ich anwende, besteht darin, einen Blick auf Google Maps zu werfen und darauf zu warten, dass das GPS meines Handys
aktualisiert wird. So muss das GPS nicht ständig eingeschaltet sein, und dennoch werden Ausschnitte für
die Zeitleistenfunktion von Google Maps erfasst, die ich später noch einmal ansehen kann.
Leider schwankt die Genauigkeit dieser Methode ziemlich stark, da Google
einen Punkt zufällig erfasst und einen anderen auslässt.

Zu guter Letzt versuche ich, Fotos mit aktivierten GPS-Metadaten aufzunehmen. So kann ich später den
genauen Ort nachverfolgen, an dem ich das Foto aufgenommen habe. Da ich beim
Auf- und Abstieg in den Bergen unzählige Fotos mache, hilft mir das in Situationen, in denen ich mich nicht
mehr daran erinnern kann, welchen Weg ich genommen habe.

## Erstellung der Route

Ich versuche, die Route mithilfe von [OpenRouteService](https://maps.openrouteservice.org/) als
Referenz zu erstellen, da ich damit wirklich detaillierte Routen
in verschiedenen Formaten völlig kostenlos und mit angemessenen Beschränkungen
exportieren kann. Auf meinem Handy nutze ich oft [Mapy.cz](https://mapy.com/en/)
und [OsmAnd](https://osmand.net/) wegen ihrer Offline-Funktionen,
daher nehme ich sie, wann immer möglich, als Hauptreferenz. Sie
ermöglichen sogar die Routenplanung im Offline-Modus, was sie perfekt
für spontane Entscheidungen macht! Dennoch reicht das oft nicht
aus, daher greife ich bei Bedarf auf das Armband und Fotos zurück.

Um die Route selbst zu erstellen, muss man eine Reihe von Markern entlang des Weges platzieren
und den Routenplanungsalgorithmus anweisen, diesen so genau wie möglich zu folgen,
das ist also kein Problem. Manchmal ist es schwierig, den Algorithmus dazu zu bringen,
bestimmte Straßen zu nehmen, sodass ich viele Marker verwenden muss, wie bei meiner
[Frau-Hitt-Wanderung](/projects/data-viz/hikes/frau_hitt/).

### Abseits des Weges

Manchmal ist es notwendig, den Wanderweg zu verlassen oder einen gesperrten
Weg im Naturschutzgebiet zu nehmen.

Wenn ich vom Weg abkomme, greife ich auf
[OpenStreetMap](https://www.openstreetmap.org/) zurück, um die ungefähren Koordinaten
meiner Route zu ermitteln, und auf [Mapbox](https://www.mapbox.com/), um die Höhe an diesen
Koordinaten zu ermitteln. Anschließend sammle ich die Daten zu den Geländebedingungen für diese Punkte
und speichere sie in einem Notizblock zum Exportieren.

Wenn ich einen gesperrten Weg nehme, der dennoch auf der Karte verzeichnet
ist, nutze ich die [Overpass-API](https://overpass-turbo.eu/), um die „Way“-Daten zu extrahieren,
ermittele die Höhe jedes Wegendpunkts mithilfe von [Mapy.cz](https://mapy.com/en/)
und die Geländedaten mithilfe von [OpenStreetMap](https://www.openstreetmap.org/). Anschließend
füge ich alles in einem Notizblock zusammen. Das ist ein sehr mühsamer
Vorgang, aber am Ende erhalte ich eine Karte meiner Wanderung, die
auf wenige Meter genau ist. Zum Beispiel habe ich etwa 6 Stunden damit
verbracht, die [Wanderung Riedenburg – Kelheim](/projects/data-viz/hikes/riedenburg_kelheim/) zu korrigieren,
bei der wir einige Abschnitte auf gesperrten Wegen zurückgelegt haben.

## Exportieren der Daten

Der Exportvorgang selbst ist sehr einfach. In den meisten Fällen muss man lediglich
die Exportschaltfläche auf [OpenRouteService](https://maps.openrouteservice.org/)
anklicken, um GeoJSON- und GPX-Versionen der Route zu erhalten. Ich habe mich für GeoJSON als mein Hauptformat
entschieden, da es sich programmtechnisch sehr einfach verarbeiten lässt, insbesondere mit
JavaScript. Ich analysiere die Datei, um die Eigenschaften der Wanderung wie Entfernung,
Dauer, Höhenunterschied usw. zu ermitteln. In Fällen, in denen ich vom zulässigen Weg abweiche,
nehme ich die Daten, die ich in meinem Notizblock gespeichert habe, und füge sie manuell in die
exportierte Datei ein. Das dauert zwar eine Weile, ist aber nicht allzu schwer, und ich kann sofort
sehen, wie sich meine Änderungen auf der entsprechenden Webseite widerspiegeln. Da die meisten Apps
eher mit GPX als mit GeoJSON kompatibel sind, konvertiere ich das eine Format mithilfe eines
beliebigen Online-Dienstes in das andere. Meistens erfüllt [OpenRouteService](https://maps.openrouteservice.org/)
diesen Zweck, aber ich habe auch schon andere Dienste genutzt.

### Technologiestack für die Visualisierung

Das Verfahren, das ich verwende, ist ebenfalls recht einfach. Ich nehme die Wanderung aus einer JSON-Liste
aller Wanderungen, die ich habe, und beginne mit der Verarbeitung.

Zunächst nehme ich den „Mittelpunkt“ der Wanderung, den ich manuell festlege, und berechne mithilfe von
[d3-geo](https://d3js.org/d3-geo) alle Kartenkacheln, die ich zur
Anzeige benötige. Kartenkacheln sind kleine quadratische Bilder mit einer Größe von 256 × 256 Pixel, die verschiedene Abschnitte
der Karte darstellen. Wenn du deine Lieblings-Kartenwebsite aufrufst, kannst du beobachten, wie die Karte
Stück für Stück mithilfe dieser Quadrate geladen wird. Anschließend lade ich diese Kacheln von
verschiedenen Anbietern herunter, um alle Daten zu erhalten, die ich für die Darstellung benötige. Ich verwende
[Mapbox](https://www.mapbox.com/) für Höhen- und Satellitenkacheln,
[OpenStreetMap](https://www.openstreetmap.org/) für die 2D-Ansicht und
[Mapy.cz](https://mapy.com/en/) für die interaktive Ansicht.

Anschließend verwende ich [Three.js](https://threejs.org/), um die 3D-Ansicht der Karte zu erstellen.
Ich analysiere die GeoJSON-Datei manuell und extrahiere alle Koordinaten und Höhenangaben, um anschließend
die Wege auf den 2D-, 3D- und interaktiven Karten darzustellen.

Zum Schluss verfasse ich den Bericht über die Wanderung mit [Markdown](https://www.markdownguide.org/)
und setze ihn mit [Marked.js](https://marked.js.org/) zusammen.

Nun füge ich mit ein bisschen Gestaltung und ein bisschen Zauberei alles zusammen, und schon ist eine Seite
für eine Wanderung fertig!
