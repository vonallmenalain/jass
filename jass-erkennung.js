/*
 * jass-erkennung.js – Karten auf einem Foto der Hand erkennen.
 * ---------------------------------------------------------------------------
 * Das Netz (erkennung/karten-2.onnx) ist ein MobileNetV3 mit kleinem FPN: Es
 * liefert für jede der 36 Karten eine Heatmap (ein Wert pro 8 × 8 Pixel), die
 * dort anschlägt, wo eine Ecke dieser Karte zu sehen ist (bei Bildkarten auch
 * ein Stück der Figur). Trainiert wurde es nur mit künstlichen Kartenfächern
 * aus unseren Kartenbildern – siehe werkzeuge/erkennung/.
 *
 * Gerechnet wird im Browser mit onnxruntime-web. Es wird erst beim ersten
 * Foto vom CDN geladen (feste Version), das Netz selbst kommt von hier.
 *
 *   JassErkennung.erkenne(datei | bild, { anzahl: 9 })
 *     → Promise<{ karten: [{ karte, wert, x, y }], alle: [36 Werte] }>
 *        karte = 0..35 wie in jass-engine.js, wert = 0..1 (Sicherheit),
 *        x/y = Fundstelle als Anteil von Breite/Höhe des Fotos
 *
 * auswerten() und vorbereiten() sind reine Funktionen und laufen auch in Node.
 */
(function (root) {
  'use strict';

  const ORT_VERSION = '1.20.1';
  const ORT_BASIS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist/';
  const MODELL = 'erkennung/karten-2.onnx';
  const KURZE_SEITE = 416;        // so gross wurde nachtrainiert (Karten ~70–200 px breit)
  const STUFE = 8;
  const MITTEL = [0.485, 0.456, 0.406];
  const STREUUNG = [0.229, 0.224, 0.225];
  // Ab diesem Wert gilt eine Karte als sicher erkannt; darunter fragt die
  // Seite nach (die Karte wird trotzdem vorgewählt, wenn sie unter den 9
  // stärksten ist).
  const SICHER = 0.55;

  const sigmoid = (v) => 1 / (1 + Math.exp(-v));

  // Ausgabe des Netzes (36 × h × w, Logits) → die stärksten Karten.
  function auswerten(daten, h, w, anzahl) {
    const n = h * w;
    const alle = new Array(36);
    const ort = new Array(36);
    for (let k = 0; k < 36; k++) {
      let best = -Infinity, wo = 0;
      const o = k * n;
      for (let i = 0; i < n; i++) if (daten[o + i] > best) { best = daten[o + i]; wo = i; }
      alle[k] = sigmoid(best);
      ort[k] = wo;
    }
    const reihenfolge = alle.map((_, k) => k).sort((a, b) => alle[b] - alle[a]);
    const karten = reihenfolge.slice(0, anzahl == null ? 9 : anzahl).map((k) => ({
      karte: k,
      wert: alle[k],
      x: ((ort[k] % w) + 0.5) / w,
      y: (Math.floor(ort[k] / w) + 0.5) / h,
    }));
    return { karten, alle };
  }

  // RGBA-Pixel (Canvas) → Float32Array 3 × h × w, normiert wie beim Training.
  function vorbereiten(rgba, w, h) {
    const n = w * h;
    const t = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) t[c * n + i] = (rgba[i * 4 + c] / 255 - MITTEL[c]) / STREUUNG[c];
    }
    return t;
  }

  // Grösse fürs Netz: kurze Seite 416, beide Seiten Vielfache von 32.
  function netzGroesse(breite, hoehe) {
    const s = KURZE_SEITE / Math.min(breite, hoehe);
    return { w: Math.max(32, Math.round((breite * s) / 32) * 32), h: Math.max(32, Math.round((hoehe * s) / 32) * 32) };
  }

  let ortLaden = null;
  function ladeOrt() {
    if (root.ort) return Promise.resolve(root.ort);
    if (!ortLaden) {
      ortLaden = new Promise((ok, fehler) => {
        const s = document.createElement('script');
        s.src = ORT_BASIS + 'ort.min.js';
        s.crossOrigin = 'anonymous';
        s.onload = () => {
          const ort = root.ort;
          if (!ort) { fehler(new Error('onnxruntime fehlt')); return; }
          ort.env.wasm.wasmPaths = ORT_BASIS;
          ort.env.wasm.numThreads = 1;
          ok(ort);
        };
        s.onerror = () => { ortLaden = null; fehler(new Error('Die Erkennung konnte nicht geladen werden (keine Verbindung?).')); };
        document.head.appendChild(s);
      });
    }
    return ortLaden;
  }

  let sitzungLaden = null;
  function sitzung() {
    if (!sitzungLaden) {
      sitzungLaden = ladeOrt()
        .then((ort) => ort.InferenceSession.create(MODELL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }))
        .catch((e) => { sitzungLaden = null; throw e; });
    }
    return sitzungLaden;
  }

  async function bitmapVon(quelle) {
    if (typeof Blob !== 'undefined' && quelle instanceof Blob) {
      try { return await createImageBitmap(quelle, { imageOrientation: 'from-image' }); } catch (e) { /* älterer Browser */ }
      const url = URL.createObjectURL(quelle);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }
    return quelle;
  }

  async function erkenne(quelle, o) {
    o = o || {};
    const [s, bild] = await Promise.all([sitzung(), bitmapVon(quelle)]);
    const breite = bild.naturalWidth || bild.width, hoehe = bild.naturalHeight || bild.height;
    const { w, h } = netzGroesse(breite, hoehe);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bild, 0, 0, w, h);
    const daten = vorbereiten(ctx.getImageData(0, 0, w, h).data, w, h);
    const ort = root.ort;
    const aus = await s.run({ bild: new ort.Tensor('float32', daten, [1, 3, h, w]) });
    const t = aus.karten;
    return auswerten(t.data, t.dims[2], t.dims[3], o.anzahl);
  }

  // Schon mal laden (z. B. sobald jemand auf «Foto» tippt).
  function vorladen() { return sitzung().then(() => true, () => false); }

  const api = { erkenne, vorladen, auswerten, vorbereiten, netzGroesse, SICHER, MODELL, ORT_VERSION, STUFE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JassErkennung = api;
})(typeof window !== 'undefined' ? window : globalThis);
