'use strict';
// Daten für die Kartenschätzung: Der Computer spielt gegen sich selbst, und
// jeder Zug mit Auswahl wird festgehalten – Hand, Lage, gespielte Karte.
//
//   node werkzeuge/zug-daten.js <spiele> [start=0] [einstellung=tiefe:schnell,loesenAb:16] > daten.jsonl
//
// Eine Zeile pro Zug: { c: Spielart, n: Stich, st: Karten im Stich,
// ss: Sitze dazu, s: Sitz, h: Hand, g: schon gespielte Karten (mit dem
// laufenden Stich), k: gespielte Karte }. Trainiert wird mit
// werkzeuge/zug-modell.js.
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const [nStr = '10', startStr = '0', einstellung = 'tiefe:schnell,loesenAb:16'] = process.argv.slice(2);
const N = Number(nStr), START = Number(startStr);
const o = {};
for (const teil of einstellung.split(',').filter(Boolean)) {
  const [k, v] = teil.split(':');
  if (k === 'tiefe') Object.assign(o, B.rechentiefe(v));
  else o[k] = v === 'false' ? false : v === 'true' ? true : Number.isNaN(Number(v)) ? v : Number(v);
}
const regeln = J.regelnMitStandard();

for (let i = START; i < START + N; i++) {
  const spiel = J.neuesSpiel(regeln, { seed: 600000 + i, ersterAnsager: i % 4 });
  const r = spiel.runde;
  const rngA = J.zufall(i);
  while (r.phase === 'ansage') {
    const s = J.ansageAmZug(r);
    const w = B.waehleAnsage(spiel, s, 'schwer', Object.assign({ rng: rngA }, B.rechentiefe('schnell')));
    if (w.code === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, w.code);
  }
  const rng = J.zufall(i * 13 + 5);
  const gespielt = [];
  const zeilen = [];
  while (r.phase === 'spiel') {
    const s = r.amZug;
    const legal = J.erlaubteFuer(spiel, s);
    const k = B.schwerZug(spiel, s, Object.assign({ rng }, o)).karte;
    if (legal.length > 1) {
      zeilen.push(JSON.stringify({ c: r.code, n: r.stichNr, st: r.stich.slice(), ss: r.stichSitze.slice(), s, h: r.haende[s].slice(), g: gespielt.concat(r.stich), k }));
    }
    J.spiele(spiel, s, k);
    if (r.stich.length === 0 || r.phase !== 'spiel') { /* Stich fertig */ }
    gespielt.length = 0;
    for (const st of r.stiche) gespielt.push(...st.karten);
  }
  process.stdout.write(zeilen.join('\n') + '\n');
}
