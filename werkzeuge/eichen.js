'use strict';
// Eicht die Faustregel-Gewichte in jass-bot.js (GEWICHT) an Monte-Carlo-
// Werten: viele zufällige Hände, jede Ansage oft durchgespielt, dann eine
// lineare Regression der Merkmale auf die erzielten Punkte.
//   node werkzeuge/eichen.js [haende] [welten]
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const N = Number(process.argv[2] || 400);
const W = Number(process.argv[3] || 40);
const regeln = J.regelnMitStandard();
const rng = J.zufall(20261123);

function loese(X, y, lambda) {
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let i = 0; i < X.length; i++) for (let a = 0; a < n; a++) { b[a] += X[i][a] * y[i]; for (let c = 0; c < n; c++) A[a][c] += X[i][a] * X[i][c]; }
  for (let a = 1; a < n; a++) A[a][a] += lambda;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  return b.map((v, i) => v / A[i][i]);
}

const tX = [], tY = [], oX = [], oY = [], pushY = [], bestY = [];
const tKeys = Object.keys(B.merkmaleTrumpf([], 0));
const oKeys = Object.keys(B.merkmaleObe([], false));
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const deck = J.mische(Array.from({ length: 36 }, (_, k) => k), rng);
  const hand = deck.slice(0, 9);
  const b = B.bewertung(hand, regeln, { rng });
  b.schritt(W);
  const erg = b.ergebnis();
  for (const e of erg) {
    if (e.code === 'SCHIEBEN') { pushY.push(e.punkte); continue; }
    const info = J.MODI[e.code];
    if (info.trumpf >= 0) { const m = B.merkmaleTrumpf(hand, info.trumpf); tX.push([1, ...tKeys.map((k) => m[k])]); tY.push(e.punkte); }
    else if (e.code === 'OBE' || e.code === 'UNE') { const m = B.merkmaleObe(hand, e.code === 'UNE'); oX.push([1, ...oKeys.map((k) => m[k])]); oY.push(e.punkte); }
  }
  bestY.push(erg.filter((e) => e.code !== 'SCHIEBEN')[0].punkte);
}
const ms = Date.now() - t0;
const tw = loese(tX, tY, 1), ow = loese(oX, oY, 1);
const fmt = (keys, w) => '{ basis: ' + w[0].toFixed(1) + ', ' + keys.map((k, i) => k + ': ' + w[i + 1].toFixed(1)).join(', ') + ' }';
console.log('Zeit', ms, 'ms für', N, 'Hände ×', W, 'Welten');
console.log('trumpf:', fmt(tKeys, tw));
console.log('obe:   ', fmt(oKeys, ow));
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
console.log('Ø Schieben:', avg(pushY).toFixed(1), ' Ø beste eigene Ansage:', avg(bestY).toFixed(1));
const r2 = (X, y, w) => { const m = avg(y); let ss = 0, sr = 0; X.forEach((x, i) => { const p = x.reduce((s, v, j) => s + v * w[j], 0); ss += (y[i] - m) ** 2; sr += (y[i] - p) ** 2; }); return 1 - sr / ss; };
console.log('R² trumpf', r2(tX, tY, tw).toFixed(3), ' R² obe', r2(oX, oY, ow).toFixed(3));

// Schwelle fürs Schieben: Bei welcher Faustregel-Schätzung lohnt es sich?
if (process.argv[4] === 'schwelle') {
  const daten = [];
  const rng2 = J.zufall(77);
  for (let i = 0; i < N; i++) {
    const deck = J.mische(Array.from({ length: 36 }, (_, k) => k), rng2);
    const hand = deck.slice(0, 9);
    const b = B.bewertung(hand, regeln, { rng: rng2 });
    b.schritt(W);
    const erg = b.ergebnis();
    const h = B.heuristikAnsage(hand, regeln, false);
    daten.push({ h: h.punkte, push: erg.find((e) => e.code === 'SCHIEBEN').diff, eigen: erg.find((e) => e.code === h.code).diff, best: erg[0].diff });
  }
  let beste = null;
  for (let t = 60; t <= 110; t += 1) {
    const m = avg(daten.map((d) => (d.h < t ? d.push : d.eigen)));
    if (!beste || m > beste.m) beste = { t, m };
  }
  console.log('Schwelle', beste.t, 'Ø Differenz', beste.m.toFixed(2), ' (ohne Schieben', avg(daten.map((d) => d.eigen)).toFixed(2), ', perfekt', avg(daten.map((d) => d.best)).toFixed(2), ')');
}
