'use strict';
// Duell zweier Einstellungen von «Schwer», mit gleichen Karten
// (werkzeuge/duell.js lässt dagegen zwei Stufen gegeneinander spielen).
//
//   node werkzeuge/staerke-duell.js <verteilungen> "<A>" "<B>" [start=0] [prozesse=4]
//
//   A, B   Einstellungen für schwerZug als «schlüssel:wert»-Liste, z. B.
//          "tiefe:normal,loeser:false"  (der Computer vor dem Löser)
//          "tiefe:normal,loesenAb:16,welten:200"
//
// Jede Verteilung wird zweimal gespielt: einmal sitzt A auf 0/2 und B auf
// 1/3, einmal umgekehrt – dieselben Karten, dieselbe Ansage (sie wählt
// immer derselbe Computer, damit nur das Kartenspiel zählt). Ausgabe: Ø
// Punkte von A pro Spiel über 78,5 (= Vorsprung), ± Standardfehler, und die
// Zeit pro Zug.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

function einstellung(text) {
  const o = {};
  for (const teil of String(text).split(',').filter(Boolean)) {
    const [k, v] = teil.split(':');
    if (k === 'tiefe') Object.assign(o, B.rechentiefe(v));
    else o[k] = v === 'false' ? false : v === 'true' ? true : Number.isNaN(Number(v)) ? v : Number(v);
  }
  return o;
}

const regeln = J.regelnMitStandard();

function spiel(seed, aufNull, A, Bo) {
  // aufNull: welche Einstellung sitzt auf 0/2 ('A' oder 'B')
  const s = J.neuesSpiel(regeln, { seed: 800000 + seed, ersterAnsager: seed % 4 });
  const r = s.runde;
  const rngA = J.zufall(seed);
  while (r.phase === 'ansage') {
    const sitz = J.ansageAmZug(r);
    const w = B.waehleAnsage(s, sitz, 'schwer', Object.assign({ rng: rngA }, B.rechentiefe('schnell')));
    if (w.code === 'SCHIEBEN') J.schieben(s); else J.ansagen(s, w.code);
  }
  const rng = J.zufall(seed * 31 + 7);
  const zeit = { A: 0, B: 0, zA: 0, zB: 0 };
  while (r.phase === 'spiel') {
    const sitz = r.amZug;
    const wer = (sitz % 2 === 0) === (aufNull === 'A') ? 'A' : 'B';
    const t0 = Date.now();
    const k = B.schwerZug(s, sitz, Object.assign({ rng }, wer === 'A' ? A : Bo)).karte;
    zeit[wer] += Date.now() - t0; zeit['z' + wer]++;
    J.spiele(s, sitz, k);
  }
  const tA = aufNull === 'A' ? 0 : 1;
  return { a: r.abrechnung.total[tA], zeit };
}

if (!isMainThread) {
  const { seeds, a, b } = workerData;
  const A = einstellung(a), Bo = einstellung(b);
  for (const seed of seeds) {
    const x = spiel(seed, 'A', A, Bo);
    const y = spiel(seed, 'B', A, Bo);
    parentPort.postMessage({ seed, a: (x.a + y.a) / 2, zeit: [x.zeit, y.zeit] });
  }
  parentPort.postMessage({ fertig: true });
  return;
}

const [nStr = '50', a = 'tiefe:normal', b = 'tiefe:normal,loeser:false', startStr = '0', pStr = '4'] = process.argv.slice(2);
const N = Number(nStr), START = Number(startStr), P = Number(pStr);
const teile = [...Array(P)].map(() => []);
for (let i = 0; i < N; i++) teile[i % P].push(START + i);
const werte = [];
const zeit = { A: 0, B: 0, zA: 0, zB: 0 };
let offen = P;
const t0 = Date.now();
for (const seeds of teile) {
  const w = new Worker(__filename, { workerData: { seeds, a, b } });
  w.on('message', (m) => {
    if (!m.fertig) {
      werte.push(m.a - 78.5);
      for (const z of m.zeit) for (const k of Object.keys(zeit)) zeit[k] += z[k];
      return;
    }
    if (--offen) return;
    const mw = werte.reduce((x, y) => x + y, 0) / werte.length;
    const se = Math.sqrt(werte.reduce((x, y) => x + (y - mw) ** 2, 0) / (werte.length - 1) / werte.length);
    console.log(`A = ${a}\nB = ${b}\n${werte.length} Verteilungen (je 2 Spiele), ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    console.log(`Vorsprung von A: ${mw >= 0 ? '+' : ''}${mw.toFixed(2)} ± ${se.toFixed(2)} Punkte pro Spiel`);
    console.log(`Zeit pro Zug: A ${(zeit.A / Math.max(1, zeit.zA)).toFixed(0)} ms, B ${(zeit.B / Math.max(1, zeit.zB)).toFixed(0)} ms`);
    if (process.argv.includes('--json')) console.log(JSON.stringify(werte));
  });
}
