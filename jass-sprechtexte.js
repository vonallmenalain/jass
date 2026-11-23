/*
 * jass-sprechtexte.js – Was die Stimme im Training sagt, wo Zahlen oder
 * Karten im Text stehen.
 * ---------------------------------------------------------------------------
 * Die Google-Stimme spielt nur Aufnahmen ab, also muss jeder Satz vorher
 * bekannt sein. Darum bauen diese Funktionen die Sätze aus festen Teilen
 * («Ihr habt 51 Punkte gemacht.», «Herz Ass.», «Ass: 11.»), und alle()
 * zählt jeden Satz auf, der je vorkommen kann – für
 * werkzeuge/stimme-google.mjs und für den Test, dass keine Aufnahme fehlt.
 *
 * Feste Texte, die direkt auf der Seite stehen, braucht es hier nicht: die
 * liest jass-vorlesen.js aus dem HTML.
 */
(function (root) {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const J = node ? require('./jass-engine.js') : root.JassEngine;
  const B = node ? require('./jass-bot.js') : root.JassBot;

  const PUNKTE_MAX = 257;    // eine Runde mit Matchbonus
  const SCHNITT_MAX = 160;
  const ZAEHLEN_MAX = 100;   // höchstens zwei Stiche
  const ALLE_MODI = ['T0', 'T1', 'T2', 'T3', 'OBE', 'UNE', 'SLO', 'SLU', 'MIS'];
  const rund = (x, max) => Math.max(0, Math.min(max, Math.round(x)));

  // ----------------------------------------------------------- Bausteine

  const modusName = (c) => (c === 'SCHIEBEN' ? 'Schieben' : J.MODI[c].lang);
  const modus = (c) => modusName(c) + '.';
  const karte = (k) => J.FARBEN[J.farbeVon(k)].name + ' ' + J.WERT_NAMEN[J.wertVon(k)] + '.';
  const hand = (karten) => ['Deine Karten:'].concat(J.sortiereHand(karten, null).map(karte));
  const punkte = (n) => (n === 1 ? '1 Punkt' : n + ' Punkte');

  // ------------------------------------------------------- Stiche zählen

  const FRAGE = { 4: 'Wie viele Punkte hat dieser Stich?', 8: 'Wie viele Punkte haben diese zwei Stiche?' };
  const LETZTER = 'Das ist der letzte Stich: Er zählt 5 Punkte extra.';

  function zaehlenModus(code) {
    const m = J.MODI[code];
    if (m.trumpf >= 0) return J.FARBEN[m.trumpf].name + ' ist Trumpf.';
    return 'Gespielt wird ' + m.lang + '.';
  }

  function zaehlenAufgabe(code, karten, letzter) {
    return [zaehlenModus(code), FRAGE[karten.length] || FRAGE[4]].concat(karten.map(karte), letzter ? [LETZTER] : []);
  }

  // «Ass: 11.» – im Trumpf heissen Bauer und Neun Buur und Nell.
  function wertSatz(k, code, wert) {
    const T = J.MODI[code] ? J.MODI[code].trumpf : -1;
    const w = J.wertVon(k);
    let name = J.WERT_NAMEN[w];
    if (J.farbeVon(k) === T && w === J.WB) name = 'Buur';
    else if (J.farbeVon(k) === T && w === J.W9) name = 'Nell';
    return name + ': ' + wert + '.';
  }

  const zusammen = (n) => (n === 1 ? 'Zusammen ist es 1 Punkt.' : 'Zusammen sind es ' + rund(n, ZAEHLEN_MAX) + ' Punkte.');

  function zaehlenLoesung(code, karten, werte, letzter, summe, richtig) {
    return [richtig ? 'Richtig!' : 'Nicht ganz.']
      .concat(karten.map((k, i) => wertSatz(k, code, werte[i])), letzter ? ['Letzter Stich: 5.'] : [], [zusammen(summe)]);
  }

  const zaehlenErgebnis = (richtig, laenge, rekord) => [richtig + ' von ' + laenge + ' richtig.'].concat(rekord ? ['Neuer Rekord!'] : []);

  const SPIEL_157 = 'Ein ganzes Spiel hat 157 Punkte, mit dem letzten Stich.';
  function werteTabelle(code) {
    const m = J.MODI[code];
    if (m.trumpf >= 0) {
      return ['Trumpf-Bauer, der Buur: 20.', 'Trumpf-Neun, das Nell: 14.', 'Ass: 11.', 'Zehn: 10.', 'König: 4.', 'Dame: 3.', 'Bauer, nicht Trumpf: 2.',
        'Neun, Acht, Sieben und Sechs: 0.', 'Im Trumpf zählen Bauer und Neun mehr; die Acht zählt nichts.', SPIEL_157];
    }
    if (J.effModus(code, 0) === J.EFF_UNE) {
      return ['Sechs: 11.', 'Zehn: 10.', 'Acht: 8.', 'König: 4.', 'Dame: 3.', 'Bauer: 2.', 'Ass, Neun und Sieben: 0.', 'Ohne Trumpf zählt die Acht 8 Punkte.', SPIEL_157];
    }
    return ['Ass: 11.', 'Zehn: 10.', 'Acht: 8.', 'König: 4.', 'Dame: 3.', 'Bauer: 2.', 'Neun, Sieben und Sechs: 0.', 'Ohne Trumpf zählt die Acht 8 Punkte.', SPIEL_157];
  }

  // ------------------------------------------------------- Trumpf-Trainer

  function trainerLage(geschoben, karten, vorbei) {
    let lage;
    if (vorbei) lage = [geschoben ? 'Dein Partner hatte geschoben.' : 'Du warst Vorhand.'];
    else if (geschoben) lage = ['Dein Partner hat geschoben – jetzt musst du ansagen.', 'Was ist Trumpf?'];
    else lage = ['Du bist Vorhand und sagst an.', 'Was ist Trumpf – oder schiebst du?'];
    return karten ? lage.concat(hand(karten)) : lage;
  }

  const URTEIL = ['Da gab es Besseres.', 'Geht so.', 'Gut!', 'Sehr gut!', 'Perfekt!'];
  const sterne = (n) => (n === 1 ? '1 Stern.' : n + ' Sterne.');
  const weniger = (n) => 'Deine Wahl bringt im Schnitt etwa ' + punkte(rund(n, SCHNITT_MAX)) + ' weniger.';
  const LISTE_KOPF = 'So viele Punkte macht euer Team im Schnitt, wenn ihr so ansagt:';

  // Urteil, Liste und Erklärung nach einer Wahl im Trainer.
  //   liste: [{ code, punkte }], die beste zuerst
  function trainerAuswertung(handKarten, wahl, liste, sterneZahl, mitMultiplikator) {
    const beste = liste[0];
    const meine = liste.find((x) => x.code === wahl) || beste;
    const perfekt = meine === beste;
    const urteil = perfekt && sterneZahl === 3 ? URTEIL[4] : URTEIL[Math.max(0, Math.min(3, sterneZahl))];
    const s = [urteil, sterne(sterneZahl)];
    if (perfekt) s.push('Genau die beste Ansage.');
    else s.push(weniger((beste.punkte - meine.punkte)));
    s.push(LISTE_KOPF);
    liste.forEach((x) => { s.push(modus(x.code), B.sprechSchnitt(x.punkte, mitMultiplikator)); });
    if (perfekt) s.push(modusName(beste.code) + ' ist die beste Wahl.');
    else s.push('Am meisten bringt ' + modusName(beste.code) + '.');
    s.push(...B.faustregelTeile(handKarten, beste.code));
    if (!perfekt) s.push('Deine Wahl: ' + modusName(meine.code) + '.', ...B.faustregelTeile(handKarten, meine.code));
    return s;
  }

  // Was beim Ausspielen herauskam (Trainer und Helfer).
  //   e: { punkte, code, ichSchob }, erwartet: Schnitt oder null, gewaehlt: Wahl im Trainer
  function vergleich(e, erwartet, gewaehlt) {
    const s = ['Ihr habt ' + punkte(rund(e.punkte, PUNKTE_MAX)) + ' gemacht.'];
    s.push(e.ichSchob ? 'Du hast geschoben, angesagt wurde ' + modusName(e.code) + '.' : 'Angesagt: ' + modusName(e.code) + '.');
    if (gewaehlt && !e.ichSchob && gewaehlt !== e.code) s.push('Im Trainer hattest du ' + modusName(gewaehlt) + ' gewählt.');
    if (erwartet != null) {
      s.push('Im Schnitt wären es etwa ' + rund(erwartet, SCHNITT_MAX) + ' gewesen.');
      const diff = e.punkte - erwartet;
      if (diff >= 10) s.push('Mehr als im Schnitt – stark gespielt, oder die anderen Karten lagen gut für euch.');
      else if (diff <= -10) s.push('Weniger als im Schnitt – die Karten der anderen lagen gegen euch, oder es gab bessere Züge.');
      else s.push('Ziemlich genau im Schnitt.');
    }
    return s;
  }

  const IM_VERLAUF = 'Die Runde wird im Verlauf gespeichert.';
  const AUSSPIELEN_HINWEIS = ['«Ausspielen» spielt genau diese Hand eine Runde lang gegen den Computer.', 'Danach geht es hierher zurück, mit euren Punkten neben dem Schnitt.', IM_VERLAUF];

  function trainerFertig(sterneZahl, max, rekord, besteZahl, verschenkt, geschobenZahl) {
    const s = [sterneZahl + ' von ' + max + ' Sternen.'];
    if (rekord) s.push('Neuer Rekord!');
    s.push(besteZahl === 1 ? 'Einmal die beste Ansage.' : besteZahl + ' Mal die beste Ansage.');
    s.push('Im Schnitt etwa ' + punkte(rund(verschenkt, SCHNITT_MAX)) + ' verschenkt.');
    if (geschobenZahl) s.push(geschobenZahl === 1 ? 'Einmal geschoben.' : geschobenZahl + ' Mal geschoben.');
    return s;
  }

  // -------------------------------------------------------- Trumpf-Helfer

  function helferVorschlag(handKarten, liste, mitMultiplikator, faustregelCode) {
    const beste = liste[0];
    const s = [B.sprechAnsage(handKarten, beste.code, beste.punkte, mitMultiplikator)[0]];
    s.push(...B.faustregelTeile(handKarten, beste.code));
    s.push(LISTE_KOPF);
    liste.forEach((x) => { s.push(modus(x.code), B.sprechSchnitt(x.punkte, mitMultiplikator)); });
    if (faustregelCode && faustregelCode !== beste.code) s.push('Die schnelle Faustregel hätte ' + modusName(faustregelCode) + ' gesagt – knapp, beides ist vertretbar.');
    return s;
  }

  const HELFER_RUNDE = ['Gespielt wird genau eine Runde.', 'Danach geht es hierher zurück, mit euren Punkten neben dem Schnitt.', IM_VERLAUF];

  // Trumpf-Helfer: Karten auf dem Foto erkannt (jass-erkennung.js)
  const FOTO_LADEN = 'Ich suche deine Karten auf dem Foto …';
  const FOTO_FEHLER = 'Erkennung hat nicht geklappt. Tippe die Karten unten an.';
  function fotoErkannt(unsicher) {
    return ['9 Karten erkannt.', 'Falsche Karte oben wegtippen, unten die richtige wählen.']
      .concat(unsicher ? ['Gelb: unsicher.'] : []);
  }

  // ------------------------------------------------------------- Alle

  function alle() {
    const s = new Set();
    const add = (x) => (Array.isArray(x) ? x : [x]).forEach((y) => y && s.add(y));
    const codes = ALLE_MODI.concat('SCHIEBEN');
    // Zählen
    for (const c of ['T0', 'T1', 'T2', 'T3', 'OBE', 'UNE']) {
      add(zaehlenModus(c));
      add(werteTabelle(c));
      for (let k = 0; k < 36; k++) add(wertSatz(k, c, J.PUNKTE[J.effModus(c, 0)][k]));
    }
    add(Object.values(FRAGE)); add(LETZTER); add(['Richtig!', 'Nicht ganz.', 'Letzter Stich: 5.']);
    for (let n = 0; n <= ZAEHLEN_MAX; n++) add(zusammen(n));
    for (const l of [5, 10, 20]) for (let r = 0; r <= l; r++) add(zaehlenErgebnis(r, l, true));
    for (let k = 0; k < 36; k++) add(karte(k));
    add('Deine Karten:');
    // Trainer
    add(trainerLage(true)); add(trainerLage(false)); add(trainerLage(true, null, true)); add(trainerLage(false, null, true));
    add(URTEIL);
    for (let n = 0; n <= 3; n++) add(sterne(n));
    add(['Genau die beste Ansage.', LISTE_KOPF]);
    for (let n = 0; n <= SCHNITT_MAX; n++) add(weniger(n));
    for (const c of codes) {
      add(modus(c));
      add(modusName(c) + ' ist die beste Wahl.');
      add('Am meisten bringt ' + modusName(c) + '.');
      add('Deine Wahl: ' + modusName(c) + '.');
      add('Du hast geschoben, angesagt wurde ' + modusName(c) + '.');
      add('Angesagt: ' + modusName(c) + '.');
      add('Im Trainer hattest du ' + modusName(c) + ' gewählt.');
      add('Die schnelle Faustregel hätte ' + modusName(c) + ' gesagt – knapp, beides ist vertretbar.');
    }
    for (let n = 0; n <= PUNKTE_MAX; n++) add('Ihr habt ' + punkte(n) + ' gemacht.');
    for (let n = 0; n <= SCHNITT_MAX; n++) add('Im Schnitt wären es etwa ' + n + ' gewesen.');
    add(['Mehr als im Schnitt – stark gespielt, oder die anderen Karten lagen gut für euch.',
      'Weniger als im Schnitt – die Karten der anderen lagen gegen euch, oder es gab bessere Züge.', 'Ziemlich genau im Schnitt.']);
    add(AUSSPIELEN_HINWEIS);
    for (const max of [15, 30, 60]) for (let n = 0; n <= max; n++) add(n + ' von ' + max + ' Sternen.');
    add('Neuer Rekord!');
    for (let n = 0; n <= 20; n++) {
      add(n === 1 ? 'Einmal die beste Ansage.' : n + ' Mal die beste Ansage.');
      if (n) add(n === 1 ? 'Einmal geschoben.' : n + ' Mal geschoben.');
    }
    for (let n = 0; n <= SCHNITT_MAX; n++) add('Im Schnitt etwa ' + punkte(n) + ' verschenkt.');
    // Helfer
    add(HELFER_RUNDE);
    add(fotoErkannt(true)); add(FOTO_FEHLER);
    return Array.from(s).map(B.sprechform);
  }

  const api = {
    modus, karte, hand, zaehlenAufgabe, zaehlenLoesung, zaehlenErgebnis, werteTabelle,
    trainerLage, trainerAuswertung, vergleich, trainerFertig, AUSSPIELEN_HINWEIS,
    helferVorschlag, HELFER_RUNDE, FOTO_LADEN, FOTO_FEHLER, fotoErkannt, alle,
  };
  if (node) module.exports = api;
  else root.JassSprechtexte = api;
})(typeof self !== 'undefined' ? self : this);
