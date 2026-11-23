'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');
const P = require('../jass-protokoll.js');

// Spielt ein ganzes Spiel mit offenen Karten (die "Wahrheit") und schreibt
// dabei das Protokoll, wie es online in der Datenbank stünde.
function spieleMitProtokoll(regeln, seed) {
  const rng = J.zufall(seed);
  const log = [];
  const handVerlauf = [];
  let wahr = null;
  let erster = -1;
  for (let nr = 0; ; nr++) {
    const { haende, ansager } = P.austeilen(regeln, nr, erster, rng, 0);
    if (nr === 0) erster = ansager;
    handVerlauf.push(haende);
    log.push({ t: 'r', nr, a: ansager });
    if (!wahr) wahr = J.neuesSpiel(regeln, { haende, ersterAnsager: ansager, seed: 1 });
    else J.rundeAbschliessen(wahr, { haende });
    wahr.runde.ansager = ansager;
    wahr.runde.amZug = ansager;
    const r = wahr.runde;
    while (r.phase === 'ansage') {
      const s = J.ansageAmZug(r);
      const w = B.waehleAnsage(wahr, s, 'mittel', { rng });
      if (w.code === 'SCHIEBEN') { J.schieben(wahr); log.push({ t: 'p', s }); }
      else { J.ansagen(wahr, w.code); log.push({ t: 'a', s, c: w.code }); }
    }
    while (r.phase === 'spiel') {
      const s = r.amZug;
      const k = B.waehleKarte(wahr, s, 'mittel', { rng }).karte;
      log.push(P.kartenEreignis(wahr, s, k));
      J.spiele(wahr, s, k);
    }
    const letzte = P.istLetzteRunde(wahr);
    if (letzte) { J.rundeAbschliessen(wahr); break; }
  }
  return { wahr, log, handVerlauf };
}

const VARIANTEN = [
  { runden: 3 },
  { runden: 4, weisen: true, stoeck: true, matchBonus: true, multiplikatoren: true },
  { spielende: 'punkte', zielPunkte: 700, weisen: true, stoeck: true, modi: { T: true, OBE: true, UNE: true, SLO: true, MIS: true } },
  { runden: 2, ersterAnsager: 'zufall', ausspiel: 'ansager' },
];

test('Jedes Gerät kommt aus dem Protokoll zum selben Stand wie mit offenen Karten', () => {
  VARIANTEN.forEach((regeln, i) => {
    const { wahr, log, handVerlauf } = spieleMitProtokoll(regeln, 100 + i);
    const letzteNr = handVerlauf.length - 1;
    for (let sitz = 0; sitz < 4; sitz++) {
      // Das Gerät kennt nur seine eigene Hand der laufenden Runde.
      const haende = { [sitz]: { nr: letzteNr, karten: handVerlauf[letzteNr][sitz] } };
      const { spiel, fehler } = P.aufbauen(regeln, log, haende);
      assert.deepEqual(fehler, [], 'keine Fehler beim Nachspielen');
      assert.equal(spiel.fertig, true);
      assert.deepEqual(spiel.summe, wahr.summe, 'Variante ' + i + ', Sitz ' + sitz);
      assert.equal(spiel.sieger, wahr.sieger);
      assert.deepEqual(spiel.runden.map((x) => x.total), wahr.runden.map((x) => x.total));
      assert.deepEqual(spiel.runden.map((x) => x.weis), wahr.runden.map((x) => x.weis));
      assert.deepEqual(spiel.runden.map((x) => x.stoeck), wahr.runden.map((x) => x.stoeck));
    }
  });
});

test('Mitten im Spiel: Stand, wer dran ist, und die eigene Hand', () => {
  const { log, handVerlauf } = spieleMitProtokoll({ runden: 2 }, 7);
  // Bis zur Hälfte der ersten Runde
  const bisHier = log.slice(0, 1 + 1 + 18);
  const sitz = 2;
  const { spiel } = P.aufbauen({ runden: 2 }, bisHier, { [sitz]: { nr: 0, karten: handVerlauf[0][sitz] } });
  const r = spiel.runde;
  assert.equal(r.phase, 'spiel');
  const eigene = r.haende[sitz];
  assert.ok(eigene.every((k) => k >= 0), 'eigene Karten sind bekannt');
  const fremde = r.haende[(sitz + 1) % 4];
  assert.ok(fremde.every((k) => k === J.VERDECKT), 'fremde Karten sind verdeckt');
  const n = P.naechster(spiel);
  assert.equal(n.art, 'karte');
  assert.equal(n.sitz, r.amZug);
});

test('Ein Ereignis vom falschen Sitz wird übergangen, nicht übernommen', () => {
  const { log } = spieleMitProtokoll({ runden: 1 }, 9);
  const kaputt = log.slice(0, 3);
  const falsch = Object.assign({}, kaputt[2], { s: (kaputt[2].s + 1) % 4 });
  const { spiel, fehler } = P.aufbauen({ runden: 1 }, [kaputt[0], kaputt[1], falsch], {});
  assert.equal(fehler.length, 1);
  assert.equal(spiel.runde.stich.length, 0);
});

test('Erfundene Weise zählen nicht', () => {
  assert.equal(P.weisAusKarten([0, 1, 2]).punkte, 20);
  assert.equal(P.weisAusKarten([0, 1, 3]), null, 'keine Folge');
  assert.equal(P.weisAusKarten([0, 1, 2, 2]), null, 'doppelte Karte');
  assert.equal(P.weisAusKarten([5, 14, 23, 32]).punkte, 200, 'vier Bauern');
  assert.equal(P.weisAusKarten([0, 1, 2, 5, 14, 23, 32]), null, 'zwei Weise in einer Meldung');
});

test('Lücken und Objekte statt Listen (so liefert sie die Datenbank)', () => {
  const { log } = spieleMitProtokoll({ runden: 1 }, 11);
  const alsObjekt = {};
  log.forEach((ev, i) => { alsObjekt[String(i)] = ev; });
  const { spiel, fehler } = P.aufbauen({ runden: 1 }, alsObjekt, {});
  assert.deepEqual(fehler, []);
  assert.equal(spiel.fertig, true);
});
