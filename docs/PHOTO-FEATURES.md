# Foto-Werkzeuge ohne KI

Implementierung vom 4. September 2026. Kein Library-/Katalog-Ausbau und keine KI-Abhängigkeit.

## Bearbeitungen behalten

- **Automatisch:** „Saved work“ sichert nach 650 ms ohne neue Änderung das unveränderte Original,
  die Bearbeitungsparameter und Undo/Redo. Atomare IndexedDB-Transaktionen mit strikter Durability;
  SHA-256 prüft das gespeicherte Original beim Wiederöffnen. Foto- und Logo-Modus werden unterstützt.
- Jede geöffnete Bearbeitung hat eine eigene ID. Varianten desselben Originals überschreiben
  einander nicht; identische Originalbytes werden im lokalen Speicher dedupliziert.
- „Restore“ öffnet die gespeicherte Kopie, auch wenn das ursprüngliche Laufwerk nicht mehr verfügbar ist.
  Löschen entfernt nur die gewählte Sicherung und gegebenenfalls ihre nicht mehr benötigte interne
  Originalkopie, niemals die Quelldatei auf dem Laufwerk.
- **Portable Sicherung:** „Save project…“ erzeugt eine `.imejii`-Datei mit Original, Rezept und
  Verlauf. „Open project“ liest sie wieder ein. Ein begrenzter binärer Container statt ZIP verhindert
  Dekompressionsbomben; beschädigte Originalbytes werden per Prüfsumme erkannt. Versionsprüfung
  und normalisierte Parameter schützen vor ungültigen Projektdateien.
- Projekte sind **nicht verschlüsselt** und enthalten das vollständige Original einschließlich
  privater Metadaten/GPS. Die GPS-Auswahl beim Bildexport verändert die Projektdatei nicht.
- Exportformat, Wasserzeichen und globale Export-/Metadatenpräferenzen sind momentan keine
  Projektbestandteile. Bildbearbeitungen und ihre History sind enthalten.

### Grenzen

Maximal 100 automatische Sicherungen / 2 GiB Originaldaten / 2 MiB Rezept je Sicherung.
Browserquoten können niedriger sein. App-Daten löschen oder ein anderes Browserprofil verwenden
entfernt bzw. trennt die lokalen Sicherungen. Ein Absturz vor Abschluss einer Transaktion kann
die letzten Änderungen verlieren; ein plötzlicher Stromausfall ist nicht vollständig absicherbar.
Die UI zeigt „Unsaved“, „Saving“ und Fehler. Nicht abgeschlossene/fehlgeschlagene Sicherungen
aktivieren weiterhin den Schließschutz. Portable Projekte bleiben die empfohlene unabhängige Sicherung.
Es gibt noch keine Projekt-Dateizuordnung im Explorer; öffnen über „Open project“.

## Farben und Metadaten

Arbeitsfarbraum: **sRGB, 8 Bit pro Kanal**. Chromium übernimmt die Farbkonvertierung profilierter
Browserformate beim Zeichnen in das sRGB-Canvas. HEIF-/TIFF-Pixel erhalten vor dieser Konvertierung
ihr RGB-Quellprofil. Nicht spezifizierte Farben werden als sRGB interpretiert. Farben außerhalb
des sRGB-Farbumfangs können begrenzt werden. Dies ist kein Wide-Gamut-/HDR-/Softproof-Workflow.

PNG, JPEG, WebP und TIFF erhalten ein zum Ergebnis passendes sRGB-ICC-Profil. Das unveränderte
Quellprofil wird **nicht** an bereits konvertierte Pixel angehängt. EXIF-Orientierung wird auf 1,
Pixelabmessungen auf das tatsächliche Ergebnis gesetzt; Quellthumbnails werden nicht kopiert.

Im Exportpanel:

- Kameraangaben standardmäßig an: Hersteller, Modell, Aufnahmedatum, Digitalisierungsdatum,
  Änderungsdatum, Objektivmodell, Belichtungszeit, Blende, Brennweite und ISO, soweit vorhanden.
- Creator/Copyright lassen sich überschreiben; ohne Überschreibung werden vorhandene Angaben
  bei aktiviertem Kameraerhalt übernommen. EXIF-ASCII ersetzt Nicht-ASCII-Zeichen durch `?`;
  die UI weist darauf hin. Noch keine vollständige Unicode-XMP-/IPTC-Verwaltung.
- GPS standardmäßig **aus**. Opt-in übernimmt gültige Breiten-/Längengrade und deren Richtung,
  nicht sämtliche GPS-Zusatzfelder.
- Keine Übernahme von MakerNotes, XMP, IPTC, Seriennummern oder beliebigen EXIF-Feldern.
- Einzelbild-, Batch- und Logo-Rasterexport sowie Clipboard verwenden dieselbe Policy.
  Clipboard-Zielprogramme können Metadaten entfernen. ICO ist kein allgemeiner Foto-Metadatencontainer.

Die Eingabe liest EXIF aus JPEG, PNG, WebP, TIFF und unterstützten HEIF-Dateien. Beschädigte oder
nicht erkannte Metadaten werden nicht erzwungen übernommen. Quellen bleiben unverändert.

## Fotografische Kontrolle

- Lichter, Tiefen, Weiß- und Schwarzpunkt zusätzlich zu den vorhandenen Tonwertreglern.
- Grün-/Magenta-Tint; Weißabgleichspipette aus dem geometrisch korrekt positionierten Original,
  unabhängig von bereits angewandten Farbkorrekturen. Wiederholtes Sampling driftet nicht.
- Fünfpunkt-Tonkurve mit Maus-/Touch- und Tastaturbedienung, numerischen ARIA-Werten und Reset.
- Clipping-Anzeige: Rot bei einem Kanal ab 254, Blau bei allen Kanälen bis 1. Nur Ansicht,
  keine Markierungen im Export; kein Sensor-/RAW-Clipping-Nachweis.
- Bis zu acht lokale Radial-/Verlaufsmasken mit Belichtung ±2 EV, Position, Radius/Übergang,
  Feather bei Radialmasken, Verlaufswinkel, Umkehr und Ein/Aus. Belichtung in linearem Licht;
  Masken bleiben am orientierten Original verankert, auch nach Crop/Rotation/Resize.
  Positionierung in der Original-Miniatur oder über numerische Regler. Undo, Autosave,
  Projektdatei und „Apply to all“ schließen diese Masken ein.
- Vorhandene selektive Farbkorrekturen und der Vergleichs-Slider bleiben erhalten.

Lokale Reparatur/Healing, Klonstempel, gemalte Masken, Objektivprofile, geometrische Perspektivkorrektur,
vollständige RAW-Entwicklung und durchgängiges 16-Bit-Processing sind **nicht** Teil dieser Ausbaustufe.
Lichterregler können abgeschnittene Sensordaten nicht wiederherstellen.

## Weitere Formate

| Format | Umfang |
| --- | --- |
| HEIC / HEIF | Lokaler HEVC-Decoder, erstes vom Decoder gelistetes Bild, SDR-Arbeitskopie. Original bleibt erhalten. |
| HEIF-Farbe | RGB-ICC, sRGB-/Display-P3-NCLX und BT.709-Transfer bei BT.709-Primärfarben. PQ/HLG, widersprüchliche Profile und sonstige definierte Farbräume werden abgewiesen. |
| TIFF / TIF | Klassisches TIFF, erste Seite; unterstützte unsigned RGB-, Grau- und Palettenformate. 16-Bit-Eingaben werden ausdrücklich auf 8 Bit reduziert. Ausrichtung wird einmal angewandt. |
| TIFF-Export | Unkomprimiertes RGBA, 8 Bit/Kanal, nicht vormultipliziertes Alpha, ICC und gewählte EXIF-Felder. |

BigTIFF, CMYK-/Float-TIFF, SubIFD-/Pyramiden-TIFF und profilierte Nicht-RGB-TIFFs benötigen vorherige
Konvertierung. HEIF ist ein Container: nicht jeder Codec, jedes HDR-/Mehrbild-/Clean-Aperture-Sonderformat
wird unterstützt. Ein spezielles libheif-Padding-Testbild lässt sich mit dem gebündelten Decoder
nicht dekodieren; die App meldet einen Fehler. Der reguläre HEVC-Farbtest funktioniert.
Vorhandene Eingabegrenzen gelten weiter: 128 MiB, 40 MP, 16.384 px pro Kante.

Decoder laufen in terminierbaren Workern mit 45-s-Timeout und begrenzter Container-/IFD-Vorprüfung.
Der HEIC-Worker wird beim Start/Build als separate CSP-kompatible Datei aus dem gepinnten Paket
extrahiert. Keine Laufzeitinstallation, kein Upload, keine Aufweichung von CSP, Sandbox oder IPC.

## Architektur / Prüfung

`drafts.js` trennt Originalspeicher, Versionierung und portable Projektdateien vom UI-Store.
`photoMetadata.js` schreibt eine explizite EXIF-Allowlist und injiziert ICC/EXIF in die Zielformate.
`extendedFormats.js` und `tiffWorker.js` kapseln die zusätzlichen Decoder. `localLight.js` und
`photoCurves.js` sind reine Pixel-/Parameterfunktionen; die bestehende Worker-Pipeline bleibt zuständig.
Der Frontend-Design-Skill wurde für die Integration in die vorhandenen Panels verwendet;
keine neue Designsprache und kein zusätzliches UI-Framework.

Regressionen: `tests/photo-upgrade-checks.js` (Metadaten in vier Formaten, GPS, P3-Konvertierung,
TIFF-Ausrichtung, HEIC, schadhafte Dateien, Tonwerte, Masken, Varianten, Projekte, Undo, Quotenfehler),
plus `tests/desktop-smoke.cjs` (native TIFF-/Projektdatei, Wiederherstellung nach Reload und HEIC
unter Produktions-CSP). Der Neustarttest startet den Renderer neu, nicht das komplette Betriebssystem.
Sauberer Windows-Installations-/Update-/Hardwaretest bleibt Release-Abnahme.

## Drittanbieter und Release-Gate

- `exifr@7.1.3`: MIT. [Quellprojekt](https://github.com/MikeKovarik/exifr).
- `utif2@4.1.0`: MIT; TIFF-Decoder. [UTIF](https://github.com/photopea/UTIF.js).
- `heic-to@1.5.2`: LGPL-3.0 laut Paket, LICENSE erlaubt v3 oder später;
  enthält libheif 1.22.2 und laut Buildanleitung libde265 1.0.16.
  [Quellprojekt und Build](https://github.com/hoppergee/heic-to),
  [libheif](https://github.com/strukturag/libheif), [libde265](https://github.com/strukturag/libde265).
- `sRGB-v4.icc` und `DisplayP3-v4.icc`: unveränderte 480-Byte-Profile aus
  [Compact ICC Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles), CC0-1.0.
  Das abgeleitete BT.709-Profil verwendet dieselben Primärfarben mit der inversen
  [ITU-R-BT.709-Transferfunktion](https://www.itu.int/rec/R-REC-BT.709/en).
- HEIC-Testdaten: libheif, Commit `5a3d4f84431f1e2594c7ae3112d00a2b96a6edf0`, LGPL-3.0;
  `rainbow-451x461.heic` (SHA-256 `4b2ce727f093944975f143ba2b39c4c64511b766d94552f8d51a755916e7f983`)
  sowie `conformance_window_padding.heic` (Hash im Test). Testdaten werden nicht mit der App ausgeliefert.

**Vor öffentlicher Auslieferung des HEIC-Decoders:** genaue gebündelte Quellstände und Buildänderungen
prüfen, erforderliche Corresponding Sources und Lizenztexte bereitstellen sowie eine geeignete
Möglichkeit zum Rekombinieren/Ersetzen und gegebenenfalls Installationsinformationen schaffen.
Eine separate JS-Datei und automatisch gesammelte npm-Lizenzen allein belegen keine vollständige
LGPL-Konformität; insbesondere ASAR-Integrität und Signierung sind bei dieser Prüfung einzubeziehen.
Herausgeberfreigabe erforderlich. Grundlage: [LGPL v3, Abschnitt 4](https://www.gnu.org/licenses/lgpl).
Es wurde in dieser Implementierung kein öffentliches Paket veröffentlicht.

Der npm-Advisory-Dienst war beim ersten vollständigen und beim separaten Produktions-Audit nicht
erreichbar (Timeout). Daraus folgt **kein** aktuelles „0 Vulnerabilities“. Vor Release erneut prüfen.
