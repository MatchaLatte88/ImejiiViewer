# Release-Abnahme

Der Audit-Fix ist die technische Vorbereitung, keine Veröffentlichung. Primäres Paketierungsziel
ist Windows x64. macOS, Linux und Windows ARM64 sind nicht als getestet freigegeben.

## Reproduzierbare lokale Prüfung

1. Node 24 installieren, dann `npm ci`.
2. `npm test` muss vollständig grün sein.
3. `npm audit --audit-level=high` und `npm audit --omit=dev --audit-level=high` prüfen.
4. `npm run pack:win`: App-Ordner ohne Installation erstellen.
5. `npm run dist:win`: NSIS-Installer lokal erstellen. Kein automatisches Publizieren.
6. `npm run verify:package`: Inhalt von `resources/app.asar`, Lizenztexte und Fuse-Werte prüfen.

Die CI führt Lint, Build und Regressionstests auf Windows aus. Ein erfolgreicher lokaler Lauf
belegt noch keinen erfolgreichen GitHub-Actions-Lauf.

## Entscheidungen vor der ersten öffentlichen Version

Herausgeber: **Frederik Morbe**. In `package.json` als `author.name` hinterlegt;
electron-builder übernimmt den Namen in die Windows-Herausgeber-/Hersteller-Metadaten.
Das ist keine digitale Signierung. Bereits gebaute Pakete müssen neu erstellt werden.

- Rechtliche Produktangaben, Lizenz des eigenen Anwendungscodes und
  die technische App-ID `io.imejii.viewer` verbindlich freigeben.
- Windows-Signierungsidentität beschaffen. Zugangsdaten nur als Build-Secrets, niemals im Repository.
  `npm run dist:win:signed` bricht ohne erfolgreiche Signierung ab.
- Einen kontrollierten HTTPS-Downloadkanal, Versions-/Änderungsübersicht und Supportkontakt festlegen.
- Manuelle Updates für v1: getesteten, signierten Installer herunterladen; bestehende App schließen;
  Update installieren. App-Profil erhalten. Vor Downgrade Presets/Profil sichern; vorherige
  signierte Version bereithalten. Es ist noch kein automatischer Updater implementiert.
- Drittanbieter-Lizenzhinweise werden aus installierten Paketen gesammelt. Die Lizenz des eigenen
  Codes und rechtliche Endnutzertexte bleiben Sache des Herausgebers.

## Abnahme auf sauberem Windows

- Standardbenutzer ohne Node/npm; Installation, Start, Update und Deinstallation ohne Datenverlust.
- Explorer-Doppelklick/„Öffnen mit“, mehrere Dateien, zweite Instanz, Unicode-/Leerzeichenpfade.
- Dateizuordnungen und Rücknahme beim Deinstallieren prüfen; bestehende Standardprogramme dürfen
  nicht unbemerkt ersetzt werden. Installer ist per-user und fordert keine Administratorrechte an.
- Offlinebetrieb; blockierte Schreibrechte; vorhandene Zieldateien; voller Datenträger;
  Exportabbruch und abgezogene Wechseldatenträger.
- 12/24-MP-Bilder, abgewiesene übergroße Eingaben, defekte Dateien, breite Panoramen und
  große Sammlungen; RAM-Spitzen und Interaktionslatenz auf Zielhardware messen.
- 100%/150%/200% DPI, mehrere Monitore, Tastaturbedienung, Hell/Dunkel.
- Schließen mit Änderungen: „Keep working“ erhält Zustand, „Discard“ beendet.
- Virenscanner/SmartScreen und Authenticode-Signatur des finalen Installers und der EXE prüfen.

## Sicherheitskonzept des Pakets

Main-Frame/Sender-Prüfung für alle IPC-Aufrufe, capability-basierte Bild- und Exportzugriffe,
eigenes `imejii://app`-Protokoll statt `file://`, CSP und blockierte Fremd-Navigation.
Set-Exporte erhalten neue Unterordner; bestehende Dateien werden nicht ersetzt.
Explizites „Speichern unter“ verwendet eine temporäre Datei und eine kontrollierte Veröffentlichung.
Der Pfadschutz ist kein Schutz gegen einen lokalen Administrator, der parallel das Dateisystem manipuliert.

Die Paketierung deaktiviert RunAsNode, Node-Options, Node-CLI-Inspect und zusätzliche
file-Protokollprivilegien. ASAR-only und ASAR-Integritätsprüfung sind aktiv.
Grundlagen: [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security),
[Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses),
[electron-builder-Konfiguration](https://www.electron.build/v26/docs/configuration/).

## Bewusste Produktgrenzen

Automatische lokale Sicherungen und portable `.imejii`-Projekte sind implementiert.
Änderungen vor Abschluss der Sicherung können bei Prozessabsturz verloren gehen.
Keine originalgetreue Animation; erste Seite bei HEIF/TIFF, kein RAW-/HDR-/16-Bit-Arbeitsworkflow.
Rasterexport in sRGB mit passendem ICC und EXIF-Allowlist; GPS nur auf ausdrückliches Opt-in.
40 MP / 16.384 px / 128 MiB Eingabegrenzen; Logo-Arbeitsauflösung bis 4096 px.
Nicht alle Eingabeformate lassen sich vor dem Browserdecoder vollständig per Header prüfen.
Diese Grenzen und ein kleiner synthetischer Lasttest ersetzen keinen Langzeittest auf Zielhardware.

## Zusätzliche Foto-Release-Prüfung

- [Foto-Funktionsumfang und Einschränkungen](PHOTO-FEATURES.md) abnehmen; insbesondere HEIC/TIFF
  mit eigenen Kamera-/Smartphone-Dateien und Referenz-Farbsoftware prüfen.
- `.imejii`-Projekte sichern, öffnen und nach echtem App-/Betriebssystem-Neustart prüfen;
  Speicherquote, volles Laufwerk und Update des App-Profils testen.
- **HEIC-LGPL-Gate:** gebündelte Quellen/Versionen, vollständige Lizenztexte, Corresponding Sources,
  Rekombinierbarkeit und gegebenenfalls Installationsinformationen prüfen/bereitstellen.
  Die bisherigen npm-Notices allein decken eingebettete native Decoder nicht vollständig ab.
- npm-Advisory-Audit vor Veröffentlichung wiederholen: der Dienst lieferte beim Foto-Ausbau Timeouts.
