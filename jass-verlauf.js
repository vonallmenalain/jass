/*
 * jass-verlauf.js – Gespielte Partien gegen den Computer aufzeichnen.
 * ---------------------------------------------------------------------------
 * Jede Partie wird mit allem gespeichert, was man braucht, um einen Zug
 * später nachzuvollziehen: die Karten aller vier zu Beginn jeder Runde, jede
 * Ansage und jeder Zug in der Reihenfolge, bei den Computern mit Stufe und
 * Begründung, bei «Schwer» dazu die durchgerechneten Werte der Karten.
 *
 *   p = JassVerlauf.neu(spiel, spieler, { rechnen })
 *   JassVerlauf.ansage(p, runde, sitz, wahl, info)
 *   JassVerlauf.karte(p, runde, sitz, karte, info)
 *   JassVerlauf.rundeFertig(p, runde, abrechnung)
 *   JassVerlauf.spielFertig(p, spiel)
 *   JassVerlauf.speichere(p)     → im Browser (localStorage), die letzten 40
 *
 * Exportiert wird dasselbe Objekt als JSON-Datei; werkzeuge/analyse.js liest
 * sie und rechnet einzelne Züge nach.
 */
(function (root) {
  'use strict';

  const KEY = 'jass-lernen-partien-v1';
  const MAX = 40;

  function neu(spiel, spieler, optionen) {
    const o = optionen || {};
    const jetzt = Date.now();
    return {
      format: 'jass-partie',
      version: 1,
      id: 'p' + jetzt.toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      start: jetzt,
      ende: null,
      regeln: JSON.parse(JSON.stringify(spiel.regeln)),
      spieler: spieler.map((x) => ({ name: x.name, typ: x.typ })),
      rechnen: o.rechnen || 'normal',
      runden: [],
      summe: [0, 0],
      sieger: null,
      notizen: [],
    };
  }

  // Die Aufzeichnung der Runde – beim ersten Zugriff mit den Startkarten.
  function runde(p, r) {
    let x = p.runden.find((y) => y.nr === r.nr);
    if (!x) {
      x = { nr: r.nr, ansager: r.ansager, haende: r.startHaende.map((h) => h.slice()), ansagen: [], zuege: [], abrechnung: null };
      p.runden.push(x);
      p.runden.sort((a, b) => a.nr - b.nr);
    }
    return x;
  }

  function rund(x) { return Math.round(x * 10) / 10; }

  function ansage(p, r, sitz, wahl, info) {
    const i = info || {};
    const e = { s: sitz, wahl };
    if (i.stufe) e.stufe = i.stufe;
    if (i.grund) e.grund = i.grund;
    if (i.liste) e.werte = i.liste.slice(0, 6).map((x) => ({ c: x.code, p: rund(x.punkte) }));
    runde(p, r).ansagen.push(e);
  }

  function karte(p, r, sitz, k, info) {
    const i = info || {};
    const x = runde(p, r);
    const e = { s: sitz, k, stich: r.stichNr };
    if (i.stufe) e.stufe = i.stufe;
    if (i.grund) e.grund = i.grund;
    if (i.tipp != null) e.tipp = i.tipp;
    if (i.werte) e.werte = i.werte.slice(0, 9).map((w) => ({ k: w.karte, w: rund(w.wert) }));
    x.zuege.push(e);
  }

  function rundeFertig(p, r, abrechnung) {
    const x = runde(p, r);
    x.code = r.code;
    x.angesagtVon = r.angesagtVon;
    x.geschoben = r.geschoben;
    x.abrechnung = JSON.parse(JSON.stringify(abrechnung));
  }

  function spielFertig(p, spiel) {
    p.ende = Date.now();
    p.summe = spiel.summe.slice();
    p.sieger = spiel.sieger;
  }

  function notiz(p, eintrag) {
    p.notizen.push(Object.assign({ zeit: Date.now() }, eintrag));
  }

  // --------------------------------------------------------- Speicher

  function alle() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(KEY);
      const liste = raw ? JSON.parse(raw) : [];
      return Array.isArray(liste) ? liste : [];
    } catch (e) { return []; }
  }

  function schreibeAlle(liste) {
    // Wird es zu gross, fallen die ältesten weg.
    let l = liste.slice(0, MAX);
    while (l.length) {
      try { root.localStorage.setItem(KEY, JSON.stringify(l)); return true; } catch (e) { l = l.slice(0, -1); }
    }
    return false;
  }

  function speichere(p) {
    const liste = alle().filter((x) => x.id !== p.id);
    liste.unshift(p);
    liste.sort((a, b) => b.start - a.start);
    return schreibeAlle(liste);
  }

  function lade(id) { return alle().find((x) => x.id === id) || null; }

  function loesche(id) { schreibeAlle(alle().filter((x) => x.id !== id)); }

  function dateiname(p) {
    const d = new Date(p.start);
    const zwei = (n) => String(n).padStart(2, '0');
    return `jass-partie-${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}-${zwei(d.getHours())}${zwei(d.getMinutes())}.json`;
  }

  // Prüft, ob ein eingelesenes Objekt eine Partie ist.
  function istPartie(x) {
    return !!x && x.format === 'jass-partie' && Array.isArray(x.runden) && Array.isArray(x.spieler);
  }

  const api = { neu, runde, ansage, karte, rundeFertig, spielFertig, notiz, alle, speichere, lade, loesche, dateiname, istPartie, KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JassVerlauf = api;
})(typeof self !== 'undefined' ? self : this);
