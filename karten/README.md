# Kartenbilder

`svg-cards.svg` ist der Kartensatz **SVG-cards 4.0.2**
(<https://github.com/htdebeer/SVG-cards>):

- © 2005 David Bellot, © 2016–2017 Huub de Beer
- Lizenz: GNU Lesser General Public License 2.1 (`LIZENZ-svg-cards.txt`)

Unverändert übernommen. Die App zeigt ihn, wenn unter «Anzeige» das
Kartenbild «Klassisch» gewählt ist (`jass-karten.js`). Die eigenen Karten
der App («Jass-App») sind selbst gezeichnet.

## Unsere Karten (`foto/`)

Der Kartensatz, mit dem wir zu Hause spielen (französische Jasskarten,
Ausgabe von jasskarten.ch), jede Karte einzeln fotografiert und aufbereitet:

- Karte gefunden, die vier Kanten als Geraden eingepasst (die Ecken sind
  rund), perspektivisch entzerrt (800 × 1250),
- Licht und Farbstich ausgeglichen (das Papier wird gleichmässig weiss),
- **Bildkarten** (Bauer, Dame, König): das Foto, leicht nachgeschärft;
  Schrift entfernt: «printed in switzerland» (Schaufel und Herz Dame) und
  «www.jasskarten.ch» (Kreuz und Herz König), die Rahmenlinie bleibt,
- **Zahlenkarten und Asse** haben nur Papier und eine Druckfarbe: Aus dem
  Foto wird pro Pixel die Farbmenge bestimmt, die Kante auf vierfacher
  Auflösung bei 50 % geschnitten und mit einheitlichem Papier und
  einheitlichem Rot bzw. Schwarz neu gemalt – gleiche Form und Anordnung wie
  auf unseren Karten, aber ohne Unschärfe und Farbverlauf,
- Ecken gerundet, als WebP 400 × 625 mit Alpha.

Die Bearbeitung lief mit OpenCV-Skripten ausserhalb des Repos; die Fotos
selbst liegen nicht hier. Eine PDF-Vorlage desselben Designs wurde nicht
verwendet: Die Figuren sind dort nur 210 × 340 Pixel gross, und die
Zahlenkarten weichen ab (andere Anordnung bei Herz und Ecke 7, reines Rot).
Ein zweiter Satz (carta.media, «Design geschützt») wurde nur zum Trainieren
der Kartenerkennung verwendet, nicht als Kartenbild.

In der App: Anzeige → Kartenbild «Unsere Karten» (Standard).
