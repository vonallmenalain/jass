'use strict';
// Link-Vorschau für Turniere (netlify/vorschau.mjs und die Edge-Funktion).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const laden = () => import('../netlify/vorschau.mjs');
const DOK = {
  fields: {
    title: { stringValue: 'von Allmen Jass - 2026' },
    status: { stringValue: 'finished' },
    players: { arrayValue: { values: [{ stringValue: 'A' }, { stringValue: 'B' }, { stringValue: 'C' }] } },
  },
};

test('Turnier aus dem Firestore-Dokument', async () => {
  const V = await laden();
  assert.deepEqual(V.ausDokument(DOK), { titel: 'von Allmen Jass - 2026', spieler: 3, fertig: true });
  assert.equal(V.ausDokument({ fields: {} }), null);
  assert.equal(V.ausDokument(null), null);
  assert.equal(V.beschreibung({ spieler: 3, fertig: true }), '3 Spieler · beendet');
  assert.equal(V.beschreibung({ spieler: 0, fertig: false }), 'läuft');
});

test('nur saubere IDs gehen an Firestore', async () => {
  const V = await laden();
  assert.ok(V.gueltigeId('turnier_moe9dvka2bmt7r'));
  assert.ok(V.gueltigeId('allgemein_turnier_mwtxyd7s95iibf'));
  for (const x of [null, '', '../x', 'a/b', 'a?b', 'x'.repeat(81)]) assert.ok(!V.gueltigeId(x), String(x));
  assert.match(V.turnierAdresse('turnier_abc'), /documents\/turniere\/turnier_abc\?mask\.fieldPaths=title/);
});

for (const datei of ['turnier.html', 'turnier-allgemein.html']) {
  test(`${datei}: Titel und og-Tags werden ersetzt, nichts doppelt`, async () => {
    const V = await laden();
    const html = fs.readFileSync(path.join(__dirname, '..', datei), 'utf8');
    const neu = V.mitVorschau(html, { titel: 'Cup <2026> & "Final"', spieler: 12, fertig: false }, 'https://jass.alae.app/turnier?id=x');
    assert.match(neu, /<title>Cup &lt;2026&gt; &amp; &quot;Final&quot;<\/title>/);
    assert.match(neu, /<meta property="og:title" content="Cup &lt;2026&gt; &amp; &quot;Final&quot;" \/>/);
    assert.match(neu, /<meta property="og:description" content="12 Spieler · läuft" \/>/);
    assert.match(neu, /<meta property="og:url" content="https:\/\/jass.alae.app\/turnier\?id=x" \/>/);
    assert.match(neu, /<meta property="og:image" content="https:\/\/jass.alae.app\/icons\/teilen.png" \/>/);
    for (const tag of ['og:title', 'og:description', 'og:url']) assert.equal(neu.split(`property="${tag}"`).length, 2, tag);
    assert.equal(neu.split('<title>').length, 2);
  });
}

test('Edge-Funktion: Seite mit Turniername, sonst unverändert', async () => {
  const { default: funktion, config } = await import('../netlify/edge-functions/turnier-vorschau.js');
  assert.deepEqual(config.path, ['/turnier', '/turnier.html', '/turnier-allgemein', '/turnier-allgemein.html']);
  const html = fs.readFileSync(path.join(__dirname, '..', 'turnier.html'), 'utf8');
  const kontext = { next: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8', etag: 'x' } }) };
  const altFetch = globalThis.fetch;
  const abgefragt = [];
  globalThis.fetch = async (u) => { abgefragt.push(String(u)); return new Response(JSON.stringify(DOK), { status: 200 }); };
  try {
    const r = await funktion(new Request('https://jass.alae.app/turnier?id=turnier_moe9dvka2bmt7r'), kontext);
    const text = await r.text();
    assert.match(text, /<meta property="og:title" content="von Allmen Jass - 2026" \/>/);
    assert.match(text, /<title>von Allmen Jass - 2026<\/title>/);
    assert.equal(r.headers.get('etag'), null);
    assert.equal(abgefragt.length, 1);

    const ohne = await funktion(new Request('https://jass.alae.app/turnier'), kontext);
    assert.match(await ohne.text(), /<title>von Allmen Jass<\/title>/);
    const boese = await funktion(new Request('https://jass.alae.app/turnier?id=../../x'), kontext);
    assert.match(await boese.text(), /<title>von Allmen Jass<\/title>/);
    assert.equal(abgefragt.length, 1);

    globalThis.fetch = async () => { throw new Error('offline'); };
    const fehler = await funktion(new Request('https://jass.alae.app/turnier?id=turnier_x'), kontext);
    assert.equal(fehler.status, 200);
    assert.match(await fehler.text(), /<title>von Allmen Jass<\/title>/);
  } finally { globalThis.fetch = altFetch; }
});

test('Icons und Manifest zeigen auf vorhandene Dateien', () => {
  const wurzel = path.join(__dirname, '..');
  const m = JSON.parse(fs.readFileSync(path.join(wurzel, 'app.webmanifest'), 'utf8'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(wurzel, i.src)), i.src);
  for (const f of ['icons/logo.svg', 'icons/favicon-32.png', 'icons/apple-touch-icon.png', 'icons/teilen.png', 'favicon.ico']) {
    assert.ok(fs.existsSync(path.join(wurzel, f)), f);
  }
  for (const seite of fs.readdirSync(wurzel).filter((f) => f.endsWith('.html'))) {
    const s = fs.readFileSync(path.join(wurzel, seite), 'utf8');
    assert.match(s, /rel="icon" href="icons\/logo.svg"/, seite);
    assert.match(s, /property="og:title"/, seite);
    assert.match(s, /src="jass-design.js"/, seite);
  }
});
