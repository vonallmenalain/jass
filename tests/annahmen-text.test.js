'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../jass-engine.js');
const V = require('../jass-verlauf.js');

const namen = ['Alain', 'Ben', 'Clara', 'Dario'];
const name = (s) => namen[s];
const { karte, W6, W10, WB, WK, WA } = J;
const S = 0, H = 1, K = 2, E = 3;

test('Annahmen als Sätze mit Auslöser und «darum»', () => {
  const z = {
    k: karte(K, W10), ohne: karte(S, WA),
    annahmen: [
      { s: 2, art: 'hoch', p: 80, v: 30, karte: karte(H, WK), darum: true, zug: { s: 2, k: karte(H, W6), n: 2, wie: 'angespielt' } },
      { s: 1, art: 'leer', p: 85, v: 40, farbe: E, zug: { s: 1, k: karte(E, W10), n: 3, wie: 'geschmiert' } },
    ],
  };
  const t = V.annahmenText(z, name, 'T' + S);
  assert.equal(t[0], 'Ich nehme an, Clara hat den Herz-König (80\u00a0% statt 30\u00a0%), weil Clara im 3. Stich die Herz-Sechs angespielt hat. Darum die Kreuz-Zehn statt das Schaufel-Ass.');
  assert.equal(t[1], 'Ich nehme an, Ben hat keine Ecke mehr (85\u00a0% statt 40\u00a0%), weil Ben im 4. Stich die Ecke-Zehn geschmiert hat.');
});

test('Annahmen: nicht, Buur, ohne entscheidende Annahme', () => {
  const t = V.annahmenText({ k: karte(H, W6), ohne: karte(H, WA), annahmen: [{ s: 3, art: 'nichtHoch', p: 4, v: 42, karte: karte(H, WB) }] }, name, 'T' + H);
  assert.deepEqual(t, ['Ich nehme an, Dario hat den Buur nicht (96\u00a0% statt 58\u00a0%).', 'Ohne diese Annahmen hätte ich das Herz-Ass gespielt.']);
  assert.deepEqual(V.annahmenText({ k: 3 }, name, 'OBE'), []);
});

test('Annahmen: «Du» wird mit du angesprochen', () => {
  const t = V.annahmenText({ k: 3, annahmen: [{ s: 0, art: 'leer', p: 72, v: 17, farbe: S, zug: { s: 0, k: karte(E, W6), n: 0, wie: 'abgeworfen' } }] }, (s) => (s === 0 ? 'Du' : namen[s]), 'OBE');
  assert.deepEqual(t, ['Ich nehme an, du hast keine Schaufel mehr (72\u00a0% statt 17\u00a0%), weil du im 1. Stich die Ecke-Sechs abgeworfen hast.']);
});
