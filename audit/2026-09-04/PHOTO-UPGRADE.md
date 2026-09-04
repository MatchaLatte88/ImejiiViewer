# Abnahme: nicht-KI-Foto-Ausbau

4. September 2026, Windows x64, Node 24.13.0 / Electron 44.1.1 / Chromium 152.

## Ergebnis

- `npm run build`: erfolgreich, HEIC-Worker als separates lokales Asset (~3 MB).
- `npm run lint`: erfolgreich, keine Warnungen.
- `npm run test:unit`: 15/15 bestanden.
- `npm run test:renderer`: 75/75 bestanden, keine Console-Errors.
- `npm run test:desktop`: 15/15 bestanden, keine unerwarteten Console-Errors.
- **105 bestandene Checks** insgesamt. Negative IPC-Tests erzeugen bewusst Main-Process-Fehlermeldungen.
- `git diff --check`: erfolgreich mit der vorhandenen Repository-Zeilenendenkonfiguration.
- Lizenzsammler funktioniert; 51 Produktionspakete plus zusätzliche ICC-/Decoder-Hinweise.
- Kein Commit, Push, Installer-Build oder öffentliches Release in diesem Arbeitsschritt.

## Neue Testabdeckung

EXIF-Roundtrip in PNG/JPEG/WebP/TIFF; GPS-Opt-in und Creator; P3→sRGB und erneuter Export;
TIFF-Orientierungen, 16-Bit-Eingabe, assoziiertes Alpha; echtes HEVC-HEIC; beschädigte Container
und begrenzte Deflate-Expansion; neutrale Pipeline, Tonkurve, Lichter/Tiefen und wiederholbarer
Weißabgleich; lokale Masken mit Crop/Rotation; unveränderte Originalbytes; unabhängige Varianten;
Foto-/Logo-Projekte, Prüfsummen, Undo nach Wiederherstellung, simultanes Autosave und Quotenfehler.
Desktop: echte TIFF-/Projekt-Dateiausgabe, lokaler Persistenzspeicher nach Renderer-Neustart,
HEIC unter unveränderter Produktions-CSP. Die UI wurde mit HEIC und aufgeklappter Radialmaske
visuell kontrolliert; bestehende Panel-/Token-Gestaltung beibehalten.

## Artefakte

- [Renderer-Ergebnisse](photo-upgrade-renderer.json)
- [Desktop-Ergebnisse](photo-upgrade-desktop.json)
- [Oberfläche](photo-upgrade-ui.png)
- [Lokale Maske](photo-upgrade-ui-local.png)
- [Bedienung, Umfang und technische Grenzen](../../docs/PHOTO-FEATURES.md)

## Vor Release weiterhin offen

- npm-Advisory-Endpunkt: vollständiger CLI-Audit, Produktions-Audit und direkte HTTP-Abfrage
  scheiterten an Timeouts. **Kein erfolgreicher aktueller Vulnerability-Audit.** Erneut ausführen.
- HEIC-Auslieferung: LGPL-/Corresponding-Source-/Rekombinationsprüfung für eingebettete Decoder,
  einschließlich ASAR/Signierung. npm-Notices allein sind keine vollständige Freigabe.
- Signierung, Downloadkanal, saubere Windows-Installation/Updates und reale Kamera-/Hardwarematrix
  gemäß [Release-Checkliste](../../docs/RELEASE.md). Kein Langzeit-/OS-Neustartnachweis durch Renderer-Reload.
- Arbeitsfarbraum weiterhin sRGB/8 Bit; kein RAW, HDR, CMYK oder vollständiger Metadatenstandard-Erhalt.
- Library/Katalog, große Sammlungen, AI-Plugins und SDXL wurden ausdrücklich nicht umgesetzt.

Vorhandene Änderungen an Vergleichs-Slider, selektiven Farben, einklappbaren Panels,
Publisher-/Release-Angaben und KI-Plänen wurden beibehalten.
