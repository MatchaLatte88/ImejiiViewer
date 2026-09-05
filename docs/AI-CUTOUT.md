# Subject Studio — lokale Freistellung und Motivbearbeitung

Stand: 5. September 2026, Plugin 1.1.0. Optionales First-Party-Plugin für den Images-Modus,
unabhängig von LaMa-Objektentfernung und vom bestehenden farbbasierten Logo-Keying.
Kein Cloud-Dienst, kein SDXL-Generator und kein Codex-Plugin.

## Bedienung

1. Desktop-App öffnen, Foto laden, **Images → Plugins → Background removal**.
2. **Enable plugin** aktiviert nur die Oberfläche. **Download model · 224 MB**
   lädt nach ausdrücklichem Klick die festgelegten Gewichte von Hugging Face/CDN.
3. **Cut out the subject** öffnet den geschützten Arbeitsbereich und berechnet
   automatisch die Motivmaske. **Cancel processing** beendet den Rechenprozess.
4. **Original / Cutout / Mask** vergleichen. Schachbrett sowie **Light / Dark**
   dienen ausschließlich der Kantenprüfung; sie werden nie ins Foto eingebrannt.
5. **Restore / Remove** korrigiert die Maske mit dem Pinsel. **Undo / Redo** gilt
   für Pinselstriche, **Reset refinements** setzt Pinsel und Kantenregler zurück.
   Im fokussierten Bild bewegen Pfeiltasten den Pinsel, Umschalt bewegt ihn weiter,
   Leertaste malt einen Punkt. Zoom und scrollbare Arbeitsfläche helfen bei Details.
6. **Edge balance** verändert weiche Übergänge in Richtung weniger Saum/mehr Detail;
   **Edge softness** macht die Maskenkante weicher. Das ist kein geometrisches
   Verkleinern/Vergrößern einer harten Silhouette und keine RGB-Farbsaumentfernung.
7. **Develop / Scene / Frame / Send** nutzen dieselbe Maske für die folgenden
   Studio-Funktionen. Regler lösen keine neue KI-Inferenz aus.
8. **Apply as new photo** speichert eine neue `…-cutout.png`- bzw. `…-studio.png`-Variante zuerst lokal
   und öffnet sie anschließend im Editor. Zum Teilen PNG exportieren; `.imejii`
   bewahrt das Ergebnis und die weiteren Foto-Bearbeitungen als portables Projekt.

Originaldatei und Ausgangsbearbeitung bleiben erhalten. Die Variante enthält den
gerenderten Foto-Bearbeitungsstand ohne Export-Wasserzeichen/-Verkleinerung;
vorherige Regler werden dabei gerastert, nicht nochmals auf die Variante angewendet.
Bestehende Quelltransparenz wird mit der Motivmaske multipliziert: Restore macht
ursprünglich transparente Bereiche nicht wieder sichtbar. JPEG hat kein Alpha.

## Studio-Werkzeuge

| Bereich | Funktionen |
| --- | --- |
| Mask | Weiche Motivmaske, Kantenregler, Restore-/Remove-Pinsel, eigener Maskenverlauf |
| Develop | Belichtung ±2 EV, Wärme, Tönung, Kontrast, Sättigung und Schärfe getrennt für Motiv/Hintergrund; Natural-, S/W-, Warm-/Cool-Looks |
| Develop-Presets | Natural photo, Portrait blur und Color splash: Farbiges Motiv vor S/W-Hintergrund |
| Scene | Transparenz, Originalfoto, Vollfarbe, gerichteter Zweifarbverlauf oder lokale Bilddatei; Cover/Contain, Position, Unschärfe |
| Frame | Originalgröße, maskenbasierter Zuschnitt oder zentriertes Produkt-/Stickerformat; Freiform, 1:1, 4:5, 3:2, 16:9; Motivrand |
| Frame-Finish | Motiv skalieren, verschieben und Deckkraft einstellen; Konturfarbe/-breite, Schattenstärke/-weichheit/-versatz |
| Send | Motiv oder Hintergrund an LaMa übergeben, Maske als PNG exportieren, zusammengehöriges Bild-/Maskenpaket für SDXL exportieren |

**Product photo** setzt einen weißen Hintergrund, zentriert das sichtbare Motiv
mit Rand und leichtem Schatten. **Sticker** nutzt Transparenz, weiße Kontur und
Schatten. Produktformate bieten 1024/2048/4096 px an der langen Kante. Das ist
normale Bildskalierung, kein KI-Upscaling; Vergrößerung wird angezeigt.
Die Einstellungen können danach individuell verändert werden.

Der Motivzuschnitt folgt den sichtbaren Maskengrenzen einschließlich vorhandener
Quelltransparenz. Mehrere Motive bleiben eine gemeinsame Auswahl. Passt ein
Seitenverhältnis nicht ohne Abschneiden in die Quelle, erscheint eine Warnung.
Masken unter Alpha 8 zählen nicht zur Motivgrenze. Die Vorschläge sind keine
semantische Auswahl einer Person oder Bildbewertung; vor dem Speichern prüfen.
Im zugeschnittenen/verschobenen Layout wird die Maske ausschließlich in **Mask**-
Ansicht in ursprünglichen Bildkoordinaten bearbeitet.

Die Unschärfe ist gleichmäßig, nicht tiefenabhängig. Beim Originalhintergrund
werden Motivpixel aus den Blur-Samples ausgeschlossen, um deren Farben nicht
nach außen zu verschmieren. Sehr schwierige Maskenkanten bleiben korrigierbedürftig.
Kontur und Schatten sind grafische Effekte, keine physikalische Lichtsimulation.
Ein Originalhintergrund unterstützt lokale Korrekturen/Zuschnitt, aber keine
freie Motivverschiebung; dafür einen neuen oder transparenten Hintergrund wählen.
Eine Collage besteht hier aus einem Motiv und einem Hintergrundbild, nicht aus
einem freien Mehr-Ebenen-Editor.

Stil-Undo/Redo ist unabhängig von Pinsel-Undo/Redo. Reglerbewegungen werden kurz
gruppiert; Presets und Reset bilden eigene Schritte. Laden einer neuen
Hintergrunddatei beginnt einen neuen Stil-Verlauf, damit Undo keine entfernte
Bilddatei referenziert. Pfeil-/Zahlenfelder behalten ihre normale Tastaturbedienung.
**Cancel composition** kann die Vollauflösungsberechnung vor dem Speichern abbrechen.

## Maskenübergabe und SDXL-Austausch

**Open in Object removal** benötigt das separat heruntergeladene LaMa-Modell.
Nach Bestätigung wird der ursprüngliche Arbeitssnapshot mit der Auswahl geöffnet,
nicht die gestaltete Studio-Komposition. Es wird nichts automatisch entfernt.
Die Auswahl bleibt übermal-/radierbar; Clear und Restore transferred mask sind
verfügbar. Die Auswahl erhält einen 2-px-Sicherheitsrand auf Arbeitsmaskenauflösung.
LaMa verlangt weniger als 65 % maskierte Fläche; umfangreichere Auswahlen können
stattdessen exportiert werden. Übergabe-Herkunft wird an der LaMa-Variante gespeichert.

**Export mask PNG** schreibt eine deckende Graustufenmaske in Quellauflösung.
Weiß bedeutet ausgewählt/neu zu malen, Schwarz erhalten, Grau weiche Übergänge.
**Export image + mask for SDXL** erzeugt ein ZIP mit:

- `image.png`: ursprüngliches Arbeitsfoto, vor den Studio-Stilen.
- `mask.png`: dazu pixelkoordinatengleiche Graustufenmaske.
- `selection.json`: Version, Abmessungen, Auswahl, Polarität und Modellherkunft.
- `README.txt`: Verwendung und Grenzen; kein ausführbarer Workflow.

Quellbild und Maske gemeinsam skalieren; manche Inpainting-Backends erwarten
invertierte Masken. EXIF-Allowlist und GPS-Opt-in des Quellbildes gelten weiterhin.
Export ist auch ohne installiertes LaMa möglich. Das geplante eigene SDXL-Studio
bleibt separat: Hier werden weder SDXL-Gewichte installiert noch Bilder generiert.

## Modell und Grenzen

| Bestandteil | Festgelegtes Verhalten |
| --- | --- |
| Modell | `onnx-community/BiRefNet_lite-ONNX`, `onnx/model.onnx`, MIT |
| Revision | `de15b22ba131738a16dff04aab8bdf8dc32e3ac1` |
| SHA-256 | `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333` |
| Download | 224.005.088 Bytes, ungefähr 213,6 MiB |
| Laufzeit | ONNX Runtime Node 1.29.0, CPU, separater Electron-Utility-Prozess |
| Eingabe | `input_image`: Float32 RGB NCHW `[1,3,1024,1024]` |
| Vorbereitung | Quadratische Skalierung, `/255`, ImageNet-Mittelwerte/Standardabweichungen |
| Ausgabe | `output_image`: Float32-Logits `[1,1,1024,1024]`, Sigmoid → Alpha |
| Foto-Limit | Quelle und Ergebnis bis 24 MP; größere Fotos als kleinere Kopie exportieren |
| Arbeitsmaske | Lange Kante bis 2048 px; 120 Striche, insgesamt 24.000 Punkte |
| Ergebnis | Originalabmessungen, Motivzuschnitt oder Produktformat; sRGB/8 Bit mit Alpha |
| Rechenlimit | Ein Job, höchstens vier CPU-Threads, 240 Sekunden Timeout |

Die Maskenauflösung ist **nicht** gleich der Fotoauflösung. Das Modell analysiert
1024 × 1024 px; das Foto selbst wird für die Ergebnisdatei nicht so verkleinert.
Kleine Haare, Fell, Glas, Löcher zwischen Fingern und überlappende Motive können
fehlerhaft sein. BiRefNet ist kein Garant für physikalisch korrektes Alpha-Matting
oder die Auswahl einer bestimmten Person in einer Gruppe. Es gibt kein Prompting,
keine automatische Farbsäumen-Korrektur, kein GPU-Backend und keine Stapelfreistellung.

Die RGB-Farben werden nicht generativ ersetzt. Wie bei anderer Canvas-Komposition
können teiltransparente Pixel durch 8-Bit-Premultiplikation Rundungsabweichungen haben.
Helle/dunkle Hintergründe vor dem Übernehmen prüfen und bei Bedarf korrigieren.

Der native Prozess benötigt während der Inferenz mehrere GiB Arbeitsspeicher;
224 MB Download sind nicht der RAM-Bedarf. Im Test wurden rund 6,1 GiB Spitzen-
Working-Set nur für den KI-Prozess gemessen; 16 GB System-RAM sind empfohlen.
Auf dem Entwicklungsrechner brauchte
das reale 1024 × 683-Testfoto rund 12 Sekunden einschließlich Modellprüfung und
Komposition. Das ist keine Geschwindigkeitsgarantie oder Abnahme für schwache PCs.
Rechenprozess und native Speicherbelegungen werden nach jedem Ergebnis freigegeben.

## Architektur, Sicherheit und Speicherung

- Manifest und UI werden über die bestehende Plugin-Registry geladen. Aktivierung,
  Download, Lizenzangaben und Modellstatus bleiben pro Plugin getrennt. Gleichzeitige
  Modelloperationen können keine fremde „Ready“-Anzeige mehr erzeugen.
- Der bestehende Foto-Host hält Snapshot, globale Bediensperre und neue Variante.
  Speichern scheitert sicher bei veralteter Quelle oder voller lokaler Ablage.
  Scheitert nur das Wiederöffnen, bleibt die Vorschau erhalten; ein Wiederholungs-
  versuch verwendet dieselbe persistierte Variantenkennung.
- `electron/ai-models.cjs` lädt ausschließlich bekannte HTTPS-Quellen, begrenzt
  Größe/Redirects/Zeit und prüft SHA-256 vor Installation und vor jedem Modellladen.
- `electron/cutout.cjs` erlaubt genau einen festen Modelltyp und ein begrenztes,
  validiertes Eingabetensorformat. Keine Renderer-Pfade, URLs, Modelle, nativen
  Module, Ausführungsoptionen oder Provider werden übernommen.
- `electron/cutout-worker.cjs` führt ausschließlich lokale CPU-Inferenz aus. Dieser
  native Utility-Prozess ist vom Renderer getrennt, **keine OS-Sicherheits-Sandbox**.
  Abbruch, Timeout, Reload, Fenster-/App-Schließen und Fehler beenden den Prozess;
  verspätete Ergebnisse werden verworfen. Der Renderer bleibt sandboxed ohne Node;
  CSP und Main-Frame-Senderprüfung werden nicht gelockert.
- LaMa bleibt im bisherigen WebAssembly-Worker. BiRefNet Lite überschritt im echten
  WASM-Test die Speichergrenze; deshalb verwendet ausschließlich Cutout die native
  64-Bit-Laufzeit. Es gibt keinen stillen Cloud-Fallback.
- Windows-x64-Paket: nur Runtime-JavaScript von `onnxruntime-node/common` sowie
  `onnxruntime.dll` und `onnxruntime_binding.node`. Keine Modellgewichte,
  Installationswerkzeuge oder optionalen GPU-Bibliotheken. Native Binaries liegen
  in `app.asar.unpacked`; Versions-/Hashprüfung und Lizenzinventur laufen beim Build.

Nach dem Übernehmen liegt eine dauerhafte PNG-Variante in der lokalen Ablage.
`state.extensions['ai-cutout']` enthält Modellversion/-Hash, Quelle, Quellrezept,
Zeitpunkt, Kantenparameter und normalisierte Korrekturstriche. EXIF `Software` heißt
`Imejii / AI background removal`; die EXIF-Allowlist und GPS-Opt-in gelten weiterhin.
Das Info-Panel und spätere Exporte erhalten die Kennzeichnung. Das ist keine C2PA-Signatur.

Gestaltete Varianten können deckend sein. Sie enthalten zusätzlich `studio`,
`geometry` und bei Bildhintergründen Name/Abmessungen/SHA-256 der verwendeten Datei.
Ihr EXIF-Marker lautet `Imejii / AI subject composition` und ihr Dateisuffix `-studio.png`.
Der Marker bleibt bei erneutem Export erhalten. Die Studio-Rezeptdaten dokumentieren
die Entstehung; sie machen das gerasterte Ergebnis **nicht nachträglich in Ebenen editierbar**.
Das Projekt bettet weder Hintergrunddatei noch Motiv-Basismaske separat ein.

Die Vorschau rechnet bis 1200 px, die Hintergrundvorschau bis 1600 px; Export
verwendet das Quellfoto und die gewählte Hintergrunddatei in voller Auflösung.
Beide Wege teilen dieselbe Worker-Bildverarbeitung und normalisierte Geometrie.
Rasterung, Schärfung und Subpixelkanten können auf verschiedenen Auflösungen leicht
abweichen. Einzelne Kompositionsworker sind abbrechbar, laufen höchstens 120 Sekunden
und werden bei Änderung ersetzt. Quellen/Hintergründe/Ergebnisse sind auf 24 MP
und 16.384 px Kantenlänge begrenzt. Ein Bild-/Masken-ZIP ist auf 128 MiB begrenzt.

Die unbearbeitete AI-Basismaske wird **nicht** als separat editierbares Projektobjekt
gespeichert. Eine neue Plugin-Sitzung rechnet neu. Nicht übernommene Vorschauen und
Pinsel-Undo sind flüchtig; ein Absturz kann sie verlieren. Ein Variantenprojekt
enthält das freigestellte Raster, nicht zusätzlich die vollständige Originalquelle.
Plugin deaktivieren oder Modell entfernen löscht keine gespeicherten Fotos.

## Prüfung und Release

```text
npm test                       # Lint, Unit-, Canvas-/Browser-/Desktop-Regressionen
npm run test:cutout:download    # optionaler expliziter Download des Testmodells
npm run test:cutout             # echte Offline-Inferenz im isolierten Testprofil
npm run test:ai                 # Regression des bestehenden LaMa-Plugins
npm run test:studio             # beide Modelle, Studio-UI, Datei-/Maskenexport, LaMa-Übergabe
npm run pack:win
npm run verify:package
```

Testgewichte liegen ausschließlich im ignorierten `build/ai-models/`.
`IMEJII_CUTOUT_FIXTURE` kann für den End-to-End-Test ein eigenes Foto festlegen;
Standard ist die synthetische `tests/fixture.svg`. `IMEJII_PACKAGED_MAIN` erlaubt
dieselbe Prüfung des ASAR-Inhalts mit dem Test-Electron-Launcher.
Berichte und geprüfte Screenshots: `audit/2026-09-04/cutout-*`.
Studio-Prüfungen und Screenshots: `audit/2026-09-05/studio-*`.

Die Funktion ist lokal implementiert und getestet, keine öffentliche Release-Freigabe.
Signierung, Downloadkanal und bestehende HEIC-Lizenz-Gates bleiben separat offen;
siehe [RELEASE.md](RELEASE.md). BiRefNet-MIT-Lizenz sowie ONNX-Lizenz-/Third-Party-Texte
liegen in `licenses/` und gehen in die Windows-Notices ein.

Primärquellen:

- [Festgelegte Modellkarte](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/blob/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/README.md)
- [Preprocessing-Konfiguration](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/blob/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/preprocessor_config.json)
- [BiRefNet-Projekt und MIT-Lizenz](https://github.com/ZhengPeng7/BiRefNet)
- [ONNX Runtime Node](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)
- [Electron UtilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
