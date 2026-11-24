/*
 * jass-design.js – das gewählte Design auf jeder Seite (früh im <head>).
 * ---------------------------------------------------------------------------
 * Liest das Design aus den gespeicherten Einstellungen (jass-lernen-anzeige-v1,
 * Feld «design») und setzt es als <html data-design="…">; jass-design.css
 * färbt danach die Seite um. Standard ist «nacht» (Nacht & Koralle) – dafür
 * braucht es keine Überschreibung.
 *
 *   JassDesign.DESIGNS            [[id, Name, Teppich], …]
 *   JassDesign.setze(id)          sofort umschalten (Einstellungen)
 *   JassDesign.ladeSchrift(id)    Schriften eines Designs laden (Vorschau)
 */
(function (root) {
  'use strict';
  const DESIGNS = [
    ['nacht', 'Nacht & Koralle', 'alae'],
    ['stube', 'Jassstube', 'ecken'],
    ['raster', 'Schweizer Raster', 'kreuz'],
    ['gold', 'Mitternacht & Gold', 'trumpf'],
  ];
  const SCHRIFTEN = {
    stube: 'family=Zilla+Slab:wght@600;700&family=Nunito+Sans:wght@400;600;700;800',
    raster: 'family=Archivo:wght@500;600;700;800;900',
    gold: 'family=Cormorant+Garamond:ital,wght@0,600;0,700;1,600&family=Manrope:wght@400;600;700;800',
  };
  const FARBE = { nacht: '#0c0e13', stube: '#0f3b29', raster: '#ffffff', gold: '#0b1630' };

  function gespeichert() {
    try {
      const a = JSON.parse(root.localStorage.getItem('jass-lernen-anzeige-v1') || '{}');
      return DESIGNS.some((d) => d[0] === a.design) ? a.design : 'nacht';
    } catch (e) { return 'nacht'; }
  }

  function ladeSchrift(d) {
    if (!SCHRIFTEN[d] || root.document.querySelector(`link[data-design-schrift="${d}"]`)) return;
    const l = root.document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?' + SCHRIFTEN[d] + '&display=swap';
    l.dataset.designSchrift = d;
    root.document.head.appendChild(l);
  }

  function setze(id) {
    const d = DESIGNS.some((x) => x[0] === id) ? id : 'nacht';
    const html = root.document.documentElement;
    if (d === 'nacht') html.removeAttribute('data-design'); else html.setAttribute('data-design', d);
    ladeSchrift(d);
    const meta = root.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', FARBE[d]);
  }

  if (root.document) setze(gespeichert());
  root.JassDesign = { DESIGNS, setze, gespeichert, ladeSchrift };
})(typeof self !== 'undefined' ? self : globalThis);
