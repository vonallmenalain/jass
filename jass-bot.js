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

  // Ass schmieren als Zeichen: Wer die höchste Karte einer Nebenfarbe in
  // den Stich seines Partners gibt, zeigt, dass er dort sehr stark ist – er
  // hält auch die nächsten Karten (z. B. König und Dame). Gibt die zwei
  // höchsten Karten dieser Farbe zurück, die danach noch im Spiel sind, oder
  // null, wenn es kein solches Schmieren ist.
  function geschmierterBock(k, eff, gespieltVorher, stich, stichSitze, sitz) {
    if (!stich.length) return null;
    const f = farbeVon(k);
    if (f === farbeVon(stich[0]) || f === trumpfVon(eff) || !PUNKTE[eff][k]) return null;
    if (team(stichSitze[gewinnerIndex(stich, eff)]) !== team(sitz)) return null;
    const rest = [];
    for (let w = 0; w < 9; w++) {
      const x = f * 9 + w;
      if (x === k || gespieltVorher[x]) continue;
      if (STAERKE[eff][x] > STAERKE[eff][k]) return null;   // nicht die höchste
      rest.push(x);
    }
    if (!rest.length) return null;
    return rest.sort((a, b) => STAERKE[eff][b] - STAERKE[eff][a]).slice(0, 2);
  }
  // Halte ich nach der Karte k auch die nächsten (bis zu zwei) Karten
  // ihrer Farbe, die noch im Spiel sind? Dann bin ich dort «sehr stark».
  function sehrStarkNach(k, hand, eff, gespielt) {
    const f = farbeVon(k);
    const rest = [];
    for (let w = 0; w < 9; w++) {
      const x = f * 9 + w;
      if (x !== k && !gespielt[x] && STAERKE[eff][x] < STAERKE[eff][k]) rest.push(x);
    }
    rest.sort((a, b) => STAERKE[eff][b] - STAERKE[eff][a]);
    const naechste = rest.slice(0, 2);
    return naechste.length > 0 && naechste.every((x) => hand.includes(x));
  }

  // Die stärkste Karte einer Liste (oder null).
  const hoechste = (liste, eff) => (liste.length ? maxNach(liste, (k) => STAERKE[eff][k]) : null);

  // Gleichwertige Karten: Halte ich mehrere Karten einer Farbe, zwischen
  // denen keine fremde mehr im Spiel ist (Buur und Nell; im Undenufe Sechs
  // und Sieben), ist es für die Punkte gleich, welche zuerst kommt. Gibt die
  // höchste Karte dieser Reihe zurück.
  function hoechsteGleichwertige(k, hand, eff, gespielt) {
    const farbe = [];
    for (let w = 0; w < 9; w++) farbe.push(farbeVon(k) * 9 + w);
    farbe.sort((a, b) => STAERKE[eff][b] - STAERKE[eff][a]);
    let beste = k;
    for (let j = farbe.indexOf(k) - 1; j >= 0; j--) {
      const x = farbe[j];
      if (hand.includes(x)) beste = x;
      else if (!gespielt[x]) break;
    }
    return beste;
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
        const boss = hoechste(truempfe.filter((k) => hoehereDraussen(k, eff, v.gespielt, v.hand) === 0), eff);
        if (boss != null) return { karte: boss, grund: 'Trumpf ziehen: Du hast den höchsten Trumpf, der noch im Spiel ist. So holst du den Gegnern die Trümpfe heraus.' };
        if (truempfe.length >= 3) {
          return { karte: minNach(truempfe, (k) => STAERKE[eff][k]), grund: 'Trumpf ziehen: Ihr habt angesagt und du hast viele Trümpfe – spiel einen kleinen, damit die hohen herauskommen.' };
        }
      }
      if (truempfe.length === legal.length) {
        const boss = hoechste(truempfe.filter((k) => hoehereDraussen(k, eff, v.gespielt, v.hand) === 0), eff);
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
      // Jede erlaubte Karte schlägt die des Partners: Ich muss übernehmen und
      // mache den Stich selbst – das ist kein Schmieren. Die tiefste Karte,
      // die reicht; liegen darüber gleichwertige Karten (im Undenufe nach der
      // Sechs die Sieben und die Acht), die höchste davon zuerst.
      if (sicher && !verlierer.length) {
        const tiefste = minNach(legal, (x) => STAERKE[eff][x]);
        const k = hoechsteGleichwertige(tiefste, v.hand, eff, v.gespielt);
        return { karte: k, grund: k === tiefste ? GRUND_UEBERNEHMEN : GRUND_UEBERNEHMEN_GLEICH };
      }
      if (sicher) {
        const zeichen = (x) => farbeVon(x) !== T && farbeVon(x) !== farbeVon(v.stich[0]) && hoehereDraussen(x, eff, v.gespielt, v.hand) === 0;
        const k = maxNach(pool, (x) => {
          let s = PUNKTE[eff][x];
          if (farbeVon(x) === T) s -= 12 + (STAERKE[eff][x] - 100);
          else if (zeichen(x)) s += sehrStarkNach(x, v.hand, eff, v.gespielt) ? 2 : -6; // mit Ass, König und Dame: das Ass als Zeichen
          return s;
        });
        if (PUNKTE[eff][k] > 0 && zeichen(k) && sehrStarkNach(k, v.hand, eff, v.gespielt)) return { karte: k, grund: GRUND_ASS_SCHMIEREN };
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

  const GRUND_ASS_SCHMIEREN = 'Schmieren mit Zeichen: Gib die höchste Karte dieser Farbe – so weiss dein Partner, dass du dort sehr stark bist, und spielt sie dir später zurück.';
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
      if (f !== led && f !== T && PUNKTE[eff][k] && team(s.stichSitze[gewinnerIndex(s.stich, eff)]) === team(sitz)) {
        let hoechste = true;
        for (let w = 0; w < 9 && hoechste; w++) { const x = f * 9 + w; if (x !== k && !s.gespielt[x] && STAERKE[eff][x] > STAERKE[eff][k]) hoechste = false; }
        if (hoechste) s.angezeigt[sitz] |= bit(f);
      }
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

  function restIn(s) { return s.haende[0].length + s.haende[1].length + s.haende[2].length + s.haende[3].length; }

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

  // ------------------------------------------------- Kartenschätzung
  // Wie wahrscheinlich spielt jemand mit der Hand `hand` in dieser Lage die
  // Karte k? Ein kleines Modell (Softmax über die erlaubten Karten) auf
  // Merkmalen der Karte und der Hand – gelernt aus eigenen Partien des
  // Computers (werkzeuge/zug-daten.js, werkzeuge/zug-modell.js). Damit
  // gewichtet «Schwer» die denkbaren Verteilungen: Eine Verteilung, in der
  // die bisher gespielten Karten aller Spieler gut zu ihrer Hand passen,
  // zählt mehr – wer tief Herz anspielt, hat eher den Herz-Bock.

  // Gewichte aus werkzeuge/zug-modell.js (in MERKMALE-Reihenfolge).
  // (48 Werte, 82 213 Züge aus 3000 Computer-Partien, Treffer 58 % gegen Raten)
  const ZUG_GEWICHTE = [0, 0, -1.836, -0.19, -1.184, -0.367, 1.076, -0.332, -0.054, 0.946, 0.247, -0.682, 1.314, 1.274, 1.596, 0.489, -0.323, 0.233, 0.344, -0.742, 0.278, 0, 0, 1.651, -0.659, -1.389, 1.435, 1.27, -1.094, 1.089, 0.581, 0.179, 0.203, 2.576, 0.836, -0.376, 0, 0, 1.429, 0.112, 0.091, 0.498, -0.257, 0.26, -0.998, 0.811, 0.008, 2.616];

  const MERKMALE = [
    'konstante', 'anspielen', 'trumpf', 'punkte', 'bock', 'einHoeherer', 'hoehereAnteil',
    'farbLaenge', 'tiefsteFarbe', 'hoechsteFarbe', 'haltBock',
    'anspielen×tiefste×haltBock', 'anspielen×bock', 'anspielen×trumpf', 'anspielen×trumpf×früh',
    'anspielen×farbLaenge', 'anspielen×hoechste×nichtBock',
    'bedient', 'sticht', 'wirftAb', 'gewinnt', 'partnerVorne', 'letzter',
    'wirftAb×farbLaenge', 'wirftAb×haltBock', 'wirftAb×punkte', 'wirftAb×tiefste',
    'partnerVorne×punkte', 'partnerVorne×gewinnt', 'gegnerVorne×gewinnt', 'gegnerVorne×gewinnt×punkte',
    'letzter×gewinnt', 'sticht×partnerVorne', 'gewinnt×stichPunkte', 'bedient×tiefste', 'bedient×hoechste',
    'misere×gewinnt', 'misere×punkte', 'ohneTrumpf×anspielen×bock',
    // Konventionen (Anzeigen, Suchen, erstes Abwerfen)
    'haltZweite', 'anspielen×tiefste×sucht', 'anspielen×tiefste×sucht×trumpfWeg', 'anspielen×tiefste×schwach',
    'erstesAbwerfen', 'erstesAbwerfen×haltHoch', 'erstesAbwerfen×farbLaenge', 'erstesAbwerfen×tiefste',
    'wirftAb×partnerVorne×punkte',
  ];

  // Merkmale der Karte k (in `hand`) in der Lage { code, stichNr, stich,
  // stichSitze, sitz, gespielt: Uint8Array(36) } → Float64Array.
  function zugMerkmale(k, hand, lage, out) {
    const eff = effModus(lage.code, lage.stichNr);
    const T = trumpfVon(eff);
    const f = farbeVon(k);
    const n = lage.stich.length;
    const st = STAERKE[eff];
    const g = lage.gespielt;
    let hoeher = 0, laenge = 0, tiefste = 1, hoechste = 1, haltBock = 0;
    for (let w = 0; w < 9; w++) {
      const x = f * 9 + w;
      if (x === k) continue;
      const inHand = hand.includes(x);
      if (inHand) { laenge++; if (st[x] < st[k]) tiefste = 0; else hoechste = 0; }
      if (!g[x] && !inHand && st[x] > st[k]) hoeher++;
    }
    laenge++;
    // hält er die höchste noch offene Karte dieser Farbe?
    let top = -1, topW = -1;
    for (let w = 0; w < 9; w++) { const x = f * 9 + w; if (!g[x] && !lage.stich.includes(x) && st[x] > topW) { topW = st[x]; top = x; } }
    if (top >= 0 && hand.includes(top)) haltBock = 1;
    // die zweit- und dritthöchste noch offene Karte (z. B. König, Dame, wenn das Ass draussen ist)
    let haltZweite = 0, haltHoch = haltBock;
    {
      const offen = [];
      for (let w = 0; w < 9; w++) { const x = f * 9 + w; if (!g[x] && !lage.stich.includes(x)) offen.push(x); }
      offen.sort((a, b) => st[b] - st[a]);
      if (offen[1] != null && hand.includes(offen[1])) { haltZweite = 1; haltHoch = 1; }
      if (offen[2] != null && hand.includes(offen[2])) haltHoch = 1;
    }
    // Trümpfe, die noch bei anderen sein können
    let trumpfDraussen = 0;
    if (T >= 0) for (let w = 0; w < 9; w++) { const x = T * 9 + w; if (!g[x] && !hand.includes(x) && !lage.stich.includes(x)) trumpfDraussen++; }
    const bock = hoeher === 0 ? 1 : 0;
    const istT = f === T ? 1 : 0;
    const p = PUNKTE[eff][k] / 11;
    const an = n === 0 ? 1 : 0;
    let bedient = 0, sticht = 0, wirft = 0, gewinnt = 0, partnerV = 0, letzter = 0, stichP = 0;
    if (n > 0) {
      const led = farbeVon(lage.stich[0]);
      const gi = gewinnerIndex(lage.stich, eff);
      const best = lage.stich[gi];
      partnerV = team(lage.stichSitze[gi]) === team(lage.sitz) ? 1 : 0;
      gewinnt = schlaegt(k, best, eff) ? 1 : 0;
      bedient = f === led ? 1 : 0;
      sticht = !bedient && istT ? 1 : 0;
      wirft = !bedient && !istT ? 1 : 0;
      letzter = n === 3 ? 1 : 0;
      for (const x of lage.stich) stichP += PUNKTE[eff][x];
      stichP /= 30;
    }
    const mis = lage.code === 'MIS' ? 1 : 0;
    const frueh = lage.stichNr <= 2 ? 1 : 0;
    const L = laenge / 9;
    const nichtT = istT ? 0 : 1;
    const sucht = haltHoch && !haltBock ? 1 : 0;           // König/Dame ohne das Ass
    const trumpfWeg = T < 0 || trumpfDraussen === 0 ? 1 : 0;
    const schwach = haltHoch ? 0 : 1;
    const erstes = n > 0 && (lage.abgeworfen || 0) === 0 ? 1 : 0;
    const v = [
      1, an, istT, p, bock, hoeher === 1 ? 1 : 0, hoeher / 8,
      L, tiefste, hoechste, haltBock,
      an * tiefste * haltBock * (bock ? 0 : 1), an * bock, an * istT, an * istT * frueh,
      an * L, an * hoechste * (1 - bock),
      bedient, sticht, wirft, gewinnt, partnerV, letzter,
      wirft * L, wirft * haltBock, wirft * p, wirft * tiefste,
      partnerV * p, partnerV * gewinnt, (n > 0 ? 1 - partnerV : 0) * gewinnt, (n > 0 ? 1 - partnerV : 0) * gewinnt * p,
      letzter * gewinnt, sticht * partnerV, gewinnt * stichP, bedient * tiefste, bedient * hoechste,
      mis * gewinnt, mis * p, (T < 0 ? 1 : 0) * an * bock,
      haltZweite, an * tiefste * nichtT * sucht, an * tiefste * nichtT * sucht * trumpfWeg, an * tiefste * nichtT * schwach,
      wirft * erstes, wirft * erstes * haltHoch, wirft * erstes * L, wirft * erstes * tiefste,
      wirft * partnerV * p,
    ];
    const o = out || new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) o[i] = v[i];
    return o;
  }

  // log P(gespielte Karte | Hand, Lage) mit den Gewichten `gw`.
  function zugLogWahrscheinlichkeit(karte, hand, lage, regeln, gw, puffer) {
    const eff = effModus(lage.code, lage.stichNr);
    const legal = erlaubteKarten(hand, lage.stich, eff, regeln);
    if (legal.length <= 1) return 0;
    let max = -Infinity, wahl = 0;
    const werte = [];
    for (const k of legal) {
      const m = zugMerkmale(k, hand, lage, puffer);
      let z = 0;
      for (let i = 0; i < gw.length; i++) z += gw[i] * m[i];
      werte.push(z);
      if (z > max) max = z;
      if (k === karte) wahl = z;
    }
    let summe = 0;
    for (const z of werte) summe += Math.exp(z - max);
    return wahl - max - Math.log(summe);
  }

  // Die bisherigen Züge der anderen, einmal pro Entscheidung vorbereitet.
  function zugVerlauf(spiel, sitz) {
    const r = spiel.runde;
    const alle = r.stiche.map((st, i) => ({ karten: st.karten, sitze: st.sitze, nr: i }));
    if (r.stich.length) alle.push({ karten: r.stich, sitze: r.stichSitze, nr: r.stichNr });
    const zuege = [];
    const g = new Uint8Array(36);
    const abgeworfen = [0, 0, 0, 0];
    for (const st of alle) {
      const T = trumpfVon(effModus(r.code, st.nr));
      for (let i = 0; i < st.karten.length; i++) {
        const p = st.sitze[i];
        const k = st.karten[i];
        if (p !== sitz) {
          zuege.push({ p, k, lage: { code: r.code, stichNr: st.nr, stich: st.karten.slice(0, i), stichSitze: st.sitze.slice(0, i), sitz: p, gespielt: g.slice(), abgeworfen: abgeworfen[p] } });
        }
        if (i > 0 && farbeVon(k) !== farbeVon(st.karten[0]) && farbeVon(k) !== T) abgeworfen[p]++;
        g[k] = 1;
      }
    }
    // je Spieler: welche Karten er ab diesem Zug noch gespielt hat
    const spaeter = [[], [], [], []];
    for (let i = zuege.length - 1; i >= 0; i--) {
      const z = zuege[i];
      spaeter[z.p] = [z.k].concat(spaeter[z.p]);
      z.danach = spaeter[z.p].slice();
    }
    return zuege;
  }

  // log P(alle bisherigen Züge der anderen | diese Verteilung)
  function weltLogL(zuege, haende, regeln, gw, puffer) {
    let ll = 0;
    for (const z of zuege) {
      const hand = haende[z.p].concat(z.danach);
      ll += zugLogWahrscheinlichkeit(z.k, hand, z.lage, regeln, gw, puffer);
    }
    return ll;
  }

  // --------------------------------------------------- Schneller Löser
  // Dasselbe wie exakt() – alle Karten offen, beste Züge für beide Teams –,
  // aber schnell genug, um schon ab dem ersten Stich exakt zu rechnen:
  //   – Hände als Bitmasken je Farbe,
  //   – Zwischenspeicher (tt) für Stellungen zu Beginn eines Stichs,
  //   – Zugreihenfolge: bester Zug aus dem Speicher zuerst, dann hohe
  //     Karten beim Anspielen, billig stechen oder Punkte schmieren,
  //   – gleichwertige Karten (in der Stärke benachbart, gleich viele Punkte,
  //     in derselben Hand) werden nur einmal probiert.
  // Rückgabe wie exakt(): Wert (eigene − fremde Punkte, ± Match) für meinTeam.

  const ZOB = (() => {
    const r = J.zufall(0x51a7e);
    const z = new Int32Array(36 * 4 * 2);
    for (let i = 0; i < z.length; i++) z[i] = Math.floor(r() * 0x7fffffff);
    return z;
  })();
  // Werte (0–8) einer Farbe, von der stärksten zur schwächsten, je eff.
  const ORDNUNG = STAERKE.map((st) => [0, 1, 2, 3].map((f) => [0, 1, 2, 3, 4, 5, 6, 7, 8].sort((a, b) => st[f * 9 + b] - st[f * 9 + a])));

  let loeserKnoten = 0;

  function loese(s, meinTeam, tt) {
    const R = s.regeln;
    const code = s.code;
    const vz = code === 'MIS' ? -1 : 1;
    const matchAn = code !== 'MIS' && !!R.matchBonus;
    const mp = R.matchPunkte || 0;
    const puurFrei = R.puurFrei !== false;
    const unterVerboten = R.untertrumpfen !== true;
    const letzter = R.letzterStich || 0;
    const speicher = tt || new Map();

    const H = new Int32Array(16);
    let h1 = 0, h2 = 0;
    for (let p = 0; p < 4; p++) {
      for (const k of s.haende[p]) {
        H[p * 4 + ((k / 9) | 0)] |= 1 << (k % 9);
        h1 ^= ZOB[(k * 4 + p) * 2]; h2 ^= ZOB[(k * 4 + p) * 2 + 1];
      }
    }
    const tk = [0, 0, 0, 0], ts = [0, 0, 0, 0];
    let n = s.stich.length;
    for (let i = 0; i < n; i++) { tk[i] = s.stich[i]; ts[i] = s.stichSitze[i]; }
    let stichNr = s.stichNr, amZug = s.amZug;
    let z0 = s.stichZahl[0], z1 = s.stichZahl[1];
    // Welche eff kommen noch vor (Slalom wechselt) – für «gleich viele Punkte».
    const effs = [];
    for (let i = stichNr; i < 9; i++) { const e = effModus(code, i); if (!effs.includes(e)) effs.push(e); }
    const gleichePunkte = (k1, k2) => effs.every((e) => PUNKTE[e][k1] === PUNKTE[e][k2]);

    // erlaubte Karten als Masken je Farbe (wie J.erlaubteKarten)
    function erlaubt(p, eff, out) {
      const b = p * 4;
      if (n === 0) { out[0] = H[b]; out[1] = H[b + 1]; out[2] = H[b + 2]; out[3] = H[b + 3]; return; }
      const led = (tk[0] / 9) | 0;
      const T = eff < 4 ? eff : -1;
      const vonLed = H[b + led];
      out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
      if (T < 0) {
        if (vonLed) out[led] = vonLed; else { out[0] = H[b]; out[1] = H[b + 1]; out[2] = H[b + 2]; out[3] = H[b + 3]; }
        return;
      }
      if (led === T) {
        if (!vonLed || (puurFrei && vonLed === (1 << WB))) { out[0] = H[b]; out[1] = H[b + 1]; out[2] = H[b + 2]; out[3] = H[b + 3]; }
        else out[T] = vonLed;
        return;
      }
      out[led] = vonLed;
      let tr = H[b + T];
      if (tr && unterVerboten) {
        let hoch = -1;
        for (let i = 0; i < n; i++) if (((tk[i] / 9) | 0) === T && STAERKE[eff][tk[i]] > hoch) hoch = STAERKE[eff][tk[i]];
        const nurTr = !H[b] + !H[b + 1] + !H[b + 2] + !H[b + 3] === 3 && !!tr;
        if (hoch >= 0 && !nurTr) {
          let m = 0;
          for (let w = 0; w < 9; w++) if ((tr >> w) & 1 && STAERKE[eff][T * 9 + w] > hoch) m |= 1 << w;
          tr = m;
        }
      }
      out[T] = tr;
      if (!vonLed) for (let f = 0; f < 4; f++) if (f !== T && f !== led) out[f] = H[b + f];
    }

    const erlaubtPuffer = [];
    for (let i = 0; i < 40; i++) erlaubtPuffer.push([0, 0, 0, 0]);

    function suche(alpha, beta, tiefe) {
      loeserKnoten++;
      if (stichNr === 9) return matchAn ? (z1 === 0 ? mp : z0 === 0 ? -mp : 0) : 0;
      const eff = effModus(code, stichNr);
      const p = amZug;
      const max = (p & 1) === 0;
      // Zwischenspeicher zu Beginn eines Stichs
      let key = -1, eintrag = null;
      if (n === 0) {
        key = (h1 >>> 0) * 2097152 + (((h2 & 0x7fff) << 6) | (p << 2) | (matchAn ? (z1 === 0 ? 1 : 0) | (z0 === 0 ? 2 : 0) : 0));
        eintrag = speicher.get(key);
        if (eintrag) {
          if (eintrag[0] >= beta) return eintrag[0];
          if (eintrag[1] <= alpha) return eintrag[1];
          if (eintrag[0] > alpha) alpha = eintrag[0];
          if (eintrag[1] < beta) beta = eintrag[1];
          if (alpha >= beta) return eintrag[0];
        }
      }
      const a0 = alpha, b0 = beta;
      // Züge erzeugen (gleichwertige nur einmal) und ordnen
      const leg = erlaubtPuffer[tiefe];
      erlaubt(p, eff, leg);
      const zuege = [];
      const noten = [];
      const T = eff < 4 ? eff : -1;
      let gewinner = -1, bestK = -1;
      if (n > 0) { gewinner = 0; bestK = tk[0]; for (let i = 1; i < n; i++) if (schlaegt(tk[i], bestK, eff)) { bestK = tk[i]; gewinner = i; } }
      const meinTeamVorne = n > 0 && (ts[gewinner] & 1) === (p & 1);
      for (let f = 0; f < 4; f++) {
        const m = leg[f];
        if (!m) continue;
        const ord = ORDNUNG[eff][f];
        let letzte = -1, luecke = true;
        for (let j = 0; j < 9; j++) {
          const w = ord[j];
          const k = f * 9 + w;
          const bit1 = 1 << w;
          let fremd = false;
          for (let q = 0; q < 4; q++) if (q !== p && (H[q * 4 + f] & bit1)) { fremd = true; break; }
          if (!fremd) for (let i = 0; i < n; i++) if (tk[i] === k) { fremd = true; break; }
          if (fremd) { luecke = true; continue; }
          if (!(m & bit1)) continue;
          if (letzte >= 0 && !luecke && gleichePunkte(letzte, k)) continue;
          letzte = k; luecke = false;
          // Note für die Reihenfolge
          let note;
          if (n === 0) note = STAERKE[eff][k] + (f === T ? 30 : 0);
          else if (schlaegt(k, bestK, eff)) note = meinTeamVorne ? PUNKTE[eff][k] : 200 - STAERKE[eff][k] + PUNKTE[eff][k];
          else note = meinTeamVorne ? 100 + PUNKTE[eff][k] : -PUNKTE[eff][k] - STAERKE[eff][k] * 0.01;
          if (eintrag && eintrag[2] === k) note = 1e6;
          zuege.push(k); noten.push(note);
        }
      }
      // sortieren (Einfügen, wenige Züge)
      for (let i = 1; i < zuege.length; i++) {
        const k = zuege[i], v = noten[i];
        let j = i - 1;
        while (j >= 0 && noten[j] < v) { zuege[j + 1] = zuege[j]; noten[j + 1] = noten[j]; j--; }
        zuege[j + 1] = k; noten[j + 1] = v;
      }
      let best = max ? -Infinity : Infinity, bestZug = -1;
      for (let zi = 0; zi < zuege.length; zi++) {
        const k = zuege[zi];
        const f = (k / 9) | 0, w = k % 9;
        // spielen
        H[p * 4 + f] &= ~(1 << w);
        h1 ^= ZOB[(k * 4 + p) * 2]; h2 ^= ZOB[(k * 4 + p) * 2 + 1];
        tk[n] = k; ts[n] = p; n++;
        let wert;
        if (n < 4) {
          amZug = (p + 1) & 3;
          wert = suche(alpha, beta, tiefe + 1);
          amZug = p;
        } else {
          let g = 0;
          for (let i = 1; i < 4; i++) if (schlaegt(tk[i], tk[g], eff)) g = i;
          const sieger = ts[g];
          let pk = PUNKTE[eff][tk[0]] + PUNKTE[eff][tk[1]] + PUNKTE[eff][tk[2]] + PUNKTE[eff][tk[3]];
          if (stichNr === 8) pk += letzter;
          const c = vz * ((sieger & 1) === 0 ? pk : -pk);
          const merk0 = tk[0], merk1 = tk[1], merk2 = tk[2], s0 = ts[0], s1 = ts[1], s2 = ts[2];
          if ((sieger & 1) === 0) z0++; else z1++;
          n = 0; stichNr++; amZug = sieger;
          wert = c + suche(alpha - c, beta - c, tiefe + 1);
          stichNr--; amZug = p; n = 4;
          if ((sieger & 1) === 0) z0--; else z1--;
          tk[0] = merk0; tk[1] = merk1; tk[2] = merk2; ts[0] = s0; ts[1] = s1; ts[2] = s2;
        }
        // zurück
        n--;
        H[p * 4 + f] |= 1 << w;
        h1 ^= ZOB[(k * 4 + p) * 2]; h2 ^= ZOB[(k * 4 + p) * 2 + 1];
        if (max) { if (wert > best) { best = wert; bestZug = k; } if (best > alpha) alpha = best; }
        else { if (wert < best) { best = wert; bestZug = k; } if (best < beta) beta = best; }
        if (alpha >= beta) break;
      }
      if (key >= 0) {
        const alt = eintrag || [-Infinity, Infinity, -1];
        let lo = alt[0], hi = alt[1];
        if (best <= a0) hi = Math.min(hi, best);
        else if (best >= b0) lo = Math.max(lo, best);
        else { lo = best; hi = best; }
        speicher.set(key, [lo, hi, bestZug]);
      }
      return best;
    }

    const vorher = vz * (s.punkte[0] - s.punkte[1]);
    const wert0 = vorher + suche(-Infinity, Infinity, 0);
    return meinTeam === 0 ? wert0 : -wert0;
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
  // ---------------------------------------------- Ausspiel des Schiebers
  // Hat der Partner nach meinem Schieben angesagt und spiele ich aus, zeigt
  // mein Ausspiel, was ich habe (so spielen es die meisten Jasser):
  //   Trumpf               im ersten Stich meinen höchsten Trumpf – kommt
  //                        die Sechs, habe ich keinen anderen; kommt kein
  //                        Trumpf, habe ich keinen.
  //   Obenabe / Undenufe   von Beginn weg alle obersten Karten (die Asse,
  //                        im Undenufe die Sechsen) – kommt keine, habe ich
  //                        keine (mehr).
  // Gibt den Schieber zurück, wenn die Lage passt, sonst -1.
  function schieberSitz(runde) {
    if (!runde.code || !runde.geschoben || runde.angesagtVon !== partner(runde.ansager)) return -1;
    return runde.ansager;
  }
  // Ist k die oberste Karte ihrer Farbe, die noch im Spiel ist?
  function istOben(k, eff, gespielt) {
    const f = farbeVon(k);
    for (let w = 0; w < 9; w++) {
      const x = f * 9 + w;
      if (x !== k && !gespielt[x] && STAERKE[eff][x] > STAERKE[eff][k]) return false;
    }
    return true;
  }
  // Was die Ausspiele des Schiebers verraten: Karten, die er sicher nicht hat.
  function schieberNicht(runde, nicht) {
    const s = schieberSitz(runde);
    if (s < 0) return;
    const T0 = MODI[runde.code].trumpf;
    const alle = runde.stiche.map((st) => st.karten.length ? { karten: st.karten, sitze: st.sitze } : null).filter(Boolean);
    if (runde.stich.length) alle.push({ karten: runde.stich, sitze: runde.stichSitze });
    if (!alle.length || alle[0].sitze[0] !== s) return;
    if (T0 >= 0) {
      const eff = effModus(runde.code, 0);
      const k0 = alle[0].karten[0];
      for (let x = 0; x < 36; x++) {
        if (farbeVon(x) !== T0 || x === k0) continue;
        if (farbeVon(k0) !== T0 || STAERKE[eff][x] > STAERKE[eff][k0]) nicht[s][x] = 1;
      }
      return;
    }
    // Obenabe / Undenufe: solange er nur oberste Karten anspielt, läuft die
    // Reihe; die erste andere zeigt, dass er keine oberste mehr hat.
    const g = new Uint8Array(36);
    for (let i = 0; i < alle.length; i++) {
      const st = alle[i];
      const eff = effModus(runde.code, i);
      if (st.sitze[0] === s) {
        const k = st.karten[0];
        if (!istOben(k, eff, g)) {
          for (let x = 0; x < 36; x++) if (!g[x] && x !== k && istOben(x, eff, g)) nicht[s][x] = 1;
          return;
        }
      } else if (i > 0) return;   // ein anderer spielt aus: die Reihe ist zu Ende
      for (const k of st.karten) g[k] = 1;
    }
  }
  // ------------------------------------------ König (Sieben) verlangen
  // Obenabe: Wer angesagt hat und im ersten Stich selbst ausspielt, spielt
  // das Ass einer Farbe, in der ihm der König fehlt (z. B. Ass und Dame).
  // Sein Partner gibt den König darauf, wenn er ihn hat. Kommt er nicht,
  // hat ihn der Partner nicht – der Ansager wechselt die Farbe.
  // Undenufe genauso mit der Sechs und der Sieben.
  function verlangteKarte(k, eff) {
    // die zweitstärkste Karte der Farbe (König bzw. Sieben)
    const f = farbeVon(k);
    let best = -1, bestS = -1;
    for (let w = 0; w < 9; w++) { const x = f * 9 + w; if (x !== k && STAERKE[eff][x] > bestS) { bestS = STAERKE[eff][x]; best = x; } }
    return best;
  }
  function verlangenStich(runde) {
    // Der erste Stich, wenn der Ansager bei Obenabe/Undenufe selbst die
    // oberste Karte angespielt hat – sonst null.
    if (runde.code !== 'OBE' && runde.code !== 'UNE') return null;
    const st = runde.stiche.length ? { karten: runde.stiche[0].karten, sitze: runde.stiche[0].sitze } : { karten: runde.stich, sitze: runde.stichSitze };
    if (!st.karten.length || st.sitze[0] !== runde.angesagtVon) return null;
    const eff = effModus(runde.code, 0);
    const k0 = st.karten[0];
    if (!istOben(k0, eff, new Uint8Array(36))) return null;
    return { st, eff, k0, kv: verlangteKarte(k0, eff), ansager: runde.angesagtVon };
  }
  // Lesen: Hat der Partner des Ansagers die Farbe bedient, aber nicht die
  // verlangte Karte gegeben, hat er sie nicht.
  function verlangenNicht(runde, nicht) {
    const v = verlangenStich(runde);
    if (!v) return;
    const p = partner(v.ansager);
    const i = v.st.sitze.indexOf(p);
    if (i < 0) return;
    if (v.st.karten[i] !== v.kv) nicht[p][v.kv] = 1;
  }
  // Ausspiel des Ansagers nach der Konvention (oder null)
  function verlangenAusspiel(spiel, sitz, legal) {
    const r = spiel.runde;
    if (r.stichNr !== 0 || r.stich.length || r.angesagtVon !== sitz || (r.code !== 'OBE' && r.code !== 'UNE')) return null;
    const eff = effModus(r.code, 0);
    const hand = r.haende[sitz];
    const kand = legal.filter((k) => {
      if (!istOben(k, eff, new Uint8Array(36))) return false;
      const kv = verlangteKarte(k, eff);
      if (hand.includes(kv)) return false;
      // die dritte Karte (Dame bzw. Acht) hält er – dann lohnt das Verlangen
      const f = farbeVon(k);
      const reihe = [];
      for (let w = 0; w < 9; w++) reihe.push(f * 9 + w);
      reihe.sort((a, b) => STAERKE[eff][b] - STAERKE[eff][a]);
      return hand.includes(reihe[2]);
    });
    if (!kand.length) return null;
    return maxNach(kand, (k) => farbLaenge(hand, farbeVon(k)) * 20 + PUNKTE[eff][k]);
  }
  // Antwort des Partners: die verlangte Karte geben (oder null)
  function verlangenAntwort(spiel, sitz, legal) {
    const r = spiel.runde;
    if (r.stichNr !== 0 || !r.stich.length) return null;
    const v = verlangenStich(r);
    if (!v || partner(v.ansager) !== sitz) return null;
    return legal.includes(v.kv) ? v.kv : null;
  }

  // Welche Karte spielt der Schieber nach dieser Regel aus (oder null)?
  function schieberAusspiel(spiel, sitz, legal) {
    const r = spiel.runde;
    if (r.stich.length || schieberSitz(r) !== sitz) return null;
    const T0 = MODI[r.code].trumpf;
    if (T0 >= 0) {
      if (r.stichNr !== 0) return null;
      const eff = effModus(r.code, 0);
      const trumpf = legal.filter((k) => farbeVon(k) === T0);
      return trumpf.length ? { karte: maxNach(trumpf, (k) => STAERKE[eff][k]), grund: GRUND_TRUMPF_NACH_SCHIEBEN } : null;
    }
    // Obenabe / Undenufe: nur solange alle meine Ausspiele oberste Karten waren.
    const g = new Uint8Array(36);
    for (let i = 0; i < r.stiche.length; i++) {
      const st = r.stiche[i];
      if (st.sitze[0] === sitz && !istOben(st.karten[0], effModus(r.code, i), g)) return null;
      if (st.sitze[0] !== sitz && i > 0) return null;
      for (const k of st.karten) g[k] = 1;
    }
    const eff = effModus(r.code, r.stichNr);
    const oben = legal.filter((k) => istOben(k, eff, g));
    if (!oben.length) return null;
    const hand = r.haende[sitz];
    const k = maxNach(oben, (x) => farbLaenge(hand, farbeVon(x)) * 20 + PUNKTE[eff][x]);
    return { karte: k, grund: r.code === 'UNE' ? GRUND_SECHSEN_NACH_SCHIEBEN : GRUND_ASSE_NACH_SCHIEBEN };
  }

  // Den letzten Trumpf holen: Das ansagende Team ist am Ausspiel, hält den
  // höchsten Trumpf, der noch im Spiel ist, und draussen ist nur noch ein
  // Trumpf, den ein Gegner haben kann – dann diesen Trumpf spielen.
  // Gemessen (werkzeuge/trumpf-weiter.js): Weiter ziehen, solange mehrere
  // Trümpfe draussen sind, kostet im Schnitt Punkte (nach dem Schieben am
  // meisten); den letzten holen bringt etwas.
  function trumpfWeiter(spiel, sitz, legal, w, maxDraussen) {
    const r = spiel.runde;
    if (r.stich.length || r.stichNr === 0) return null;
    if (r.angesagtVon !== sitz && r.angesagtVon !== partner(sitz)) return null;
    const T = MODI[r.code].trumpf;
    if (T < 0) return null;
    const eff = effModus(r.code, r.stichNr);
    const meine = legal.filter((k) => farbeVon(k) === T);
    if (!meine.length) return null;
    const hoch = maxNach(meine, (k) => STAERKE[eff][k]);
    const hand = r.haende[sitz];
    if (hoehereDraussen(hoch, eff, w.gespielt, hand) > 0) return null;
    let draussen = 0;
    for (let k = T * 9; k < T * 9 + 9; k++) if (!w.gespielt[k] && !hand.includes(k)) draussen++;
    if (!draussen || draussen > maxDraussen) return null;
    const leer = (s) => !!(w.leer[s] & bit(T));
    if (leer((sitz + 1) % 4) && leer((sitz + 3) % 4)) return null;
    return hoch;
  }

  function wissen(spiel, sitz, optionen) {
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
        } else {
          const s = st.sitze[i];
          const hoch = geschmierterBock(k, eff, gespielt, st.karten.slice(0, i), st.sitze.slice(0, i), s);
          if (hoch) {
            angezeigt[s] |= bit(farbeVon(k));
            anzeigen.push({ sitz: s, farbe: farbeVon(k), hoch, geschmiert: true });
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
    // Karten, die einer sicher nicht hat (Ausspiel des Schiebers).
    const nicht = [new Uint8Array(36), new Uint8Array(36), new Uint8Array(36), new Uint8Array(36)];
    if (!(optionen && optionen.zeichen === false)) schieberNicht(runde, nicht);
    if (optionen && optionen.verlangen) verlangenNicht(runde, nicht);
    nicht[sitz].fill(0);
    return { gespielt, leer, puurOffen, bekannt, trumpf: T0, angezeigt, anzeigen, nicht };
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
      if (w.nicht && w.nicht[s][k]) return false;
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
  function ansageWissen(spiel, sitz, w, optionen) {
    const gegnerLesen = !!(optionen && optionen.gegnerAnzeigen);
    const r = spiel.runde;
    if (!r.code) return null;
    const ansager = r.angesagtVon !== sitz ? r.angesagtVon : -1;
    const schieber = r.geschoben && r.ansager !== sitz ? r.ansager : -1;
    const gespieltVon = [[], [], [], []];
    for (const st of r.stiche) st.karten.forEach((k, i) => gespieltVon[st.sitze[i]].push(k));
    r.stich.forEach((k, i) => gespieltVon[r.stichSitze[i]].push(k));
    const anzeigen = [];
    // Anzeigen sind für den Partner gedacht – gelesen werden seine, mit
    // gegnerAnzeigen auch die der Gegner (sie zeigen ihrem Partner dasselbe).
    for (const a of (w && w.anzeigen) || []) {
      if (a.sitz === sitz || (a.sitz !== partner(sitz) && !gegnerLesen)) continue;
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
    const w = wissen(spiel, sitz, { zeichen: o.schieberZeichen !== false, verlangen: !!o.koenigVerlangen });
    const rng = o.rng || J.zufall(J.neuerSeed());
    const restKarten = runde.haende.reduce((n, h) => n + h.length, 0);
    const exaktAb = o.exaktAb != null ? o.exaktAb : 12;
    const welten = restKarten <= exaktAb ? (o.weltenExakt || 30) : (o.welten || 120);
    const summe = new Map(legal.map((k) => [k, 0]));
    const meinTeam = team(sitz);
    const info = o.ansageBeachten === false ? null : ansageWissen(spiel, sitz, o.anzeigenBeachten === false ? null : w, o);
    // Mit dem schnellen Löser: die Faustregeln spielen nur bis `loesenAb`
    // Karten übrig sind, den Rest rechnet loese() exakt. Ohne (loeser:
    // false) wie früher: Faustregeln bis zum Schluss, exakt erst ab exaktAb.
    const mitLoeser = o.loeser !== false;
    const loesenAb = o.loesenAb != null ? o.loesenAb : exaktAb;
    const ziehe = () => (info ? weltPassend(spiel, sitz, w, rng, info) : welt(spiel, sitz, w, rng));
    // Kartenschätzung: mehr Verteilungen ziehen, nach den bisherigen Zügen
    // der anderen gewichten und die glaubwürdigsten nehmen.
    let auswahl = null;
    const gw = o.schaetzung ? (o.zugGewichte || ZUG_GEWICHTE) : null;
    if (gw) {
      const zuege = zugVerlauf(spiel, sitz);
      if (zuege.length) {
        const K = Math.ceil(welten * (o.schaetzungFaktor || 4));
        const beta = o.schaetzungBeta != null ? o.schaetzungBeta : 1;
        const kand = [], lw = [];
        const puffer = new Float64Array(MERKMALE.length);
        for (let i = 0; i < K; i++) { const h = ziehe(); kand.push(h); lw.push(beta * weltLogL(zuege, h, spiel.regeln, gw, puffer)); }
        const max = Math.max(...lw);
        const gew = lw.map((x) => Math.exp(x - max));
        const summe = gew.reduce((a, b) => a + b, 0);
        // systematisch ziehen
        auswahl = [];
        let c = gew[0] / summe, j = 0;
        const u0 = rng() / welten;
        for (let i = 0; i < welten; i++) {
          const u = u0 + i / welten;
          while (u > c && j < K - 1) { j++; c += gew[j] / summe; }
          auswahl.push(kand[j]);
        }
      }
    }
    for (let i = 0; i < welten; i++) {
      const haende = auswahl ? auswahl[i] : ziehe();
      const tt = mitLoeser ? new Map() : null;
      for (const k of legal) {
        const s = simAusSpiel(spiel, haende.map((h) => h.slice()), w);
        simSpiele(s, k);
        let wert;
        if (mitLoeser) {
          while (s.stichNr < 9 && restIn(s) > loesenAb) simSpiele(s, mittelZug(simAnsicht(s)).karte);
          wert = loese(s, meinTeam, tt);
        } else if (restKarten - 1 <= exaktAb) wert = exakt(s, meinTeam, -Infinity, Infinity);
        else { simZuEnde(s); wert = simWert(s, meinTeam); }
        summe.set(k, summe.get(k) + wert);
      }
    }
    const werte = legal.map((k) => ({ karte: k, wert: summe.get(k) / welten }));
    werte.sort((a, b) => b.wert - a.wert);
    // Ausspiel des Schiebers (siehe schieberAusspiel): Trumpf ziehen hat
    // gemessen +2,6 ± 0,8 Punkte gebracht (werkzeuge/trumpf-ziehen.js), die
    // Wahl der Karte als Zeichen misst werkzeuge/schieber-zeichen.js.
    if (o.schieberZeichen !== false) {
      const z = schieberAusspiel(spiel, sitz, legal);
      if (z) return { karte: z.karte, grund: z.grund, werte };
    } else if (o.trumpfZiehen !== false && runde.stichNr === 0 && !runde.stich.length && runde.geschoben && runde.angesagtVon === partner(sitz)) {
      // bisherige Regel (zum Vergleich): der Buur, sonst der kleinste Trumpf
      const effT = effModus(runde.code, 0);
      const T = trumpfVon(effT);
      const trumpf = T >= 0 ? legal.filter((k) => farbeVon(k) === T) : [];
      if (trumpf.length) {
        const buur = trumpf.find((k) => wertVon(k) === WB);
        const k = buur != null ? buur : minNach(trumpf, (x) => STAERKE[effT][x]);
        return { karte: k, grund: GRUND_TRUMPF_NACH_SCHIEBEN, werte };
      }
    }
    // König (Sieben) verlangen – Ausspiel und Antwort im ersten Stich
    if (o.koenigVerlangen) {
      const schwelleV = o.verlangenSchwelle != null ? o.verlangenSchwelle : VERLANGEN_SCHWELLE;
      const ka = verlangenAusspiel(spiel, sitz, legal);
      const kb = ka == null ? verlangenAntwort(spiel, sitz, legal) : null;
      const k = ka != null ? ka : kb;
      const x = k != null ? werte.find((y) => y.karte === k) : null;
      if (x && werte[0].wert - x.wert <= schwelleV) {
        const une = runde.code === 'UNE';
        const grund = ka != null ? (une ? GRUND_SIEBEN_VERLANGEN : GRUND_KOENIG_VERLANGEN) : (une ? GRUND_SIEBEN_GEBEN : GRUND_KOENIG_GEBEN);
        return { karte: k, grund, werte };
      }
    }
    if (o.trumpfWeiter !== false) {
      const k = trumpfWeiter(spiel, sitz, legal, w, o.trumpfWeiterDraussen != null ? o.trumpfWeiterDraussen : 1);
      const x = k != null ? werte.find((y) => y.karte === k) : null;
      const schwelleT = o.trumpfWeiterSchwelle != null ? o.trumpfWeiterSchwelle : TRUMPF_WEITER_SCHWELLE;
      if (x && werte[0].wert - x.wert <= schwelleT) return { karte: k, grund: GRUND_TRUMPF_WEITER, werte };
    }
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
        const schwelleZ = o.zurueckSchwelle != null ? o.zurueckSchwelle : ZURUECK_SCHWELLE;
        if (x && werte[0].wert - x.wert <= schwelleZ) return { karte: kand, grund: GRUND_ZURUECK, werte };
      }
    }
    // Gleichwertige Karten anspielen: die höchste zuerst (Buur vor Nell,
    // im Undenufe die Sechs vor der Sieben). Für die Punkte ist es gleich –
    // die Unterschiede in der Rechnung sind Zufall –, aber so weiss der
    // Partner sofort, dass der Stich sicher ist, und kann schmieren.
    // Ebenso beim Zugeben, wenn meine Karte den Stich nimmt: Ob die Sieben
    // oder die Acht den Stich macht, ist gleich – die höchste zuerst.
    {
      const effG = effModus(runde.code, runde.stichNr);
      const nimmt = !runde.stich.length || schlaegt(wahl.karte, runde.stich[gewinnerIndex(runde.stich, effG)], effG);
      const hoch = nimmt ? hoechsteGleichwertige(wahl.karte, runde.haende[sitz], effG, w.gespielt) : wahl.karte;
      const x = hoch !== wahl.karte ? werte.find((y) => y.karte === hoch) : null;
      if (x && wahl.wert - x.wert <= GLEICH_SCHWELLE) {
        // «Sicher» nur, wenn keine höhere Karte dieser Farbe mehr draussen ist.
        const sicher = hoehereDraussen(hoch, effG, w.gespielt, runde.haende[sitz]) === 0;
        const grund = hoch === mittel.karte && sicher ? mittel.grund
          : !sicher ? GRUND_GLEICHWERTIG_OFFEN : runde.stich.length ? GRUND_GLEICHWERTIG_STICH : GRUND_GLEICHWERTIG;
        return { karte: hoch, grund, werte };
      }
    }
    // Ass schmieren als Zeichen: Liegt der Partner vorne und halte ich in
    // einer anderen Farbe die höchste Karte samt den nächsten (Ass, König,
    // Dame), gebe ich bei Gleichstand das Ass – der Partner liest daraus,
    // dass er mir diese Farbe zurückspielen kann.
    if (runde.stich.length) {
      const effS = effModus(runde.code, runde.stichNr);
      const kand = legal.filter((k) => geschmierterBock(k, effS, w.gespielt, runde.stich, runde.stichSitze, sitz) && sehrStarkNach(k, runde.haende[sitz], effS, w.gespielt));
      if (kand.length) {
        const k = maxNach(kand, (x) => PUNKTE[effS][x]);
        const x = werte.find((y) => y.karte === k);
        if (x && werte[0].wert - x.wert <= SCHMIER_SCHWELLE) return { karte: k, grund: GRUND_ASS_SCHMIEREN, werte };
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
  const GLEICH_SCHWELLE = 4;
  const TRUMPF_WEITER_SCHWELLE = 8;
  const VERLANGEN_SCHWELLE = 8;
  const GRUND_KOENIG_VERLANGEN = 'Obenabe, erster Stich: Spiel das Ass, wo dir der König fehlt – hat ihn dein Partner, gibt er ihn dir darauf.';
  const GRUND_SIEBEN_VERLANGEN = 'Undenufe, erster Stich: Spiel die Sechs, wo dir die Sieben fehlt – hat sie dein Partner, gibt er sie dir darauf.';
  const GRUND_KOENIG_GEBEN = 'Dein Partner verlangt mit dem Ass den König – gib ihn ihm, dann weiss er, dass die Farbe läuft.';
  const GRUND_SIEBEN_GEBEN = 'Dein Partner verlangt mit der Sechs die Sieben – gib sie ihm, dann weiss er, dass die Farbe läuft.';
  const GRUND_TRUMPF_WEITER = 'Den letzten Trumpf holen: Ihr habt angesagt, nur noch ein Trumpf ist draussen, und du hast den höchsten – zieh ihn heraus.';
  const SCHMIER_SCHWELLE = 2;
  const GRUND_GLEICHWERTIG = 'Gleichwertige Karten: Spiel die höchste zuerst – so weiss dein Partner, dass der Stich sicher ist.';
  const GRUND_GLEICHWERTIG_STICH = 'Gleichwertige Karten: Du machst den Stich – spiel die höchste, für die Punkte ist es gleich. So weiss dein Partner, dass der Stich sicher ist.';
  const GRUND_GLEICHWERTIG_OFFEN = 'Gleichwertige Karten: Für die Punkte ist es gleich – spiel die höhere. Sicher ist der Stich damit aber noch nicht.';
  const GRUND_TRUMPF_NACH_SCHIEBEN = 'Trumpf ziehen: Dein Partner hat nach deinem Schieben angesagt – spiel im ersten Stich deinen höchsten Trumpf. So weiss er, wie stark du im Trumpf bist: Kommt die Sechs, hast du keinen anderen.';
  const GRUND_ASSE_NACH_SCHIEBEN = 'Dein Partner hat nach deinem Schieben Obenabe angesagt – spiel zuerst alle deine Asse. So weiss er genau, welche du hast: Kommt kein Ass, hast du keines.';
  const GRUND_SECHSEN_NACH_SCHIEBEN = 'Dein Partner hat nach deinem Schieben Undenufe angesagt – spiel zuerst alle deine Sechsen. So weiss er genau, welche du hast: Kommt keine Sechs, hast du keine.';
  const GRUND_UEBERNEHMEN = 'Du musst deinen Partner übernehmen und machst den Stich selbst – nimm die tiefste Karte, die reicht, und behalte die hohen für später.';
  const GRUND_UEBERNEHMEN_GLEICH = 'Du musst deinen Partner übernehmen und machst den Stich selbst. Deine Karten sind gleichwertig – spiel die höchste zuerst.';
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

    // Mit dem Löser (o.loeser): Faustregeln bis o.loesenAb Karten übrig
    // sind, den Rest exakt – sonst Faustregeln bis zum Schluss.
    const mitLoeser = !!o.loeser;
    const loesenAb = o.loesenAb != null ? o.loesenAb : 12;
    const gesamt = 152 + (r.letzterStich || 0);
    function spieleDurch(code, haende, ansager) {
      const ausspieler = r.ausspiel === 'ansager' ? ansager : vorhand;
      const s = simNeu(code, r, haende.map((h) => h.slice()), ausspieler, ansager);
      let diff, eigene;
      if (mitLoeser) {
        while (s.stichNr < 9 && restIn(s) > loesenAb) simSpiele(s, mittelZug(simAnsicht(s)).karte);
        diff = loese(s, 0);
        const match = r.matchBonus && code !== 'MIS' ? r.matchPunkte : 0;
        if (match && diff >= gesamt + match) eigene = gesamt + match;
        else if (match && diff <= -(gesamt + match)) eigene = 0;
        else eigene = (gesamt + diff) / 2;   // bei Misère: die Punkte der Gegner
      } else {
        simZuEnde(s);
        diff = simWert(s, 0);
        eigene = code === 'MIS' ? s.punkte[1] : s.punkte[0];
        if (r.matchBonus && code !== 'MIS' && s.stichZahl[0] === 9) eigene += r.matchPunkte;
      }
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
    GRUND_ASS_SCHMIEREN,
    GRUND_GLEICHWERTIG,
    GRUND_GLEICHWERTIG_STICH,
    GRUND_GLEICHWERTIG_OFFEN,
    GRUND_TRUMPF_WEITER,
    GRUND_KOENIG_VERLANGEN,
    GRUND_SIEBEN_VERLANGEN,
    GRUND_KOENIG_GEBEN,
    GRUND_SIEBEN_GEBEN,
    GRUND_UEBERNEHMEN,
    GRUND_UEBERNEHMEN_GLEICH,
    GRUND_TRUMPF_NACH_SCHIEBEN,
    GRUND_ASSE_NACH_SCHIEBEN,
    GRUND_SECHSEN_NACH_SCHIEBEN,
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
      const b = bewertung(hand, spiel.regeln, { geschoben: !darf, rng: (optionen && optionen.rng) || J.zufall(J.neuerSeed()), loeser: optionen && optionen.ansageLoeser, loesenAb: optionen && optionen.ansageLoesenAb });
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
    simNeu, simZuEnde, simWert, simAusSpiel, simSpiele, exakt, loese, MERKMALE, zugMerkmale, zugLogWahrscheinlichkeit, loeserKnotenZaehler: () => loeserKnoten, GEWICHT, SCHIEBEN_SCHWELLE, verwerfKarte, VERWERF_SCHWELLE,
    ansageWissen, passtZurAnsage, passtZumSchieben, passtZumWissen,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JassBot = api;
})(typeof self !== 'undefined' ? self : this);
