/*
 * jass-protokoll.js – Das Online-Spiel als Liste von Ereignissen.
 * ---------------------------------------------------------------------------
 * Im Online-Spiel gibt es keinen Server, der rechnet. In der Datenbank steht
 * nur, was passiert ist – eine Liste, an die jeder seinen Zug anhängt:
 *
 *   { t: 'r', nr, a }            Runde nr beginnt, a sagt an (Gastgeber)
 *   { t: 'p', s }                Sitz s schiebt
 *   { t: 'a', s, c }             Sitz s sagt c an (T0…T3, OBE, UNE, …)
 *   { t: 'k', s, k, w?, st? }    Sitz s legt Karte k
 *                                w:  seine Weise, als Kartenlisten (nur im
 *                                    ersten Stich, nur mit Weisen)
 *                                st: 1, wenn das die zweite Stöck-Karte war
 *
 * Jedes Gerät spielt die Liste mit der Engine nach und kommt so zum selben
 * Stand. Die Karten der anderen kennt es nicht: Ihre Hände bestehen aus
 * Platzhaltern (JassEngine.VERDECKT), und was sie legen, wird ungeprüft
 * übernommen. Geprüft wird vor dem Schreiben – auf dem Gerät, das spielt.
 *
 * Weise werden gemeldet, nicht gerechnet (niemand sieht die Hände). Damit
 * keiner beliebige Punkte meldet, ist ein Weis eine Liste von Karten; was
 * sie wert ist, rechnet jedes Gerät selbst nach.
 */
(function (root) {
  'use strict';

  const J = (typeof module !== 'undefined' && module.exports) ? require('./jass-engine.js') : root.JassEngine;

  // Ein gemeldeter Weis (Kartenliste) → Weis-Objekt, oder null, wenn die
  // Karten keinen gültigen Weis ergeben.
  function weisAusKarten(karten) {
    if (!Array.isArray(karten) || karten.length < 3 || karten.length > 9) return null;
    const k = karten.map(Number);
    if (k.some((x) => !(x >= 0 && x < 36)) || new Set(k).size !== k.length) return null;
    const gefunden = J.findeWeise(k);
    if (gefunden.length !== 1) return null;
    const w = gefunden[0];
    return w.karten.length === k.length ? w : null;
  }

  function alsListe(wert) {
    if (Array.isArray(wert)) return wert;
    if (wert && typeof wert === 'object') {
      return Object.keys(wert).sort((a, b) => Number(a) - Number(b)).map((key) => wert[key]);
    }
    return [];
  }

  // Baut den Spielstand aus den Ereignissen.
  //   regeln       die Regeln des Tisches
  //   ereignisse   die Liste (Array, Lücken erlaubt)
  //   haende       bekannte Hände: { [sitz]: { nr, karten } }
  // Gibt { spiel, fehler, ersterAnsager } zurück; spiel ist null, solange
  // noch nicht ausgeteilt wurde.
  function aufbauen(regeln, ereignisse, haende) {
    const r = J.regelnMitStandard(regeln);
    const bekannt = haende || {};
    let spiel = null;
    let ersterAnsager = -1;
    let gemeldet = [null, null, null, null];
    const fehler = [];
    const liste = alsListe(ereignisse);
    for (let i = 0; i < liste.length; i++) {
      const ev = liste[i];
      if (!ev) continue;
      try {
        if (ev.t === 'r') {
          const nr = Number(ev.nr);
          const h = [0, 1, 2, 3].map((s) => {
            const x = bekannt[s];
            return x && Number(x.nr) === nr ? alsListe(x.karten).map(Number) : J.verdeckteHand(9);
          });
          if (!spiel) {
            ersterAnsager = Number(ev.a);
            spiel = J.neuesSpiel(r, { haende: h, ersterAnsager, seed: 1 });
          } else {
            if (spiel.fertig || spiel.runde.phase !== 'ende') throw new Error('Neue Runde, bevor die alte fertig ist.');
            J.rundeAbschliessen(spiel, { haende: h });
            if (spiel.fertig) throw new Error('Neue Runde nach Spielende.');
          }
          spiel.rundeNr = nr;
          spiel.runde.nr = nr;
          spiel.runde.ansager = Number(ev.a);
          spiel.runde.amZug = Number(ev.a);
          gemeldet = [null, null, null, null];
        } else if (ev.t === 'p') {
          pruefeSitz(spiel, ev.s, J.ansageAmZug(spiel.runde));
          J.schieben(spiel);
        } else if (ev.t === 'a') {
          pruefeSitz(spiel, ev.s, J.ansageAmZug(spiel.runde));
          J.ansagen(spiel, ev.c);
          // Weise und Stöck kommen online aus den Meldungen.
          spiel.runde.weis = null;
          spiel.runde.stoeckSitz = -1;
        } else if (ev.t === 'k') {
          const runde = spiel.runde;
          const s = Number(ev.s);
          pruefeSitz(spiel, s, runde.amZug);
          if (ev.w && r.weisen && runde.stichNr === 0) {
            gemeldet[s] = alsListe(ev.w).map((x) => weisAusKarten(alsListe(x))).filter(Boolean);
          }
          if (ev.st && r.stoeck && J.MODI[runde.code].trumpf >= 0) runde.stoeckSitz = s;
          const vorher = runde.stichNr;
          J.spiele(spiel, s, Number(ev.k), { ungeprueft: true });
          if (vorher === 0 && runde.stichNr === 1 && r.weisen && runde.code !== 'MIS') {
            runde.weis = J.werteGemeldeteWeiseAus(gemeldet, J.effModus(runde.code, 0), runde.ausspieler);
          }
        } else {
          throw new Error('Unbekanntes Ereignis ' + ev.t);
        }
      } catch (e) {
        fehler.push({ index: i, meldung: e.message });
      }
    }
    // War das die letzte Runde, ist das Spiel jetzt fertig.
    if (spiel && !spiel.fertig && spiel.runde.phase === 'ende' && istLetzteRunde(spiel)) {
      J.rundeAbschliessen(spiel);
    }
    return { spiel, fehler, ersterAnsager };
  }

  function pruefeSitz(spiel, s, erwartet) {
    if (!spiel) throw new Error('Noch nicht ausgeteilt.');
    if (Number(s) !== erwartet) throw new Error('Sitz ' + s + ' ist nicht am Zug.');
  }

  // Endet das Spiel mit der gerade beendeten Runde?
  function istLetzteRunde(spiel) {
    const r = spiel.regeln;
    const runde = spiel.runde;
    if (runde.phase !== 'ende') return false;
    if (r.spielende === 'punkte') return J.zielErreichtVon(spiel.summe, runde, runde.abrechnung, r) >= 0;
    return spiel.runden.length + 1 >= r.runden;
  }

  // Wer ist dran, und womit?
  function naechster(spiel) {
    if (!spiel) return { art: 'austeilen', sitz: -1 };
    if (spiel.fertig) return { art: 'fertig', sitz: -1 };
    const r = spiel.runde;
    if (r.phase === 'ansage') return { art: 'ansage', sitz: J.ansageAmZug(r) };
    if (r.phase === 'spiel') return { art: 'karte', sitz: r.amZug };
    return { art: 'rundenende', sitz: -1 };
  }

  // Das Ereignis für eine gelegte Karte – mit Weisen und Stöck, sofern der
  // Sitz seine Hand kennt.
  function kartenEreignis(spiel, sitz, k) {
    const runde = spiel.runde;
    const r = spiel.regeln;
    const ev = { t: 'k', s: sitz, k };
    const start = runde.startHaende[sitz];
    if (r.weisen && runde.stichNr === 0 && runde.code !== 'MIS') {
      const weise = J.findeWeise(start);
      if (weise.length) ev.w = weise.map((w) => w.karten);
    }
    const T = J.MODI[runde.code].trumpf;
    if (r.stoeck && T >= 0) {
      const koenig = J.karte(T, J.WK);
      const dame = J.karte(T, J.WD);
      if (start.includes(koenig) && start.includes(dame) && (k === koenig || k === dame)) {
        const andere = k === koenig ? dame : koenig;
        if (!runde.haende[sitz].includes(andere)) ev.st = 1;
      }
    }
    return ev;
  }

  // Teilt aus: Hände und wer ansagt. Für Runde 0 nach den Regeln (Ecken-7,
  // Zufall oder der Gastgeber), danach reihum.
  function austeilen(regeln, nr, ersterAnsager, zufallsQuelle, gastgeberSitz) {
    const r = J.regelnMitStandard(regeln);
    const rng = zufallsQuelle || Math.random;
    const haende = J.verteile(rng);
    let ansager;
    if (nr === 0 || ersterAnsager < 0) {
      if (r.ersterAnsager === 'sitz0') ansager = gastgeberSitz || 0;
      else if (r.ersterAnsager === 'zufall') ansager = Math.floor(rng() * 4);
      else ansager = haende.findIndex((h) => h.includes(J.karte(3, J.W7)));
    } else {
      ansager = (ersterAnsager + nr) % 4;
    }
    return { haende, ansager };
  }

  const api = { aufbauen, naechster, kartenEreignis, austeilen, istLetzteRunde, weisAusKarten, alsListe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JassProtokoll = api;
})(typeof self !== 'undefined' ? self : this);
