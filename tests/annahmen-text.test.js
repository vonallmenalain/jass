'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../jass-engine.js');
const V = require('../jass-verlauf.js');

const namen = ['Alain', 'Ben', 'Clara', 'Dario'];
const name = (s) => namen[s];
const { karte, W6, W7, W10, WB, WD, WK, WA } = J;
const S = 0, H = 1, K = 2, E = 3;

test('Annahmen als Sätze mit Auslöser und «darum»', () => {
  const z = {
    k: karte(K, W10), ohne: karte(S, WA),
    annahmen: [
      { s: 2, art: 'hoch', p: 80, v: 30, karte: karte(H, WK), darum: true, gruende: [{ s: 2, k: karte(H, W6), n: 2, wie: 'angespielt' }] },
      { s: 1, art: 'leer', p: 85, v: 40, farbe: E, gruende: [{ s: 1, k: karte(E, W10), n: 3, wie: 'zugegeben' }] },
    ],
  };
  const t = V.annahmenText(z, name, 'T' + S);
  assert.equal(t[0], 'Ich nehme an, Clara hat den Herz-König (80\u00a0% statt 30\u00a0%), weil Clara im 3. Stich die Herz-Sechs ausgespielt hat. Darum die Kreuz-Zehn statt das Schaufel-Ass.');
  assert.equal(t[1], 'Ich nehme an, Ben hat keine Ecke mehr (85\u00a0% statt 40\u00a0%), weil Ben im 4. Stich die Ecke-Zehn gespielt hat.');
});

test('Annahmen: nicht, Buur, ohne entscheidende Annahme', () => {
  const t = V.annahmenText({ k: karte(H, W6), ohne: karte(H, WA), annahmen: [{ s: 3, art: 'nichtHoch', p: 4, v: 42, karte: karte(H, WB) }] }, name, 'T' + H);
  assert.deepEqual(t, ['Ich nehme an, Dario hat den Buur nicht (96\u00a0% statt 58\u00a0%).', 'Ohne diese Annahmen hätte ich das Herz-Ass gespielt.']);
  assert.deepEqual(V.annahmenText({ k: 3 }, name, 'OBE'), []);
});

test('Annahmen: wer früher «Du» hiess, heisst «Spieler»', () => {
  const t = V.annahmenText({ k: 3, annahmen: [{ s: 0, art: 'leer', p: 72, v: 17, farbe: S, zug: { s: 0, k: karte(E, W6), n: 0, wie: 'abgeworfen' } }] }, (s) => (s === 0 ? 'Du' : namen[s]), 'OBE');
  assert.deepEqual(t, ['Ich nehme an, Spieler hat keine Schaufel mehr (72\u00a0% statt 17\u00a0%), weil Spieler im 1. Stich die Ecke-Sechs weggeworfen hat.']);
});

test('Annahmen: zwei Auslöser, ältere Einträge mit «zug»', () => {
  const zwei = V.annahmenText({ k: 3, annahmen: [{ s: 0, art: 'hoch', p: 70, v: 40, karte: karte(H, W6), gruende: [{ s: 3, k: karte(H, WB), n: 2, wie: 'abgeworfen' }, { s: 2, k: karte(H, WA), n: 5, wie: 'abgeworfen' }] }] }, (s) => (s === 0 ? 'Du' : namen[s]), 'UNE');
  assert.deepEqual(zwei, ['Ich nehme an, Spieler hat die Herz-Sechs (70\u00a0% statt 40\u00a0%), weil Dario im 3. Stich den Herz-Bauer und Clara im 6. Stich das Herz-Ass weggeworfen haben.']);
  const gemischt = V.annahmenText({ k: 3, annahmen: [{ s: 1, art: 'hoch', p: 70, v: 40, karte: karte(H, WA), gruende: [{ s: 1, k: karte(H, W6), n: 1, wie: 'angespielt' }, { s: 0, k: karte(H, W7), n: 4, wie: 'abgeworfen' }] }] }, (s) => (s === 0 ? 'Du' : namen[s]), 'T0');
  assert.deepEqual(gemischt, ['Ich nehme an, Ben hat das Herz-Ass (70\u00a0% statt 40\u00a0%), weil Ben im 2. Stich die Herz-Sechs ausgespielt hat und Spieler im 5. Stich die Herz-Sieben weggeworfen hat.']);
  const selbe = V.annahmenText({ k: 3, annahmen: [{ s: 1, art: 'leer', p: 90, v: 59, farbe: H, gruende: [{ s: 1, k: karte(H, WD), n: 1, wie: 'abgeworfen' }, { s: 1, k: karte(H, WK), n: 2, wie: 'abgeworfen' }] }] }, name, 'UNE');
  assert.deepEqual(selbe, ['Ich nehme an, Ben hat kein Herz mehr (90\u00a0% statt 59\u00a0%), weil Ben im 2. Stich die Herz-Dame und im 3. Stich den Herz-König weggeworfen hat.']);
  const alt = V.annahmenText({ k: 3, annahmen: [{ s: 1, art: 'leer', p: 70, v: 40, farbe: K, zug: { s: 1, k: karte(K, W6), n: 0, wie: 'zugegeben' } }] }, name, 'T0');
  assert.deepEqual(alt, ['Ich nehme an, Ben hat kein Kreuz mehr (70\u00a0% statt 40\u00a0%), weil Ben im 1. Stich die Kreuz-Sechs gespielt hat.']);
});

test('Annahmen: zuerst eine andere Farbe weggeworfen', () => {
  const t = V.annahmenText({ k: 3, annahmen: [{ s: 0, art: 'hoch', p: 78, v: 58, karte: karte(H, W6), gruende: [{ s: 0, k: karte(E, WK), n: 4, wie: 'zuerstWeg' }] }] }, (s) => (s === 0 ? 'Du' : namen[s]), 'UNE');
  assert.deepEqual(t, ['Ich nehme an, Spieler hat die Herz-Sechs (78\u00a0% statt 58\u00a0%), weil Spieler im 5. Stich als Erstes den Ecke-König weggeworfen hat (nicht Herz).']);
});

test('Gedanken der Computer in der Ich-Form, ohne «du»', () => {
  const B = require('../jass-bot.js');
  const du = /(^|[^A-Za-zäöüÄÖÜ])(du|Du|dir|dich|dein\w*|Dein\w*|ihr|Ihr|euch|euer\w*)(?=[^A-Za-zäöüÄÖÜ]|$)/;
  for (const g of B.GRUENDE) assert.ok(!du.test(V.ichForm(g)), 'Ich-Form fehlt: ' + g);
  assert.equal(V.ichForm('Wegwerfen: Du hast die Farbe nicht, und die Rechnung sieht kaum einen Unterschied – also eine tiefe Karte aus deiner schwächsten Farbe. So weiss dein Partner, wo du nichts hast.'),
    'Wegwerfen: Ich habe die Farbe nicht, und die Rechnung sieht kaum einen Unterschied – also eine tiefe Karte aus meiner schwächsten Farbe. So weiss mein Partner, wo ich nichts habe.');
  assert.equal(V.ichForm('Ich habe 1000 mögliche Kartenverteilungen durchgespielt, die zur Ansage passen: Mit dieser Karte macht ihr im Schnitt am meisten Punkte.'),
    'Ich habe 1000 mögliche Kartenverteilungen durchgespielt, die zur Ansage passen: Mit dieser Karte machen wir im Schnitt am meisten Punkte.');
  assert.equal(V.ichForm('Du bist der Letzte: Mit einem Trumpf holst du dir 14 Punkte.'), 'Ich spiele zuletzt: Mit einem Trumpf hole ich mir 14 Punkte.');
  assert.equal(V.ichForm('Nur diese Karte ist erlaubt.'), 'Nur diese Karte ist erlaubt.');
  assert.equal(V.anzeigeName('Du'), 'Spieler');
  assert.equal(V.anzeigeName('Alain'), 'Alain');
});
