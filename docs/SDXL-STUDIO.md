# AI Studio · SDXL v0.3

Stand: 5. September 2026. Text-to-Image, Inpainting und Outpainting besitzen getrennte lokale Workflow-Verträge; **reale SDXL-Modellabnahme und die verwaltete ComfyUI-Runtime sind noch offen**.

## Verwenden

1. Ein Foto in **Images** öffnen, links **Plugins** wählen und **AI Studio · SDXL** aktivieren.
2. **Open AI Studio** bzw. den neuen Hauptmodus **AI Studio** wählen (`Ctrl+4`).
3. Links **Text**, **Inpaint** oder **Outpaint** wählen. Jeder Modus besitzt einen eigenen festen Workflow. Die Freigabe gilt immer für die konkrete Kombination aus Checkpoint und Modus.
4. Für Text-to-Image ein SDXL-Seitenverhältnis wählen und das vollständige Bild beschreiben. Es wird kein Quellbild an das Backend übertragen.
5. Für Inpainting ein Bild öffnen, eine Auswahl malen (`B`), radieren (`E`) oder eine deckende Graustufen-PNG importieren. Weiß wird neu gemalt, Schwarz bleibt erhalten.
6. Für Outpainting ein Bild öffnen und die Erweiterung links, rechts, oben und unten sowie den Überlappungsbereich festlegen. Imejii erstellt daraus eine größere Arbeitsfläche und eine weiche Randmaske; der geschützte Innenbereich bleibt bei der Rückprojektion unverändert.
7. Eigene lokale ComfyUI-Installation starten. In AI Studio den Port unter **Connect local ComfyUI** einstellen und **Connect & check** wählen. Nur `127.0.0.1` ist erlaubt. Danach einen der von ComfyUI gemeldeten SDXL-Checkpoints auswählen. Die spätere verwaltete Hintergrund-Runtime ersetzt diesen manuellen Einrichtungsschritt.
8. Der erste Lauf jeder Checkpoint-/Workflow-Kombination ist als lokaler Test gekennzeichnet. Eine erfolgreiche Rückgabe prüft den technischen Ablauf, keine allgemeine Bildqualität oder Hardwarefreigabe.
9. Ergebnis prüfen und **Keep & open in Images** wählen. Quellbilder werden nicht überschrieben.

Der Adapter liest bis zu 256 relative `.safetensors`-Checkpointnamen aus dem ComfyUI-Standard-Node `CheckpointLoaderSimple`. `sd_xl_base_1.0.safetensors` bleibt die Vorauswahl, sofern vorhanden; andernfalls wird der erste sichere Eintrag gewählt. Unterordner wie `community\mein-modell.safetensors` werden unterstützt. Absolute Pfade, Traversal, Modell-URLs, `.ckpt`-Dateien und frei vom Renderer übermittelte Namen werden abgewiesen. Neue Dateien unter `ComfyUI/models/checkpoints` erscheinen nach erneutem Verbinden.

Die Liste beweist nicht, dass ein Checkpoint wirklich zur SDXL-Architektur passt. Das zeigt erst ein erfolgreicher lokaler Test der gewählten Kombination; Qualität, Lizenz und Modellherkunft bleiben Eigenschaften des konkreten Community-Modells. Inpainting und Outpainting verwenden maskierte Latents, keinen besonderen Inpainting-Checkpoint. Text-to-Image verwendet ein leeres SDXL-Latent. Imejii lädt weder Modelle noch Runtime automatisch herunter.

## Quellen und Backend-Entscheidung

Für den ersten Implementierungsschnitt wurde ComfyUI als **vorläufiger Adapter** gewählt: Seine dokumentierten Server-Routen und Standard-Nodes erlauben einen kleinen Broker ohne Prozessinstallation, Shell oder Custom-Node-Import. Die API beschreibt u. a. Upload, Prompt-Queue, History und Bildabruf. [ComfyUI-Routen](https://docs.comfy.org/development/comfyui-server/comms_routes), [Server-Implementierung](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py).

Die alternative Runtime stable-diffusion.cpp dokumentiert SDXL sowie Text-/Bild-Eingaben und native Windows-Backends. Ihre CLI-/C-API würde eine gesonderte Runtime-, Binary- und Prozessprüfung verlangen; für diesen Schnitt wurde sie deshalb nicht integriert. Das ist eine Entscheidung über den Integrationsaufwand, kein Qualitäts- oder Geschwindigkeitsvergleich. [Projekt](https://github.com/leejet/stable-diffusion.cpp), [SD-Beispiele](https://github.com/leejet/stable-diffusion.cpp/blob/master/docs/sd.md).

Die Modellkarte nennt für SDXL Base 1.0 die CreativeML Open RAIL++-M-Lizenz; ComfyUI veröffentlicht seinen Code unter GPL-3.0. Runtime und Modell werden nicht mitgeliefert. Vor einer automatisierten Installation/Distribution sind konkrete Artefakte, Prüfsummen und Lizenzpflichten separat zu prüfen. Es wird keine Freigabe durch einen Dateinamen behauptet. [Modellkarte](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0), [ComfyUI-Lizenz](https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE).

Die externe Quellenprüfung erfolgte am 5. September 2026. Sie ersetzt keinen Lauf einer konkreten installierten ComfyUI-Version. Die Versionsnummer aus `system_stats` wird je Verbindung erfasst. Ein realer Backend-/Checkpoint-Hash sowie RAM-/VRAM-/Laufzeitmessungen sind derzeit **nicht vorhanden**. `modelSha256: null` bedeutet ausdrücklich „nicht vom Broker verifiziert“.

## Feste Workflows und Maskenvertrag

Implementiert in `electron/sdxl.cjs`:

- `imejii-sdxl-base-text-to-image-v1`: `CheckpointLoaderSimple → CLIPTextEncode → EmptyLatentImage → KSampler → VAEDecode → SaveImage`.
- `imejii-sdxl-base-masked-latent-v1`: Bild und rote Graustufenmaske → `VAEEncodeForInpaint(grow_mask_by=6)` → `KSampler → VAEDecode → SaveImage`.
- `imejii-sdxl-base-outpaint-v1`: derselbe kontrollierte ComfyUI-Graph wie der Maskenlauf, aber mit eigener Imejii-Vorbereitung, größerer Kompositionsfläche, Randmaske, Platzierung und eigener Workflow-Herkunft.

Text-to-Image erlaubt ausschließlich die neun im Plugin festgelegten SDXL-Seitenverhältnisse von 1024 × 1024 bis 1536 × 640 beziehungsweise Hochformat. Der Renderer kann nur einen exakten Eintrag aus der zuvor vom Broker gefilterten ComfyUI-Liste wählen; Workflow und Node-Graph bleiben fest im Main-Prozess.

Der Standard-Node `LoadImageMask` liest bei `red` die Graustufe direkt. Sein Alpha-Pfad hätte eine andere Konvention. `VAEEncodeForInpaint` erweitert die Inferenzmaske im Modellraum; die Kompositionsmaske wird dadurch nicht erweitert. [Standard-Nodes](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py).

- Quellen und Outpainting-Ergebnisse: höchstens 24 MP / 16.384 px, Maskenarbeit höchstens 2048 px lange Kante. Je Bildseite können höchstens 2048 px ergänzt werden; der Überlappungsbereich ist auf 256 px begrenzt.
- Kontext: Auswahl-Bounds im Maskenraum, Projektion in den Quellraum, Kontextkanten mindestens 128 px bzw. 1,8-fache Auswahlgröße; auf das Quellrechteck begrenzt.
- Inferenz: 1024 × 1024, proportional eingepasster Kontext, zentriertes Padding mit wiederholten Bildrandpixeln. Padding ist schwarz in der Inferenzmaske. Transparente Quellpixel werden nur für die Inferenz vor Weiß gesetzt.
- Rückprojektion: Padding entfernen, Modellbild auf den ursprünglichen Kontext skalieren, RGB mit der unveränderten weichen Kompositionsmaske mischen. Alle Quellalpha-Werte bleiben erhalten; bei Maskenalpha null bleiben sämtliche Quellbytes unverändert.
- Motiv-/Hintergrundauswahl hat dieselbe Polarität wie der bestehende Export. Es gibt keine 65-%-Beschränkung aus LaMa.
- Subject Studio übergibt den gerenderten Foto-Arbeitsstand **vor** seinen Kompositionsstilen. Aktuelle Foto-Edits und Logo-Arbeitsauflösung sind in der Herkunft sichtbar.
- ZIP-Import ist nicht implementiert. Stattdessen gibt es direkte Host-Übergabe und PNG-Maskenimport. Untrusted ZIPs werden hier weder extrahiert noch ausgewertet.

## Sicherheit und Job-Lebensdauer

- Renderer-CSP und Electron-Sandbox bleiben unverändert. Vier eng begrenzte Aktionen: Verbindung prüfen, einen der drei festen SDXL-Aufträge starten, eigene Ergebnisannahme abbrechen und Verbindung lösen.
- Nur numerische Ports 1024–65535, feste IPv4-Loopback-Adresse, keine Redirects, kein HTTP-Proxy. Feste interne Endpunkte, Antwortlimits und 15-Sekunden-Request-Timeout; Job-Wartezeit maximal 30 Minuten.
- Verbindung prüft ComfyUI-Selbstauskunft, Standard-Node-Module und erforderliche Eingaben. Das ist keine kryptografische Authentifizierung: Nutzer müssen ihrer lokalen Installation einschließlich dort installiertem Code vertrauen.
- Community-Checkpoints werden auf relative `.safetensors`-Namen begrenzt und vor jedem Auftrag erneut gegen die Modellliste der aktuellen Verbindung geprüft. Jede Verbindung startet ohne freigegebene Modell-/Workflow-Kombinationen.
- Uploads erhalten zufällige eigene Dateinamen; Antworten müssen diese Namen und den erwarteten Ordner bestätigen. History und Ergebnis müssen zum eigenen Backend-Job und gesendeten Graph passen. Keine beliebigen Backend-Pfade.
- Kein globaler Interrupt und kein Leeren der Warteschlange. Nach Cancel bleiben späte Bilder unberücksichtigt. Der Ressourcenbesitz bleibt bis zur Rückmeldung des eigenen Backend-Jobs bestehen. Bei Verbindungsverlust/Timeout kann externe Arbeit weiterlaufen; ComfyUI vor einer weiteren schweren Verarbeitung prüfen.
- ComfyUI verwaltet seine eigenen Upload-/Ergebnisdateien. Imejii löscht dort keine Dateien und beendet keinen extern gestarteten Prozess.
- Große interne KI-Jobs sind über einen gemeinsamen Renderer-Lease und zusätzliche Main-Prüfungen serialisiert. Es gibt keine Zusage über fremde Jobs auf derselben ComfyUI-Instanz.

## Dauerhafte Daten

IndexedDB `imejii-workbench` Version 2 ergänzt `artifacts`. Die bestehenden `sources` und `drafts` bleiben erhalten. Studio-Einträge verwenden `kind: studio`; reine Bildartefakte werden per SHA-256 adressiert. Quellen, Basismasken, unveränderliche Jobmasken und Ergebnisbilder liegen als PNG-Blobs vor. Striche/Redo, Prompts, Parameter, Herkunft, Jobstatus und Übernahmestatus liegen im versionierten Rezept.

Ein Job bindet Operation, Dokument-ID, Revision, Parameter-Snapshot mit exaktem Checkpointnamen und, soweit vorhanden, Quell-/Maskenhash. Ein Ergebnis speichert außerdem Ausgabemaße, Provider-Version, Modellname, Workflow-ID, Hash des konkret gesendeten Graphs, Backend-Job-ID, Crop/Padding und Zeitstempel. Outpainting speichert zusätzlich Erweiterung, Überlappung und Quellplatzierung. Der Graph-Hash enthält Eingaben und ist kein Hash einer installierten Runtime. Beim Neustart werden nicht abgeschlossene Jobs als unterbrochen markiert; es wird keine Inferenz fortgesetzt.

Grenzen: gemeinsam 100 Saved-work-Einträge / 2 GiB Quelldaten plus Artefakte, je Studio-Sitzung 384 MiB, je Blob 128 MiB, 8 Ergebnisvarianten, 20 Jobs und 2 MiB Rezept. Maskenstriche: 120 / insgesamt 24.000 Punkte. Unreferenzierte Artefakte werden bei Aktualisierung/Löschung entfernt, gemeinsam referenzierte bleiben erhalten. Speicherfehler lassen die letzte erfolgreiche Speicherung intakt und den aktuellen Stand mit Fehlermeldung offen.

Portable Studio-Projekte verwenden `IMEJII02`: begrenzter JSON-Header mit Hash-/Größentabelle, danach unverpackte Binärartefakte. Kein Base64, kein Archiv-Entpacken. `IMEJII01` für Foto/Logo bleibt les- und schreibbar. Alte App-Versionen können `IMEJII02` nicht öffnen. Projektimport erzeugt neue Sitzungs-/Varianten-IDs; Herkunft bleibt erhalten.

Beim Moduswechsel bleibt die Sitzung mitsamt Jobs im Store. Neue Quellen werden erst nach dauerhafter Speicherung eingesetzt; vorherige Sitzungen bleiben unter Saved work. Deaktivierung während aktiver Arbeit ist gesperrt. Bei fehlendem Plugin öffnet Saved work das letzte fertige Ergebnis als Foto; eine Sitzung ohne Ergebnis fordert zum Aktivieren auf. PNG-Exporte tragen je nach Operation `Imejii / AI text-to-image`, `Imejii / AI inpainting` oder `Imejii / AI outpainting`; die komplette Rezept-/Maskenhistorie bleibt im Studio-Projekt und wird nicht vollständig in die PNG eingebettet.

## Testen und offene Abnahme

```powershell
npm test
npm run test:sdxl
npm run test:studio
```

`tests/sdxl.test.cjs` prüft die drei festen Broker-Graphen, die gefilterte Community-Modellliste und die Freigabe je Modell-/Workflow-Paar mit einem lokalen Protokollserver. `tests/sdxl-checks.js` prüft echte Canvas-/IndexedDB-Verarbeitung einschließlich quellfreier Textgenerierung und Outpainting-Rückprojektion. `tests/sdxl-desktop.cjs` führt die Produktions-App mit einem ausdrücklich als `TEST-FIXTURE-NO-MODEL` gekennzeichneten Testserver aus. **Dessen Bilder sind keine generierten SDXL-Ergebnisse.** Der Testserver gehört nur zu `tests/` und wird nicht paketiert.

Noch nötig: verwaltete und gepinnte ComfyUI-Runtime, konkrete geprüfte Gewichte, Testfälle für Text-to-Image, Person/Produkt/Haare/Glas, alle Randrichtungen und verschiedene Seitenverhältnisse, echte Inpainting-/Outpainting-Bildqualität, Versionen/Hashes, OOM/Backend-Neustart und Hardwareverbrauch. Danach gepackte Windows-App mit realem Modell und separat eine saubere Windows-Installation abnehmen. Keine allgemeine SDXL-Freigabe aus den Fixture-Tests ableiten.
