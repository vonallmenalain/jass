// Spielt ein Online-Spiel mit drei Browsern und einem Computer gegen die
// Emulatoren durch (Realtime Database + Auth):
//
//   cd werkzeuge && npm run test:online
//
// Papa eröffnet den Tisch, Mia und Tim treten mit dem Link bei, Clara ist
// ein Computer. Nach der ersten Runde schliesst Tim sein Fenster – der
// Computer muss für ihn einspringen. Nach der zweiten verschwindet auch
// Papa, der Gastgeber – Mia muss übernehmen und das Spiel mit den Computern
// zu Ende bringen. Screenshots landen in werkzeuge/bilder-online/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, '..');
const BILDER = path.join(HIER, 'bilder-online');
fs.mkdirSync(BILDER, { recursive: true });
const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const [dbHost, dbPort] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');

// Regeln in den Emulator laden – für den Namensraum der echten Datenbank-URL.
const regeln = fs.readFileSync(path.join(WURZEL, 'database.rules.json'), 'utf8');
const antwort = await fetch(`http://${dbHost}:${dbPort}/.settings/rules.json?ns=jassen-bc258-default-rtdb`, {
  method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: regeln,
});
if (!antwort.ok) throw new Error('Regeln nicht geladen: ' + antwort.status + ' ' + await antwort.text());
// Direkt aus dem Emulator lesen (als Besitzer, an den Regeln vorbei).
const lies = async (p) => (await fetch(`http://${dbHost}:${dbPort}/${p}.json?ns=jassen-bc258-default-rtdb`, { headers: { Authorization: 'Bearer owner' } })).json();

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const datei = path.join(WURZEL, p);
  if (!datei.startsWith(WURZEL) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] || 'application/octet-stream' });
  fs.createReadStream(datei).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASIS = `http://127.0.0.1:${server.address().port}/jass-online.html`;

const browser = await chromium.launch();
const fehler = [];

async function neuesGeraet(name, regelnSpiel) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.addInitScript(([n, r]) => {
    localStorage.setItem('jass-online-name-v1', JSON.stringify(n));
    localStorage.setItem('jass-lernen-anzeige-v1', JSON.stringify({ tempo: 'schnell' }));
    if (r) localStorage.setItem('jass-lernen-regeln-v1', JSON.stringify(r));
  }, [name, regelnSpiel || null]);
  const seite = await ctx.newPage();
  seite.on('pageerror', (e) => fehler.push(name + ': ' + e.message));
  seite.on('console', (m) => { if (m.type() === 'error' && !/serviceworker|favicon/i.test(m.text())) fehler.push(name + ' (console): ' + m.text()); });
  return { name, ctx, seite, aktiv: true };
}

const papa = await neuesGeraet('Papa', { runden: 3, ersterAnsager: 'sitz0', weisen: true, stoeck: true });
const mia = await neuesGeraet('Mia');
const tim = await neuesGeraet('Tim');

// Papa eröffnet
await papa.seite.goto(BASIS + '?emulator=1&warte=2500');
await papa.seite.click('#neuBtn');
await papa.seite.selectOption('[data-neu-sitz="2"]', 'mensch');
await papa.seite.selectOption('[data-neu-sitz="1"]', 'mensch');
await papa.seite.selectOption('[data-neu-sitz="3"]', 'schwer');
await papa.seite.click('#eroeffnenBtn');
await papa.seite.waitForSelector('.code-gross');
const code = (await papa.seite.textContent('.code-gross')).trim();
console.log('Tisch', code);

for (const g of [mia, tim]) {
  await g.seite.goto(BASIS + `?t=${code}&emulator=1&warte=2500`);
  await g.seite.waitForSelector('[data-hinsetzen]');
  await g.seite.click('[data-hinsetzen]');
  await g.seite.waitForSelector('.lobby-sitz.ich');
}
await papa.seite.waitForSelector('#losBtn:not([disabled])');
await papa.seite.screenshot({ path: path.join(BILDER, '1-lobby.png'), fullPage: true });
await papa.seite.click('#losBtn');

// Alle spielen: Ansage, Karten, «Weiter» nach jeder Runde.
let karten = 0, ansagen = 0, runden = 0, timWeg = false, papaWeg = false, bilder = 0;
const start = Date.now();
const fertig = new Set();
while (Date.now() - start < 240000) {
  let etwas = false;
  for (const g of [papa, mia, tim]) {
    if (!g.aktiv || fertig.has(g.name)) continue;
    const s = g.seite;
    if (await s.locator('#endeVerlassen').isVisible()) { fertig.add(g.name); continue; }
    if (await s.locator('#bereitBtn').isVisible()) {
      if (g === papa && runden === 0) await s.screenshot({ path: path.join(BILDER, '3-rundenende.png') });
      await s.click('#bereitBtn').catch(() => {});
      etwas = true;
      continue;
    }
    const ansage = s.locator('[data-rolle="ansage"] [data-ansage]:not([data-ansage="SCHIEBEN"])');
    if (await s.locator('[data-rolle="ansage"]').isVisible() && await ansage.count()) {
      await ansage.nth(ansagen % (await ansage.count())).click().catch(() => {});
      ansagen++;
      etwas = true;
      continue;
    }
    if (await s.locator('[data-rolle="hand"].aktiv').count()) {
      const erlaubt = s.locator('[data-rolle="hand"] .karte:not(.gesperrt)');
      const n = await erlaubt.count();
      if (n) {
        // Auf den sichtbaren Rand tippen: Die Karten überlappen sich.
        await erlaubt.nth(Math.floor(Math.random() * n)).click({ force: true, position: { x: 8, y: 30 } }).catch(() => {});
        const gew = s.locator('[data-rolle="hand"] .karte.gewaehlt');
        if (await gew.count()) await gew.click({ force: true, position: { x: 8, y: 30 } }).catch(() => {});
        karten++;
        etwas = true;
        if (g === mia && bilder === 0 && karten > 6) { await s.waitForTimeout(200); await s.screenshot({ path: path.join(BILDER, '2-tisch-mia.png') }); bilder++; }
      }
    }
  }
  // Fertige Runden zählen wir am Verlauf in der Datenbank, nicht an den
  // Klicks: Nach kurzer Zeit geht es auch ohne «Weiter» in die nächste Runde.
  const verlauf = Object.values((await lies(`jass/${code}/log`)) || {});
  runden = Math.max(runden, verlauf.filter((e) => e && e.t === 'r').length - 1);
  // Nach der ersten Runde verschwindet Tim.
  if (runden >= 1 && !timWeg) {
    timWeg = true;
    tim.aktiv = false;
    await tim.ctx.close();
    console.log('Tim ist weg – der Computer muss für ihn spielen.');
  }
  // Nach der zweiten verschwindet der Gastgeber.
  if (runden >= 2 && !papaWeg) {
    papaWeg = true;
    papa.aktiv = false;
    await papa.seite.screenshot({ path: path.join(BILDER, '4-vor-uebernahme.png') });
    await papa.ctx.close();
    console.log('Papa (Gastgeber) ist weg – Mia muss übernehmen.');
  }
  if (fertig.has('Mia')) break;
  if (!etwas) await new Promise((r) => setTimeout(r, 150));
}

const stand = (await mia.seite.locator('#jass-dialog .dialog p.muted').first().textContent().catch(() => '?')).trim();
await mia.seite.waitForTimeout(400);
await mia.seite.screenshot({ path: path.join(BILDER, '5-ende-mia.png') });
console.log('Karten von Menschen gespielt:', karten, '· Ansagen:', ansagen, '· Runden fertig:', runden);
console.log('Endstand bei Mia', stand);

let ok = fertig.has('Mia') && papaWeg && timWeg && /^\d+ : \d+$/.test(stand);
if (fehler.length) { console.log('Fehler im Browser:\n' + fehler.join('\n')); ok = false; }
await browser.close();
server.close();
console.log(ok ? 'OK: Online-Spiel komplett durchgespielt.' : 'FEHLGESCHLAGEN');
process.exit(ok ? 0 : 1);
