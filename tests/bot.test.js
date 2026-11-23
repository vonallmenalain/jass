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
    for (const stufen of [['mittel', 'schwer', 'mittel', 'schwer'], ['schwer', 'mittel', 'schwer', 'mittel']]) {
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
    for (const stufe of ['mittel', 'schwer']) {
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
    for (const code of J.MODUS_REIHENFOLGE.concat('SCHIEBEN')) B.faustregelTeile(hand, code).map(B.sprechform).forEach(pruefe);
  }
  for (const p of [-5, 0, 77, 160, 161, 300]) pruefe(B.sprechSchnitt(p, false));
  // «Zufällig gewählt.» und «Nach Gefühl.» sagt nur «Leicht» über sich selbst – nie als Tipp.
  fehlt.delete('Zufällig gewählt.');
  assert.deepEqual([...fehlt], []);
});

test('Ansage-Wissen: Welten passen zu Ansage und Schieben', () => {
  const regeln = J.regelnMitStandard();
  // Du (0) sagt nach Bens Schieben Kreuz an; Ben (2) ist am Zug.
  const haende = [
    [23, 17, 3, 24, 4, 0, 31, 13, 16],
    [14, 27, 8, 28, 20, 29, 2, 26, 1],
    [18, 25, 34, 15, 6, 33, 22, 21, 9],
    [10, 35, 32, 19, 5, 12, 30, 7, 11],
  ];
  const spiel = J.neuesSpiel(regeln, { haende, ersterAnsager: 2 });
  J.schieben(spiel);
  J.ansagen(spiel, 'T2');
  const info = B.ansageWissen(spiel, 2);
  assert.equal(info.ansager, 0);
  assert.equal(info.schieber, -1, 'Ben hat selbst geschoben');
  assert.equal(info.darfSchieben, false);
  // Für den Ansager selbst gibt es nichts zu beachten – ausser dem Schieber.
  assert.equal(B.ansageWissen(spiel, 0).ansager, -1);
  assert.equal(B.ansageWissen(spiel, 0).schieber, 2);
  // Gleich verteilt hat Du den Buur in einem Drittel der Welten, passend zur Ansage fast immer.
  const w = B.wissen(spiel, 2);
  const rng = J.zufall(99);
  let passend = 0, mitBuur = 0;
  for (let i = 0; i < 3000 && passend < 300; i++) {
    const h = B.welt(spiel, 2, w, rng);
    if (!B.passtZumWissen(h, regeln, info)) continue;
    passend++;
    if (h[0].includes(23)) mitBuur++;
  }
  assert.ok(passend >= 100, 'genug passende Welten: ' + passend);
  assert.ok(mitBuur / passend > 0.85, 'Buur beim Ansager in ' + Math.round(100 * mitBuur / passend) + '%');
  // Eine schwache Hand passt zum Schieben, eine starke nicht.
  const schwach = [3, 4, 12, 13, 22, 30, 31, 2, 15];
  const stark = [23, 21, 26, 25, 22, 8, 17, 35, 34];
  assert.equal(B.passtZumSchieben(schwach, regeln), true);
  assert.equal(B.passtZumSchieben(stark, regeln), false);
  assert.equal(B.passtZurAnsage(stark, regeln, 'T2', true), true);
  assert.equal(B.passtZurAnsage(schwach, regeln, 'T2', true), false);
});

test('Anzeigen: tief angespielt heisst stark in der Farbe – der Partner spielt sie zurück', () => {
  const regeln = J.regelnMitStandard();
  const haende = [
    [23, 17, 3, 24, 4, 0, 31, 13, 16],
    [14, 27, 8, 28, 20, 29, 2, 26, 1],
    [18, 25, 34, 15, 6, 33, 22, 21, 9],
    [10, 35, 32, 19, 5, 12, 30, 7, 11],
  ];
  const spiel = J.neuesSpiel(regeln, { haende, ersterAnsager: 2 });
  J.schieben(spiel);
  J.ansagen(spiel, 'T2');
  // Stich 1: Ben Kreuz Sechs, Clara Kreuz Sieben, Du Buur, Anna Kreuz Acht
  for (const [s, k] of [[2, 18], [3, 19], [0, 23], [1, 20]]) J.spiele(spiel, s, k);
  // Du spielt die Schaufel Sechs an: Anzeige in Schaufel
  J.spiele(spiel, 0, 0);
  const w = B.wissen(spiel, 2);
  assert.ok(w.angezeigt[0] & 1, 'Schaufel ist angezeigt');
  assert.deepEqual(w.anzeigen, [{ sitz: 0, farbe: 0, hoch: [8, 7] }], 'Ass oder König');
  // Ben weiss: Du hält Schaufel Ass oder König
  const info = B.ansageWissen(spiel, 2, w);
  assert.deepEqual(info.anzeigen, [{ sitz: 0, offen: [8, 7] }]);
  // Anzeigen gelten dem Partner: Anna (Gegnerin) liest sie nicht
  assert.deepEqual(B.ansageWissen(spiel, 1, B.wissen(spiel, 1)).anzeigen, []);
  // Später am Anspielen spielt Ben die angezeigte Farbe zurück
  const v = Object.assign(B.ansichtAus(spiel, 2), { stich: [], stichSitze: [], hand: [6, 9, 33] });
  const z = B.mittelZug(v);
  assert.equal(z.karte, 6);
  assert.match(z.grund, /angezeigt/);
});

test('Gleichwertige Karten: die höchste zuerst (Buur vor Nell, im Undenufe Sechs vor Sieben)', () => {
  const regeln = J.regelnMitStandard();
  // Undenufe: Ben hat Kreuz Sechs und Sieben – die Sechs kommt zuerst.
  const une = [[22, 25, 27, 11, 35, 1, 29, 6, 9], [23, 15, 13, 8, 34, 20, 16, 31, 7], [14, 18, 10, 19, 3, 21, 4, 26, 17], [24, 0, 5, 30, 32, 2, 12, 33, 28]];
  for (let i = 0; i < 6; i++) {
    const spiel = J.neuesSpiel(regeln, { haende: une.map((h) => h.slice()), ersterAnsager: 2 });
    J.schieben(spiel);
    J.ansagen(spiel, 'UNE');
    assert.notEqual(B.schwerZug(spiel, 2, { rng: J.zufall(100 + i), welten: 120 }).karte, 19, 'nicht die Kreuz Sieben vor der Sechs');
  }
  // Kreuz Trumpf mit Buur und Nell: die Faustregel zieht mit dem Buur.
  const t = [[23, 21, 26, 19, 0, 9, 27, 1, 10], [2, 3, 4, 5, 6, 7, 8, 11, 12], [13, 14, 15, 16, 17, 18, 20, 22, 24], [25, 28, 29, 30, 31, 32, 33, 34, 35]];
  const spiel = J.neuesSpiel(regeln, { haende: t, ersterAnsager: 0 });
  J.ansagen(spiel, 'T2');
  assert.equal(B.mittelZug(B.ansichtAus(spiel, 0)).karte, 23);
});

test('Ass schmieren als Zeichen: mit Ass, König, Dame geschmiert – der Partner spielt die Farbe zurück', () => {
  const regeln = J.regelnMitStandard();
  const haende = [
    [8, 1, 0, 9, 10, 18, 19, 27, 28],      // Du: Schaufel Ass, kleine Karten
    [7, 6, 2, 20, 21, 22, 29, 30, 31],
    [17, 16, 15, 23, 24, 25, 32, 33, 34],  // Partner: Herz Ass, König, Dame – keine Schaufel
    [3, 4, 5, 11, 12, 13, 14, 26, 35],
  ];
  const spiel = J.neuesSpiel(regeln, { haende, ersterAnsager: 0 });
  J.ansagen(spiel, 'OBE');
  J.spiele(spiel, 0, 8);   // Schaufel Ass
  J.spiele(spiel, 1, 2);
  // Der Partner schmiert das Herz Ass – die Faustregel tut das mit Ass, König, Dame
  const z = B.mittelZug(B.ansichtAus(spiel, 2));
  assert.equal(z.karte, 17);
  assert.match(z.grund, /Zeichen/);
  J.spiele(spiel, 2, 17);
  J.spiele(spiel, 3, 3);
  // Du liest: Partner ist in Herz sehr stark (König oder Dame)
  const w = B.wissen(spiel, 0);
  assert.ok(w.angezeigt[2] & 2, 'Herz angezeigt');
  assert.deepEqual(w.anzeigen, [{ sitz: 2, farbe: 1, hoch: [16, 15], geschmiert: true }]);
  // … und spielt Herz zurück, die tiefste
  const r = B.mittelZug(B.ansichtAus(spiel, 0));
  assert.equal(r.karte, 9);
  assert.match(r.grund, /angezeigt/);
});
