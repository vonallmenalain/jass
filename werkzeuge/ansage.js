'use strict';
// Was bringt es, dass «Schwer» nur Kartenverteilungen durchspielt, die zu
// Ansage und Schieben passen?
//
//   node werkzeuge/ansage.js duell 250 [start] [tiefe]
//       Team A: Schwer wie in der App, Team B: Schwer mit gleich verteilten
//       Welten (ansageBeachten: false). Angesagt wird bei beiden gleich
//       («Schwer»). Jede Verteilung zweimal, mit vertauschten Plätzen.
//
//   node werkzeuge/ansage.js partie <datei.json> <runde> <stich>
//       Rechnet einen Zug einer gespeicherten Partie beide Male nach.
const fs = require('fs');
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const [befehl = 'duell', ...rest] = process.argv.slice(2);

if (befehl === 'duell') {
  const [nStr = '100', startStr = '0', tiefe = 'schnell'] = rest;
  const N = Number(nStr), START = Number(startStr);
  const mit = B.rechentiefe(tiefe);
  const ohne = Object.assign({}, mit, { ansageBeachten: false });
  const diffs = [];
  let zeit = 0, zuege = 0;
  for (let i = START; i < START + N; i++) {
    let d = 0;
    for (const tausch of [false, true]) {
      const spiel = J.neuesSpiel({ runden: 1 }, { seed: 120000 + i });
      const r = spiel.runde;
      const rng = J.zufall(i * 7 + (tausch ? 1 : 0));
      while (r.phase === 'ansage') {
        const s = J.ansageAmZug(r);
        const w = B.waehleAnsage(spiel, s, 'schwer', Object.assign({ rng }, mit));
        if (w.code === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, w.code);
      }
      while (r.phase === 'spiel') {
        const s = r.amZug;
        const a = (s % 2 === 0) !== tausch;
        const t0 = Date.now();
        J.spiele(spiel, s, B.schwerZug(spiel, s, Object.assign({ rng }, a ? mit : ohne)).karte);
        if (a) { zeit += Date.now() - t0; zuege++; }
      }
      const t = r.abrechnung.total;
      const a = tausch ? 1 : 0;
      d += t[a] - t[1 - a];
    }
    diffs.push(d / 2);
  }
  const m = diffs.reduce((x, y) => x + y, 0) / N;
  const sd = Math.sqrt(diffs.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, N - 1));
  console.log(JSON.stringify({ n: N, start: START, tiefe, vorsprung: +m.toFixed(2), fehler: +(sd / Math.sqrt(N)).toFixed(2), msProZug: +(zeit / Math.max(1, zuege)).toFixed(1) }));
} else if (befehl === 'partie') {
  const [datei, rundeStr = '1', stichStr = '1'] = rest;
  const p = JSON.parse(fs.readFileSync(datei, 'utf8'));
  const r0 = p.runden[Number(rundeStr) - 1];
  const regeln = J.regelnMitStandard(p.regeln);
  const spiel = J.neuesSpiel(regeln, { haende: r0.haende.map((h) => h.slice()), ersterAnsager: r0.ansager });
  for (const a of r0.ansagen) { if (a.wahl === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, a.wahl); }
  const ziel = Number(stichStr) - 1;
  const zuege = r0.zuege.slice();
  while (zuege.length && spiel.runde.stichNr < ziel) { const z = zuege.shift(); J.spiele(spiel, z.s, z.k); }
  const s = spiel.runde.amZug;
  const name = (k) => J.kartenName(k, spiel.runde.code);
  for (const [titel, o] of [['gleich verteilt', { ansageBeachten: false }], ['passend zur Ansage', {}]]) {
    const z = B.schwerZug(spiel, s, Object.assign({ rng: J.zufall(7), welten: 2000 }, o));
    console.log(titel + ':', name(z.karte), '·', z.werte.map((x) => name(x.karte) + ' ' + (x.wert / 2 + 78.5).toFixed(1)).join(', '));
  }
}
