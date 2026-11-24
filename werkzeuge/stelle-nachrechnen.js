'use strict';
// Eine Stelle aus einer gespielten Partie nachrechnen (z. B. zu einer 🚩-Notiz).
//
//   node werkzeuge/stelle-nachrechnen.js <partie.json> <stich> <sitz> [welten=200] [tiefe=normal] [karten]
//
//   partie.json  eine exportierte Partie (Gespielte Partien → Herunterladen)
//   stich        1–9, wie in der App angezeigt;  sitz  0 Du, 1 Anna, 2 Ben, 3 Clara
//   karten       Kandidaten als Kartennummern (0–35), sonst alle erlaubten
//
// 1) Die Rechnung des Computers (wie im Spiel, Rechentiefe maximal), 3×.
// 2) Zu Ende gespielt: `welten` Verteilungen, die zu dem passen, was der Sitz
//    weiss; je Kandidat die Karte legen, dann spielen alle vier Computer
//    (schwer, Tiefe `tiefe`) zu Ende. Dieselben Verteilungen für alle
//    Kandidaten – der Unterschied ist gepaart (± Standardfehler).
// 3) Die echte Verteilung: je Kandidat 16 Durchgänge.
//
// Warum beides: Die Rechnung spielt jede Verteilung mit einfachen
// Faustregeln zu Ende und liegt damit manchmal daneben (Trumpf ziehen, Dame
// vor Ass) – das Zu-Ende-Spielen mit dem vollen Computer ist näher am Spiel.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');
const kurz = (k) => 'SHKE'[Math.floor(k / 9)] + ['6', '7', '8', '9', '10', 'B', 'D', 'K', 'A'][k % 9];

function aufbauen(p, stich, sitz) {
  const r = p.runden[0];
  const spiel = J.neuesSpiel(p.regeln, { haende: r.haende, ersterAnsager: r.ansager });
  for (const a of r.ansagen) { if (a.wahl === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, a.wahl); }
  for (const z of r.zuege) {
    if (z.stich === stich && z.s === sitz) break;
    J.spiele(spiel, z.s, z.k);
  }
  if (spiel.runde.amZug !== sitz) throw new Error('Sitz nicht am Zug');
  return spiel;
}

function zuEnde(spiel, tiefe) {
  const t = B.rechentiefe(tiefe);
  while (spiel.runde.phase !== 'ende') {
    const s = spiel.runde.amZug;
    J.spiele(spiel, s, B.waehleKarte(spiel, s, 'schwer', t).karte);
  }
  return spiel.runde.abrechnung.total;
}

function mitHaenden(spiel, haende) {
  const x = JSON.parse(JSON.stringify(spiel));
  x.runde.haende = haende.map((h) => h.slice());
  const gespielt = [[], [], [], []];
  for (const st of x.runde.stiche) st.karten.forEach((k, i) => gespielt[st.sitze[i]].push(k));
  x.runde.stich.forEach((k, i) => gespielt[x.runde.stichSitze[i]].push(k));
  x.runde.startHaende = haende.map((h, s) => h.concat(gespielt[s]));
  return x;
}

if (!isMainThread) {
  const { p, stich, sitz, auftraege, tiefe } = workerData;
  const basis = aufbauen(p, stich, sitz);
  for (const a of auftraege) {
    const s = mitHaenden(basis, a.haende);
    J.spiele(s, sitz, a.karte);
    const total = zuEnde(s, tiefe);
    parentPort.postMessage({ i: a.i, karte: a.karte, wert: total[sitz % 2] });
  }
  parentPort.postMessage({ fertig: true });
  return;
}

const [datei, stichArg, sitz, nW = 200, tiefe = 'normal', kandArg] = process.argv.slice(2);
const stich = Number(stichArg) - 1;
const p = JSON.parse(require('fs').readFileSync(datei, 'utf8'));
const spiel = aufbauen(p, Number(stich), Number(sitz));
const S = Number(sitz);
console.log(`Partie ${p.id}, Stich ${Number(stich) + 1}, ${['Du', 'Anna', 'Ben', 'Clara'][S]} hat: ` + spiel.runde.haende[S].map(kurz).join(' ') + (spiel.runde.stich.length ? ' · im Stich: ' + spiel.runde.stich.map(kurz).join(' ') : ''));
// 1) PIMC
for (let i = 0; i < 3; i++) {
  const z = B.schwerZug(spiel, S, B.rechentiefe('maximal'));
  console.log('PIMC (maximal): wählt ' + kurz(z.karte) + ' · ' + z.werte.map((w) => kurz(w.karte) + ' ' + (w.wert / 2).toFixed(1)).join(', ') + '   (Werte: halber Vorsprung ≈ eigene Punkte über 78,5)');
}
const legal = J.erlaubteFuer(spiel, S);
const kand = kandArg ? kandArg.split(',').map(Number) : legal;
// 2) Welten wie der Bot
const w = B.wissen(spiel, S, { zeichen: true });
const info = B.ansageWissen(spiel, S, w);
const rng = J.zufall(12345);
const welten = [];
for (let i = 0; i < Number(nW); i++) {
  let h = null;
  for (let v = 0; v < 120 && !h; v++) { const x = B.welt(spiel, S, w, rng); if (!info || B.passtZumWissen(x, spiel.regeln, info, v >= 70)) h = x; }
  welten.push(h || B.welt(spiel, S, w, rng));
}
const auftraege = [];
welten.forEach((h, i) => kand.forEach((k) => auftraege.push({ i, karte: k, haende: h })));
// 3) echte Verteilung, 16× je Kandidat
for (let j = 0; j < 16; j++) kand.forEach((k) => auftraege.push({ i: 'echt' + j, karte: k, haende: spiel.runde.haende }));
const N = 4, teile = [...Array(N)].map(() => []);
auftraege.forEach((a, i) => teile[i % N].push(a));
const erg = new Map(kand.map((k) => [k, { welt: [], echt: [] }]));
let offen = N; const t0 = Date.now(); let n = 0;
for (const t of teile) {
  const wk = new Worker(__filename, { workerData: { p, stich: Number(stich), sitz: S, auftraege: t, tiefe } });
  wk.on('message', (m) => {
    if (m.fertig) {
      if (--offen) return;
      const mw = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const sd = (a) => Math.sqrt(a.reduce((x, y) => x + (y - mw(a)) ** 2, 0) / (a.length - 1));
      // gepaarter Vergleich gegen den ersten Kandidaten
      const k0 = kand[0];
      console.log(`\nAusgespielt mit Bots (Tiefe ${tiefe}), ${nW} passende Verteilungen · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      for (const k of kand) {
        const e = erg.get(k);
        const diff = e.welt.map((x, i) => x - erg.get(k0).welt[i]);
        console.log(`  ${kurz(k).padEnd(4)} Ø ${mw(e.welt).toFixed(1)} Punkte` + (k !== k0 ? `  (gegenüber ${kurz(k0)}: ${mw(diff) >= 0 ? '+' : ''}${mw(diff).toFixed(1)} ± ${(sd(diff) / Math.sqrt(diff.length)).toFixed(1)})` : '') + `   · echte Verteilung Ø ${mw(e.echt).toFixed(1)} (${Math.min(...e.echt)}–${Math.max(...e.echt)})`);
      }
      return;
    }
    n++;
    const e = erg.get(m.karte);
    if (String(m.i).startsWith('echt')) e.echt.push(m.wert); else e.welt[m.i] = m.wert;
  });
}
