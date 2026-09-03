# Logo Creator

Vue-3-Web-App mit zwei Arbeitsbereichen: **Logo** stellt Bilder frei und erzeugt komplette
Icon-Sets, **Images** ist ein Betrachter, Editor und Stapel-Konverter für ganze Bildserien.
Die gesamte Verarbeitung läuft im Browser – es wird nichts hochgeladen.

## Logo-Modus

**Hintergrund freistellen**
- Farbe per Pipette direkt im Bild aufnehmen (mehrere Farben gleichzeitig möglich)
- Automatische Erkennung der dominanten Randfarbe
- Toleranz und weicher Übergang stufenlos regelbar
- Zwei Modi: *überall* entfernen oder nur *zusammenhängende* Flächen (Flood-Fill vom Rand bzw. Klickpunkt)
- Farbsaum-Korrektur (Despill), Maske schrumpfen/weiten, weiche Kante
- Alpha-Bleeding: Randfarben werden nachgezogen, damit beim Verkleinern keine Farbsäume entstehen

**Bildkorrektur**
- Belichtung, Helligkeit, Kontrast, Gamma
- Temperatur, Sättigung, Dynamik, Farbton, Graustufen, Invertieren
- Schnellprofile (Kräftig, Flach, Graustufen, Invertiert)

**Effekte & Form**
- Schärfen (Unsharp Mask), Weichzeichnen, Farbreduktion (Posterize)
- Kontur um die freigestellte Silhouette (Stärke, Farbe, Deckkraft)
- Drehen (90°-Schritte und frei), Spiegeln, transparente Ränder abschneiden
- Quadratische Leinwand, Rand in %, Eckenradius bis hin zur Kreismaske
- Optionale Hintergrundfarbe für Formate ohne Transparenz

**Export**
- PNG, WebP, JPG mit einstellbarer Qualität
- Beliebige Größen einzeln oder als ZIP (16 – 1024 px)
- Multi-Resolution `.ico` (16/24/32/48/64/128/256) für Windows-Programme und Favicons
- Fertige Pakete: Favicon (inkl. `site.webmanifest` und HTML-Snippet), PWA, Windows, macOS-Iconset, Android-mipmap, iOS, Web-Logo
- PNG in die Zwischenablage kopieren
- Eigene Einstellungs-Presets speichern (localStorage) – für einheitliche Produktlogos

**Bedienung**
- Dark- und Light-Mode (folgt beim ersten Start dem System)
- Drag & Drop, Dateidialog oder Einfügen aus der Zwischenablage
- Zoom/Pan im Canvas, Live-Vorschau in echten Icon-Größen
- Undo/Redo über die gesamte Einstellungshistorie

## Bild-Modus (Images)

**Betrachten**
- Beliebig viele Bilder gleichzeitig laden, Vorschauleiste mit Thumbnails
- Blättern per Pfeiltasten oder Klick, Sortierung nach Reihenfolge, Name, Größe oder Datum
- Zoom und Verschieben, Vollbild, Diashow mit einstellbarem Intervall
- Original per Leertaste einblenden

**Bearbeiten (pro Bild gespeichert)**
- Interaktives Zuschneiden mit Seitenverhältnis-Vorgaben (frei, 1:1, 4:3, 3:2, 16:9),
  Drittel-Raster und Live-Anzeige der Zielmaße – auch mehrfach verschachtelt
- Drehen in 90°-Schritten (der Zuschnitt dreht mit), Spiegeln, freies Geraderichten
  mit automatischem Beschnitt der leeren Ecken
- Freies Verkleinern: längste Kante, Breite, Höhe oder Prozent, mit Warnung beim Hochskalieren
- Automatische Tonwertkorrektur und Schnellprofile (Punchy, Soft, B&W, Warm, Cool)
- Belichtung, Helligkeit, Kontrast, Gamma, Temperatur, Sättigung, Dynamik, Farbton,
  Graustufen, Invertieren, Schärfen, Weichzeichnen, Vignette
- Undo/Redo je Bild, Einstellungen auf alle anderen Bilder übertragen

**Analysieren**
- Dateiinfo (Format, Größe, Abmessungen, Megapixel, Seitenverhältnis, Ausgabemaße)
- EXIF-Basisdaten: Kamera, Aufnahmedatum, Belichtungszeit, Blende, ISO, Brennweite
- RGB-Histogramm des bearbeiteten Ergebnisses
- EXIF-Ausrichtung wird beim Laden automatisch angewendet

**Konvertieren**
- Einzelbild als PNG, WebP oder JPG speichern oder in die Zwischenablage kopieren
- Stapelverarbeitung: gemeinsames Zielformat, Qualität und Größe für alle Bilder,
  wahlweise mit oder ohne die Einzelbearbeitungen, Ergebnis als ZIP
- Namensmuster mit `{name}`, `{index}`, `{width}`, `{height}`; Fortschrittsanzeige

### Unterstützte Eingabeformate

`.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` `.avif` `.svg` `.ico`

Bilder mit mehr als 4096 px Kantenlänge werden beim Laden auf diese Größe reduziert.

### Tastenkürzel

| Taste | Funktion |
| --- | --- |
| `Strg` + `O` | Bild öffnen |
| `Strg` + `V` | Bild aus der Zwischenablage einfügen |
| `Strg` + `Z` / `Strg` + `Umschalt` + `Z` | Rückgängig / Wiederholen |
| `Strg` + `S` | Als PNG in Originalgröße exportieren |
| `I` | Pipette ein-/ausschalten |
| `Umschalt` + Klick (Pipette) | Weitere Farbe aufnehmen, Pipette bleibt aktiv |
| `Leertaste` (halten) | Original einblenden |
| `Esc` | Pipette beenden |

Zusätzlich im Bild-Modus:

| Taste | Funktion |
| --- | --- |
| `←` `→` | Vorheriges / nächstes Bild |
| `C` | Zuschneiden ein-/ausschalten |
| `R` / `Umschalt` + `R` | 90° rechts / links drehen |
| `F` | Vollbild |
| `S` | Diashow starten/stoppen |
| `+` `-` `0` | Vergrößern, verkleinern, einpassen |
| `Entf` | Bild aus der Liste entfernen |

## Start

Die App läuft wahlweise im Browser oder als Desktop-Anwendung (Electron).

| Datei | Ergebnis |
| --- | --- |
| **`start.bat`** | Web-Version: startet den Server und öffnet den Browser |
| **`start-desktop.bat`** | Desktop-Version: startet den Server und öffnet das Programmfenster |

Beide installieren beim ersten Start automatisch die Abhängigkeiten.

## Desktop-App (Electron)

```bash
npm run desktop          # Dev-Server + Programmfenster (Hot Reload)
npm run desktop:preview  # Produktionsbuild im Programmfenster (lädt aus dist/)
```

Was die Desktop-Variante zusätzlich kann:

- **Systemdialoge** statt Browser-Downloads: „Öffnen" mit Mehrfachauswahl, „Speichern unter"
  mit frei wählbarem Pfad
- **Stapelexport in einen Ordner** statt in ein ZIP-Archiv – Zielordner wird abgefragt
- **Anwendungsmenü** mit File / Edit / View / Help, inklusive Moduswechsel (`Strg+1`, `Strg+2`)
  und Theme-Umschaltung (`Strg+T`)
- Nur eine Instanz gleichzeitig; externe Links öffnen im Systembrowser

Die Oberfläche ist identisch – der Renderer erkennt über `src/lib/desktop.js`, ob er in Electron
läuft, und wählt automatisch den passenden Weg. Im Browser bleibt alles beim Download-Verhalten.

Aufbau der Desktop-Schicht:

```
electron/
  main.cjs        Fenster, Anwendungsmenü, IPC-Handler (Dialoge, Dateien schreiben)
  preload.cjs     contextBridge: die einzige Verbindung zwischen Renderer und Node
scripts/
  electron-dev.mjs  startet Vite, wartet auf den Port und danach Electron
src/lib/desktop.js  Adapter: Systemdialoge im Desktop, Downloads im Browser
```

Sicherheitseinstellungen des Fensters: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`. Der Renderer hat keinen Zugriff auf Node – nur auf die acht Funktionen der Bridge.

**Verpacken** (Installer/portable .exe) ist bewusst noch nicht eingerichtet.

## Entwicklung

```bash
npm install
npm run dev
```

Produktionsbuild:

```bash
npm run build
```

## Aufbau

```
src/
  lib/            reine Bildverarbeitung, ohne Vue-Abhängigkeit
    color.js        Farbraum-Helfer
    imageLoader.js  Dateien dekodieren, Hintergrundfarbe erkennen, Farbe abtasten
    photoLoader.js  Bilder für den Bild-Modus lesen: Thumbnails, EXIF-Ausrichtung
    exif.js         minimaler EXIF-Leser (JPEG/APP1) und Orientierungs-Transformation
    photoPipeline.js Verarbeitungskette des Bild-Modus, Auto-Tonwert, Histogramm
    chromaKey.js    Farbe -> Transparenz, Flood-Fill, Despill, Feather, Alpha-Bleeding
    adjustments.js  Tonwert- und Farbkorrekturen (LUT-basiert)
    effects.js      Blur, Schärfen, Posterize, Kontur
    transform.js    Zuschneiden, Drehen, Rand, Eckenmaske, hochwertiges Skalieren
    pipeline.js     Reihenfolge der Verarbeitung
    exportImage.js  Rendern in Zielgrößen, Blob-Erzeugung
    ico.js          .ico-Datei mit eingebetteten PNGs
    presets.js      Export-Pakete je Plattform
    download.js     Download und ZIP (JSZip wird erst bei Bedarf geladen)
  stores/
    ui.js           aktiver Modus und Hinweismeldungen
    editor.js       Logo-Modus: Zustand, Rendering, History, Export
    library.js      Bild-Modus: Bildliste, Bearbeitung, Stapelverarbeitung
  components/       UI (beide Modi, Panels, Canvas, Bausteine)
```

Die Verarbeitungsreihenfolge ist bewusst festgelegt: **Chroma-Key → Maskenkorrektur →
Farbkorrektur → Effekte → Kontur → Geometrie**. Das Keying arbeitet damit immer auf den
Originalfarben, unabhängig davon, wie stark später Helligkeit oder Sättigung verändert werden.

Die Vorschau rechnet auf einer verkleinerten Kopie (max. 1280 px, bei teuren Einstellungen
automatisch weniger) und zieht nach kurzer Pause in voller Vorschauqualität nach. Exportiert
wird immer aus der Originalauflösung.
