// Spielt die Regeln der Realtime Database (database.rules.json) im Emulator
// durch: für jede Rolle, was sie darf und was nicht.
//
//   cd werkzeuge && npm run test:regeln
//
// Der Emulator nimmt fehlerhafte Regeln stumm an und verweigert dann alles –
// die «darf»-Fälle fangen das.
import test, { before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, set, get, update, remove } from 'firebase/database';

const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-jass',
    database: { host, port: Number(port), rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8') },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const CODE = 'K7QM2P';
const pfad = (rest) => `jass/${CODE}${rest ? '/' + rest : ''}`;
const db = (uid) => (uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database());

const REGELN = {
  modi: { T: true, OBE: true, UNE: true, SLO: false, SLU: false, MIS: false },
  schieben: true, spielende: 'runden', runden: 8, zielPunkte: 1000, letzterStich: 5,
  weisen: false, stoeck: false, stoeckPunkte: 20, matchBonus: false, matchPunkte: 100,
  multiplikatoren: false, faktoren: { T0: 2, T1: 1, T2: 2, T3: 1, OBE: 3, UNE: 3, SLO: 4, SLU: 4, MIS: 1 },
  untertrumpfen: false, puurFrei: true, ersterAnsager: 'ecke7', ausspiel: 'vorhand',
};

function tischDaten(hostUid) {
  return {
    [pfad('info')]: { name: 'Familienjass', host: hostUid, hostSitz: '0', erstellt: 1, status: 'lobby', spielNr: 0, regeln: REGELN, tipps: true },
    [pfad('sitze/0')]: { typ: 'mensch', uid: hostUid, name: 'Papa', online: true },
    [pfad('sitze/1')]: { typ: 'mittel', name: 'Anna' },
    [pfad('sitze/2')]: { typ: 'mensch', name: 'Offen' },
    [pfad('sitze/3')]: { typ: 'mensch', name: 'Offen' },
  };
}

async function tischMitGast() {
  await assertSucceeds(update(ref(db('papa')), tischDaten('papa')));
  await assertSucceeds(set(ref(db('mia'), pfad('sitze/2')), { typ: 'mensch', uid: 'mia', name: 'Mia', online: true }));
}

test('Ohne Anmeldung ist alles zu', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await update(ref(c.database()), tischDaten('papa')); });
  await assertFails(get(ref(db(null), pfad('info'))));
  await assertFails(set(ref(db(null), pfad('log/0')), { t: 'p', s: 0 }));
  await assertFails(get(ref(db('papa'), 'jass')));
});

test('Tisch eröffnen: nur als eigener Gastgeber, nur mit gültigem Code', async () => {
  await assertSucceeds(update(ref(db('papa')), tischDaten('papa')));
  await assertFails(update(ref(db('mia')), { [pfad('info/host')]: 'mia' }));
  const fremd = tischDaten('jemand');
  await assertFails(update(ref(db('mia')), Object.fromEntries(Object.entries(fremd).map(([k, v]) => [k.replace(CODE, 'ABCDEF'), v]))));
  const falsch = Object.fromEntries(Object.entries(tischDaten('mia')).map(([k, v]) => [k.replace(CODE, 'abc'), v]));
  await assertFails(update(ref(db('mia')), falsch));
});

test('Regeln mit fremden Feldern werden abgelehnt', async () => {
  const d = tischDaten('papa');
  d[pfad('info')] = Object.assign({}, d[pfad('info')], { regeln: Object.assign({}, REGELN, { muell: 'x'.repeat(1000) }) });
  await assertFails(update(ref(db('papa')), d));
});

test('Platz nehmen: nur einen freien Menschenplatz, nur für sich', async () => {
  await assertSucceeds(update(ref(db('papa')), tischDaten('papa')));
  await assertSucceeds(set(ref(db('mia'), pfad('sitze/2')), { typ: 'mensch', uid: 'mia', name: 'Mia', online: true }));
  await assertFails(set(ref(db('tim'), pfad('sitze/2')), { typ: 'mensch', uid: 'tim', name: 'Tim' }), 'besetzt');
  await assertFails(set(ref(db('tim'), pfad('sitze/1')), { typ: 'mensch', uid: 'tim', name: 'Tim' }), 'Computerplatz');
  await assertFails(set(ref(db('tim'), pfad('sitze/3')), { typ: 'mensch', uid: 'mia', name: 'Tim' }), 'für jemand anderen');
  await assertSucceeds(set(ref(db('mia'), pfad('sitze/2/online')), false));
  await assertSucceeds(set(ref(db('mia'), pfad('sitze/2/bereit')), 3));
  await assertFails(set(ref(db('mia'), pfad('sitze/2/typ')), 'schwer'), 'Typ ändert nur der Gastgeber');
  await assertSucceeds(set(ref(db('papa'), pfad('sitze/1/typ')), 'schwer'));
});

test('Mitlesen: Info, Plätze und Verlauf ja – fremde Karten nein', async () => {
  await tischMitGast();
  await assertSucceeds(set(ref(db('papa'), pfad('haende/2')), { nr: 0, karten: [0, 1, 2, 3, 4, 5, 6, 7, 8] }));
  await assertSucceeds(set(ref(db('papa'), pfad('haende/3')), { nr: 0, karten: [9, 10, 11, 12, 13, 14, 15, 16, 17] }));
  await assertSucceeds(get(ref(db('tim'), pfad('info'))));
  await assertSucceeds(get(ref(db('tim'), pfad('sitze'))));
  await assertSucceeds(get(ref(db('tim'), pfad('log'))));
  await assertSucceeds(get(ref(db('mia'), pfad('haende/2'))), 'eigene Karten');
  await assertFails(get(ref(db('mia'), pfad('haende/3'))), 'fremde Karten');
  await assertFails(get(ref(db('mia'), pfad('haende'))), 'alle Karten');
  await assertSucceeds(get(ref(db('papa'), pfad('haende/3'))), 'der Gastgeber teilt aus');
  await assertFails(set(ref(db('mia'), pfad('haende/2')), { nr: 0, karten: [35, 34, 33, 32, 31, 30, 29, 28, 27] }), 'nur der Gastgeber teilt aus');
});

test('Züge: nur für den eigenen Platz, nur einmal, nur in gültiger Form', async () => {
  await tischMitGast();
  await assertSucceeds(set(ref(db('papa'), pfad('log/0')), { t: 'r', nr: 0, a: 2 }));
  await assertFails(set(ref(db('mia'), pfad('log/1')), { t: 'r', nr: 1, a: 3 }), 'austeilen nur der Gastgeber');
  await assertSucceeds(set(ref(db('mia'), pfad('log/1')), { t: 'a', s: 2, c: 'T1' }));
  await assertFails(set(ref(db('papa'), pfad('log/1')), { t: 'a', s: 0, c: 'OBE' }), 'überschreiben');
  await assertFails(set(ref(db('mia'), pfad('log/2')), { t: 'k', s: 0, k: 5 }), 'für fremden Platz');
  await assertFails(set(ref(db('mia'), pfad('log/2')), { t: 'k', s: 2, k: 40 }), 'keine Karte');
  await assertFails(set(ref(db('mia'), pfad('log/2')), { t: 'k', s: 2, k: 5, extra: 1 }), 'fremdes Feld');
  await assertFails(set(ref(db('mia'), pfad('log/2')), { t: 'a', s: 2, c: 'XYZ' }), 'keine Ansage');
  await assertSucceeds(set(ref(db('mia'), pfad('log/2')), { t: 'k', s: 2, k: 5, w: [[0, 1, 2]], st: 1 }));
  await assertSucceeds(set(ref(db('papa'), pfad('log/3')), { t: 'k', s: 1, k: 9 }), 'Gastgeber spielt für den Computer');
  await assertFails(set(ref(db('tim'), pfad('log/4')), { t: 'k', s: 3, k: 7 }), 'wer nicht am Tisch sitzt');
});

test('Neues Spiel: nur der Gastgeber räumt Verlauf und Karten', async () => {
  await tischMitGast();
  await assertSucceeds(set(ref(db('papa'), pfad('log/0')), { t: 'r', nr: 0, a: 2 }));
  await assertFails(remove(ref(db('mia'), pfad('log'))));
  await assertSucceeds(update(ref(db('papa'), pfad()), { log: null, haende: null, 'info/spielNr': 1, 'info/status': 'spiel' }));
});

test('Gastgeber übernehmen: nur wenn er offline ist, nur wer am Tisch sitzt', async () => {
  await tischMitGast();
  const neu = { name: 'Familienjass', host: 'mia', hostSitz: '2', erstellt: 1, status: 'spiel', spielNr: 0, regeln: REGELN, tipps: true };
  await assertFails(set(ref(db('mia'), pfad('info')), neu), 'Gastgeber ist noch da');
  await assertSucceeds(set(ref(db('papa'), pfad('sitze/0/online')), false));
  await assertFails(set(ref(db('tim'), pfad('info')), Object.assign({}, neu, { host: 'tim', hostSitz: '3' })), 'sitzt nicht am Tisch');
  await assertSucceeds(set(ref(db('mia'), pfad('info')), neu));
  await assertSucceeds(get(ref(db('mia'), pfad('haende/0'))), 'neuer Gastgeber liest die Karten');
});

test('Tisch löschen: nur der Gastgeber', async () => {
  await tischMitGast();
  await assertFails(remove(ref(db('mia'), pfad())));
  await assertSucceeds(remove(ref(db('papa'), pfad())));
});

test('Andere Pfade bleiben zu', async () => {
  await assertFails(set(ref(db('papa'), 'turniere/x'), { a: 1 }));
  await assertFails(set(ref(db('papa'), pfad('geheim')), { a: 1 }));
});
