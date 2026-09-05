# Imejii

Bildbetrachter mit Werkzeugkasten. **Betrachter** zeigt ein Bild und blättert durch seinen
Ordner, **Images** ist Editor und Stapel-Konverter für ganze Bildserien, **Logo** stellt Bilder
frei und erzeugt komplette Icon-Sets. Die App läuft im Browser oder als Desktop-Programm,
die Verarbeitung passiert lokal – es wird nichts hochgeladen.

## Betrachter

Der Startbildschirm ist ein reiner Betrachter – ein Bild, sonst nichts.

- `←` `→` blättern durch den Ordner des geöffneten Bildes (Desktop-Variante). Nachbarbilder
  werden erst beim Anzeigen gelesen. Bearbeitete Bilder und ihre History bleiben erhalten;
  unbearbeitete, nur durchgeblätterte Nachbarn werden wieder freigegeben.
- Vollbild per `F` oder Doppelklick: nur das Bild, Statusleiste und Pfeile ziehen sich nach
  kurzer Ruhe zurück und kommen bei jeder Mausbewegung wieder.
- Zoom und Verschieben, Diashow mit einstellbarem Intervall, `Entf` schließt das Bild.
- Der Zoomknopf lädt echte Originalauflösung nach (1:1-Pixel). Bis dahin ist die reduzierte
  Ansicht großer Bilder ausdrücklich als „Preview“ gekennzeichnet.
- Ein Klick führt weiter in den Bild-Modus (bearbeiten) oder den Logo-Modus (freistellen).

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
- Größen einzeln oder als Set (16 – 1024 px): Desktop in einen neuen Unterordner, Browser als ZIP
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
- Bis zu 1.000 Bilder gleichzeitig laden, Vorschauleiste mit tastaturbedienbaren Thumbnails
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
- Einzelbild als PNG, WebP, JPG oder 8-Bit-TIFF speichern oder in die Zwischenablage kopieren
- Stapelverarbeitung: gemeinsames Zielformat, Qualität und Größe für alle Bilder,
  wahlweise mit oder ohne Einzelbearbeitungen. Desktop: neuer Unterordner, Browser: ZIP.
  Einstellungen, Bildliste und Wasserzeichen werden beim Start festgehalten. Abbruch ist möglich;
  bereits fertig geschriebene Desktop-Dateien bleiben erhalten und ihr Pfad wird angezeigt.
- Namensmuster mit `{name}`, `{index}`, `{width}`, `{height}`; Fortschrittsanzeige

### Unterstützte Eingabeformate

`.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` `.avif` `.svg` `.ico` `.heic` `.heif` `.tif` `.tiff`

### Lokale KI-Plugins (Desktop)

Unter **Images → Plugins** lassen sich die Werkzeuge einzeln aktivieren:

- **Background removal:** Motiv mit BiRefNet Lite automatisch freistellen. Einmalig
  224 MB Modell herunterladen, danach offline auf der CPU. Original-/Maskenvergleich,
  helle/dunkle Prüfhintergründe, Kantenregler und Korrekturpinsel mit Undo/Redo.
  **Subject Studio** ergänzt getrennte Motiv-/Hintergrundkorrekturen, Portrait-Unschärfe,
  Color Splash, eigene Hintergründe, Produktformate, Sticker mit Kontur/Schatten,
  motivbewussten Zuschnitt sowie Maskenübergabe an LaMa und Bild-/Maskenexport für SDXL.
  Übernehmen erzeugt eine separate gerenderte PNG-Variante; das Original bleibt
  erhalten. Studio-Stile sind im Ergebnis gerastert, keine editierbaren Ebenen.
  [Bedienung und Grenzen](docs/AI-CUTOUT.md).
- **Object removal:** Markierte Objekte mit LaMa entfernen; eigener Modell-Download
  von 208 MB und unabhängige Aktivierung. [Bedienung und Grenzen](docs/AI-OBJECT-REMOVAL.md).

Beide Werkzeuge unterstützen Fotos bis 24 MP. Modellgewichte werden nicht im Installer
mitgeliefert. Gespeicherte Varianten und Projekte öffnen auch ohne aktives Plugin.

### Dauerhafte Foto-Bearbeitung

Automatische lokale Sicherungen enthalten Original, Einstellungen und Undo/Redo. Über „Saved work“
wieder öffnen; „Save project…“ / „Open project“ sichern und öffnen portable `.imejii`-Dateien.
Neu: Lichter/Tiefen, Weiß-/Schwarzpunkt, Tint, Weißabgleichspipette, Tonkurve, Clipping-Anzeige
und lokale Radial-/Verlaufsmasken. Alles bleibt nicht-destruktiv und ohne KI.

Rasterexporte verwenden sRGB mit eingebettetem ICC-Profil und wählbarer EXIF-Übernahme; GPS ist
standardmäßig aus. [Funktionsumfang, Bedienung, Grenzen und Decoder-Lizenzen](docs/PHOTO-FEATURES.md).

Grenzen und Exportverhalten:

- Eingabe: maximal 128 MiB, 40 Megapixel und 16.384 px je Kante; ebenso maximal 40 MP pro Ergebnis-Canvas.
- Fotos: Vorschau bis 2600 px, 1:1-Ansicht auf Wunsch in voller Auflösung; Export aus der Originalauflösung innerhalb der Sicherheitsgrenzen.
- Logos: Arbeitsauflösung maximal 4096 px; größere Quellen werden verkleinert und die App zeigt einen Hinweis.
- Browser: maximal 512 MiB Quelldateien in der Sammlung und 256 MiB unkomprimierte ZIP-Einträge.
- Desktop: Originale werden über autorisierte Handles bei Bedarf gelesen. Ein Exportset ist auf 1.000 Dateien / 4 GiB begrenzt.
- Statisches Rasterbild, SVG wird gerastert. HEIF/TIFF: erstes Bild, nicht alle Codec-/Seitenvarianten. 16-Bit-TIFF wird auf 8 Bit reduziert; kein RAW-/HDR-Workflow.
- Arbeitsfarbraum sRGB/8 Bit; profilspezifische Eingabefarben werden konvertiert, größere Farbräume können clippen. EXIF-Allowlist statt vollständiger XMP/IPTC/MakerNote-Übernahme.
- Automatische Sicherungen: maximal 100 / 2 GiB Originale, abhängig von Speicherquote. App-/Browserdaten löschen entfernt sie. Portable Projekte separat sichern; sie enthalten auch private Originalmetadaten.
- JPEG ist verlustbehaftet und unterstützt kein Alpha: transparente Bereiche werden weiß. PNG/WebP unterstützen Transparenz; WebP-Export kann verlustbehaftet sein.
- Feste Icon-Pakete verwenden PNG/ICO unabhängig vom ausgewählten Einzelbildformat. Ein macOS-Paket ist ein PNG-Iconset, noch keine fertige ICNS-Datei.

### Tastenkürzel

| Taste | Funktion |
| --- | --- |
| `Strg` + `O` | Bild öffnen |
| `Strg` + `V` | Bild aus der Zwischenablage einfügen |
| `Strg` + `Z` / `Strg` + `Umschalt` + `Z` | Rückgängig / Wiederholen |
| `Strg` + `S` | Aktuelles Ergebnis als PNG exportieren (Foto: Originalquelle; Logo: Arbeitsauflösung) |
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
- Nur eine Instanz gleichzeitig; Dateiübergabe an die laufende App. Navigation und neue Fenster sind gesperrt.

Die Oberfläche ist identisch – der Renderer erkennt über `src/lib/desktop.js`, ob er in Electron
läuft, und wählt automatisch den passenden Weg. Im Browser bleibt alles beim Download-Verhalten.

Aufbau der Desktop-Schicht:

```
electron/
  main.cjs        Fenster, Menüs, validierte IPC-Handler
  security.cjs    Senderprüfung, internes imejii://-Protokoll und CSP
  file-access.cjs Datei-/Export-Handles, Grenzen und kollisionssicheres Schreiben
  preload.cjs     contextBridge: die einzige Verbindung zwischen Renderer und Node
scripts/
  electron-dev.mjs  startet Vite, wartet auf den Port und danach Electron
src/lib/desktop.js  Adapter: Systemdialoge im Desktop, Downloads im Browser
```

Sicherheitseinstellungen des Fensters: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`. Der Renderer hat keinen Zugriff auf Node. Die Bridge akzeptiert für
Lesezugriffe nur vom Hauptprozess vergebene Bild-IDs und für Set-Exporte zeitlich begrenzte
Export-Handles. Native Drag-and-drop-Dateien werden im Preload mit `webUtils` registriert.
Jeder IPC-Aufruf prüft Fenster, Main-Frame und vertrauenswürdige URL. Dateien werden nicht als HTML geöffnet.

## Prüfen und verpacken

Node.js 24 und das eingecheckte Lockfile verwenden:

```bash
npm ci
npm test                # Lint, Dateisicherheit, Build, Renderer-/Browser- und Desktop-Tests
npm run pack:win        # lokaler Windows-x64-App-Ordner unter release/
npm run dist:win        # lokaler NSIS-Installer, kein Upload
npm run dist:win:signed # setzt erfolgreiche Code-Signierung zwingend voraus
```

Die Paketierung enthält nur die gebaute Oberfläche, Electron-Main/Preload und Metadaten,
nicht Quellcode, Tests, Auditdateien oder node_modules. Icons werden aus der vorhandenen
Imejii-Marke erzeugt; Lizenztexte der Produktionsabhängigkeiten werden mitgeliefert.
ASAR-Integritätsprüfung und restriktive Electron-Fuses werden beim Packen aktiviert.

Herausgeber ist Frederik Morbe (Paket-Metadaten, noch keine digitale Signierung).

**Ein lokales Paket ist noch keine Launch-Freigabe.** Signierungszertifikat,
Downloadkanal und Abnahme des installierten Programms stehen separat an.
Details: [Release-Checkliste](docs/RELEASE.md), [Fix-Status](audit/2026-09-04/FIXES.md).

## Entwicklung

```bash
npm ci
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
wird im Logo-Modus aus der maximal 4096 px großen Arbeitsquelle. Fotoexporte nutzen
die Originalquelle innerhalb der Sicherheitsgrenzen. Aufwendige Fotoverarbeitung und
Logo-Export laufen in einem abbrechbaren Worker.

## Speicherung und Datenschutz

Bildverarbeitung erfolgt lokal, ohne Cloud-Upload, Analyse- oder Telemetriedienst. AI Studio
kopiert ausgewählte Bild-/Maskendaten erst auf Nutzeraktion zur eigenen lokalen ComfyUI.
Die Desktop-App
blockiert externe Renderer-Netzwerkanfragen. Theme und selbst gespeicherte Logo-Presets
liegen lokal im App-Profil bzw. Browser-localStorage. Quelldateien werden nicht verändert,
außer wenn man im nativen „Speichern unter“-Dialog ausdrücklich eine bestehende Datei ersetzt.

Bearbeitungen werden über „Saved work“ lokal gesichert; portable `.imejii`-Projekte
lassen sich separat exportieren. AI Studio speichert Quellen, Masken, Striche und Varianten
dauerhaft; ein `IMEJII02`-Projekt nimmt die Binärartefakte mit. Nicht übernommene
Cutout-/LaMa-Dialogvorschauen bleiben im Arbeitsspeicher. Vor deren Verwerfen erscheint
eine Rückfrage; ein Absturz kann diese Zwischenstände verlieren. Ein exportiertes
Rasterbild enthält das Ergebnis, nicht den Undo-Verlauf. Die App installiert keine automatischen Updates.

## AI Studio · SDXL

Optional unter **Images → Plugins → AI Studio · SDXL** aktivieren. Ein eigener
Hauptmodus bietet SDXL Text-to-Image, Inpainting und Outpainting mit festen lokalen
Workflows, Maskenpinsel, Randverlängerung, Varianten, lokale Sitzungen und direkte
Übergabe aus Subject Studio. Lokale Community-SDXL-Checkpoints im `.safetensors`-Format
lassen sich aus der von ComfyUI gemeldeten Modellliste auswählen; jede Kombination aus
Modell und Workflow erhält einen eigenen Testlauf. Inpainting sendet einen szenenbewussten
Kontextausschnitt und verwendet vollständiges Denoising, damit die neutrale Maskenfüllung
nicht als graue Fläche im Ergebnis bleibt. Originale bleiben erhalten. Der erste Adapter verbindet
eine selbst gestartete ComfyUI auf `127.0.0.1`; Runtime und SDXL-Gewichte werden nicht
mitgeliefert oder automatisch geladen. Eine später verwaltete Runtime soll ComfyUI im
normalen Betrieb unsichtbar starten und beenden.

**Entwicklungsstand:** UI-, Masken-, Speicher- und Protokolltests vorhanden. Die echte
SDXL-Modell-/Hardwareabnahme steht aus; der erste Lauf pro Verbindung ist deshalb
ausdrücklich ein lokaler Test. Einrichtung, Workflow, Grenzen und Tests:
[AI Studio](docs/SDXL-STUDIO.md).
