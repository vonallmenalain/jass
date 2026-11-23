/*
 * jass-verlauf.js – Gespielte Partien gegen den Computer aufzeichnen.
 * ---------------------------------------------------------------------------
 * Jede Partie wird mit allem gespeichert, was man braucht, um einen Zug
 * später nachzuvollziehen: die Karten aller vier zu Beginn jeder Runde, jede
 * Ansage und jeder Zug in der Reihenfolge, bei den Computern mit Stufe und
 * Begründung, bei «Schwer» dazu die durchgerechneten Werte der Karten.
 *
 * Auch die im Trumpf-Trainer ausgespielten Hände landen hier (quelle
 * 'trainer'), zusammen mit dem, was der Trainer für jede Ansage errechnet
 * hatte. Behalten werden die letzten 40 Partien und die letzten 60
 * Trainer-Hände.
 *
 *   p = JassVerlauf.neu(spiel, spieler, { rechnen, quelle, trainer })
 *   JassVerlauf.ansage(p, runde, sitz, wahl, info)
 *   JassVerlauf.karte(p, runde, sitz, karte, info)
 *   JassVerlauf.rundeFertig(p, runde, abrechnung)
 *   JassVerlauf.spielFertig(p, spiel)
 *   JassVerlauf.speichere(p)     → im Browser (localStorage), die letzten 40
 *
 * Markierungen (🚩, Notiz zu einem Stich) sammeln sich als Fragen zur
 * Analyse: markierungenOffen() zählt die noch nicht heruntergeladenen,
 * markierungsDatei() packt alle Runden mit offenen Markierungen in eine
 * Datei, markiereHeruntergeladen(datei) hakt sie ab – die nächste Datei
 * beginnt wieder neu. Partien mit offenen Markierungen fallen nicht weg.
 *
 * Exportiert wird dasselbe Objekt als JSON-Datei; werkzeuge/analyse.js liest
 * sie und rechnet einzelne Züge nach.
 */
(function (root) {
  'use strict';

  const KEY = 'jass-lernen-partien-v1';
  const MAX = { spiel: 40, trainer: 60 };
  const quelleVon = (p) => (p && p.quelle === 'trainer' ? 'trainer' : 'spiel');

  function neu(spiel, spieler, optionen) {
    const o = optionen || {};
    const jetzt = Date.now();
    const p = {
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
    if (o.welten) p.welten = o.welten;
    if (o.quelle === 'trainer') {
      p.quelle = 'trainer';
      if (o.trainer) p.trainer = JSON.parse(JSON.stringify(o.trainer));
    }
    return p;
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

  const hatOffene = (p) => (p.notizen || []).some((n) => !n.exportiert);

  function schreibeAlle(liste) {
    // Je Quelle nur die neusten; wird es zu gross, fallen die ältesten weg –
    // ausser sie haben noch nicht heruntergeladene Markierungen.
    const zaehler = { spiel: 0, trainer: 0 };
    let l = liste.filter((p) => ++zaehler[quelleVon(p)] <= MAX[quelleVon(p)] || hatOffene(p));
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
    return `jass-${quelleVon(p) === 'trainer' ? 'trainer' : 'partie'}-${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}-${zwei(d.getHours())}${zwei(d.getMinutes())}.json`;
  }

  // ------------------------------------------------------ Markierungen

  function markierungenOffen() {
    return alle().reduce((n, p) => n + (p.notizen || []).filter((x) => !x.exportiert).length, 0);
  }

  // Eine Datei mit allen Runden, die offene Markierungen haben – je Partie
  // Regeln, Spieler, Rechentiefe und nur diese Runden mit allen Zügen.
  function markierungsDatei() {
    const partien = [];
    for (const p of alle()) {
      const offen = (p.notizen || []).filter((x) => !x.exportiert);
      if (!offen.length) continue;
      const runden = new Set(offen.map((x) => x.runde));
      const kopie = JSON.parse(JSON.stringify(p));
      kopie.runden = kopie.runden.filter((r) => runden.has(r.nr));
      kopie.notizen = offen.map((x) => Object.assign({}, x));
      partien.push(kopie);
    }
    const anzahl = partien.reduce((n, p) => n + p.notizen.length, 0);
    return { format: 'jass-markierungen', version: 1, erstellt: Date.now(), anzahl, partien };
  }

  // Die Markierungen dieser Datei als heruntergeladen abhaken.
  function markiereHeruntergeladen(datei) {
    const jetzt = Date.now();
    const schluessel = (id, n) => id + '|' + n.zeit + '|' + n.runde + '|' + n.stich;
    const erledigt = new Set();
    for (const p of datei.partien) for (const n of p.notizen) erledigt.add(schluessel(p.id, n));
    const liste = alle();
    for (const p of liste) for (const n of p.notizen || []) if (erledigt.has(schluessel(p.id, n))) n.exportiert = jetzt;
    return schreibeAlle(liste);
  }

  function markierungsDateiname() {
    const d = new Date();
    const zwei = (n) => String(n).padStart(2, '0');
    return `jass-markierungen-${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}-${zwei(d.getHours())}${zwei(d.getMinutes())}.json`;
  }

  // Prüft, ob ein eingelesenes Objekt eine Partie ist.
  function istPartie(x) {
    return !!x && x.format === 'jass-partie' && Array.isArray(x.runden) && Array.isArray(x.spieler);
  }

  const api = {
    neu, runde, ansage, karte, rundeFertig, spielFertig, notiz, alle, speichere, lade, loesche, dateiname, istPartie, quelleVon, KEY,
    markierungenOffen, markierungsDatei, markiereHeruntergeladen, markierungsDateiname,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JassVerlauf = api;
})(typeof self !== 'undefined' ? self : globalThis);
