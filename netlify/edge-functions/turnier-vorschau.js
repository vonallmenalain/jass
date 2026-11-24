// Link-Vorschau mit dem Namen des Turniers – siehe netlify/vorschau.mjs.
import { gueltigeId, turnierAdresse, ausDokument, mitVorschau } from '../vorschau.mjs';

export default async (request, context) => {
  const antwort = await context.next();
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const art = antwort.headers.get('content-type') || '';
  if (antwort.status !== 200 || !art.includes('text/html') || !gueltigeId(id)) return antwort;

  let turnier = null;
  try {
    const r = await fetch(turnierAdresse(id), { signal: AbortSignal.timeout(1500) });
    if (r.ok) turnier = ausDokument(await r.json());
  } catch (e) { /* ohne Vorschau weiter */ }
  if (!turnier) return antwort;

  const html = mitVorschau(await antwort.text(), turnier, url.href);
  const kopf = new Headers(antwort.headers);
  kopf.delete('content-length');
  kopf.delete('etag');
  return new Response(html, { status: 200, headers: kopf });
};

export const config = {
  path: ['/turnier', '/turnier.html', '/turnier-allgemein', '/turnier-allgemein.html'],
};
