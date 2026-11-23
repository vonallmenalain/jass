'use strict';
// Lässt zwei Stufen gegeneinander spielen: node werkzeuge/duell.js schwer mittel 40
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');
const [a = 'schwer', b = 'mittel', nStr = '40'] = process.argv.slice(2);
const N = Number(nStr);
let diff = 0, langsamste = 0, zuege = 0, zeit = 0;
for (let i = 0; i < N; i++) {
  // Jede Verteilung zweimal, mit vertauschten Plätzen.
  for (const tausch of [false, true]) {
    const stufe = (s) => ((s % 2 === 0) !== tausch ? a : b);
    const spiel = J.neuesSpiel({ runden: 1 }, { seed: 5000 + i });
    const r = spiel.runde;
    const rng = J.zufall(i * 7 + (tausch ? 1 : 0));
    while (r.phase === 'ansage') {
      const s = J.ansageAmZug(r);
      const w = B.waehleAnsage(spiel, s, stufe(s), { rng });
      if (w.code === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, w.code);
    }
    while (r.phase === 'spiel') {
      const s = r.amZug;
      const t0 = Date.now();
      const z = B.waehleKarte(spiel, s, stufe(s), { rng, exaktAb: process.env.EXAKT ? Number(process.env.EXAKT) : undefined });
      const dt = Date.now() - t0;
      if (stufe(s) === 'schwer') { zeit += dt; zuege++; langsamste = Math.max(langsamste, dt); }
      J.spiele(spiel, s, z.karte);
    }
    const t = r.abrechnung.total;
    const teamA = tausch ? 1 : 0;
    diff += t[teamA] - t[1 - teamA];
  }
}
console.log(a, 'gegen', b, ': Ø Vorsprung pro Runde', (diff / (2 * N)).toFixed(1), 'Punkte');
if (zuege) console.log('schwer: Ø', (zeit / zuege).toFixed(0), 'ms pro Zug, langsamster', langsamste, 'ms');
