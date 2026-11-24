'use strict';
// «Optimieren»: dieselbe Verteilung, dieselbe Ansage, der Computer spielt alle Plätze.
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../jass-engine.js');
const O = require('../jass-optimieren.js');

const haende = J.verteile(J.zufall(4242));

test('spielt genau die aufgezeichneten Hände mit derselben Ansage', () => {
  const aufzeichnung = { nr: 0, ansager: 0, haende, ansagen: [{ s: 0, wahl: 'T2' }], zuege: [] };
  const erg = O.nachspielen({}, aufzeichnung, 'schnell');
  assert.equal(erg.code, 'T2');
  assert.equal(erg.zuege.length, 36);
  for (let s = 0; s < 4; s++) {
    const gespielt = erg.zuege.filter((z) => z.s === s).map((z) => z.k).sort((a, b) => a - b);
    assert.deepEqual(gespielt, haende[s].slice().sort((a, b) => a - b), 'Sitz ' + s);
  }
  assert.equal(erg.zuege[0].s, 0, 'wer angesagt hat, spielt aus');
  assert.equal(erg.punkte[0] + erg.punkte[1], 157);
  assert.ok(erg.zuege.every((z, i) => z.stich === Math.floor(i / 4)));
});

test('geschoben: der Partner sagt an, wie aufgezeichnet', () => {
  const aufzeichnung = { nr: 0, ansager: 0, haende, ansagen: [{ s: 0, wahl: 'SCHIEBEN' }, { s: 2, wahl: 'OBE' }], zuege: [] };
  const spiel = O.vorbereiten({}, aufzeichnung);
  assert.equal(spiel.runde.code, 'OBE');
  assert.equal(spiel.runde.geschoben, true);
  assert.equal(spiel.runde.amZug, 0, 'nach dem Schieben spielt trotzdem Vorhand aus');
});

test('ohne Ansage gibt es nichts nachzuspielen', () => {
  assert.throws(() => O.vorbereiten({}, { ansager: 0, haende, ansagen: [] }));
});

test('drei Werte: Knopf, solange nicht gerechnet; danach der Wert und ein Satz', () => {
  const partie = { ende: 1, runden: [{ ansager: 0, haende, ansagen: [{ s: 0, wahl: 'T2' }] }] };
  let html = O.werteHtml({ schnitt: 121.6, gespielt: 91, partie });
  assert.match(html, /Ø deine Karten<\/span><b>122</);
  assert.match(html, /Gespielt<\/span><b>91</);
  assert.match(html, /data-optimieren>Optimieren</);
  partie.optimiert = { punkte: [105, 52] };
  html = O.werteHtml({ schnitt: 121.6, gespielt: 91, partie });
  assert.match(html, /Optimiert<\/span><b>105</);
  assert.match(html, /14 Punkte mehr/);
  assert.doesNotMatch(html, /data-optimieren/);
  assert.doesNotMatch(O.werteHtml({ schnitt: null, gespielt: 80, partie: { ende: null, runden: [] } }), /data-optimieren/);
});

test('mehrere Durchgänge: Schnitt, Spannweite, typischer Durchgang', () => {
  const l = (a, z) => ({ punkte: [a, 157 - a], zuege: z, rechnen: 'maximal' });
  const erg = O.zusammenfassen([l(65, 'a'), l(115, 'b'), l(90, 'c'), l(124, 'd')]);
  assert.deepEqual(erg.punkte, [99, 59]);
  assert.equal(erg.min, 65);
  assert.equal(erg.max, 124);
  assert.deepEqual(erg.laeufe, [65, 115, 90, 124]);
  assert.equal(erg.zuege, 'c', 'am nächsten beim Schnitt 98.5');
  assert.equal(erg.beispiel, 90);
  assert.equal(O.DURCHGAENGE, 8);
  const html = O.werteHtml({ schnitt: 120, gespielt: 91, partie: { ende: 1, runden: [], optimiert: erg } });
  assert.match(html, /<b>99<\/b><small>65–124<\/small>/);
  assert.match(html, /im Schnitt 8 Punkte mehr/);
});

test('Durchgang mit Gedanken: als Partie für den Verlauf', () => {
  const aufzeichnung = { nr: 0, ansager: 0, haende, ansagen: [{ s: 0, wahl: 'T2', stufe: 'mensch' }], zuege: [] };
  const lauf = O.nachspielen({}, aufzeichnung, 'schnell');
  assert.ok(lauf.zuege.every((z) => z.stufe === 'schwer' && typeof z.grund === 'string' && z.grund.length > 0), 'jeder Zug mit Begründung');
  assert.ok(lauf.zuege.some((z) => Array.isArray(z.werte) && z.werte.every((w) => typeof w.k === 'number' && typeof w.w === 'number')), 'durchgerechnete Werte wie im Verlauf');
  assert.deepEqual(lauf.abrechnung.total, lauf.punkte);
  const partie = {
    id: 'p1', start: 1, ende: 2, regeln: {}, spieler: [{ name: 'Du', typ: 'mensch' }, { name: 'Anna', typ: 'schwer' }, { name: 'Ben', typ: 'schwer' }, { name: 'Clara', typ: 'schwer' }],
    runden: [Object.assign({ code: 'T2', angesagtVon: 0, geschoben: false }, aufzeichnung)],
    optimiert: O.zusammenfassen([lauf, lauf]),
  };
  const v = O.alsPartie(partie);
  assert.equal(v.format, 'jass-partie');
  assert.equal(v.optimiertVon, 'p1');
  assert.ok(v.spieler.every((x) => x.typ === 'schwer'));
  assert.equal(v.runden[0].zuege.length, 36);
  assert.deepEqual(v.runden[0].haende, haende);
  assert.deepEqual(v.summe, lauf.punkte);
  assert.match(O.werteHtml({ schnitt: 100, gespielt: 90, partie }), /data-optimiert-ansehen/);
});
