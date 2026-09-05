# SDXL Studio — technische Übergabe

Stand: 5. September 2026

Projekt: Imejii · `D:\Workspace\ImejiiViewer`

Herausgeber: Frederik Morbe

Status: Übergabe zur nächsten Implementierung; SDXL selbst ist noch nicht integriert.

## 1. Auftrag und verbindlicher Umfang

SDXL wird ein optionales Imejii-Plugin **mit eigenem Hauptmodus**, gleichberechtigt
mit Images und Logo. Arbeitsname: **AI Studio**, vorgeschlagene Plugin-ID
`sdxl-studio`, vorgeschlagene modellunabhängige Modus-ID `ai-studio`.
Nicht mit dem bereits implementierten **Subject Studio** verwechseln:
Subject Studio ist der Freistellungs-/Kompositionsdialog innerhalb von Images.

Das Zielbild umfasst Text-to-Image, Image-to-Image und Inpainting, einschließlich
generierter Hintergründe über die vorhandene Motivmaske. Text-to-Image benötigt
kein geöffnetes Foto. Nur tatsächlich vom ausgewählten Provider unterstützte und
getestete Operationen dürfen als verfügbar erscheinen.

Festgelegt sind:

- Lokaler Betrieb, Desktop/Windows x64 zuerst; kein stiller Cloud-Fallback.
- Plugin, Oberfläche, Runtime und Modellgewichte getrennt behandeln.
- Ohne aktiviertes KI-Plugin bleibt die normale App vollständig verwendbar.
- Keine Modellgewichte im Installer; Downloads erst nach ausdrücklicher Aktion.
- Originale erhalten, Ergebnisse als bewusst übernommene Varianten speichern.
- Kein beliebiger Workflow-/Custom-Node-Import, kein Drittanbieter-JavaScript im Renderer.
- Keine verpflichtende LoRA-, ControlNet-, Refiner- oder Trainingsverwaltung für v1.
- Kein automatischer Commit, Push, Modelldownload oder Release aus dieser Übergabe.

Die erste Backend-Wahl ist **noch offen**. Der Gesamtplan nennt eine vom Nutzer
gestartete lokale ComfyUI-Installation als ersten Integrationskandidaten;
stable-diffusion.cpp bleibt die zu bewertende Alternative. Das ist keine getroffene
Runtime-Entscheidung und kein Auftrag, beide als Pflichtabhängigkeiten einzubauen.

## 2. Welche Unterlage gilt wofür?

1. Diese Übergabe beschreibt den geprüften aktuellen Code und die Anschlussstellen.
2. [AI-PLUGINS-PLAN.md](D:/Workspace/ImejiiViewer/docs/AI-PLUGINS-PLAN.md)
   beschreibt das Produktziel: **eigener Modus**, einschließlich Text-to-Image.
3. [SDXL-INPAINTING.md](D:/Workspace/ImejiiViewer/docs/SDXL-INPAINTING.md)
   ist ein älterer technischer Entwurf, kein aktueller Implementierungsstand.
4. [AI-CUTOUT.md](D:/Workspace/ImejiiViewer/docs/AI-CUTOUT.md) und der
   [Subject-Studio-Testbericht](D:/Workspace/ImejiiViewer/audit/2026-09-05/SUBJECT-STUDIO.md)
   dokumentieren die vorhandenen Funktionen und Grenzen.
5. [RELEASE.md](D:/Workspace/ImejiiViewer/docs/RELEASE.md) bleibt die gesonderte Release-Abnahme.

Nicht ungeprüft aus den alten Plänen übernehmen:

- „Noch keine Plugin-/KI-Funktion“ und „BiRefNet nur Kandidat“ sind überholt.
- Der reine Inpainting-Seitenpanel-Ansatz und Ausschluss von Text-to-Image wurden
  durch die spätere Produktentscheidung ersetzt.
- BiRefNet läuft tatsächlich nativ auf der CPU, nicht im geplanten WASM-/WebGPU-Pfad.
- Persistente Maskenartefakte und gespeicherte KI-Sitzungen sind noch **nicht** vorhanden.
- Aussagen zu festen GPU-Backends, Modellkanälen, VRAM, Laufzeiten, Lizenzen oder
  gesetzlichen Pflichten sind keine bestandenen Gates. Vor einer Auswahl oder
  öffentlichen Zusage konkret verifizieren; C2PA ist nicht bereits implementiert.
- Erosion und Dilatation sind nicht allgemein invers. Keine falsche
  „Verkleinern + Vergrößern ergibt stets das Original“-Testannahme übernehmen.

Die beiden bisherigen Pläne bleiben durch diese Übergabe unverändert.

## 3. Ist-Stand, auf dem aufgebaut wird

| Bestandteil | Implementiert | Wichtig für SDXL |
| --- | --- | --- |
| Plugin-Registry | Zwei fest gebündelte, lazy geladene First-Party-Plugins, Host-API v1 | Noch keine Registry für vollständige Arbeitsbereiche oder nachladbare Pakete |
| AI Remove | LaMa, eigener Modellstatus, WASM-Worker, Vorschau und neue Variante | Kein SDXL; 512-px-Kontext, höchstens 65 % maskierte Fläche |
| AI Cutout 1.1.0 | BiRefNet Lite, native CPU-Inferenz im Utility-Prozess | Automatische Motivmaske mit Kantenreglern und Korrekturpinsel |
| Subject Studio | Getrennte Korrekturen, Blur, Hintergründe, Produkt-/Stickerformate, Crop | Wiederverwendbare Masken-/Kompositionslogik, kein generatives Backend |
| LaMa-Übergabe | Original-Arbeitssnapshot plus korrigierte Auswahl | Atomare Host-Übernahme, Quelle unverändert, keine automatische Inferenz |
| SDXL-Austausch | Masken-PNG und Bild-/Masken-ZIP | Export vorhanden; Import und direkte SDXL-Übergabe fehlen |
| Dauerhafte Ergebnisse | PNG-Variante, Herkunft und Rezeptdaten in Saved work/Projekt | Gerasterte Ergebnisse, keine nachträglich editierbaren Studio-Ebenen |
| Runtime/Modelle | Getrennte Verwaltung, feste IDs/Hashes, bewusster Download | Noch kein SDXL-Katalogeintrag und kein SDXL-Prozess |

Aktueller technischer Stack: Vue 3, Pinia, Vite, Electron 44.1.1,
ONNX Runtime Node/Web 1.29.0; Entwicklung mit Node 24 und PowerShell.

Der zuletzt geprüfte HEAD ist `8217d44` (Foto-Projekte/Farbmanagement).
Die anschließenden KI-/Studio-Änderungen liegen bei Erstellung dieser Übergabe
noch im **nicht committeten Arbeitsstand**, darunter neue, ungetrackte Dateien.
Ein neuer Checkout dieses Commits allein enthält diese Grundlage nicht!
Vor Weiterarbeit `git status` prüfen und den vollständigen Arbeitsstand erhalten.
Unabhängige lokale Dateien nicht überschreiben oder aufräumen.

## 4. Bestehender Bild-/Maskenvertrag — exakt übernehmen

Implementierung:
[mask-transfer.js](D:/Workspace/ImejiiViewer/src/plugins/mask-transfer.js),
[host.js](D:/Workspace/ImejiiViewer/src/plugins/host.js),
[CutoutWorkspace.vue](D:/Workspace/ImejiiViewer/src/plugins/ai-cutout/CutoutWorkspace.vue).

### Quelle und Koordinaten

`capturePluginPhoto(signal)` erstellt den aktuellen vollständig gerenderten
Foto-Bearbeitungsstand ohne Export-Wasserzeichen und ohne Export-Verkleinerung.
Das ist **nicht automatisch die unbearbeitete Datei**. Bestehende Foto-Edits,
Drehung und Beschnitt sind Teil dieses Arbeitssnapshots.

Der heutige Send-Bereich verwendet diesen Snapshot **vor** den anschließenden
Subject-Studio-Stilen. Produktzuschnitt, Ersatzhintergrund, Schatten oder
Color-Splash werden nicht in das Austauschbild übernommen. Diese Trennung muss
im späteren „In AI Studio öffnen“-Dialog verständlich bleiben.

Interne Masken sind Canvas-RGBA mit Auswahl in **Alpha**, nicht in RGB.
`selectionMask(source, matte, area, { forRemoval: false })` unterstützt
`area = 'subject' | 'background'`:

```text
subjectAlpha = matteAlpha × sourceAlpha / 255
backgroundAlpha = 255 − subjectAlpha
```

`forRemoval: true` ist die LaMa-Spezialvorbereitung: ab Alpha 8 binarisieren und
auf Arbeitsmaskenauflösung um 2 px dilatieren. Diese Entscheidung und das
65-%-Flächenlimit nicht ungeprüft auf SDXL übertragen.

### Exportformat v1

`host.exportMask(mask, area, true)` erzeugt `…-subject-inpaint.zip` bzw.
`…-background-inpaint.zip` mit genau diesen Dateien:

```text
image.png       Arbeitssnapshot vor Subject-Studio-Komposition
mask.png        gleich große, vollständig deckende Graustufenmaske
selection.json  Formatbeschreibung und Herkunft
README.txt      Datenformat, Polarität und Nutzung
```

`mask.png`: **Weiß = neu zu malen, Schwarz = erhalten, Grau = weicher Übergang**.
Für diesen Export gilt `R = G = B = interne Auswahl-Alpha`, `A = 255`.
Ein Importer darf also nicht die PNG-Alpha als Auswahl lesen: Das würde alles auswählen.

Beispiel des vorhandenen JSON-Schemas, mit einem tatsächlichen BiRefNet-Modellhash;
Abmessungen/Quellname sind exemplarisch:

```json
{
  "version": 1,
  "width": 1024,
  "height": 683,
  "selection": "background",
  "polarity": "white-repaint-black-preserve",
  "source": "image.png",
  "mask": "mask.png",
  "sourceName": "subject.jpg",
  "model": "birefnet-lite-v1",
  "modelSha256": "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333"
}
```

`model` bezeichnet hier das **Segmentierungsmodell**, kein SDXL-Zielmodell.
Der Export enthält derzeit keine Dokumentrevision, Quellbild-Prüfsumme, Job-ID,
Prompts oder fertigen Provider-Workflow. Diese Daten nicht als vorhanden voraussetzen.
ZIP-Einträge nach Inhalt, Schema, Größe und Pfad prüfen; die JSON-Werte sind untrusted.
Vor einer künftigen Archivextraktion zusätzlich Traversal, doppelte Namen,
Symlinks und Dekompressionsbomben absichern. Wenn möglich begrenzt im Speicher lesen.

Heutige Grenzen: Quelle/Ergebnis bis 24 MP und 16.384 px Kantenlänge;
Arbeitsmaske bis 2048 px lange Kante; Vorschau bis 1200 px.
Der Export skaliert die Maske auf die **Quellauflösung**, nicht auf die Produktvorschau.
PNG-Datensumme vor ZIP höchstens 120 MiB, Exportdatei höchstens 128 MiB.
Das sind App-Grenzen, keine SDXL-Inferenzgrößen. Der Provider benötigt eigene Limits.

## 5. Konkrete Integrationsstellen und notwendige Änderungen

| Vorhandener Ort | Anschließende Arbeit |
| --- | --- |
| [registry.js](D:/Workspace/ImejiiViewer/src/plugins/registry.js) | Arbeitsbereichsbeiträge und passende Fähigkeiten ergänzen; vorhandene Plugins kompatibel halten |
| [PluginPanel.vue](D:/Workspace/ImejiiViewer/src/components/panels/PluginPanel.vue) | Aktivierungszustand aus dem lokalen Panel-Ref in eine gemeinsame Registry/Store-Verwaltung überführen; `imejii-plugins-v1` erhalten/migrieren |
| [App.vue](D:/Workspace/ImejiiViewer/src/App.vue), [AppHeader.vue](D:/Workspace/ImejiiViewer/src/components/AppHeader.vue), [ui.js](D:/Workspace/ImejiiViewer/src/stores/ui.js) | Expliziten Workspace-Vertrag für Zustand, Öffnen, Speichern, Undo/Redo und Moduswechsel einführen |
| [main.cjs](D:/Workspace/ImejiiViewer/electron/main.cjs), [preload.cjs](D:/Workspace/ImejiiViewer/electron/preload.cjs) | Modus-/Menübefehle und eng begrenzten Backend-Broker ergänzen; bestehende Senderprüfung verwenden |
| [host.js](D:/Workspace/ImejiiViewer/src/plugins/host.js) | Eigenständige Generierungsdokumente, Quellenrevisionen und Ergebnisübernahme ohne aktives Foto ermöglichen |
| [library.js](D:/Workspace/ImejiiViewer/src/stores/library.js) | Snapshot-/Variantenlogik über Host weiterverwenden; keine direkten Store-Mutationen aus Provider-Code |
| [drafts.js, Bibliothek](D:/Workspace/ImejiiViewer/src/lib/drafts.js), [drafts.js, Store](D:/Workspace/ImejiiViewer/src/stores/drafts.js) | Versionierte Studio-Sitzungen, binäre Masken/Quellen/Varianten und Projektmigration implementieren |
| [photoMetadata.js](D:/Workspace/ImejiiViewer/src/lib/photoMetadata.js), [PhotoInfoPanel.vue](D:/Workspace/ImejiiViewer/src/components/panels/PhotoInfoPanel.vue) | Generierung/Inpainting getrennt kennzeichnen; Prompt-, Seed-, Provider-/Workflow-/Modellherkunft dauerhaft erhalten |
| [ai-models.cjs](D:/Workspace/ImejiiViewer/electron/ai-models.cjs), [ai-models.json](D:/Workspace/ImejiiViewer/shared/ai-models.json) | Bestehende feste Modellverwaltung nicht für beliebige URLs öffnen; Backend-eigene Modelle und Imejii-Downloads unterscheiden |

Besonders wichtig:

- `ui.mode !== 'logo'` bedeutet heute an mehreren Stellen „Bibliothek verwenden“.
  AI Studio darf nicht in diesen Fallback fallen. Dateieingang, Zwischenablage,
  Header, Save, Saved work, Undo, Compare und Shortcuts explizit routen.
- Die heutige Modalsperre `pluginActivity.active` blockiert fast alle Kernaktionen.
  Für einen dauerhaft sichtbaren Hauptmodus braucht es Workspace-Lebensdauer und
  Job-Zustand: Moduswechsel darf weder die Sitzung noch laufende Jobs vernichten.
  Alte Cutout-/LaMa-Dialoge müssen ihre Schutzwirkung behalten.
- `host.handoff()` akzeptiert heute **nur `ai-remove`**, inklusive privater
  Snapshot-Übernahme. Eine neue Ziel-ID allein erzeugt keine SDXL-Integration.
- `createPhotoHost().apply()` setzt einen noch gültigen Fotosnapshot voraus und
  erwartet ein festes `manifest.model`. Für Text-to-Image und vom Backend gewählte
  SDXL-Modelle braucht es einen erweiterten Vertrag; keinen Fake-Snapshot erstellen.
- Das heutige `.imejii`-Format `IMEJII01` enthält einen JSON-Header und **eine Datei**.
  `kind` ist auf `photo | logo` beschränkt. IndexedDB v1 hat `sources` und `drafts`,
  keinen Masken-/Artefaktspeicher. Masken nicht als Canvas oder riesiges Base64 in
  `edits`/`extensions` ablegen; Migration und Mehr-Artefakt-Persistenz separat bauen.
- Vorhandene Limits: 100 Saved-work-Einträge, 2 GiB gespeicherte Quelldaten,
  128 MiB je Quelle, 2 MiB Rezept-JSON, 512.000 Zeichen Plugin-Extensions.
  Eine neue Variantenablage muss ihre Quoten und Aufräumregeln ausdrücklich definieren.
- Aktuelle EXIF-Marker decken Object removal, Background removal und Subject
  composition ab. SDXL darf nicht versehentlich als „AI object removal“ erscheinen.

## 6. Vorgeschlagener neuer Vertrag — noch nicht implementiert

Neue Komponenten unter einem SDXL-Studio-Plugin, einem gemeinsamen Artefakt-/Jobkern
und einem Main-Prozess-Broker ergänzen. Die alten Pläne enthalten dafür nur
Pfadvorschläge; vorhandene Dateien nicht ungeprüft umziehen oder doppelte Kerne bauen.

Ein Studio-Dokument sollte mindestens enthalten:

- Dokument-/Sitzungs-ID, Schemaversion und Revision.
- Operation: `text-to-image`, `image-to-image` oder `inpaint`.
- Quell- und Maskenartefakt-IDs mit Hash, Abmessungen und Koordinatenraum, soweit benötigt.
- Ausgewählte Quellvariante: unbearbeitete Quelle, aktueller Foto-Stand oder bewusst
  übernommene Studio-Komposition. Nie unterschiedliche Koordinaten still vermischen.
- Prompt, negativer Prompt, Seed und validierter Parameter-Snapshot.
- Provider-ID/-Version, Modellreferenz und geprüfte Workflow-ID/-Version.
- Ergebnisse als Artefaktreferenzen, Herkunft und expliziter Übernahmestatus.

Ein Job bindet Dokument-ID, Revision und unveränderliche Eingaben an eine eindeutige
lokale Job-ID und gegebenenfalls eine Backend-Job-ID. Zustand:
`queued → preparing → running → succeeded | failed | canceled`.
Nach Neustart nicht abgeschlossene Jobs als unterbrochen darstellen, nicht als
fortsetzbare Inferenz oder fertiges Ergebnis ausgeben.

Provider-Fähigkeiten müssen vorab prüfbar sein: unterstützte Operationen, Auflösungen,
Modell-/Workflow-Kombinationen, Fortschritt und Art des möglichen Abbruchs.
Der bestehende 65-%-LaMa-Guard darf Hintergrund-Inpainting nicht pauschal verhindern.

Für Inpainting zwei Maskenbegriffe trennen:

1. **Inferenzmaske**: Auswahl, wie sie das konkrete Backend erwartet.
2. **Kompositionsmaske**: Wo das Ergebnis in den gewählten Quellstand eingesetzt wird.

Ausschnitt, Kontext, Padding, Skalierung und Rückprojektion dokumentieren und testen.
Außerhalb der Kompositionsmaske bleiben Quellpixel bitgleich. Bestehendes Alpha
nicht ohne festgelegte Regel überschreiben. Gleichbleibender Seed ist keine
Garantie für bitgleiche Ergebnisse über verschiedene Backends/Hardware hinweg.

## 7. Backend-Sicherheit und Lebenszyklus

- Renderer-CSP bleibt insbesondere bei `connect-src 'self'`; Kommunikation zum
  lokalen Backend ausschließlich über validierte Main-Prozess-Operationen.
- Anfangs nur ausdrücklich konfigurierte Loopback-Ziele. Keine freie URL-,
  Shell-, Dateipfad- oder HTTP-Proxy-API für den Renderer.
- Zieladresse, Port, erlaubte Endpunkte, Redirects, Antwortgrößen, Zeitlimits und
  Backend-Identität prüfen. Ein lokaler Port allein ist keine Authentifizierung.
- Nur bewusst ausgewählte Bild-/Maskenkopien übertragen. Backend-Dateinamen als
  untrusted behandeln; keine beliebigen Backend-Pfade lesen oder löschen.
- Nur eigene Jobs verfolgen und abbrechen. Auf einer geteilten ComfyUI-Instanz
  weder die ganze Warteschlange leeren noch fremde Jobs per globalem Interrupt stoppen.
- Falls gezielter Abbruch nicht möglich ist: lokale Annahme abbrechen, späte
  Ergebnisse ignorieren und fortgesetzte Backend-Arbeit verständlich anzeigen.
- Einen Prozess nur dann beenden, wenn Imejii ihn selbst gestartet hat und besitzt.
- Zunächst große KI-Aufträge serialisieren. BiRefNet kann bereits etwa 6 GiB RAM
  beanspruchen; Modell-Downloadgröße ist kein Laufzeitspeicherbudget.
- Modelldateien, Runtime-Binaries, Versionen und Lizenzen vor Auswahl verifizieren.
  Keine dynamischen Repository-Skripte oder unbeprüften Custom-Nodes nachladen.

Die konkreten Backend-Endpunkte, Workflows, Maskenkonventionen und unterstützten
Modelle im nächsten technischen Spike aus Primärquellen und echten Läufen ableiten.
Diese Übergabe hat dazu keine neue externe Recherche oder Backend-Abnahme durchgeführt.

## 8. Reihenfolge für die Weiterarbeit

### A. Backend-Entscheidung belegen

- [ ] Repräsentative Quellen/Masken vorbereiten, einschließlich exportierter
  Subject-Studio-ZIPs: Person, Produkt, Haar-/Glaskanten und nichtquadratische Bilder.
- [ ] Die zwei vorhandenen Backend-Kandidaten hinsichtlich der benötigten drei
  Operationen und des lokalen Sicherheits-/Paketierungsmodells bewerten.
- [ ] Echte Ergebnisse, Crop-/Maskenkonventionen, Abbruchverhalten und genaue
  Versionen festhalten. Hardware und Speicher messen; keine erfundenen Zusagen.
- [ ] Einen ersten Provider und eine konkrete geprüfte SDXL-Modell-/Workflow-
  Kombination entscheiden. Ergebnisse als neues Entscheidungsprotokoll dokumentieren.

**Gate:** reproduzierbarer Bild-/Maskenlauf, definierte Provider-Fähigkeiten und
geklärter Installations-/Lizenzpfad. Keine Voraussetzung eines bereits laufenden Servers erfinden.

### B. Kernverträge und dauerhafte Sitzung

- [ ] Workspace-/Command-Routing und zentrale Plugin-Aktivierung erweitern.
- [ ] Dokumente, Maskenartefakte, Job-Ownership und Ergebnisablage implementieren.
- [ ] `.imejii`-/IndexedDB-Migration mit Rückwärtskompatibilität absichern.
- [ ] Generierung ohne Quellfoto unterstützen; bestehende Foto-Hosts erhalten.
- [ ] Bestehendes ZIP v1 importieren oder dieselben Daten direkt übergeben können.

**Gate:** Sitzungswiederherstellung, fehlendes Plugin, Moduswechsel und Fehlerfälle
funktionieren ohne echte Inferenz. Test-Provider ausschließlich als Test kennzeichnen.

### C. Eigener Modus und direkte Übergabe

- [ ] AI Studio bei aktiviertem Plugin sichtbar machen, auch ohne Backend:
  dann Einrichtungsansicht statt leerem Canvas.
- [ ] Links Operation, zentral Canvas/Maskenansicht, rechts Prompt/Parameter,
  unten Varianten und Jobstatus; Expertenparameter zunächst eingeklappt.
- [ ] Images/Logo/Subject Studio ausdrücklich in AI Studio übergeben; Quellstand
  und Motiv-/Hintergrundauswahl anzeigen. Logo-Arbeitsauflösung gesondert beachten.
- [ ] Ergebnisse nach bewusster Übernahme in Images/Logo öffnen.

**Gate:** Kein Verlust bei Moduswechsel, klare Dirty-/Close-Regeln, Tastatur/Fokus,
Hell/Dunkel und schmale Fenster getestet; Cutout und LaMa funktionieren weiter.

### D. Echte Verarbeitung und Abnahme

- [ ] Geprüften Provider anbinden, Parametergrenzen und Workflow-Versionen pinnen.
- [ ] Inpainting-Rückprojektion und unveränderte Außenpixel beweisen.
- [ ] Herkunft, Vorschau, Übernahme, Abbruch, Backend-Neustart und Fremdjobs testen.
- [ ] Alle tatsächlich angebotenen Operationen mit echten Modellen aus dem
  gepackten Windows-Build prüfen; danach sauberes Windows ohne Entwicklungsumgebung.

**Später/separat:** automatisierte Backend-Installation, signierte Plugin-Pakete,
öffentlicher Downloadkanal, C2PA-Konzept und Release-Freigabe. Die Modelldownload-
und Runtime-Entscheidung muss vor einer entsprechenden Installation autorisiert sein.

## 9. Regressionen und bekannte Build-Besonderheit

Der letzte dokumentierte Stand vor SDXL: Lint/Whitespace-Check grün, 31 Unit-,
108 Renderer-/Browser-, 15 Desktop-, 9 Cutout-, 8 LaMa- und 8 Studio-End-to-End-
Prüfungen bestanden. Der Studio-Ablauf bestand zusätzlich 8 Prüfungen aus dem
Windows-ASAR. Das sind **keine SDXL-Tests**.

Wichtige Ausgangstests:
[studio-checks.js](D:/Workspace/ImejiiViewer/tests/studio-checks.js),
[studio-desktop.cjs](D:/Workspace/ImejiiViewer/tests/studio-desktop.cjs),
[cutout-desktop.cjs](D:/Workspace/ImejiiViewer/tests/cutout-desktop.cjs),
[ai-desktop.cjs](D:/Workspace/ImejiiViewer/tests/ai-desktop.cjs).
Berichte und Screenshots liegen im
[Studio-Audit](D:/Workspace/ImejiiViewer/audit/2026-09-05/SUBJECT-STUDIO.md).

```powershell
# Im Projektverzeichnis; nach Codeänderungen, nicht für diese reine Übergabe nötig.
npm test
npm run test:cutout
npm run test:ai
npm run test:studio
npm run pack:win -- --config.electronDist=node_modules/electron/dist
npm run verify:package
```

Die echten Modelltests benötigen die bereits vorhandenen, ignorierten Testgewichte
unter `build/ai-models/`; nicht automatisch neu herunterladen. Für das echte
1024 × 683-Testfoto `IMEJII_CUTOUT_FIXTURE` auf
`D:\Workspace\ImejiiViewer\build\cutout-test\subject.jpg` setzen.
Ohne diese Variable wird die synthetische Fixture benutzt.

Der Standard-Entpackschritt von electron-builder scheiterte lokal mit `EPERM`
beim Umbenennen von `win-unpacked.tmp`. Mit obigem `electronDist`-Override wurde
die bereits installierte gleiche Electron-Version kopiert und erfolgreich paketiert.
Dieser dokumentierte Workaround ist keine behobene Ursache im ZIP-Entpackpfad.
Der letzte Build unter `release/win-unpacked` ist unsigniert und nicht veröffentlicht.

Zusätzliche SDXL-Abnahmekriterien:

- Text-to-Image ohne Bibliotheksbild; kein versehentlicher Aufruf des Foto-Speicherpfads.
- Bild-/Maskenübergabe nach EXIF-Drehung, Crop und unterschiedlichen Auflösungen.
- Weiß/Schwarz/Grau korrekt; keine Vollauswahl durch deckende PNG-Alpha.
- Bildergebnis außerhalb der Kompositionsmaske unverändert, inklusive Quellalpha.
- Eigene/fremde Jobs, späte Events, Backend-Ausfall, Doppelstart und OOM getrennt behandeln.
- ZIP-Import: Traversal, doppelte Einträge, falsche Maße, manipuliertes JSON und Größenbomben.
- Projekt-Neustart, Migration, voller Speicher und deaktiviertes/fehlendes Plugin.
- Keine ungeplanten Netzwerkzugriffe oder gelockerten Electron-Sicherheitsregeln.

## 10. Direkt nutzbarer Startauftrag für die nächste Umsetzung

> Lies zuerst diese Übergabe und den vorhandenen Arbeitsstand. Erhalte die nicht
> committeten KI-/Subject-Studio-Änderungen. SDXL soll ein eigener optionaler
> AI-Studio-Modus werden, nicht ein neues Foto-Seitenpanel. Beginne mit einem
> begrenzten Backend-/Workflow-Spike und einem dokumentierten Vertrag für
> Text-to-Image, Image-to-Image und Inpainting. Verwende den vorhandenen
> Bild-/Maskenexport als Testeingang; beachte deckende Graustufen statt Maskenalpha.
> Danach Workspace-Routing, persistente Dokument-/Maskenartefakte und Job-Ownership
> ausbauen und den gewählten Provider integrieren. Fehlende Server, Modelle,
> Hardwarefreigaben oder Nutzungsbedingungen ausdrücklich klären. Keine neuen
> Runtime-/Modellinstallationen, externen Veröffentlichungen oder Pushes aus der
> bloßen Existenz dieses Plans ableiten. Der Viewer, Images, Logo, Cutout und LaMa
> müssen ihre Regressionen unverändert bestehen.

Diese Datei ist eine Dokumentationsübergabe. Sie installiert, startet und verändert
keinen SDXL-Dienst und ersetzt keine gesonderte Release-Freigabe.
