'use strict';
// Markierungen sammeln, als eine Datei herunterladen, danach abhaken.
const test = require('node:test');
const assert = require('node:assert/strict');

const speicher = new Map();
global.localStorage = { getItem: (k) => (speicher.has(k) ? speicher.get(k) : null), setItem: (k, v) => speicher.set(k, String(v)), removeItem: (k) => speicher.delete(k) };
const J = require('../jass-engine.js');
const V = require('../jass-verlauf.js');

function partie(id, start, runden) {
  const spiel = J.neuesSpiel(J.regelnMitStandard(), { seed: start });
  const p = V.neu(spiel, [{ name: 'Du', typ: 'mensch' }, { name: 'A', typ: 'schwer' }, { name: 'B', typ: 'schwer' }, { name: 'C', typ: 'schwer' }]);
  p.id = id; p.start = start;
  p.runden = Array.from({ length: runden }, (_, nr) => ({ nr, ansager: 0, haende: [[], [], [], []], ansagen: [], zuege: [] }));
  return p;
}

test('Markierungen: offene zählen, als Datei nur die markierten Runden, danach neu beginnen', () => {
  speicher.clear();
  const a = partie('a', 1000, 4);
  V.notiz(a, { runde: 1, stich: 3, text: 'Warum kein Trumpf?' });
  V.notiz(a, { runde: 3, stich: 0, text: 'Komisch' });
  const b = partie('b', 2000, 2);
  V.speichere(a); V.speichere(b);
  assert.equal(V.markierungenOffen(), 2);
  const d = V.markierungsDatei();
  assert.equal(d.format, 'jass-markierungen');
  assert.equal(d.anzahl, 2);
  assert.equal(d.partien.length, 1);
  assert.deepEqual(d.partien[0].runden.map((r) => r.nr), [1, 3]);
  V.markiereHeruntergeladen(d);
  assert.equal(V.markierungenOffen(), 0);
  assert.equal(V.markierungsDatei().anzahl, 0);
  // Eine neue Markierung: nur sie kommt in die nächste Datei.
  const b2 = V.lade('b');
  V.notiz(b2, { runde: 0, stich: 5, text: 'Neu' });
  V.speichere(b2);
  const d2 = V.markierungsDatei();
  assert.equal(d2.anzahl, 1);
  assert.equal(d2.partien[0].id, 'b');
  assert.match(V.markierungsDateiname(), /^jass-markierungen-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
});

test('Partien mit offenen Markierungen fallen beim Aufräumen nicht weg', () => {
  speicher.clear();
  const alt = partie('alt', 1, 1);
  V.notiz(alt, { runde: 0, stich: 0, text: 'Bitte anschauen' });
  V.speichere(alt);
  for (let i = 0; i < 45; i++) V.speichere(partie('p' + i, 100 + i, 1));
  assert.ok(V.lade('alt'), 'markierte Partie ist noch da');
  assert.equal(V.markierungenOffen(), 1);
});
