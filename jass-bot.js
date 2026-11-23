/*
 * jass-bot.js – Die Computerspieler und der Tipp-Geber.
 * ---------------------------------------------------------------------------
 * In der App spielen alle Computer «schwer». «mittel» bleibt als Baustein:
 *
 *   mittel   Spielt nach Faustregeln wie ein guter Hobbyspieler: Bock
 *            ausspielen, dem Partner schmieren, Trumpf ziehen, billig
 *            verwerfen. Jede Entscheidung kommt mit einem Satz, warum.
 *            «schwer» lässt in seinen durchgespielten Welten alle so
 *            spielen und nimmt bei Gleichstand die Karte der Faustregel.
 *   schwer   Merkt sich alle Karten und wer welche Farbe nicht mehr hat,
 *            verteilt die unbekannten Karten viele Male neu und spielt
 *            jede mögliche Karte in all diesen Welten zu Ende (die
 *            letzten Stiche exakt). Gewählt wird, was im Schnitt am
 *            meisten bringt. Ansagen ebenso: jede Ansage, auch Schieben,
 *            wird in vielen möglichen Verteilungen durchgespielt.
 *
 * Dieselbe Rechnung bewertet im Trumpf-Trainer die Ansagen.
 */
(function (root) {
  'use strict';

  const J = (typeof module !== 'undefined' && module.exports) ? require('./jass-engine.js') : root.JassEngine;
  const { farbeVon, wertVon, team, partner, effModus, trumpfVon, schlaegt, gewinnerIndex, stichPunkte, erlaubteKarten, STAERKE, PUNKTE, MODI, WB, W9, WA, WK, WD, W10, W6, W7, W8 } = J;

  const bit = (f) => 1 << f;

  // ------------------------------------------------------------ Hilfen

  // Wie viele noch nicht gespielte Karten derselben Farbe schlagen k,
  // ohne die eigenen?
  function hoehereDraussen(k, eff, gespielt, hand) {
    const f = farbeVon(k);
    const s = STAERKE[eff][k];
    let n = 0;
    for (let w = 0; w < 9; w++) {
      const x = f * 9 + w;
      if (x === k || gespielt[x] || hand.includes(x)) continue;
      if (STAERKE[eff][x] > s) n++;
    }
    return n;
  }

  function draussenVonFarbe(f, gespielt, hand) {
    let n = 0;
    for (let w = 0; w < 9; w++) {
      const x = f * 9 + w;
      if (!gespielt[x] && !hand.includes(x)) n++;
    }
    return n;
  }

  // Anzeigen: Wer eine tiefe Karte einer Nebenfarbe anspielt, zeigt damit,
  // dass er in dieser Farbe stark ist – er hält eine der zwei höchsten
  // Karten, die noch im Spiel sind (oft den König, wenn das Ass noch fehlt).
  // Gibt diese zwei Karten zurück, oder null, wenn es keine Anzeige ist.
  const istTief = (k, eff) => STAERKE[eff][k] % 100 <= 3;
  function anzeigeHoch(k, eff, gespieltVorher) {
    const f = farbeVon(k);
    if (f === trumpfVon(eff) || !istTief(k, eff)) return null;
    const hoeher = [];
    for (let w = 0; w < 9; w++) {
      const x = f * 9 + w;
      if (x !== k && !gespieltVorher[x] && STAERKE[eff][x] > STAERKE[eff][k]) hoeher.push(x);
    }
    if (!hoeher.length) return null;
    return hoeher.sort((a, b) => STAERKE[eff][b] - STAERKE[eff][a]).slice(0, 2);
  }

  function trumpfKosten(k, eff) {
    return 10 + (STAERKE[eff][k] - 100) * 3 + PUNKTE[eff][k];
  }

  // Was kostet es, diese Karte herzugeben (verwerfen)?
  function abwurfKosten(k, v, eff) {
    const T = trumpfVon(eff);
    const f = farbeVon(k);
    let c = PUNKTE[eff][k] * 2 + (STAERKE[eff][k] % 100) * 0.4;
    if (f === T) c += 30 + (STAERKE[eff][k] - 100) * 3;
    else if (hoehereDraussen(k, eff, v.gespielt, v.hand) === 0) c += 14;
    if (T >= 0 && f !== T) {
      let n = 0;
      for (const x of v.hand) if (farbeVon(x) === f) n++;
      if (n === 1) c -= 3; // Farbe blank machen, damit man später stechen kann
    }
    return c;
  }

  function minNach(liste, fn) {
    let best = liste[0], bv = fn(best);
    for (let i = 1; i < liste.length; i++) { const v = fn(liste[i]); if (v < bv) { bv = v; best = liste[i]; } }
    return best;
  }
  function maxNach(liste, fn) { return minNach(liste, (x) => -fn(x)); }

  // Kann ein Gegner, der nach mir kommt, noch stechen?
  function gegnerKannStechen(v, eff) {
    const T = trumpfVon(eff);
    if (T < 0) return false;
    const truempfeDraussen = draussenVonFarbe(T, v.gespielt, v.hand);
    if (!truempfeDraussen) return false;
    const nachMir = 3 - v.stich.length;
    for (let i = 1; i <= nachMir; i++) {
      const s = (v.sitz + i) % 4;
      if (team(s) !== team(v.sitz) && !(v.leer[s] & bit(T))) return true;
    }
    return false;
  }

  // ------------------------------------------------------- Stufe mittel

  function mittelZug(v) {
    const eff = effModus(v.code, v.stichNr);
    const legal = erlaubteKarten(v.hand, v.stich, eff, v.regeln);
    if (legal.length === 1) return { karte: legal[0], grund: 'Nur diese Karte ist erlaubt.' };
    if (v.code === 'MIS') return misereZug(v, eff, legal);
    if (!v.stich.length) return ausspielen(v, eff, legal);
    return zugeben(v, eff, legal);
  }

  function ausspielen(v, eff, legal) {
    const T = trumpfVon(eff);
    const meinTeam = team(v.sitz);
    if (T >= 0) {
      const truempfe = legal.filter((k) => farbeVon(k) === T);
      const draussen = draussenVonFarbe(T, v.gespielt, v.hand);
      const gegnerHabenNoch = draussen > 0 && [1, 3].some((i) => !(v.leer[(v.sitz + i) % 4] & bit(T)));
      if (truempfe.length && gegnerHabenNoch && v.angesagtVon >= 0 && team(v.angesagtVon) === meinTeam) {
        const boss = truempfe.find((k) => hoehereDraussen(k, eff, v.gespielt, v.hand) === 0);
        if (boss != null) return { karte: boss, grund: 'Trumpf ziehen: Du hast den höchsten Trumpf, der noch im Spiel ist. So holst du den Gegnern die Trümpfe heraus.' };
        if (truempfe.length >= 3) {
          return { karte: minNach(truempfe, (k) => STAERKE[eff][k]), grund: 'Trumpf ziehen: Ihr habt angesagt und du hast viele Trümpfe – spiel einen kleinen, damit die hohen herauskommen.' };
        }
      }
      if (truempfe.length === legal.length) {
        const boss = truempfe.find((k) => hoehereDraussen(k, eff, v.gespielt, v.hand) === 0);
        if (boss != null) return { karte: boss, grund: 'Du hast nur noch Trümpfe – der höchste macht den Stich sicher.' };
        return { karte: minNach(truempfe, (k) => STAERKE[eff][k]), grund: 'Du hast nur noch Trümpfe – spiel den kleinsten.' };
      }
    }
    // Bock: die höchste Karte einer Farbe, die noch im Spiel ist.
    const boecke = legal.filter((k) => farbeVon(k) !== T && hoehereDraussen(k, eff, v.gespielt, v.hand) === 0);
    const sicher = boecke.filter((k) => {
      if (T < 0) return true;
      if (!draussenVonFarbe(T, v.gespielt, v.hand)) return true;
      const f = farbeVon(k);
      return ![1, 3].some((i) => {
        const s = (v.sitz + i) % 4;
        return (v.leer[s] & bit(f)) && !(v.leer[s] & bit(T));
      });
    });
    if (sicher.length) {
      const k = maxNach(sicher, (x) => PUNKTE[eff][x] * 2 + farbLaenge(v.hand, farbeVon(x)));
      return { karte: k, grund: 'Bock spielen: Diese Karte ist die höchste ihrer Farbe, die noch im Spiel ist – der Stich gehört euch.' };
    }
    // Sonst klein anspielen, wo der Partner helfen kann.
    const kandidaten = legal.filter((k) => farbeVon(k) !== T);
    const pool = kandidaten.length ? kandidaten : legal;
    const p = partner(v.sitz);
    // Hat der Partner diese Farbe angezeigt (und hat sie noch)?
    const vomPartner = (f) => !!(v.angezeigt && (v.angezeigt[p] & bit(f)) && !(v.leer[p] & bit(f)));
    // Halte ich eine der zwei höchsten Karten dieser Farbe, die noch im Spiel sind?
    const starkIn = (f) => {
      const offen = [];
      for (let w = 0; w < 9; w++) { const x = f * 9 + w; if (!v.gespielt[x]) offen.push(x); }
      offen.sort((a, b) => STAERKE[eff][b] - STAERKE[eff][a]);
      return offen.slice(0, 2).some((x) => v.hand.includes(x));
    };
    const k = minNach(pool, (x) => {
      const f = farbeVon(x);
      let c = PUNKTE[eff][x] * 3 + (STAERKE[eff][x] % 100);
      const asDraussen = hoehereDraussen(x, eff, v.gespielt, v.hand);
      if (PUNKTE[eff][x] >= 10 && asDraussen > 0) c += 15; // eine Zehn nicht ohne Schutz anspielen
      if (T >= 0 && (v.leer[p] & bit(f)) && !(v.leer[p] & bit(T))) c -= 20; // Partner kann stechen
      if (f !== T && vomPartner(f)) c -= 25; // die Farbe zurückspielen, die der Partner angezeigt hat
      else if (f !== T && istTief(x, eff) && starkIn(f)) c -= 6; // selbst anzeigen
      c -= farbLaenge(v.hand, f) * 1.5;
      return c;
    });
    const f = farbeVon(k);
    if (T >= 0 && (v.leer[p] & bit(f)) && !(v.leer[p] & bit(T))) {
      return { karte: k, grund: 'Dein Partner hat diese Farbe nicht mehr und kann stechen – spiel sie ihm zu.' };
    }
    if (f !== T && vomPartner(f)) return { karte: k, grund: GRUND_ZURUECK };
    if (f !== T && istTief(k, eff) && starkIn(f)) return { karte: k, grund: GRUND_ANZEIGEN };
    return { karte: k, grund: 'Kein sicherer Stich: Spiel eine tiefe Karte aus deiner längsten Farbe an und schone deine hohen Karten.' };
  }

  function farbLaenge(hand, f) {
    let n = 0;
    for (const x of hand) if (farbeVon(x) === f) n++;
    return n;
  }

  function zugeben(v, eff, legal) {
    const T = trumpfVon(eff);
    const p = v.stich.length;
    const gi = gewinnerIndex(v.stich, eff);
    const vorne = v.stichSitze[gi];
    const vorneKarte = v.stich[gi];
    const partnerVorne = team(vorne) === team(v.sitz);
    const letzter = p === 3;
    let wert = stichPunkte(v.stich, eff) + (v.stichNr === 8 ? v.regeln.letzterStich : 0);
    const gewinner = legal.filter((k) => schlaegt(k, vorneKarte, eff));
    const verlierer = legal.filter((k) => !schlaegt(k, vorneKarte, eff));

    if (partnerVorne) {
      const fV = farbeVon(vorneKarte);
      const bossImStich = hoehereDraussen(vorneKarte, eff, v.gespielt, v.hand) === 0;
      const sicher = letzter || (bossImStich && (fV === T || !gegnerKannStechen(v, eff)));
      const pool = verlierer.length ? verlierer : legal;
      if (sicher) {
        const k = maxNach(pool, (x) => {
          let s = PUNKTE[eff][x];
          if (farbeVon(x) === T) s -= 12 + (STAERKE[eff][x] - 100);
          else if (hoehereDraussen(x, eff, v.gespielt, v.hand) === 0 && farbeVon(x) !== farbeVon(v.stich[0])) s -= 6;
          return s;
        });
        if (PUNKTE[eff][k] > 0) return { karte: k, grund: 'Schmieren: Dein Partner macht diesen Stich sicher – gib ihm Punkte mit.' };
        return { karte: k, grund: 'Dein Partner macht den Stich – du hast keine Punkte zum Schmieren, also gibst du eine tiefe Karte.' };
      }
      const sicherer = gewinner.filter((k) => farbeVon(k) !== T && hoehereDraussen(k, eff, v.gespielt, v.hand) === 0);
      if (sicherer.length && wert >= 10) {
        return { karte: minNach(sicherer, (k) => PUNKTE[eff][k]), grund: 'Dein Partner liegt vorne, aber nicht sicher – mit deinem Bock sicherst du den Stich ab.' };
      }
      return { karte: minNach(pool, (k) => abwurfKosten(k, v, eff)), grund: 'Dein Partner liegt vorne – gib eine tiefe Karte und hoffe, dass der Stich hält.' };
    }

    if (gewinner.length) {
      const nichtTrumpf = gewinner.filter((k) => farbeVon(k) !== T);
      const trumpf = gewinner.filter((k) => farbeVon(k) === T);
      if (letzter) {
        if (nichtTrumpf.length) {
          const k = minNach(nichtTrumpf, (x) => (hoehereDraussen(x, eff, v.gespielt, v.hand) === 0 ? 6 : 0) - PUNKTE[eff][x] * 0.5 + (STAERKE[eff][x] % 100) * 0.2);
          return { karte: k, grund: 'Du bist der Letzte und kannst den Stich machen – nimm ihn.' };
        }
        const k = minNach(trumpf, (x) => trumpfKosten(x, eff));
        const viele = farbLaenge(v.hand, T) >= 3;
        if (wert >= 8 || v.stichNr === 8 || viele) return { karte: k, grund: 'Du bist der Letzte: Mit einem Trumpf holst du dir ' + wert + ' Punkte.' };
      } else {
        const boecke = nichtTrumpf.filter((k) => hoehereDraussen(k, eff, v.gespielt, v.hand) === 0);
        if (boecke.length && (wert >= 4 || !gegnerKannStechen(v, eff))) {
          return { karte: minNach(boecke, (k) => -PUNKTE[eff][k]), grund: 'Mit deinem Bock übernimmst du den Stich – höher geht es in dieser Farbe nicht mehr.' };
        }
        if (trumpf.length && (wert >= 10 || v.stichNr === 8)) {
          const k = minNach(trumpf, (x) => trumpfKosten(x, eff));
          return { karte: k, grund: 'Im Stich liegen ' + wert + ' Punkte – das lohnt sich zu stechen.' };
        }
        if (nichtTrumpf.length && wert >= 10) {
          return { karte: minNach(nichtTrumpf, (k) => STAERKE[eff][k]), grund: 'Im Stich liegen viele Punkte – versuch ihn zu übernehmen.' };
        }
      }
    }
    const pool = verlierer.length ? verlierer : legal;
    const k = minNach(pool, (x) => abwurfKosten(x, v, eff));
    return { karte: k, grund: farbeVon(k) === farbeVon(v.stich[0]) ? GRUND_ZUGEBEN : GRUND_VERWERFEN };
  }

  const GRUND_ZURUECK = 'Dein Partner hat diese Farbe angezeigt: Er ist dort stark. Spiel sie ihm zurück.';
  const GRUND_ANZEIGEN = 'Anzeigen: Spiel eine tiefe Karte der Farbe, in der du stark bist – so weiss dein Partner, was er dir zurückspielen soll.';
  const GRUND_ZUGEBEN = 'Du kannst den Stich nicht billig machen – gib die Karte, die am wenigsten wert ist.';
  const GRUND_VERWERFEN = 'Du hast die Farbe nicht und kannst den Stich nicht billig machen – verwirf eine Karte, die wenig wert ist.';

  function misereZug(v, eff, legal) {
    if (!v.stich.length) {
      const k = minNach(legal, (x) => {
        const hoeher = hoehereDraussen(x, eff, v.gespielt, v.hand);
        return -hoeher * 4 + STAERKE[eff][x];
      });
      return { karte: k, grund: 'Misère: Spiel eine tiefe Karte an, die bestimmt jemand anderes überstechen muss.' };
    }
    const gi = gewinnerIndex(v.stich, eff);
    const vorneKarte = v.stich[gi];
    const partnerVorne = team(v.stichSitze[gi]) === team(v.sitz);
    const verlierer = legal.filter((k) => !schlaegt(k, vorneKarte, eff));
    if (verlierer.length) {
      if (partnerVorne) return { karte: maxNach(verlierer, (k) => STAERKE[eff][k] - PUNKTE[eff][k] * 2), grund: 'Misère: Dein Partner hat den Stich – wirf eine hohe Karte ohne Punkte ab.' };
      return { karte: maxNach(verlierer, (k) => PUNKTE[eff][k] * 2 + STAERKE[eff][k]), grund: 'Misère: Der Gegner bekommt den Stich – lade ihm Punkte und hohe Karten auf.' };
    }
    if (v.stich.length === 3) return { karte: maxNach(legal, (k) => STAERKE[eff][k]), grund: 'Misère: Den Stich musst du nehmen – dann wenigstens die gefährlichste Karte los werden.' };
    return { karte: minNach(legal, (k) => STAERKE[eff][k]), grund: 'Misère: Du musst überstechen – mit der kleinstmöglichen Karte.' };
  }

  // ------------------------------------------------------------ Simulation
  // Ein schneller Spielzustand für das Durchspielen vieler Welten.

  function simNeu(code, regeln, haende, ausspieler, angesagtVon) {
    return {
      code, regeln, haende, angesagtVon,
      stich: [], stichSitze: [], stichNr: 0, amZug: ausspieler,
      punkte: [0, 0], stichZahl: [0, 0],
      gespielt: new Uint8Array(36), leer: [0, 0, 0, 0], angezeigt: [0, 0, 0, 0],
    };
  }

  function simKopie(s) {
    return {
      code: s.code, regeln: s.regeln, angesagtVon: s.angesagtVon,
      haende: s.haende.map((h) => h.slice()),
      stich: s.stich.slice(), stichSitze: s.stichSitze.slice(), stichNr: s.stichNr, amZug: s.amZug,
      punkte: s.punkte.slice(), stichZahl: s.stichZahl.slice(),
      gespielt: s.gespielt.slice(), leer: s.leer.slice(), angezeigt: s.angezeigt.slice(),
    };
  }

  function simSpiele(s, k) {
    const sitz = s.amZug;
    const hand = s.haende[sitz];
    hand.splice(hand.indexOf(k), 1);
    const eff = effModus(s.code, s.stichNr);
    if (!s.stich.length) {
      // tief angespielt = angezeigt (ausser man spielt dem Partner seine Farbe zurück)
      const f = farbeVon(k);
      if (f !== trumpfVon(eff) && istTief(k, eff) && !(s.angezeigt[partner(sitz)] & bit(f))) s.angezeigt[sitz] |= bit(f);
    } else {
      const led = farbeVon(s.stich[0]);
      const f = farbeVon(k);
      const T = trumpfVon(eff);
      if (f !== led) {
        if (led === T) s.leer[sitz] |= bit(T);
        else if (f !== T) s.leer[sitz] |= bit(led);
      }
    }
    s.stich.push(k);
    s.stichSitze.push(sitz);
    s.gespielt[k] = 1;
    if (s.stich.length < 4) { s.amZug = (sitz + 1) % 4; return; }
    const gi = gewinnerIndex(s.stich, eff);
    const sieger = s.stichSitze[gi];
    let p = stichPunkte(s.stich, eff);
    if (s.stichNr === 8) p += s.regeln.letzterStich;
    s.punkte[team(sieger)] += p;
    s.stichZahl[team(sieger)] += 1;
    s.stich = [];
    s.stichSitze = [];
    s.stichNr += 1;
    s.amZug = sieger;
  }

  function simAnsicht(s) {
    const sitz = s.amZug;
    return {
      sitz, hand: s.haende[sitz], stich: s.stich, stichSitze: s.stichSitze, stichNr: s.stichNr,
      code: s.code, regeln: s.regeln, gespielt: s.gespielt, leer: s.leer, angesagtVon: s.angesagtVon, angezeigt: s.angezeigt,
    };
  }

  function simZuEnde(s) {
    while (s.stichNr < 9) simSpiele(s, mittelZug(simAnsicht(s)).karte);
  }

  // Bewertung aus Sicht eines Teams: eigene Punkte minus fremde.
  function simWert(s, meinTeam) {
    let d = s.punkte[meinTeam] - s.punkte[1 - meinTeam];
    if (s.code === 'MIS') d = -d;
    else if (s.regeln.matchBonus) {
      if (s.stichZahl[meinTeam] === 9) d += s.regeln.matchPunkte;
      else if (s.stichZahl[1 - meinTeam] === 9) d -= s.regeln.matchPunkte;
    }
    return d;
  }

  // Exakte Suche für die letzten Stiche (alle Karten offen).
  function exakt(s, meinTeam, alpha, beta) {
    if (s.stichNr === 9) return simWert(s, meinTeam);
    const sitz = s.amZug;
    const eff = effModus(s.code, s.stichNr);
    const legal = erlaubteKarten(s.haende[sitz], s.stich, eff, s.regeln);
    const max = team(sitz) === meinTeam;
    let best = max ? -Infinity : Infinity;
    for (const k of legal) {
      const sicherung = sichern(s);
      simSpieleRoh(s, k, eff);
      const w = exakt(s, meinTeam, alpha, beta);
      zurueck(s, sicherung, sitz, k);
      if (max) { if (w > best) best = w; if (best > alpha) alpha = best; }
      else { if (w < best) best = w; if (best < beta) beta = best; }
      if (alpha >= beta) break;
    }
    return best;
  }

  function sichern(s) {
    return { stich: s.stich.slice(), stichSitze: s.stichSitze.slice(), stichNr: s.stichNr, amZug: s.amZug, p0: s.punkte[0], p1: s.punkte[1], z0: s.stichZahl[0], z1: s.stichZahl[1] };
  }
  function zurueck(s, z, sitz, k) {
    s.haende[sitz].push(k);
    s.stich = z.stich; s.stichSitze = z.stichSitze; s.stichNr = z.stichNr; s.amZug = z.amZug;
    s.punkte[0] = z.p0; s.punkte[1] = z.p1; s.stichZahl[0] = z.z0; s.stichZahl[1] = z.z1;
  }
  function simSpieleRoh(s, k, eff) {
    const sitz = s.amZug;
    const hand = s.haende[sitz];
    hand.splice(hand.indexOf(k), 1);
    s.stich = s.stich.concat(k);
    s.stichSitze = s.stichSitze.concat(sitz);
    if (s.stich.length < 4) { s.amZug = (sitz + 1) % 4; return; }
    const gi = gewinnerIndex(s.stich, eff);
    const sieger = s.stichSitze[gi];
    let p = stichPunkte(s.stich, eff);
    if (s.stichNr === 8) p += s.regeln.letzterStich;
    s.punkte[team(sieger)] += p;
    s.stichZahl[team(sieger)] += 1;
    s.stich = [];
    s.stichSitze = [];
    s.stichNr += 1;
    s.amZug = sieger;
  }

  // ------------------------------------------------------- Wissen & Welten

  // Was der Spieler auf `sitz` über die Runde weiss: gespielte Karten,
  // wer welche Farbe nicht mehr hat, gezeigte Weise, angezeigte Farben.
  function wissen(spiel, sitz) {
    const runde = spiel.runde;
    const gespielt = new Uint8Array(36);
    const leer = [0, 0, 0, 0];
    const angezeigt = [0, 0, 0, 0];
    const anzeigen = [];   // { sitz, farbe, hoch: [zwei Karten] }
    const puurOffen = [false, false, false, false];
    const T0 = runde.code ? MODI[runde.code].trumpf : -1;
    const alle = runde.stiche.map((s) => ({ karten: s.karten, sitze: s.sitze, nr: runde.stiche.indexOf(s) }));
    alle.push({ karten: runde.stich, sitze: runde.stichSitze, nr: runde.stichNr });
    for (const st of alle) {
      if (!st.karten.length) continue;
      const eff = effModus(runde.code, st.nr);
      const T = trumpfVon(eff);
      const led = farbeVon(st.karten[0]);
      st.karten.forEach((k, i) => {
        if (i === 0) {
          const s = st.sitze[0];
          const hoch = anzeigeHoch(k, eff, gespielt);
          if (hoch && !(angezeigt[partner(s)] & bit(farbeVon(k)))) {
            angezeigt[s] |= bit(farbeVon(k));
            anzeigen.push({ sitz: s, farbe: farbeVon(k), hoch });
          }
        }
        gespielt[k] = 1;
        if (i === 0) return;
        const f = farbeVon(k);
        const s = st.sitze[i];
        if (f === led) return;
        if (led === T) { leer[s] |= bit(T); puurOffen[s] = spiel.regeln.puurFrei !== false; }
        else if (f !== T) leer[s] |= bit(led);
      });
    }
    // Wurde der Buur inzwischen gespielt, ist die Ausnahme hinfällig.
    if (T0 >= 0 && gespielt[J.karte(T0, WB)]) for (let s = 0; s < 4; s++) puurOffen[s] = false;
    const bekannt = [[], [], [], []];
    if (runde.weis && runde.weis.siegerTeam >= 0 && runde.stichNr >= 1) {
      for (let s = 0; s < 4; s++) {
        if (s === sitz || team(s) !== runde.weis.siegerTeam) continue;
        for (const w of runde.weis.proSitz[s]) for (const k of w.karten) if (!gespielt[k] && !bekannt[s].includes(k)) bekannt[s].push(k);
      }
    }
    return { gespielt, leer, puurOffen, bekannt, trumpf: T0, angezeigt, anzeigen };
  }

  // Verteilt die unbekannten Karten passend zum Wissen auf die anderen.
  function welt(spiel, sitz, w, rng) {
    const runde = spiel.runde;
    const meine = runde.haende[sitz];
    const bekanntAlle = new Set(w.bekannt.flat());
    const unbekannt = [];
    for (let k = 0; k < 36; k++) if (!w.gespielt[k] && !meine.includes(k) && !bekanntAlle.has(k)) unbekannt.push(k);
    const braucht = [0, 1, 2, 3].map((s) => (s === sitz ? 0 : runde.haende[s].length - w.bekannt[s].length));
    const puur = w.trumpf >= 0 ? J.karte(w.trumpf, WB) : -1;
    const darf = (s, k) => {
      const f = farbeVon(k);
      if (!(w.leer[s] & bit(f))) return true;
      return k === puur && w.puurOffen[s];
    };
    for (let versuch = 0; versuch < 40; versuch++) {
      const haende = [0, 1, 2, 3].map((s) => (s === sitz ? meine.slice() : w.bekannt[s].slice()));
      const frei = braucht.slice();
      const karten = J.mische(unbekannt, rng);
      const moeglich = (k) => { let n = 0; for (let s = 0; s < 4; s++) if (s !== sitz && frei[s] > 0 && darf(s, k)) n++; return n; };
      karten.sort((a, b) => moeglich(a) - moeglich(b));
      let ok = true;
      for (const k of karten) {
        let summe = 0;
        for (let s = 0; s < 4; s++) if (s !== sitz && frei[s] > 0 && darf(s, k)) summe += frei[s];
        if (!summe) { ok = false; break; }
        let r = rng() * summe;
        let ziel = -1;
        for (let s = 0; s < 4; s++) {
          if (s === sitz || frei[s] <= 0 || !darf(s, k)) continue;
          r -= frei[s];
          if (r < 0) { ziel = s; break; }
        }
        if (ziel < 0) for (let s = 3; s >= 0; s--) if (s !== sitz && frei[s] > 0 && darf(s, k)) { ziel = s; break; }
        haende[ziel].push(k);
        frei[ziel]--;
      }
      if (ok) return haende;
    }
    // Widersprüchliches Wissen: ohne Einschränkungen verteilen.
    const haende = [0, 1, 2, 3].map((s) => (s === sitz ? meine.slice() : w.bekannt[s].slice()));
    const karten = J.mische(unbekannt, rng);
    let i = 0;
    for (let s = 0; s < 4; s++) if (s !== sitz) while (haende[s].length < runde.haende[s].length) haende[s].push(karten[i++]);
    return haende;
  }

  function simAusSpiel(spiel, haende, w) {
    const runde = spiel.runde;
    const s = simNeu(runde.code, spiel.regeln, haende, runde.amZug, runde.angesagtVon);
    s.stich = runde.stich.slice();
    s.stichSitze = runde.stichSitze.slice();
    s.stichNr = runde.stichNr;
    s.punkte = runde.punkte.slice();
    s.stichZahl = runde.stichZahl.slice();
    s.gespielt = w.gespielt.slice();
    s.leer = w.leer.slice();
    s.angezeigt = w.angezeigt.slice();
    return s;
  }

  // ------------------------------------------------ Was die Ansage verrät
  // Wer Trumpf ansagt, hat meistens Karten dafür – wer nach dem Schieben
  // Kreuz sagt, fast immer den Buur. Wer schiebt, hat eine schwache Hand.
  // «Schwer» spielt darum nur Kartenverteilungen durch, die dazu passen.
  // Ob eine Hand passt, schätzt die Faustregel (schaetze) – mit etwas
  // Spielraum, weil Menschen und Computer nicht genau gleich ansagen.

  const GRUND_ZUR_ANSAGE = 'Ich habe viele Kartenverteilungen durchgespielt, die zur Ansage passen: Mit dieser Karte macht ihr im Schnitt am meisten Punkte.';
  const ANSAGE_TOLERANZ = 16;   // so viel schlechter (2 × geschätzte Punkte) darf die Ansage sein als die beste
  const SCHIEBEN_TOLERANZ = 6;  // so knapp über der Schiebe-Schwelle darf eine Hand noch geschoben werden

  function handWerte(hand, regeln) {
    const werte = {};
    let best = -Infinity, bestPunkte = 0;
    for (const c of J.erlaubteModi(regeln)) {
      const f = regeln.multiplikatoren ? Number(regeln.faktoren[c]) || 1 : 1;
      const p = schaetze(hand, c).punkte;
      werte[c] = (2 * p - 157) * f;
      if (werte[c] > best) { best = werte[c]; bestPunkte = p; }
    }
    return { werte, best, bestPunkte };
  }

  // Hätte jemand mit dieser Hand so angesagt?
  function passtZurAnsage(hand, regeln, code, darfSchieben) {
    const h = handWerte(hand, regeln);
    if (h.werte[code] == null || h.werte[code] < h.best - ANSAGE_TOLERANZ) return false;
    if (darfSchieben && h.bestPunkte < SCHIEBEN_SCHWELLE - SCHIEBEN_TOLERANZ) return false;
    return true;
  }
  // … oder geschoben?
  function passtZumSchieben(hand, regeln) {
    return handWerte(hand, regeln).bestPunkte < SCHIEBEN_SCHWELLE + SCHIEBEN_TOLERANZ;
  }

  // Was der Spieler auf `sitz` aus Ansage, Schieben und Anzeigen weiss –
  // oder null, wenn es nichts zu beachten gibt.
  //   anzeigen: wer eine Farbe angezeigt hat und welche zwei Karten er
  //             darum (wohl) hält – eine davon muss in seiner Hand sein,
  //             solange sie noch nicht gespielt ist.
  function ansageWissen(spiel, sitz, w) {
    const r = spiel.runde;
    if (!r.code) return null;
    const ansager = r.angesagtVon !== sitz ? r.angesagtVon : -1;
    const schieber = r.geschoben && r.ansager !== sitz ? r.ansager : -1;
    const gespieltVon = [[], [], [], []];
    for (const st of r.stiche) st.karten.forEach((k, i) => gespieltVon[st.sitze[i]].push(k));
    r.stich.forEach((k, i) => gespieltVon[r.stichSitze[i]].push(k));
    const anzeigen = [];
    for (const a of (w && w.anzeigen) || []) {
      if (a.sitz === sitz) continue;
      if (a.hoch.some((k) => gespieltVon[a.sitz].includes(k))) continue;   // hat er schon gezeigt
      const offen = a.hoch.filter((k) => !w.gespielt[k] && !r.haende[sitz].includes(k));
      if (offen.length) anzeigen.push({ sitz: a.sitz, offen });
    }
    if (ansager < 0 && schieber < 0 && !anzeigen.length) return null;
    return {
      ansager, schieber, code: r.code, gespieltVon, anzeigen,
      darfSchieben: ansager >= 0 && ansager === r.ansager && !!spiel.regeln.schieben,
    };
  }

  function passtZumWissen(haende, regeln, info, ohneAnzeigen) {
    const ganz = (s) => haende[s].concat(info.gespieltVon[s]);
    if (info.ansager >= 0 && !passtZurAnsage(ganz(info.ansager), regeln, info.code, info.darfSchieben)) return false;
    if (info.schieber >= 0 && !passtZumSchieben(ganz(info.schieber), regeln)) return false;
    if (!ohneAnzeigen) for (const a of info.anzeigen || []) if (!a.offen.some((k) => haende[a.sitz].includes(k))) return false;
    return true;
  }

  // Eine Welt, die zu Ansage, Schieben und Anzeigen passt. Findet sich
  // keine, zuerst ohne die Anzeigen (vielleicht war es keine), dann
  // irgendeine.
  function weltPassend(spiel, sitz, w, rng, info) {
    for (let versuch = 0; versuch < 120; versuch++) {
      const haende = welt(spiel, sitz, w, rng);
      if (passtZumWissen(haende, spiel.regeln, info, versuch >= 70)) return haende;
    }
    return welt(spiel, sitz, w, rng);
  }

  // ------------------------------------------------------- Stufe schwer

  function schwerZug(spiel, sitz, optionen) {
    const o = optionen || {};
    const runde = spiel.runde;
    const legal = J.erlaubteFuer(spiel, sitz);
    const ansicht = ansichtAus(spiel, sitz);
    const mittel = mittelZug(ansicht);
    if (legal.length === 1) return { karte: legal[0], grund: mittel.grund, werte: null };
    const w = wissen(spiel, sitz);
    const rng = o.rng || J.zufall(J.neuerSeed());
    const restKarten = runde.haende.reduce((n, h) => n + h.length, 0);
    const exaktAb = o.exaktAb != null ? o.exaktAb : 12;
    const welten = restKarten <= exaktAb ? (o.weltenExakt || 30) : (o.welten || 120);
    const summe = new Map(legal.map((k) => [k, 0]));
    const meinTeam = team(sitz);
    const info = o.ansageBeachten === false ? null : ansageWissen(spiel, sitz, o.anzeigenBeachten === false ? null : w);
    for (let i = 0; i < welten; i++) {
      const haende = info ? weltPassend(spiel, sitz, w, rng, info) : welt(spiel, sitz, w, rng);
      for (const k of legal) {
        const s = simAusSpiel(spiel, haende.map((h) => h.slice()), w);
        simSpiele(s, k);
        let wert;
        if (restKarten - 1 <= exaktAb) wert = exakt(s, meinTeam, -Infinity, Infinity);
        else { simZuEnde(s); wert = simWert(s, meinTeam); }
        summe.set(k, summe.get(k) + wert);
      }
    }
    const werte = legal.map((k) => ({ karte: k, wert: summe.get(k) / welten }));
    werte.sort((a, b) => b.wert - a.wert);
    // Bei (fast) gleichem Wert die Wahl der Faustregel nehmen.
    let wahl = werte[0];
    const m = werte.find((x) => x.karte === mittel.karte);
    if (m && wahl.wert - m.wert < 0.5) wahl = m;
    // Zurückspielen: Hat der Partner eine Farbe angezeigt und sieht die
    // Rechnung kaum einen Unterschied, spielt man ihm diese Farbe zurück –
    // die tiefste Karte, damit seine hohe den Stich macht.
    if (!runde.stich.length && o.anzeigenBeachten !== false) {
      const effA = effModus(runde.code, runde.stichNr);
      const p = partner(sitz);
      const zurueck = legal.filter((k) => farbeVon(k) !== trumpfVon(effA) && (w.angezeigt[p] & bit(farbeVon(k))) && !(w.leer[p] & bit(farbeVon(k))));
      if (zurueck.length) {
        const kand = minNach(zurueck, (k) => STAERKE[effA][k]);
        const x = werte.find((y) => y.karte === kand);
        if (x && werte[0].wert - x.wert <= ZURUECK_SCHWELLE) return { karte: kand, grund: GRUND_ZURUECK, werte };
      }
    }
    // Verwerfen: Sieht die Rechnung kaum einen Unterschied, kommt die Karte
    // aus der schwächsten Farbe – so kann der Partner daraus lesen, wo man
    // nichts hat. Gemessen kostet das nichts (werkzeuge/verwerfen.js).
    const schwelle = o.verwerfSchwelle != null ? o.verwerfSchwelle : VERWERF_SCHWELLE;
    const vk = schwelle > 0 ? verwerfKarte(ansicht, effModus(runde.code, runde.stichNr), legal) : null;
    if (vk != null) {
      const x = werte.find((y) => y.karte === vk);
      if (x && werte[0].wert - x.wert <= schwelle) return { karte: vk, grund: GRUND_VERWERFEN_SCHWACH, werte };
    }
    let grund = mittel.grund;
    if (wahl.karte !== mittel.karte) {
      grund = info
        ? 'Ich habe ' + welten + ' mögliche Kartenverteilungen durchgespielt, die zur Ansage passen: Mit dieser Karte macht ihr im Schnitt am meisten Punkte.'
        : 'Ich habe ' + welten + ' mögliche Kartenverteilungen durchgespielt: Mit dieser Karte macht ihr im Schnitt am meisten Punkte.';
    }
    return { karte: wahl.karte, grund, werte };
  }

  // Bis zu diesem Unterschied (eigene minus fremde Punkte, also rund die
  // Hälfte in eigenen Punkten) gelten zwei Karten beim Verwerfen als gleich
  // gut – kleiner als das, was das Durchspielen sicher unterscheiden kann.
  const VERWERF_SCHWELLE = 2;
  const ZURUECK_SCHWELLE = 2;
  const GRUND_VERWERFEN_SCHWACH = 'Verwerfen: Du hast die Farbe nicht, und die Rechnung sieht kaum einen Unterschied – also eine tiefe Karte aus deiner schwächsten Farbe. So weiss dein Partner, wo du nichts hast.';

  // Verwerfen heisst: Die ausgespielte Farbe fehlt, ein Gegner liegt vorne,
  // und man gibt eine Karte einer anderen Farbe (keinen Trumpf). Dann die
  // tiefste Karte aus der schwächsten Farbe – dort, wo die eigene beste
  // Karte am meisten noch nicht gespielte Karten über sich hat. Gibt es
  // nur eine Farbe zur Wahl, ist es kein Verwerfen: null.
  function verwerfKarte(v, eff, legal) {
    if (!v.stich.length) return null;
    const T = trumpfVon(eff);
    const led = farbeVon(v.stich[0]);
    if (v.hand.some((k) => farbeVon(k) === led)) return null;
    const gi = gewinnerIndex(v.stich, eff);
    if (team(v.stichSitze[gi]) === team(v.sitz)) return null;
    const kandidaten = legal.filter((k) => farbeVon(k) !== T && farbeVon(k) !== led);
    const farben = Array.from(new Set(kandidaten.map(farbeVon)));
    if (farben.length < 2) return null;
    const billig = (k) => PUNKTE[eff][k] * 2 + (STAERKE[eff][k] % 100) * 0.4;
    const tiefste = (f) => minNach(kandidaten.filter((k) => farbeVon(k) === f), billig);
    const schwaeche = (f) => {
      const top = maxNach(v.hand.filter((k) => farbeVon(k) === f), (k) => STAERKE[eff][k]);
      return hoehereDraussen(top, eff, v.gespielt, v.hand);
    };
    // Die schwächste Farbe; bei Gleichstand die mit der billigeren Karte.
    const f = farben.reduce((a, b) => {
      const d = schwaeche(b) - schwaeche(a);
      if (d !== 0) return d > 0 ? b : a;
      return billig(tiefste(b)) < billig(tiefste(a)) ? b : a;
    });
    return tiefste(f);
  }

  // Mit allen Karten offen: Wie viel bringt jede erlaubte Karte, wenn danach
  // alle perfekt spielen? Nur für die Analyse – im Spiel sieht niemand die
  // Karten der anderen. Ab vielen Karten zu langsam: dann null.
  function offenBewerten(spiel, sitz, maxKarten) {
    const runde = spiel.runde;
    const rest = runde.haende.reduce((n, h) => n + h.length, 0);
    if (rest > (maxKarten || 20)) return null;
    const legal = J.erlaubteFuer(spiel, sitz);
    const w = wissen(spiel, sitz);
    return legal.map((k) => {
      const s = simAusSpiel(spiel, runde.haende.map((h) => h.slice()), w);
      simSpiele(s, k);
      return { karte: k, wert: exakt(s, team(sitz), -Infinity, Infinity) };
    }).sort((a, b) => b.wert - a.wert);
  }

  function ansichtAus(spiel, sitz) {
    const runde = spiel.runde;
    const w = wissen(spiel, sitz);
    return {
      sitz, hand: runde.haende[sitz], stich: runde.stich, stichSitze: runde.stichSitze, stichNr: runde.stichNr,
      code: runde.code, regeln: spiel.regeln, gespielt: w.gespielt, leer: w.leer, angesagtVon: runde.angesagtVon, angezeigt: w.angezeigt,
    };
  }

  // ------------------------------------------------------------ Ansagen

  // Faustregel-Schätzung: wie viele Punkte macht das ansagende Team?
  // Die Gewichte sind an vielen durchgespielten Händen geeicht
  // (werkzeuge/eichen.js).
  const GEWICHT = {
    trumpf: { basis: 46.7, puur: 25.9, nell: 18.5, ass: 13.6, mittel: 8.6, klein: 6.0, laenge: 5.4, seitenAss: 2.7, seitenKoenig: 3.4, seitenZehn: -0.3, blank: 2.9 },
    obe: { basis: 59.4, ass: 11.1, koenig: 9.5, dame: 4.3, bauer: -0.3, zehn: 5.9, laenge: 3.7, leer: 2.0 },
  };

  function merkmaleTrumpf(hand, T) {
    const m = { puur: 0, nell: 0, ass: 0, mittel: 0, klein: 0, laenge: 0, seitenAss: 0, seitenKoenig: 0, seitenZehn: 0, blank: 0 };
    let n = 0;
    for (const k of hand) {
      const f = farbeVon(k), w = wertVon(k);
      if (f === T) {
        n++;
        if (w === WB) m.puur = 1;
        else if (w === W9) m.nell = 1;
        else if (w === WA) m.ass = 1;
        else if (w === WK || w === WD || w === W10) m.mittel++;
        else m.klein++;
      }
    }
    m.laenge = Math.max(0, n - 3);
    for (let f = 0; f < 4; f++) {
      if (f === T) continue;
      const werte = hand.filter((k) => farbeVon(k) === f).map(wertVon);
      if (werte.includes(WA)) m.seitenAss++;
      if (werte.includes(WA) && werte.includes(WK)) m.seitenKoenig++;
      if (werte.includes(WA) && werte.includes(W10)) m.seitenZehn++;
      if (werte.length <= 1 && n >= 3) m.blank++;
    }
    return m;
  }

  // Obenabe: ass/koenig/… zählen die sicheren Stiche von oben.
  // Für Undenufe dieselbe Rechnung mit gespiegelten Werten.
  function merkmaleObe(hand, unten) {
    const m = { ass: 0, koenig: 0, dame: 0, bauer: 0, zehn: 0, laenge: 0, leer: 0 };
    const hoch = unten ? [W6, W7, W8, W9, W10] : [WA, WK, WD, WB, W10];
    for (let f = 0; f < 4; f++) {
      const werte = hand.filter((k) => farbeVon(k) === f).map(wertVon);
      if (!werte.length) { m.leer++; continue; }
      let lauf = 0;
      while (lauf < hoch.length && werte.includes(hoch[lauf])) lauf++;
      if (lauf >= 1) m.ass++;
      if (lauf >= 2) m.koenig++;
      else if (!lauf && werte.includes(hoch[1]) && werte.length >= 2) m.koenig += 0.5;
      if (lauf >= 3) m.dame++;
      if (lauf >= 4) m.bauer++;
      if (lauf >= 5) m.zehn++;
      if (lauf >= 1) m.laenge += Math.max(0, werte.length - 3);
    }
    return m;
  }

  function schaetze(hand, code) {
    const info = MODI[code];
    if (info.trumpf >= 0) {
      const m = merkmaleTrumpf(hand, info.trumpf);
      const g = GEWICHT.trumpf;
      let p = g.basis;
      for (const key of Object.keys(m)) p += (g[key] || 0) * m[key];
      return { punkte: p, merkmale: m };
    }
    if (code === 'MIS') {
      // Misère: wenige hohe Karten sind gut.
      const m = merkmaleObe(hand, false);
      const p = 110 - (m.ass * 14 + m.koenig * 6 + m.dame * 3);
      return { punkte: p, merkmale: m };
    }
    const unten = code === 'UNE';
    if (code === 'SLO' || code === 'SLU') {
      const a = merkmaleObe(hand, false);
      const b = merkmaleObe(hand, true);
      const g = GEWICHT.obe;
      const p = g.basis + (a.ass + b.ass) * g.ass * 0.55 + (a.koenig + b.koenig) * g.koenig * 0.55;
      return { punkte: p, merkmale: { oben: a, unten: b } };
    }
    const m = merkmaleObe(hand, unten);
    const g = GEWICHT.obe;
    let p = g.basis;
    for (const key of Object.keys(m)) p += (g[key] || 0) * m[key];
    return { punkte: p, merkmale: m };
  }

  const SCHIEBEN_SCHWELLE = 101;

  function heuristikAnsage(hand, regeln, darfSchieben, rng, rauschen) {
    const modi = J.erlaubteModi(regeln);
    let best = null;
    for (const code of modi) {
      const f = regeln.multiplikatoren ? Number(regeln.faktoren[code]) || 1 : 1;
      let p = schaetze(hand, code).punkte;
      if (rauschen && rng) p += (rng() - 0.5) * rauschen;
      const wert = (2 * p - 157) * f;
      if (!best || wert > best.wert) best = { code, wert, punkte: p };
    }
    if (darfSchieben && best.punkte < SCHIEBEN_SCHWELLE) return { code: 'SCHIEBEN', wert: 0, punkte: best.punkte };
    return best;
  }

  // Monte-Carlo-Bewertung aller Ansagen. Schrittweise, damit eine
  // Oberfläche zwischendurch zeichnen kann.
  //   hand        die 9 Karten des Ansagers (Sitz 0)
  //   geschoben   true: der Partner hat geschoben, Schieben geht nicht mehr
  function bewertung(hand, regeln, optionen) {
    const o = optionen || {};
    const r = J.regelnMitStandard(regeln);
    const rng = o.rng || J.zufall(o.seed != null ? o.seed : J.neuerSeed());
    const modi = J.erlaubteModi(r);
    const darfSchieben = !o.geschoben && r.schieben !== false;
    const optionenListe = darfSchieben ? modi.concat('SCHIEBEN') : modi.slice();
    const summen = new Map(optionenListe.map((c) => [c, { diff: 0, eigene: 0, n: 0 }]));
    const rest = [];
    for (let k = 0; k < 36; k++) if (!hand.includes(k)) rest.push(k);
    let gemacht = 0;
    // Sitz 0 = ich. Ich bin Vorhand, wenn der Partner nicht geschoben hat;
    // sonst war der Partner (Sitz 2) Vorhand.
    const vorhand = o.geschoben ? 2 : 0;

    function spieleDurch(code, haende, ansager) {
      const ausspieler = r.ausspiel === 'ansager' ? ansager : vorhand;
      const s = simNeu(code, r, haende.map((h) => h.slice()), ausspieler, ansager);
      simZuEnde(s);
      let diff = simWert(s, 0);
      let eigene = code === 'MIS' ? s.punkte[1] : s.punkte[0];
      if (r.matchBonus && code !== 'MIS' && s.stichZahl[0] === 9) eigene += r.matchPunkte;
      // Weisen und Stöck gehören zur Ansage dazu.
      if (code !== 'MIS' && (r.weisen || r.stoeck)) {
        const extra = zusatzPunkte(code, haende, r, ausspieler);
        diff += extra[0] - extra[1];
        eigene += extra[0];
      }
      const f = r.multiplikatoren ? Number(r.faktoren[code]) || 1 : 1;
      return { diff: diff * f, eigene: eigene * f };
    }

    function schritt(anzahl) {
      for (let i = 0; i < anzahl; i++) {
        const karten = J.mische(rest, rng);
        const haende = [hand.slice(), karten.slice(0, 9), karten.slice(9, 18), karten.slice(18, 27)];
        for (const code of optionenListe) {
          let erg;
          if (code === 'SCHIEBEN') {
            const wahl = heuristikAnsage(haende[2], r, false);
            erg = spieleDurch(wahl.code, haende, 2);
          } else {
            erg = spieleDurch(code, haende, 0);
          }
          const z = summen.get(code);
          z.diff += erg.diff; z.eigene += erg.eigene; z.n++;
        }
        gemacht++;
      }
      return gemacht;
    }

    function ergebnis() {
      const liste = optionenListe.map((code) => {
        const z = summen.get(code);
        return { code, diff: z.n ? z.diff / z.n : 0, punkte: z.n ? z.eigene / z.n : 0, n: z.n };
      });
      liste.sort((a, b) => b.diff - a.diff);
      return liste;
    }

    return { schritt, ergebnis, get gemacht() { return gemacht; }, optionen: optionenListe };
  }

  function zusatzPunkte(code, haende, r, ausspieler) {
    const p = [0, 0];
    const eff = effModus(code, 0);
    if (r.weisen) {
      const w = J.werteWeiseAus(haende, eff, ausspieler);
      p[0] += w.punkte[0]; p[1] += w.punkte[1];
    }
    const T = MODI[code].trumpf;
    if (r.stoeck && T >= 0) {
      const s = haende.findIndex((h) => h.includes(J.karte(T, WK)) && h.includes(J.karte(T, WD)));
      if (s >= 0) p[team(s)] += r.stoeckPunkte;
    }
    return p;
  }

  // ------------------------------------------------------ Faustregeln
  // Erklärt, was für oder gegen eine Ansage spricht – als Liste fester Sätze,
  // damit jeder Satz einmal vorab vertont werden kann (jass-stimme.js).

  const ZAHL = ['Kein', 'Ein', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben', 'Acht', 'Neun'];
  const ZAHL_KLEIN = ['keins', 'eins', 'zwei', 'drei', 'vier'];          // das Ass
  const ZAHL_KLEIN_SECHSER = ['keiner', 'einer', 'zwei', 'drei', 'vier']; // der Sechser
  const TRUMPF_URTEIL = {
    sehrStark: 'Das ist ein sehr starker Trumpf.',
    stark: 'Buur und viele Trümpfe – stark.',
    gut: 'Mit dem Buur und drei Trümpfen kann man gut ansagen.',
    viele: 'Viele Trümpfe – auch ohne Buur ordentlich.',
    wenige: 'Zu wenige Trümpfe.',
    gefaehrlich: 'Ohne Buur und Nell ist ein Trumpf gefährlich – die Gegner stechen dich.',
    nell: 'Ohne den Buur kann dir der Gegner das Nell wegstechen.',
  };
  const SATZ_SCHIEBEN = 'Schieben lohnt sich, wenn keine Ansage richtig stark ist – dann wählt dein Partner mit seinen Karten.';
  const SATZ_MISERE = 'Für Misère braucht man viele tiefe Karten und wenige Asse.';
  const SATZ_SLALOM = 'Slalom wechselt jeden Stich zwischen Obenabe und Undenufe – gut mit hohen und tiefen Karten in derselben Farbe.';

  function trumpfSatz(n, puur, nell, ass) {
    let satz = n === 0 ? 'Kein Trumpf' : n === 1 ? 'Ein Trumpf' : ZAHL[n] + ' Trümpfe';
    const mit = [];
    if (puur) mit.push('Buur');
    if (nell) mit.push('Nell');
    if (ass) mit.push('Trumpf-Ass');
    if (mit.length) satz += ' mit ' + (mit.length === 1 ? mit[0] : mit.slice(0, -1).join(', ') + ' und ' + mit[mit.length - 1]);
    return satz + '.';
  }
  function seitenAssSatz(n) {
    if (n <= 0) return null;
    return n === 1 ? 'Dazu ein Ass in einer anderen Farbe.' : 'Dazu ' + ZAHL[n].toLowerCase() + ' Asse in anderen Farben.';
  }
  function obeKopf(unten, ass, mitZweiter) {
    const name = unten ? 'Undenufe' : 'Obenabe';
    if (!ass) return (unten ? 'Keine Sechs' : 'Kein Ass') + ' – bei ' + name + ' machst du so kaum einen sicheren Stich.';
    const zweite = unten ? 'der Sieben' : 'dem König';
    let satz = ass === 1 ? (unten ? 'Eine Sechs' : 'Ein Ass') : ZAHL[ass] + (unten ? ' Sechser' : ' Asse');
    const zahlKlein = unten ? ZAHL_KLEIN_SECHSER : ZAHL_KLEIN;
    if (mitZweiter >= 1) satz += ass === 1 ? ' mit ' + zweite : (mitZweiter === ass ? (ass === 2 ? ', beide mit ' : ', alle mit ') + zweite : ', ' + zahlKlein[mitZweiter] + ' davon mit ' + zweite);
    return satz + '.';
  }
  function obeUrteil(unten, ass) {
    if (ass >= 3) return unten ? 'Viele Sechser – gut für Undenufe.' : 'Viele Asse – gut für Obenabe.';
    if (ass === 2) return 'Zwei sichere Stiche – das ist ein Anfang.';
    if (ass === 1) return unten ? 'Für Undenufe braucht man mehr Sechser, am besten mit Siebnern dahinter.' : 'Für Obenabe braucht man mehr Asse, am besten mit Königen dahinter.';
    return null;
  }

  function faustregelTeile(hand, code) {
    if (code === 'SCHIEBEN') return [SATZ_SCHIEBEN];
    const T = MODI[code].trumpf;
    if (T >= 0) {
      const m = merkmaleTrumpf(hand, T);
      const n = hand.filter((k) => farbeVon(k) === T).length;
      const teile = [trumpfSatz(n, m.puur, m.nell, m.ass)];
      const seite = seitenAssSatz(m.seitenAss);
      if (seite) teile.push(seite);
      let u;
      if (m.puur && m.nell && n >= 4) u = 'sehrStark';
      else if (m.puur && n >= 4) u = 'stark';
      else if (m.puur && n === 3) u = 'gut';
      else if (n >= 5) u = 'viele';
      else if (n <= 2) u = 'wenige';
      else if (!m.puur && !m.nell) u = 'gefaehrlich';
      else u = 'nell';
      teile.push(TRUMPF_URTEIL[u]);
      return teile;
    }
    if (code === 'OBE' || code === 'UNE') {
      const unten = code === 'UNE';
      const hoch = unten ? [W6, W7] : [WA, WK];
      let ass = 0, mitZweiter = 0;
      for (let f = 0; f < 4; f++) {
        const werte = hand.filter((k) => farbeVon(k) === f).map(wertVon);
        if (werte.includes(hoch[0])) { ass++; if (werte.includes(hoch[1])) mitZweiter++; }
      }
      const teile = [obeKopf(unten, ass, mitZweiter)];
      const u = obeUrteil(unten, ass);
      if (u) teile.push(u);
      return teile;
    }
    if (code === 'MIS') return [SATZ_MISERE];
    return [SATZ_SLALOM];
  }

  function faustregel(hand, code) { return faustregelTeile(hand, code).join(' '); }

  // -------------------------------------------------------- Vorlesen
  // Was die Stimme sagt, ist eine Liste fester Sätze. Wo der angezeigte Text
  // eine Zahl hat, sagt die Stimme eine Fassung ohne Zahl.

  const ARTIKEL = ['die', 'die', 'die', 'die', 'die', 'den', 'die', 'den', 'das'];
  function sprechKarte(k, code) {
    const T = code && MODI[code] ? MODI[code].trumpf : -1;
    const f = farbeVon(k), w = wertVon(k);
    if (f === T && w === WB) return 'Spiel den Puur.';
    if (f === T && w === W9) return 'Spiel das Nell.';
    return 'Spiel ' + ARTIKEL[w] + ' ' + J.FARBEN[f].name + ' ' + J.WERT_NAMEN[w] + '.';
  }
  // Geschrieben heisst er «Buur», die Stimme sagt «Puur» – so sind die
  // Aufnahmen gemacht, und so klingt es richtig.
  const sprechform = (satz) => satz.replace(/\bBuur\b/g, 'Puur');

  function sprechGrund(grund) {
    if (/^Du bist der Letzte: Mit einem Trumpf holst du dir \d+ Punkte\.$/.test(grund)) return 'Du bist der Letzte: Mit einem Trumpf holst du dir die Punkte im Stich.';
    if (/^Im Stich liegen \d+ Punkte – das lohnt sich zu stechen\.$/.test(grund)) return 'Im Stich liegen genug Punkte – das lohnt sich zu stechen.';
    if (/^Ich habe \d+ mögliche Kartenverteilungen durchgespielt, die zur Ansage passen:/.test(grund)) return GRUND_ZUR_ANSAGE;
    if (/^Ich habe \d+ mögliche Kartenverteilungen durchgespielt:/.test(grund)) return 'Ich habe viele mögliche Kartenverteilungen durchgespielt: Mit dieser Karte macht ihr im Schnitt am meisten Punkte.';
    return sprechform(grund);
  }
  const MODUS_TIPP = {
    T0: 'Mein Tipp: Schaufel Trumpf.', T1: 'Mein Tipp: Herz Trumpf.', T2: 'Mein Tipp: Kreuz Trumpf.', T3: 'Mein Tipp: Ecke Trumpf.',
    OBE: 'Mein Tipp: Obenabe.', UNE: 'Mein Tipp: Undenufe.', SLO: 'Mein Tipp: Slalom, obenabe beginnt.', SLU: 'Mein Tipp: Slalom, undenufe beginnt.',
    MIS: 'Mein Tipp: Misère.', SCHIEBEN: 'Mein Tipp: Schieben.',
  };
  const SCHNITT_MAX = 160;
  function sprechSchnitt(punkte, mitMultiplikator) {
    const n = Math.round(punkte);
    if (mitMultiplikator || n < 0 || n > SCHNITT_MAX) return 'Im Schnitt die meisten Punkte für euch.';
    return 'Im Schnitt etwa ' + n + ' Punkte für euch.';
  }
  function sprechAnsage(hand, code, punkte, mitMultiplikator) {
    return [MODUS_TIPP[code], sprechSchnitt(punkte, mitMultiplikator)].concat(faustregelTeile(hand, code).map(sprechform));
  }

  // Alle Sätze, die die Stimme je sagen kann – zum Vertonen
  // (werkzeuge/stimme-google.mjs). Ein Test prüft, dass nichts fehlt.
  const GRUENDE = [
    'Nur diese Karte ist erlaubt.',
    'Trumpf ziehen: Du hast den höchsten Trumpf, der noch im Spiel ist. So holst du den Gegnern die Trümpfe heraus.',
    'Trumpf ziehen: Ihr habt angesagt und du hast viele Trümpfe – spiel einen kleinen, damit die hohen herauskommen.',
    'Du hast nur noch Trümpfe – der höchste macht den Stich sicher.',
    'Du hast nur noch Trümpfe – spiel den kleinsten.',
    'Bock spielen: Diese Karte ist die höchste ihrer Farbe, die noch im Spiel ist – der Stich gehört euch.',
    'Dein Partner hat diese Farbe nicht mehr und kann stechen – spiel sie ihm zu.',
    'Kein sicherer Stich: Spiel eine tiefe Karte aus deiner längsten Farbe an und schone deine hohen Karten.',
    'Schmieren: Dein Partner macht diesen Stich sicher – gib ihm Punkte mit.',
    'Dein Partner macht den Stich – du hast keine Punkte zum Schmieren, also gibst du eine tiefe Karte.',
    'Dein Partner liegt vorne, aber nicht sicher – mit deinem Bock sicherst du den Stich ab.',
    'Dein Partner liegt vorne – gib eine tiefe Karte und hoffe, dass der Stich hält.',
    'Du bist der Letzte und kannst den Stich machen – nimm ihn.',
    'Du bist der Letzte: Mit einem Trumpf holst du dir die Punkte im Stich.',
    'Mit deinem Bock übernimmst du den Stich – höher geht es in dieser Farbe nicht mehr.',
    'Im Stich liegen genug Punkte – das lohnt sich zu stechen.',
    'Im Stich liegen viele Punkte – versuch ihn zu übernehmen.',
    GRUND_ZUGEBEN,
    GRUND_VERWERFEN,
    GRUND_ZURUECK,
    GRUND_ANZEIGEN,
    GRUND_VERWERFEN_SCHWACH,
    'Misère: Spiel eine tiefe Karte an, die bestimmt jemand anderes überstechen muss.',
    'Misère: Dein Partner hat den Stich – wirf eine hohe Karte ohne Punkte ab.',
    'Misère: Der Gegner bekommt den Stich – lade ihm Punkte und hohe Karten auf.',
    'Misère: Den Stich musst du nehmen – dann wenigstens die gefährlichste Karte los werden.',
    'Misère: Du musst überstechen – mit der kleinstmöglichen Karte.',
    'Ich habe viele mögliche Kartenverteilungen durchgespielt: Mit dieser Karte macht ihr im Schnitt am meisten Punkte.',
    GRUND_ZUR_ANSAGE,
  ];
  function alleSprechTeile() {
    const s = new Set(GRUENDE.map(sprechform));
    const add = s.add.bind(s);
    s.add = (x) => add(sprechform(x));
    for (let k = 0; k < 36; k++) {
      s.add(sprechKarte(k, null));
      s.add(sprechKarte(k, 'T' + farbeVon(k)));
    }
    Object.values(MODUS_TIPP).forEach((x) => s.add(x));
    for (let n = 0; n <= SCHNITT_MAX; n++) s.add(sprechSchnitt(n, false));
    s.add(sprechSchnitt(0, true));
    for (let n = 0; n <= 9; n++) {
      for (const puur of [0, 1]) for (const nell of [0, 1]) for (const ass of [0, 1]) {
        if (puur + nell + ass <= n) s.add(trumpfSatz(n, puur, nell, ass));
      }
    }
    for (let n = 1; n <= 3; n++) s.add(seitenAssSatz(n));
    Object.values(TRUMPF_URTEIL).forEach((x) => s.add(x));
    for (const unten of [false, true]) {
      for (let ass = 0; ass <= 4; ass++) {
        for (let z = 0; z <= ass; z++) s.add(obeKopf(unten, ass, z));
        const u = obeUrteil(unten, ass);
        if (u) s.add(u);
      }
    }
    [SATZ_SCHIEBEN, SATZ_MISERE, SATZ_SLALOM].forEach((x) => s.add(x));
    return Array.from(s);
  }

  // --------------------------------------------------------------- API

  // Wie gründlich die Computer und der Tipp rechnen (Einstellung Rechentiefe).
  //   welten       so viele Kartenverteilungen werden durchgespielt
  //   weltenExakt  … wenn die letzten Stiche exakt gerechnet werden
  //   exaktAb      ab so vielen Karten auf dem Tisch wird exakt gerechnet
  //   ansage       so viele Verteilungen für die Wahl des Trumpfs
  // Standard ist «normal» mit 300 Verteilungen pro Zug.
  const RECHENTIEFE = {
    schnell: { welten: 120, weltenExakt: 30, exaktAb: 12, ansage: 80 },
    normal: { welten: 300, weltenExakt: 60, exaktAb: 12, ansage: 200 },
    gruendlich: { welten: 600, weltenExakt: 120, exaktAb: 12, ansage: 400 },
    maximal: { welten: 1000, weltenExakt: 200, exaktAb: 12, ansage: 600 },
  };
  function rechentiefe(name) { return RECHENTIEFE[name] || RECHENTIEFE.normal; }

  // stufe: 'schwer' (alle Computer in der App) oder 'mittel' (nur die
  // Faustregel – für Werkzeuge und Tests).
  function waehleKarte(spiel, sitz, stufe, optionen) {
    if (stufe === 'mittel') return mittelZug(ansichtAus(spiel, sitz));
    return schwerZug(spiel, sitz, optionen);
  }

  function waehleAnsage(spiel, sitz, stufe, optionen) {
    const runde = spiel.runde;
    const hand = runde.haende[sitz];
    const darf = J.darfSchieben(runde, spiel.regeln) && sitz === runde.ansager;
    if (stufe !== 'mittel') {
      const b = bewertung(hand, spiel.regeln, { geschoben: !darf, rng: (optionen && optionen.rng) || J.zufall(J.neuerSeed()) });
      b.schritt((optionen && (optionen.ansage || optionen.welten)) || 80);
      const liste = b.ergebnis();
      return { code: liste[0].code, grund: 'Durchgerechnet.', liste };
    }
    const w = heuristikAnsage(hand, spiel.regeln, darf);
    return { code: w.code, grund: faustregel(hand, w.code) };
  }

  const api = {
    waehleKarte, waehleAnsage, mittelZug, schwerZug, offenBewerten, RECHENTIEFE, rechentiefe, ansichtAus, wissen, welt,
    bewertung, heuristikAnsage, schaetze, faustregel, faustregelTeile, merkmaleTrumpf, merkmaleObe,
    sprechKarte, sprechGrund, sprechSchnitt, sprechAnsage, alleSprechTeile, sprechform,
    simNeu, simZuEnde, simWert, GEWICHT, SCHIEBEN_SCHWELLE, verwerfKarte, VERWERF_SCHWELLE,
    ansageWissen, passtZurAnsage, passtZumSchieben, passtZumWissen,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JassBot = api;
})(typeof self !== 'undefined' ? self : this);
