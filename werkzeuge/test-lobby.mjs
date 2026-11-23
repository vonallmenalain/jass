// Prüft die Lobby gegen die Emulatoren (Realtime Database + Auth):
//
//   cd werkzeuge && npm run test:lobby
//
// Papa eröffnet einen öffentlichen Tisch. Mia sieht ihn unter «Offene
// Tische» und setzt sich. Papa tauscht Mia auf einen anderen Platz, stellt
// den Tisch auf privat (Tim sieht ihn nicht mehr), dann wieder öffentlich,
// und schliesst ihn am Schluss für alle. Ein zweiter Tisch verschwindet aus
// der Liste, sobald sein Gastgeber offline geht. Screenshots in
// werkzeuge/bilder-online/.
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
const NS = 'jassen-bc258-default-rtdb';
const regeln = fs.readFileSync(path.join(WURZEL, 'database.rules.json'), 'utf8');
const antwort = await fetch(`http://${dbHost}:${dbPort}/.settings/rules.json?ns=${NS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: regeln });
if (!antwort.ok) throw new Error('Regeln nicht geladen: ' + antwort.status + ' ' + await antwort.text());
const lies = async (p) => (await fetch(`http://${dbHost}:${dbPort}/${p}.json?ns=${NS}`, { headers: { Authorization: 'Bearer owner' } })).json();

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
let ok = true;
const pruefe = (bedingung, text) => { console.log((bedingung ? '✔ ' : '✘ ') + text); if (!bedingung) ok = false; };

async function geraet(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.addInitScript((n) => { localStorage.setItem('jass-online-name-v1', JSON.stringify(n)); }, name);
  const seite = await ctx.newPage();
  seite.on('pageerror', (e) => fehler.push(name + ': ' + e.message));
  seite.on('console', (m) => { if (m.type() === 'error' && !/serviceworker|favicon|permission_denied/i.test(m.text())) fehler.push(name + ' (console): ' + m.text()); });
  return { name, ctx, seite };
}
const warteBis = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };

const papa = await geraet('Papa');
const mia = await geraet('Mia');
const tim = await geraet('Tim');

// Papa eröffnet einen öffentlichen Tisch (Standard).
await papa.seite.goto(BASIS + '?emulator=1');
await papa.seite.click('#neuBtn');
pruefe(await papa.seite.isChecked('#neuOeffentlich'), 'Neuer Tisch: «Öffentlich» ist vorgewählt');
await papa.seite.fill('#tischName', 'Familienjass');
await papa.seite.click('#eroeffnenBtn');
await papa.seite.waitForSelector('.code-gross');
const code = (await papa.seite.textContent('.code-gross')).trim();
console.log('Tisch', code);

// Mia sieht ihn in der Liste und setzt sich.
await mia.seite.goto(BASIS + '?emulator=1');
const gefunden = await warteBis(async () => (await mia.seite.locator(`#offeneTische [data-code="${code}"]`).count()) > 0);
pruefe(gefunden, 'Mia sieht den Tisch unter «Offene Tische»');
if (gefunden) pruefe(/3 Plätze frei/.test(await mia.seite.textContent(`#offeneTische [data-code="${code}"]`)), 'Liste zeigt 3 freie Plätze');
await mia.seite.screenshot({ path: path.join(BILDER, 'lobby-1-offene-tische.png'), fullPage: true });
await mia.seite.click(`#offeneTische [data-code="${code}"]`);
await mia.seite.waitForSelector('[data-hinsetzen="2"]');
await mia.seite.click('[data-hinsetzen="2"]');
await mia.seite.waitForSelector('.lobby-sitz.ich');
pruefe(await warteBis(async () => (await lies(`offen/${code}/frei`)) === 2), 'Verzeichnis zählt jetzt 2 freie Plätze');

// Papa tauscht Mia von Platz 3 (Sitz 2) auf Platz 2 (Sitz 1).
await papa.seite.waitForSelector('[data-tausch="2"]');
await papa.seite.click('[data-tausch="2"]');
await papa.seite.screenshot({ path: path.join(BILDER, 'lobby-2-tauschen.png'), fullPage: true });
await papa.seite.click('[data-tausch-mit="1"]');
pruefe(await warteBis(async () => {
  const s = await lies(`jass/${code}/sitze`);
  return s && s[1] && s[1].uid && s[2] && !s[2].uid;
}), 'Mia sitzt jetzt auf Platz 2, Platz 3 ist frei');
pruefe(await warteBis(async () => (await mia.seite.locator('.lobby-sitz.ich .lage').first().textContent()).trim() === 'Platz 2'), 'Mias Gerät zeigt sie auf Platz 2');
// Papa tauscht sich selbst mit Mia: hostSitz zieht mit.
await papa.seite.click('[data-tausch="0"]');
await papa.seite.click('[data-tausch-mit="1"]');
pruefe(await warteBis(async () => (await lies(`jass/${code}/info/hostSitz`)) === '1'), 'Papa auf Platz 2: hostSitz zieht mit');
pruefe(await warteBis(async () => { const s = await lies(`jass/${code}/sitze`); return s[0].name === 'Mia' && s[0].online === true; }), 'Mia auf Platz 1 und online');
await papa.seite.screenshot({ path: path.join(BILDER, 'lobby-3-getauscht.png'), fullPage: true });

// Mia lädt neu: Ihr Online-Status hängt am neuen Platz, nicht am alten.
await mia.seite.reload();
await mia.seite.waitForSelector('.lobby-sitz.ich');
pruefe(await warteBis(async () => { const s = await lies(`jass/${code}/sitze`); return s[0].uid && s[0].online === true && !s[1].online !== undefined; }), 'Nach dem Neuladen: Mia online auf Platz 1');

// Privat: Tim sieht ihn nicht mehr.
await tim.seite.goto(BASIS + '?emulator=1');
pruefe(await warteBis(async () => (await tim.seite.locator(`#offeneTische [data-code="${code}"]`).count()) > 0), 'Tim sieht den öffentlichen Tisch');
await papa.seite.uncheck('#oeffentlichSchalter');
pruefe(await warteBis(async () => (await tim.seite.locator(`#offeneTische [data-code="${code}"]`).count()) === 0), 'Privat: Tim sieht ihn nicht mehr');
pruefe((await lies(`offen/${code}`)) === null, 'Privat: Eintrag im Verzeichnis gelöscht');
pruefe(/Privater Tisch/.test(await mia.seite.textContent('#lobby')), 'Mia sieht «Privater Tisch»');
await papa.seite.check('#oeffentlichSchalter');
pruefe(await warteBis(async () => (await tim.seite.locator(`#offeneTische [data-code="${code}"]`).count()) > 0), 'Wieder öffentlich: Tim sieht ihn wieder');

// Ein zweiter Tisch: Sein Gastgeber geht offline – der Eintrag verschwindet von selbst.
const otto = await geraet('Otto');
await otto.seite.goto(BASIS + '?emulator=1');
await otto.seite.click('#neuBtn');
await otto.seite.click('#eroeffnenBtn');
await otto.seite.waitForSelector('.code-gross');
const code2 = (await otto.seite.textContent('.code-gross')).trim();
pruefe(await warteBis(async () => (await tim.seite.locator(`#offeneTische [data-code="${code2}"]`).count()) > 0), 'Tim sieht auch Ottos Tisch');
await otto.ctx.close();
pruefe(await warteBis(async () => (await tim.seite.locator(`#offeneTische [data-code="${code2}"]`).count()) === 0, 30000), 'Otto offline: sein Tisch verschwindet aus der Liste');
await tim.seite.screenshot({ path: path.join(BILDER, 'lobby-4-liste-tim.png'), fullPage: true });

// Papa schliesst den Tisch für alle.
await papa.seite.click('#schliessenBtn');
await papa.seite.click('#schliessenJa');
await papa.seite.waitForSelector('#start:not([hidden])');
pruefe((await lies(`jass/${code}`)) === null && (await lies(`offen/${code}`)) === null, 'Geschlossen: Tisch und Eintrag gelöscht');
pruefe((await papa.seite.locator(`#meineTische [data-code="${code}"]`).count()) === 0, 'Papas «Zuletzt» kennt ihn nicht mehr');
pruefe(await warteBis(async () => /gibt es nicht/.test(await mia.seite.textContent('#fehler'))), 'Mia erfährt, dass es den Tisch nicht mehr gibt');
pruefe(await warteBis(async () => (await tim.seite.locator(`#offeneTische [data-code="${code}"]`).count()) === 0), 'Tims Liste ist leer');
await mia.seite.screenshot({ path: path.join(BILDER, 'lobby-5-geschlossen.png'), fullPage: true });

// «Zuletzt»: ✕ nimmt einen Tisch nur aus der Liste.
await mia.seite.click('#fehlerZurueck');
await mia.seite.waitForSelector('#start:not([hidden])');
pruefe((await mia.seite.locator(`#meineTische [data-code="${code}"]`).count()) === 0, 'Auch Mias «Zuletzt» hat ihn vergessen');

if (fehler.length) { console.log('Fehler im Browser:\n' + fehler.join('\n')); ok = false; }
await browser.close();
server.close();
console.log(ok ? 'OK: Lobby, offene Tische, Tauschen und Schliessen funktionieren.' : 'FEHLGESCHLAGEN');
process.exit(ok ? 0 : 1);
