# AI Studio / SDXL-Inpainting – Implementierungsprüfung

5. September 2026 · lokaler Arbeitsstand, kein Commit/Push/Release.

## Ergebnis

Der optionale Hauptmodus `ai-studio` ist mit Quelle, Maskenpinsel, Undo/Redo,
Prompt/Parametern, Varianten, expliziter Fotoübernahme und dauerhafter Sitzung
implementiert. Der feste ComfyUI-Broker ist in der Windows-App enthalten.
**Ein echter SDXL-Modelllauf wurde nicht durchgeführt.** Kein passendes lokales
Backend wurde für diese Aufgabe benannt; weder Runtime noch Gewichte wurden installiert.

## Bestandene Prüfungen

| Prüfung | Ergebnis | Evidenz |
| --- | --- | --- |
| ESLint / Whitespace | bestanden | `npm run lint`, `git diff --check` |
| Unit-Tests | 37 bestanden | `npm test`, darunter 6 neue Broker-Tests |
| Renderer / Browser | 118 bestanden, keine Konsolenfehler | [sdxl-renderer.json](sdxl-renderer.json) |
| Bestehende Desktop-App | 15 bestanden | [desktop.json](sdxl-regressions/desktop.json) |
| Subject Studio, echte BiRefNet-/LaMa-Gewichte | 8 bestanden | [studio-desktop.json](sdxl-regressions/studio-desktop.json) |
| SDXL-Desktop mit Protokoll-Fixture | 8 bestanden | [sdxl-desktop.json](sdxl-desktop.json) |
| SDXL mit Code aus Windows-ASAR und Protokoll-Fixture | 8 bestanden | [sdxl-asar.json](sdxl-asar.json) |
| Windows-Paketinventar / Fuses / native Hashes | bestanden | [sdxl-package.json](sdxl-package.json) |

Die SDXL-Fixture ist ein lokaler Testserver unter `tests/`, identifiziert sich als
`TEST-FIXTURE-NO-MODEL` und gibt Testbilddaten zurück. Sie prüft echte IPC-/HTTP-,
Canvas-, Speicher- und Bedienabläufe, **keine generative Bildqualität**. Sie ist
nicht im Paket enthalten. Die echten BiRefNet-/LaMa-Läufe sind Regressionen der
bestehenden Plugins und gelten nicht als SDXL-Abnahme.

Die neuen Prüfungen umfassen u. a.:

- Keine Backend-Anfrage beim bloßen Aktivieren; leere Einrichtungsansicht ohne Foto.
- Maskenimport über Graustufen statt deckender PNG-Alpha, weiche Kanten und 100-%-Auswahl.
- Nichtquadratische Quellen, Padding und inverse Projektion; bitgleiche Außenpixel und Quellalpha.
- Original-/Masken-/Ergebnisartefakte, atomare Fehlerfälle, beschädigte Projekte und Neustart.
- Quellenrevision, unveränderlicher Parameter-Snapshot und dauerhaft gespeicherte Jobmaske.
- Eigene Uploads/Jobs, fremde History, unsichere Pfade, Redirects, Antwortlimits und Timeouts.
- Abbruch vor/später als Backend-Rückmeldung sowie während der Ergebnis-PNG-Kodierung.
- Moduswechsel, Prompt-Erhalt, native Undo-/Save-Befehle, gespeicherte Plugin-Aktivierung.
- Breite und schmale Oberfläche, Hell/Dunkel; die gefundene ResizeObserver-Warnung wurde behoben.

Der erste eingeschränkte Tool-Testlauf konnte den Electron-GPU-Prozess nicht starten.
Die Tests bestanden in der regulären lokalen Ausführung mit isolierten Testprofilen.
Produktions-Sandbox, CSP und Electron-Fuses wurden hierfür nicht abgeschwächt.

## Lokales Testpaket

`D:\Workspace\ImejiiViewer\build\sdxl-package\win-unpacked\Imejii.exe`

Mit vorhandener Electron-44.1.1-Distribution erstellt:

```powershell
npm run pack:win -- --config.electronDist=node_modules/electron/dist --config.directories.output=build/sdxl-package
$env:IMEJII_PACKAGE_DIR = 'build/sdxl-package/win-unpacked'
npm run verify:package
```

Authenticode-Status: **NotSigned**. Das vorhandene Paket unter `release/win-unpacked`
wurde nicht ersetzt. Das Testpaket enthält keine SDXL-Gewichte oder zusätzliche
SDXL-Runtime. Paketprüfungen ersetzen keinen Installationstest auf sauberem Windows.

## Offene Freigabe

Benötigt wird die konkrete, vom Nutzer gestartete ComfyUI samt SDXL Base 1.0.
Dann Versions-/Gewichte-/Lizenzprüfung sowie echte Bildläufe für Person, Produkt,
Haare/Glas, hohe Hintergrundauswahl, OOM und Backend-Neustart durchführen und
RAM/VRAM/Laufzeiten dokumentieren. Der derzeitige Masked-Latent-Workflow ist kein
dedizierter SDXL-Inpainting-Checkpoint. Keine Leistungs- oder Qualitätszusage aus
den Fixture-Läufen ableiten.

Vertrag, Einrichtung und bekannte Grenzen: [SDXL-STUDIO.md](../../docs/SDXL-STUDIO.md).

## Oberflächenprüfung

[Quelle und Maskenpinsel](sdxl-mask-dark.png) · [Leerer Arbeitsbereich](sdxl-empty.png)
· [Schmales Fenster](sdxl-narrow.png) · [Helles Theme](sdxl-light.png).

Die Vorschau-Screenshots verwenden eine Bildfixture; sie zeigen kein generiertes SDXL-Ergebnis.
