// Kartenerkennung im echten Browser (Chromium, onnxruntime-web vom CDN):
//
//   node werkzeuge/erkennung/browser-test.mjs [foto.jpg=KARTEN ...]
//
// Ohne Angabe: das Testbild werkzeuge/erkennung/test-faecher.jpg (ein
// künstlicher Fächer aus unseren Kartenbildern, die Karten stehen in
// test-faecher.json). Mit Angabe: eigene Fotos, z. B.
//   node werkzeuge/erkennung/browser-test.mjs hand.jpg=E10,KB,E6,SB,EB,S8,K6,H9,H6
// Wo auf dem Foto nicht sicher zu sehen ist, welche Karte es ist, stehen
// beide zur Wahl: EB|ED.
// Lädt das Foto im Trumpf-Helfer über «📷 Foto», wartet auf die Erkennung und
// vergleicht die vorgewählte Hand. Bestanden: insgesamt mindestens 75 % und je
// Foto höchstens 3 Fehler (an den 12 Handfotos: 96 %). Bildschirmfoto:
// werkzeuge/erkennung/browser-test.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, '..', '..');
const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.onnx': 'application/octet-stream', '.webmanifest': 'application/manifest+json' };
const F = { S: 0, H: 1, K: 2, E: 3 }, W = { 6: 0, 7: 1, 8: 2, 9: 3, 10: 4, B: 5, D: 6, K: 7, A: 8 };
const code = (s) => F[s[0]] * 9 + W[s.slice(1)];

let faelle = process.argv.slice(2).map((a) => { const [d, k] = a.split('='); return { datei: d, karten: k.split(',').map((x) => x.split('|').map(code)) }; });
if (!faelle.length) {
  const soll = JSON.parse(fs.readFileSync(path.join(HIER, 'test-faecher.json'), 'utf8'));
  faelle = [{ datei: path.join(HIER, 'test-faecher.jpg'), karten: soll.karten.map((k) => [k]) }];
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const datei = path.join(WURZEL, p);
  if (!datei.startsWith(WURZEL) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] || 'application/octet-stream' });
  fs.createReadStream(datei).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const seite = await browser.newPage({ viewport: { width: 420, height: 900 } });
const fehler = [];
seite.on('pageerror', (e) => fehler.push(e.message));
await seite.goto(`http://127.0.0.1:${server.address().port}/trumpf-helfer.html`);
let alleOk = true, gesamt = 0, moeglich = 0;
for (const f of faelle) {
  const t0 = Date.now();
  await seite.evaluate(() => { document.getElementById('fotoText').textContent = ''; });
  await seite.setInputFiles('#kamera', f.datei);
  await seite.waitForFunction(() => /erkannt|nicht geklappt/.test(document.getElementById('fotoText').textContent), null, { timeout: 120000 });
  const text = await seite.textContent('#fotoText');
  const hand = await seite.$$eval('#hand [data-weg]', (b) => b.map((x) => Number(x.dataset.weg)));
  const unsicher = await seite.$$eval('#hand .unsicher', (b) => b.map((x) => Number(x.dataset.weg)));
  const offen = f.karten.map((x) => x.slice());
  let treffer = 0;
  for (const k of hand) {
    const j = offen.findIndex((x) => x.includes(k));
    if (j >= 0) { offen.splice(j, 1); treffer++; }
  }
  console.log(`${path.basename(f.datei)}: ${treffer}/${f.karten.length} richtig, ${unsicher.length} unsicher, ${((Date.now() - t0) / 1000).toFixed(1)} s – ${text.trim().slice(0, 60)}`);
  gesamt += treffer; moeglich += f.karten.length;
  if (treffer < f.karten.length - 3) alleOk = false;
}
console.log(`Gesamt: ${gesamt}/${moeglich} (${Math.round((100 * gesamt) / moeglich)} %)`);
if (gesamt < 0.75 * moeglich) alleOk = false;
await seite.screenshot({ path: path.join(HIER, 'browser-test.png'), fullPage: true });
if (fehler.length) { console.log('Fehler im Browser:', fehler); alleOk = false; }
await browser.close();
server.close();
console.log(alleOk ? 'OK' : 'FEHLGESCHLAGEN');
process.exit(alleOk ? 0 : 1);
