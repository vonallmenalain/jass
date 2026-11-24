'use strict';
// Soll das ansagende Team weiter Trumpf ziehen, solange es den höchsten
// Trumpf hält und die Gegner noch Trumpf haben können?
//
//   node werkzeuge/trumpf-weiter.js <anzahl> [start] [tiefe] [schwellen]
//
// Nimmt Verteilungen mit einer Trumpf-Ansage (Ansage wie in der App, mit
// Schieben). Jede Verteilung wird mehrmals gespielt, alle vier Plätze
// Schwer, mit demselben Zufall:
//   ohne      Regel aus (trumpfWeiter: false)
//   <s>       Regel an mit Schwelle s (wie viel die Rechnung das Ziehen
//             schlechter sehen darf, in «eigene minus fremde» Punkten)
// Ausgabe: Ø Punkte des ansagenden Teams; Unterschied zu «ohne» über alle
// Verteilungen und über die, in denen die Regel etwas geändert hat.
// Mehrere Prozesse mit verschiedenem [start] laufen lassen und zusammenzählen
// (--json gibt die Einzelwerte aus).
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const JSON_AUS = process.argv.includes('--json');
const [nStr = '50', startStr = '0', tiefe = 'schnell', schwellenStr = '8,16,1000'] = args;
const N = Number(nStr), START = Number(startStr);
const SCHWELLEN = schwellenStr.split(',').map(Number);
const T_CODES = ['T0', 'T1', 'T2', 'T3'];
const regeln = J.regelnMitStandard({ weisen: false, stoeck: false, matchBonus: false, multiplikatoren: false });

function spiele(seed, ansage, schwelle) {
  const spiel = J.neuesSpiel(regeln, { seed: 700000 + seed, ersterAnsager: 0 });
  for (const a of ansage) { if (a === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, a); }
  const r = spiel.runde;
  const rng = J.zufall(seed * 7919 + 17);
  const opt = Object.assign({ rng }, B.rechentiefe(tiefe), schwelle == null ? { trumpfWeiter: false } : { trumpfWeiterSchwelle: schwelle });
  const zuege = [];
  while (r.phase === 'spiel') {
    const s = r.amZug;
    const k = B.schwerZug(spiel, s, opt).karte;
    zuege.push(k);
    J.spiele(spiel, s, k);
  }
  return { punkte: r.abrechnung.total[J.team ? J.team(r.angesagtVon) : r.angesagtVon % 2], zuege: zuege.join(',') };
}

const zeilen = [];
let gefunden = 0;
for (let i = START; gefunden < N && i < START + N * 10; i++) {
  const spiel = J.neuesSpiel(regeln, { seed: 700000 + i, ersterAnsager: 0 });
  const rngA = J.zufall(i);
  const ansage = [];
  const a0 = B.waehleAnsage(spiel, 0, 'schwer', { rng: rngA });
  if (a0.code === 'SCHIEBEN') {
    ansage.push('SCHIEBEN');
    J.schieben(spiel);
    ansage.push(B.waehleAnsage(spiel, 2, 'schwer', { rng: rngA }).code);
  } else ansage.push(a0.code);
  if (!T_CODES.includes(ansage[ansage.length - 1])) continue;
  gefunden++;
  const ohne = spiele(i, ansage, null);
  const z = { i, ohne: ohne.punkte, mit: {} };
  for (const s of SCHWELLEN) {
    const m = spiele(i, ansage, s);
    z.mit[s] = { punkte: m.punkte, anders: m.zuege !== ohne.zuege };
  }
  zeilen.push(z);
}

if (JSON_AUS) { console.log(JSON.stringify(zeilen)); process.exit(0); }
const mw = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const se = (a) => Math.sqrt(a.reduce((x, y) => x + (y - mw(a)) ** 2, 0) / Math.max(1, a.length - 1) / Math.max(1, a.length));
console.log(`${zeilen.length} Trumpf-Spiele, Tiefe ${tiefe}: ohne Regel Ø ${mw(zeilen.map((z) => z.ohne)).toFixed(1)}`);
for (const s of SCHWELLEN) {
  const d = zeilen.map((z) => z.mit[s].punkte - z.ohne);
  const da = zeilen.filter((z) => z.mit[s].anders).map((z) => z.mit[s].punkte - z.ohne);
  console.log(`  Schwelle ${s}: ${mw(d) >= 0 ? '+' : ''}${mw(d).toFixed(2)} ± ${se(d).toFixed(2)} über alle · in ${da.length} geänderten: ${mw(da) >= 0 ? '+' : ''}${mw(da).toFixed(2)} ± ${se(da).toFixed(2)}`);
}
