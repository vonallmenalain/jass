/*
 * jass-online.js – Schieber online, über die Realtime Database.
 * ---------------------------------------------------------------------------
 * Kein Server rechnet mit. In der Datenbank steht pro Tisch:
 *
 *   jass/<CODE>/info     Name, Gastgeber, Regeln, Status (lobby/spiel/fertig)
 *   jass/<CODE>/sitze/s  wer auf Platz s sitzt: Mensch (uid) oder Computer
 *   jass/<CODE>/log/n    was passiert ist – jeder hängt seinen Zug an
 *                        (jass-protokoll.js)
 *   jass/<CODE>/haende/s die Karten von Platz s – lesen darf sie nur, wer
 *                        dort sitzt, und der Gastgeber
 *
 * Jedes Gerät spielt das Log mit der Engine nach. Der Gastgeber teilt aus
 * und spielt für die Computer – und für Mitspieler, die länger als 20
 * Sekunden weg sind. Geht der Gastgeber selbst verloren, übernimmt der
 * nächste Mitspieler. Wer mitspielt, meldet sich anonym an (Firebase Auth),
 * damit die Datenbank weiss, wem welcher Platz gehört.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, set, update, onValue, onDisconnect, connectDatabaseEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const J = window.JassEngine;
const B = window.JassBot;
const K = window.JassKarten;
const E = window.JassEinstellungen;
const T = window.JassTisch;
const P = window.JassProtokoll;
const esc = T.escapeHtml;
const $ = (id) => document.getElementById(id);

const KONFIG = {
  apiKey: 'AIzaSyDRCQE0-G9SGEx9Ia_r5Xq7eb1-rfBlFdI',
  authDomain: 'jassen-bc258.firebaseapp.com',
  databaseURL: 'https://jassen-bc258-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'jassen-bc258',
  storageBucket: 'jassen-bc258.firebasestorage.app',
  messagingSenderId: '812109155835',
  appId: '1:812109155835:web:062f3e23eba6ff1e9c4f5e',
};

const params = new URLSearchParams(location.search);
const EMULATOR = params.has('emulator') && ['localhost', '127.0.0.1'].includes(location.hostname);
const app = initializeApp(KONFIG);
const auth = getAuth(app);
const db = getDatabase(app);
if (EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
}

const KEY_NAME = 'jass-online-name-v1';
const KEY_TISCHE = 'jass-online-tische-v1';
const ZEICHEN = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const COMPUTER = ['Anna', 'Ben', 'Clara', 'Dario'];
const LAGE = ['Platz 1', 'Platz 2', 'Platz 3', 'Platz 4'];
// Computer spielen immer so stark wie möglich («schwer»). Ältere Tische können
// noch «leicht» oder «mittel» gespeichert haben – sie spielen ebenfalls schwer.
const TYPEN = [['mensch', '👤 Mitspieler'], ['schwer', '🤖 Computer']];
const passtTyp = (typ, w) => typ === w || (w === 'schwer' && typ != null && typ !== 'mensch');
const TEMPO = { langsam: { denken: 1300, stich: 1700 }, normal: { denken: 850, stich: 1200 }, schnell: { denken: 400, stich: 700 } };
// Im Emulator lassen sich die Wartezeiten für Tests verkürzen (?warte=ms).
const TEST_WARTE = EMULATOR && params.has('warte') ? Number(params.get('warte')) : 0;
const ERSATZ_NACH = TEST_WARTE || 20000;      // so lange wartet der Gastgeber auf einen, der weg ist
const UEBERNAHME_NACH = TEST_WARTE || 15000;  // so lange ist der Gastgeber weg, bis ein anderer übernimmt
const RUNDE_WEITER_NACH = TEST_WARTE || 30000;

const anzeige = E.ladeAnzeige();
K.setzeFarben(anzeige.farben);
const tempo = () => TEMPO[anzeige.tempo] || TEMPO.normal;

// ------------------------------------------------------------------ Zustand

let uid = null;
let verbunden = false;
let code = null;
let info = null;
let infoGeladen = false;
let sitze = [null, null, null, null];
let log = [];
let haende = {};
let abos = [];
let handAbos = {};
let praesenzFuer = '';
let praesenzPfad = '';       // wo onDisconnect gerade «offline» setzen würde
let offenGeschrieben = '';   // was zuletzt im Verzeichnis der offenen Tische steht ('' = nichts)
let offenAbo = null;         // Startseite: Abo auf die offenen Tische
let tauschVon = -1;          // Lobby: dieser Platz soll mit einem anderen tauschen
let meinSitz = -1;
let istHost = false;
let spiel = null;
let praesentiert = -1;      // so weit ist das Log gezeigt (-1: noch nichts geladen)
let praesentationLaeuft = false;
let hostTimer = null;
let uebernahmeTimer = null;
const wegSeit = {};
let rundenEndeSeit = 0;
let dialogFuer = '';
let wahlAktiv = false;

const tisch = T.erstelle($('tisch'), {
  anzeige,
  beiKarte: meineKarte,
  beiAnsage: meineAnsage,
  beiMenu: zeigeMenu,
});

// ------------------------------------------------------------------ Ansichten

function zeige(name) {
  for (const id of ['verbinden', 'start', 'neu', 'lobby', 'fehler']) $(id).hidden = id !== name;
  if (name !== 'start' && offenAbo) { offenAbo(); offenAbo = null; }
  const amTisch = name === 'tisch';
  $('seite').hidden = amTisch;
  $('tisch').hidden = !amTisch;
}

function fehler(html, zurueck) {
  $('fehler').innerHTML = `<div class="meldung">${html}</div>${zurueck !== false ? '<button class="btn-ghost btn-voll" type="button" id="fehlerZurueck">Zurück</button>' : ''}`;
  zeige('fehler');
  const b = $('fehlerZurueck');
  if (b) b.addEventListener('click', () => { verlasseTisch(); zeigeStart(); });
}

function meinName() {
  return ($('meinName').value || E.lese(KEY_NAME) || '').trim().slice(0, 20);
}

// ---------------------------------------------------------------- Anmelden

onAuthStateChanged(auth, (nutzer) => {
  if (!nutzer) return;
  const erstes = !uid;
  uid = nutzer.uid;
  if (erstes) {
    onValue(ref(db, '.info/connected'), (snap) => {
      verbunden = snap.val() === true;
      praesenzFuer = '';
      offenGeschrieben = '?';
      setzePraesenz();
      aktualisiere();
    });
    const c = (params.get('t') || '').toUpperCase();
    if (/^[A-Z2-9]{6}$/.test(c)) oeffneTisch(c);
    else zeigeStart();
  }
});

signInAnonymously(auth).catch((e) => {
  const aus = /operation-not-allowed|admin-restricted-operation|configuration-not-found/.test(e.code || '');
  fehler(aus
    ? '<b>Die anonyme Anmeldung ist in Firebase noch nicht eingeschaltet.</b><br>Firebase-Console → Authentication → Anmeldemethode → <i>Anonym</i> aktivieren (siehe FIREBASE.md).'
    : '<b>Keine Verbindung zu Firebase.</b><br>' + esc(e.message || String(e)), false);
});

// -------------------------------------------------------------------- Start

function zeigeStart() {
  $('meinName').value = E.lese(KEY_NAME) || '';
  zeichneZuletzt();
  history.replaceState(null, '', location.pathname + (EMULATOR ? '?emulator=1' : ''));
  zeige('start');
  if (!offenAbo) {
    offenAbo = onValue(ref(db, 'offen'), (snap) => zeichneOffene(snap.val() || {}), () => {
      $('offeneTische').innerHTML = '<p class="muted">Die offenen Tische lassen sich gerade nicht laden.</p>';
    });
  }
}

function zeichneZuletzt() {
  const liste = (E.lese(KEY_TISCHE) || []).slice(0, 8);
  $('meineTischePanel').hidden = !liste.length;
  $('meineTische').innerHTML = liste.map((t) => `<div class="tisch-zeile">
    <button class="btn-ghost" type="button" data-code="${esc(t.code)}"><span>${esc(t.name)}${t.gastgeber ? ' <span class="marke">Gastgeber</span>' : ''}</span><span class="muted">${esc(t.code)}</span></button>
    ${t.gastgeber ? `<button class="btn-ghost weg" type="button" data-schliessen-code="${esc(t.code)}" aria-label="Tisch ${esc(t.code)} für alle schliessen">Schliessen</button>` : ''}
    <button class="btn-ghost weg" type="button" data-weg="${esc(t.code)}" aria-label="Tisch ${esc(t.code)} aus der Liste nehmen">✕</button>
  </div>`).join('');
}

function vergissTisch(c) {
  E.schreibe(KEY_TISCHE, (E.lese(KEY_TISCHE) || []).filter((t) => t.code !== c));
}

// Öffentliche Tische mit freien Plätzen. Der Gastgeber trägt seinen Tisch
// ein, solange er in der Lobby ist (siehe pflegeOffen).
function zeichneOffene(alle) {
  const liste = Object.entries(alle)
    .filter(([c, t]) => /^[A-Z2-9]{6}$/.test(c) && t && t.frei > 0)
    .sort((a, b) => (b[1].zeit || 0) - (a[1].zeit || 0))
    .slice(0, 20);
  $('offeneTische').innerHTML = liste.length
    ? liste.map(([c, t]) => `<button class="btn-ghost offener-tisch" type="button" data-code="${esc(c)}">
        <span class="oben"><span>${esc(t.name)}</span><span>${t.frei === 1 ? '1 Platz frei' : esc(String(t.frei)) + ' Plätze frei'}</span></span>
        <span class="unten">bei ${esc(t.gastgeber)}${t.regeln ? ' · ' + esc(t.regeln) : ''}</span>
      </button>`).join('')
    : '<p class="muted">Gerade ist kein öffentlicher Tisch offen. Eröffne doch selbst einen!</p>';
}

$('meinName').addEventListener('input', () => E.schreibe(KEY_NAME, $('meinName').value.trim().slice(0, 20)));
$('meineTische').addEventListener('click', (e) => {
  const weg = e.target.closest('[data-weg]');
  if (weg) { vergissTisch(weg.dataset.weg); zeichneZuletzt(); return; }
  const zu = e.target.closest('[data-schliessen-code]');
  if (zu) { frageSchliessen(zu.dataset.schliessenCode); return; }
  const b = e.target.closest('[data-code]');
  if (b) oeffneTisch(b.dataset.code);
});
$('offeneTische').addEventListener('click', (e) => {
  const b = e.target.closest('[data-code]');
  if (b) oeffneTisch(b.dataset.code);
});
$('beitretenBtn').addEventListener('click', () => {
  const c = $('codeFeld').value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) { $('codeFeld').focus(); return; }
  oeffneTisch(c);
});
$('codeFeld').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('beitretenBtn').click(); });

function merkeTisch(c, name, gastgeber) {
  const alt = E.lese(KEY_TISCHE) || [];
  const vorher = alt.find((t) => t.code === c);
  if (vorher && vorher.name === (name || c) && !!vorher.gastgeber === !!gastgeber && alt[0] === vorher) return;
  const liste = alt.filter((t) => t.code !== c);
  liste.unshift({ code: c, name: name || c, gastgeber: !!gastgeber });
  E.schreibe(KEY_TISCHE, liste.slice(0, 10));
}

// --------------------------------------------------------- Tisch schliessen

// Löscht den Tisch für alle (nur der Gastgeber darf das, so die Regeln).
async function schliesseTisch(c) {
  if (c === code) {
    // Eigene onDisconnect-Aufträge zuerst zurücknehmen.
    if (praesenzPfad) await onDisconnect(ref(db, praesenzPfad)).cancel().catch(() => {});
    await onDisconnect(ref(db, 'offen/' + c)).cancel().catch(() => {});
  }
  const daten = {};
  daten['jass/' + c] = null;
  daten['offen/' + c] = null;
  await update(ref(db), daten);
}

function frageSchliessen(c) {
  const box = tisch.oeffneDialog(`<h2>Tisch ${esc(c)} schliessen?</h2>
    <p class="muted">Der Tisch wird für alle gelöscht – auch ein laufendes Spiel. Das lässt sich nicht rückgängig machen.</p>
    <button class="btn btn-voll" type="button" id="schliessenJa">Ja, für alle schliessen</button>
    <button class="btn-ghost btn-voll" type="button" data-schliessen>Abbrechen</button>`);
  box.querySelector('#schliessenJa').addEventListener('click', async () => {
    try {
      await schliesseTisch(c);
      vergissTisch(c);
      tisch.schliesseDialog();
      if (c === code) verlasseTisch();
      tisch.toast('Tisch ' + c + ' geschlossen');
      zeigeStart();
    } catch (e) {
      // Nicht (mehr) Gastgeber oder schon weg: wenigstens aus der Liste nehmen.
      vergissTisch(c);
      tisch.schliesseDialog();
      tisch.toast('Nur aus der Liste genommen – schliessen kann ihn nur der Gastgeber.');
      if (c !== code) zeichneZuletzt();
    }
  });
}

// ---------------------------------------------------------- Neuer Tisch

let neuRegeln = E.ladeRegeln();
const neuTypen = [null, 'mensch', 'mensch', 'mensch'];

$('neuBtn').addEventListener('click', () => {
  if (!meinName()) { $('meinName').focus(); $('meinName').placeholder = 'Bitte zuerst deinen Namen'; return; }
  $('tischName').value = 'Jass von ' + meinName();
  zeichneNeuSitze();
  zeige('neu');
});
$('neuZurueck').addEventListener('click', zeigeStart);

function zeichneNeuSitze() {
  const lage = ['', 'Rechts (Gegner)', 'Gegenüber (dein Partner)', 'Links (Gegner)'];
  $('neuSitze').innerHTML = `<div class="sitz-zeile"><b>Unten: ${esc(meinName())}</b> <span class="muted klein">(du, Gastgeber)</span></div>` +
    [2, 1, 3].map((s) => `<label class="reihe" style="justify-content:space-between"><span>${lage[s]}</span>
      <select class="text-feld" style="width:auto" data-neu-sitz="${s}">${TYPEN.map(([w, t]) => `<option value="${w}" ${passtTyp(neuTypen[s], w) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`).join('');
}
$('neuSitze').addEventListener('change', (e) => {
  const el = e.target.closest('[data-neu-sitz]');
  if (el) neuTypen[Number(el.dataset.neuSitz)] = el.value;
});
E.regelFormular($('neuRegeln'), neuRegeln, (r) => { E.speichereRegeln(r); $('neuZusammenfassung').textContent = E.zusammenfassung(r); });
$('neuZusammenfassung').textContent = E.zusammenfassung(neuRegeln);

function neuerCode() {
  const z = crypto.getRandomValues(new Uint32Array(6));
  return Array.from(z, (x) => ZEICHEN[x % ZEICHEN.length]).join('');
}

$('eroeffnenBtn').addEventListener('click', async () => {
  const name = meinName();
  if (!name) return;
  $('eroeffnenBtn').disabled = true;
  const regeln = J.regelnMitStandard(neuRegeln);
  for (let versuch = 0; versuch < 6; versuch++) {
    const c = neuerCode();
    const daten = {};
    daten[`jass/${c}/info`] = {
      name: ($('tischName').value.trim() || 'Jass von ' + name).slice(0, 40),
      host: uid, hostSitz: '0', erstellt: Date.now(), status: 'lobby', spielNr: 0,
      regeln, tipps: $('neuTipps').checked, oeffentlich: $('neuOeffentlich').checked,
    };
    daten[`jass/${c}/sitze/0`] = { typ: 'mensch', uid, name, online: true };
    for (const s of [1, 2, 3]) {
      daten[`jass/${c}/sitze/${s}`] = neuTypen[s] === 'mensch' ? { typ: 'mensch', name: 'Frei' } : { typ: neuTypen[s], name: COMPUTER[s - 1] };
    }
    try {
      await update(ref(db), daten);
      $('eroeffnenBtn').disabled = false;
      oeffneTisch(c);
      return;
    } catch (e) {
      // Code schon vergeben (oder keine Rechte) – mit einem neuen versuchen.
      console.warn('Tisch eröffnen', e.message);
    }
  }
  $('eroeffnenBtn').disabled = false;
  fehler('<b>Der Tisch konnte nicht eröffnet werden.</b><br>Sind die Regeln der Realtime Database veröffentlicht? (siehe FIREBASE.md)');
});

// ------------------------------------------------------------- Tisch öffnen

function verlasseTisch() {
  if (code && meinSitz >= 0) {
    const r = ref(db, `jass/${code}/sitze/${meinSitz}/online`);
    onDisconnect(r).cancel().catch(() => {});
    set(r, false).catch(() => {});
  }
  if (praesenzPfad) { onDisconnect(ref(db, praesenzPfad)).cancel().catch(() => {}); praesenzPfad = ''; }
  // Wer als Gastgeber geht, nimmt seinen Tisch aus dem Verzeichnis.
  if (code && offenGeschrieben && offenGeschrieben !== '?') {
    const r = ref(db, 'offen/' + code);
    onDisconnect(r).cancel().catch(() => {});
    set(r, null).catch(() => {});
  }
  offenGeschrieben = '';
  tauschVon = -1;
  abos.forEach((f) => f());
  abos = [];
  Object.values(handAbos).forEach((f) => f());
  handAbos = {};
  clearTimeout(hostTimer);
  clearTimeout(uebernahmeTimer);
  code = null; info = null; infoGeladen = false; sitze = [null, null, null, null]; log = []; haende = {};
  meinSitz = -1; istHost = false; spiel = null; praesentiert = -1; praesenzFuer = ''; dialogFuer = '';
  tisch.schliesseDialog();
}

function oeffneTisch(c) {
  verlasseTisch();
  code = c;
  zeige('verbinden');
  history.replaceState(null, '', location.pathname + '?t=' + c + (EMULATOR ? '&emulator=1' : ''));
  document.title = 'Jass online · ' + c;
  const basis = `jass/${c}`;
  abos.push(onValue(ref(db, basis + '/info'), (snap) => {
    info = snap.val();
    infoGeladen = true;
    if (info) merkeTisch(c, info.name, info.host === uid);
    aktualisiere();
  }, (e) => fehler('<b>Der Tisch lässt sich nicht lesen.</b><br>' + esc(e.message))));
  abos.push(onValue(ref(db, basis + '/sitze'), (snap) => {
    const v = snap.val() || {};
    sitze = [0, 1, 2, 3].map((s) => v[s] || v[String(s)] || null);
    aktualisiere();
  }));
  abos.push(onValue(ref(db, basis + '/log'), (snap) => {
    log = P.alsListe(snap.val());
    aktualisiere();
  }));
}

// Eigene Karten – und als Gastgeber alle.
function abonniereHaende() {
  const soll = istHost ? [0, 1, 2, 3] : (meinSitz >= 0 ? [meinSitz] : []);
  for (const s of Object.keys(handAbos).map(Number)) {
    if (!soll.includes(s)) { handAbos[s](); delete handAbos[s]; delete haende[s]; }
  }
  for (const s of soll) {
    if (handAbos[s]) continue;
    handAbos[s] = onValue(ref(db, `jass/${code}/haende/${s}`), (snap) => {
      const v = snap.val();
      if (v) haende[s] = { nr: v.nr, karten: P.alsListe(v.karten) };
      else delete haende[s];
      aktualisiere();
    }, () => { delete handAbos[s]; });
  }
}

function setzePraesenz() {
  if (!code || meinSitz < 0 || !verbunden) return;
  const schluessel = code + ':' + meinSitz;
  if (praesenzFuer === schluessel && sitze[meinSitz] && sitze[meinSitz].online === true) return;
  praesenzFuer = schluessel;
  const pfad = `jass/${code}/sitze/${meinSitz}/online`;
  // Hat der Gastgeber mich auf einen anderen Platz gesetzt: den alten
  // Auftrag zurücknehmen, sonst setzt er beim Abmelden den neuen Inhaber
  // dieses Platzes auf «offline».
  if (praesenzPfad && praesenzPfad !== pfad) onDisconnect(ref(db, praesenzPfad)).cancel().catch(() => {});
  praesenzPfad = pfad;
  const r = ref(db, pfad);
  onDisconnect(r).set(false).then(() => set(r, true)).catch(() => { praesenzFuer = ''; });
}

// Das Verzeichnis der offenen Tische (offen/<code>): Der Gastgeber trägt
// seinen Tisch ein, solange er öffentlich ist, in der Lobby wartet und noch
// Plätze frei hat. Geht der Gastgeber offline, löscht der Server den
// Eintrag selbst (onDisconnect) – kommt er zurück, steht er wieder drin.
function freiePlaetze() {
  return [0, 1, 2, 3].filter((s) => { const x = sitze[s]; return !x || (x.typ === 'mensch' && !x.uid); }).length;
}

function pflegeOffen() {
  if (!code || !istHost || !info || !verbunden) return;
  const frei = freiePlaetze();
  const gast = sitze[Number(info.hostSitz)];
  const soll = info.status === 'lobby' && info.oeffentlich !== false && frei > 0
    ? {
      name: String(info.name || code).slice(0, 40),
      gastgeber: String((gast && gast.name) || 'Gastgeber').slice(0, 20),
      frei,
      zeit: info.erstellt || Date.now(),
      regeln: E.zusammenfassung(J.regelnMitStandard(info.regeln)).slice(0, 160),
    }
    : null;
  const json = soll ? JSON.stringify(soll) : '';
  if (json === offenGeschrieben) return;
  const vorher = offenGeschrieben;
  offenGeschrieben = json;
  const r = ref(db, 'offen/' + code);
  if (soll) {
    onDisconnect(r).remove().then(() => set(r, soll)).catch(() => { offenGeschrieben = '?'; });
  } else if (vorher) {
    onDisconnect(r).cancel().catch(() => {});
    set(r, null).catch(() => {});
  }
}

let aktualisierungGeplant = false;
function aktualisiere() {
  if (aktualisierungGeplant) return;
  aktualisierungGeplant = true;
  setTimeout(() => { aktualisierungGeplant = false; aktualisiereJetzt(); }, 0);
}

function aktualisiereJetzt() {
  if (!code) return;
  if (!infoGeladen) return;
  if (!info) {
    vergissTisch(code);
    fehler('<b>Diesen Tisch gibt es nicht (mehr).</b><br>Vielleicht hat ihn der Gastgeber geschlossen. Code: ' + esc(code));
    return;
  }
  meinSitz = sitze.findIndex((x) => x && x.uid === uid);
  istHost = info.host === uid;
  abonniereHaende();
  setzePraesenz();
  planeUebernahme();
  pflegeOffen();
  if (info.status === 'lobby') {
    praesentiert = -1;
    tisch.schliesseDialog();
    dialogFuer = '';
    zeigeLobby();
    return;
  }
  if ($('tisch').hidden) zeige('tisch');
  praesentiere();
}

// --------------------------------------------------------------------- Lobby

function sitzName(s) {
  const x = sitze[s];
  if (!x) return 'Frei';
  if (x.typ === 'mensch' && !x.uid) return 'Frei';
  return x.name;
}

function zeigeLobby() {
  zeige('lobby');
  const link = location.origin + location.pathname + '?t=' + code + (EMULATOR ? '&emulator=1' : '');
  const menschenFrei = sitze.some((x) => x && x.typ === 'mensch' && !x.uid);
  const hostName = info.hostSitz != null && sitze[info.hostSitz] ? sitze[info.hostSitz].name : 'der Gastgeber';
  const karte = (s) => {
    const x = sitze[s] || { typ: 'mensch' };
    const ich = s === meinSitz;
    const frei = x.typ === 'mensch' && !x.uid;
    let wer;
    if (x.typ !== 'mensch') wer = `<span>🤖 ${esc(x.name)}</span>`;
    else if (frei) wer = '<span class="muted">Frei</span>';
    else wer = `<i class="punkt ${x.online ? 'an' : ''}"></i><span>${esc(x.name)}${ich ? ' (du)' : ''}${String(s) === String(info.hostSitz) ? ' · Gastgeber' : ''}</span>`;
    let unten = '';
    if (istHost && tauschVon >= 0) {
      unten = s === tauschVon
        ? '<button class="btn-ghost btn-klein" type="button" data-tausch-ab>Abbrechen</button>'
        : `<button class="btn btn-klein" type="button" data-tausch-mit="${s}">⇄ Hierhin</button>`;
    } else if (istHost && !ich) {
      unten = `<select class="text-feld" data-lobby-typ="${s}">${TYPEN.map(([w, t]) => `<option value="${w}" ${passtTyp(x.typ, w) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
      if (x.typ === 'mensch' && x.uid) unten += `<button class="btn-ghost btn-klein" type="button" data-frei="${s}">Platz freigeben</button>`;
    } else if (frei && meinSitz < 0) {
      unten = `<button class="btn btn-klein" type="button" data-hinsetzen="${s}">Hier sitzen</button>`;
    } else if (x.typ !== 'mensch') {
      unten = '<span class="lage">Computer</span>';
    }
    if (istHost && tauschVon < 0) unten += `<button class="btn-ghost btn-klein" type="button" data-tausch="${s}" aria-label="${LAGE[s]} mit einem anderen Platz tauschen">⇄ Platz tauschen</button>`;
    return `<div class="lobby-sitz ${ich ? 'ich' : ''} ${s === tauschVon ? 'tausch' : ''}"><div class="lage">${LAGE[s]}</div><div class="wer">${wer}</div>${unten}</div>`;
  };
  const oeffentlich = info.oeffentlich !== false;
  const r = J.regelnMitStandard(info.regeln);
  $('lobby').innerHTML = `
    <div class="panel stack" style="text-align:center">
      <span class="muted klein">${esc(info.name)}</span>
      <div class="code-gross">${esc(code)}</div>
      <div class="reihe" style="justify-content:center">
        <button class="btn-ghost btn-klein" type="button" id="teilenBtn">Einladen</button>
        <button class="btn-ghost btn-klein" type="button" id="kopierenBtn">Link kopieren</button>
      </div>
      <span class="muted klein" style="word-break:break-all">${esc(link)}</span>
      ${istHost
        ? `<label class="schalter"><span class="text"><span>🌍 Öffentlich</span><small>${oeffentlich ? 'Steht unter «Offene Tische», solange Plätze frei sind.' : 'Nur mit Code oder Link zu finden.'}</small></span><input type="checkbox" id="oeffentlichSchalter" ${oeffentlich ? 'checked' : ''}></label>`
        : `<span class="sichtbar">${oeffentlich ? '🌍 Öffentlicher Tisch' : '🔒 Privater Tisch – nur mit Code oder Link'}</span>`}
    </div>
    <div class="panel stack">
      <h2>Plätze</h2>
      ${istHost ? `<p class="muted klein">${tauschVon >= 0 ? 'Mit welchem Platz soll ' + esc(LAGE[tauschVon]) + ' tauschen? So bestimmst du, wer mit wem spielt.' : 'Wer mit wem spielt, bestimmst du mit «⇄ Platz tauschen». Platz 1 und 3 sind ein Team, Platz 2 und 4 das andere.'}</p>` : ''}
      <div class="lobby-sitze">
        <div class="lobby-team"><h3 class="team-a">Team A</h3>${karte(0)}${karte(2)}</div>
        <div class="lobby-team"><h3 class="team-b">Team B</h3>${karte(1)}${karte(3)}</div>
      </div>
      ${meinSitz < 0 && !menschenFrei ? '<p class="muted">Der Tisch ist voll.</p>' : ''}
      ${meinSitz < 0 && menschenFrei && !meinName() ? '<label class="stack" style="gap:6px"><span>Dein Name</span><input class="text-feld" id="lobbyName" maxlength="20" placeholder="z. B. Mia"></label>' : ''}
    </div>
    <div class="panel stack">
      <h2>Regeln</h2>
      <p class="muted">${esc(E.zusammenfassung(r))}${info.tipps === false ? ' · ohne Tipps' : ''}</p>
      ${istHost ? '<button class="btn-ghost btn-klein" type="button" id="regelnBtn">Regeln ändern</button>' : ''}
    </div>
    ${istHost
      ? `<button class="btn btn-voll" type="button" id="losBtn" ${menschenFrei ? 'disabled' : ''}>${menschenFrei ? 'Warte auf Mitspieler …' : 'Spiel starten'}</button>
         ${menschenFrei ? '<p class="muted klein" style="text-align:center">Oder freie Plätze auf Computer stellen.</p>' : ''}`
      : `<p class="muted" style="text-align:center">${meinSitz >= 0 ? 'Warte, bis ' + esc(hostName) + ' das Spiel startet …' : ''}</p>`}
    <button class="btn-ghost btn-voll" type="button" id="verlassenBtn">Tisch verlassen</button>
    ${istHost ? '<button class="btn-ghost btn-voll" type="button" id="schliessenBtn">🗑 Tisch für alle schliessen</button>' : ''}`;

  $('teilenBtn').addEventListener('click', () => {
    if (navigator.share) navigator.share({ title: 'Jass', text: 'Komm an meinen Jass-Tisch: Code ' + code, url: link }).catch(() => {});
    else $('kopierenBtn').click();
  });
  $('kopierenBtn').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText(link).then(() => tisch.toast('Link kopiert'), () => {});
  });
  $('verlassenBtn').addEventListener('click', async () => {
    if (meinSitz >= 0 && !istHost) {
      await set(ref(db, `jass/${code}/sitze/${meinSitz}`), { typ: 'mensch', name: 'Frei' }).catch(() => {});
    }
    verlasseTisch();
    zeigeStart();
  });
  const regelnBtn = $('regelnBtn');
  if (regelnBtn) regelnBtn.addEventListener('click', zeigeRegelDialog);
  const schliessenBtn = $('schliessenBtn');
  if (schliessenBtn) schliessenBtn.addEventListener('click', () => frageSchliessen(code));
  const oeffentlichSchalter = $('oeffentlichSchalter');
  if (oeffentlichSchalter) oeffentlichSchalter.addEventListener('change', (e) => {
    update(ref(db, `jass/${code}/info`), { oeffentlich: e.target.checked }).catch((x) => tisch.toast(x.message));
  });
  $('lobby').querySelectorAll('[data-tausch]').forEach((b) => b.addEventListener('click', () => {
    tauschVon = Number(b.dataset.tausch);
    zeigeLobby();
  }));
  $('lobby').querySelectorAll('[data-tausch-ab]').forEach((b) => b.addEventListener('click', () => {
    tauschVon = -1;
    zeigeLobby();
  }));
  $('lobby').querySelectorAll('[data-tausch-mit]').forEach((b) => b.addEventListener('click', () => {
    const a = tauschVon;
    tauschVon = -1;
    tauschePlaetze(a, Number(b.dataset.tauschMit));
  }));
  const los = $('losBtn');
  if (los) los.addEventListener('click', () => {
    los.disabled = true;
    update(ref(db, `jass/${code}`), { log: null, haende: null, 'info/status': 'spiel', 'info/spielNr': (info.spielNr || 0) + 1 }).catch((e) => tisch.toast(e.message));
  });
  $('lobby').querySelectorAll('[data-hinsetzen]').forEach((b) => b.addEventListener('click', () => {
    const feld = $('lobbyName');
    const name = (feld ? feld.value.trim() : meinName()).slice(0, 20);
    if (!name) { if (feld) feld.focus(); return; }
    E.schreibe(KEY_NAME, name);
    set(ref(db, `jass/${code}/sitze/${b.dataset.hinsetzen}`), { typ: 'mensch', uid, name, online: true })
      .catch(() => tisch.toast('Der Platz ist schon besetzt.'));
  }));
  $('lobby').querySelectorAll('[data-lobby-typ]').forEach((sel) => sel.addEventListener('change', () => {
    const s = Number(sel.dataset.lobbyTyp);
    const typ = sel.value;
    set(ref(db, `jass/${code}/sitze/${s}`), typ === 'mensch' ? { typ: 'mensch', name: 'Frei' } : { typ, name: COMPUTER[s - 1] || 'Dario' });
  }));
  $('lobby').querySelectorAll('[data-frei]').forEach((b) => b.addEventListener('click', () => {
    set(ref(db, `jass/${code}/sitze/${b.dataset.frei}`), { typ: 'mensch', name: 'Frei' });
  }));
}

// Zwei Plätze tauschen (nur der Gastgeber, nur in der Lobby). Wer sitzt,
// wandert mit Namen und Online-Status; sitzt der Gastgeber selbst auf einem
// der beiden Plätze, zieht hostSitz mit.
function tauschePlaetze(a, b) {
  if (a === b || a < 0 || b < 0 || !istHost || info.status !== 'lobby') { zeigeLobby(); return; }
  const frei = { typ: 'mensch', name: 'Frei' };
  const daten = {};
  daten[`jass/${code}/sitze/${a}`] = sitze[b] || frei;
  daten[`jass/${code}/sitze/${b}`] = sitze[a] || frei;
  const hs = String(info.hostSitz);
  if (hs === String(a)) daten[`jass/${code}/info/hostSitz`] = String(b);
  else if (hs === String(b)) daten[`jass/${code}/info/hostSitz`] = String(a);
  update(ref(db), daten).catch((e) => { tisch.toast('Tauschen ging nicht: ' + e.message); zeigeLobby(); });
}

function zeigeRegelDialog() {
  const regeln = J.regelnMitStandard(info.regeln);
  let tipps = info.tipps !== false;
  const box = tisch.oeffneDialog(`<h2>Regeln des Tisches</h2><div class="stack" id="dialogRegeln" style="gap:10px"></div>
    <label class="schalter"><span class="text"><span>Tipps erlaubt</span></span><input type="checkbox" id="dialogTipps" ${tipps ? 'checked' : ''}></label>
    <button class="btn btn-voll" type="button" id="regelnSpeichern">Speichern</button>`);
  E.regelFormular(box.querySelector('#dialogRegeln'), regeln, () => {});
  box.querySelector('#dialogTipps').addEventListener('change', (e) => { tipps = e.target.checked; });
  box.querySelector('#regelnSpeichern').addEventListener('click', () => {
    update(ref(db, `jass/${code}/info`), { regeln: J.regelnMitStandard(regeln), tipps }).then(() => tisch.schliesseDialog(), (e) => tisch.toast(e.message));
  });
}

// ---------------------------------------------------------------- Spieltisch

function spielerListe() {
  return [0, 1, 2, 3].map((s) => {
    const x = sitze[s] || { typ: 'mensch' };
    return { name: sitzName(s), typ: x.typ, online: x.typ === 'mensch' ? (x.uid ? x.online !== false : false) : true };
  });
}

function baue(bis) {
  const ereignisse = bis == null ? log : log.slice(0, bis);
  const erg = P.aufbauen(info.regeln, ereignisse, haende);
  if (erg.fehler.length) console.warn('Protokoll', erg.fehler);
  return erg.spiel;
}

function ansichtSitz() { return meinSitz >= 0 ? meinSitz : 0; }

// Zeigt neue Ereignisse eines nach dem anderen – mit Blasen und dem
// liegenbleibenden Stich. Beim ersten Laden springt es ans Ende.
async function praesentiere() {
  if (praesentationLaeuft) return;
  praesentationLaeuft = true;
  try {
    if (praesentiert < 0 || log.length < praesentiert) {
      praesentiert = log.length;
      dialogFuer = '';
      tisch.schliesseDialog();
    }
    while (code && info && info.status !== 'lobby' && praesentiert < log.length) {
      const i = praesentiert;
      const ev = log[i];
      const s = baue(i + 1);
      praesentiert = i + 1;
      if (!s || !ev) continue;
      spiel = s;
      const r = s.runde;
      tisch.setze({ spiel: s, ansichtSitz: ansichtSitz(), spieler: spielerListe(), eingabe: null, tipps: info.tipps !== false });
      if (ev.t === 'r') {
        if (dialogFuer.startsWith('runde')) { tisch.schliesseDialog(); dialogFuer = ''; }
        tisch.kommentar('');
        await tisch.austeilen((Number(ev.a) + 3) % 4);
      } else if (ev.t === 'p') {
        tisch.zeichne();
        tisch.blase(Number(ev.s), 'Schiebe!');
      } else if (ev.t === 'a') {
        tisch.zeichne();
        tisch.blase(Number(ev.s), T.modusHtml(ev.c, true) + (J.MODI[ev.c] && J.MODI[ev.c].trumpf >= 0 ? ' Trumpf' : ''));
      } else if (ev.t === 'k') {
        tisch.neueKarte(Number(ev.k), Number(ev.s));
        if (ev.st && s.regeln.stoeck) tisch.blase(Number(ev.s), 'Stöck!');
        const fertig = r.stich.length === 0 && r.stiche.length > 0;
        if (fertig) {
          const eintrag = r.stiche[r.stiche.length - 1];
          if (r.stiche.length === 1 && r.weis) {
            tisch.zeigeWeise(r.weis.proSitz);
            if (r.weis.siegerTeam >= 0) tisch.toast(tisch.teamName(r.weis.siegerTeam) + ' schreiben ' + r.weis.punkte[r.weis.siegerTeam] + ' Weispunkte');
          }
          await tisch.stichZeigen(eintrag, tempo().stich);
        } else {
          tisch.zeichne();
        }
      }
    }
  } finally {
    praesentationLaeuft = false;
  }
  if (code && info && info.status !== 'lobby' && praesentiert < log.length) { praesentiere(); return; }
  nachAufbau();
}

function nachAufbau() {
  if (!code || !info || info.status === 'lobby') return;
  spiel = baue();
  if (!spiel) {
    tisch.hinweis(istHost ? 'Es wird ausgeteilt …' : 'Warte, bis ausgeteilt ist …');
    planeHost();
    return;
  }
  const n = P.naechster(spiel);
  let eingabe = null;
  if (meinSitz >= 0 && n.sitz === meinSitz) eingabe = n.art === 'ansage' ? 'ansage' : n.art === 'karte' ? 'karte' : null;
  // Die eigene Hand muss da sein, bevor man spielen kann.
  if (eingabe && spiel.runde.haende[meinSitz].some((k) => k < 0)) eingabe = null;
  wahlAktiv = !!eingabe;
  tisch.setze({ spiel, ansichtSitz: ansichtSitz(), spieler: spielerListe(), eingabe, tipps: info.tipps !== false });
  tisch.zeichne();
  zeigeHinweis(n);
  if (n.art === 'rundenende') zeigeRundenende();
  else if (n.art === 'fertig') zeigeSpielende();
  else if (dialogFuer && dialogFuer !== 'menu') { tisch.schliesseDialog(); dialogFuer = ''; }
  planeHost();
}

function zeigeHinweis(n) {
  let text = '';
  const hostSitz = Number(info.hostSitz);
  const hostWeg = sitze[hostSitz] && sitze[hostSitz].online === false;
  if (n.art === 'karte' || n.art === 'ansage') {
    const x = sitze[n.sitz];
    if (x && x.typ === 'mensch' && (!x.uid || x.online === false) && n.sitz !== meinSitz) {
      text = esc(sitzName(n.sitz) === 'Frei' ? 'Der Platz' : sitzName(n.sitz)) + ' ist nicht da – gleich spielt der Computer für ' + (sitzName(n.sitz) === 'Frei' ? 'ihn' : esc(sitzName(n.sitz))) + '.';
    } else if (x && x.typ !== 'mensch' && hostWeg && !istHost) {
      text = 'Warte auf den Gastgeber …';
    }
  }
  tisch.hinweis(text);
}

function meineAnsage(c) {
  if (!wahlAktiv || !spiel) return;
  wahlAktiv = false;
  const ev = c === 'SCHIEBEN' ? { t: 'p', s: meinSitz } : { t: 'a', s: meinSitz, c };
  schreibe(ev);
}

function meineKarte(k) {
  if (!wahlAktiv || !spiel) return;
  if (!J.erlaubteFuer(spiel, meinSitz).includes(k)) { nachAufbau(); return; }
  wahlAktiv = false;
  schreibe(P.kartenEreignis(spiel, meinSitz, k));
}

function schreibe(ev) {
  const n = log.length;
  return set(ref(db, `jass/${code}/log/${n}`), ev).catch((e) => {
    console.warn('Zug nicht geschrieben', e.message);
    aktualisiere();
  });
}

// ------------------------------------------------------------- Dialoge

function zeigeRundenende() {
  const r = spiel.runde;
  const schluessel = 'runde-' + r.nr;
  if (!rundenEndeSeit || dialogFuer !== schluessel) rundenEndeSeit = Date.now();
  const ab = r.abrechnung;
  const neu = [spiel.summe[0] + ab.total[0], spiel.summe[1] + ab.total[1]];
  const menschen = [0, 1, 2, 3].filter((s) => sitze[s] && sitze[s].typ === 'mensch' && sitze[s].uid && sitze[s].online !== false);
  const offen = menschen.filter((s) => !(Number(sitze[s].bereit) >= r.nr));
  const ichBereit = meinSitz < 0 || Number((sitze[meinSitz] || {}).bereit) >= r.nr;
  const warten = offen.length ? 'Warte auf ' + offen.map((s) => esc(sitzName(s))).join(', ') + ' …' : 'Gleich geht es weiter …';
  const html = tisch.rundenendeHtml(ab, neu)
    + `<p class="bereit-liste">${warten}</p>`
    + (ichBereit ? '' : '<button class="btn btn-voll" type="button" id="bereitBtn">Weiter</button>');
  if (dialogFuer === schluessel && tisch.dialogOffen()) {
    // Nur die Liste der Wartenden auffrischen.
    const box = document.querySelector('#jass-dialog .dialog');
    const liste = box && box.querySelector('.bereit-liste');
    if (liste) liste.innerHTML = warten;
    const b = box && box.querySelector('#bereitBtn');
    if (b && ichBereit) b.remove();
    return;
  }
  dialogFuer = schluessel;
  const box = tisch.oeffneDialog(html, false);
  const b = box.querySelector('#bereitBtn');
  if (b) b.addEventListener('click', () => {
    b.disabled = true;
    set(ref(db, `jass/${code}/sitze/${meinSitz}/bereit`), r.nr).catch(() => { b.disabled = false; });
  });
}

function zeigeSpielende() {
  if (dialogFuer === 'ende-' + info.spielNr) return;
  dialogFuer = 'ende-' + info.spielNr;
  const box = tisch.oeffneDialog(`<div class="ergebnis-titel">🏆 ${esc(tisch.siegerText())}</div>
    <p class="muted" style="text-align:center">${spiel.summe[0]} : ${spiel.summe[1]}</p>
    ${tisch.verlaufHtml()}
    ${istHost
      ? '<div class="reihe"><button class="btn" type="button" id="nochmals" style="flex:1">Nochmals</button><button class="btn-ghost" type="button" id="zurLobby">Zur Lobby</button></div>'
      : '<p class="muted" style="text-align:center">Der Gastgeber kann eine neue Partie starten.</p>'}
    <button class="btn-ghost btn-voll" type="button" id="endeVerlassen">Tisch verlassen</button>`, false);
  const neuStart = (status) => update(ref(db, `jass/${code}`), { log: null, haende: null, 'info/status': status, 'info/spielNr': (info.spielNr || 0) + 1 }).catch((e) => tisch.toast(e.message));
  const n = box.querySelector('#nochmals');
  if (n) n.addEventListener('click', () => neuStart('spiel'));
  const l = box.querySelector('#zurLobby');
  if (l) l.addEventListener('click', () => neuStart('lobby'));
  box.querySelector('#endeVerlassen').addEventListener('click', () => { verlasseTisch(); zeigeStart(); });
}

function zeigeMenu() {
  dialogFuer = 'menu';
  const link = location.origin + location.pathname + '?t=' + code;
  const box = tisch.oeffneDialog(`<h2>${esc(info.name)} · ${esc(code)}</h2>
    ${spiel ? `<details class="abschnitt" open><summary>Spielstand</summary><div class="inhalt">${tisch.verlaufHtml()}</div></details>` : ''}
    <details class="abschnitt"><summary>Regeln</summary><div class="inhalt"><p class="muted">${esc(E.zusammenfassung(J.regelnMitStandard(info.regeln)))}</p></div></details>
    <details class="abschnitt"><summary>Anzeige</summary><div class="inhalt" id="menuAnzeige"></div></details>
    <p class="muted klein" style="word-break:break-all">Link zum Tisch: ${esc(link)}</p>
    <button class="btn btn-voll" type="button" data-schliessen>Weiterspielen</button>
    <button class="btn-ghost btn-voll" type="button" id="menuVerlassen">Tisch verlassen</button>
    ${istHost ? '<button class="btn-ghost btn-voll" type="button" id="menuSchliessen">🗑 Tisch für alle schliessen</button>' : ''}`);
  const zu = box.querySelector('#menuSchliessen');
  if (zu) zu.addEventListener('click', () => frageSchliessen(code));
  E.anzeigeFormular(box.querySelector('#menuAnzeige'), anzeige, (a) => { E.speichereAnzeige(a); K.setzeFarben(a.farben); tisch.zeichne(); }, { stichWarten: false });
  box.querySelector('#menuVerlassen').addEventListener('click', () => { verlasseTisch(); zeigeStart(); });
}

// -------------------------------------------------------- Der Gastgeber

const zufall = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

function planeHost() {
  clearTimeout(hostTimer);
  if (!istHost || !info || info.status === 'lobby' || praesentationLaeuft) return;
  if (!spiel) {
    if (info.status === 'spiel' && !log.length) hostTimer = setTimeout(() => teileAus(0), 400);
    return;
  }
  const n = P.naechster(spiel);
  if (n.art === 'fertig') {
    if (info.status !== 'fertig') update(ref(db, `jass/${code}/info`), { status: 'fertig' }).catch(() => {});
    return;
  }
  if (n.art === 'rundenende') {
    const nr = spiel.runde.nr;
    const menschen = [0, 1, 2, 3].filter((s) => sitze[s] && sitze[s].typ === 'mensch' && sitze[s].uid && sitze[s].online !== false);
    const alle = menschen.every((s) => Number(sitze[s].bereit) >= nr);
    const rest = alle ? 600 : Math.max(500, RUNDE_WEITER_NACH - (Date.now() - rundenEndeSeit));
    hostTimer = setTimeout(() => teileAus(nr + 1), rest);
    return;
  }
  const x = sitze[n.sitz];
  if (!x) return;
  const istComputer = x.typ !== 'mensch';
  const weg = x.typ === 'mensch' && (!x.uid || x.online === false);
  if (!weg) delete wegSeit[n.sitz];
  if (!istComputer && !weg) return;
  if (spiel.runde.haende[n.sitz].some((k) => k < 0)) return; // Karten noch nicht geladen
  let warte = tempo().denken + (n.art === 'ansage' ? 300 : 0);
  if (weg) {
    if (!wegSeit[n.sitz]) wegSeit[n.sitz] = Date.now();
    warte = Math.max(warte, ERSATZ_NACH - (Date.now() - wegSeit[n.sitz]));
  }
  const stand = log.length;
  hostTimer = setTimeout(() => computerZug(n, 'schwer', stand), warte);
}

function computerZug(n, stufe, stand) {
  if (!istHost || log.length !== stand || !spiel) return;
  const jetzt = P.naechster(spiel);
  if (jetzt.art !== n.art || jetzt.sitz !== n.sitz) return;
  if (n.art === 'ansage') {
    const w = B.waehleAnsage(spiel, n.sitz, stufe, B.rechentiefe(anzeige.rechnen));
    schreibe(w.code === 'SCHIEBEN' ? { t: 'p', s: n.sitz } : { t: 'a', s: n.sitz, c: w.code });
  } else {
    const z = B.waehleKarte(spiel, n.sitz, stufe, B.rechentiefe(anzeige.rechnen));
    schreibe(P.kartenEreignis(spiel, n.sitz, z.karte));
  }
}

function teileAus(nr) {
  if (!istHost || !info || info.status !== 'spiel') return;
  const ersterEv = log.find((ev) => ev && ev.t === 'r');
  const erster = ersterEv ? Number(ersterEv.a) : -1;
  if (nr > 0 && (!spiel || P.naechster(spiel).art !== 'rundenende' || spiel.runde.nr !== nr - 1)) return;
  if (nr === 0 && log.length) return;
  const { haende: h, ansager } = P.austeilen(info.regeln, nr, erster, zufall, Number(info.hostSitz));
  const daten = {};
  h.forEach((karten, s) => { daten[`haende/${s}`] = { nr, karten }; });
  daten[`log/${log.length}`] = { t: 'r', nr, a: ansager };
  update(ref(db, `jass/${code}`), daten).catch((e) => console.warn('Austeilen', e.message));
}

// Ist der Gastgeber weg, übernimmt der erste Mitspieler, der da ist.
let hostWegSeit = 0;
function planeUebernahme() {
  clearTimeout(uebernahmeTimer);
  if (!info || istHost || meinSitz < 0) { hostWegSeit = 0; return; }
  const hostSitz = Number(info.hostSitz);
  const h = sitze[hostSitz];
  if (!h || h.online !== false) { hostWegSeit = 0; return; }
  if (!hostWegSeit) hostWegSeit = Date.now();
  const erster = [0, 1, 2, 3].find((s) => sitze[s] && sitze[s].typ === 'mensch' && sitze[s].uid && sitze[s].online !== false);
  if (erster !== meinSitz) return;
  uebernahmeTimer = setTimeout(() => {
    if (!info || sitze[hostSitz] && sitze[hostSitz].online !== false) return;
    const neu = Object.assign({}, info, { host: uid, hostSitz: String(meinSitz) });
    set(ref(db, `jass/${code}/info`), neu).then(() => tisch.toast('Du bist jetzt Gastgeber.'), (e) => console.warn('Übernahme', e.message));
  }, Math.max(0, UEBERNAHME_NACH - (Date.now() - hostWegSeit)));
}

window.addEventListener('pagehide', () => {
  if (code && meinSitz >= 0) set(ref(db, `jass/${code}/sitze/${meinSitz}/online`), false).catch(() => {});
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && code) { praesenzFuer = ''; setzePraesenz(); aktualisiere(); }
});
