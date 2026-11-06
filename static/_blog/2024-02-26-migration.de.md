---
title: Von Jekyll zu Flowbite Svelte
description: Wie ich von Ruby und Jekyll zu Vite, Svelte, SvelteKit und Flowbite gewechselt bin.
---
# Von Jekyll zu Flowbite Svelte

## Alte Website

Im März 2023 begann ich mit der Erstellung einer Website für meinen Online-Lebenslauf, als ich
es leid war, meine Profile auf LinkedIn und ORCID sowie meine Lebensläufe in tabellarischer und
freiformatierter Form ständig zu aktualisieren. Ich dachte mir: „Wäre es nicht schön, eine einzige Quelle zu haben, die
als verlässliche Grundlage für meine berufliche Laufbahn dient?“ Eine persönliche Website schien mir damals
die logische Lösung zu sein. Ich war damals noch naiv, und die Website wurde einfach zu einem weiteren Ort, den ich
aktualisieren musste.

Trotzdem beschloss ich, weiterzumachen und eine Website von Grund auf neu zu erstellen, damit
ich nicht auf einen externen Dienst angewiesen war, der meine
Daten generierte und verarbeitete. Da ich noch keine Erfahrung mit Frontend-Entwicklung und Webhosting hatte, suchte ich nach
einer möglichst einfachen Lösung.

Ich habe viele Dokumentations-Websites gesehen, die `*.github.io`-Domains verwenden, was mich
zu der Entdeckung von [GitHub Pages](https://pages.github.com/) führte, das auf [Ruby](https://www.ruby-lang.org/en/) und [Jekyll](https://jekyllrb.com/) basierte, um
statische HTML-Websites bereitzustellen. Ich habe mir vorhandene Jekyll-Vorlagen angesehen und [eine gefunden](https://github.com/sproogen/modern-resume-theme),
die einen ansprechenden Stil hatte. Der größte Vorteil dieser Vorlage war, dass der
Inhalt in einer strukturierten `.yml`-Datei geschrieben war. Das bedeutete eine einfache Bearbeitung in der
Zukunft, falls ich diese jemals benötigen sollte. Die Website bot einen ansprechenden digitalen Lebenslauf und
einen Kontaktbereich für alle, die daran interessiert waren, mich zu kontaktieren, was
gut funktionierte, mir aber nicht ermöglichte, andere Seiten einfach hinzuzufügen.

![Alte Website, erstellt mit Jekyll](/images/blog/migration/old-resume.png)

## Motivation für den Übergang

Ich wollte die Website um detaillierte Projektbeschreibungen
und einen Blog-Bereich erweitern, was Jekyll zwar unterstützte, jedoch eine komplette Neugestaltung der Benutzeroberfläche erforderte.
Ohne einfachen Zugang zu komponentenbasierter Entwicklung und JavaScript-Paketverwaltung
wäre dies ein mühsamer Prozess gewesen. Außerdem wollte ich eine
geeignete Frontend-Technologie mit [Node.js-Integration](https://nodejs.org/) und
Funktionen zur statischen Seitengenerierung (SSG) erlernen, um die Website auf GitHub Pages zu hosten.
Meine Frontend-Kollegen haben Folgendes verwendet:

- [Angular](https://angular.io/guide/prerendering),
- [Remix](https://remix.run/docs/en/main/guides/disabling-javascript),
- [Astro](https://docs.astro.build/en/basics/rendering-modes/#pre-rendered),
- [Gatsby](https://www.gatsbyjs.com/docs/reference/rendering-options/deferred-static-generation/),
- [Next.js](https://nextjs.org/docs/pages/building-your-application/deploying/static-exports).

Ich war auf der Suche nach einer SSG-Lösung, die für mich den geringsten Aufwand
beim Einarbeiten in das Framework mit sich bringen würde. Da ich mich so intensiv umgeschaut habe, hat mir Google News einige
Artikel zu [Svelte](https://svelte.dev/) und [SvelteKit](https://kit.svelte.dev/) angezeigt,
und diese sahen für diese Aufgabe wirklich vielversprechend aus. Ich habe ein wenig damit experimentiert,
unter Verwendung von [Bootstrap](https://getbootstrap.com/), und dabei recht gute Ergebnisse erzielt. Was ich mir wirklich wünschte, war eine
ordentliche Komponentenbibliothek, die mir Wochen an Arbeit ersparen würde, in denen ich selbst benutzerdefinierte
Komponenten schreiben müsste.

> Kurz gesagt: Am Ende habe ich die meisten Komponenten doch selbst geschrieben bzw. überschrieben.

Ich habe mich intensiv mit der Recherche nach Komponentenbibliotheken beschäftigt und eine Auswahlliste mit
vielversprechenden Paketen zusammengestellt, die ich verwenden könnte. Die Liste lautete:

1. [Flowbite](https://flowbite-svelte.com/),
2. [Skeleton](https://www.skeleton.dev/),
3. [AgnosticUI](https://www.agnosticui.com/),
4. [Attractions](https://illright.github.io/attractions/),
5. [SvelteStrap](https://sveltestrap.js.org/),
6. [SvelteUI](https://svelteui.dev/).

Nach meinen Erfahrungen mit [Flutter](https://flutter.dev/), bei denen ich unzählige Stunden damit verbracht habe,
die Standardstile der Komponenten anzupassen, habe ich versucht, mich von [Material UI](https://m3.material.io/) fernzuhalten.
Es sieht gut aus und bietet viele nützliche Barrierefreiheitsfunktionen. Meiner Meinung nach
ist es jedoch für Apps (auch Web-Apps/PWAs) gedacht und nicht für einfache statische
Websites, insbesondere Portfolios. Allein was die Funktionen angeht, lagen Flowbite und
Skeleton vorn, und Svelte ließ sich nach etwas Ausprobieren
einfacher handhaben. Der größte Vorteil war jedoch die Verwendung von [Tailwind](https://tailwindcss.com/).
Damit ließ sich die Benutzeroberfläche viel schneller erstellen, als wenn ich für jedes Element eigene Stile geschrieben hätte.
Und da ich bereits mit Bootstrap vertraut war, war die Entscheidung ein Kinderspiel.

## Gestaltungsvorgaben

Gleich zu Beginn habe ich beschlossen, einige verbindliche und optionale Designanforderungen
für das Projekt festzulegen. Das hat mir geholfen, den Umfang einzugrenzen und mich zunächst auf wichtige
Funktionen zu konzentrieren. Die Liste lautete:

- Anstatt den Lebenslauf auf einer einzigen Seite darzustellen, wollte ich die verschiedenen
Abschnitte auf mehrere Seiten aufteilen.
- Die Startseite/Indexseite sollte als persönliche Landingpage einen Überblick bieten, mit relevanten
Ausschnitten aus anderen Seiten.
- Die Website sollte von Suchmaschinen leicht indexiert werden können.
- Die Website sollte über relevante [ARIA-Attribute](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes) zugänglich sein.
- Die Website sollte eine dunkle und eine helle Variante enthalten.
- Die Website sollte detaillierte Projektbeschreibungen und einen Blog enthalten.
- Der Lebenslauf sollte in zwei Versionen vorliegen – als kurze, einfache Seite zum Ausdrucken und
als detaillierte, gestaltete Seite zur Online-Anzeige.
- Der Blog sollte eine Filterung nach Tags und Jahr unterstützen, ähnlich wie bei [Blogspot/Blogger](https://www.blogger.com/).

## Umsetzung 

Nachdem ich mich auf anderen Lebenslauf-Websites, z. B. [Colorlib](https://colorlib.com/), um Inspiration umgesehen hatte, stellte ich fest,
dass sie alle eine sehr ähnliche Struktur hatten: einen Hero-Bereich mit einem Bild, eine
informelle Beschreibung, Auszüge aus Berufserfahrung und Studium, Projekte oder einen Portfolio-Bereich
sowie Kontaktdaten. Einige hatten auch irgendwo einen Blog. Die meisten Websites bestanden aus
einer einzigen langen Seite ohne weitere Informationen außer Portfolio und Kontaktdaten,
was mir nicht besonders gefiel. Am meisten störte mich ein E-Mail-Formular
im Kontaktbereich, für dessen Funktionieren in der Regel entweder ein Backend oder
ein externer Dienst erforderlich war. Mein Ziel war möglichst wenig Komplexität zum geringsten
Preis, also machte ich mich daran, das Formular durch eine Liste von E-Mail-Adressen und Netzwerken zu ersetzen, über die
ich kontaktiert werden konnte.

### Barrierefreiheit

Barrierefreiheit war einer der wichtigsten Punkte, die ich ansprechen wollte. Ich empfehle die
[WebAIM-Website](https://webaim.org/resources/evalquickref/) für alle, die
mehr darüber erfahren möchten, wie man eine Website für Menschen mit Behinderungen,
Bildschirmleseprogramme und mehr zugänglich macht. [Windows Narrator](https://en.wikipedia.org/wiki/Narrator_(Windows)) war ein nützliches
Werkzeug, um zu überprüfen, ob die Website für Bildschirmleseprogramme, die von sehbehinderten
Menschen genutzt werden, korrekt dargestellt wurde. Ich habe alle Elemente durchgesehen und sichergestellt, dass sie
ordnungsgemäß gelesen werden konnten, einschließlich Schaltflächen, Links und Bildern.

### Dunkle und helle Varianten

Auch das Umschalten zwischen dunklem und hellem Design war etwas, das ich gerne in Angriff nehmen wollte.
Zwar verlief der Prozess dank Tailwind größtenteils reibungslos, doch ich kam nicht weiter, als ich versuchte,
verschiedene Varianten der Code-Hervorhebung und der Bilder für beide Designs zu erstellen.

Für Blockcode-Segmente, die ich mit [highlight.js](https://highlightjs.org/) hervorgehoben habe,
habe ich einen Beobachter geschrieben, der Änderungen am Attribut `body` abonniert und nach
der Klasse für das dunkle Design gesucht hat. Anschließend hat der Beobachter einen Stil-Einbinde-Befehl auf einen anderen
Pfad umgestellt. Der Code ist auf [GitHub](https://github.com/mykolamor/mcmikecreations.github.io/blob/a0e59cbf3ffa5ef7db229e896d98fbcba1b011b1/src/lib/renderers/DarkModeLinker.svelte) zu finden.

Bei Bildern hingegen war der Vorgang nicht ganz so intuitiv. Ich wollte
keine weiteren Observer verwenden und suchte nach einer reinen CSS-Lösung. Da
Tailwind bereits dunkle Varianten unterstützte, versuchte ich, die Funktion
über `background-image` zu implementieren. Ich ersetzte die Bild-URL durch die des Bildes, das mich
interessierte, z. B. `class="bg-[url('{lightUrl}')] dark:bg-[url('{darkUrl}')]"`.
Leider funktionierte das nicht. Tailwind kompiliert die Klassen vorab, bevor sie
zur Build-Zeit ersetzt werden, sodass kein Hintergrundbild angezeigt wurde. Nach langem
Recherchieren stieß ich schließlich auf [diese](https://stackoverflow.com/a/70810692/2832341) React-Antwort auf StackOverflow.
Ich musste lediglich die URL in eine separate CSS-Variable verschieben, die
vom Client-Browser durch die tatsächliche URL ersetzt wird.

### Weitere wichtige Punkte

Ein weiteres Problem, mit dem ich zu kämpfen hatte, war, dass verschiedene Seiten unterschiedliche Fußzeilen hatten. Zwar
war es einfach, die Fußzeile in eine separate, parametrisierte Komponente auszulagern, doch lag das Problem
darin, die Parameter für jede Seite einheitlich festzulegen. Aus einem
mir unbekannten Grund wurde der Zustand der Fußzeile manchmal gespeichert und blieb
nach einem Seitenwechsel unverändert. Ich entschied mich für `+layout.ts`-Rückgabewerte aus
`load()`-Funktionen.

Zuletzt ist mir aufgefallen, dass die Vor- und Zurück-Navigation im Browser manchmal nicht funktionierte,
da die meisten Seiten keinen `<title>`-Tag im Head-Bereich enthielten. Anstatt
das Problem wie in den offiziellen Beispielen mit einer `store`-Variablen zu beheben, habe ich mich entschieden,
es in eine separate Komponente auszulagern und statischer zu gestalten.

### Framework-Komponenten

Eine der größten Hürden, die ich überwinden musste, war das Erlernen der Bezeichnungen für alle
mitgelieferten Komponenten. Obwohl sie sich ähnelten, unterschieden sie sich oft voneinander.


| Flowbite  | Flutter MaterialUI        |
|-----------|---------------------------|
| Accordion | ExpansionPanel            |
| Carousel  | CarouselSlider            |
| SpeedDial | FloatingActionButton      |
| Spinner   | CircularProgressIndicator |
| Tabs      | TabBarView                |

Und da ich aus dem Backend-Bereich kam, habe ich ähnliche Elemente immer wieder verwechselt. „Drawers“
sind einfach Sidebars mit versteckter Logik. „AppBars“ sind einfach NavigationBars mit etwas
Styling und voreingestellten Unterelementtypen. Eine „Gallery“ ist einfach ein vorgefertigtes Raster oder
eine verschachtelte Liste. Eine Fußzeile mit Links ist eine erweiterte untere Navigationsleiste. Eine BottomNav ist
eine Navigationsleiste mit Symbolen. Die Liste lässt sich endlos fortsetzen.

### Blogs

Ein weiteres Problem hatte ich mit den Blogs. Das `markdown-svelte`-Paket weist einige
Eigenheiten auf. Erstens müssen benutzerdefinierte Komponenten definiert werden, um verschiedene
Markdown-Elemente darzustellen. Die Standardkomponenten lassen sich nur schwer stylen (es sei denn,
sie werden mit `prose` aus `tailwind` umschlossen), insbesondere wenn Kompatibilität mit anderen
Framework-Komponenten gewünscht ist. Zweitens funktioniert aufgrund des Hydration-Schritts beim
clientseitigen Rendering, Routing und Vorladen von Daten das Inline-JavaScript innerhalb von
Markdown nicht wie beabsichtigt. Ich habe auf Reddit eine [Lösung](https://www.reddit.com/r/sveltejs/comments/16b1ipm/comment/jzapmyh/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button) gefunden, um
eine ganzseitige Navigation anstelle des Vorladens durchzuführen.

Wie dem auch sei, ich finde, die Website ist am Ende doch gut gelungen. Ich
danke euch, dass ihr bis hierher gelesen habt, und wünsche euch alles Gute.
