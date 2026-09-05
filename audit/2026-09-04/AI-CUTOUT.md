# Freistellung — Implementierung und lokale Abnahme

Datum: 2026-09-04. Windows x64, Electron 44.1.1 / Chromium 152.
Keine Veröffentlichung, kein Commit/Push und keine Aussage zur Release-Signierung.

## Umfang

Eigenständiges `ai-cutout`-Plugin im Images-Modus. Lokales BiRefNet Lite mit
explizitem 224-MB-Download, SHA-256-Prüfung, nativer CPU-Inferenz, weicher Alphamaske,
Kantenreglern, Restore/Remove-Pinsel, Undo/Redo, Vergleich und drei Prüfhintergründen.
Neue PNG-Variante mit erhaltenem Original, Metadaten-/Projekt-Roundtrip und
pluginunabhängiger Wiederherstellung. LaMa bleibt separat aktivierbar.

## Ergebnisse

| Prüfung | Ergebnis / Beleg |
| --- | --- |
| ESLint | PASS, keine Warnungen |
| Unit-Tests | 31/31 PASS; inklusive neuer nativer IPC-, Lifecycle- und Output-Validierung |
| Renderer / Browser | 91/91 PASS, keine Konsolenfehler; `cutout-renderer.json` |
| Desktop-Regression | 15/15 PASS; `cutout-desktop-regression.json` |
| Echtes Cutout-Modell | 9/9 PASS; `cutout-desktop.json` |
| Cutout aus Windows-ASAR | 9/9 PASS; `cutout-asar.json` |
| Bestehendes LaMa | 8/8 PASS; `ai-desktop.json` |
| LaMa aus Windows-ASAR | 8/8 PASS; `ai-asar.json` |
| Windows-Verpackung | PASS; feste CPU-Dateiinventur, keine Gewichte oder GPU-Bibliotheken |
| Paketprüfung | PASS; ASAR, native SHA-256-Prüfungen, Notices, Electron-Fuses |

Die ASAR-Tests laden das gepackte Main-/Preload-/Renderer-/Runtime-Artefakt über den
Test-Electron-Launcher. Die Fuses des erzeugten `Imejii.exe` werden separat statisch
geprüft. Kein NSIS-Installations- oder Signatur-/SmartScreen-End-to-End-Nachweis.

## Wichtige Befunde und Korrekturen

- BiRefNet Lite FP32 scheiterte trotz reichlich System-RAM im WASM-Worker an
  `std::bad_alloc`. Cutout verwendet deshalb einen eigenen nativen 64-Bit-Utility-
  Prozess; LaMa bleibt im bewährten WASM-Worker. Renderer-Sandbox und CSP unverändert.
- Der reale Abbruchtest beobachtet die PID und das Exit-Ereignis: Abbruch und
  erfolgreicher Abschluss beenden den Rechenprozess tatsächlich. Unit-Tests prüfen
  zusätzlich Timeout, Start-/Modellfehler, späte Antworten und Wiederholungsversuche.
- Modellstatus ist pro Plugin isoliert. Fremde Downloads melden keine falsche
  Bereitschaft; Quellen und SHA-256 bleiben getrennt.
- Feathering eines Motivs am Bildrand erzeugt durch geklemmte Randpixel keinen
  unbeabsichtigten transparenten Rahmen. Regression prüft vollständig deckendes Alpha.
- Ein künstlich ausgelöstes Versagen beim Öffnen der bereits gespeicherten Variante
  lässt die Vorschau erhalten und erzeugt beim erneuten Anwenden keine zweite Kopie.
- PNG-Alpha, Quelldimensionen, AI-Software-Marker, Kantenparameter und Modellherkunft
  bleiben beim Projekt-Roundtrip erhalten; GPS bleibt standardmäßig ausgeschlossen.

## Visuelle Prüfung und Leistung

`cutout-preview.png`, `cutout-dark-backdrop.png`, `cutout-light.png`,
`cutout-compact.png`, `cutout-narrow.png`, `cutout-mask-correction.png` visuell geprüft.
Desktop 1440 × 1000, Minimum 1024 × 640 sowie tatsächlich verkleinerte Testfläche
620 × 780. Getrennte, scrollbare Werkzeuge; primäre Übernahme bleibt erreichbar.

Reales Foto: 1024 × 683; 513.880 vollständig transparente, 172.542 vollständig
deckende und 12.970 teiltransparente Pixel. Rund 11–13 s Gesamtzeit auf diesem
Entwicklungsrechner. Gemessener Spitzen-Working-Set des nativen Prozesses:
6.442.868 KiB, etwa 6,1 GiB. Dies ist keine Messung des gesamten App-/Systemverbrauchs.
UI nennt deshalb 16 GB System-RAM als Empfehlung. Keine breite Hardwareabnahme.

Testfoto aus der offiziellen BiRefNet-Modellkarte:
[Pexels-Foto 5965592](https://www.pexels.com/photo/5965592/).
Lokale Testkopie (nicht im App-Paket) mit SHA-256
`2b5d6423b8948eb53319661633039912afa6455a9055f0c984ff88eeae1b5bfe`.
Die Zahlen prüfen den Ablauf und Alpha, nicht allgemeine Modellgüte. Haar-/Glas-
Matting, komplexe Gruppenbilder und schwache Windows-PCs sind nicht vollständig
abgenommen. Grenzen und Bedienung stehen in `docs/AI-CUTOUT.md`.

Bestehende Signierungs-/Downloadkanal- und HEIC-Lizenz-Gates bleiben bestehen.
