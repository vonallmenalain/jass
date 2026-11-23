'use strict';
// Was bringt das Ausspiel des Schiebers als Zeichen (jass-bot.js,
// schieberAusspiel / schieberNicht)?
//
//   node werkzeuge/schieber-zeichen.js <anzahl> [start] [tiefe]
//
// Nimmt Verteilungen, in denen Vorhand schiebt und der Partner ansagt, und
// spielt jede zweimal, alle vier Plätze Schwer:
//   bisher   ohne Zeichen: Trumpf ziehen mit dem Buur, sonst dem kleinsten;
//            niemand liest etwas aus dem Ausspiel (schieberZeichen: false)
//   zeichen  im ersten Stich der höchste Trumpf, bei Obenabe/Undenufe zuerst
//            alle obersten Karten – und alle lesen daraus, was er nicht hat
// Ausgabe: Ø Punkte des ansagenden Teams, getrennt nach Trumpf und
// Obenabe/Undenufe. Mehrere Prozesse mit verschiedenem [start] laufen lassen.
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const [nStr = '50', startStr = '0', tiefe = 'normal'] = process.argv.slice(2);
const N = Number(nStr), START = Number(startStr);
const regeln = J.regelnMitStandard({ weisen: false, stoeck: false, matchBonus: false, multiplikatoren: false });

function spiele(seed, code, zeichen) {
  const spiel = J.neuesSpiel(regeln, { seed, ersterAnsager: 0 });
  J.schieben(spiel); J.ansagen(spiel, code);
  const rng = J.zufall(seed * 3 + 1);
  const opt = Object.assign({ rng }, B.rechentiefe(tiefe), zeichen ? {} : { schieberZeichen: false });
  while (spiel.runde.phase === 'spiel') {
    const s = spiel.runde.amZug;
    J.spiele(spiel, s, B.schwerZug(spiel, s, opt).karte);
  }
  return spiel.runde.abrechnung.total[0];
}

const erg = { trumpf: [], obenUnde: [] };
let gefunden = 0;
for (let i = START; gefunden < N && i < START + N * 30; i++) {
  const seed = 800000 + i;
  const spiel = J.neuesSpiel(regeln, { seed, ersterAnsager: 0 });
  const rngA = J.zufall(i);
  if (B.waehleAnsage(spiel, 0, 'schwer', { rng: rngA }).code !== 'SCHIEBEN') continue;
  J.schieben(spiel);
  const code = B.waehleAnsage(spiel, 2, 'schwer', { rng: rngA }).code;
  gefunden++;
  const d = spiele(seed, code, true) - spiele(seed, code, false);
  (J.MODI[code].trumpf >= 0 ? erg.trumpf : erg.obenUnde).push(d);
}
const zus = (a) => {
  const n = a.length || 1, m = a.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, n - 1));
  return { n: a.length, diff: +m.toFixed(2), fehler: +(sd / Math.sqrt(n)).toFixed(2), summe: a.reduce((x, y) => x + y, 0), quadrate: +a.reduce((x, y) => x + y * y, 0).toFixed(1) };
};
console.log(JSON.stringify({ start: START, tiefe, trumpf: zus(erg.trumpf), obenUnde: zus(erg.obenUnde) }));
