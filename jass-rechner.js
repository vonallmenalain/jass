/*
 * jass-rechner.js – die Züge des Computers im Hintergrund rechnen.
 * ---------------------------------------------------------------------------
 * Ein Zug von «Schwer» rechnet im Schnitt etwa 2 Sekunden (selten bis 8).
 * Im Hauptablauf der Seite würde sie so lange einfrieren (Animationen
 * ruckeln). Darum rechnet ein Web
 * Worker – dieselbe Datei, mit jass-engine.js und jass-bot.js.
 *
 *   JassRechner.zug(spiel, sitz, stufe, optionen)    → Promise({ karte, grund, werte, annahmen, ohne })
 *   JassRechner.ansage(spiel, sitz, stufe, optionen) → Promise({ code, grund, liste })
 *   JassRechner.tipp(spiel, sitz, optionen)          → Promise wie zug (schwerZug)
 *
 * Gibt es keinen Worker (oder fällt er aus), rechnet die Seite selbst – wie
 * früher.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const imWorker = !node && typeof importScripts === 'function' && typeof document === 'undefined';

  function rechneDirekt(B, art, spiel, sitz, stufe, optionen) {
    if (art === 'ansage') return B.waehleAnsage(spiel, sitz, stufe, optionen);
    if (art === 'tipp') return B.schwerZug(spiel, sitz, optionen);
    return B.waehleKarte(spiel, sitz, stufe, optionen);
  }

  if (imWorker) {
    importScripts('jass-engine.js', 'jass-bot.js');
    root.onmessage = (e) => {
      const d = e.data;
      try {
        const erg = rechneDirekt(root.JassBot, d.art, d.spiel, d.sitz, d.stufe, d.optionen);
        root.postMessage({ id: d.id, erg });
      } catch (x) {
        root.postMessage({ id: d.id, fehler: String((x && x.message) || x) });
      }
    };
    return;
  }

  let worker = null;          // null: noch nicht versucht · false: geht nicht
  let nummer = 0;
  const offen = new Map();

  function holeWorker() {
    if (worker !== null) return worker;
    try {
      worker = new root.Worker('jass-rechner.js');
      worker.onmessage = (e) => {
        const d = e.data;
        const auftrag = offen.get(d.id);
        if (!auftrag) return;
        offen.delete(d.id);
        if (d.fehler) auftrag.direkt(); else auftrag.ok(d.erg);
      };
      worker.onerror = () => {
        // Worker kaputt: alle offenen Aufträge direkt rechnen, ab jetzt ohne Worker
        worker.terminate();
        worker = false;
        const alle = Array.from(offen.values());
        offen.clear();
        alle.forEach((a) => a.direkt());
      };
    } catch (x) { worker = false; }
    return worker;
  }

  function rechne(art, spiel, sitz, stufe, optionen) {
    const B = root.JassBot;
    const opt = Object.assign({}, optionen || {});
    delete opt.rng;   // Zufall lässt sich nicht übergeben – der Worker zieht selbst
    return new Promise((ok, fehler) => {
      const direkt = () => { try { ok(rechneDirekt(B, art, spiel, sitz, stufe, opt)); } catch (x) { fehler(x); } };
      const w = holeWorker();
      if (!w) { setTimeout(direkt, 0); return; }
      const id = ++nummer;
      offen.set(id, { ok, direkt });
      try {
        w.postMessage({ id, art, spiel: JSON.parse(JSON.stringify(spiel)), sitz, stufe, optionen: opt });
      } catch (x) {
        offen.delete(id);
        setTimeout(direkt, 0);
      }
    });
  }

  root.JassRechner = {
    zug: (spiel, sitz, stufe, optionen) => rechne('karte', spiel, sitz, stufe, optionen),
    ansage: (spiel, sitz, stufe, optionen) => rechne('ansage', spiel, sitz, stufe, optionen),
    tipp: (spiel, sitz, optionen) => rechne('tipp', spiel, sitz, 'schwer', optionen),
  };
})(typeof self !== 'undefined' ? self : globalThis);
