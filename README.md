# Logo Creator

Vue-3-Web-App, die aus beliebigen Bildern transparente Logos und komplette Icon-Sets erzeugt.
Die gesamte Verarbeitung läuft im Browser – es wird nichts hochgeladen.

## Funktionen

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

## Start

Unter Windows genügt ein Doppelklick auf **`start.bat`** – die Datei installiert beim ersten Start
die Abhängigkeiten, startet den Server und öffnet den Browser.

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
    chromaKey.js    Farbe -> Transparenz, Flood-Fill, Despill, Feather, Alpha-Bleeding
    adjustments.js  Tonwert- und Farbkorrekturen (LUT-basiert)
    effects.js      Blur, Schärfen, Posterize, Kontur
    transform.js    Zuschneiden, Drehen, Rand, Eckenmaske, hochwertiges Skalieren
    pipeline.js     Reihenfolge der Verarbeitung
    exportImage.js  Rendern in Zielgrößen, Blob-Erzeugung
    ico.js          .ico-Datei mit eingebetteten PNGs
    presets.js      Export-Pakete je Plattform
    download.js     Download und ZIP (JSZip wird erst bei Bedarf geladen)
  stores/editor.js  Pinia-Store: Zustand, Rendering, History, Export
  components/       UI (Panels, Canvas, Bausteine)
```

Die Verarbeitungsreihenfolge ist bewusst festgelegt: **Chroma-Key → Maskenkorrektur →
Farbkorrektur → Effekte → Kontur → Geometrie**. Das Keying arbeitet damit immer auf den
Originalfarben, unabhängig davon, wie stark später Helligkeit oder Sättigung verändert werden.

Die Vorschau rechnet auf einer verkleinerten Kopie (max. 1280 px, bei teuren Einstellungen
automatisch weniger) und zieht nach kurzer Pause in voller Vorschauqualität nach. Exportiert
wird immer aus der Originalauflösung.
