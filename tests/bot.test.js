'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const { karte, W6, W7, W8, W9, W10, WB, WD, WK, WA } = J;
const S = 0, H = 1, K = 2, E = 3;

function spieleRunde(spiel, stufen, rng) {
  const r = spiel.runde;
  while (r.phase === 'ansage') {
    const s = J.ansageAmZug(r);
    const w = B.waehleAnsage(spiel, s, stufen[s], { rng, welten: 10 });
    if (w.code === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, w.code);
  }
  while (r.phase === 'spiel') {
    const s = r.amZug;
    const z = B.waehleKarte(spiel, s, stufen[s], { rng, welten: 6 });
    assert.ok(J.erlaubteFuer(spiel, s).includes(z.karte), 'erlaubte Karte');
    assert.equal(typeof z.grund, 'string');
    J.spiele(spiel, s, z.karte);
  }
}

test('Alle Stufen spielen in allen Modi nur erlaubte Karten', () => {
  const rng = J.zufall(1);
  const varianten = [
    {},
    { modi: { T: true, OBE: true, UNE: true, SLO: true, SLU: true, MIS: true }, weisen: true, stoeck: true, matchBonus: true, multiplikatoren: true },
    { untertrumpfen: true, puurFrei: false, schieben: false, ausspiel: 'ansager' },
    { modi: { T: false, OBE: false, UNE: false, MIS: true } },
    { modi: { T: false, OBE: false, UNE: false, SLO: true, SLU: true } },
  ];
  let i = 0;
  for (const regeln of varianten) {
    for (const stufen of [['leicht', 'mittel', 'schwer', 'mittel'], ['schwer', 'leicht', 'mittel', 'schwer']]) {
      const spiel = J.neuesSpiel(Object.assign({ runden: 2 }, regeln), { seed: 300 + i++ });
      while (!spiel.fertig) {
        spieleRunde(spiel, stufen, rng);
        J.rundeAbschliessen(spiel);
      }
    }
  }
});

test('Starke Herz-Hand: Herz Trumpf ist die beste Ansage', () => {
  const hand = [karte(H, WB), karte(H, W9), karte(H, WA), karte(H, WK), karte(H, W10), karte(S, WA), karte(K, WA), karte(E, W6), karte(S, W7)];
  const b = B.bewertung(hand, {}, { seed: 9 });
  b.schritt(60);
  const liste = b.ergebnis();
  assert.equal(liste[0].code, 'T1');
  assert.ok(liste[0].punkte > 110, 'viele Punkte erwartet, war ' + liste[0].punkte);
  assert.equal(B.heuristikAnsage(hand, J.regelnMitStandard(), true).code, 'T1');
});

test('Viele Asse: Obenabe, viele Sechser: Undenufe', () => {
  const asse = [karte(S, WA), karte(S, WK), karte(H, WA), karte(H, WK), karte(K, WA), karte(K, WK), karte(E, WA), karte(E, W7), karte(E, W6)];
  assert.equal(B.heuristikAnsage(asse, J.regelnMitStandard(), true).code, 'OBE');
  const sechser = [karte(S, W6), karte(S, W7), karte(H, W6), karte(H, W7), karte(K, W6), karte(K, W7), karte(E, W6), karte(E, WA), karte(E, WK)];
  assert.equal(B.heuristikAnsage(sechser, J.regelnMitStandard(), true).code, 'UNE');
});

test('Schwache Hand: schieben', () => {
  const hand = [karte(S, W8), karte(S, WD), karte(H, W8), karte(H, WD), karte(K, W9), karte(K, WB), karte(E, W8), karte(E, W9), karte(E, WD)];
  assert.equal(B.heuristikAnsage(hand, J.regelnMitStandard(), true).code, 'SCHIEBEN');
  assert.notEqual(B.heuristikAnsage(hand, J.regelnMitStandard(), false).code, 'SCHIEBEN');
});

test('Bewertung kennt Schieben nur, wenn erlaubt', () => {
  const hand = J.verteile(J.zufall(4))[0];
  assert.ok(B.bewertung(hand, {}, {}).optionen.includes('SCHIEBEN'));
  assert.ok(!B.bewertung(hand, {}, { geschoben: true }).optionen.includes('SCHIEBEN'));
  assert.ok(!B.bewertung(hand, { schieben: false }, {}).optionen.includes('SCHIEBEN'));
});

test('Schmieren: Partner sticht sicher, also Punkte zugeben', () => {
  // Obenabe; ich (Sitz 0) kann Schaufel nicht angeben.
  const spiel = J.neuesSpiel({ ersterAnsager: 'sitz0' }, { seed: 1 });
  const r = spiel.runde;
  r.code = 'OBE'; r.phase = 'spiel'; r.angesagtVon = 0; r.ausspieler = 2;
  r.haende = [[karte(H, W10), karte(H, W6), karte(K, W7)], [karte(S, W7), karte(H, WA)], [], []];
  // Sitz 1 spielt König, Partner (Sitz 2) übernimmt mit dem Ass, ich bin Letzter.
  r.stich = [karte(S, WK), karte(S, WA), karte(S, W6)]; r.stichSitze = [1, 2, 3]; r.amZug = 0;
  const z = B.mittelZug(B.ansichtAus(spiel, 0));
  assert.equal(z.karte, karte(H, W10));
  assert.match(z.grund, /Schmieren/);
});

test('Wissen: wer eine Farbe nicht angibt, hat sie nicht mehr', () => {
  const spiel = J.neuesSpiel({ ersterAnsager: 'sitz0' }, { seed: 21 });
  J.ansagen(spiel, 'OBE');
  const r = spiel.runde;
  const rng = J.zufall(5);
  for (let i = 0; i < 8; i++) {
    const s = r.amZug;
    const erlaubt = J.erlaubteFuer(spiel, s);
    J.spiele(spiel, s, erlaubt[Math.floor(rng() * erlaubt.length)]);
  }
  const w = B.wissen(spiel, 0);
  for (const st of r.stiche) {
    const led = J.farbeVon(st.karten[0]);
    st.karten.forEach((k, i) => {
      if (J.farbeVon(k) !== led) assert.ok(w.leer[st.sitze[i]] & (1 << led));
    });
  }
  // Die verteilten Welten halten sich daran.
  for (let n = 0; n < 20; n++) {
    const haende = B.welt(spiel, 0, w, rng);
    for (let s = 1; s < 4; s++) {
      assert.equal(haende[s].length, r.haende[s].length);
      for (const k of haende[s]) assert.ok(!(w.leer[s] & (1 << J.farbeVon(k))), 'Farbe, die Sitz ' + s + ' nicht mehr hat');
    }
    assert.deepEqual(haende.flat().concat(r.stiche.flatMap((x) => x.karten)).sort((a, b) => a - b), Array.from({ length: 36 }, (_, k) => k));
  }
});

test('Faustregel erklärt jede Ansage in Worten', () => {
  const hand = J.verteile(J.zufall(8))[0];
  for (const code of J.MODUS_REIHENFOLGE.concat('SCHIEBEN')) {
    const satz = B.faustregel(hand, code);
    assert.ok(satz.length > 10, code);
  }
});

test('Vorlesen: Jeder Satz, den Tipp und Computer sagen können, ist vertonbar', () => {
  const alle = new Set(B.alleSprechTeile());
  const fehlt = new Set();
  const pruefe = (satz) => { if (!alle.has(satz)) fehlt.add(satz); };
  const rng = J.zufall(77);
  const varianten = [{}, { modi: { T: true, OBE: true, UNE: true, SLO: true, SLU: true, MIS: true } }];
  let i = 0;
  for (const regeln of varianten) {
    for (const stufe of ['mittel', 'schwer', 'leicht']) {
      for (let n = 0; n < 6; n++) {
        const spiel = J.neuesSpiel(Object.assign({ runden: 1 }, regeln), { seed: 900 + i++ });
        const r = spiel.runde;
        while (r.phase === 'ansage') {
          const s = J.ansageAmZug(r);
          const w = B.waehleAnsage(spiel, s, 'mittel', { rng });
          B.sprechAnsage(r.haende[s], w.code, 100, false).forEach(pruefe);
          if (w.code === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, w.code);
        }
        while (r.phase === 'spiel') {
          const s = r.amZug;
          const z = B.waehleKarte(spiel, s, stufe, { rng, welten: 6, weltenExakt: 4 });
          pruefe(B.sprechKarte(z.karte, r.code));
          pruefe(B.sprechGrund(z.grund));
          J.spiele(spiel, s, z.karte);
        }
      }
    }
  }
  for (let n = 0; n < 300; n++) {
    const hand = J.verteile(J.zufall(5000 + n))[0];
    for (const code of J.MODUS_REIHENFOLGE.concat('SCHIEBEN')) B.faustregelTeile(hand, code).forEach(pruefe);
  }
  for (const p of [-5, 0, 77, 160, 161, 300]) pruefe(B.sprechSchnitt(p, false));
  // «Zufällig gewählt.» und «Nach Gefühl.» sagt nur «Leicht» über sich selbst – nie als Tipp.
  fehlt.delete('Zufällig gewählt.');
  assert.deepEqual([...fehlt], []);
});
