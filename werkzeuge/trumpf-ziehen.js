'use strict';
// Soll der Schieber im ersten Stich Trumpf ziehen, wenn sein Partner
// angesagt hat?
//
//   node werkzeuge/trumpf-ziehen.js <anzahl> [start] [tiefe]
//
// Nimmt Verteilungen, in denen Vorhand schiebt, der Partner eine Farbe als
// Trumpf ansagt und Vorhand (der Schieber) selbst Trumpf hat. Jede Verteilung
// wird zweimal gespielt, alle vier Plätze Schwer:
//   frei      der erste Ausspiel wie Schwer ihn ohne Regel wählt (trumpfZiehen: false)
//   trumpf    der erste Ausspiel ist Trumpf (der Buur, wenn er ihn hat,
//             sonst der kleinste)
// Ausgabe: Ø Punkte des ansagenden Teams in beiden Fällen und der Unterschied
// (nur Verteilungen, in denen Schwer frei keinen Trumpf anspielt).
// Mehrere Prozesse mit verschiedenem [start] laufen lassen und zusammenzählen.
//
// Ergebnis (23.11.2026, Rechentiefe normal, 4 × 300 Verteilungen): Schwer
// spielte schon in 607 von 1200 Fällen Trumpf an; in den übrigen 593 brachte
// Trumpf ziehen +2,6 ± 0,8 Punkte (107,1 → 109,7). Seither Regel in schwerZug.
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const [nStr = '100', startStr = '0', tiefe = 'schnell'] = process.argv.slice(2);
const N = Number(nStr), START = Number(startStr);
const T_CODES = ['T0', 'T1', 'T2', 'T3'];
const regeln = J.regelnMitStandard({ weisen: false, stoeck: false, matchBonus: false, multiplikatoren: false });

function spieleZuEnde(spiel, seed, erster) {
  const r = spiel.runde;
  const rng = J.zufall(seed);
  let nr = 0;
  while (r.phase === 'spiel') {
    const s = r.amZug;
    const k = nr === 0 && erster != null ? erster : B.schwerZug(spiel, s, Object.assign({ rng }, B.rechentiefe(tiefe))).karte;
    J.spiele(spiel, s, k);
    nr++;
  }
  return r.abrechnung.total;
}

const erg = { verteilungen: 0, passend: 0, freiTrumpf: 0, verglichen: 0, frei: 0, trumpf: 0, diffs: [] };
for (let i = START; erg.passend < N && i < START + N * 40; i++) {
  erg.verteilungen++;
  const neu = () => J.neuesSpiel(regeln, { seed: 500000 + i, ersterAnsager: 0 });
  const spiel = neu();
  // Ansage wie in der App (Schwer bewertet die Hand)
  const rngA = J.zufall(i);
  const a0 = B.waehleAnsage(spiel, 0, 'schwer', { rng: rngA });
  if (a0.code !== 'SCHIEBEN') continue;
  J.schieben(spiel);
  const a2 = B.waehleAnsage(spiel, 2, 'schwer', { rng: rngA });
  if (!T_CODES.includes(a2.code)) continue;
  J.ansagen(spiel, a2.code);
  const T = J.MODI[a2.code].trumpf;
  const hand = spiel.runde.haende[spiel.runde.amZug];
  const trumpf = hand.filter((k) => J.farbeVon(k) === T);
  if (!trumpf.length || spiel.runde.amZug !== 0) continue;
  erg.passend++;
  const eff = J.effModus(a2.code, 0);
  const buur = trumpf.find((k) => J.wertVon(k) === 5);
  const trumpfKarte = buur != null ? buur : trumpf.reduce((a, b) => (J.STAERKE[eff][a] < J.STAERKE[eff][b] ? a : b));
  // frei
  const A = neu(); J.schieben(A); J.ansagen(A, a2.code);
  const ersteFrei = B.schwerZug(A, 0, Object.assign({ rng: J.zufall(i * 3 + 1), trumpfZiehen: false }, B.rechentiefe(tiefe))).karte;
  if (J.farbeVon(ersteFrei) === T) { erg.freiTrumpf++; continue; }
  const pFrei = spieleZuEnde(A, i * 3 + 2, ersteFrei)[0];
  const Bs = neu(); J.schieben(Bs); J.ansagen(Bs, a2.code);
  const pTrumpf = spieleZuEnde(Bs, i * 3 + 2, trumpfKarte)[0];
  erg.verglichen++; erg.frei += pFrei; erg.trumpf += pTrumpf; erg.diffs.push(pTrumpf - pFrei);
}
const n = erg.verglichen || 1;
const m = erg.diffs.reduce((a, b) => a + b, 0) / n;
const sd = Math.sqrt(erg.diffs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
console.log(JSON.stringify({ start: START, tiefe, verteilungen: erg.verteilungen, passend: erg.passend, freiSchonTrumpf: erg.freiTrumpf,
  verglichen: erg.verglichen, frei: +(erg.frei / n).toFixed(2), trumpf: +(erg.trumpf / n).toFixed(2), diff: +m.toFixed(2), fehler: +(sd / Math.sqrt(n)).toFixed(2), summeDiff: erg.diffs.reduce((a, b) => a + b, 0) }));
