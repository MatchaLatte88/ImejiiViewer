# Imejii – Pre-Electron-/Launch-Audit

Stand: 4. September 2026. Geprüfter Commit: `bf4b822` (`Projekt in Imejii umbenannt`).

## Entscheidung

**NO-GO für einen öffentlichen Launch im aktuellen Stand.** Der Electron-Unterbau existiert bereits und startet. Packaging kann vorbereitet werden, aber die bestätigten Datei-, Bild- und Zustandsfehler sollten vor der Veröffentlichung behoben und erneut getestet werden.

Es wurde **kein Anwendungscode verändert**, kein Paket aktualisiert und kein Release erstellt. Neu sind ausschließlich diese Audit-Unterlagen, reproduzierbare Prüfskripte und synthetische Testdaten. `dist/` wurde durch den regulären Build neu erzeugt. Der anfänglich saubere Git-Arbeitsbaum hat danach nur den neuen Ordner `audit/` als Änderung.

### Kurzbilanz

| Prüfung | Ergebnis |
| --- | --- |
| `npm run build` | Erfolgreich; Vite 7.3.6, 99 Module, ca. 1,1 s |
| `npm ls --depth=0` | Keine fehlenden/ungültigen direkten Abhängigkeiten gemeldet |
| `npm audit --json` | 0 bekannte Schwachstellen im abgefragten Abhängigkeitsbaum |
| Production-Renderer unter Electron 44.1.1 | Startet über `file://`; Bridge vorhanden, `window.require` nicht verfügbar |
| Content Security Policy | Fehlt; Electron gibt eine entsprechende Sicherheitswarnung aus |
| 30 gezielte Audit-Assertions | **9 bestanden, 21 fehlgeschlagen** |
| Native UI | Start mit SVG-Dateiargument, Viewer → Images → Logo, Freistellung, Dark/Light und Speicherdialog geprüft |
| Installer / signiertes Release | Noch nicht vorhanden, deshalb nicht abnehmbar |

Die 30 Assertions wurden gezielt auf vermutete Schwachstellen zugeschnitten. Sie sind **keine repräsentative Fehlerquote der gesamten App**; beispielsweise entfallen sieben Fehlschläge auf denselben EXIF-Grundfehler. Vier Checks untersuchen die unveränderten Main-Handler mit simuliertem Dateisystem, 26 laufen gegen echte Anwendungsmodule im echten Electron-/Chromium-Renderer. Datei-Dialoge und Export-Schreibzugriffe dieser automatisierten Tests sind abgefangen.

## Bestätigte priorisierte Befunde

P1 = vor Veröffentlichung beheben; P2 = Funktionsfehler bzw. relevante Härtung, ebenfalls vor Release bereinigen oder ausdrücklich als Einschränkung akzeptieren. Kein P0 und keine bereits erfolgte Kompromittierung nachgewiesen.

### A01 · P1 · Ordnerexport kann Originaldateien still überschreiben

Fundstelle: [electron/main.cjs:311](D:/Workspace/ImejiiViewer/electron/main.cjs:311), aufgerufen aus [desktop.js:110](D:/Workspace/ImejiiViewer/src/lib/desktop.js:110).

`file:writeInto` schreibt mit `fs.writeFile(target, …)` ohne Kollisionsprüfung, exklusives Anlegen oder Überschreibbestätigung. Anders als der Einzeldatei-Export wird dabei kein Save-Dialog pro Datei angezeigt.

Reproduktion: Ein JPEG mit dem Standardmuster `{name}` als JPEG exportieren und seinen Quellordner als Ziel wählen. Der berechnete Zielname entspricht dem Original. Dasselbe betrifft vorhandene Favicon-/Icon-Dateien beim Bundle-Export.

Nachweis: Main-Check bestätigt den ungeschützten Schreibaufruf. Es wurden keine echten Originaldateien überschrieben.

Abnahme: bestehende Dateien niemals ungefragt ersetzen; eindeutige Namen oder explizite Konfliktentscheidung; Quell-/Zielgleichheit erkennen; sichere temporäre Ausgabe und atomare Fertigstellung prüfen. Test mit bestehenden Dateien und Schreibfehler nach mehreren Ausgaben.

### A02 · P1 · Die Electron-Bridge erlaubt beliebige Dateipfade

Fundstellen: [electron/main.cjs:280](D:/Workspace/ImejiiViewer/electron/main.cjs:280), [electron/main.cjs:311](D:/Workspace/ImejiiViewer/electron/main.cjs:311), [preload.cjs:16](D:/Workspace/ImejiiViewer/electron/preload.cjs:16).

Die Main-Handler prüfen weder `senderFrame`/Absender noch ein vom Main-Prozess vergebenes Dateirecht. `files:read` liest auch Nicht-Bilddateien; `file:writeInto` akzeptiert frei gewählte Ordner und `..`-Segmente. Eine vorherige Ordnerauswahl ist technisch nicht erforderlich. Der Test konnte einen untrusted Absender mit einem `.txt`-Pfad durchreichen und `D:\audit-output` + `..\escaped.txt` zu `D:\escaped.txt` auflösen.

Das ist **kein Nachweis eines allein durch Bildöffnung ausgelösten Remote-Exploits**. Es bedeutet aber, dass kompromittierter Renderer-Code über die vorhandene Bridge weitreichend lesen und schreiben könnte, trotz `sandbox: true`.

Abnahme: vertrauenswürdiges Main-Frame validieren; Main-seitig erlaubte Datei-/Ordner-Handles statt beliebiger Pfade; Payload-Typen und Größen begrenzen; relative Bundle-Unterpfade kontrollieren, einschließlich Windows-Sonderfällen und Symlinks/Junctions. Die [Electron-Sicherheitscheckliste](https://www.electronjs.org/docs/latest/tutorial/security) empfiehlt insbesondere Absenderprüfung und minimale Renderer-Berechtigungen.

### A03 · P1 · EXIF-Ausrichtung wird doppelt angewendet

Fundstellen: [photoLoader.js:28](D:/Workspace/ImejiiViewer/src/lib/photoLoader.js:28), [photoLoader.js:54](D:/Workspace/ImejiiViewer/src/lib/photoLoader.js:54), [photoLoader.js:102](D:/Workspace/ImejiiViewer/src/lib/photoLoader.js:102).

Das verwendete `Image`-Element berücksichtigt die EXIF-Ausrichtung bereits. `drawOriented` transformiert anschließend noch einmal; auch die Metadaten-Dimensionen werden erneut vertauscht.

Nachweis: synthetische JPEGs mit allen acht Orientierungen unter Electron 44.1.1. Orientierung 1 stimmt, **2–8 liefern falsche Pixelorientierung**. Für Orientierung 6 ist das native Ergebnis `40×80`, die App erzeugt `80×40`. Betroffen sind Thumbnail, Viewer und Fotoexport.

Abnahme: exakt eine verantwortliche Orientierungsstufe; Referenztests für 1–8 inklusive Dimensionen, Spiegelung, Vorschau, Crop und Export.

### A04 · P1 · Schneller Bildwechsel kann Name und Bildinhalt entkoppeln

Fundstelle: [library.js:139](D:/Workspace/ImejiiViewer/src/stores/library.js:139).

`select()` setzt `activeId` vor dem asynchronen Decode. Ein älterer Decode darf anschließend weiterhin `sourceCanvas`, `lastCommitted` und die Vorschau überschreiben. Es fehlt ein Request-Token bzw. eine Prüfung, ob die Auswahl noch aktuell ist.

Nachweis: zwei echte PNGs, nur das Load-Ereignis eines Bilds kontrolliert verzögert. Ergebnis: `activeItem = fast.png` mit 30 px Breite, aber `sourceCanvas` stammt vom 80 px breiten vorherigen Bild.

Folge: Bearbeitungen können anhand des falschen Motivs erfolgen; der Export dekodiert wiederum die aktive Datei und kann von der sichtbaren Vorschau abweichen. Auch Entfernen/Leeren während eines Decode muss berücksichtigt werden.

Abnahme: nur der neueste gültige Decode darf Zustand committen; veraltete Erfolge und Fehler ignorieren; während des Wechsels keine Bearbeitung mit dem alten Canvas.

### A05 · P1 · Ordnerblättern verwirft bereits bearbeitete Bilder

Fundstelle: [library.js:297](D:/Workspace/ImejiiViewer/src/stores/library.js:297).

Reproduktion: ein Desktop-Bild öffnen → Images → bearbeiten → zurück in den Viewer → zum Nachbarbild blättern. `stepFolder` ersetzt den bisherigen Eintrag durch einen frischen und löscht dessen History. Der bloße Wechsel in den Viewer macht das Bild nicht unbearbeitet.

Nachweis: automatisierter Store-Test; der bearbeitete Eintrag und seine Drehung verschwinden aus der Sammlung.

Abnahme: bearbeitete Einträge behalten oder vor Verwerfen ausdrücklich entscheiden lassen; Speicherbegrenzung über Canvas-/Thumbnail-Cache statt durch Löschen des Bearbeitungszustands lösen.

### A06 · P1 · Batch-Namenskollisionen verlieren Ausgaben

Fundstelle: [library.js:637](D:/Workspace/ImejiiViewer/src/stores/library.js:637).

Die Kollisionsbehandlung hängt einmal `-<index>` an, prüft den neuen Namen aber nicht erneut. Für `a.png`, `a-3.png`, `a.jpg` mit PNG-Ausgabe entstehen **`a.png`, `a-3.png`, `a-3.png`**. Der spätere Eintrag ersetzt den früheren im ZIP bzw. im Zielordner. Zusätzlich ist der `Set`-Vergleich case-sensitive, Windows-Zielpfade sind es üblicherweise nicht.

Nachweis: echte Bilddekodierung und Batch-Namensbildung; drei Ausgaben, nur zwei eindeutige Namen.

Abnahme: so lange neue Namen bilden, bis der normalisierte Zielpfad eindeutig ist; vorhandene Zieldateien und Windows-Namensregeln ebenfalls einbeziehen.

### A07 · P2 · Navigation und CSP sind nicht ausreichend gehärtet

Fundstellen: [electron/main.cjs:119](D:/Workspace/ImejiiViewer/electron/main.cjs:119), [index.html:1](D:/Workspace/ImejiiViewer/index.html:1).

Bei zwei `file://`-URLs ist `URL.origin` jeweils der String `"null"`. Der vorhandene Origin-Vergleich erlaubt damit die Navigation zu einer anderen lokalen HTML-Datei. Im Test wurde sie nicht verhindert. Eine Content Security Policy fehlt vollständig; der Production-Renderer bestätigt dies und Electron warnt.

Abnahme: exakte Navigations-Allowlist bzw. Navigation ganz sperren; eigenes App-Protokoll prüfen; restriktive Produktions-CSP einschließlich `connect-src`, `object-src`, `frame-src` und `base-uri`. Das Inline-Theme-Script braucht dabei eine kompatible Lösung. Entwicklungsserver-URL nur in echter Entwicklung zulassen. Ergänzende Referenz: [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security).

### A08 · P2 · Undo-/Redo-Buttons reagieren im Images-Modus nicht korrekt

Fundstellen: [library.js:77](D:/Workspace/ImejiiViewer/src/stores/library.js:77), [library.js:93](D:/Workspace/ImejiiViewer/src/stores/library.js:93).

Die History liegt in einer normalen, nicht reaktiven `Map`. Die Computeds `canUndo`/`canRedo` werden durch Änderungen ihrer internen Arrays nicht invalidiert.

Nachweis: nach abgeschlossener History-Aufzeichnung bleibt `canUndo === false`. Im echten Desktop-Fenster zusätzlich bestätigt: B&W angewendet, „1 edited“ sichtbar, Undo weiterhin deaktiviert. Ein Menü-/Tastatur-Undo kann trotzdem funktionieren; der Befund betrifft insbesondere die Verfügbarkeit in der Oberfläche.

Abnahme: reaktive History oder explizite reaktive Versions-/Längenwerte, Tests für Buttons und Tastatur nach Edit, Undo, Redo und Bildwechsel.

### A09 · P2 · History-Snapshots gehen beim Wechsel und bei „Apply to all“ verloren

Fundstellen: [library.js:157](D:/Workspace/ImejiiViewer/src/stores/library.js:157), [library.js:481](D:/Workspace/ImejiiViewer/src/stores/library.js:481), [library.js:506](D:/Workspace/ImejiiViewer/src/stores/library.js:506).

Die verzögerte History-Aufzeichnung ist global und bezieht sich beim Ausführen auf das dann aktive Bild. `select()` setzt den letzten Snapshot neu, ohne eine ausstehende Bearbeitung des alten Bilds zu flushen. „Apply to all“ ändert andere Bilder ohne deren vorherigen Zustand aufzuzeichnen.

Nachweise: drehen → sofort anderes Bild → zurück → Undo lässt 90° stehen. Bei „Apply to all“ bleibt die Unschärfe am empfangenden Bild nach Undo unverändert.

Abnahme: Commit vor Auswahlwechsel, History je Bild, explizite Transaktion für Mehrbild-Änderungen; keine Zuordnung alter Timer zu neuen Bildern.

### A10 · P2 · Fertige Icon-Pakete enthalten Dateien mit falscher Endung

Fundstelle: [editor.js:396](D:/Workspace/ImejiiViewer/src/stores/editor.js:396).

Die Paketnamen sind feste `.png`-Namen, der Encoder verwendet aber das global ausgewählte Exportformat. Bei JPG entstehen JPEG-Dateien namens `favicon-16x16.png`; Manifest und HTML deklarieren sie weiterhin als PNG. WebP ist analog betroffen.

Nachweis: Favicon-Paket mit `format: 'jpeg'`; die erste `.png` beginnt mit `FF D8 FF`, nicht mit der PNG-Signatur.

Abnahme: plattformspezifische Pakete erzwingen ihre erforderlichen Formate, oder Namen und alle Verweise werden konsistent geändert. Für die vorhandenen PNG-/Manifest-Pakete ist festes PNG die naheliegende Lösung.

### A11 · P2 · Batch-Export hat keinen stabilen Snapshot

Fundstelle: [library.js:616](D:/Workspace/ImejiiViewer/src/stores/library.js:616).

`const settings = batch.value` hält eine lebende Referenz. Format, Qualität, Muster, Bearbeitungen und die Bildliste bleiben während der asynchronen Verarbeitung veränderbar; nur der Export-Button selbst wird gesperrt. Entfernen oder Sortieren kann die Schleifenbasis verändern.

Nachweis: Format während eines verzögerten Decode von PNG auf JPG geändert → `slow.png` enthält JPEG-Daten, weil die Dateiendung aus der alten Konfiguration und der Encoder aus der neuen stammt.

Abnahme: unveränderlichen Snapshot der Liste, Edits, Wasserzeichen und Exportkonfiguration zu Beginn erstellen; alternativ alle relevanten Controls sperren. Fortschritt und Abbruch müssen konsistent bleiben.

### A12 · P2 · Spiegeln nach 90°-Drehung nutzt die falsche Achse

Fundstellen: [photoPipeline.js:185](D:/Workspace/ImejiiViewer/src/lib/photoPipeline.js:185), [library.js:419](D:/Workspace/ImejiiViewer/src/stores/library.js:419).

Die Canvas-Transformation kombiniert Rotation und Spiegelung in Quellkoordinaten. Nach 90° Drehung wirkt „horizontal“ daher wie eine vertikale Spiegelung im angezeigten Bild. `flipCropRect` verändert dagegen das Crop-Rechteck horizontal in angezeigten Koordinaten.

Nachweis: Referenz „erst tatsächlich drehen, dann das gedrehte Bild horizontal spiegeln“ ist pixelweise verschieden vom App-Ergebnis mit `rotate: 90, flipH: true`.

Abnahme: Achsenkonvention explizit definieren und für Bild und Crop identisch anwenden; Kombinationen aus 0/90/180/270°, beiden Spiegelungen und Crop testen.

### A13 · P2 · Batch-Größenvorschau ignoriert „Apply per-image edits: Off“

Fundstelle: [library.js:667](D:/Workspace/ImejiiViewer/src/stores/library.js:667).

Die Größenvorschau verwendet immer die vorhandenen Edits. Der Export benutzt bei ausgeschalteter Option hingegen `createEdits()`.

Nachweis: 80×40-Bild auf die Hälfte zugeschnitten, Edits im Batch ausgeschaltet → Vorschau 40×20, tatsächliche unbeschnittene Exportbasis 80×40.

Abnahme: Vorschau und Export verwenden dieselbe Funktion zur Ableitung der wirksamen Einstellungen.

## Weitere Code-Befunde und gezielte Nachtests

Die folgenden Punkte stammen aus der Codeprüfung, soweit nicht anders angegeben. Nicht jeder davon wurde im UI Ende-zu-Ende reproduziert.

| Priorität | Befund / Auswirkung | Stelle / nächste Prüfung |
| --- | --- | --- |
| P2 | Desktop-Drag-and-drop erhält keinen `desktopPath`. Ordnerblättern funktioniert damit nicht wie beim Öffnen über den Systemdialog. | [App.vue:89](D:/Workspace/ImejiiViewer/src/App.vue:89), [library.js:115](D:/Workspace/ImejiiViewer/src/stores/library.js:115), Preload ohne Pfadadapter für gedroppte `File`s. Über einen eng begrenzten Preload-Adapter lösen. |
| P2 | „Modified“ und Sortierung nach Datum sind bei Desktop-Import falsch: `File` wird ohne ursprüngliches `lastModified` gebaut; Main liefert kein `mtime`. | [desktop.js:14](D:/Workspace/ImejiiViewer/src/lib/desktop.js:14), [main.cjs:56](D:/Workspace/ImejiiViewer/electron/main.cjs:56). Mit Dateien unterschiedlicher Änderungsdaten nachtesten. |
| P2 | Teilweise erfolgreiche Öffnung wird komplett verworfen, wenn nur eine Datei fehlschlägt. | [desktop.js:30](D:/Workspace/ImejiiViewer/src/lib/desktop.js:30): wirft trotz vorhandener `result.files`. Gültige Dateien übernehmen und Fehler separat anzeigen. |
| P2 | Menü-/Shortcut-Export hat nicht denselben Fehlerfang und Busy-Schutz wie die Export-Panels. | [App.vue:135](D:/Workspace/ImejiiViewer/src/App.vue:135), [App.vue:148](D:/Workspace/ImejiiViewer/src/App.vue:148), [LogoMode.vue:48](D:/Workspace/ImejiiViewer/src/components/LogoMode.vue:48). Schreibfehler und mehrfaches Strg+S testen. |
| P2 | Keine Dirty-/Close-/Reload-Abfrage oder Sitzungssicherung; Reload ist sogar im Produktionsmenü verfügbar. | [main.cjs:186](D:/Workspace/ImejiiViewer/electron/main.cjs:186), Stores nur im Arbeitsspeicher. Im Audit-Testfenster war Schließen mit ungesicherten Testbearbeitungen ohne Rückfrage möglich. |
| P2 | `handedOver` kann auf ein früheres Bibliotheksbild zeigen, während im Logo-Modus eine andere Datei geladen wurde. | [App.vue:124](D:/Workspace/ImejiiViewer/src/App.vue:124). Sequenz A → Logo → dort B öffnen → Viewer A → Logo kann B behalten. Herkunft mit der wirklich geladenen Quelle abgleichen. |
| P2 | Pipetten-Hover rundet gültige Koordinaten am rechten/unteren Rand nach außerhalb. | [CanvasStage.vue:153](D:/Workspace/ImejiiViewer/src/components/CanvasStage.vue:153). Bei `y > height - 0.5` kann `.toString()` auf `undefined` aufgerufen werden. `floor`/Clamp verwenden und Randpixel testen. |
| P2 | Foto-JPEG-Export hat keine explizite Transparenz-Hintergrundfarbe oder Warnung, anders als Logo-JPEG. | [library.js:585](D:/Workspace/ImejiiViewer/src/stores/library.js:585). Transparente PNGs konvertieren und gewünschte Matte verbindlich festlegen. |
| P2 | Die Hochskalierwarnung vergleicht mit dem unbeschnittenen Original; Resize-Moduswechsel verwendet bereits skalierte Ausgabemaße als vermeintliche Ausgangsmaße. | [PhotoTransformPanel.vue:39](D:/Workspace/ImejiiViewer/src/components/panels/PhotoTransformPanel.vue:39). Kleinen Crop auf eine Größe unterhalb der Originalbreite, aber oberhalb der Cropbreite skalieren. |
| P3 | Dokumentiertes Strg+S fehlt im Browser-Bildmodus; Modifier-Filter setzt unter Electron `meta` auf false, sodass nicht vom Menü abgefangene Ctrl-/Alt-Kombinationen als einfache Bildkürzel wirken können. | [usePhotoShortcuts.js:20](D:/Workspace/ImejiiViewer/src/composables/usePhotoShortcuts.js:20). Browser/Desktop und Fokus in Textfeldern getrennt testen. |
| P3 | Globale Crop-/Vergleichs-Drag-Listener werden nur bei Pointer-up entfernt, nicht beim Unmount. | [PhotoViewer.vue:141](D:/Workspace/ImejiiViewer/src/components/PhotoViewer.vue:141), [PhotoViewer.vue:305](D:/Workspace/ImejiiViewer/src/components/PhotoViewer.vue:305). Moduswechsel während eines Drags testen. |
| P3 | Accessibility: unbenannte Zahlenfelder, klickbare Thumbnail-`li` ohne Tastatursemantik, Toast ohne Live-Region; Segmented-Control-Disabled ist nur CSS. | [SliderControl.vue:60](D:/Workspace/ImejiiViewer/src/components/ui/SliderControl.vue:60), [LibraryStrip.vue:68](D:/Workspace/ImejiiViewer/src/components/LibraryStrip.vue:68), [App.vue:223](D:/Workspace/ImejiiViewer/src/App.vue:223). Unbenannte Spinbuttons im nativen Accessibility-Baum bestätigt. |
| P3 | Desktop-Oberfläche bewirbt ZIP, speichert aber Ordner. README nennt acht Bridge-Funktionen, tatsächlich sind es mehr; 4096px-Limit gilt nicht für den Fotoexport. | [PhotoExportPanel.vue:289](D:/Workspace/ImejiiViewer/src/components/panels/PhotoExportPanel.vue:289), [ExportPanel.vue:149](D:/Workspace/ImejiiViewer/src/components/panels/ExportPanel.vue:149), [README](D:/Workspace/ImejiiViewer/README.md). Texte gegen tatsächlichen Ablauf abgleichen. |

## Speicher, Performance und Robustheit

Architekturprüfung, **kein Langzeit-/Maximallast-Benchmark**:

- Fotoansicht wird auf 2600 px begrenzt, Logo-Arbeitsdaten auf 4096 px. Diese Maßnahmen helfen, begrenzen aber nicht die ursprüngliche Browser-Dekodierung oder den Fotoexport.
- `readPhotoInfo` lädt jedes Bild über ein `Image`-Element, um ein Thumbnail zu zeichnen. Es ist kein reiner Header-Reader. Ein aktives Bild wird anschließend erneut dekodiert.
- Main liest bei Mehrfachauswahl alle Dateien vollständig und liefert sie gemeinsam als ArrayBuffer. Bibliothek und Batch halten Dateien bzw. fertige Export-Blobs gesammelt. Auch Desktop-Ordnerexport beginnt erst nach dem Rendern aller Ergebnisse.
- Fotoexport dekodiert ohne maximale Kantenlänge; Pixelarbeit läuft synchron im Renderer. Blur allokiert zwei Float32-RGBA-Puffer: bei 24 MP allein etwa **768 MB dezimale Pufferdaten**, zusätzlich zu Canvas, ImageData und Quelldatei. Das ist eine Rechnung aus den Allokationen, keine gemessene Peak-RAM-Zahl.
- Es fehlen Import-/Export-Abbruch, harte Pixel-/Dateigrößen-Budgets und eine zentrale Behandlung von `render-process-gone`/Ladefehlern.
- Die 100%-Ansicht großer Fotos basiert auf der auf 2600 px reduzierten Vorschau, nicht auf einer nachgeladenen 1:1-Originalansicht. Als Viewer-Produktentscheidung dokumentieren oder echtes Detail-Nachladen ergänzen.

Vor Release: repräsentative 12/24/48-MP-Bilder, sehr breite Panoramen, fehlerhafte Dateien und 100–1000 Bilder testen; RAM und längste UI-Blockade messen. Für Desktop Ergebnisse schrittweise in einen vorher gewählten, kontrollierten Zielordner schreiben. Worker/OffscreenCanvas oder eine andere entkoppelte Verarbeitung prüfen. Keine konkrete Performance-Zusage ist durch diesen Audit belegt.

## Was bereits gut ist

- Klare Trennung zwischen Renderer, Bridge und Main; `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` gesetzt und Renderer ohne `require` gestartet.
- Keine frei exponierte `ipcRenderer`-Instanz; abonnierte Events reichen das Electron-Eventobjekt nicht an den Renderer weiter.
- Keine `v-html`-, `innerHTML`-, `eval`- oder dynamische Function-Verwendung im Anwendungscode gefunden. Imports werden über Bilddecoder verarbeitet, nicht als HTML eingebaut.
- Keine Bild-Uploads oder Netzwerkaufrufe in der Renderer-Anwendung gefunden. Das ist eine Codeprüfung, kein vollständiger Netzwerkmitschnitt.
- Relative Vite-Assetpfade funktionieren im lokalen Production-Renderer. ZIP-Code ist in einen separaten Chunk ausgelagert.
- Neutraler Foto-/Logo-Pipeline-Durchlauf erhält die Testpixel. PNG/JPEG/WebP liefern das angeforderte MIME und sind dekodierbar. ICO-Verzeichnis und sieben eingebettete PNG-Signaturen stimmen.
- Geometrie-Vorhersage stimmt in den getesteten Rotation-/Straighten-/Crop-Kombinationen mit dem tatsächlichen Canvas überein. Das Logo-Limit von 4096 px greift.
- Objekt-URLs werden in den Bildladern über `finally` freigegeben; History-Stacks haben Obergrenzen. Dateidialog-Abbruch beim Einzel-Export funktioniert.
- Im nativen Fenster funktionieren Startdatei, grundlegende Moduswechsel, automatische Hintergrundfreistellung und Theme-Umschaltung. Logo-Undo wird nach einer Änderung korrekt verfügbar, anders als Images-Undo.

## Electron-Wrap und Release-Gates

Der vorhandene Code ist bereits ein Development-/Preview-Wrap. Folgendes fehlt noch für ein verteilbares Produkt:

| Gate | Stand / Abnahmekriterium |
| --- | --- |
| Reproduzierbare Checks | Bisher kein `test`-/Lint-Script und keine CI-Konfiguration. Audit-Checks in eine dauerhafte Regression-Suite überführen; Clean-Install aus Lockfile separat prüfen. |
| Packaging | Kein Forge-/Builder-/anderes Packaging-Setup und kein erzeugter Installer. Zielsystem und Architekturen festlegen; `dist`, Main und Preload ausdrücklich einpacken; Quell-, Audit- und Entwicklungsdateien ausschließen. |
| Identität | App-ID, Produktname, echte Windows-/macOS-Icons, Publisher-/Versionsmetadaten und installierte Verknüpfungen festlegen. |
| Windows-Dateizuordnung | CLI-Dateiargumente existieren, Installer-Dateiassoziationen noch nicht. Explorer-Öffnen, „Öffnen mit“, Mehrfachdateien und zweite Instanz nach echter Installation prüfen. |
| Signing / Verteilung | Signatur-/Notarisierungs- und Downloadstrategie je Zielplattform entscheiden. Kein signiertes Artefakt getestet. |
| Updatepfad | Auto-Update ist nicht zwingend für Version 1, aber es braucht einen dokumentierten Weg für Sicherheitsupdates und Rollback. |
| Produktsicherheit | A01–A07 schließen; Produktions-CSP, Berechtigungs-Policy, Navigation und Electron-Fuses überprüfen. Keine alleinige Abhängigkeit von Renderer-Validierung. |
| Nutzerarbeit | Verwerfen/Schließen/Reload, Fehlerfälle, Exportabbruch und bestehende Zieldateien sicher behandeln. |
| Abnahmematrix | Sauberer Windows-Rechner ohne Node, nicht-administrativer Benutzer, Pfade mit Leerzeichen/Umlauten, schreibgeschützter Ordner, lange Pfade, Offlinebetrieb, DPI/Monitorwechsel. |
| Plattformen | macOS/Linux nicht getestet. Insbesondere Fenster erneut öffnen, Dateiübergabe während des Rendererstarts und Plattformmenüs nachtesten. |
| Dokumentation | Unterstützte Formate samt Animation/Metadaten/Qualitätsverlust präzisieren; Lizenz-/Third-Party-Hinweise, Datenschutzbeschreibung und Release Notes zusammenstellen. Kein rechtliches Gutachten Bestandteil dieses Audits. |

Die installierte Electron-Version 44.1.1 ist in der offiziellen [Releaseübersicht](https://releases.electronjs.org/release) gelistet. Versionsaktualität und ein leeres npm-Audit ersetzen keine Prüfung der eigenen IPC-Schicht.

## Testartefakte und Wiederholung

| Datei | Zweck |
| --- | --- |
| [main-checks.mjs](D:/Workspace/ImejiiViewer/audit/2026-09-04/main-checks.mjs) | Originale Main-Handler in isoliertem VM-Kontext; Dateioperationen nur simuliert |
| [main-results.json](D:/Workspace/ImejiiViewer/audit/2026-09-04/main-results.json) | Vier Main-/Sicherheits-Assertions |
| [renderer-checks.js](D:/Workspace/ImejiiViewer/audit/2026-09-04/renderer-checks.js) | Regressionsfälle gegen unveränderte Bild-/Store-Module |
| [run-renderer.cjs](D:/Workspace/ImejiiViewer/audit/2026-09-04/run-renderer.cjs) | Versteckte Electron-Testfenster mit separatem temporären Profil |
| [renderer-results.json](D:/Workspace/ImejiiViewer/audit/2026-09-04/renderer-results.json) | 26 Renderer-Assertions und Production-Startcheck |
| [native-smoke.cjs](D:/Workspace/ImejiiViewer/audit/2026-09-04/native-smoke.cjs) | Unveränderten Desktop-Einstieg mit separatem Profil und Audit-SVG starten |
| [fixture.svg](D:/Workspace/ImejiiViewer/audit/2026-09-04/fixture.svg) | Ausschließlich synthetisches visuelles Testbild |

Aus dem Projektverzeichnis in PowerShell:

```powershell
npm run build
node audit\2026-09-04\main-checks.mjs
node_modules\.bin\electron.cmd audit\2026-09-04\run-renderer.cjs
npm audit --json
```

Die Regression-Skripte liefern derzeit erwartungsgemäß Exitcode 1, weil sie korrektes Verhalten verlangen und die beschriebenen Fehler erkennen. Die JSON-Dateien werden bei Wiederholung aktualisiert. Die Renderer-Suite nutzt das bereits transitiv installierte esbuild, ohne zusätzliche Pakete zu installieren. Electron legt nur eigene temporäre Audit-Profile an; Exportdaten bleiben im automatisierten Harness im Speicher.

Umgebungsnotiz: Electron-GPU-/Rendererstart scheiterte zunächst innerhalb der eingeschränkten Shell-Sandbox; außerhalb davon liefen die Tests mit unveränderter Electron-Sandbox-Konfiguration. Dieser erste Startfehler wird nicht als Produktfehler gezählt. Der npm-Sicherheitsaudit war nach erlaubtem Netzwerkzugriff erfolgreich.

## Grenzen und empfohlene Reihenfolge

Dies ist ein breiter Quellcode-, Build-, Dependency- und gezielter Laufzeitaudit, **keine Garantie der Fehlerfreiheit**. Nicht durchgeführt: vollständiges Fuzzing aller Decoder, Langzeit-/OOM-Test, externer Penetrationstest, kompletter Screenreader-Test, Safari/Firefox-Test, echte Installation/Deinstallation, Signaturprüfung oder Cross-Platform-Abnahme. AVIF/GIF/BMP und Sonder-EXIF-/Farbprofilvarianten sind nicht vollständig in der Testmatrix abgedeckt. Einzeldatei-Speichern wurde im nativen Dialog geprüft und abgebrochen; keine echte Datei wurde dadurch geschrieben.

Empfohlene Reihenfolge:

1. **Dateisicherheit:** A01, A02, A06 und A07.
2. **Bild- und Zustandskorrektheit:** A03–A05 sowie A08–A13; die Audit-Assertions müssen danach grün sein.
3. **Release-Robustheit:** Importfehler, Dirty-State, Speicherbudget, Abbruch, Desktop-Pfade und Metadaten.
4. **Packaging:** genau ein erstes Zielartefakt bauen und auf sauberer Zielumgebung abnehmen.
5. **Freigabe:** signiertes/gewähltes Distributionsartefakt, dokumentierte Einschränkungen und reproduzierbarer Release-Check.

**Fazit:** gute technische Grundlage und lauffähiger Desktop-Prototyp, aber noch keine belastbare Launch-Freigabe. Der nächste sinnvolle Schritt ist ein begrenzter Fix-Durchlauf mit anschließender Wiederholung dieser Tests – nicht das unmittelbare Veröffentlichen des bestehenden Builds.
