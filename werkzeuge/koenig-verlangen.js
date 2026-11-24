'use strict';
// Konvention «König verlangen» (Obenabe: Ass, wo der König fehlt; Partner
// gibt den König; kommt er nicht, hat er ihn nicht) – Undenufe genauso mit
// Sechs und Sieben. Lohnt sie sich?
//
//   node werkzeuge/koenig-verlangen.js <anzahl> [start] [tiefe=schnell] [schwelle=8]
//
// Nimmt Verteilungen, in denen Vorhand selbst Obenabe oder Undenufe ansagt
// (ohne Schieben) und darum im ersten Stich selbst ausspielt. Jede wird
// zweimal gespielt, alle Plätze Schwer (Löser ab 16), derselbe Zufall:
// einmal ohne, einmal mit der Konvention (bei allen vier – auch die Gegner
// lesen mit). Ausgabe: Unterschied für das ansagende Team, über alle und
// über die Spiele, in denen die Konvention etwas geändert hat. --json für
// die Einzelwerte.
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [nStr = '50', startStr = '0', tiefe = 'schnell', schwelleStr = '8'] = args;
const N = Number(nStr), START = Number(startStr);
const regeln = J.regelnMitStandard();

function spiele(i, code, mit) {
  const spiel = J.neuesSpiel(regeln, { seed: 400000 + i, ersterAnsager: 0 });
  J.ansagen(spiel, code);
  const r = spiel.runde;
  const opt = Object.assign({ rng: J.zufall(i * 17 + 3), loesenAb: 16 }, B.rechentiefe(tiefe), mit ? { koenigVerlangen: true, verlangenSchwelle: Number(schwelleStr) } : {});
  const zuege = [];
  while (r.phase === 'spiel') { const s = r.amZug; const k = B.schwerZug(spiel, s, opt).karte; zuege.push(k); J.spiele(spiel, s, k); }
  return { punkte: r.abrechnung.total[0], zuege: zuege.join() };
}

const zeilen = [];
for (let i = START; zeilen.length < N && i < START + N * 30; i++) {
  const spiel = J.neuesSpiel(regeln, { seed: 400000 + i, ersterAnsager: 0 });
  const w = B.waehleAnsage(spiel, 0, 'schwer', Object.assign({ rng: J.zufall(i) }, B.rechentiefe('schnell')));
  if (w.code !== 'OBE' && w.code !== 'UNE') continue;
  const ohne = spiele(i, w.code, false);
  const mit = spiele(i, w.code, true);
  zeilen.push({ i, code: w.code, d: mit.punkte - ohne.punkte, anders: mit.zuege !== ohne.zuege });
}
if (process.argv.includes('--json')) { console.log(JSON.stringify(zeilen)); process.exit(0); }
const mw = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const se = (a) => (a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - mw(a)) ** 2, 0) / (a.length - 1) / a.length) : 0);
const alle = zeilen.map((z) => z.d), anders = zeilen.filter((z) => z.anders).map((z) => z.d);
console.log(`${zeilen.length} Spiele mit Obenabe/Undenufe vom Ansager: ${mw(alle) >= 0 ? '+' : ''}${mw(alle).toFixed(2)} ± ${se(alle).toFixed(2)} · in ${anders.length} geänderten ${mw(anders) >= 0 ? '+' : ''}${mw(anders).toFixed(2)} ± ${se(anders).toFixed(2)}`);
