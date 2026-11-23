/*
 * jass-toene.js – dezente Töne am Spieltisch (WebAudio, ohne Dateien).
 * ---------------------------------------------------------------------------
 *   JassToene.setze({ klang, lautstaerke })   klang: 'aus' | 'papier' | 'holz' | 'weich'
 *                                             lautstaerke: 0..100
 *   JassToene.karte(seite)    eine Karte wird gespielt; seite -1 (links) … 1 (rechts)
 *   JassToene.austeilen()     ein Päckchen fliegt beim Austeilen
 *   JassToene.stich()         der Stich wird abgeräumt
 *   JassToene.klick()         Antippen (Karte wählen, Ansage, Knöpfe)
 *   JassToene.probe(klang)    kurze Hörprobe eines Klangs
 *
 * Alle Töne werden erzeugt (Rauschen und Sinus mit kurzer Hüllkurve) – leise
 * und kurz, als Rückmeldung, nicht als Musik. Der Browser erlaubt Ton erst
 * nach einer Berührung; vorher bleibt es still.
 */
(function (root) {
  'use strict';

  const KLAENGE = [
    ['aus', 'Aus'],
    ['papier', 'Papier'],
    ['holz', 'Holz'],
    ['weich', 'Weich'],
  ];
  let einst = { klang: 'papier', lautstaerke: 45 };
  let ctx = null;
  let rauschPuffer = null;

  function setze(e) {
    if (!e) return;
    if (e.klang && KLAENGE.some((k) => k[0] === e.klang)) einst.klang = e.klang;
    if (e.lautstaerke != null && isFinite(e.lautstaerke)) einst.lautstaerke = Math.max(0, Math.min(100, Number(e.lautstaerke)));
  }

  function audio() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function rauschen(c) {
    if (!rauschPuffer || rauschPuffer.sampleRate !== c.sampleRate) {
      const n = Math.floor(c.sampleRate * 0.5);
      rauschPuffer = c.createBuffer(1, n, c.sampleRate);
      const d = rauschPuffer.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return rauschPuffer;
  }

  // Ausgang mit Lautstärke und (optional) Stereo-Lage.
  function ausgang(c, pegel, seite) {
    const g = c.createGain();
    g.gain.value = pegel * (einst.lautstaerke / 100) * 0.9;
    let knoten = g;
    if (seite && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, seite));
      g.connect(p);
      p.connect(c.destination);
    } else g.connect(c.destination);
    return knoten;
  }

  // Rauschen durch einen Filter, mit kurzer Hüllkurve.
  function geraeusch(c, ziel, { typ = 'bandpass', frequenz = 2500, q = 0.8, bis = null, dauer = 0.06, pegel = 1, angriff = 0.002, start = 0 }) {
    const t = c.currentTime + start;
    const quelle = c.createBufferSource();
    quelle.buffer = rauschen(c);
    const f = c.createBiquadFilter();
    f.type = typ; f.frequency.setValueAtTime(frequenz, t); f.Q.value = q;
    if (bis) f.frequency.exponentialRampToValueAtTime(bis, t + dauer);
    const h = c.createGain();
    h.gain.setValueAtTime(0.0001, t);
    h.gain.exponentialRampToValueAtTime(pegel, t + angriff);
    h.gain.exponentialRampToValueAtTime(0.0001, t + dauer);
    quelle.connect(f); f.connect(h); h.connect(ziel);
    quelle.start(t, Math.random() * 0.3, dauer + 0.05);
  }

  // Ein kurzer Ton mit fallender Tonhöhe.
  function ton(c, ziel, { frequenz = 800, bis = null, dauer = 0.08, pegel = 1, form = 'sine', start = 0 }) {
    const t = c.currentTime + start;
    const o = c.createOscillator();
    o.type = form;
    o.frequency.setValueAtTime(frequenz, t);
    if (bis) o.frequency.exponentialRampToValueAtTime(bis, t + dauer);
    const h = c.createGain();
    h.gain.setValueAtTime(0.0001, t);
    h.gain.exponentialRampToValueAtTime(pegel, t + 0.004);
    h.gain.exponentialRampToValueAtTime(0.0001, t + dauer);
    o.connect(h); h.connect(ziel);
    o.start(t); o.stop(t + dauer + 0.02);
  }

  // Was jeder Klang bei jedem Anlass spielt.
  const MUSTER = {
    papier: {
      karte: (c, z) => { geraeusch(c, z, { frequenz: 2200, q: 0.7, dauer: 0.07, pegel: 0.9 }); geraeusch(c, z, { typ: 'lowpass', frequenz: 500, dauer: 0.05, pegel: 0.5 }); },
      austeilen: (c, z) => { geraeusch(c, z, { frequenz: 4200, q: 1, dauer: 0.035, pegel: 0.35 }); geraeusch(c, z, { frequenz: 3600, q: 1, dauer: 0.03, pegel: 0.25, start: 0.045 }); },
      stich: (c, z) => geraeusch(c, z, { typ: 'lowpass', frequenz: 3200, bis: 500, q: 0.5, dauer: 0.2, angriff: 0.03, pegel: 0.35 }),
      klick: (c, z) => geraeusch(c, z, { typ: 'highpass', frequenz: 3000, dauer: 0.012, pegel: 0.25 }),
    },
    holz: {
      karte: (c, z) => { ton(c, z, { frequenz: 950, bis: 620, dauer: 0.07, pegel: 0.6, form: 'triangle' }); geraeusch(c, z, { frequenz: 1800, q: 2, dauer: 0.02, pegel: 0.3 }); },
      austeilen: (c, z) => ton(c, z, { frequenz: 1500, bis: 1100, dauer: 0.035, pegel: 0.25, form: 'triangle' }),
      stich: (c, z) => { ton(c, z, { frequenz: 720, bis: 560, dauer: 0.08, pegel: 0.35, form: 'triangle' }); ton(c, z, { frequenz: 540, bis: 420, dauer: 0.09, pegel: 0.3, form: 'triangle', start: 0.09 }); },
      klick: (c, z) => ton(c, z, { frequenz: 2000, bis: 1600, dauer: 0.015, pegel: 0.2, form: 'triangle' }),
    },
    weich: {
      karte: (c, z) => ton(c, z, { frequenz: 230, bis: 150, dauer: 0.12, pegel: 0.8 }),
      austeilen: (c, z) => ton(c, z, { frequenz: 340, bis: 260, dauer: 0.05, pegel: 0.3 }),
      stich: (c, z) => { ton(c, z, { frequenz: 392, dauer: 0.22, pegel: 0.22 }); ton(c, z, { frequenz: 523, dauer: 0.25, pegel: 0.16, start: 0.06 }); },
      klick: (c, z) => ton(c, z, { frequenz: 620, bis: 520, dauer: 0.02, pegel: 0.18 }),
    },
  };

  function spiele(anlass, seite, klang) {
    const k = klang || einst.klang;
    if (k === 'aus' || !MUSTER[k] || einst.lautstaerke <= 0) return;
    const c = audio();
    if (!c) return;
    try { MUSTER[k][anlass](c, ausgang(c, 1, seite)); } catch (e) { /* Ton ist nur Zugabe */ }
  }

  function probe(klang) {
    const k = klang || einst.klang;
    spiele('karte', -0.4, k);
    setTimeout(() => spiele('karte', 0.4, k), 260);
    setTimeout(() => spiele('austeilen', 0, k), 560);
    setTimeout(() => spiele('stich', 0, k), 820);
  }

  root.JassToene = {
    KLAENGE, setze, probe,
    karte: (seite) => spiele('karte', seite),
    austeilen: () => spiele('austeilen', 0),
    stich: () => spiele('stich', 0),
    klick: () => spiele('klick', 0),
    einstellung: () => Object.assign({}, einst),
  };
})(typeof self !== 'undefined' ? self : this);
