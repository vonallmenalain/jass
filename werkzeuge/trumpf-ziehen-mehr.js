'use strict';
// «Lieber einmal mehr Trumpf ziehen»: Soll das ansagende Team öfter Trumpf
// ziehen, solange die Gegner noch Trumpf haben können? Gemessen gegen den
// heutigen Stand (den letzten Trumpf holen, mit dem höchsten Trumpf).
//
//   node werkzeuge/trumpf-ziehen-mehr.js <anzahl> [start] [tiefe=schnell] [--json]
//
// Nimmt Verteilungen mit einer Trumpf-Ansage (wie in der App, mit Schieben).
// Jede wird mehrmals gespielt, alle vier Plätze Schwer, gleicher Zufall:
//   heute      Standard: ziehen, wenn nur noch 1 Trumpf draussen ist und
//              man den höchsten hat (Schwelle 8)
//   bis2       auch bei 2 Trümpfen draussen («einmal mehr»)
//   immerBock  bei beliebig vielen draussen, solange man den höchsten hat
//   immer      auch ohne den höchsten Trumpf (dann mit dem tiefsten)
//   immer!     wie immer, aber auch wenn die Rechnung es klar schlechter sieht
// Ausgabe: Unterschied zu «heute» für das ansagende Team, über alle und über
// die Spiele, in denen sich etwas geändert hat; dazu nach Schieben getrennt.
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [nStr = '50', startStr = '0', tiefe = 'schnell'] = args;
const N = Number(nStr), START = Number(startStr);
const T_CODES = ['T0', 'T1', 'T2', 'T3'];
const regeln = J.regelnMitStandard({ weisen: false, stoeck: false, matchBonus: false, multiplikatoren: false });
const VARIANTEN = {
  heute: {},
  bis2: { trumpfWeiterDraussen: 2 },
  immerBock: { trumpfWeiterDraussen: 9 },
  immer: { trumpfWeiterDraussen: 9, trumpfWeiterOhneBock: true },
  'immer!': { trumpfWeiterDraussen: 9, trumpfWeiterOhneBock: true, trumpfWeiterSchwelle: 1000 },
};

function spiele(seed, ansage, extra) {
  const spiel = J.neuesSpiel(regeln, { seed: 710000 + seed, ersterAnsager: 0 });
  for (const a of ansage) { if (a === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, a); }
  const r = spiel.runde;
  const opt = Object.assign({ rng: J.zufall(seed * 7919 + 17) }, B.rechentiefe(tiefe), { zeitMs: 0 }, extra);
  const zuege = [];
  while (r.phase === 'spiel') { const s = r.amZug; const k = B.schwerZug(spiel, s, opt).karte; zuege.push(k); J.spiele(spiel, s, k); }
  return { punkte: r.abrechnung.total[J.team(r.angesagtVon)], zuege: zuege.join(',') };
}

const zeilen = [];
for (let i = START, gefunden = 0; gefunden < N && i < START + N * 10; i++) {
  const spiel = J.neuesSpiel(regeln, { seed: 710000 + i, ersterAnsager: 0 });
  const rngA = J.zufall(i);
  const ansage = [];
  const a0 = B.waehleAnsage(spiel, 0, 'schwer', Object.assign({ rng: rngA }, B.rechentiefe('schnell')));
  if (a0.code === 'SCHIEBEN') { ansage.push('SCHIEBEN'); J.schieben(spiel); ansage.push(B.waehleAnsage(spiel, 2, 'schwer', Object.assign({ rng: rngA }, B.rechentiefe('schnell'))).code); } else ansage.push(a0.code);
  if (!T_CODES.includes(ansage[ansage.length - 1])) continue;
  gefunden++;
  const heute = spiele(i, ansage, VARIANTEN.heute);
  const z = { i, geschoben: ansage[0] === 'SCHIEBEN', heute: heute.punkte, v: {} };
  for (const [name, extra] of Object.entries(VARIANTEN)) {
    if (name === 'heute') continue;
    const m = spiele(i, ansage, extra);
    z.v[name] = { d: m.punkte - heute.punkte, anders: m.zuege !== heute.zuege };
  }
  zeilen.push(z);
  process.stderr.write(`${zeilen.length}/${N}\r`);
}
if (process.argv.includes('--json')) { console.log(JSON.stringify(zeilen)); process.exit(0); }
auswerten(zeilen);

function auswerten(zeilen) {
  const mw = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const se = (a) => Math.sqrt(a.reduce((x, y) => x + (y - mw(a)) ** 2, 0) / Math.max(1, a.length - 1) / Math.max(1, a.length));
  const f = (a) => `${mw(a) >= 0 ? '+' : ''}${mw(a).toFixed(2)} ± ${se(a).toFixed(2)} (${a.length})`;
  console.log(`${zeilen.length} Trumpf-Spiele, Tiefe ${tiefe}; heute Ø ${mw(zeilen.map((z) => z.heute)).toFixed(1)} Punkte fürs ansagende Team`);
  for (const name of Object.keys(VARIANTEN).filter((n) => n !== 'heute')) {
    const alle = zeilen.map((z) => z.v[name].d);
    const anders = zeilen.filter((z) => z.v[name].anders);
    console.log(`  ${name.padEnd(10)} über alle ${f(alle)} · geändert ${f(anders.map((z) => z.v[name].d))} · davon nach Schieben ${f(anders.filter((z) => z.geschoben).map((z) => z.v[name].d))}, selbst angesagt ${f(anders.filter((z) => !z.geschoben).map((z) => z.v[name].d))}`);
  }
}
module.exports = { auswerten };
