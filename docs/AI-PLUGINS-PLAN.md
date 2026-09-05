# Imejii: KI-Plugins und eigener AI-Studio-Modus

Stand: 2026-09-04

Status: ursprünglicher Umsetzungsplan; der aktuelle Implementierungsstand steht in den jeweiligen Plugin-Dokumenten.

Herausgeber: Frederik Morbe

## 1. Zielbild und verbindliche Produktentscheidung

Imejii bleibt eine lokal arbeitende Foto-App mit optionalen Erweiterungen. KI-Funktionen
einschließlich ihrer Oberfläche werden als Imejii-Plugins organisiert. Die normale App muss
ohne Plugins, Modelldownloads, KI-Backend oder Internet vollständig nutzbar bleiben.

**SDXL erhält einen eigenen Hauptmodus, gleichberechtigt mit Images und Logo.** Es wird nicht
nur ein weiteres Seitenpanel im Foto-Editor. Der vorgeschlagene Anzeigename lautet **AI Studio**;
die interne Modus-ID ist unabhängig vom verwendeten Modell. Zu Beginn wird ausschließlich
die Modellfamilie SDXL integriert.

Die Erweiterungsschnittstelle unterstützt zwei Arten von UI-Beiträgen:

- Werkzeuge und Panels innerhalb vorhandener Arbeitsbereiche.
- Vollständige Arbeitsbereiche mit eigenem Canvas, Zustand und Werkzeugen.

### Verhältnis zum bestehenden SDXL-Entwurf

[SDXL-INPAINTING.md](SDXL-INPAINTING.md) bleibt als vorhandener technischer Entwurf unverändert.
Dieser Gesamtplan legt das neue Produktziel fest: eigener AI-Studio-Modus, Plugin-Struktur und
perspektivisch Text-to-Image, Image-to-Image sowie Inpainting. Die dort vorgeschlagene Beschränkung
auf ein Inpainting-Seitenpanel wird damit nicht übernommen.

Die Backend-Wahl ist noch offen: Der vorhandene Entwurf schlägt stable-diffusion.cpp vor;
in der Produktdiskussion wurde ein lokaler ComfyUI-Adapter vorgeschlagen. Beide Ansätze dürfen
nicht versehentlich gleichzeitig zur Pflichtabhängigkeit werden. Phase 0 entscheidet anhand
eines kleinen Prototyps. Hardware-, Lizenz-, Rechts- und Qualitätsaussagen aus früheren Entwürfen
sind vor Verwendung separat zu verifizieren; sie sind keine bereits erfüllten Release-Gates.

## 2. Plugin-Aufteilung

| Plugin | Funktion | UI-Beitrag | Verarbeitung |
| --- | --- | --- | --- |
| AI Cutout | Motivmaske, Freistellung, Kantenverfeinerung | Werkzeuge in Images und Logo | Lokales Segmentierungs-/Matting-Modell |
| AI Enhance | Später: Entrauschen und Hochskalieren | Werkzeuge in Images | Je Aufgabe geeignetes lokales Modell |
| SDXL Studio | Generierung, Bildvariationen, Inpainting | Vollständiger Modus AI Studio | Separates lokales SDXL-Backend |

Eine Motivmaske wird als gemeinsames Bildartefakt behandelt. Hintergrundfarbe, Hintergrundunschärfe,
Color-Splash und getrennte Motivkorrekturen können dieselbe Maske verwenden; dafür wird nicht
jeweils ein neues KI-Modell geladen. SDXL kann diese Maske nach bewusster Übergabe für Inpainting
oder Hintergrundgenerierung verwenden.

### Erste Version und spätere Erweiterungen

Erste Ausbaustufe: Plugin-Grundlage, AI Cutout und anschließend SDXL Studio. AI Enhance folgt
erst nach Auswahl und Abnahme geeigneter Modelle.

Nicht Bestandteil der ersten Version:

- Offener Marktplatz für beliebigen Drittanbieter-Code.
- Cloud-Verarbeitung, Benutzerkonten, Abrechnung oder automatische Bild-Uploads.
- Modelltraining, Face-Swap, beliebige ComfyUI-Custom-Nodes oder frei ausführbare Workflows.
- Verpflichtende LoRA-, ControlNet- oder Refiner-Verwaltung.
- Gleichzeitige Ausführung mehrerer großer GPU-Aufträge.

## 3. Ausgangslage im Repository

Die vorhandene Oberfläche basiert auf Vue und Pinia. Modi und Werkzeuge werden derzeit fest
registriert: unter anderem in `src/App.vue`, `src/components/AppHeader.vue`,
`src/components/ImageMode.vue`, `src/components/LogoMode.vue` und `src/stores/ui.js`.

Wiederverwendbare Grundlagen:

- Bildbibliothek, Originalquellen, Vorschauen, Export und Undo/Redo.
- Farbfreistellung und Alpha-Nachbearbeitung in `src/lib/chromaKey.js`.
- Bildverarbeitung über `src/lib/photoProcessing.js` und `src/lib/photoWorker.js`.
- Abbruch- und Fehlerbehandlung sowie begrenzte Bild-/Dateizugriffe.
- Electron-Sandbox, validierte IPC-Aufrufe und restriktive Netzwerkregeln.

Erforderliche Ergänzungen:

- Plugin-/Modus-Registry statt weiterer fest eingebauter Sonderfälle.
- Einheitliche Dokument-, Masken- und Ergebnisreferenzen für alle Arbeitsbereiche.
- Dauerhafte Speicherung von KI-Ergebnissen, Masken und Bearbeitungszuständen.
- Wiederverwendbare Modell-Sessions; der bestehende kurzlebige Render-Worker ist nicht
  direkt als langlebiger KI-Worker geeignet.
- Plugin-, Modell-, Backend- und Auftragsverwaltung.

## 4. Architektur und Verantwortlichkeiten

### 4.1 Imejii-Kern

Der Kern bleibt Besitzer der Dokumente und stellt eng definierte Dienste bereit:

- Dokumente lesen und neue Ergebnisvarianten anlegen.
- Masken laden, speichern und zu Dokumentrevisionen zuordnen.
- Änderungen über gemeinsame Commands und Undo/Redo übernehmen.
- Exporte, Dateidialoge und freigegebene Bildzugriffe vermitteln.
- Aufträge planen, Fortschritt anzeigen und Ressourcen begrenzen.
- Plugin-UI-Beiträge registrieren und ihre Lebensdauer verwalten.

Plugins dürfen Pinia-Stores nicht beliebig direkt verändern. Sie erhalten eine versionierte
Host-Schnittstelle. Ein Pluginfehler darf weder Originale überschreiben noch den Viewer unbenutzbar machen.

### 4.2 Drei getrennte Bestandteile

1. **Plugin:** Manifest, UI-Beiträge, Fachlogik und Adapter.
2. **Laufzeit:** Beispielsweise ONNX im Worker oder ein separat laufender SDXL-Prozess.
3. **Modelle:** Große, gesondert versionierte Dateien mit eigenen Nutzungsbedingungen.

Diese Trennung erlaubt einen kleinen Basiseinstieg, bewusste Modelldownloads und die gemeinsame
Nutzung einer Laufzeit. Deinstallation eines Plugins darf geteilte Modelle nicht unbemerkt entfernen.

### 4.3 Vorgeschlagene Manifest-Inhalte

- Stabile Plugin-ID, Version, Herausgeber und kompatible Host-API-Version.
- UI-Beiträge: Arbeitsbereiche, Werkzeuge, Commands und Einstellungsseiten.
- Benötigte Fähigkeiten, etwa Zugriff auf das aktive Bild oder einen lokalen KI-Dienst.
- Laufzeit- und Modellanforderungen mit Versionsbindung, Größe, Prüfsumme und Lizenzreferenz.
- Kennzeichnung von lokalem Betrieb und eventuell später explizit freizugebenden Netzwerkdiensten.

Ein Manifest ist keine Sicherheitsgrenze. Der Host muss die Angaben validieren und Berechtigungen
tatsächlich durchsetzen. Es darf keine frei ausführbaren Installationsskripte enthalten.

### 4.4 UI- und Paketstrategie

Zunächst nur eigene, geprüfte Plugins. Die erste Registry kann ihre Komponenten aus explizit
bekannten, beim Build erzeugten Bundles laden. Das ist ein Entwicklungsschritt und noch kein
unabhängig installierbares Plugin-System.

Vor Freigabe nachladbarer Plugins braucht es einen eigenen Paketpfad mit Herkunftsprüfung,
signiertem Manifest, festem Vertrauensanker, Integritätsprüfung, Kompatibilitätsprüfung,
staging-basierter Installation und Rückfall auf die letzte funktionierende Version.

Erweiterungen im selben Vue-Renderer sind vertrauenswürdiger Anwendungscode und haben keine
echte Isolation voneinander. Für spätere fremde Plugins sind vom Host gerenderte deklarative
Bedienfelder oder eine separat isolierte UI erforderlich. Direktes Nachladen beliebigen
JavaScripts in den Haupt-Renderer ist nicht vorgesehen. Die bestehenden Electron-Fuses und
die Sandbox werden nicht pauschal abgeschaltet, um Erweiterungen laden zu können.

## 5. Gemeinsames Dokument-, Masken- und Auftragsmodell

### Dokumente und Masken

- Unveränderte Originalquelle, eindeutige Dokument-ID und Revisionsnummer.
- Ergebnisse als neue Varianten mit Herkunftsverweis statt destruktivem Ersatz.
- Maske als binäres Bildartefakt mit eigener ID, nicht als Canvas in JSON-Einstellungen.
- Maskenreferenzen enthalten Abmessungen, Koordinatenraum, Zweck und Quellrevision.
- Nach außen gilt eindeutig: Bei Motivmasken bedeutet 1 Vordergrund; bei Inpainting bedeutet
  1 zu bearbeitender Bereich. Adapter konvertieren ausdrücklich zwischen beiden Bedeutungen.
- Drehung, EXIF-Ausrichtung, Beschnitt, Modellskalierung und Rückprojektion sind explizite
  Transformationen. Keine stillschweigende Annahme identischer Bildgrößen.
- Bestehende Transparenz bleibt erhalten; eine Freistellungsmaske wird mit der Quell-Alpha kombiniert.
- Pinselkorrekturen sind rückgängig zu machen. Große Masken werden über Artefaktreferenzen oder
  begrenzte Deltas verwaltet, nicht als vollständige Pixeldaten in jedem History-Eintrag.

### Speicherung

Projekt-/Sitzungsdaten und zugehörige Artefakte atomar in einem app-eigenen Speicher ablegen.
Automatisch sichern und nach Neustart wiederherstellen; Dateiverweise bei Bedarf neu zuordnen lassen.
Persistierte Daten dürfen keine später ungültigen temporären Datei-Handles voraussetzen.

Fehlt ein Plugin, bleiben seine gespeicherten Ergebnisse sichtbar. Nicht verfügbare Operationen
werden verständlich markiert. Unbekannte Plugin-Metadaten bleiben erhalten, statt beim Speichern
verworfen zu werden. Plugin-Deinstallation löscht keine Projekte oder Ergebnisse.

### Aufträge

Jeder Auftrag besitzt Plugin-ID, Dokument-ID, Quellrevision, Parameter-Snapshot und eindeutige Job-ID.
Zustände: wartend, vorbereitend, laufend, erfolgreich, fehlgeschlagen oder abgebrochen.

- Fortschritt, Fehler und Ergebnisse werden nur dem passenden Auftrag zugeordnet.
- Nach Bildwechsel dürfen verspätete Ergebnisse nicht das inzwischen aktive Bild überschreiben.
- Ergebnisse erscheinen zunächst als Vorschau/Variante und werden bewusst übernommen.
- Gemeinsame Ressourcenplanung: große KI-Aufträge zunächst seriell; CPU-/GPU-Speicher freigeben.
- Timeout, Abbruch, Backend-Absturz und Plugin-Deaktivierung erhalten definierte Aufräumpfade.
- Absturz-Wiederherstellung heißt nicht, dass eine unterbrochene Inferenz fortgesetzt werden kann.

## 6. AI Cutout

### Modell und Laufzeit

BiRefNet Lite ist ein Testkandidat, keine bereits getroffene Modellauswahl. Die offizielle
[Modellseite](https://huggingface.co/ZhengPeng7/BiRefNet_lite) nennt MIT als Lizenz. Vor Aufnahme
in den Katalog werden die tatsächlich verwendeten Gewichte, Konvertierungen und Abhängigkeiten geprüft.

ONNX Runtime Web ist der erste Laufzeitkandidat. Die Bibliothek bietet GPU-Verarbeitung über
WebGPU sowie CPU-Verarbeitung über WebAssembly. Das ist keine Garantie, dass jede ONNX-Datei
auf beiden Wegen unterstützt wird. [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)

- Langlebiger dedizierter Worker mit lazy geladener Modell-Session.
- GPU-/Operator-Verfügbarkeit prüfen; CPU-Rückfall nur mit getesteter Modellkombination.
- Lokale Runtime-Dateien und kontrollierte Modelldateien; keine impliziten CDN-Zugriffe.
- WASM-/Worker-/CSP-Anforderungen im gepackten Electron-Build prüfen. Nur konkret benötigte
  Freigaben ergänzen; keine pauschale Aktivierung von `unsafe-eval` oder fremden Skriptquellen.
- Tatsächliche Downloadgröße, Ladezeit, Laufzeit und RAM-/VRAM-Spitzen messen.

### Verarbeitung und Oberfläche

1. Originalreferenz und Revisionsstand sichern.
2. Modellkonforme Bildkopie vorbereiten; Normalisierung und Geometrie dokumentieren.
3. Motivmaske berechnen und korrekt in den Dokumentraum zurückführen.
4. Kanten im Kontext des Originalbildes verfeinern; vorhandene Alpha-Werkzeuge gezielt wiederverwenden.
5. Maske als separates Artefakt speichern und nichtdestruktiv anwenden.

UI: Automatik, Maskenanzeige, Behalten-/Entfernen-Pinsel, Pinselgröße, Kantenverfeinerung,
Vorher/Nachher und Übernehmen/Verwerfen. Unsere vorhandene Farbfreistellung bleibt als eigenes
Werkzeug erhalten. Ein alter Farb-Key darf nicht versehentlich zusätzlich auf die KI-Maske wirken.

Eine grobe Segmentierungsmaske ist noch kein hochwertiges Matting. Haare, Fell, Glas und
Bewegungsunschärfe sind eigene Qualitätsfälle. Hochskalieren einer kleinen Maske rekonstruiert
keine verlorenen Details. Für den Logo-Modus bleibt dessen aktuelle 4096-px-Arbeitsgrenze sichtbar;
vollauflösende Foto-Freistellung darf nicht stillschweigend durch diesen Modus geleitet werden.

## 7. SDXL Studio als eigener Modus

### Navigation und Layout

Der Modus erscheint, sobald das Plugin installiert und aktiviert ist. Ein fehlendes Backend
führt zu einer Einrichtungsansicht, nicht zu einem verschwundenen oder leeren Arbeitsbereich.
Ohne aktives Plugin gibt es keinen AI-Studio-Eintrag. Betrachter bleibt der Standardstart.

- Mitte: große Ergebnisvorschau und Canvas mit Maskenüberlagerung.
- Links: Text-to-Image, Image-to-Image und Inpainting.
- Rechts: Prompt, optional negativer Prompt, Modell, Größe und relevante Parameter.
- Erweiterte Einstellungen: Seed, Schritte, Sampler und Stärke, soweit vom Adapter unterstützt.
- Unten: Varianten, Aufträge und Vorschauen.
- Sichtbarer Status für Backend, Modellladen, laufende Verarbeitung und Fehler.

Text-to-Image funktioniert ohne geöffnetes Ausgangsbild. Image-to-Image benötigt ein Bild;
Inpainting zusätzlich eine gültige Maske. Nicht unterstützte Operationen werden nicht als
funktionsfähige Buttons angeboten. Expertenparameter bleiben zunächst eingeklappt.

Der Modus hat einen eigenen Store. Header, Tastenkürzel, Öffnen, Speichern und Undo/Redo werden
über den aktiven Arbeitsbereich aufgelöst. Die bisherige Logik „alles außer Logo ist Bibliothek“
darf nicht für AI Studio weiterverwendet werden.

### Übergabe zwischen Arbeitsbereichen

- Images/Logo bieten „In AI Studio öffnen“ an.
- Nutzer wählen bewusst Original oder aktuellen Bearbeitungsstand; die Übertragung erstellt
  einen Snapshot und verändert die Quelle nicht.
- Eine kompatible Motivmaske kann übernommen und für den Hintergrund invertiert werden.
- Ergebnisse gelangen als neue Bilder/Varianten nach Images oder Logo.
- Wechsel des Modus verwirft weder Masken noch laufende Aufträge.

### Backend-Schnittstelle

Versionierte Provider-API: Fähigkeiten prüfen, Modelle auflisten, Auftrag starten,
Fortschritt abonnieren, Ergebnis abrufen und einen eigenen Auftrag abbrechen.

Erster Integrationskandidat ist eine vom Nutzer gestartete lokale ComfyUI-Installation.
ComfyUI bietet HTTP-/WebSocket-Schnittstellen für Aufträge, Warteschlange und Ergebnisse.
[Offizielle Schnittstellen](https://docs.comfy.org/development/comfyui-server/comms_routes)

Der Adapter verwendet von uns geprüfte, versionierte Workflows und unterstützte Standard-Nodes.
Keine automatische Installation fremder Custom-Nodes und kein beliebiger Workflow-Import.
Ein gewöhnlicher SDXL-Checkpoint wird nicht pauschal als gleichwertiger Ersatz für einen
geeigneten Inpainting-Workflow oder -Checkpoint behandelt.

Eine stable-diffusion.cpp-Anbindung bleibt ein möglicher zweiter Provider, falls der Spike ihre
benötigten Fähigkeiten und Vorteile belegt. Eine automatisch von Imejii installierte und gestartete
Laufzeit ist eine spätere Lieferstufe, nicht Voraussetzung für den ersten funktionierenden Adapter.

### Inpainting und Ergebnisse

- Maskierter Bereich und Kontextausschnitt werden geometrisch nachvollziehbar vorbereitet.
- Padding, Skalierung und Rückprojektion sind testbar; Modellgrenzen werden vor dem Auftrag geprüft.
- Ergebnis über eine definierte weiche Kompositionsmaske in den Ausgangsstand einsetzen.
- Außerhalb dieser Kompositionsmaske bleiben die Pixel des gewählten Ausgangsstands unverändert.
- Prompt, Seed, Modell-/Workflow-Version und Einstellungen zusammen mit dem Ergebnis speichern.
- Gleicher Seed wird nicht als Garantie bitidentischer Ergebnisse über verschiedene Hardware,
  Backends oder Versionen hinweg beworben.
- Interne Kennzeichnung generierter Inhalte vorsehen. Export-Metadaten und gegebenenfalls
  Content Credentials separat spezifizieren und prüfen; rechtliche Pflichten nicht pauschal
  aus dem Vorhandensein einer bestimmten Metadatentechnik ableiten.

## 8. Sicherheit, Installation und Lebenszyklus

### Lokale Backends

Netzwerkzugriffe zum KI-Dienst vermittelt ein eng begrenzter Electron-Host-Adapter. Der Renderer
bekommt keine beliebige HTTP-Proxy-, Dateipfad- oder Shell-Funktion. Seine bestehende Sperre für
Fremdverbindungen bleibt bestehen.

- Anfangs ausschließlich explizit konfigurierte Loopback-Adressen; kein LAN-/Cloud-Ziel.
- Ports, Endpunkte, Protokolle, Weiterleitungen und Antwortgrößen validieren.
- Nur benötigte Bildkopien übertragen, keine kompletten Bibliotheken oder freien Quellpfade.
- Eigene Aufträge eindeutig verfolgen; kein globaler Abbruch fremder Jobs auf einem geteilten Backend.
- Ist gezielter Abbruch nicht möglich, Ergebnisannahme stoppen und auf weiterlaufende Backend-Arbeit
  hinweisen. Nur einen von Imejii selbst gestarteten Prozess darf Imejii gezielt beenden.
- Ein lokaler Port ist keine Authentifizierung. Backend-Identität, Sitzungszuordnung und mögliche
  Authentifizierung prüfen; bei eigener Laufzeit einen abgesicherten Kommunikationskanal vorsehen.
- Fremde Custom-Nodes sind ausführbarer Code im externen Backend und nicht durch unsere
  Renderer-Sandbox isoliert. Diese Vertrauensgrenze muss in der Einrichtung sichtbar sein.

### Modelle und Plugin-Pakete

- Erst nach Nutzeraktion herunterladen; Größe, Speicherbedarf und Lizenz vorher anzeigen.
- Feste Versionen und vertrauenswürdiges Manifest; Prüfsumme vor Aktivierung kontrollieren.
- Download atomar abschließen; abgebrochene oder beschädigte Dateien nicht laden.
- ZIP-Pfade, Junctions/Symlinks, Größen und Dateitypen bei Paketinstallation begrenzen.
- Keine zur Laufzeit aus Modell-Repositories nachgeladenen Python-/JavaScript-Skripte.
- API-Kompatibilität vor Aktivierung prüfen; Update erst nach Beendigung laufender Jobs.
- Deaktivierung gibt Worker, Events und Modelle frei und entfernt registrierte UI-Beiträge.
- Deinstallation unterscheidet Plugin, geteilte Laufzeit, Modelle und Benutzerdaten.
- Modell- und Runtime-Lizenzen gesondert prüfen. Nachladen statt Mitliefern ersetzt diese Prüfung
  nicht; auch ein Plugin hebt Lizenzpflichten nicht auf. Für SDXL ist die konkrete
  [Modellkarte samt Lizenz](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) maßgeblich.

## 9. Vorgeschlagene Code-Aufteilung

Die folgenden Pfade sind geplante Zuständigkeiten, noch keine vorhandene Implementierung:

| Bereich | Geplanter Ort |
| --- | --- |
| Registry, Manifestvalidierung, Host-API | `src/plugins/core/` |
| Gemeinsame Masken und Dokumentartefakte | `src/lib/documents/`, `src/lib/masks/` |
| Plugin-/Auftragsverwaltung | `src/stores/plugins.js`, `src/stores/aiJobs.js` |
| AI-Cutout-Plugin | `src/plugins/ai-cutout/` |
| AI-Enhance-Plugin, später | `src/plugins/ai-enhance/` |
| AI Studio und SDXL-Adapter-UI | `src/plugins/sdxl-studio/` |
| Native Installation, Modelle, Backend-Broker | `electron/plugins/`, `electron/ai/` |
| Contract-, Sicherheits- und Integrationstests | `tests/` |

Host-APIs, Masken und Aufträge gehören nicht in einen SDXL-spezifischen Store, damit Cutout,
Enhance und spätere Plugins dieselben Grundlagen nutzen können.

## 10. Umsetzung in Phasen

### Phase 0 – Modelle und Backends praktisch prüfen

- [ ] Kleine lokale Testsammlung für Personen, Produkte, Tiere, Logos und schwierige Kanten festlegen.
- [ ] Cutout-Kandidaten auf Qualität, Operator-Unterstützung, Laufzeit und Speicherbedarf vergleichen.
- [ ] SDXL-Prototyp für Text-to-Image, Image-to-Image und Inpainting mit den nötigen Masken durchführen.
- [ ] ComfyUI als ersten Adapter und die Alternative aus dem vorhandenen Entwurf bewerten.
- [ ] Verwendete Versionen, Lizenzgrundlage und Testhardware protokollieren.
- [ ] Repräsentatives Windows-Gerät mit integrierter Grafik/CPU und Gerät mit diskreter GPU prüfen.

**Abnahme:** dokumentierte Modell-/Backend-Wahl und ehrliche Funktions-/Hardwaregrenzen.
Keine zugesagten Laufzeiten oder Mindest-VRAM-Werte ohne Messungen der tatsächlich gewählten Kombination.

### Phase 1 – Erweiterungskern und persistente Artefakte

- [ ] Registry für Werkzeug- und Arbeitsbereichsbeiträge implementieren.
- [ ] Header, Moduswechsel und Commands auf explizite Arbeitsbereichsverträge umstellen.
- [ ] Dokument-/Maskenreferenzen, persistente Ergebnisse und Wiederherstellung implementieren.
- [ ] Jobverwaltung und ausschließlich in Tests verwendeten Mock-Provider ergänzen.
- [ ] Aktivieren, Deaktivieren und fehlende/inkompatible Plugins testen.

**Abnahme:** ein Testplugin lässt sich ohne Seiteneffekte registrieren und entfernen;
bestehender Viewer, Images, Logo und Export bestehen ihre Regressionstests unverändert.

### Phase 2 – AI Cutout als erstes vollständiges Plugin

- [ ] Modellverwaltung und langlebigen Worker anbinden.
- [ ] Automatik, Maskenvorschau und Korrekturpinsel umsetzen.
- [ ] Undo/Redo, Originalschutz, Export und Wiederherstellung integrieren.
- [ ] GPU-/CPU-Pfade, Abbruch und Ressourcenfreigabe überprüfen.

**Abnahme:** reproduzierbare lokale Freistellung mit editierbarer Maske; kein Bild-Upload;
PNG-/WebP-Ergebnis und gespeicherte Sitzung nach Neustart korrekt.

### Phase 3 – Eigener AI-Studio-Arbeitsbereich

- [ ] Modus und Einrichtungsansicht unabhängig von Backend-Verfügbarkeit implementieren.
- [ ] Canvas, Promptbereich, Parameter, Varianten und Auftragsanzeige aufbauen.
- [ ] Bild-/Maskenübergabe von und nach Images/Logo ergänzen.
- [ ] Text-to-Image ohne Ausgangsbild sowie Kontextanforderungen der anderen Operationen testen.

**Abnahme:** vollständiger UI-/Datenfluss mit klar gekennzeichnetem Test-Provider; keine
simulierten Ergebnisse werden in einer Produktversion als echte KI-Funktion dargestellt.

### Phase 4 – Echte SDXL-Verarbeitung

- [ ] Gewählten lokalen Provider über geprüfte IPC-Kanäle anbinden.
- [ ] Validierte Workflows und Parametergrenzen implementieren.
- [ ] Inpainting-Rückprojektion, Ergebnisübernahme und Herkunftsdaten ergänzen.
- [ ] Unterbrechung, Backend-Neustart, geteilte Warteschlange und veraltete Jobs testen.

**Abnahme:** alle angebotenen Operationen laufen Ende zu Ende mit echten Modellen;
Originale bleiben unverändert und Fehler beschädigen keine Sitzung.

### Phase 5 – Installierbare Pakete und Release-Abnahme

- [ ] Plugin-Katalog, Paketprüfung, atomare Installation und kompatible Updates implementieren.
- [ ] Modell-/Runtime-Verwaltung inklusive Speicheranzeige und sauberer Entfernung fertigstellen.
- [ ] Windows-Paketierung, signierte Artefakte, Lizenzhinweise und Distribution prüfen.
- [ ] Eigene Backend-Installation nur bei separat bestandener Abnahme anbieten.
- [ ] Vollständigen Offline-, Neustart-, Installations- und Deinstallationstest durchführen.
- [ ] Release-Dokumentation und tatsächliche Datenschutz-/Funktionsaussagen aktualisieren.

**Abnahme:** Plugin-Lebenszyklus auf sauberem Windows funktioniert; eine Installation ohne KI
bleibt funktional. Erst hier gelten nachladbare Pakete als freigegeben.

### Später

AI Enhance, zusätzliche Maskeneffekte, Outpainting, weitere Backends und gegebenenfalls ein
separat abgesichertes Drittanbieter-SDK. Weitere Modellfamilien sind eine spätere Produktentscheidung.

## 11. Übergreifende Tests und Freigabekriterien

- Manifestvalidierung: ungültige Beiträge, doppelte IDs, inkompatible Versionen, fehlende Rechte.
- Paketprüfung: falsche Signatur/Prüfsumme, Pfadtraversal, übergroßes Archiv und unterbrochenes Update.
- Masken: Orientierung, nichtquadratische Bilder, Beschnitt, Transparenz, Skalierung und Pinsel-Undo.
- Morphologie gegen definierte Referenzmasken testen; Erosion und Dilatation sind nicht allgemein invers.
- Inpainting: außerhalb der Kompositionsmaske unveränderte Pixel, korrekte Rückprojektion.
- Jobs: Bildwechsel während Verarbeitung, Doppelstart, Abbruch, Timeout und späte Antworten.
- Backend: nicht erreichbar, falscher Dienst, fehlerhafte Antwort, eigene versus fremde Jobs.
- Persistenz: Neustart, fehlende Quelle, fehlendes Plugin, Migration und voller Datenträger.
- Ressourcen: Modellladen/-entladen, lange Bildserien, GPU-Verlust, CPU-Fallback und RAM-/VRAM-Spitzen.
- Datenschutz: kein impliziter Cloud-Zugriff; Offlinebetrieb nach abgeschlossenem Modelldownload.
- UI: Tastatur, Fokus, Fortschrittsansagen, verständliche Fehler, Hell/Dunkel und mehrere DPI-Stufen.
- Regression: vorhandene Tests für Import, Viewer, Logo, Bearbeitung, Export, IPC und Paketierung.
- Pakettest: echte installierte Windows-App zusätzlich zu Browser-, Entwicklungs- und ASAR-Tests.

## 12. Noch zu entscheidende Punkte

1. Endgültiger Anzeigename des neuen Modus; aktuell vorgeschlagen: AI Studio.
2. Freigegebene Cutout- und SDXL-Modelle samt Version, Lizenz und Qualitätsprofil.
3. Erster SDXL-Provider nach Phase 0; keine Festlegung auf zwei verpflichtende Laufzeiten.
4. Verfügbarkeit je Plattform: Desktop zuerst; Browser-Cutout erst nach eigener Abnahme,
   SDXL zunächst ausschließlich über den Desktop-Adapter.
5. Paket-/Modell-Downloadkanal, Vertrauensanker und Signierung für offizielle Erweiterungen.
6. Zielhardware, Speicherbudgets und gemessene Akzeptanzgrenzen für Ladezeit und Verarbeitung.
7. Lizenz des eigenen Codes sowie konkret erforderliche rechtliche und Herkunftsangaben.

## 13. Nächster konkreter Schritt

Mit Phase 0 beginnen und deren Ergebnisse in einem kurzen Entscheidungsprotokoll festhalten.
Danach Registry, Dokument-/Maskenvertrag und Jobverwaltung aufbauen. **AI Cutout ist das erste
Referenzplugin; AI Studio ist anschließend der erste vollständige Plugin-Arbeitsbereich.**

Dieser Plan installiert keine Modelle oder Laufzeiten und veröffentlicht nichts. Änderungen an
anderen Arbeitsständen sind für seine Erstellung nicht erforderlich. Die bestehenden öffentlichen
Release-Gates bleiben in [RELEASE.md](RELEASE.md) dokumentiert.
