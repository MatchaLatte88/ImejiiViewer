# AI Object Removal — Imejii plugin v1

Stand: 4. September 2026. Implementiert als optionales, mit der App ausgeliefertes
First-Party-Plugin. **Kein Codex-Plugin, kein Drittanbieter-Marktplatz und keine
SDXL-Integration.** SDXL/AI Studio bleibt ein eigener späterer Arbeitsbereich.

## Benutzung

1. In der Desktop-App ein Foto öffnen und zu **Images → Plugins** wechseln.
2. **Object removal → Enable plugin** wählen. Aktivierung allein lädt kein Modell.
3. **Download model · 208 MB** anklicken. Quelle, Größe, Lizenz und Prüfsumme stehen
   im Panel. Die App kontaktiert dabei Hugging Face und dessen freigegebenes CDN.
4. **Remove an object** öffnet einen separaten, modal geschützten Arbeitsbereich.
5. Objekt einschließlich Schatten und etwas Rand übermalen. **Erase mask** entfernt
   Auswahlbereiche; **Undo/Redo/Clear** verändern nur die Maske.
6. **Remove object** berechnet die Rekonstruktion. Ein laufender Vorgang lässt sich
   wirklich abbrechen; die Maske bleibt anschließend erhalten.
7. **Before/After** prüfen. Bei Bedarf die Vorschau verwerfen und die Maske korrigieren.
8. **Apply as new photo** speichert eine neue PNG-Variante zuerst lokal und öffnet sie
   anschließend im Editor. Export und `.imejii`-Projekt funktionieren wie gewohnt.

Das Quellfoto und seine Bearbeitungen werden nicht überschrieben. Die Variante
enthält den gerenderten Bearbeitungsstand in voller Arbeitsauflösung, ohne das
optionale Export-Wasserzeichen und ohne die Export-Verkleinerung. Vorherige Regler
sind darin gerastert, nicht erneut auf die Variante angewendet.

Die Maske ist bis zur Übernahme nur Arbeitsspeicher-Zustand. Schließen warnt vor dem
Verwerfen; ein Absturz kann eine noch nicht übernommene Maske verlieren. Übernommene
Ergebnisse werden unabhängig vom aktiven Plugin wiederhergestellt.

## Modell und tatsächliche Grenzen

| Bestandteil | Festgelegte Version / Verhalten |
| --- | --- |
| Modell | Carve/LaMa-ONNX, `lama_fp32.onnx`, Opset 17 |
| Revision | `c3c0c9e468934d62e79c329e35d82dd09ff8c444` |
| SHA-256 | `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6` |
| Download | 208.044.816 Bytes, etwa 198,4 MiB |
| Laufzeit | ONNX Runtime Web 1.29.0, WASM, ein Thread in eigenem Worker |
| Modell-Eingabe | RGB Float32 `[1,3,512,512]`, Werte 0–1; Maske `[1,1,512,512]`, 1 = rekonstruieren |
| Modell-Ausgabe | Float32 `[1,3,512,512]`, Werte **0–255** |
| Foto-Limit | 24 MP; größere Originale vorab als kleinere Kopie exportieren |
| Masken-Limit | Lange Kante 2048 px; 120 Pinselstriche, insgesamt 24.000 Punkte |
| Job-Limit | Ein aktiver Job, 180 Sekunden Timeout; Leerlauf entlädt Worker nach 60 Sekunden |

Der Kontextausschnitt um die Maske wird seitenverhältnistreu auf 512 px vorbereitet,
mit Randpixeln aufgefüllt und nach der Inferenz zurückprojiziert. Nur Pixel mit
Maskendeckung werden komponiert; außerhalb dieser Kompositionsmaske bleiben die
RGBA-Bytes identisch. Das ursprüngliche Alpha bleibt überall erhalten. Zwei
zusätzliche Modellpixel um die Maske helfen der Rekonstruktion; sie erweitern
**nicht** den Bereich, in dem das fertige Foto geändert wird.

Das Ergebnis behält die Fotoabmessungen, aber der rekonstruierte Bereich hat nicht
automatisch native Sensordetails: Es handelt sich um hochskalierte 512-px-Inferenz.
Große Masken, Schrift, Gesichter, komplexe Perspektiven und feine regelmäßige Muster
können sichtbare Fehler ergeben. Über 65 % maskierte Bildfläche wird abgewiesen.
Mehrere weit auseinanderliegende Objekte besser nacheinander entfernen.

Im lokalen Entwicklungsgerät: erster Node/WASM-Probelauf etwa 4,4 s Modellaufbau
plus 23,1 s Inferenz; vollständige Electron-Läufe etwa 26–30 s einschließlich
Modellprüfung/-laden und Komposition. **Keine allgemeine Geschwindigkeitsgarantie.**
Noch keine breite Qualitäts-/Leistungsabnahme auf unterschiedlichen Windows-PCs
oder großen Serien realer Fotos. GPU-Beschleunigung, automatische Objektauswahl,
Segmentierung, Outpainting und generative Prompts sind nicht Teil dieser Version.

## Architektur und Schutzmaßnahmen

- `src/plugins/registry.js`: bekannte, lazy geladene Bundles, Host-API-Version und
  explizite Capability-Liste. Fremde Plugin-URLs oder ausführbare Downloads fehlen
  bewusst. Aktivierung wird als lokale Präferenz gespeichert.
- `src/plugins/host.js`: enges API für Foto-Snapshot und neue Variante. Der Core
  besitzt Dokumentzugriff, Revision, Speicherung und Sperre; Plugin-UI verändert
  keine Foto-Store-Einstellungen direkt.
- `src/plugins/ai-remove/`: Modellmanifest, Maskenwerkzeuge, Pixelpipeline,
  abbrechbarer Worker-Client und eigene UI. Kein stiller Cloud-Fallback.
- `electron/ai-models.cjs`: nur der bekannte Modellschlüssel ist per IPC erlaubt.
  Download über feste HTTPS-Hosts, begrenzte Redirects/Größe/Zeit, Streaming-SHA-256,
  temporäre Datei und erst anschließend Veröffentlichung im Modellcache. Modell
  wird vor jedem Laden erneut geprüft. Defekte, verlinkte und unbekannte Cache-
  Einträge werden nicht als vertrauenswürdige Modelle geladen.
- Renderer bleibt sandboxed, ohne Node oder rohe IPC. CSP erlaubt gezielt
  `wasm-unsafe-eval`, **nicht** JavaScript-`unsafe-eval`, Inline-Skripte oder fremde
  Script-/Worker-Hosts. WASM und MJS werden lokal aus `dist` ausgeliefert.
- Maskieren und Vorschau arbeiten auf einem fixierten Bildstand. Native Menüs,
  globale Tastenkürzel, Einfügen und Moduswechsel greifen nicht in den offenen
  Plugin-Arbeitsbereich ein. Externe Dateiöffnungen werden bis danach zurückgestellt.
- Abbruch/Timeout/Schließen zerstören den eigenen Worker. Späte Ergebnisse werden
  verworfen. Veraltete Quellrevisionen werden nicht übernommen. Speicherversagen
  behält die Vorschau zum erneuten Versuch; wiederholtes Anwenden erzeugt nicht
  beliebig viele persistierte Duplikate desselben Versuchs.

## Persistenz, Farbe und Herkunft

Varianten nutzen dieselbe IndexedDB-/Projektinfrastruktur wie andere Fotos. Auch
eine Variante mit neutralen Reglern zählt als speicherwürdige Arbeit. In
`state.extensions['ai-remove']` stehen Version, Modell-Hash, Quelldokumentkennung,
Quellname, Quellrezept, Erstellungszeit und normalisierte Pinselstriche. Unbekannte
Plugin-Metadaten bleiben beim Projekt-Roundtrip erhalten, begrenzt auf 512.000
JSON-Zeichen; sie werden niemals als Code ausgeführt.

Das Ergebnis enthält sRGB-Profil und die eingestellte EXIF-Allowlist. GPS bleibt
standardmäßig aus. EXIF `Software` kennzeichnet die KI-Bearbeitung und wird auch
bei weiteren Fotoexporten erhalten. Das Info-Panel kennzeichnet die KI-Variante
unabhängig davon, ob das Plugin aktiv ist. Das ist **keine kryptografisch signierte
C2PA-Provenienz**. Ein Variantenprojekt enthält den Ergebnisraster und Herkunft,
nicht noch einmal das vollständige ursprüngliche Quelldokument.

## Modell entfernen, Plugin deaktivieren

**Disable plugin** deaktiviert das Werkzeug, behält aber den heruntergeladenen
Cache. **Remove downloaded model · 208 MB** entfernt nach Rückfrage ausschließlich
das bekannte Modell und dessen Teil-Download; es kann erneut heruntergeladen
werden. Fotos und gespeicherte Varianten bleiben erhalten. Im Browser wird der
Desktop-Hinweis angezeigt; normale Foto- und Projektfunktionen bleiben verfügbar.

## Entwicklung und Prüfung

```text
npm test                  # Lint, Unit-, Canvas-/Browser- und Desktop-Regression
npm run test:ai:download  # ausdrücklicher einmaliger Testmodell-Download
npm run test:ai           # echtes Modell; keine Netzverbindung während Inferenz
npm run pack:win          # lokales, nicht veröffentlichtes Windows-Testpaket
npm run verify:package    # ASAR-Inhalt, Offline-Assets und Electron-Fuses
```

Das Testmodell liegt im ignorierten `build/ai-models/`, nicht im Repository oder
Installer. Tests arbeiten in eigenen temporären Profilen. Prüfberichte und visuelle
Abnahmen: `audit/2026-09-04/ai-*.json` und `ai-*.png`.

Standardtests prüfen Maskengeometrie, CPU-stabiles Undo, unberührte Außenpixel,
Alpha, Modell-IO, defekte Downloads, Redirects, Rechte, Abbruch, Timeout, späte
Antworten, veraltete Snapshots und pluginunabhängige Speicherung. Der echte
Electron-Test prüft aktive Offline-Netzwerkemulation, Worker-Abbruch, anschließende
Inferenz, Vergleich, neue Variante, Projektdatei und Neustart bei deaktiviertem
Plugin. Eine Testform ist keine vollständige fotografische Qualitätsabnahme.

## Lizenzen und Release

LaMa-Modell/Projekt und ONNX-Konvertierung werden mit Apache-2.0 ausgewiesen;
ONNX Runtime mit MIT. Die fest versionierten Original-Lizenztexte und vollständigen
ONNX-Third-Party-Notices liegen in `licenses/` und fließen in das Windows-Paket ein.
Die verwendeten drei WASM-Runtime-Dateien sind zusätzlich in der Lizenzinventur
per Hash fixiert. Die WASM-Bundle-Sourcemap enthält nur ONNX-Web-/Common-Code.
Nicht verwendete WebGL-/ONNX.js-NPM-Abhängigkeiten werden nicht mit ausgeliefert.
Seit dem Freistellungs-Plugin enthält das Paket zusätzlich eine explizit begrenzte
native CPU-Laufzeit; LaMa verwendet weiterhin den WASM-Worker. Andere Runtime-Einstiege oder
Versionsupdates erfordern eine neue Prüfung dieser Inventur.

Dies ist eine lokal implementierte und getestete Funktion, **keine öffentliche
Release-Freigabe**. Bestehende Signierungs-, Downloadkanal- und HEIC-Lizenz-Gates
aus [RELEASE.md](RELEASE.md) / [PHOTO-FEATURES.md](PHOTO-FEATURES.md) bleiben bestehen.

Primärquellen:

- [LaMa-Modellkarte](https://huggingface.co/Carve/LaMa-ONNX/blob/c3c0c9e468934d62e79c329e35d82dd09ff8c444/README.md)
- [Exportcode und Tensor-Konvention](https://github.com/Carve-Photos/lama/blob/main/export_LaMa_to_onnx.ipynb)
- [Original-LaMa](https://github.com/advimman/lama), [Paper](https://arxiv.org/abs/2109.07161)
- [ONNX Web Deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html),
  [WASM-Konfiguration](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
- [ONNX Runtime 1.29.0 Lizenzen](https://github.com/microsoft/onnxruntime/tree/v1.29.0)
