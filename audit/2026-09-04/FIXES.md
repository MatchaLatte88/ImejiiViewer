# Audit-Fixes – 4. September 2026

Die 13 priorisierten Befunde A01–A13 und die zusätzlich aufgeführten Code-/Bedienungsfehler
sind implementiert. **80 automatisierte Tests bestanden** nach sauberem Installieren aus
dem Lockfile; Lint und Produktionsbuild sind grün. Das aktuelle npm-Audit meldet
**0 bekannte Schwachstellen**, einschließlich der neuen Entwicklungsabhängigkeiten.

Das ursprüngliche Audit und seine roten Baseline-Ergebnisse bleiben unverändert erhalten.
Dies ist noch keine Freigabe eines signierten Installers für Endnutzer.

## Priorisierte Befunde

| Befund | Umsetzung | Nachweis |
| --- | --- | --- |
| A01 – Überschreiben von Originalen | Jedes Set erhält einen neuen, eindeutigen Unterordner. Veröffentlichung einzelner Dateien exklusiv; explizites Save As kontrolliert und über temporäre Datei. | Echte Dateisystemtests: Quellen, vorhandene Ziele und doppelte Namen bleiben erhalten. |
| A02 – Freie Dateipfade über IPC | Opaque Bild-IDs und Export-Handles; Sender/Fenster/Main-Frame/URL werden in jedem Handler geprüft. Keine Renderer-Pfade für Lesen, Blättern oder Schreiben. | Unit- und reale Bridge-Tests; Traversal, ADS, reservierte Namen, Junctions, abgelaufene Handles und fremde Sender werden abgewiesen. |
| A03 – Doppelte EXIF-Ausrichtung | Native Decoder-Ausrichtung wird nicht nochmals angewendet. Metadaten/Thumbnail/Arbeitsbild verwenden dieselben orientierten Maße. | Alle acht EXIF-Orientierungen einschließlich Spiegelungen mit echten JPEGs. |
| A04 – Veraltete Dekodierung überschreibt Auswahl | Generationsnummern, Canvas-Zuordnung zur Quelle, sofortiges Leeren und Abbruch veralteter Renderarbeit. | Langsames A/schnelles B; Clear während Dekodierung. |
| A05 – Edits gehen beim Ordnerblättern verloren | Bereits bearbeitete oder historische Einträge bleiben erhalten; nur unbearbeitete temporäre Nachbarn werden entfernt. | Wechsel Editor → Viewer → Nachbar erhält Bild und Rotation. |
| A06 – Namenskollisionen im Batch | Wiederholte Suffixprüfung, Unicode-Normalisierung und case-insensitive Deduplizierung; Windows-Namensregeln. | Kollisionsketten, Groß/Kleinschreibung und reservierte Namen. |
| A07 – Navigation/CSP | Internes imejii-Protokoll statt file-origin, restriktive Produktions-CSP, blockierte Navigation/Fenster/Webviews, schmale Permissions. Packaged Builds ignorieren Dev-URLs. | Protokollpfadprüfung, Inline-Script-Blockade, sandboxed Produktionsstart und Fuse-Prüfung. |
| A08 – Nichtreaktives Undo | Reaktive, bildbezogene History; ausstehende Änderungen machen Undo sofort verfügbar. | Sofortiges Undo, Commit, Redo und echte Desktop-Oberfläche. |
| A09 – Verlorene History-Snapshots | Getrennte Debounce-Timer und Commits je Bild; „Apply to all“ erstellt pro Empfänger einen Undo-Schritt. | Schneller Bildwechsel und Undo auf Empfängerbild. |
| A10 – Falsches Datenformat in Icon-Paketen | Vordefinierte PNG-Dateien werden immer als PNG kodiert; JPEG/WebP-Auswahl gilt für freie Exporte. | PNG-Signaturen im Favicon-Paket bei ausgewähltem JPEG. |
| A11 – Veränderlicher Batchzustand | Bildliste, Bearbeitungen, Format, Qualität, Resize und Wasserzeichen werden vor dem ersten Await kopiert. | Änderung von Einstellungen, Edits, Wasserzeichen und Sammlung während des Exports. |
| A12 – Falsche Spiegelachse | Spiegelung in dargestellten Achsen; Rotation tauscht bestehende Flip-Achsen entsprechend. | Pixelvergleich für Rotate → Flip und Flip → Rotate. |
| A13 – Falsche Batchgrößenvorschau | Vorschau verwendet neutrale Einzelbearbeitungen, wenn „Apply edits“ deaktiviert ist. | Crop im Einzelbild, aber unveränderte Maße im Batch bei deaktivierten Edits. |

## Weitere umgesetzte Korrekturen

- Native Drops werden im Preload über `webUtils.getPathForFile` registriert, ohne eine
  frei aufrufbare Pfad-API zu exponieren. Konstruierte Browser-Files können keinen Pfad vortäuschen.
- Native Datei-Änderungsdaten werden übernommen; teilweise erfolgreiche Dateiauswahl bleibt nutzbar.
- Menü, Tastatur und Panels nutzen dieselben Busy-/Fehlerpfade für Export.
  Einzel-, Logo- und Stapelexporte sind abbrechbar; fertige Desktop-Dateien bleiben bei Abbruch erhalten.
- Schließen, Entfernen und Logo-Ersetzen berücksichtigen ungesicherte Änderungen.
  Produktivmenü ohne Reload/Force Reload/DevTools; Absturz- und Ladefehlerbehandlung.
- Logo-Handover gleicht die tatsächlich geladene Quelldatei ab. Die A → Logo → B → Viewer A → Logo-Sequenz ist getestet.
- Pipetten-Hover verwendet gültige Pixelindizes am rechten/unteren Rand.
- JPEG-Transparenz wird ausdrücklich weiß hinterlegt; Hinweise in den Export-Panels.
- Resize-Basis und Upscaling-Warnung beziehen sich auf die beschnittene, noch nicht skalierte Geometrie.
- Browser-Strg+S ergänzt; Ctrl/Alt-Kombinationen lösen keine einfachen Bildkürzel aus;
  Texteingaben behalten ihre eigene Undo-Behandlung.
- Globale Crop-/Vergleichs-Drag-Listener werden beim Unmount und Bildwechsel entfernt.
  Vergleich per Leertaste wird auch bei Fokusverlust zurückgesetzt.
- Zahlenfelder sind benannt; Thumbnail-Auswahl ist ein Button; Toast ist eine Live-Region;
  Segmented Controls verwenden echte disabled-Buttons.
- Desktop-Texte benennen Ordnerausgabe statt ZIP; README beschreibt Grenzen,
  Animation/Metadaten, JPEG, lokale Speicherung und nicht persistierte Bearbeitungen.

## Speicher und Verarbeitung

- Desktop-Mehrfachauswahl liefert leichte Metadaten/Handles. Dateiinhalte werden einzeln nachgeladen.
- Harte Eingabegrenzen: 128 MiB, 40 MP, 16.384 px je Kante; Canvas-Allokationen sind ebenfalls begrenzt.
  PNG/JPEG/GIF/BMP-Header werden soweit erkannt vor der Dekodierung geprüft; andere Formate
  werden zusätzlich nach der Dekodierung geprüft.
- Bis 1.000 Sammlungsbilder, Browser-Quellen bis 512 MiB, Browser-ZIP bis 256 MiB;
  Desktop-Exportset bis 1.000 Dateien / 4 GiB.
- Foto-Vorschau und aufwendiger Export laufen in Worker/OffscreenCanvas. Ein in den Lasttests
  entdeckter Bitmap/Canvas-Integrationsfehler wurde korrigiert und zusätzlich abgesichert.
- Blur benötigt 12 statt 32 Byte Scratch-Speicher je Pixel. Das ist eine Allokationsrechnung,
  keine gemessene Gesamt-RAM-Obergrenze.
- Desktop-Stapel schreibt fortlaufend. Bildliste und fertige Exportdaten werden nicht gemeinsam
  als unbeschränkter Stapel im Renderer gehalten.
- Zoomknopf lädt Originalauflösung für echte 1:1-Pixel; reduzierte große Ansichten sind als Preview markiert.

Synthetischer Lauf auf diesem Rechner: 12 MP mit Blur/Farbkorrektur **1.049 ms**, 24 MP
**2.245 ms**; UI-Timer liefen währenddessen weiter (67/136 Ticks). 1.000 kleine
Thumbnail-Fixtures: **1.156 ms** einschließlich Ablehnen des 1.001. Imports und Aufräumen.
Das ist kein Benchmark mit 1.000 hochauflösenden Fotos, kein Langzeittest und keine
Peak-RAM-/Framerate-Garantie für andere Geräte.

## Verifikation und Artefakte

- `npm ci --prefer-offline`: erfolgreich, Node 24.13.0.
- `npm test`: Exit 0; **15** Dateisicherheits-/Main-Unit-Tests,
  **53** Renderer-/Browser-/Lasttests, **12** Produktions-Desktop-Checks.
- `npm audit --json`: 0 Info/Low/Moderate/High/Critical.
- Electron 44.1.1, Chromium 152.0.7977.65, Vite 7.3.6.
- Tests verwenden getrennte temporäre Profile und ausschließlich eigene Fixtures/Exportziele.
  Die Electron-Sandbox ist aktiv; nur die äußere Ausführungs-Sandbox musste wegen eines
  bekannten GPU-DLL-Startfehlers für Electron-Testprozesse verlassen werden.
- Reale Systemdialoge werden in der automatisierten Desktop-Suite auf temporäre Testziele
  umgeleitet. Main, Preload, Protokoll, Renderer, Worker und Dateisystem bleiben echt.
- Erwartete IPC-Rejections erscheinen im Test-Terminal; keine unerwarteten Renderer-Konsolenfehler.
- Das erzeugte ASAR wurde zusätzlich im isolierten Electron-Testharness geladen:
  dieselben 12 Desktop-Checks bestanden. Die Fuse-Werte und Archiv-Inhalte wurden separat
  am erzeugten Paket geprüft. Das ersetzt keinen Start-/Installer-Test auf sauberem Ziel-Windows.

Maschinenlesbar: [Renderer-Ergebnis](renderer-results-fixed.json),
[Desktop-Ergebnis](desktop-results-fixed.json), [Paketprüfung](package-results-fixed.json),
[ASAR-Desktop-Test](packaged-results-fixed.json).

## Packaging und noch offene Freigaben

Windows-x64-Paketierung und CI sind eingerichtet. Die App-ID ist technisch auf
`io.imejii.viewer` gesetzt. Icons werden aus der bestehenden Marke generiert;
48 Produktionspakete liefern die gesammelten Lizenzhinweise. Produktionsarchiv ohne
node_modules, Quell-, Test- oder Auditdateien. ASAR-only/Integrity und restriktive
Electron-Fuses sind konfiguriert und werden am erzeugten Paket geprüft.

**Nicht ohne externe Entscheidung abschließbar:** Herausgeber-/Autoridentität, Lizenz
des eigenen Codes, Code-Signierungszertifikat, Download-/Updatekanal. Kein Upload,
keine Veröffentlichung, keine Installation und keine systemweiten Dateizuordnungen
wurden vorgenommen. Der lokale App-Ordner ist unsigned; ein signierter Installer wurde
nicht erzeugt oder abgenommen. Der Builder weist entsprechend auf fehlende Autor-Metadaten hin.

Nachtrag: Der Herausgeber wurde anschließend als **Frederik Morbe** festgelegt und in
`package.json` hinterlegt. Der obige Pakettest dokumentiert weiterhin den vorherigen Build;
mit diesem Nachtrag wurde kein neues oder signiertes Paket erstellt.

Vor Launch bleiben die reale Installer-/Update-/Deinstallationsabnahme auf sauberem Windows,
SmartScreen/Signatur, Hardware-/DPI-/Datenträgerfehler-Matrix sowie ggf. andere Plattformen.
Kein Autosave-Projektformat oder Crash-Recovery: diese verbleibende Produktgrenze ist dokumentiert.
Siehe [Release-Checkliste](../../docs/RELEASE.md).
