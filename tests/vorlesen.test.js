'use strict';
// Vorlesen im Training: Sätze teilen, und jeder Satz, der vorkommen kann,
// hat eine Aufnahme der Google-Stimme.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');
const S = require('../jass-sprechtexte.js');
const V = require('../jass-vorlesen.js');

const WURZEL = path.join(__dirname, '..');
const TRAINING_SEITEN = ['training.html', 'zaehlen.html', 'trumpf-trainer.html', 'trumpf-helfer.html'];

function aufnahmen() {
  const fenster = {};
  new Function('window', fs.readFileSync(path.join(WURZEL, 'jass-stimme-dateien.js'), 'utf8'))(fenster);
  return fenster.JassStimmeDateien;
}

test('Text aus HTML: Zeilen, Sätze, keine Knöpfe und keine Bildzeichen', () => {
  const html = '<h2>Was ist Trumpf?</h2><p>Du bist <b>Vorhand</b>. Was sagst du an?</p><button>🔊</button><ul><li>Trumpf mit dem Buur</li></ul>';
  assert.deepEqual(V.saetze(V.textAusHtml(html)), ['Was ist Trumpf?', 'Du bist Vorhand.', 'Was sagst du an?', 'Trumpf mit dem Buur']);
  assert.deepEqual(V.saetze('🎲 Zufall &amp; mehr'), ['🎲 Zufall &amp; mehr'.replace('🎲 ', '')]);
  assert.deepEqual(V.saetze(V.textAusHtml('<strong>Titel</strong><span>Text.</span>')), ['Titel', 'Text.']);
  assert.equal(V.sprechform('Der Buur sticht.'), 'Der Puur sticht.');
});

test('Feste Texte der Seiten werden gefunden', () => {
  const s = V.statischeSaetze(fs.readFileSync(path.join(WURZEL, 'trumpf-trainer.html'), 'utf8'));
  assert.ok(s.includes('Was ist Trumpf?'));
  assert.ok(s.includes('Faustregeln'));
  assert.ok(!s.some((x) => x.includes('${')), 'keine Vorlagen aus <script>');
});

test('Die Bausteine erzeugen nur Sätze, die alle() kennt', () => {
  const alle = new Set([...S.alle(), ...B.alleSprechTeile()]);
  const fehlt = new Set();
  const pruefe = (liste) => liste.map(B.sprechform).forEach((x) => { if (!alle.has(x)) fehlt.add(x); });
  const rng = J.zufall(4242);
  const codes = ['T0', 'T1', 'T2', 'T3', 'OBE', 'UNE'];
  for (let i = 0; i < 300; i++) {
    const code = codes[Math.floor(rng() * codes.length)];
    const karten = J.mische(Array.from({ length: 36 }, (_, k) => k), rng).slice(0, i % 2 ? 4 : 8);
    const werte = karten.map((k) => J.PUNKTE[J.effModus(code, 0)][k]);
    const letzter = karten.length === 4 && i % 3 === 0;
    const summe = werte.reduce((a, b) => a + b, 0) + (letzter ? 5 : 0);
    pruefe(S.zaehlenAufgabe(code, karten, letzter));
    pruefe(S.zaehlenLoesung(code, karten, werte, letzter, summe, i % 2 === 0));
    pruefe(S.werteTabelle(code));
  }
  for (const l of [5, 10, 20]) for (let r = 0; r <= l; r++) pruefe(S.zaehlenErgebnis(r, l, r === l));
  // Trainer und Helfer mit echten Bewertungen
  for (let i = 0; i < 12; i++) {
    const hand = J.verteile(J.zufall(700 + i))[0];
    const b = B.bewertung(hand, {}, { seed: i, geschoben: i % 2 === 1 });
    b.schritt(8);
    const liste = b.ergebnis();
    const wahl = liste[i % liste.length].code;
    pruefe(S.trainerLage(i % 2 === 1, hand));
    pruefe(S.trainerLage(i % 2 === 1, hand, true));
    pruefe(S.trainerAuswertung(hand, wahl, liste, i % 4, false));
    pruefe(S.helferVorschlag(hand, liste, false, liste[liste.length - 1].code));
    pruefe(S.vergleich({ punkte: (i * 23) % 158, code: 'OBE', ichSchob: i % 3 === 0 }, liste[0].punkte, wahl));
    pruefe(S.trainerFertig(i, 30, i % 2 === 0, i % 7, i * 3.3, i % 5));
  }
  pruefe(S.AUSSPIELEN_HINWEIS);
  pruefe(S.HELFER_RUNDE);
  assert.deepEqual(Array.from(fehlt), []);
});

test('Für jeden Satz im Training gibt es eine Aufnahme', () => {
  const a = aufnahmen();
  const saetze = new Set([...S.alle(), ...TRAINING_SEITEN.flatMap((f) => V.statischeSaetze(fs.readFileSync(path.join(WURZEL, f), 'utf8')))]);
  const fehlt = Array.from(saetze).filter((x) => !a[x]);
  assert.deepEqual(fehlt.slice(0, 10), [], fehlt.length + ' Sätze ohne Aufnahme – node werkzeuge/stimme-google.mjs vertonen');
  for (const datei of new Set(Object.values(a))) assert.ok(fs.existsSync(path.join(WURZEL, datei)), datei);
});
