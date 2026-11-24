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

test('Gleichwertige Karten, aber der König ist noch draussen: kein «Stich sicher»', () => {
  // Aus einer Partie (Ecke Trumpf): Ben hat Schaufel Ass, Dame, Bauer –
  // der König ist noch bei Clara. Bauer und Dame sind gleichwertig, sicher
  // ist der Stich mit der Dame aber nicht.
  const regeln = J.regelnMitStandard();
  const haende = [[0, 2, 27, 31, 29, 14, 11, 32, 13], [3, 12, 35, 23, 10, 34, 19, 1, 25], [8, 17, 15, 26, 5, 9, 24, 30, 6], [33, 16, 18, 7, 4, 21, 22, 28, 20]];
  const zuege = [[0, 32], [1, 34], [2, 30], [3, 28], [0, 27], [1, 35], [2, 9], [3, 33], [1, 10], [2, 15], [3, 16], [0, 11], [3, 22], [0, 31], [1, 19], [2, 24], [0, 14], [1, 12], [2, 17], [3, 18]];
  let gesehen = 0;
  for (let i = 0; i < 4; i++) {
    const spiel = J.neuesSpiel(regeln, { haende: haende.map((h) => h.slice()), ersterAnsager: 0 });
    J.ansagen(spiel, 'T3');
    for (const [s, k] of zuege) J.spiele(spiel, s, k);
    // Der Text: mit dem bisherigen Rechenweg (ohne Löser), der hier Bauer
    // oder Dame wählt – mit dem Löser kommt das Ass (Test unten).
    const z = B.schwerZug(spiel, 2, { rng: J.zufall(700 + i), welten: 120, loeser: false });
    if (z.karte === karte(S, WB) || z.karte === karte(S, WD)) {
      gesehen++;
      assert.equal(z.karte, karte(S, WD), 'die höhere der beiden');
      assert.doesNotMatch(z.grund, /dass der Stich sicher ist/);
      assert.match(z.grund, /noch nicht/);
    }
  }
  assert.ok(gesehen > 0, 'Bauer oder Dame mindestens einmal gewählt');
});

test('Mit dem Löser: Ass vor Dame, wenn der König noch draussen ist (Partie mit Notiz)', () => {
  // Zu Ende gespielt bringt das Ass zuerst +5,7 ± 0,7 Punkte gegenüber der
  // Dame (werkzeuge/stelle-nachrechnen.js); die alte Rechnung sah die Dame vorn.
  const regeln = J.regelnMitStandard();
  const haende = [[0, 2, 27, 31, 29, 14, 11, 32, 13], [3, 12, 35, 23, 10, 34, 19, 1, 25], [8, 17, 15, 26, 5, 9, 24, 30, 6], [33, 16, 18, 7, 4, 21, 22, 28, 20]];
  const zuege = [[0, 32], [1, 34], [2, 30], [3, 28], [0, 27], [1, 35], [2, 9], [3, 33], [1, 10], [2, 15], [3, 16], [0, 11], [3, 22], [0, 31], [1, 19], [2, 24], [0, 14], [1, 12], [2, 17], [3, 18]];
  let ass = 0;
  for (let i = 0; i < 4; i++) {
    const spiel = J.neuesSpiel(regeln, { haende: haende.map((h) => h.slice()), ersterAnsager: 0 });
    J.ansagen(spiel, 'T3');
    for (const [s, k] of zuege) J.spiele(spiel, s, k);
    if (B.schwerZug(spiel, 2, { rng: J.zufall(700 + i), welten: 120 }).karte === karte(S, WA)) ass++;
  }
  assert.ok(ass >= 3, 'Schaufel Ass in ' + ass + ' von 4');
});

test('König verlangen (Obenabe): Ass, wo der König fehlt – Partner gibt ihn – sonst hat er ihn nicht', () => {
  const regeln = J.regelnMitStandard();
  const k = karte;
  // Du: Herz Ass und Dame ohne König; Ben (2): Herz König
  const h0 = [k(H, WA), k(H, WD), k(H, W7), k(S, WA), k(S, WK), k(K, WA), k(K, W9), k(E, WA), k(E, W8)];
  const h2 = [k(H, WK), k(H, W6), k(S, W6), k(S, W7), k(K, W6), k(K, W7), k(E, W6), k(E, W7), k(E, W9)];
  const rest = [];
  for (let x = 0; x < 36; x++) if (!h0.includes(x) && !h2.includes(x)) rest.push(x);
  const opt = (i) => ({ rng: J.zufall(i), welten: 40, loesenAb: 12, koenigVerlangen: true, verlangenSchwelle: 1000 });
  const spiel = J.neuesSpiel(regeln, { haende: [h0, rest.slice(0, 9), h2, rest.slice(9, 18)], ersterAnsager: 0 });
  J.ansagen(spiel, 'OBE');
  const a = B.schwerZug(spiel, 0, opt(1));
  assert.equal(a.karte, k(H, WA), 'das Herz-Ass, wo der König fehlt');
  assert.match(a.grund, /König fehlt/);
  J.spiele(spiel, 0, a.karte);
  J.spiele(spiel, 1, J.erlaubteFuer(spiel, 1)[0]);
  const b = B.schwerZug(spiel, 2, opt(2));
  assert.equal(b.karte, k(H, WK), 'Ben gibt den König');
  // Lesen: Gibt der Partner eine andere Herz, hat er den König nicht.
  const spiel2 = J.neuesSpiel(regeln, { haende: [h0.slice(), rest.slice(0, 9), [k(H, W8)].concat(h2.slice(1)), rest.slice(9, 17).concat(k(H, WK))], ersterAnsager: 0 });
  J.ansagen(spiel2, 'OBE');
  J.spiele(spiel2, 0, k(H, WA));
  J.spiele(spiel2, 1, J.erlaubteFuer(spiel2, 1)[0]);
  J.spiele(spiel2, 2, k(H, W8));
  const w = B.wissen(spiel2, 0, { verlangen: true });
  assert.equal(w.nicht[2][k(H, WK)], 1, 'Ben hat den Herz-König nicht');
});

test('Den letzten Trumpf holen: nur wenn genau ein Trumpf draussen ist', () => {
  // Schaufel Trumpf, Du sagst an und hast Buur, Nell, Ass, König, Dame.
  // Nach dem ersten Stich (Buur, 6, 7, 8) ist nur noch die 10 draussen.
  const regeln = J.regelnMitStandard();
  const mitTrumpf = (verteilt) => {
    const haende = verteilt.map((h) => h.slice());
    const rest = [];
    for (let k = 9; k < 36; k++) if (!haende.some((h) => h.includes(k))) rest.push(k);
    for (const h of haende) while (h.length < 9) h.push(rest.shift());
    return haende;
  };
  const opt = (i) => ({ rng: J.zufall(900 + i), welten: 40, trumpfWeiterSchwelle: 1000 });
  const eins = mitTrumpf([[5, 3, 8, 7, 6], [0], [1], [2, 4]]);
  const spiel = J.neuesSpiel(regeln, { haende: eins, ersterAnsager: 0 });
  J.ansagen(spiel, 'T0');
  for (const [s, k] of [[0, 5], [1, 0], [2, 1], [3, 2]]) J.spiele(spiel, s, k);
  const z = B.schwerZug(spiel, 0, opt(0));
  assert.equal(z.karte, karte(S, W9), 'mit dem Nell die 10 holen');
  assert.match(z.grund, /letzten Trumpf/);
  // Zwei Trümpfe draussen (7 und 10): keine Regel.
  const zwei = mitTrumpf([[5, 3, 8, 7, 6], [0, 1], [], [2, 4]]);
  const spiel2 = J.neuesSpiel(regeln, { haende: zwei, ersterAnsager: 0 });
  J.ansagen(spiel2, 'T0');
  J.spiele(spiel2, 0, 5); J.spiele(spiel2, 1, 0); J.spiele(spiel2, 2, spiel2.runde.haende[2][0]); J.spiele(spiel2, 3, 2);
  assert.doesNotMatch(B.schwerZug(spiel2, 0, opt(1)).grund, /letzten Trumpf/);
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

test('Übernehmen müssen ist kein Schmieren: im Undenufe mit 7, 8, 9 (6 draussen) die 7 zuerst', () => {
  // Aus einer Partie (Runde 3, Stich 7): Du spielst Kreuz Dame an, Ben hat
  // nur noch Kreuz 7, 8, 9 – jede schlägt die Dame, er macht den Stich selbst.
  const regeln = J.regelnMitStandard({ modi: { T: true, OBE: true, UNE: true, SLO: false, SLU: false, MIS: false }, weisen: false, stoeck: false, matchBonus: false, multiplikatoren: false });
  const haende = [[0, 1, 8, 7, 24, 2, 29, 15, 18], [27, 13, 16, 25, 22, 14, 9, 28, 12], [19, 4, 33, 26, 21, 20, 30, 17, 6], [23, 11, 32, 31, 35, 10, 34, 3, 5]];
  const zuege = [[2, 26], [3, 23], [0, 18], [1, 25], [0, 0], [1, 12], [2, 4], [3, 3], [0, 1], [1, 22], [2, 6], [3, 5], [0, 2], [1, 14], [2, 17], [3, 35],
    [0, 7], [1, 28], [2, 30], [3, 32], [0, 8], [1, 16], [2, 33], [3, 34], [0, 24], [1, 13]];
  const spiel = J.neuesSpiel(regeln, { haende, ersterAnsager: 2 });
  J.schieben(spiel); J.ansagen(spiel, 'UNE');
  for (const [s, k] of zuege) J.spiele(spiel, s, k);
  assert.deepEqual(spiel.runde.haende[2].slice().sort((a, b) => a - b), [19, 20, 21]);
  const m = B.mittelZug(B.ansichtAus(spiel, 2));
  assert.equal(m.karte, 19, 'Kreuz 7');
  assert.doesNotMatch(m.grund, /Schmieren/);
  assert.match(m.grund, /übernehmen/);
  const z = B.schwerZug(spiel, 2, Object.assign({ rng: J.zufall(5) }, B.rechentiefe('schnell')));
  assert.equal(z.karte, 19, 'Kreuz 7');
  // Muss man übernehmen, liegen aber keine gleichwertigen Karten darüber,
  // kommt die tiefste, die reicht: Undenufe, Partner liegt mit der Kreuz Dame
  // vorne, ich bin Letzter mit Kreuz 7 und 9 – die 8 ist noch draussen.
  const h2 = [[26, 20, 18, 22, 23, 25, 0, 1, 2], [24, 9, 10, 11, 12, 13, 14, 15, 16], [27, 28, 29, 30, 31, 32, 33, 34, 35], [19, 21, 3, 4, 5, 6, 7, 8, 17]];
  const sp2 = J.neuesSpiel(J.regelnMitStandard(), { haende: h2, ersterAnsager: 0 });
  J.ansagen(sp2, 'UNE');
  J.spiele(sp2, 0, 26); J.spiele(sp2, 1, 24); J.spiele(sp2, 2, 27);
  const m2 = B.mittelZug(B.ansichtAus(sp2, 3));
  assert.equal(m2.karte, 21, 'Kreuz 9 – die 7 bleibt für später');
  assert.match(m2.grund, /tiefste Karte, die reicht/);
});

test('Ausspiel des Schiebers: im ersten Stich der höchste Trumpf – der Partner liest daraus', () => {
  // Aus einer Partie: Ben schiebt, du sagst Ecke an. Ben hat Ecke Ass, König,
  // Acht, Sieben – er spielt den höchsten, das Ass.
  const regeln = J.regelnMitStandard({ modi: { T: true, OBE: true, UNE: true, SLO: false, SLU: false, MIS: false }, weisen: false, stoeck: false, matchBonus: false, multiplikatoren: false });
  const haende = [[21, 7, 32, 16, 3, 33, 22, 30, 10], [14, 13, 2, 12, 31, 25, 19, 8, 23], [15, 4, 18, 28, 0, 24, 29, 35, 34], [27, 17, 26, 6, 20, 9, 11, 5, 1]];
  const spiel = J.neuesSpiel(regeln, { haende: haende.map((h) => h.slice()), ersterAnsager: 2 });
  J.schieben(spiel); J.ansagen(spiel, 'T3');
  assert.equal(spiel.runde.amZug, 2);
  const z = B.schwerZug(spiel, 2, Object.assign({ rng: J.zufall(2) }, B.rechentiefe('schnell')));
  assert.equal(z.karte, 35, 'Ecke Ass');
  assert.match(z.grund, /höchsten Trumpf/);
  // Du (Ansager) liest: Ben hat weder Buur noch Nell.
  J.spiele(spiel, 2, 35);
  const w = B.wissen(spiel, 0);
  assert.equal(w.nicht[2][32], 1, 'kein Buur');
  assert.equal(w.nicht[2][30], 1, 'kein Nell');
  assert.equal(w.nicht[2][34], 0, 'König ist möglich');
  // Ohne Regel: die bisherige (Buur, sonst der kleinste)
  const sp0 = J.neuesSpiel(regeln, { haende: haende.map((h) => h.slice()), ersterAnsager: 2 });
  J.schieben(sp0); J.ansagen(sp0, 'T3');
  assert.equal(B.schwerZug(sp0, 2, Object.assign({ rng: J.zufall(2), schieberZeichen: false }, B.rechentiefe('schnell'))).karte, 28);
  // Hat der Schieber den Buur, ist der Buur der höchste.
  const h2 = haende.map((h) => h.slice());
  h2[0][h2[0].indexOf(32)] = 35; h2[2][h2[2].indexOf(35)] = 32;   // Ecke Bauer ↔ Ecke Ass
  const sp2 = J.neuesSpiel(regeln, { haende: h2, ersterAnsager: 2 });
  J.schieben(sp2); J.ansagen(sp2, 'T3');
  assert.equal(B.schwerZug(sp2, 2, Object.assign({ rng: J.zufall(2) }, B.rechentiefe('schnell'))).karte, 32, 'Ecke Bauer');
});

test('Ausspiel des Schiebers bei Obenabe: zuerst alle Asse – kommt keins, hat er keins', () => {
  const regeln = J.regelnMitStandard();
  // Vorhand (0) schiebt, Partner (2) sagt Obenabe. 0 hat Schaufel- und Herz-Ass.
  const haende = [[8, 17, 0, 1, 2, 9, 10, 18, 19], [3, 4, 5, 6, 7, 11, 12, 13, 14], [26, 35, 15, 16, 20, 21, 22, 23, 24], [25, 27, 28, 29, 30, 31, 32, 33, 34]];
  const spiel = J.neuesSpiel(regeln, { haende, ersterAnsager: 0 });
  J.schieben(spiel); J.ansagen(spiel, 'OBE');
  const opt = Object.assign({ rng: J.zufall(3) }, B.rechentiefe('schnell'));
  const z1 = B.schwerZug(spiel, 0, opt);
  assert.ok([8, 17].includes(z1.karte), 'ein Ass');
  assert.match(z1.grund, /Asse/);
  for (const s of [0, 1, 2, 3]) J.spiele(spiel, spiel.runde.amZug, s === 0 ? z1.karte : B.mittelZug(B.ansichtAus(spiel, spiel.runde.amZug)).karte);
  if (spiel.runde.stiche[0].sieger === 0) {
    const z2 = B.schwerZug(spiel, 0, opt);
    assert.ok([8, 17].includes(z2.karte) && z2.karte !== z1.karte, 'das zweite Ass');
  }
  // Ohne Ass: der Partner weiss, dass er keines hat.
  const h3 = [[0, 1, 2, 9, 10, 11, 18, 19, 20], [3, 4, 5, 6, 7, 12, 13, 14, 15], [8, 17, 26, 35, 16, 21, 22, 23, 24], [25, 27, 28, 29, 30, 31, 32, 33, 34]];
  const sp3 = J.neuesSpiel(regeln, { haende: h3, ersterAnsager: 0 });
  J.schieben(sp3); J.ansagen(sp3, 'OBE');
  J.spiele(sp3, 0, 0);
  const w = B.wissen(sp3, 2);
  assert.deepEqual([8, 17, 26, 35].map((k) => w.nicht[0][k]), [1, 1, 1, 1]);
});

test('Annahmen: was der Computer aus den Zügen der anderen abliest', () => {
  const regeln = J.regelnMitStandard();
  let gefunden = 0;
  for (let i = 0; i < 3 && gefunden < 3; i++) {
    const spiel = J.neuesSpiel(regeln, { seed: 777000 + i, ersterAnsager: 0 });
    J.ansagen(spiel, J.MODUS_REIHENFOLGE[0]);
    const r = spiel.runde;
    const rng = J.zufall(i + 1);
    while (r.phase === 'spiel') {
      const s = r.amZug;
      const z = B.schwerZug(spiel, s, { rng, welten: 40, loesenAb: 12, schaetzung: true, menschen: [0], gegenprobeWelten: 20 });
      if (z.annahmen) {
        gefunden++;
        assert.ok(z.annahmen.length >= 1 && z.annahmen.length <= 2);
        for (const a of z.annahmen) {
          assert.notEqual(a.s, s, 'nur über andere');
          assert.ok(['hoch', 'nichtHoch', 'leer'].includes(a.art));
          assert.ok(a.p >= 0 && a.p <= 100 && a.v >= 0 && a.v <= 100);
          if (a.art === 'leer') assert.ok(a.farbe >= 0 && a.farbe < 4); else assert.ok(a.karte >= 0 && a.karte < 36);
          if (a.zug) assert.ok(['angespielt', 'zugegeben', 'gestochen', 'abgeworfen', 'geschmiert'].includes(a.zug.wie));
        }
        if (z.ohne != null) assert.notEqual(z.ohne, z.karte);
      }
      J.spiele(spiel, s, z.karte);
    }
  }
  assert.ok(gefunden >= 1, 'mindestens eine Annahme in drei Runden');
});

test('Annahmen lassen sich abschalten', () => {
  const spiel = J.neuesSpiel(J.regelnMitStandard(), { seed: 777000, ersterAnsager: 0 });
  J.ansagen(spiel, J.MODUS_REIHENFOLGE[0]);
  const r = spiel.runde;
  const rng = J.zufall(5);
  while (r.phase === 'spiel') {
    const s = r.amZug;
    const z = B.schwerZug(spiel, s, { rng, welten: 20, loesenAb: 12, schaetzung: true, annahmen: false });
    assert.equal(z.annahmen, undefined);
    J.spiele(spiel, s, z.karte);
  }
});

test('Kartenschätzung: Menschen lesen sich stärker nach den Konventionen', () => {
  const regeln = J.regelnMitStandard();
  const gespielt = new Uint8Array(36);
  // Schaufel ist Trumpf und schon gezogen; jetzt spielt jemand Herz an.
  for (const k of [karte(S, WB), karte(S, W9), karte(S, WA), karte(S, W6), karte(S, W7), karte(S, W8), karte(S, W10), karte(S, WD)]) gespielt[k] = 1;
  const lage = { code: 'T0', stichNr: 2, stich: [], stichSitze: [], sitz: 1, gespielt, abgeworfen: 0 };
  const stark = [karte(H, W6), karte(H, WK), karte(H, WA), karte(K, W7), karte(E, W8), karte(E, W9), karte(K, W8)];
  const lp = (gw) => B.zugLogWahrscheinlichkeit(karte(H, W6), stark, lage, regeln, gw, new Float64Array(B.MERKMALE.length));
  const computer = lp(B.ZUG_GEWICHTE), mensch = lp(B.menschGewichte(B.ZUG_GEWICHTE));
  // tief anziehen aus der starken Farbe: beim Menschen wahrscheinlicher
  assert.ok(mensch > computer, `Mensch ${mensch.toFixed(2)} > Computer ${computer.toFixed(2)}`);
});
