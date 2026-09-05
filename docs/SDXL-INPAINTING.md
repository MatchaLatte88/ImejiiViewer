# SDXL-Inpainting in Imejii - Umsetzungsplan

Stand: 2026-09-04. Ziel ist lokales Inpainting auf SDXL-Basis als optionaler, nachladbarer Teil von
Imejii. FLUX, Qwen und andere Modellfamilien sind bewusst ausgeklammert - sie aendern nur Schicht 1
und koennen spaeter dazukommen, ohne den Plan umzuwerfen.

## 0. Was wir bauen und was nicht

Eine KI-Integration hat vier Schichten. Wir schreiben zwei davon selbst:

| Schicht | Herkunft |
| --- | --- |
| 1 Gewichte | SDXL-Checkpoint, vom Nutzer zur Laufzeit geladen. Nie im Installer. |
| 2 Inferenz-Laufzeit | [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp), **MIT**. Eingebunden, nicht geschrieben. Auch Fooocus hat hier ComfyUI einvendort. |
| 3 Pipeline-Logik | **uns.** Maske, Ausschnitt, Fuellung, weiche Kante, Farbangleich, Einsetzen. Hier sitzt die Qualitaet. |
| 4 Oberflaeche | **uns.** Pinsel, Panel, Auftragsverwaltung, Bibliothek. |

**Nicht im Umfang:** Text-zu-Bild ohne Ausgangsbild (Imejii ist ein Editor, kein Generator),
ControlNet, Face-Swap, LoRA-Verwaltung, Modelltraining, FLUX/Qwen, Cloud-Anbieter.

## 1. Sechs Entscheidungen, die den Plan tragen

1. **Der Sidecar spricht ausschliesslich mit dem Main-Prozess, nie mit dem Renderer.**
   `electron/security.cjs:35` setzt `connect-src 'self'`. Statt die CSP fuer einen lokalen Port
   aufzuweichen, laeuft alles ueber bestehende `handle()`-Kanaele mit `assertSender`. Der Renderer
   erfaehrt den Port nicht einmal. Die CSP bleibt unveraendert.
2. **Subprozess statt nativem Node-Addon.** `npmRebuild: false` bleibt bestehen, keine
   Electron-ABI-Matrix, Abbruch durch Prozessende, ein Absturz reisst die App nicht mit.
3. **SDXL-Inpaint-Checkpoint (9-Kanal-UNet) als Vorgabe**, maskiertes img2img als Rueckfall fuer
   beliebige SDXL-Checkpoints. Welcher gewinnt, entscheidet P0.
4. **Keine Gewichte im Installer.** Download zur Laufzeit nach `app.getPath('userData')/models`,
   Lizenz vorher sichtbar. Damit sind wir Werkzeug, nicht Modell-Distributor.
5. **Vulkan ist der ausgelieferte Standard**, CUDA optional nachladbar. Vulkan deckt AMD, Intel und
   Nvidia mit einer Binaerdatei ab und umgeht die Frage nach der Weitergabe von
   NVIDIA-Runtime-Bibliotheken vollstaendig.
6. **C2PA-Markierung ab der ersten Version.** EU AI Act Art. 50 gilt seit dem 2. August 2026:
   synthetische Bilder muessen maschinenlesbar als KI-generiert markiert sein. Nachruesten ist teurer
   als Einbauen.

## 2. Phasen

### P0 - Spike, ausserhalb des Repos (Gate fuer alles Weitere)

Ohne Messwerte ist jede Zusage geraten.

1. `stable-diffusion.cpp` zweimal bauen: `-DSD_VULKAN=ON` und `-DSD_CUDA=ON` mit CUDA 12.8 und
   `CMAKE_CUDA_ARCHITECTURES=120` (Blackwell). Startet die Vulkan-Variante auf der 5090?
2. Zehn Testbilder mit Maske, drei Aufgabenarten: Objekt entfernen, Objekt einsetzen, Hintergrund
   erweitern.
3. Je Bild durch (a) SDXL-Inpaint-Checkpoint und (b) maskiertes img2img auf einem normalen
   SDXL-Checkpoint. Quantisierung Q4 / Q6 / Q8 vergleichen.
4. Protokollieren: Wanduhr-Zeit, VRAM-Spitze, Ladezeit des Modells, Qualitaet gegen Photoshop
   Generative Fill.
5. Ausserdem festhalten: die genauen Feldnamen der `sd-server`-Schnittstelle und ob sie Maske und
   Denoise-Staerke so annimmt, wie wir sie brauchen. Die Doku sagt dazu nichts.

**Ergebnis:** Vorgabemodell, Quantisierung, Schrittzahl, Sampler, Standard-Denoise, Backend-Wahl.
**Abbruchkriterium:** Wenn (a) und (b) beide sichtbar schlechter sind als Photoshop, ist die
AI-Edition kein verkaufbares Versprechen - dann endet der Plan hier.

### P1 - Maske (reines Frontend, kein Modell noetig)

- `src/lib/maskCanvas.js`: Pinselstrich, Radierer, Erode/Dilate, Feather, Umschliessungsrechteck,
  Aufweitung auf das Respective Field. Box-Blur und Alpha-Operationen sind in `effects.js` und
  `chromaKey.js` bereits vorhanden und werden wiederverwendet.
- `PhotoViewer.vue`: Maskenebene ueber dem Bild, Zeigerbehandlung analog zum vorhandenen
  Crop-Ziehen, Pinselgroesse per Mausrad, eigener Undo-Stapel fuer Striche.
- Store: `item.mask` als `markRaw`-Canvas **neben** `edits`. Die Maske darf **nicht** in `edits`
  liegen - die History serialisiert `edits` mit `JSON.stringify` (`stores/library.js`). Beim
  Bildwechsel und Entfernen freigeben.
- Tests in `tests/renderer-checks.js`: Erode/Dilate um n und -n ergibt wieder die Ausgangsmaske;
  Umschliessungsrechteck stimmt; leere Maske erzeugt keinen Auftrag.

### P2 - Pipeline und Mock-Anbieter (immer noch kein Modell)

- `src/lib/inpaint/prepare.js` - der eigentliche Wertbeitrag:
  1. Maske binaerisieren, Erode/Dilate anwenden
  2. Umschliessendes Rechteck, auf Respective Field aufweiten, auf Vielfache von 8 runden, am Bildrand
     abschneiden
  3. Ausschnitt herausloesen, auf lange Kante 1024 skalieren (SDXL ist aufloesungsempfindlich)
  4. Loch aus der Umgebung mehrstufig weichgezeichnet fuellen statt grau lassen
  5. weiche Maske aus Dilatation und Weichzeichnung erzeugen
  6. nach dem Lauf: Farbangleich gegen den unmaskierten Ring, zurueckskalieren, ueber die weiche
     Maske in das Original in voller Aufloesung einsetzen
- `src/lib/inpaint/provider.js` - Schnittstelle: `probe()`, `models()`,
  `generate(request, { onProgress, signal })`.
- `src/lib/inpaint/mockProvider.js` - gibt das gefuellte Bild zurueck. Damit ist die gesamte Kette
  inklusive Einsetzen testbar, ohne eine einzige Modelldatei.
- Auftragsverwaltung mit Fortschritt und Abbruch ueber `AbortController`, wie Export und Render sie
  heute schon nutzen.
- `src/components/panels/PhotoGeneratePanel.vue` und ein vierter Eintrag in der Werkzeugleiste von
  `ImageMode.vue`. Sichtbar nur, wenn ein Anbieter verfuegbar ist.
- **Regressionstest mit Aussagekraft:** Nach `prepare()` und Einsetzen muss jeder Pixel ausserhalb
  der weichen Maske bitgleich zur Quelle sein.

### P3 - Erster echter Lauf gegen einen fremden Server

- `httpProvider.js`, ausgefuehrt im Main-Prozess. Adresse in den Einstellungen, Vorgabe
  `127.0.0.1`. Der Nutzer startet `sd-server` (oder einen kompatiblen Server) selbst.
- Neue IPC-Kanaele nach dem Muster von `electron/main.cjs:109`: `ai:probe`, `ai:generate`,
  `ai:cancel`, dazu ein Fortschritts-Event. Bruecke in `src/lib/desktop.js` mit `isDesktop`-Wache -
  im Browser-Build bleibt die Funktion damit automatisch aus.
- Kein Bundling, keine Lizenzfrage, keine Aenderung an der Paketierung. Ab hier entstehen echte
  Bilder und die Qualitaet von `prepare.js` laesst sich beurteilen.

### P4 - Mitgelieferter Sidecar

- `electron/sidecar.cjs`: bei Bedarf starten, freien Port waehlen, Health-Check, Zeitlimit,
  genau eine Instanz, Abbau bei `will-quit`.
- `electron/models.cjs`: Download mit Fortschritt, SHA-256-Pruefung, Fortsetzen nach Abbruch,
  Ablage in `userData/models`, Loeschen, Lizenztext vor dem Download anzeigen und bestaetigen lassen.
- Backend-Erkennung: Vulkan als Standard, CUDA wenn vorhanden und vom Nutzer gewaehlt.
- `electron-builder.config.cjs`: Binaerdatei als `extraResources` (nicht in die asar).
- `scripts/verify-package.mjs` um Sidecar-Datei und deren MIT-Lizenztext erweitern.
- `scripts/third-party-notices.mjs` sammelt heute nur npm-Abhaengigkeiten - sd.cpp und ggml muessen
  ergaenzt werden.

### P5 - Qualitaet und Pflichten

- C2PA-/Content-Credentials-Metadaten in jedes erzeugte Bild, auch ueber Export und Zwischenablage.
- Outpainting ueber Leinwanderweiterung: neue Flaeche wird zur Maske, sonst dieselbe Kette.
- Seed, Wiederholbarkeit, Prompt-Vorlagen, zweiter Durchlauf mit niedriger Denoise-Staerke fuer
  Detailschaerfe.
- Modellverwaltung in der Oberflaeche: installiert, Groesse, loeschen, Speicherort.

### P6 - Verkaufsfertig

- `package.json` hat heute weder `license` noch `author` - beides festlegen (haengt mit dem offenen
  Punkt in `docs/RELEASE.md` zusammen).
- Freischaltung der KI-Funktionen im selben Build statt zweier Installer: ein Signierungsvorgang,
  ein Updatekanal.
- README und `docs/RELEASE.md` nachziehen, Windows-Signierung mit zusaetzlicher `.exe` pruefen.

## 3. Reihenfolge und Groessenordnung

P0 ist ein halber Tag und entscheidet alles. P1 und P2 sind gewoehnliche Anwendungsarbeit im
bekannten Stack und liefern eine vollstaendig testbare Oberflaeche ohne jede Modelldatei - das ist
der Grund, sie vor die Anbindung zu ziehen. P3 ist klein und bringt den ersten echten Nutzen. P4 ist
der groesste Brocken und der, der spaeter die Supportanfragen erzeugt. P5 und P6 sind Pflicht vor
Verkauf, nicht vor der ersten Erprobung.

Konkrete Tagesschaetzungen gebe ich bewusst nicht ab, solange P0 nicht gelaufen ist.

## 4. Rechtlicher Rahmen (Zusammenfassung, ersetzt keine Rechtsberatung)

- **Eigener Code und heutige Abhaengigkeiten** (Vue, Pinia, JSZip, Electron) sind permissiv lizenziert
  und verkaufbar. `scripts/third-party-notices.mjs` erfuellt die Weitergabepflicht bereits und bricht
  ab, wenn ein Lizenztext fehlt.
- **Kein GPL-Code im Installer.** Fooocus, Fooocus-API und ComfyUI sind GPL-3.0. Als vom Nutzer selbst
  installierter, separater Serverprozess hinter einer generischen HTTP-Schnittstelle unproblematisch -
  Bedingung: Imejii funktioniert ohne ihn und ist nicht nur fuer ihn gebaut. Genau das leistet P3.
- **SDXL Base steht unter CreativeML Open RAIL++-M**: kommerzielle Nutzung erlaubt, die
  Nutzungsbeschraenkungen muessen bei Weitergabe des Modells mitgegeben werden. Weiterer Grund, nicht
  zu buendeln.
- **Community-Checkpoints haben eigene Bedingungen**, viele verbieten monetarisierte Dienste. Kein
  Checkpoint wird ungeprueft Vorgabe.
- **EU AI Act Art. 50** gilt seit 2. August 2026, Bussgeldrahmen bis 15 Mio EUR oder 3 % Weltumsatz.
  Deshalb steht C2PA in P5 und nicht in einer spaeteren Ausbaustufe.

## 5. Was wir von Fooocus uebernehmen - und was nicht

Fooocus ist die Referenzimplementierung, an der wir uns orientiert haben, nicht der Unterbau.
Uebernommen wird die Idee der Vor- und Nachbearbeitung (`modules/inpaint_worker.py`: Respective
Field, Loch fuellen statt grau, weiche Maske ueber morphologisches Oeffnen, Farbangleich,
Einsetzen) - eigenstaendig umgesetzt, kein GPL-Code. Nicht uebernommen wird
`inpaint_v26.fooocus.patch`: er laeuft nur im gepatchten UNet-Pfad von Fooocus und ist in kein
anderes Format exportierbar. Das ist der ehrliche Qualitaetsabstand, den P0 beziffern muss.
