'use strict';
// Stimmen die Prozente der Annahmen? («Ich nehme an, Clara hat den
// Herz-König (80 %)») – Eichung der Kartenschätzung.
//
//   node werkzeuge/annahmen-eichung.js <spiele> [start=0] > zeilen.jsonl
//   node werkzeuge/annahmen-eichung.js --auswerten zeilen.jsonl …
//
// Der Computer spielt gegen sich selbst (alle Schwer, schnell). Vor jedem Zug
// zieht der Spieler am Zug die Verteilungen wie bei «Maximal» (4000
// Kandidaten, gewichtet nach den Zügen der anderen) und schätzt für jeden
// anderen Spieler und jede Farbe: Hat er die höchste offene Karte? Hat er
// die Farbe nicht mehr? Weil die Karten bekannt sind, lässt sich zählen, wie
// oft das stimmt. Die Gewichte werden mit einer Temperatur t gedämpft
// (exp(t · log L)); t = 1 ist das volle Modell, t = 0 nur Ansage und Regeln.
//
// Auswertung: Log-Verlust und Brier-Wert je t über alle Aussagen, dazu die
// Aussagen, die die App zeigen würde (≥ 60 % und um ≥ 25 Punkte verschoben):
// wie sicher sie klingen und wie oft sie stimmen.
//
// Ergebnis (24.11.2026, 120 Partien, 55 491 Aussagen):
//   t = 1    Log-Verlust 0,520 · gezeigt 4672: klingen 84 %, stimmen 81 %
//   t = 0,7  Log-Verlust 0,522 · gezeigt 2368: klingen 82 %, stimmen 86 %
//   t = 0,5  Log-Verlust 0,530 · gezeigt  979: klingen 81 %, stimmen 93 %
//   t = 0    Log-Verlust 0,577 (nur Ansage und Regeln)
// → Anzeige mit t = 0,7 (ANNAHMEN_TEMPERATUR), Spielen mit vollem Gewicht.
const fs = require('fs');
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const TEMPERATUREN = [1, 0.7, 0.5, 0.35, 0.25, 0.15, 0];

function erzeugen(N, START) {
  const regeln = J.regelnMitStandard();
  for (let i = START; i < START + N; i++) {
    const spiel = J.neuesSpiel(regeln, { seed: 880000 + i, ersterAnsager: i % 4 });
    const r = spiel.runde;
    const rngA = J.zufall(i);
    while (r.phase === 'ansage') {
      const s = J.ansageAmZug(r);
      const w = B.waehleAnsage(spiel, s, 'schwer', Object.assign({ rng: rngA }, B.rechentiefe('schnell')));
      if (w.code === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, w.code);
    }
    const rng = J.zufall(i * 31 + 7);
    const zeilen = [];
    while (r.phase === 'spiel') {
      const sitz = r.amZug;
      const sw = B.schaetzungsWelten(spiel, sitz, { rng, welten: 1000, schaetzungFaktor: 4 });
      if (sw.zuege.length) zeilen.push(...aussagen(spiel, sitz, sw));
      const z = B.schwerZug(spiel, sitz, Object.assign({ rng, annahmen: false }, B.rechentiefe('schnell')));
      J.spiele(spiel, sitz, z.karte);
    }
    process.stdout.write(zeilen.map((z) => JSON.stringify(z)).join('\n') + (zeilen.length ? '\n' : ''));
    process.stderr.write(`Spiel ${i}: ${r.code}, ${zeilen.length} Aussagen\n`);
  }
}

function aussagen(spiel, sitz, sw) {
  const r = spiel.runde;
  const eff = J.effModus(r.code, r.stichNr);
  const { kand, lw, w } = sw;
  const K = kand.length;
  const max = Math.max(...lw);
  const gewichte = TEMPERATUREN.map((t) => lw.map((x) => Math.exp(t * (x - max))));
  const summen = gewichte.map((g) => g.reduce((a, b) => a + b, 0));
  // wirksame Anzahl Verteilungen je Temperatur
  const ess = gewichte.map((g, j) => Math.round((summen[j] * summen[j]) / g.reduce((a, b) => a + b * b, 0)));
  const meine = r.haende[sitz];
  const out = [];
  for (let f = 0; f < 4; f++) {
    let top = -1, topS = -1;
    for (let x = f * 9; x < f * 9 + 9; x++) {
      if (w.gespielt[x] || meine.includes(x) || r.stich.includes(x)) continue;
      if (J.STAERKE[eff][x] > topS) { topS = J.STAERKE[eff][x]; top = x; }
    }
    for (let q = 0; q < 4; q++) {
      if (q === sitz) continue;
      const pruefe = [];
      if (top >= 0) pruefe.push(['hoch', (h) => h[q].includes(top)]);
      if (!(w.leer[q] & (1 << f))) pruefe.push(['leer', (h) => !h[q].some((k) => J.farbeVon(k) === f)]);
      for (const [art, test] of pruefe) {
        const ind = kand.map((h) => (test(h) ? 1 : 0));
        const p0 = ind.reduce((a, b) => a + b, 0) / K;
        if (p0 > 0.95 || p0 < 0.05) continue;
        const p = gewichte.map((g, j) => Math.round((1000 * g.reduce((a, gi, i) => a + gi * ind[i], 0)) / summen[j]) / 1000);
        out.push({ art, c: r.code, n: r.stichNr, p, y: test(r.haende) ? 1 : 0, ess });
      }
    }
  }
  return out;
}

function auswerten(dateien) {
  const zeilen = [];
  for (const d of dateien) for (const z of fs.readFileSync(d, 'utf8').split('\n')) if (z.trim()) zeilen.push(JSON.parse(z));
  console.log(`${zeilen.length} Aussagen`);
  const eps = 1e-3;
  const p0 = (z) => z.p[TEMPERATUREN.indexOf(0)];
  TEMPERATUREN.forEach((t, j) => {
    let ll = 0, br = 0;
    for (const z of zeilen) {
      const p = Math.min(1 - eps, Math.max(eps, z.p[j]));
      ll += -(z.y * Math.log(p) + (1 - z.y) * Math.log(1 - p));
      br += (z.p[j] - z.y) ** 2;
    }
    // was die App zeigen würde: «hat» / «hat nicht» / «keine … mehr»
    let n = 0, sicher = 0, stimmt = 0;
    for (const z of zeilen) {
      const p = z.p[j], d = p - p0(z);
      let behauptet = null;
      if (z.art === 'hoch' && p >= 0.6 && d >= 0.25) behauptet = { q: p, wahr: z.y === 1 };
      else if (z.art === 'hoch' && p <= 0.2 && -d >= 0.25) behauptet = { q: 1 - p, wahr: z.y === 0 };
      else if (z.art === 'leer' && p >= 0.6 && d >= 0.25) behauptet = { q: p, wahr: z.y === 1 };
      if (!behauptet) continue;
      n++; sicher += behauptet.q; stimmt += behauptet.wahr ? 1 : 0;
    }
    const essM = zeilen.reduce((a, z) => a + z.ess[j], 0) / zeilen.length;
    console.log(`t = ${String(t).padEnd(4)} Log-Verlust ${(ll / zeilen.length).toFixed(4)} · Brier ${(br / zeilen.length).toFixed(4)} · wirksam Ø ${Math.round(essM)} · gezeigt ${n}: klingen ${n ? (100 * sicher / n).toFixed(0) : '–'} %, stimmen ${n ? (100 * stimmt / n).toFixed(0) : '–'} %`);
  });
  // Eichkurve für t = 1 und das beste t (nach Log-Verlust)
  const bins = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95, 1.01];
  for (const t of [1, 0.5, 0.35, 0.25]) {
    const j = TEMPERATUREN.indexOf(t);
    const zeile = [];
    let lo = 0;
    for (const hi of bins) {
      const g = zeilen.filter((z) => z.p[j] >= lo && z.p[j] < hi);
      if (g.length) zeile.push(`${Math.round(lo * 100)}–${Math.round(Math.min(hi, 1) * 100)} %: ${(100 * g.reduce((a, z) => a + z.y, 0) / g.length).toFixed(0)} % (${g.length})`);
      lo = hi;
    }
    console.log(`  t = ${t}: ${zeile.join(' · ')}`);
  }
}

const args = process.argv.slice(2);
if (args[0] === '--auswerten') auswerten(args.slice(1));
else erzeugen(Number(args[0] || 5), Number(args[1] || 0));
