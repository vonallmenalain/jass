# Kartenerkennung (Trumpf-Helfer «📷 Foto»)

Ein Foto der Hand → die 9 Karten. Das Netz läuft im Browser
(`jass-erkennung.js`, onnxruntime-web vom CDN); die Datei ist
`erkennung/karten-2.onnx` (Gewichte als int8, gerechnet wird in float32).

## Wie es erkennt

- **Netz:** MobileNetV3-Large (ImageNet-Gewichte von torchvision) bis Stufe 32,
  ein kleines FPN, Ausgabe auf Stufe 8: eine Heatmap je Karte (36).
- **Wo es anschlägt:** an jeder Ecke einer Karte, die zu mindestens der Hälfte
  sichtbar ist (bei Bildkarten auch an den Seitenstreifen mit der Figur). Ecken
  zu 20–50 % sichtbar zählen weder als richtig noch als falsch.
- **Auswertung:** pro Karte der höchste Wert im Bild; die 9 höchsten sind die
  Hand. Unter `SICHER` (jass-erkennung.js) bekommt eine Karte in der Seite einen
  gelben Rand.
- **6 oder 9:** Die Ziffer steht im Ecksymbol und dreht mit; aufrecht gelesen
  (Herzspitze unten, Pik- und Kreuzstiel unten, Ziffer über dem Kreuz) stimmt sie.
  Das Netz lernt das aus den gedrehten und auf den Kopf gestellten Karten.

## Trainiert nur mit künstlichen Fächern

`gen.py` legt aus den Kartenbildern Fächer wie in der Hand:
- zufälliger Hintergrund mit Formen, Punktrastern (Tastatur) und Kartenrücken;
- Handfläche, 4–9 Karten (meist 9) um einen Drehpunkt, einzelne Karten auf dem
  Kopf, Schatten und ein Daumen;
- leichte Perspektive, Licht, Farbstich, Spiegelung, Unschärfe, Rauschen und JPEG.

```
python bibliothek.py [weitere Kartenbild-Ordner]   # tex/bibliothek.npz
python gen.py daten 15000 1000 & …                 # 4 × parallel, ~60 Bilder/s
python train.py daten 2400 netz.pt                 # CPU, ~1 h (4 Kerne)
# Nachtrainieren mit grösseren Bildern (so entstand karten-2):
python gen.py daten416 6000 200000 416 & …          # Bilder mit kurzer Seite 416
LR_FAKTOR=0.5 AUFWAERMEN=100 PRUEF_GROESSEN=320,416 \
  python train.py daten416 1500 netz2.pt netz.pt   # CPU, ~1½ h
python export_onnx.py netz2.pt ../../erkennung/karten-2.onnx
node browser-test.mjs                              # im Browser prüfen
```

Stand an den 12 echten Handfotos (im Browser, `browser-test.mjs`):

| Netz | kurze Seite | richtig |
|---|---|---|
| karten-1 | 320 | 96 von 108 (89 %) |
| karten-2 (416 nachtrainiert) | 416 | 104 von 108 (96 %), 8 Fotos ganz richtig |


Mit `ERKENNUNG_FOTOS=<ordner>` (Fotos `<name>.jpg` und `soll.json`) misst
`train.py` alle 1000 Schritte an echten Handfotos. Diese Fotos liegen nicht im
Repo.

Neues Netz → neuer Dateiname (`karten-2.onnx`) und `MODELL` in
`jass-erkennung.js` anpassen: Der Service Worker legt die Datei beim ersten
Gebrauch ab und fragt sie danach nicht mehr neu an.

Nötig: Python 3 mit `torch torchvision onnx onnxruntime opencv-python-headless
numpy pillow`.
