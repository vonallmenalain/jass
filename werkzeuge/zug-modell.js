'use strict';
// Trainiert das Modell der Kartenschätzung (Softmax über die erlaubten
// Karten, Merkmale aus jass-bot.js: MERKMALE / zugMerkmale) auf den Daten
// von werkzeuge/zug-daten.js.
//
//   node werkzeuge/zug-modell.js <daten.jsonl …> [--runden 30] [--aus werkzeuge/zug-modell.json]
//
// Ausgabe: Trefferquote und mittlere Log-Wahrscheinlichkeit auf 10 %
// zurückgehaltenen Daten (gegen «zufällig unter den erlaubten Karten»),
// die Gewichte als JSON.
const fs = require('fs');
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const args = process.argv.slice(2);
const opt = (name, std) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : std; };
const dateien = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const RUNDEN = Number(opt('runden', 30));
const AUS = opt('aus', 'werkzeuge/zug-modell.json');
const regeln = J.regelnMitStandard();
const D = B.MERKMALE.length;

// Jeder Zug → Merkmal-Matrix der erlaubten Karten und Index der gespielten.
const faelle = [];
for (const d of dateien) {
  for (const zeile of fs.readFileSync(d, 'utf8').split('\n')) {
    if (!zeile.trim()) continue;
    const z = JSON.parse(zeile);
    const g = new Uint8Array(36);
    for (const k of z.g) g[k] = 1;
    const lage = { code: z.c, stichNr: z.n, stich: z.st, stichSitze: z.ss, sitz: z.s, gespielt: g };
    const legal = J.erlaubteKarten(z.h, z.st, J.effModus(z.c, z.n), regeln);
    if (legal.length < 2 || !legal.includes(z.k)) continue;
    const X = legal.map((k) => B.zugMerkmale(k, z.h, lage));
    faelle.push({ X, y: legal.indexOf(z.k) });
  }
}
// gemischt aufteilen
const rng = J.zufall(42);
for (let i = faelle.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [faelle[i], faelle[j]] = [faelle[j], faelle[i]]; }
const nTest = Math.floor(faelle.length * 0.1);
const test = faelle.slice(0, nTest), train = faelle.slice(nTest);
console.log(`${faelle.length} Züge (${train.length} Training, ${test.length} Test), ${D} Merkmale`);

function auswerten(w, liste) {
  let ll = 0, treffer = 0, zufall = 0;
  for (const f of liste) {
    const z = f.X.map((x) => { let s = 0; for (let i = 0; i < D; i++) s += w[i] * x[i]; return s; });
    const m = Math.max(...z);
    const lse = m + Math.log(z.reduce((a, v) => a + Math.exp(v - m), 0));
    ll += z[f.y] - lse;
    if (z.indexOf(m) === f.y) treffer++;
    zufall += -Math.log(f.X.length);
  }
  return { ll: ll / liste.length, treffer: treffer / liste.length, zufall: zufall / liste.length };
}

// Adam auf der Log-Likelihood, L2 klein
const w = new Float64Array(D), mo = new Float64Array(D), ve = new Float64Array(D);
const LR = 0.05, L2 = 1e-4, BATCH = 256;
let t = 0;
for (let runde = 1; runde <= RUNDEN; runde++) {
  for (let i = train.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [train[i], train[j]] = [train[j], train[i]]; }
  for (let b = 0; b < train.length; b += BATCH) {
    const grad = new Float64Array(D);
    const ende = Math.min(train.length, b + BATCH);
    for (let n = b; n < ende; n++) {
      const f = train[n];
      const z = f.X.map((x) => { let s = 0; for (let i = 0; i < D; i++) s += w[i] * x[i]; return s; });
      const m = Math.max(...z);
      const e = z.map((v) => Math.exp(v - m));
      const sum = e.reduce((a, v) => a + v, 0);
      for (let c = 0; c < f.X.length; c++) {
        const p = e[c] / sum - (c === f.y ? 1 : 0);
        for (let i = 0; i < D; i++) grad[i] += p * f.X[c][i];
      }
    }
    t++;
    for (let i = 0; i < D; i++) {
      const gi = grad[i] / (ende - b) + L2 * w[i];
      mo[i] = 0.9 * mo[i] + 0.1 * gi;
      ve[i] = 0.999 * ve[i] + 0.001 * gi * gi;
      const mh = mo[i] / (1 - Math.pow(0.9, t)), vh = ve[i] / (1 - Math.pow(0.999, t));
      w[i] -= (LR / Math.sqrt(runde)) * mh / (Math.sqrt(vh) + 1e-8);
    }
  }
  if (runde % 5 === 0 || runde === RUNDEN) {
    const a = auswerten(w, test);
    console.log(`Runde ${runde}: Test – Treffer ${(100 * a.treffer).toFixed(1)} %, Ø log P ${a.ll.toFixed(3)} (zufällig ${a.zufall.toFixed(3)})`);
  }
}
const gewichte = Array.from(w, (x) => Math.round(x * 1000) / 1000);
fs.writeFileSync(AUS, JSON.stringify({ merkmale: B.MERKMALE, gewichte }, null, 1) + '\n');
console.log('Gewichte → ' + AUS);
B.MERKMALE.forEach((m, i) => console.log(`  ${m.padEnd(30)} ${gewichte[i] >= 0 ? '+' : ''}${gewichte[i].toFixed(2)}`));
