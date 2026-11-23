/*
 * jass-engine.js – Die Regeln des Schiebers.
 * ---------------------------------------------------------------------------
 * Reine Spiellogik ohne Oberfläche: läuft im Browser (window.JassEngine),
 * im Web Worker und in Node (require) für die Tests.
 *
 * Karten       36 französische Karten, als Zahl 0–35: farbe * 9 + wert.
 *              Farben: 0 Schaufel ♠, 1 Herz ♥, 2 Kreuz ♣, 3 Ecke ♦.
 *              Werte:  0 Sechs … 4 Zehn, 5 Bauer, 6 Dame, 7 König, 8 Ass.
 * Sitze        0–3 in Spielrichtung (gegen den Uhrzeigersinn). 0 und 2 sind
 *              ein Team, 1 und 3 das andere. Team = sitz % 2.
 * Modi         T0–T3 Trumpf in der Farbe, OBE Obenabe, UNE Undenufe,
 *              SLO / SLU Slalom (obenabe bzw. undenufe beginnend),
 *              MIS Misère (wie Obenabe, aber man schreibt die Punkte des
 *              Gegners – wer wenig macht, gewinnt).
 * Regeln       Alles, was Familien unterschiedlich spielen, steht in
 *              STANDARD_REGELN und lässt sich einzeln umstellen.
 */
(function (root) {
  'use strict';

  const FARBEN = [
    { id: 0, key: 'schaufel', name: 'Schaufel', symbol: '♠', rot: false },
    { id: 1, key: 'herz', name: 'Herz', symbol: '♥', rot: true },
    { id: 2, key: 'kreuz', name: 'Kreuz', symbol: '♣', rot: false },
    { id: 3, key: 'ecke', name: 'Ecke', symbol: '♦', rot: true },
  ];
  const WERTE = ['6', '7', '8', '9', '10', 'B', 'D', 'K', 'A'];
  const WERT_NAMEN = ['Sechs', 'Sieben', 'Acht', 'Neun', 'Zehn', 'Bauer', 'Dame', 'König', 'Ass'];
  const W6 = 0, W7 = 1, W8 = 2, W9 = 3, W10 = 4, WB = 5, WD = 6, WK = 7, WA = 8;

  const karte = (farbe, wert) => farbe * 9 + wert;
  const farbeVon = (k) => (k / 9) | 0;
  const wertVon = (k) => k % 9;
  const team = (sitz) => sitz % 2;
  const partner = (sitz) => (sitz + 2) % 4;

  // Effektiver Modus eines Stichs: 0–3 Trumpf in dieser Farbe, 4 obenabe,
  // 5 undenufe. Slalom wechselt von Stich zu Stich, Misère spielt obenabe.
  const EFF_OBE = 4, EFF_UNE = 5;

  const MODI = {
    T0: { code: 'T0', gruppe: 'T', trumpf: 0, name: 'Schaufel', lang: 'Schaufel Trumpf', symbol: '♠' },
    T1: { code: 'T1', gruppe: 'T', trumpf: 1, name: 'Herz', lang: 'Herz Trumpf', symbol: '♥' },
    T2: { code: 'T2', gruppe: 'T', trumpf: 2, name: 'Kreuz', lang: 'Kreuz Trumpf', symbol: '♣' },
    T3: { code: 'T3', gruppe: 'T', trumpf: 3, name: 'Ecke', lang: 'Ecke Trumpf', symbol: '♦' },
    OBE: { code: 'OBE', gruppe: 'OBE', trumpf: -1, name: 'Obenabe', lang: 'Obenabe', symbol: '▼' },
    UNE: { code: 'UNE', gruppe: 'UNE', trumpf: -1, name: 'Undenufe', lang: 'Undenufe', symbol: '▲' },
    SLO: { code: 'SLO', gruppe: 'SLO', trumpf: -1, name: 'Slalom obe', lang: 'Slalom (obenabe beginnt)', symbol: '⇅' },
    SLU: { code: 'SLU', gruppe: 'SLU', trumpf: -1, name: 'Slalom unde', lang: 'Slalom (undenufe beginnt)', symbol: '⇵' },
    MIS: { code: 'MIS', gruppe: 'MIS', trumpf: -1, name: 'Misère', lang: 'Misère', symbol: '∅' },
  };
  const MODUS_REIHENFOLGE = ['T0', 'T1', 'T2', 'T3', 'OBE', 'UNE', 'SLO', 'SLU', 'MIS'];

  const STANDARD_REGELN = {
    // Welche Ansagen erlaubt sind. T steht für alle vier Trumpffarben.
    modi: { T: true, OBE: true, UNE: true, SLO: false, SLU: false, MIS: false },
    schieben: true,
    // Spielende: nach einer Anzahl Runden oder bei Zielpunkten.
    spielende: 'runden',
    runden: 8,
    zielPunkte: 1000,
    letzterStich: 5,
    weisen: false,
    stoeck: false,
    stoeckPunkte: 20,
    matchBonus: false,
    matchPunkte: 100,
    multiplikatoren: false,
    faktoren: { T0: 2, T1: 1, T2: 2, T3: 1, OBE: 3, UNE: 3, SLO: 4, SLU: 4, MIS: 1 },
    // false: Untertrumpfen verboten (ausser man hat nur noch Trumpf).
    untertrumpfen: false,
    // true: Den Trumpf-Bauer (Puur) muss man nie angeben.
    puurFrei: true,
    // Wer in der ersten Runde ansagt: 'ecke7' (wer die Ecken-7 hat),
    // 'zufall' oder 'sitz0' (immer der Spieler unten).
    ersterAnsager: 'ecke7',
    // Wer nach dem Schieben ausspielt: 'vorhand' (wer geschoben hat) oder
    // 'ansager' (wer Trumpf gemacht hat).
    ausspiel: 'vorhand',
  };

  function regelnMitStandard(regeln) {
    const r = Object.assign({}, STANDARD_REGELN, regeln || {});
    r.modi = Object.assign({}, STANDARD_REGELN.modi, (regeln && regeln.modi) || {});
    r.faktoren = Object.assign({}, STANDARD_REGELN.faktoren, (regeln && regeln.faktoren) || {});
    r.runden = Math.max(1, Math.floor(Number(r.runden) || STANDARD_REGELN.runden));
    r.zielPunkte = Math.max(1, Math.floor(Number(r.zielPunkte) || STANDARD_REGELN.zielPunkte));
    if (!MODUS_REIHENFOLGE.some((c) => r.modi[MODI[c].gruppe])) r.modi.T = true;
    return r;
  }

  function erlaubteModi(regeln) {
    return MODUS_REIHENFOLGE.filter((c) => regeln.modi[MODI[c].gruppe]);
  }

  function effModus(code, stichNr) {
    switch (code) {
      case 'T0': return 0;
      case 'T1': return 1;
      case 'T2': return 2;
      case 'T3': return 3;
      case 'OBE': case 'MIS': return EFF_OBE;
      case 'UNE': return EFF_UNE;
      case 'SLO': return stichNr % 2 === 0 ? EFF_OBE : EFF_UNE;
      case 'SLU': return stichNr % 2 === 0 ? EFF_UNE : EFF_OBE;
      default: throw new Error('Unbekannter Modus ' + code);
    }
  }
  const trumpfVon = (eff) => (eff < 4 ? eff : -1);

  // Reihenfolge im Trumpf: 6 7 8 10 D K A 9 B
  const TRUMPF_RANG = [0, 1, 2, 7, 3, 8, 4, 5, 6];

  // STAERKE[eff][karte]: Vergleichswert innerhalb derselben Farbe; Trümpfe
  // liegen über 100. PUNKTE[eff][karte]: Kartenwert im Stich.
  const STAERKE = [];
  const PUNKTE = [];
  for (let eff = 0; eff < 6; eff++) {
    const s = new Array(36);
    const p = new Array(36);
    for (let k = 0; k < 36; k++) {
      const f = farbeVon(k);
      const w = wertVon(k);
      if (eff < 4 && f === eff) {
        s[k] = 100 + TRUMPF_RANG[w];
        p[k] = [0, 0, 0, 14, 10, 20, 3, 4, 11][w];
      } else if (eff === EFF_UNE) {
        s[k] = 8 - w;
        p[k] = [11, 0, 8, 0, 10, 2, 3, 4, 0][w];
      } else if (eff === EFF_OBE) {
        s[k] = w;
        p[k] = [0, 0, 8, 0, 10, 2, 3, 4, 11][w];
      } else {
        s[k] = w;
        p[k] = [0, 0, 0, 0, 10, 2, 3, 4, 11][w];
      }
    }
    STAERKE.push(s);
    PUNKTE.push(p);
  }

  // Schlägt karte k die bisher beste Karte b? led = ausgespielte Farbe.
  function schlaegt(k, b, eff) {
    const fk = farbeVon(k);
    const fb = farbeVon(b);
    if (fk === fb) return STAERKE[eff][k] > STAERKE[eff][b];
    return eff < 4 && fk === eff;
  }

  // Index der Karte, die den (auch unvollständigen) Stich gerade macht.
  function gewinnerIndex(stich, eff) {
    let best = 0;
    for (let i = 1; i < stich.length; i++) if (schlaegt(stich[i], stich[best], eff)) best = i;
    return best;
  }

  function stichPunkte(stich, eff) {
    let p = 0;
    for (const k of stich) p += PUNKTE[eff][k];
    return p;
  }

  // Welche Karten aus `hand` darf man auf den Stich `stich` legen?
  function erlaubteKarten(hand, stich, eff, regeln) {
    if (!stich.length) return hand.slice();
    const led = farbeVon(stich[0]);
    const T = trumpfVon(eff);
    const vonLed = hand.filter((k) => farbeVon(k) === led);
    if (T < 0) return vonLed.length ? vonLed : hand.slice();
    const puurFrei = !regeln || regeln.puurFrei !== false;
    if (led === T) {
      if (!vonLed.length) return hand.slice();
      if (puurFrei && vonLed.length === 1 && wertVon(vonLed[0]) === WB) return hand.slice();
      return vonLed;
    }
    const untertrumpfenVerboten = !regeln || regeln.untertrumpfen !== true;
    let hoechsterTrumpf = -1;
    for (const k of stich) if (farbeVon(k) === T && STAERKE[eff][k] > hoechsterTrumpf) hoechsterTrumpf = STAERKE[eff][k];
    let nurTruempfe = true;
    for (const k of hand) if (farbeVon(k) !== T) { nurTruempfe = false; break; }
    const res = [];
    for (const k of hand) {
      const f = farbeVon(k);
      if (f === led) { res.push(k); continue; }
      if (f === T) {
        if (untertrumpfenVerboten && hoechsterTrumpf >= 0 && STAERKE[eff][k] < hoechsterTrumpf && !nurTruempfe) continue;
        res.push(k);
        continue;
      }
      if (!vonLed.length) res.push(k);
    }
    return res;
  }

  // ---------------------------------------------------------------- Weisen

  const VIER_GLEICHE = { [W9]: 150, [WB]: 200, [WA]: 100, [WK]: 100, [WD]: 100, [W10]: 100 };
  const BLATT_PUNKTE = { 3: 20, 4: 50, 5: 100, 6: 150, 7: 200, 8: 250, 9: 300 };

  function findeWeise(hand) {
    const weise = [];
    for (let f = 0; f < 4; f++) {
      const hat = new Array(9).fill(false);
      for (const k of hand) if (farbeVon(k) === f) hat[wertVon(k)] = true;
      let w = 0;
      while (w < 9) {
        if (!hat[w]) { w++; continue; }
        let e = w;
        while (e + 1 < 9 && hat[e + 1]) e++;
        const laenge = e - w + 1;
        if (laenge >= 3) {
          const karten = [];
          for (let i = w; i <= e; i++) karten.push(karte(f, i));
          weise.push({ typ: 'blatt', farbe: f, von: w, bis: e, laenge, punkte: BLATT_PUNKTE[laenge], karten });
        }
        w = e + 1;
      }
    }
    for (const wStr of Object.keys(VIER_GLEICHE)) {
      const w = Number(wStr);
      const karten = [0, 1, 2, 3].map((f) => karte(f, w));
      if (karten.every((k) => hand.includes(k))) {
        weise.push({ typ: 'vier', farbe: -1, von: w, bis: w, laenge: 4, punkte: VIER_GLEICHE[w], karten });
      }
    }
    return weise;
  }

  function weisName(weis) {
    if (weis.typ === 'vier') {
      if (weis.von === WB) return 'Vier Bauern';
      if (weis.von === W9) return 'Vier Neuner';
      return 'Vier ' + { [WA]: 'Asse', [WK]: 'Könige', [WD]: 'Damen', [W10]: 'Zehner' }[weis.von];
    }
    const namen = { 3: 'Dreiblatt', 4: 'Vierblatt', 5: 'Fünfblatt', 6: 'Sechsblatt', 7: 'Siebenblatt', 8: 'Achtblatt', 9: 'Neunblatt' };
    return namen[weis.laenge] + ' ' + FARBEN[weis.farbe].symbol + ' bis ' + WERTE[weis.bis];
  }

  // > 0, wenn Weis a höher ist als b.
  function vergleicheWeis(a, b, eff) {
    if (a.punkte !== b.punkte) return a.punkte - b.punkte;
    if (a.laenge !== b.laenge) return a.laenge - b.laenge;
    // Bei Undenufe zählt das tiefere Blatt.
    const hochA = eff === EFF_UNE ? -a.von : a.bis;
    const hochB = eff === EFF_UNE ? -b.von : b.bis;
    if (hochA !== hochB) return hochA - hochB;
    const T = trumpfVon(eff);
    const trA = a.farbe === T && T >= 0;
    const trB = b.farbe === T && T >= 0;
    if (trA !== trB) return trA ? 1 : -1;
    return 0;
  }

  function besterWeis(weise, eff) {
    let best = null;
    for (const w of weise) if (!best || vergleicheWeis(w, best, eff) > 0) best = w;
    return best;
  }

  // Wer schreibt die Weisen? Nur das Team mit dem höchsten Weis, und dann
  // alle Weisen beider Spieler dieses Teams. Bei Gleichstand gewinnt, wer
  // früher an der Reihe ist (vom Ausspieler aus).
  function werteWeiseAus(startHaende, eff, ausspieler) {
    const proSitz = startHaende.map((h) => findeWeise(h));
    let siegerSitz = -1;
    let siegerWeis = null;
    for (let i = 0; i < 4; i++) {
      const s = (ausspieler + i) % 4;
      const b = besterWeis(proSitz[s], eff);
      if (b && (!siegerWeis || vergleicheWeis(b, siegerWeis, eff) > 0)) {
        siegerWeis = b;
        siegerSitz = s;
      }
    }
    const punkte = [0, 0];
    if (siegerSitz >= 0) {
      const t = team(siegerSitz);
      for (let s = 0; s < 4; s++) if (team(s) === t) for (const w of proSitz[s]) punkte[t] += w.punkte;
    }
    return { proSitz, siegerSitz, siegerTeam: siegerSitz >= 0 ? team(siegerSitz) : -1, punkte };
  }

  // --------------------------------------------------------------- Zufall

  function zufall(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mische(array, rng) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function verteile(rng) {
    const deck = mische(Array.from({ length: 36 }, (_, i) => i), rng);
    return [0, 1, 2, 3].map((s) => deck.slice(s * 9, s * 9 + 9));
  }

  function neuerSeed() {
    return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
  }

  // ---------------------------------------------------------- Spielablauf

  function neuesSpiel(regeln, optionen) {
    const o = optionen || {};
    const r = regelnMitStandard(regeln);
    const spiel = {
      version: 1,
      regeln: r,
      seed: o.seed != null ? (o.seed >>> 0) : neuerSeed(),
      rundeNr: 0,
      ersterAnsager: -1,
      summe: [0, 0],
      runden: [],
      runde: null,
      fertig: false,
      sieger: -1,
    };
    spiel.runde = neueRunde(spiel, o.haende);
    return spiel;
  }

  function rundenSeed(spiel, nr) {
    return (spiel.seed + Math.imul(nr + 1, 0x9e3779b1)) >>> 0;
  }

  function neueRunde(spiel, haendeVorgabe) {
    const nr = spiel.rundeNr;
    const haende = haendeVorgabe ? haendeVorgabe.map((h) => h.slice()) : verteile(zufall(rundenSeed(spiel, nr)));
    if (spiel.ersterAnsager < 0) {
      const art = spiel.regeln.ersterAnsager;
      if (art === 'sitz0') spiel.ersterAnsager = 0;
      else if (art === 'zufall') spiel.ersterAnsager = Math.floor(zufall(spiel.seed ^ 0x5bd1e995)() * 4);
      else spiel.ersterAnsager = haende.findIndex((h) => h.includes(karte(3, W7)));
    }
    const ansager = (spiel.ersterAnsager + nr) % 4;
    return {
      nr,
      ansager,
      geschoben: false,
      angesagtVon: -1,
      code: null,
      startHaende: haende.map((h) => h.slice()),
      haende,
      phase: 'ansage',
      stichNr: 0,
      ausspieler: -1,
      amZug: ansager,
      stich: [],
      stichSitze: [],
      stiche: [],
      punkte: [0, 0],
      stichZahl: [0, 0],
      weis: null,
      stoeckSitz: -1,
      stoeckGemeldet: false,
    };
  }

  function ansageAmZug(runde) {
    return runde.geschoben ? partner(runde.ansager) : runde.ansager;
  }

  function darfSchieben(runde, regeln) {
    return runde.phase === 'ansage' && !runde.geschoben && regeln.schieben !== false;
  }

  function schieben(spiel) {
    const runde = spiel.runde;
    if (!darfSchieben(runde, spiel.regeln)) throw new Error('Schieben ist nicht erlaubt.');
    runde.geschoben = true;
    runde.amZug = partner(runde.ansager);
  }

  function ansagen(spiel, code) {
    const runde = spiel.runde;
    const r = spiel.regeln;
    if (runde.phase !== 'ansage') throw new Error('Es wird gerade nicht angesagt.');
    if (!MODI[code] || !r.modi[MODI[code].gruppe]) throw new Error('Diese Ansage ist nicht erlaubt: ' + code);
    runde.code = code;
    runde.angesagtVon = ansageAmZug(runde);
    runde.phase = 'spiel';
    runde.ausspieler = r.ausspiel === 'ansager' ? runde.angesagtVon : runde.ansager;
    runde.amZug = runde.ausspieler;
    const eff0 = effModus(code, 0);
    if (r.weisen && code !== 'MIS') runde.weis = werteWeiseAus(runde.startHaende, eff0, runde.ausspieler);
    const T = MODI[code].trumpf;
    if (r.stoeck && T >= 0) {
      runde.stoeckSitz = runde.startHaende.findIndex((h) => h.includes(karte(T, WK)) && h.includes(karte(T, WD)));
    }
  }

  function aktuellerEff(runde) {
    return effModus(runde.code, runde.stichNr);
  }

  function erlaubteFuer(spiel, sitz) {
    const runde = spiel.runde;
    if (runde.phase !== 'spiel' || runde.amZug !== sitz) return [];
    return erlaubteKarten(runde.haende[sitz], runde.stich, aktuellerEff(runde), spiel.regeln);
  }

  // Legt eine Karte. Ist der Stich voll, wird er sofort ausgewertet und
  // steht danach als letzter Eintrag in runde.stiche.
  function spiele(spiel, sitz, k) {
    const runde = spiel.runde;
    if (runde.phase !== 'spiel') throw new Error('Es wird gerade nicht gespielt.');
    if (runde.amZug !== sitz) throw new Error('Sitz ' + sitz + ' ist nicht am Zug.');
    const erlaubt = erlaubteFuer(spiel, sitz);
    if (!erlaubt.includes(k)) throw new Error('Diese Karte ist nicht erlaubt.');
    const hand = runde.haende[sitz];
    hand.splice(hand.indexOf(k), 1);
    runde.stich.push(k);
    runde.stichSitze.push(sitz);
    if (runde.stoeckSitz === sitz && !runde.stoeckGemeldet) {
      const T = MODI[runde.code].trumpf;
      if ((k === karte(T, WK) || k === karte(T, WD)) && !hand.includes(karte(T, WK)) && !hand.includes(karte(T, WD))) {
        runde.stoeckGemeldet = true;
        runde.stoeckStich = runde.stichNr;
      }
    }
    if (runde.stich.length < 4) {
      runde.amZug = (sitz + 1) % 4;
      return { stichFertig: false };
    }
    const eff = aktuellerEff(runde);
    const gi = gewinnerIndex(runde.stich, eff);
    const sieger = runde.stichSitze[gi];
    let punkte = stichPunkte(runde.stich, eff);
    const letzter = runde.stichNr === 8;
    if (letzter) punkte += spiel.regeln.letzterStich;
    const eintrag = { karten: runde.stich.slice(), sitze: runde.stichSitze.slice(), sieger, punkte, eff };
    runde.stiche.push(eintrag);
    runde.punkte[team(sieger)] += punkte;
    runde.stichZahl[team(sieger)] += 1;
    runde.stich = [];
    runde.stichSitze = [];
    runde.stichNr += 1;
    runde.amZug = sieger;
    if (letzter) {
      runde.phase = 'ende';
      runde.abrechnung = rundenAbrechnung(runde, spiel.regeln);
    }
    return { stichFertig: true, stich: eintrag, rundeFertig: letzter };
  }

  function rundenAbrechnung(runde, regeln) {
    const misere = runde.code === 'MIS';
    const faktor = regeln.multiplikatoren ? Number(regeln.faktoren[runde.code]) || 1 : 1;
    const stich = misere ? [runde.punkte[1], runde.punkte[0]] : runde.punkte.slice();
    const match = [0, 0];
    let matchTeam = -1;
    for (let t = 0; t < 2; t++) if (runde.stichZahl[t] === 9) matchTeam = t;
    if (matchTeam >= 0 && regeln.matchBonus && !misere) match[matchTeam] = regeln.matchPunkte;
    const weis = runde.weis ? runde.weis.punkte.slice() : [0, 0];
    const stoeck = [0, 0];
    if (runde.stoeckSitz >= 0 && regeln.stoeck) stoeck[team(runde.stoeckSitz)] = regeln.stoeckPunkte;
    const total = [0, 1].map((t) => (stich[t] + match[t] + weis[t] + stoeck[t]) * faktor);
    return { code: runde.code, ansager: runde.ansager, angesagtVon: runde.angesagtVon, geschoben: runde.geschoben, faktor, stich, match, matchTeam, weis, stoeck, total };
  }

  // Wer erreicht im Punktespiel die Zielpunkte zuerst? Reihenfolge
  // Stöck – Weis – Stich, die Stiche in der gespielten Reihenfolge.
  function zielErreichtVon(summeVorher, runde, abrechnung, regeln) {
    const ziel = regeln.zielPunkte;
    const f = abrechnung.faktor;
    const stand = summeVorher.slice();
    const pruefe = () => {
      for (let t = 0; t < 2; t++) if (stand[t] >= ziel) return t;
      return -1;
    };
    for (let t = 0; t < 2; t++) stand[t] += abrechnung.stoeck[t] * f;
    let w = pruefe(); if (w >= 0) return w;
    for (let t = 0; t < 2; t++) stand[t] += abrechnung.weis[t] * f;
    w = pruefe(); if (w >= 0) return w;
    const misere = runde.code === 'MIS';
    for (const s of runde.stiche) {
      const t = misere ? 1 - team(s.sieger) : team(s.sieger);
      stand[t] += s.punkte * f;
      w = pruefe(); if (w >= 0) return w;
    }
    for (let t = 0; t < 2; t++) stand[t] += abrechnung.match[t] * f;
    return pruefe();
  }

  // Schliesst die beendete Runde ab und beginnt die nächste (oder beendet
  // das Spiel). Gibt die Abrechnung zurück.
  function rundeAbschliessen(spiel) {
    const runde = spiel.runde;
    if (runde.phase !== 'ende') throw new Error('Die Runde ist noch nicht fertig.');
    const ab = runde.abrechnung;
    const vorher = spiel.summe.slice();
    spiel.runden.push(Object.assign({ nr: runde.nr }, ab));
    spiel.summe = [vorher[0] + ab.total[0], vorher[1] + ab.total[1]];
    const r = spiel.regeln;
    if (r.spielende === 'punkte') {
      const w = zielErreichtVon(vorher, runde, ab, r);
      if (w >= 0) {
        spiel.fertig = true;
        spiel.sieger = w;
      }
    } else if (spiel.runden.length >= r.runden) {
      spiel.fertig = true;
      spiel.sieger = spiel.summe[0] === spiel.summe[1] ? -1 : (spiel.summe[0] > spiel.summe[1] ? 0 : 1);
    }
    if (!spiel.fertig) {
      spiel.rundeNr += 1;
      spiel.runde = neueRunde(spiel);
    }
    return ab;
  }

  // ------------------------------------------------------------- Anzeige

  function kartenName(k, code) {
    const f = farbeVon(k);
    const w = wertVon(k);
    const T = code && MODI[code] ? MODI[code].trumpf : -1;
    if (T === f && w === WB) return 'Puur (' + FARBEN[f].name + ' Bauer)';
    if (T === f && w === W9) return 'Nell (' + FARBEN[f].name + ' Neun)';
    return FARBEN[f].name + ' ' + WERT_NAMEN[w];
  }

  function kurzName(k) {
    return FARBEN[farbeVon(k)].symbol + WERTE[wertVon(k)];
  }

  // Sortiert eine Hand für die Anzeige: Farben abwechselnd schwarz/rot,
  // Trumpf zuerst, innerhalb der Farbe die stärkste Karte links.
  function sortiereHand(hand, code) {
    const eff = code ? effModus(code, 0) : EFF_OBE;
    const T = code && MODI[code] ? MODI[code].trumpf : -1;
    let reihenfolge = [0, 1, 2, 3];
    if (T >= 0) {
      // Trumpf vorne, danach weiter abwechselnd nach Farbe.
      const rest = [0, 1, 2, 3].filter((f) => f !== T);
      const rot = FARBEN[T].rot;
      const andere = rest.filter((f) => FARBEN[f].rot !== rot);
      const gleich = rest.filter((f) => FARBEN[f].rot === rot);
      reihenfolge = [T, andere[0], gleich[0], andere[1]].filter((f) => f != null);
    }
    const pos = new Array(4);
    reihenfolge.forEach((f, i) => { pos[f] = i; });
    const staerke = code === 'UNE' || code === 'SLU' ? STAERKE[EFF_UNE] : STAERKE[eff];
    return hand.slice().sort((a, b) => {
      const fa = farbeVon(a), fb = farbeVon(b);
      if (fa !== fb) return pos[fa] - pos[fb];
      return staerke[b] - staerke[a];
    });
  }

  const api = {
    FARBEN, WERTE, WERT_NAMEN, MODI, MODUS_REIHENFOLGE, STANDARD_REGELN, STAERKE, PUNKTE,
    W6, W7, W8, W9, W10, WB, WD, WK, WA, EFF_OBE, EFF_UNE,
    karte, farbeVon, wertVon, team, partner,
    regelnMitStandard, erlaubteModi, effModus, trumpfVon, schlaegt, gewinnerIndex, stichPunkte, erlaubteKarten,
    findeWeise, weisName, vergleicheWeis, besterWeis, werteWeiseAus,
    zufall, mische, verteile, neuerSeed,
    neuesSpiel, neueRunde, ansageAmZug, darfSchieben, schieben, ansagen, aktuellerEff, erlaubteFuer, spiele,
    rundenAbrechnung, zielErreichtVon, rundeAbschliessen,
    kartenName, kurzName, sortiereHand,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JassEngine = api;
})(typeof self !== 'undefined' ? self : this);
