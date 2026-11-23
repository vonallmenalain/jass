'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../jass-engine.js');

const { karte, W6, W7, W8, W9, W10, WB, WD, WK, WA } = J;
const S = 0, H = 1, K = 2, E = 3; // Schaufel, Herz, Kreuz, Ecke
const R = J.regelnMitStandard();

function spieleZufaellig(spiel, rng) {
  const runde = spiel.runde;
  while (runde.phase === 'spiel') {
    const erlaubt = J.erlaubteFuer(spiel, runde.amZug);
    J.spiele(spiel, runde.amZug, erlaubt[Math.floor(rng() * erlaubt.length)]);
  }
}

test('Kartenwerte ergeben 152 Punkte pro Modus', () => {
  for (let eff = 0; eff < 6; eff++) {
    let summe = 0;
    for (let k = 0; k < 36; k++) summe += J.PUNKTE[eff][k];
    assert.equal(summe, 152, 'eff ' + eff);
  }
});

test('Trumpf: Buur vor Nell vor Ass', () => {
  const eff = 1; // Herz Trumpf
  const stich = [karte(H, WA), karte(H, W9), karte(H, WB), karte(H, WK)];
  assert.equal(J.gewinnerIndex(stich, eff), 2);
  assert.equal(J.gewinnerIndex([karte(H, WA), karte(H, W9)], eff), 1);
});

test('Trumpf sticht jede andere Farbe, fremde Farbe nie', () => {
  const eff = 1;
  const stich = [karte(S, WA), karte(H, W6), karte(K, WA), karte(S, WK)];
  assert.equal(J.gewinnerIndex(stich, eff), 1);
  assert.equal(J.gewinnerIndex([karte(S, W6), karte(K, WA), karte(S, W7)], J.EFF_OBE), 2);
});

test('Undenufe: die Sechs ist die höchste Karte', () => {
  const stich = [karte(S, WA), karte(S, W6), karte(S, W7), karte(S, W10)];
  assert.equal(J.gewinnerIndex(stich, J.EFF_UNE), 1);
  assert.equal(J.stichPunkte(stich, J.EFF_UNE), 0 + 11 + 0 + 10);
});

test('Farbe angeben, wenn man kann – Trumpf darf man immer', () => {
  const eff = 1;
  const hand = [karte(S, W6), karte(S, WK), karte(H, W7), karte(K, WA)];
  const erlaubt = J.erlaubteKarten(hand, [karte(S, WA)], eff, R);
  assert.deepEqual(erlaubt.sort((a, b) => a - b), [karte(S, W6), karte(S, WK), karte(H, W7)].sort((a, b) => a - b));
});

test('Ohne die Farbe ist alles erlaubt', () => {
  const hand = [karte(H, W7), karte(K, WA), karte(E, W6)];
  assert.equal(J.erlaubteKarten(hand, [karte(S, WA)], 1, R).length, 3);
  assert.equal(J.erlaubteKarten(hand, [karte(S, WA)], J.EFF_OBE, R).length, 3);
});

test('Untertrumpfen ist verboten, ausser man hat nur Trümpfe', () => {
  const eff = 1;
  const stich = [karte(S, WA), karte(H, WA)];
  const hand = [karte(H, W6), karte(K, W7), karte(H, WB)];
  const erlaubt = J.erlaubteKarten(hand, stich, eff, R);
  assert.ok(!erlaubt.includes(karte(H, W6)), 'tieferer Trumpf verboten');
  assert.ok(erlaubt.includes(karte(H, WB)), 'höherer Trumpf erlaubt');
  assert.ok(erlaubt.includes(karte(K, W7)));
  const nurTrumpf = [karte(H, W6), karte(H, W7)];
  assert.equal(J.erlaubteKarten(nurTrumpf, stich, eff, R).length, 2);
  const erlaubtFrei = J.erlaubteKarten(hand, stich, eff, J.regelnMitStandard({ untertrumpfen: true }));
  assert.ok(erlaubtFrei.includes(karte(H, W6)));
});

test('Untertrumpfen verboten auch, wenn man die Farbe angeben könnte', () => {
  const eff = 1;
  const stich = [karte(S, WA), karte(H, WK)];
  const hand = [karte(S, W6), karte(H, W6)];
  assert.deepEqual(J.erlaubteKarten(hand, stich, eff, R), [karte(S, W6)]);
});

test('Den Buur muss man nicht angeben', () => {
  const eff = 1;
  const hand = [karte(H, WB), karte(S, W6), karte(K, W7)];
  assert.equal(J.erlaubteKarten(hand, [karte(H, W6)], eff, R).length, 3);
  const pflicht = J.regelnMitStandard({ puurFrei: false });
  assert.deepEqual(J.erlaubteKarten(hand, [karte(H, W6)], eff, pflicht), [karte(H, WB)]);
  // Mit einem weiteren Trumpf muss man Trumpf geben.
  const hand2 = [karte(H, WB), karte(H, W7), karte(S, W6)];
  assert.deepEqual(J.erlaubteKarten(hand2, [karte(H, W6)], eff, R).sort(), [karte(H, WB), karte(H, W7)].sort());
});

test('Weisen erkennen', () => {
  const hand = [karte(S, W6), karte(S, W7), karte(S, W8), karte(H, WB), karte(S, WB), karte(K, WB), karte(E, WB), karte(E, WA), karte(E, WK)];
  const weise = J.findeWeise(hand);
  const namen = weise.map(J.weisName).sort();
  assert.deepEqual(namen, ['Dreiblatt ♠ bis 8', 'Vier Bauern'].sort());
  assert.equal(weise.reduce((s, w) => s + w.punkte, 0), 220);
});

test('Längeres Blatt, höheres Blatt, Trumpfblatt', () => {
  const [a] = J.findeWeise([karte(S, W6), karte(S, W7), karte(S, W8)]);
  const [b] = J.findeWeise([karte(H, WD), karte(H, WK), karte(H, WA)]);
  assert.ok(J.vergleicheWeis(b, a, J.EFF_OBE) > 0, 'höheres Dreiblatt gewinnt');
  assert.ok(J.vergleicheWeis(a, b, J.EFF_UNE) > 0, 'bei Undenufe das tiefere');
  const [c] = J.findeWeise([karte(K, WD), karte(K, WK), karte(K, WA)]);
  assert.ok(J.vergleicheWeis(c, b, 2) > 0, 'Trumpfblatt gewinnt bei Gleichstand');
});

test('Eine ganze Runde ergibt immer 157 Punkte (ausser Slalom)', () => {
  const rng = J.zufall(42);
  for (const code of ['T0', 'T1', 'T2', 'T3', 'OBE', 'UNE', 'MIS']) {
    for (let i = 0; i < 30; i++) {
      const spiel = J.neuesSpiel({ modi: { T: true, OBE: true, UNE: true, MIS: true } }, { seed: i + 1 });
      J.ansagen(spiel, code);
      spieleZufaellig(spiel, rng);
      const ab = spiel.runde.abrechnung;
      assert.equal(ab.total[0] + ab.total[1], 157, code);
      assert.equal(spiel.runde.stichZahl[0] + spiel.runde.stichZahl[1], 9);
      assert.ok(spiel.runde.haende.every((h) => h.length === 0));
    }
  }
});

test('Jede Karte wird genau einmal gespielt, und nur erlaubte', () => {
  const rng = J.zufall(7);
  for (let i = 0; i < 50; i++) {
    const spiel = J.neuesSpiel({ modi: { SLO: true, SLU: true } }, { seed: 1000 + i });
    const modi = J.erlaubteModi(spiel.regeln);
    J.ansagen(spiel, modi[i % modi.length]);
    spieleZufaellig(spiel, rng);
    const alle = spiel.runde.stiche.flatMap((s) => s.karten).sort((a, b) => a - b);
    assert.deepEqual(alle, Array.from({ length: 36 }, (_, k) => k));
  }
});

test('Misère: man schreibt die Punkte des Gegners', () => {
  const spiel = J.neuesSpiel({ modi: { MIS: true } }, { seed: 5 });
  J.ansagen(spiel, 'MIS');
  spieleZufaellig(spiel, J.zufall(1));
  const r = spiel.runde;
  assert.deepEqual(r.abrechnung.stich, [r.punkte[1], r.punkte[0]]);
});

test('Erste Runde: wer die Ecken-7 hat, sagt an; danach reihum', () => {
  const spiel = J.neuesSpiel({}, { seed: 99 });
  const r0 = spiel.runde;
  assert.ok(r0.haende[r0.ansager].includes(karte(E, W7)));
  J.ansagen(spiel, 'OBE');
  spieleZufaellig(spiel, J.zufall(3));
  J.rundeAbschliessen(spiel);
  assert.equal(spiel.runde.ansager, (r0.ansager + 1) % 4);
});

test('Schieben: Partner sagt an, Vorhand spielt aus', () => {
  const spiel = J.neuesSpiel({ ersterAnsager: 'sitz0' }, { seed: 3 });
  J.schieben(spiel);
  assert.equal(J.ansageAmZug(spiel.runde), 2);
  assert.throws(() => J.schieben(spiel));
  J.ansagen(spiel, 'T1');
  assert.equal(spiel.runde.angesagtVon, 2);
  assert.equal(spiel.runde.amZug, 0);
  const spiel2 = J.neuesSpiel({ ersterAnsager: 'sitz0', ausspiel: 'ansager' }, { seed: 3 });
  J.schieben(spiel2);
  J.ansagen(spiel2, 'T1');
  assert.equal(spiel2.runde.amZug, 2);
});

test('Schieben abgeschaltet', () => {
  const spiel = J.neuesSpiel({ schieben: false }, { seed: 3 });
  assert.equal(J.darfSchieben(spiel.runde, spiel.regeln), false);
  assert.throws(() => J.schieben(spiel));
});

test('Nicht erlaubte Ansage wird abgelehnt', () => {
  const spiel = J.neuesSpiel({}, { seed: 3 });
  assert.throws(() => J.ansagen(spiel, 'SLO'));
  assert.throws(() => J.ansagen(spiel, 'MIS'));
});

test('Match, Matchbonus und Multiplikatoren', () => {
  // Sitz 0 hat alle Herz und die Asse: Herz Trumpf, alle Stiche.
  const h0 = [karte(H, WB), karte(H, W9), karte(H, WA), karte(H, WK), karte(H, WD), karte(H, W10), karte(H, W8), karte(H, W7), karte(H, W6)];
  const rest = Array.from({ length: 36 }, (_, k) => k).filter((k) => !h0.includes(k));
  const haende = [h0, rest.slice(0, 9), rest.slice(9, 18), rest.slice(18, 27)];
  const regeln = { ersterAnsager: 'sitz0', matchBonus: true, multiplikatoren: true };
  const spiel = J.neuesSpiel(regeln, { seed: 1, haende });
  J.ansagen(spiel, 'T1');
  spieleZufaellig(spiel, J.zufall(2));
  const ab = spiel.runde.abrechnung;
  assert.equal(ab.matchTeam, 0);
  assert.equal(ab.faktor, 1);
  assert.deepEqual(ab.total, [257, 0]);
  const ohne = J.neuesSpiel({ ersterAnsager: 'sitz0' }, { seed: 1, haende });
  J.ansagen(ohne, 'T1');
  spieleZufaellig(ohne, J.zufall(2));
  assert.deepEqual(ohne.runde.abrechnung.total, [157, 0]);
  const doppelt = J.neuesSpiel({ ersterAnsager: 'sitz0', multiplikatoren: true, faktoren: { T1: 2 } }, { seed: 1, haende });
  J.ansagen(doppelt, 'T1');
  spieleZufaellig(doppelt, J.zufall(2));
  assert.deepEqual(doppelt.runde.abrechnung.total, [314, 0]);
});

test('Stöck zählt nur, wenn eingeschaltet', () => {
  const h0 = [karte(H, WK), karte(H, WD), karte(S, W6), karte(S, W7), karte(S, W8), karte(K, W6), karte(K, W7), karte(K, W8), karte(E, W6)];
  const rest = Array.from({ length: 36 }, (_, k) => k).filter((k) => !h0.includes(k));
  const haende = [h0, rest.slice(0, 9), rest.slice(9, 18), rest.slice(18, 27)];
  const mit = J.neuesSpiel({ ersterAnsager: 'sitz0', stoeck: true }, { seed: 1, haende });
  J.ansagen(mit, 'T1');
  spieleZufaellig(mit, J.zufall(4));
  assert.deepEqual(mit.runde.abrechnung.stoeck, [20, 0]);
  assert.equal(mit.runde.abrechnung.total[0] + mit.runde.abrechnung.total[1], 177);
  const ohne = J.neuesSpiel({ ersterAnsager: 'sitz0' }, { seed: 1, haende });
  J.ansagen(ohne, 'T1');
  spieleZufaellig(ohne, J.zufall(4));
  assert.deepEqual(ohne.runde.abrechnung.stoeck, [0, 0]);
});

test('Weisen: nur das Team mit dem höchsten Weis schreibt', () => {
  const h0 = [karte(S, W6), karte(S, W7), karte(S, W8), karte(H, W6), karte(H, W8), karte(K, W6), karte(K, W8), karte(E, W6), karte(E, W8)];
  const h1 = [karte(H, WD), karte(H, WK), karte(H, WA), karte(H, W10), karte(S, WA), karte(S, W10), karte(K, WA), karte(K, W10), karte(E, W10)];
  const rest = Array.from({ length: 36 }, (_, k) => k).filter((k) => !h0.includes(k) && !h1.includes(k));
  const haende = [h0, h1, rest.slice(0, 9), rest.slice(9, 18)];
  const spiel = J.neuesSpiel({ ersterAnsager: 'sitz0', weisen: true }, { seed: 1, haende });
  J.ansagen(spiel, 'OBE');
  const w = spiel.runde.weis;
  assert.equal(w.siegerSitz, 1, 'Vier Zehner schlagen das Dreiblatt');
  assert.equal(w.punkte[0], 0);
  assert.equal(w.punkte[1], 100 + 20 + w.proSitz[3].reduce((s, x) => s + x.punkte, 0));
});

test('Spielende nach Anzahl Runden', () => {
  const spiel = J.neuesSpiel({ runden: 3 }, { seed: 11 });
  const rng = J.zufall(9);
  let n = 0;
  while (!spiel.fertig) {
    J.ansagen(spiel, 'OBE');
    spieleZufaellig(spiel, rng);
    J.rundeAbschliessen(spiel);
    n++;
  }
  assert.equal(n, 3);
  assert.equal(spiel.summe[0] + spiel.summe[1], 3 * 157);
});

test('Spielende nach Zielpunkten, wer zuerst ankommt', () => {
  const spiel = J.neuesSpiel({ spielende: 'punkte', zielPunkte: 400 }, { seed: 12 });
  const rng = J.zufall(10);
  let n = 0;
  while (!spiel.fertig && n < 50) {
    J.ansagen(spiel, 'T0');
    spieleZufaellig(spiel, rng);
    J.rundeAbschliessen(spiel);
    n++;
  }
  assert.ok(spiel.fertig);
  assert.ok(spiel.summe[spiel.sieger] >= 400);
});

test('Zielpunkte: Stöck vor Weis vor Stich', () => {
  const regeln = J.regelnMitStandard({ spielende: 'punkte', zielPunkte: 100 });
  const runde = { code: 'T0', stiche: [{ sieger: 0, punkte: 50 }] };
  const ab = { faktor: 1, stoeck: [0, 20], weis: [0, 0], match: [0, 0] };
  assert.equal(J.zielErreichtVon([90, 85], runde, ab, regeln), 1);
});

test('Regeln: Runden ohne Obergrenze, mindestens eine Ansage', () => {
  const r = J.regelnMitStandard({ runden: 40, modi: { T: false, OBE: false, UNE: false } });
  assert.equal(r.runden, 40);
  assert.ok(J.erlaubteModi(r).length >= 1);
});

test('Hand sortieren: immer nach Farbe, dann hoch nach tief – auch mit Trumpf', () => {
  const hand = [karte(S, W6), karte(H, W9), karte(H, WB), karte(H, WA), karte(K, WA), karte(E, W6), karte(E, WK)];
  const erwartet = [karte(S, W6), karte(H, WA), karte(H, WB), karte(H, W9), karte(K, WA), karte(E, WK), karte(E, W6)];
  assert.deepEqual(J.sortiereHand(hand), erwartet);
  assert.deepEqual(J.sortiereHand(hand, 'T1'), erwartet, 'Trumpf ändert nichts');
  assert.deepEqual(J.sortiereHand(hand, 'UNE'), erwartet, 'Undenufe ändert nichts');
});

test('Gleiche Saat, gleiche Karten', () => {
  const a = J.neuesSpiel({}, { seed: 1234 });
  const b = J.neuesSpiel({}, { seed: 1234 });
  assert.deepEqual(a.runde.haende, b.runde.haende);
});
