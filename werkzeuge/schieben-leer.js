'use strict';
// Schieben, wenn Vorhand eine Farbe gar nicht hat – zu riskant?
//
//   node werkzeuge/schieben-leer.js <anzahl> [start] [tiefe=schnell]
//
// Nimmt zufällige Verteilungen, in denen der Computer als Vorhand schieben
// würde. Jede wird zweimal zu Ende gespielt (alle Plätze Schwer, derselbe
// Zufall): einmal geschoben (der Partner sagt an), einmal mit der besten
// eigenen Ansage laut Rechnung. Ausgabe als JSON-Zeilen; zusammenzählen mit
// --auswerten <dateien…>.
//
// Ergebnis (24.11.2026, Tiefe schnell, 1600 Verteilungen mit Schieben):
//   alle 4 Farben (1467):   Schieben − eigene Ansage gespielt +12,7 ± 1,0
//   mit leerer Farbe (133): +9,7 ± 3,7 (Rechnung sagte +6,8)
//     Partner macht genau die leere Farbe zu Trumpf (45): −8,1 ± 7,3
//     Partner macht etwas anderes (88): +10 bis +23
//     Rechnung sieht Schieben nur ≤ 3 vorn (35): +1,4 ± 7,4
// → Schieben mit leerer Farbe ist nicht schlechter als gerechnet; nur bei
//   knappen Fällen ist es ein Unentschieden. Keine neue Regel.
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

if (process.argv[2] === '--auswerten') {
  const z = process.argv.slice(3).flatMap((f) => require('fs').readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const mw = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const se = (a) => (a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - mw(a)) ** 2, 0) / (a.length - 1) / a.length) : 0);
  const zeig = (titel, f) => {
    const g = {};
    for (const x of z) (g[f(x)] = g[f(x)] || []).push(x);
    console.log(titel);
    for (const k of Object.keys(g).sort()) {
      const d = g[k].map((x) => x.schieben - x.eigen);
      const r = g[k].map((x) => x.rechnung);
      console.log(`  ${k.padEnd(28)} n ${String(d.length).padStart(4)}   Schieben − eigene Ansage: gespielt ${mw(d) >= 0 ? '+' : ''}${mw(d).toFixed(1)} ± ${se(d).toFixed(1)}   laut Rechnung ${mw(r) >= 0 ? '+' : ''}${mw(r).toFixed(1)}`);
    }
  };
  console.log(`${z.length} Verteilungen, in denen Vorhand schiebt`);
  zeig('Leere Farbe?', (x) => (x.leer ? 'mit leerer Farbe' : 'alle 4 Farben'));
  zeig('Partner sagt danach an … (nur mit leerer Farbe)', (x) => (x.leer ? (x.partnerLeer ? 'meine leere Farbe als Trumpf' : x.partnerTrumpf ? 'eine andere Farbe als Trumpf' : 'Obenabe/Undenufe') : 'zz (alle 4 Farben)'));
  zeig('Vorsprung des Schiebens in der Rechnung (mit leerer Farbe)', (x) => (!x.leer ? 'zz (alle 4 Farben)' : x.rechnung <= 3 ? 'a ≤ 3' : x.rechnung <= 8 ? 'b 3–8' : 'c > 8'));
  process.exit(0);
}

const [nStr = '100', startStr = '0', tiefe = 'schnell'] = process.argv.slice(2);
const N = Number(nStr), START = Number(startStr);
const regeln = J.regelnMitStandard();
const T = B.rechentiefe(tiefe);

function zuEnde(spiel, i) {
  const r = spiel.runde;
  const opt = Object.assign({ rng: J.zufall(i * 7 + 3) }, T);
  while (r.phase === 'spiel') { const s = r.amZug; J.spiele(spiel, s, B.schwerZug(spiel, s, opt).karte); }
  return r.abrechnung.total[0];
}

let n = 0;
for (let i = START; n < N && i < START + N * 10; i++) {
  const neu = () => J.neuesSpiel(regeln, { seed: 300000 + i, ersterAnsager: 0 });
  const spiel = neu();
  const hand = spiel.runde.haende[0];
  const w = B.waehleAnsage(spiel, 0, 'schwer', Object.assign({ rng: J.zufall(i) }, T));
  if (w.code !== 'SCHIEBEN') continue;
  n++;
  const eigen = w.liste.find((x) => x.code !== 'SCHIEBEN');
  const sch = w.liste.find((x) => x.code === 'SCHIEBEN');
  const farben = [0, 1, 2, 3].map((f) => hand.filter((k) => J.farbeVon(k) === f).length);
  // geschoben
  const a = neu();
  J.schieben(a);
  const p = B.waehleAnsage(a, 2, 'schwer', Object.assign({ rng: J.zufall(i + 1e6) }, T)).code;
  J.ansagen(a, p);
  const schieben = zuEnde(a, i);
  // eigene Ansage
  const b = neu();
  J.ansagen(b, eigen.code);
  const eigenP = zuEnde(b, i);
  const tr = J.MODI[p].trumpf;
  console.log(JSON.stringify({
    i, leer: farben.some((x) => x === 0), farben, eigen: eigenP, schieben, eigenCode: eigen.code, partner: p,
    partnerTrumpf: tr >= 0, partnerLeer: tr >= 0 && farben[tr] === 0, rechnung: Math.round((sch.punkte - eigen.punkte) * 10) / 10,
  }));
}
