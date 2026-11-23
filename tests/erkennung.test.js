'use strict';
// Kartenerkennung: Auswertung der Heatmaps, Vorbereitung der Pixel, Netzgrösse.
// (Das Netz selbst wird im Browser getestet: werkzeuge/erkennung/browser-test.mjs.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../jass-erkennung.js');

test('auswerten: die stärksten Karten mit Fundstelle', () => {
  const h = 4, w = 5, n = h * w;
  const daten = new Float32Array(36 * n).fill(-8);
  daten[7 * n + 2 * w + 3] = 3;      // Karte 7 stark bei (3, 2)
  daten[20 * n + 0] = 0.5;           // Karte 20 mittel bei (0, 0)
  daten[33 * n + n - 1] = -0.5;      // Karte 33 schwach unten rechts
  const r = R.auswerten(daten, h, w, 3);
  assert.deepEqual(r.karten.map((k) => k.karte), [7, 20, 33]);
  assert.ok(r.karten[0].wert > 0.95 && r.karten[2].wert < 0.5);
  assert.equal(r.karten[0].x, 3.5 / 5);
  assert.equal(r.karten[0].y, 2.5 / 4);
  assert.equal(r.alle.length, 36);
  assert.equal(R.auswerten(daten, h, w).karten.length, 9, 'ohne Angabe: 9 Karten (eine Jass-Hand)');
});

test('vorbereiten: RGBA → normierte Kanäle (wie beim Training)', () => {
  const rgba = new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 0, 255]);
  const t = R.vorbereiten(rgba, 2, 1);
  assert.equal(t.length, 6);
  assert.ok(Math.abs(t[0] - (1 - 0.485) / 0.229) < 1e-6);   // R von Pixel 1
  assert.ok(Math.abs(t[1] - (0 - 0.485) / 0.229) < 1e-6);   // R von Pixel 2
  assert.ok(Math.abs(t[3] - (1 - 0.456) / 0.224) < 1e-6);   // G von Pixel 2
});

test('netzGroesse: kurze Seite 320, Vielfache von 32', () => {
  assert.deepEqual(R.netzGroesse(3072, 4096), { w: 320, h: 416 });
  assert.deepEqual(R.netzGroesse(4000, 3000), { w: 416, h: 320 });
  const g = R.netzGroesse(1080, 2400);
  assert.equal(g.w % 32, 0); assert.equal(g.h % 32, 0);
});

test('Das Netz liegt bei der App', () => {
  const datei = path.join(__dirname, '..', R.MODELL);
  assert.ok(fs.existsSync(datei), R.MODELL);
  const gr = fs.statSync(datei).size;
  assert.ok(gr > 1e6 && gr < 8e6, 'Grösse ' + gr);
});
