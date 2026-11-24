/*
 * jass-optimieren.js – eine gespielte Trainer-Runde vom Computer nachspielen.
 * ---------------------------------------------------------------------------
 * Genau dieselbe Verteilung (alle vier Hände) und dieselbe Ansage, aber auf
 * allen vier Plätzen spielt der Computer («Schwer», Rechentiefe «Maximal»). Er kennt dabei nur seine eigenen Karten – wie ein Mensch.
 * Heraus kommt, wie viele Punkte mit diesen Karten drin lagen.
 *
 *   JassOptimieren.vorbereiten(regeln, aufzeichnung)   → Spiel nach der Ansage
 *   JassOptimieren.nachspielen(regeln, aufzeichnung, rechnen, beiZug)
 *                                                       → { punkte, zuege, code }
 *   JassOptimieren.starte(partie, beiFortschritt)       → Promise: 8 Durchgänge
 *                                     in Workern, { punkte (Schnitt), min, max, zuege }
 *   JassOptimieren.werteHtml({ schnitt, gespielt, partie })
 *   JassOptimieren.verbinde(element, partie, speichern, beiFertig)
 *
 * Die Seite rechnet nicht selbst: Dieselbe Datei läuft als Web Worker, damit
 * die Seite während der 36 Züge nicht hängt.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const imWorker = !node && typeof importScripts === 'function' && typeof document === 'undefined';
  if (imWorker) importScripts('jass-engine.js', 'jass-bot.js');
  const J = node ? require('./jass-engine.js') : root.JassEngine;
  const B = node ? require('./jass-bot.js') : root.JassBot;

  // Die aufgezeichnete Runde bis nach der Ansage wieder aufbauen.
  function vorbereiten(regeln, aufzeichnung) {
    const r = Object.assign({}, J.regelnMitStandard(regeln), { spielende: 'runden', runden: 1 });
    const spiel = J.neuesSpiel(r, { haende: aufzeichnung.haende, ersterAnsager: aufzeichnung.ansager });
    for (const a of aufzeichnung.ansagen || []) {
      if (a.wahl === 'SCHIEBEN') J.schieben(spiel);
      else J.ansagen(spiel, a.wahl);
    }
    if (spiel.runde.phase === 'ansage') throw new Error('Die Runde hat keine Ansage.');
    return spiel;
  }

  function nachspielen(regeln, aufzeichnung, rechnen, beiZug) {
    const spiel = vorbereiten(regeln, aufzeichnung);
    const tiefe = B.rechentiefe(rechnen || 'maximal');
    const zuege = [];
    while (spiel.runde.phase !== 'ende' && zuege.length < 36) {
      const s = spiel.runde.amZug;
      const k = B.waehleKarte(spiel, s, 'schwer', tiefe).karte;
      zuege.push({ s, k, stich: spiel.runde.stichNr });
      J.spiele(spiel, s, k);
      if (beiZug) beiZug(zuege.length);
    }
    const ab = spiel.runde.abrechnung;
    return { punkte: ab.total.slice(), code: spiel.runde.code, zuege, rechnen: rechnen || 'maximal' };
  }

  if (imWorker) {
    root.onmessage = (e) => {
      try {
        const d = e.data;
        const erg = nachspielen(d.regeln, d.aufzeichnung, d.rechnen, (n) => root.postMessage({ zug: n }));
        root.postMessage({ fertig: true, ergebnis: erg });
      } catch (x) { root.postMessage({ fehler: String((x && x.message) || x) }); }
    };
    return;
  }

  // ------------------------------------------------------------ Seite

  function aufzeichnungVon(partie) { return partie && partie.runden && partie.runden[0]; }

  // Der Computer entscheidet bei fast gleichwertigen Karten zufällig – ein
  // einzelner Durchgang streut darum stark (gemessen: ±20 Punkte). Deshalb
  // mehrere Durchgänge, parallel in Workern, und davon der Schnitt.
  const DURCHGAENGE = 8;

  // Schnitt, Spannweite und der Durchgang am nächsten beim Schnitt (für
  // «So spielt der Computer»).
  function zusammenfassen(laeufe) {
    const n = laeufe.length;
    const mittel = [0, 1].map((t) => laeufe.reduce((a, l) => a + l.punkte[t], 0) / n);
    const eigene = laeufe.map((l) => l.punkte[0]);
    const typisch = laeufe.reduce((a, l) => (Math.abs(l.punkte[0] - mittel[0]) < Math.abs(a.punkte[0] - mittel[0]) ? l : a));
    return {
      punkte: mittel.map((x) => Math.round(x)), laeufe: eigene, min: Math.min(...eigene), max: Math.max(...eigene),
      zuege: typisch.zuege, beispiel: typisch.punkte[0], rechnen: typisch.rechnen,
    };
  }

  // beiFortschritt(anteil 0..1)
  function starte(partie, beiFortschritt, anzahl) {
    // Immer mit der grössten Rechentiefe: Es geht um das Beste, was drin lag.
    const daten = { regeln: partie.regeln, aufzeichnung: aufzeichnungVon(partie), rechnen: 'maximal' };
    const n = anzahl || DURCHGAENGE;
    const kerne = (root.navigator && root.navigator.hardwareConcurrency) || 2;
    const parallel = Math.max(1, Math.min(4, kerne - 1, n));
    return new Promise((ok, fehler) => {
      const laeufe = [];
      const stand = new Array(n).fill(0);
      const worker = [];
      let naechster = 0;
      let vorbei = false;
      const melde = () => { if (beiFortschritt) beiFortschritt(stand.reduce((a, b) => a + b, 0) / (36 * n)); };
      const ende = (x) => {
        if (vorbei) return;
        vorbei = true;
        worker.forEach((w) => w.terminate());
        if (x) fehler(x); else ok(zusammenfassen(laeufe));
      };
      const gib = (w) => {
        if (naechster >= n) return;
        const i = naechster++;
        w.onmessage = (e) => {
          const d = e.data;
          if (d.fehler) { ende(new Error(d.fehler)); return; }
          if (!d.fertig) { stand[i] = d.zug; melde(); return; }
          laeufe.push(d.ergebnis);
          stand[i] = 36;
          melde();
          if (laeufe.length === n) ende(); else gib(w);
        };
        w.postMessage(daten);
      };
      try {
        for (let k = 0; k < parallel; k++) {
          const w = new root.Worker('jass-optimieren.js');
          w.onerror = () => ende(new Error('Worker'));
          worker.push(w);
        }
      } catch (x) {
        worker.forEach((w) => w.terminate());
        worker.length = 0;
      }
      if (!worker.length) {
        // Ohne Worker (sehr alte Browser): zwei Durchgänge direkt.
        try {
          for (let i = 0; i < 2; i++) laeufe.push(nachspielen(daten.regeln, daten.aufzeichnung, daten.rechnen));
          ok(zusammenfassen(laeufe));
        } catch (x) { fehler(x); }
        return;
      }
      worker.forEach(gib);
    });
  }

  const rund = (x) => (x == null ? '–' : Math.round(x));

  // Drei Werte nebeneinander: Ø der eigenen Karten, gespielt, optimiert.
  function werteHtml(o) {
    const opt = o.partie && o.partie.optimiert;
    const kannRechnen = !!(o.partie && o.partie.ende && aufzeichnungVon(o.partie) && aufzeichnungVon(o.partie).ansagen && aufzeichnungVon(o.partie).ansagen.length);
    let dritte;
    if (opt) dritte = `<b>${opt.punkte[0]}</b>${opt.laeufe && opt.laeufe.length > 1 ? `<small>${opt.min}–${opt.max}</small>` : ''}`;
    else if (kannRechnen) dritte = '<button class="btn btn-klein" type="button" data-optimieren>Optimieren</button>';
    else dritte = '<b>–</b>';
    let satz = '';
    if (opt) {
      const d = opt.punkte[0] - o.gespielt;
      satz = d >= 5 ? `Der Computer holt mit genau diesen Karten im Schnitt ${d} Punkte mehr.`
        : d <= -5 ? `${-d} Punkte mehr als der Computer im Schnitt mit genau diesen Karten.`
          : 'So gut wie der Computer mit genau diesen Karten.';
    }
    return `<div class="drei-werte" data-werte>
        <div><span>Ø deine Karten</span><b>${rund(o.schnitt)}</b></div>
        <div><span>Gespielt</span><b>${rund(o.gespielt)}</b></div>
        <div class="optimiert"><span>Optimiert</span>${dritte}</div>
      </div>${satz ? `<p class="muted klein" data-optimiert-satz>${satz}</p>` : ''}`;
  }

  // Knopf «Optimieren» in `el` anschliessen. Nach dem Rechnen steht das
  // Ergebnis in partie.optimiert; speichern(partie) legt es ab.
  function verbinde(el, partie, speichern, beiFertig) {
    const knopf = el && el.querySelector('[data-optimieren]');
    if (!knopf || !partie) return;
    knopf.addEventListener('click', () => {
      const feld = knopf.parentElement;
      feld.innerHTML = '<span>Optimiert</span><b class="rechnet">…</b><i class="fortschritt"><i></i></i>';
      const balken = feld.querySelector('.fortschritt i');
      starte(partie, (anteil) => { balken.style.width = Math.round(100 * anteil) + '%'; })
        .then((erg) => {
          partie.optimiert = Object.assign(erg, { zeit: Date.now() });
          if (speichern) speichern(partie);
          if (beiFertig) beiFertig(partie);
        })
        .catch(() => { feld.innerHTML = '<span>Optimiert</span><b>–</b><small class="muted">ging nicht</small>'; });
    });
  }

  root.JassOptimieren = { vorbereiten, nachspielen, zusammenfassen, starte, werteHtml, verbinde, DURCHGAENGE };
  if (node) module.exports = root.JassOptimieren;
})(typeof self !== 'undefined' ? self : globalThis);
