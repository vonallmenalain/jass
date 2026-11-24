'use strict';
// Eine Hand als Vorhand: Was bringt welche Ansage – zu Ende gespielt?
//
//   node werkzeuge/ansage-vergleich.js <karten> [verteilungen=300] [tiefe=normal] [ansagen=SCHIEBEN,T0,T1,T2,T3,OBE,UNE]
//
//   karten   die 9 Karten von Vorhand, z. B. H-K,K-B,K-10,K-8,E-A,E-D,E-8,E-7,E-6
//            (Farbe S/H/K/E, Wert 6 7 8 9 10 B D K A) oder Kartennummern 0–35
//
// Die übrigen 27 Karten werden zufällig verteilt; jede Verteilung wird mit
// jeder Ansage gespielt (dieselben Karten, derselbe Zufall). Beim Schieben
// sagt der Partner an wie in der App. Alle vier Plätze spielen Schwer.
// Ausgabe: Ø Punkte von Vorhands Team je Ansage, der Unterschied zur
// ersten Ansage (gepaart, ± Standardfehler) und beim Schieben, was der
// Partner angesagt hat.
//
// Beispiel (24.11.2026, 400 Verteilungen, Tiefe normal): HK KB K10 K8 EA ED
// E8 E7 E6 – Schieben 105,0 · Kreuz 104,7 (−0,2 ± 2,2) · Ecke 97,3 (−7,6) ·
// Undenufe 94,4. Nach dem Schieben macht der Partner in 33 % Schaufel (die
// leere Farbe): dann nur Ø 79,7. Die Trainer-Rechnung gab Kreuz 93 – zu tief.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const FARBE = { S: 0, H: 1, K: 2, E: 3 };
const WERT = { 6: 0, 7: 1, 8: 2, 9: 3, 10: 4, B: 5, D: 6, K: 7, A: 8 };
const kurz = (k) => 'SHKE'[Math.floor(k / 9)] + ['6', '7', '8', '9', '10', 'B', 'D', 'K', 'A'][k % 9];
const karteAus = (t) => (/^\d+$/.test(t) ? Number(t) : FARBE[t[0].toUpperCase()] * 9 + WERT[t.slice(2).toUpperCase()]);

function spiele(hand, i, ansage, tiefe, regeln) {
  const rng = J.zufall(1000 + i);
  const rest = J.mische(Array.from({ length: 36 }, (_, k) => k).filter((k) => !hand.includes(k)), rng);
  const haende = [hand.slice(), rest.slice(0, 9), rest.slice(9, 18), rest.slice(18, 27)];
  const spiel = J.neuesSpiel(regeln, { haende, ersterAnsager: 0 });
  const t = B.rechentiefe(tiefe);
  let partner = null;
  if (ansage === 'SCHIEBEN') {
    J.schieben(spiel);
    partner = B.waehleAnsage(spiel, 2, 'schwer', Object.assign({ rng: J.zufall(5000 + i) }, t)).code;
    J.ansagen(spiel, partner);
  } else J.ansagen(spiel, ansage);
  const r = spiel.runde;
  const opt = Object.assign({ rng: J.zufall(9000 + i) }, t);
  while (r.phase === 'spiel') { const s = r.amZug; J.spiele(spiel, s, B.schwerZug(spiel, s, opt).karte); }
  return { punkte: r.abrechnung.total[0], partner };
}

if (!isMainThread) {
  const { hand, auftraege, tiefe } = workerData;
  const regeln = J.regelnMitStandard();
  for (const a of auftraege) parentPort.postMessage(Object.assign({ i: a.i, ansage: a.ansage }, spiele(hand, a.i, a.ansage, tiefe, regeln)));
  parentPort.postMessage({ fertig: true });
  return;
}

const [kartenArg, nArg = '300', tiefe = 'normal', ansagenArg = 'SCHIEBEN,T0,T1,T2,T3,OBE,UNE'] = process.argv.slice(2);
const hand = kartenArg.split(',').map(karteAus);
if (hand.length !== 9 || new Set(hand).size !== 9 || hand.some((k) => !(k >= 0 && k < 36))) throw new Error('9 verschiedene Karten angeben');
const N = Number(nArg);
const ansagen = ansagenArg.split(',');
console.log('Hand: ' + J.sortiereHand(hand, null).map(kurz).join(' ') + ` · ${N} Verteilungen · Tiefe ${tiefe}`);
const auftraege = [];
for (let i = 0; i < N; i++) for (const a of ansagen) auftraege.push({ i, ansage: a });
const P = Math.max(1, Math.min(4, require('os').cpus().length));
const teile = [...Array(P)].map(() => []);
auftraege.forEach((a, j) => teile[j % P].push(a));
const erg = new Map(ansagen.map((a) => [a, []]));
const partnerWahl = [];
let offen = P;
const t0 = Date.now();
for (const t of teile) {
  const w = new Worker(__filename, { workerData: { hand, auftraege: t, tiefe } });
  w.on('message', (m) => {
    if (!m.fertig) {
      erg.get(m.ansage)[m.i] = m.punkte;
      if (m.partner) partnerWahl[m.i] = m.partner;
      return;
    }
    if (--offen) return;
    const mw = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const se = (a) => Math.sqrt(a.reduce((x, y) => x + (y - mw(a)) ** 2, 0) / (a.length - 1) / a.length);
    const a0 = ansagen[0];
    const name = (c) => (c === 'SCHIEBEN' ? 'Schieben' : J.MODI[c].lang);
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const a of ansagen) {
      const d = erg.get(a).map((x, i) => x - erg.get(a0)[i]);
      console.log(`  ${name(a).padEnd(18)} Ø ${mw(erg.get(a)).toFixed(1)}` + (a !== a0 ? `   gegenüber ${name(a0)}: ${mw(d) >= 0 ? '+' : ''}${mw(d).toFixed(1)} ± ${se(d).toFixed(1)}` : ''));
    }
    if (erg.has('SCHIEBEN')) {
      const g = {};
      erg.get('SCHIEBEN').forEach((x, i) => { (g[partnerWahl[i]] = g[partnerWahl[i]] || []).push(x); });
      console.log('  Nach dem Schieben sagt der Partner an:');
      for (const [c, l] of Object.entries(g).sort((x, y) => y[1].length - x[1].length)) console.log(`    ${name(c).padEnd(18)} ${String(Math.round((100 * l.length) / N)).padStart(3)} %   Ø ${mw(l).toFixed(1)}`);
    }
  });
}
