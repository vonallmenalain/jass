/*
 * stimme-google.mjs – Die Tipps mit einer Stimme von Google vertonen
 * (Cloud Text-to-Speech, Chirp 3 HD, dieselbe Stimme wie in der Kinder-App:
 * de-DE-Chirp3-HD-Sulafat).
 * ---------------------------------------------------------------------------
 * Welche Sätze es gibt, weiss JassBot.alleSprechTeile(): die Begründungen,
 * «Spiel das Herz Ass.», die Ansage-Tipps mit «Im Schnitt etwa N Punkte»
 * und die Faustregeln. Je Satz eine MP3 in stimme/ (Name: Anfang des
 * SHA-256 des Satzes), das Verzeichnis in jass-stimme-dateien.js.
 *
 *   node werkzeuge/stimme-google.mjs texte            wie viele Sätze, Zeichen, Aufnahmen
 *   node werkzeuge/stimme-google.mjs probe "<Satz>" [--aus <ordner>]
 *                                                     eine Hörprobe, nicht ins Repo
 *   node werkzeuge/stimme-google.mjs vertonen [--limit 50] [--trocken]
 *                                                     vertont, was fehlt
 *   node werkzeuge/stimme-google.mjs aufraeumen       löscht Aufnahmen, die kein Satz mehr braucht
 *   node werkzeuge/stimme-google.mjs verbrauch        Zeichen je Monat
 *
 * Der Schlüssel: GOOGLE_TTS_API_KEY (wie in der Kinder-App, beschränkt auf
 * die Cloud Text-to-Speech API). Er geht per stdin an curl, nie in eine
 * Befehlszeile oder Ausgabe.
 *
 * Kosten: Chirp 3 HD ist bis 1 Million Zeichen im Monat gratis – das
 * Kontingent gilt für das ganze Google-Projekt, also zusammen mit der
 * Kinder-App. Alle Sätze der Jass-App sind gut 12'000 Zeichen. Dieses Skript
 * zählt mit (werkzeuge/stimme-google.json) und hört bei 100'000 Zeichen im
 * Monat auf, es sei denn mit --kosten-ok.
 *
 * Nötig: curl und ffmpeg.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, '..');
const B = require(path.join(WURZEL, 'jass-bot.js'));

const API = 'https://texttospeech.googleapis.com/v1';
const STIMME = 'de-DE-Chirp3-HD-Sulafat';
const RATE = 24000;
const ORDNER = path.join(WURZEL, 'stimme');
const VERZEICHNIS = path.join(WURZEL, 'jass-stimme-dateien.js');
const EINSTELLUNG = path.join(HIER, 'stimme-google.json');
const GRENZE_MONAT = 100000;

// Schreibweisen nur für die Stimme – was Google sonst falsch betont.
const AUSSPRACHE = [
  [/\bBuur\b/g, 'Puur'], // geschrieben Buur, gesprochen Puur
];

const [befehl, ...rest] = process.argv.slice(2);
const hat = (name) => rest.includes(`--${name}`);
const wert = (name, fallback = null) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : fallback;
};

const dateiFuer = (text) => `stimme/${crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)}.mp3`;
const auszusprechen = (text) => AUSSPRACHE.reduce((t, [muster, ersatz]) => t.replace(muster, ersatz), text);

function einstellung() {
  try { return JSON.parse(fs.readFileSync(EINSTELLUNG, 'utf8')); } catch { return { stimme: STIMME, verbrauch: {} }; }
}
const monat = () => new Date().toISOString().slice(0, 7);
function buche(zeichen) {
  const e = einstellung();
  e.stimme = STIMME;
  e.verbrauch ||= {};
  e.verbrauch[monat()] = (e.verbrauch[monat()] || 0) + zeichen;
  fs.writeFileSync(EINSTELLUNG, `${JSON.stringify(e, null, 2)}\n`);
}
const verbraucht = () => (einstellung().verbrauch || {})[monat()] || 0;

// Über curl: Es nimmt den Proxy der Umgebung, und der Schlüssel geht per
// stdin (--config -) mit, nicht über die Befehlszeile.
function anfrage(body) {
  const arbeit = fs.mkdtempSync(path.join(os.tmpdir(), 'jass-stimme-'));
  const antwort = path.join(arbeit, 'antwort.json');
  fs.writeFileSync(path.join(arbeit, 'body.json'), JSON.stringify(body));
  const zeilen = [
    `url = "${API}/text:synthesize"`, 'request = "POST"', `output = "${antwort}"`, 'write-out = "%{http_code}"',
    'silent', 'show-error', 'max-time = 90',
    'header = "Content-Type: application/json; charset=utf-8"',
    `header = "X-Goog-Api-Key: ${String(process.env.GOOGLE_TTS_API_KEY || '').replace(/["\\\s]/g, '')}"`,
    `data-binary = "@${path.join(arbeit, 'body.json')}"`,
  ];
  return new Promise((fertig) => {
    const curl = spawn('curl', ['--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let aus = '';
    curl.stdout.on('data', (d) => { aus += d; });
    curl.on('close', () => {
      let daten = null;
      try { daten = JSON.parse(fs.readFileSync(antwort, 'utf8')); } catch { /* keine Antwort */ }
      fs.rmSync(arbeit, { recursive: true, force: true });
      fertig({ status: Number(aus.trim()) || 0, daten });
    });
    curl.stdin.end(`${zeilen.join('\n')}\n`);
  });
}

async function sprich(text, versuch = 1) {
  const input = { text: auszusprechen(text) };
  const r = await anfrage({ input, voice: { languageCode: 'de-DE', name: STIMME }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: RATE } });
  if (r.status === 200 && r.daten && r.daten.audioContent) {
    buche(input.text.length);
    return Buffer.from(r.daten.audioContent, 'base64');
  }
  if ((r.status === 429 || r.status >= 500 || r.status === 0) && versuch < 6) {
    await new Promise((w) => setTimeout(w, 1000 * 2 ** versuch));
    return sprich(text, versuch + 1);
  }
  throw new Error(`Google antwortet ${r.status}: ${(r.daten && r.daten.error && r.daten.error.message) || 'keine Antwort'}`);
}

// WAV → MP3 wie in der Kinder-App: mono, 24 kHz, 32 kbit/s, Stille vorne und
// hinten bis auf 80 ms gekürzt, kurz ein- und ausgeblendet.
function zuMp3(wav, ziel) {
  const arbeit = fs.mkdtempSync(path.join(os.tmpdir(), 'jass-wav-'));
  const roh = path.join(arbeit, 'roh.wav');
  fs.writeFileSync(roh, wav);
  const stille = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08';
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', roh, '-af', `${stille},areverse,${stille},afade=t=in:d=0.025,areverse,afade=t=in:d=0.012`,
      '-ac', '1', '-ar', String(RATE), '-codec:a', 'libmp3lame', '-b:a', '32k', '-map_metadata', '-1', '-id3v2_version', '0', ziel]);
  } finally {
    fs.rmSync(arbeit, { recursive: true, force: true });
  }
}

function schreibeVerzeichnis(saetze) {
  const eintraege = saetze
    .filter((t) => fs.existsSync(path.join(WURZEL, dateiFuer(t))))
    .sort((a, b) => a.localeCompare(b, 'de'))
    .map((t) => `  ${JSON.stringify(t)}: ${JSON.stringify(dateiFuer(t))},`);
  fs.writeFileSync(VERZEICHNIS, `/*
 * jass-stimme-dateien.js – Zu jedem Satz die Aufnahme (Google, ${STIMME}).
 * Nicht von Hand ändern: werkzeuge/stimme-google.mjs schreibt diese Datei.
 */
window.JassStimmeDateien = {
${eintraege.join('\n')}
};
`);
  return eintraege.length;
}

const saetze = B.alleSprechTeile();

if (befehl === 'texte') {
  const da = saetze.filter((t) => fs.existsSync(path.join(WURZEL, dateiFuer(t))));
  const fehlen = saetze.filter((t) => !da.includes(t));
  console.log(`${saetze.length} Sätze, ${saetze.reduce((n, t) => n + t.length, 0)} Zeichen.`);
  console.log(`${da.length} mit Aufnahme, ${fehlen.length} fehlen (${fehlen.reduce((n, t) => n + t.length, 0)} Zeichen).`);
  if (hat('liste')) fehlen.forEach((t) => console.log('  ' + t));
} else if (befehl === 'probe') {
  const text = rest.find((x) => !x.startsWith('--'));
  if (!text) { console.error('Aufruf: probe "<Satz>" [--aus <ordner>]'); process.exit(2); }
  const aus = wert('aus', path.join(os.tmpdir(), 'jass-stimmprobe'));
  fs.mkdirSync(aus, { recursive: true });
  const ziel = path.join(aus, 'probe-' + Date.now() + '.mp3');
  zuMp3(await sprich(text), ziel);
  console.log(ziel);
} else if (befehl === 'vertonen') {
  const fehlen = saetze.filter((t) => !fs.existsSync(path.join(WURZEL, dateiFuer(t))));
  const limit = Number(wert('limit', fehlen.length));
  const plan = fehlen.slice(0, limit);
  const zeichen = plan.reduce((n, t) => n + auszusprechen(t).length, 0);
  console.log(`${plan.length} Sätze vertonen, ${zeichen} Zeichen. Diesen Monat schon ${verbraucht()} Zeichen.`);
  if (hat('trocken')) process.exit(0);
  if (!process.env.GOOGLE_TTS_API_KEY) { console.error('GOOGLE_TTS_API_KEY fehlt.'); process.exit(2); }
  if (verbraucht() + zeichen > GRENZE_MONAT && !hat('kosten-ok')) {
    console.error(`Das wären mehr als ${GRENZE_MONAT} Zeichen in diesem Monat – abgebrochen (mit --kosten-ok trotzdem).`);
    process.exit(2);
  }
  fs.mkdirSync(ORDNER, { recursive: true });
  let fertig = 0;
  const arbeiter = async () => {
    while (plan.length) {
      const text = plan.shift();
      const wav = await sprich(text);
      zuMp3(wav, path.join(WURZEL, dateiFuer(text)));
      fertig++;
      if (fertig % 25 === 0) console.log(`  ${fertig} …`);
    }
  };
  await Promise.all([arbeiter(), arbeiter(), arbeiter(), arbeiter()]);
  const n = schreibeVerzeichnis(saetze);
  console.log(`Fertig: ${fertig} neu, ${n} im Verzeichnis. Diesen Monat ${verbraucht()} Zeichen.`);
} else if (befehl === 'aufraeumen') {
  const gebraucht = new Set(saetze.map((t) => path.basename(dateiFuer(t))));
  let weg = 0;
  for (const f of fs.existsSync(ORDNER) ? fs.readdirSync(ORDNER) : []) {
    if (!gebraucht.has(f)) { fs.rmSync(path.join(ORDNER, f)); weg++; }
  }
  console.log(`${weg} Aufnahmen gelöscht, ${schreibeVerzeichnis(saetze)} im Verzeichnis.`);
} else if (befehl === 'verbrauch') {
  console.log(JSON.stringify(einstellung().verbrauch || {}, null, 2));
} else {
  console.error('Befehle: texte, probe, vertonen, aufraeumen, verbrauch');
  process.exit(2);
}
