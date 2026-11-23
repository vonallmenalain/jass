'use strict';
// Rechnet eine exportierte Partie (verlauf.html → «Als Datei») nach.
//
//   node werkzeuge/analyse.js partie.json             Übersicht
//   node werkzeuge/analyse.js partie.json 3           Runde 3 mit allen Stichen
//   node werkzeuge/analyse.js partie.json 3 5         Runde 3, Stich 5: jeden Zug
//                                                     nachrechnen
//
// Für jeden Zug: was erlaubt war, was gespielt wurde und warum, was die
// Faustregel (Mittel) heute sagt, was «Schwer» mit vielen Verteilungen
// rechnet – und, wenn nur noch wenige Karten im Spiel sind, was mit allen
// Karten offen das Beste gewesen wäre.
const fs = require('fs');
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const [datei, rundeArg, stichArg] = process.argv.slice(2);
if (!datei) { console.error('Aufruf: node werkzeuge/analyse.js partie.json [runde] [stich]'); process.exit(1); }
const p = JSON.parse(fs.readFileSync(datei, 'utf8'));
if (p.format !== 'jass-partie') { console.error('Keine Jass-Partie.'); process.exit(1); }

const name = (s) => p.spieler[s].name + (p.spieler[s].typ !== 'mensch' ? ' (' + p.spieler[s].typ + ')' : '');
const kurz = (k) => J.kurzName(k);
const modus = (c) => (c === 'SCHIEBEN' ? 'Schieben' : J.MODI[c].lang);

if (!rundeArg) {
  console.log(`Partie vom ${new Date(p.start).toLocaleString('de-CH')} – Rechentiefe ${p.rechnen}`);
  console.log('Spieler:', p.spieler.map((x, s) => `${s}: ${name(s)}`).join(', '));
  for (const r of p.runden) {
    const ab = r.abrechnung;
    console.log(`Runde ${r.nr + 1}: ${r.ansagen.map((a) => name(a.s) + ' → ' + modus(a.wahl)).join(', ')}${ab ? ` · ${ab.total[0]} : ${ab.total[1]}` : ''}`);
  }
  for (const n of p.notizen || []) console.log(`🚩 Runde ${n.runde + 1}${n.stich != null ? ', Stich ' + (n.stich + 1) : ''}: ${n.text}`);
  process.exit(0);
}

const r = p.runden.find((x) => x.nr === Number(rundeArg) - 1);
if (!r) { console.error('Diese Runde gibt es nicht.'); process.exit(1); }

// Den Stand der Runde nachbauen: dieselben Karten, dieselben Ansagen.
function aufbauen(bisZug) {
  const spiel = J.neuesSpiel(p.regeln, { haende: r.haende, ersterAnsager: r.ansager, seed: 1 });
  for (const a of r.ansagen) {
    if (a.wahl === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, a.wahl);
  }
  for (let i = 0; i < bisZug; i++) J.spiele(spiel, r.zuege[i].s, r.zuege[i].k);
  return spiel;
}

const code = (r.ansagen.find((a) => a.wahl !== 'SCHIEBEN') || {}).wahl;
console.log(`Runde ${r.nr + 1} · ${modus(code)}`);
for (let s = 0; s < 4; s++) console.log(`  ${name(s).padEnd(18)} ${J.sortiereHand(r.haende[s], code).map(kurz).join(' ')}`);
for (const a of r.ansagen) console.log(`  Ansage ${name(a.s)}: ${modus(a.wahl)}${a.grund ? ' – ' + a.grund : ''}${a.werte ? ' [' + a.werte.map((w) => modus(w.c) + ' ' + w.p).join(', ') + ']' : ''}`);

if (!stichArg) {
  let i = 0;
  for (let st = 0; st < 9; st++) {
    const zuege = r.zuege.filter((z) => z.stich === st);
    if (!zuege.length) break;
    console.log(`Stich ${st + 1}: ${zuege.map((z) => name(z.s) + ' ' + kurz(z.k)).join(', ')}`);
    for (const z of zuege) if (z.grund) console.log(`    ${name(z.s)}: ${z.grund}`);
    i += zuege.length;
  }
  for (const n of (p.notizen || []).filter((x) => x.runde === r.nr)) console.log(`🚩 Stich ${n.stich != null ? n.stich + 1 : '-'}: ${n.text}`);
  process.exit(0);
}

const stich = Number(stichArg) - 1;
const start = r.zuege.findIndex((z) => z.stich === stich);
if (start < 0) { console.error('Diesen Stich gibt es nicht.'); process.exit(1); }
for (let i = start; i < r.zuege.length && r.zuege[i].stich === stich; i++) {
  const z = r.zuege[i];
  const spiel = aufbauen(i);
  const runde = spiel.runde;
  const legal = J.erlaubteFuer(spiel, z.s);
  console.log(`\n── ${name(z.s)} – Stich ${stich + 1}, Karte ${runde.stich.length + 1}`);
  console.log(`   im Stich: ${runde.stich.map((k, j) => name(runde.stichSitze[j]) + ' ' + kurz(k)).join(', ') || '(spielt aus)'}`);
  console.log(`   Hand:     ${J.sortiereHand(runde.haende[z.s], code).map(kurz).join(' ')}`);
  console.log(`   erlaubt:  ${legal.map(kurz).join(' ')}`);
  console.log(`   gespielt: ${kurz(z.k)}${z.grund ? ' – ' + z.grund : ''}`);
  if (z.werte) console.log(`   damals:   ${z.werte.map((w) => kurz(w.k) + ' ' + w.w).join(', ')}`);
  const m = B.mittelZug(B.ansichtAus(spiel, z.s));
  console.log(`   Mittel:   ${kurz(m.karte)} – ${m.grund}`);
  const sch = B.schwerZug(spiel, z.s, { welten: 1000, weltenExakt: 200, rng: J.zufall(7) });
  if (sch.werte) console.log(`   Schwer:   ${sch.werte.map((w) => kurz(w.karte) + ' ' + w.wert.toFixed(1)).join(', ')}  (1000 Verteilungen)`);
  const offen = B.offenBewerten(spiel, z.s, 20);
  if (offen) console.log(`   offen:    ${offen.map((w) => kurz(w.karte) + ' ' + w.wert).join(', ')}  (alle Karten sichtbar, perfektes Spiel)`);
}
