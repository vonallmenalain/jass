/*
 * netlify/vorschau.mjs – Link-Vorschau für Turniere (WhatsApp, Signal, iMessage …)
 * ---------------------------------------------------------------------------
 * Vorschauen lesen nur das HTML, kein JavaScript. Darum setzt die Edge-Funktion
 * (edge-functions/turnier-vorschau.js) den Namen des Turniers schon auf dem
 * Server in <title> und og:title. Die Turniere sind öffentlich lesbar
 * (firestore.rules), es braucht also keinen Schlüssel.
 */

export const PROJEKT = 'jassen-bc258';
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function gueltigeId(id) { return typeof id === 'string' && ID.test(id); }

export function turnierAdresse(id) {
  return `https://firestore.googleapis.com/v1/projects/${PROJEKT}/databases/(default)/documents/turniere/${encodeURIComponent(id)}`
    + '?mask.fieldPaths=title&mask.fieldPaths=status&mask.fieldPaths=players';
}

// Firestore-REST-Dokument → { titel, spieler, fertig }
export function ausDokument(dok) {
  const f = (dok && dok.fields) || {};
  const titel = f.title && typeof f.title.stringValue === 'string' ? f.title.stringValue.trim() : '';
  if (!titel) return null;
  const werte = f.players && f.players.arrayValue && f.players.arrayValue.values;
  return {
    titel: titel.slice(0, 120),
    spieler: Array.isArray(werte) ? werte.length : 0,
    fertig: f.status && f.status.stringValue === 'finished',
  };
}

function maskiere(s) {
  return String(s).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
}

export function beschreibung(t) {
  const teile = [];
  if (t.spieler) teile.push(t.spieler + ' Spieler');
  teile.push(t.fertig ? 'beendet' : 'läuft');
  return teile.join(' · ');
}

// Setzt Titel, og:title, og:description und og:url in die Seite.
export function mitVorschau(html, t, adresse) {
  const titel = maskiere(t.titel);
  const text = maskiere(beschreibung(t));
  const meta = (name, wert) => {
    const muster = new RegExp(`<meta property="${name}" content="[^"]*"\\s*/?>`);
    const tag = `<meta property="${name}" content="${wert}" />`;
    if (muster.test(html)) html = html.replace(muster, tag);
    else html = html.replace(/<\/head>/i, `  ${tag}\n</head>`);
  };
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${titel}</title>`);
  meta('og:title', titel);
  meta('og:description', text);
  if (adresse) meta('og:url', maskiere(adresse));
  return html;
}
