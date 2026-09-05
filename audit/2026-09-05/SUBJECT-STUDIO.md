# Subject Studio — Implementierung und Abnahme

Stand: 5. September 2026. Erweiterung des bestehenden `ai-cutout`-Plugins auf 1.1.0.
Keine zusätzlichen Modellgewichte, Pakete, Netzwerkdienste oder Accounts.

## Umgesetzt

1. Motiv/Hintergrund getrennt entwickeln: Belichtung, Wärme, Tint, Kontrast,
   Sättigung, Schärfe sowie Natural-/S/W-/Warm-/Cool-Looks.
2. Portrait-Preset und einstellbare Hintergrundunschärfe; beim Originalfoto
   werden Vordergrundfarben aus den Blur-Samples ausgeschlossen.
3. Hintergrundwechsel: transparent, Originalfoto, Vollfarbe, Verlauf, lokale
   Datei mit Cover/Contain und Positionierung.
4. Selektive Looks und Color Splash über dieselbe weich korrigierbare Motivmaske.
5. Zentrierte Produktfotos mit Rand, Seitenverhältnis und 1024/2048/4096-px-Format.
6. Sticker und einfache Motiv-/Hintergrund-Kompositionen mit Platzierung,
   Skalierung, Deckkraft, Kontur und Schatten.
7. Motivbasierte Zuschnittvorschläge einschließlich Warnung bei abgeschnittenen
   Motiven und bei Vergrößerung im Produktformat.
8. Bestätigte Maskenübergabe an LaMa sowie Masken-PNG und SDXL-Bild-/Masken-ZIP.

Die Oberfläche folgt der bestehenden Imejii-Gestaltung: fünf Aufgabenbereiche,
gemeinsame Vorschau, eigenständiges Masken-/Stil-Undo, bestehende Regler und
Farbvariablen. Desktop, Light Theme und schmale Ansicht visuell geprüft.

## Technische Absicherung

- Gemeinsamer Worker-Renderer für Vorschau und Export; veraltete Vorschaujobs
  werden abgebrochen und ihre Ergebnisse verworfen. Abbruch auch vor dem
  Vollauflösungsspeichern möglich. Keine neue Modellinferenz bei Regleränderungen.
- 24-MP-Quell-/Hintergrund-/Ergebnisgrenze, 2048-px-Arbeitsmaske,
  1200-px-Kompositionsvorschau, begrenzte Stil-/Pinselverläufe.
- Original und Maske werden nicht mutiert. Vorhandenes Alpha bleibt im
  Originalhintergrund erhalten; Freistellung multipliziert Quell- und Maskenalpha.
- Geänderte Abmessungen benötigen die neue `photo.compose`-Berechtigung.
  LaMa behält seinen Größenvertrag. Übergabe übernimmt die aktive Host-Sperre
  atomar; der alte Host kann sie nicht freigeben.
- LaMa-Auswahl ist prüfbar, löschbar, wiederherstellbar und übermalbar;
  keine automatische Inferenz, unveränderter 65-%-Kontextschutz.
- Exportbild und Graustufenmaske teilen Quellabmessungen, Orientierung und
  explizite Polarität. Das ZIP enthält Daten, keinen ausführbaren Workflow.
- Speicherung bleibt zuerst dauerhaft, dann Bibliotheksübernahme; Wiederholung
  nach Öffnungsfehler erzeugt nicht bei jedem Klick eine neue Variantenkennung.
- Studio-Rezept, Geometrie, Modellhash und Herkunft bleiben am Ergebnis/Projekt.
  EXIF-Allowlist und GPS-Opt-in gelten weiter. Eigener AI-Software-Marker bleibt
  beim Re-Export erhalten.
- CSP, native Senderprüfung, Modell-URL-Allowlist, SHA-Prüfung und Electron-Fuses
  bleiben unverändert. ASAR-Prüfung verlangt zusätzlich den Studio-Worker.

Im UI-Test gefundene und behobene Probleme: Preset und unmittelbar anschließender
Regler bildeten zunächst denselben Undo-Schritt; Presets/Reset sind jetzt diskret.
Die Pinselanzeige wurde außerdem an die verkleinerte Kompositionsvorschau angepasst,
damit ihr sichtbarer Durchmesser den tatsächlich gemalten Anteil beschreibt.

## Prüfnachweise

| Prüfung | Ergebnis / Bericht |
| --- | --- |
| ESLint, `git diff --check` | bestanden |
| Unit-Tests | 31 bestanden |
| Renderer-/Browser-Regression | 108 bestanden, `studio-renderer.json` |
| Desktop-/Datei-/Menüregression | 15 bestanden, `studio-desktop-regression.json` |
| Eigenständige Freistellung, reales Modell | 9 bestanden, `cutout-desktop.json` |
| Eigenständige LaMa-Entfernung, reales Modell | 8 bestanden, `ai-desktop.json` |
| Studio-End-to-End, beide realen Modelle offline | 8 bestanden, `studio-desktop.json` |
| Derselbe Studio-Ablauf aus Windows-ASAR | 8 bestanden, `studio-asar.json` |
| Paketinventar, Runtime-Hashes, Fuses, Studio-Worker | bestanden, `studio-package.json` |

Renderer-Prüfungen umfassen eine echte 24-MP-Canvas-Eingabe mit 4096 × 4096-px-
Produktkomposition im Modulworker, Alpha-/RGB-Erhalt, Blur-Farbsäume, Maskenpolarität,
Worker-Abbruch, Crop-Grenzen, Kontur, Schatten, Deckkraft, Berechtigungen und Projekte.

Der End-to-End-Test verwendet das bereits vorhandene 1024 × 683-Testfoto
`build/cutout-test/subject.jpg` und die realen gepinnten BiRefNet-/LaMa-Gewichte.
Netzwerk während der Inferenz deaktiviert. PNG- und ZIP-Bytes, native Bildauswahl,
Stil-Undo/Redo, Varianten/Projekte und der komplette Plugin-Wechsel werden geprüft.
Screenshots: `studio-develop.png`, `studio-portrait.png`, `studio-background.png`,
`studio-gradient.png`, `studio-product.png`, `studio-sticker.png`, `studio-crop.png`,
`studio-send.png`, `studio-light.png`, `studio-narrow.png`, `studio-lama-mask.png`,
`studio-lama-result.png`. `studio-result.png` ist die extrahierte Ergebnisdatei.

## Windows-Build und verbleibende Grenzen

Der Standard-Download-/Entpackpfad von electron-builder scheiterte lokal mit
`EPERM` beim Umbenennen von `win-unpacked.tmp`, auch in einem frischen Ausgabeordner.
Der erfolgreiche Build kopiert deshalb die bereits installierte identische
Electron-44.1.1-Laufzeit (keine Änderung an Abhängigkeiten oder Produktions-CSP):

```powershell
npm run pack:win -- --config.electronDist=node_modules/electron/dist
$env:IMEJII_TEST_REPORT = 'D:\Workspace\ImejiiViewer\audit\2026-09-05\studio-package.json'
npm run verify:package
$env:IMEJII_PACKAGED_MAIN = 'D:\Workspace\ImejiiViewer\release\win-unpacked\resources\app.asar\electron\main.cjs'
$env:IMEJII_CUTOUT_FIXTURE = 'D:\Workspace\ImejiiViewer\build\cutout-test\subject.jpg'
$env:IMEJII_AI_REPORT_DIR = 'D:\Workspace\ImejiiViewer\audit\2026-09-05'
.\node_modules\.bin\electron.cmd tests/studio-desktop.cjs
```

Der lokale Build liegt in `release/win-unpacked`. Es wurde kein Release publiziert,
kein Installer signiert und kein Commit/Push ausgeführt. Signierung, Downloadkanal
und die bereits dokumentierten Release-/Lizenzfreigaben bleiben separate Schritte.

Die Ergebnisse sind **gerenderte Varianten**, keine nachträglich editierbaren
Motiv-/Hintergrund-Ebenen. Das Original bleibt in der Bibliothek erhalten;
Projektdateien enthalten nicht zusätzlich die komplette Quelle und Hintergrunddatei.
Unübernommene Studio-Sitzungen bleiben flüchtig. Kein generatives Ergänzen,
kein echtes Tiefen-Bokeh, kein Mehr-Ebenen-Collageeditor, kein KI-Upscaling,
keine Instanzwahl einzelner Personen und kein SDXL-Generator. Letzterer bleibt
wie geplant ein eigener späterer Modus; seine Maskenschnittstelle ist vorbereitet.
