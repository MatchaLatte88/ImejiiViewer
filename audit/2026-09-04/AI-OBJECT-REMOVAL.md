# AI Object Removal — Implementierung und Abnahme

4. September 2026 · Windows x64 · Electron 44.1.1 / Chromium 152 · Node 24.13.0.

## Ergebnis

Optionales First-Party-Imejii-Plugin mit echtem lokalem LaMa-Inpainting implementiert.
Einstieg: **Images → Plugins → Object removal**. Separater Maskenarbeitsbereich,
Pinsel/Radierer, Undo/Redo, Vergleich, echter Abbruch und persistente neue Variante.
Kein Upload von Fotos, kein Cloud-Fallback, keine SDXL- oder Marktplatzfunktion.

## Prüfungen

- ESLint: bestanden, keine Warnungen.
- Unit/Sicherheitsprüfungen: **25/25** bestanden, darunter 10 neue Modellcache-Tests.
- Canvas-/Browser-Regression: **83/83** bestanden, keine Konsolenfehler.
- Bisherige Desktop-Regression: **15/15** bestanden, keine unerwarteten Konsolenfehler.
- Echter KI-Desktop-Ablauf: **8/8** bestanden, keine Konsolenfehler; Netzwerkemulation
  offline während Modellladen/Inferenz. Modell aus separatem lokalen Testcache.
- Derselbe reale KI-Ablauf aus dem finalen ASAR: **8/8** bestanden, ebenfalls ohne
  Konsolenfehler. Insgesamt **139 erfolgreiche Testfälle**, plus Lint und Paketprüfung.
- Windows-Testpaket gebaut; ASAR-Inventur, Runtime-Assets, Modellkatalog und Fuses
  geprüft. Keine Modellgewichte, Tests oder `node_modules` im Paket.
- `npm audit --omit=dev`: **0 bekannte Schwachstellen** gemeldet.
- Helle und dunkle Oberfläche sowie 1024 × 640 und 1440 × 1000 Fenster visuell geprüft.

Dateien: `ai-renderer.json`, `ai-desktop-regression.json`, `ai-desktop.json`;
separater KI-Lauf aus dem gebauten ASAR: `ai-asar.json`. Screenshots: `ai-plugin-setup.png`,
`ai-removal-mask.png`, `ai-removal-preview.png`, `ai-removal-light.png`,
`ai-removal-compact.png`. `ai-result.png` enthält den tatsächlichen Modelloutput
auf der synthetischen Testgrafik, nicht eine simulierte Vorschau.

Während der Prüfung korrigiert: minimaler CPU/GPU-Antialiasing-Drift bei Masken-Undo,
ResizeObserver-Rückkopplung beim Fensterwechsel, Host-Speicher-/Dialogschutz sowie
vollständige Lizenzinventur der tatsächlich ausgelieferten WASM-Runtime.

## Ressourcen und Grenzen

- Modell: exakt 208.044.816 Bytes, gepinnte Revision und SHA-256; Downloadmanager
  tatsächlich gegen die Modellquelle ausgeführt und Integrität geprüft.
- Erster Node-WASM-Probelauf: 4,416 s Modellaufbau + 23,149 s Inferenz.
- Desktop-Testläufe: ungefähr 26–30 s für den vollständigen Berechnungsschritt;
  Messwerte stehen im jeweiligen JSON. Keine allgemeine Leistungszusage.
- 24-MP-Fotolimit, 512-px-Kontextinferenz, 2048-px-Maskenansicht. 120 Striche,
  24.000 Punkte; ein Worker, 180-s-Timeout, 60-s-Leerlaufentladung.
- Repräsentative Serien realer Fotos, mehrere Hardwareklassen und echte frisch
  installierte/signierte Windows-Version wurden nicht umfassend abgenommen.
- Noch nicht übernommene Masken/Vorschauen sind nicht crash-persistent. Übernommene
  Ergebnisse und Herkunftsdaten überleben Neustart und deaktiviertes Plugin.
- Die GPU/CPU-Rasterabweichung wurde durch stabile CPU-Maskenrasterung gelöst, nicht
  durch ungenauere Tests. Die Größenänderungswarnung wurde im Observer korrigiert,
  nicht aus den Konsolenfehlern herausgefiltert.

## Release-Status

Lokales Testpaket, **nicht veröffentlicht**. Authenticode-Prüfung der EXE:
`NotSigned`; die Builder-Meldung „signing with signtool.exe“ ist kein Signaturnachweis.
Bestehende Signierungs-/Downloadkanal- und HEIC-Compliance-Gates gelten weiterhin.
Kein Commit und kein Push für diese Implementierung ausgeführt.

Technische Details, Modellquellen und Bedienung:
[AI-OBJECT-REMOVAL.md](../../docs/AI-OBJECT-REMOVAL.md).
