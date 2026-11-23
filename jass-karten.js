/*
 * jass-karten.js – Die Karten als SVG, selbst gezeichnet.
 * ---------------------------------------------------------------------------
 * Französische Karten: Schaufel, Herz, Kreuz, Ecke. Die Farbzeichen sind
 * Pfade, keine Schriftzeichen – sonst macht iOS aus ♥ und ♦ ein Emoji.
 *
 *   JassKarten.svg(karte, { trumpf })   eine Karte als SVG-Text
 *   JassKarten.rueckseite()             die Rückseite
 *   JassKarten.zeichen(farbe, gross)    nur das Farbzeichen (für Knöpfe)
 *   JassKarten.setzeFarben('klassisch' | 'vier')
 *   JassKarten.setzeBild('foto' | 'eigen' | 'klassisch')
 *
 * «foto» sind unsere eigenen Karten (karten/foto/, aus Fotos des Kartensatzes
 * von jasskarten.ch, ohne Schrift und Logo – siehe karten/README.md).
 *
 * «Klassisch» zeigt den freien Kartensatz SVG-cards (David Bellot, LGPL,
 * karten/README.md) – echte französische Karten mit Bildfiguren.
 */
(function (root) {
  'use strict';

  const J = root.JassEngine;

  // Farbzeichen im Feld 0..100.
  const PFADE = [
    // Schaufel
    'M50 4C60 24 92 38 92 62C92 80 72 88 56 76C58 86 62 92 70 96H30C38 92 42 86 44 76C28 88 8 80 8 62C8 38 40 24 50 4Z',
    // Herz
    'M50 92C24 72 4 54 6 32C8 14 22 6 34 6C42 6 48 12 50 20C52 12 58 6 66 6C78 6 92 14 94 32C96 54 76 72 50 92Z',
    // Kreuz
    'M50 4A20 20 0 0 1 66 36A20 20 0 1 1 56 72C58 84 62 92 70 96H30C38 92 42 84 44 72A20 20 0 1 1 34 36A20 20 0 0 1 50 4Z',
    // Ecke
    'M50 2C60 20 76 38 92 50C76 62 60 80 50 98C40 80 24 62 8 50C24 38 40 20 50 2Z',
  ];

  const FARBSCHEMA = {
    klassisch: ['#1f2937', '#d62839', '#1f2937', '#d62839'],
    vier: ['#1f2937', '#d62839', '#15803d', '#1d4ed8'],
  };
  let farben = FARBSCHEMA.klassisch;
  let bild = 'eigen';
  const KLASSISCH_DATEI = 'karten/svg-cards.svg';
  const KLASSISCH_FARBE = ['spade', 'heart', 'club', 'diamond'];
  const KLASSISCH_WERT = ['6', '7', '8', '9', '10', 'jack', 'queen', 'king', '1'];
  // Gemessen (getBBox): Die Karten von SVG-cards liegen bei x 1.25, y −5.01
  // und sind 166.58 × 253.67 gross; eingepasst in unser Feld 100 × 140.
  const KLASSISCH_MASS = 140 / 253.67;
  const KLASSISCH_LAGE = `translate(${((100 - 166.58 * KLASSISCH_MASS) / 2).toFixed(2)} 0) scale(${KLASSISCH_MASS.toFixed(5)}) translate(-1.25 5.01)`;

  function setzeBild(name) { bild = name === 'klassisch' || name === 'foto' ? name : 'eigen'; }
  // Kartenrücken: 'alae' (schwarz mit dem Zeichen von alae.app) oder 'rot'.
  let ruecken = 'alae';
  function setzeRuecken(name) { ruecken = name === 'rot' ? 'rot' : 'alae'; }
  // Das Zeichen von alae.app (zwei Winkel), aus dem Logopaket, Breite 1120.
  const ALAE_ZEICHEN = '<path fill="#ECEDF2" d="M65.03 509.42L294.2 82.33A42.36 42.36 0 0 1 368.85 82.33L483.44 295.87A42.36 42.36 0 0 1 466.14 353.23A42.36 42.36 0 0 1 408.78 335.93L331.53 191.95L139.69 549.47A42.36 42.36 0 0 1 82.33 566.77A42.36 42.36 0 0 1 65.03 509.42Z"/><path fill="#FE7971" d="M521.98 509.42L751.15 82.33A42.36 42.36 0 0 1 825.8 82.33L1054.97 509.42A42.36 42.36 0 0 1 1037.67 566.77A42.36 42.36 0 0 1 980.31 549.47L788.47 191.95L596.63 549.47A42.36 42.36 0 0 1 539.28 566.77A42.36 42.36 0 0 1 521.98 509.42Z"/>';
  function alaeZeichen(cx, cy, breite) {
    const s = breite / 1120;
    return `<g transform="translate(${(cx - 560 * s).toFixed(2)} ${(cy - 324 * s).toFixed(2)}) scale(${s.toFixed(5)})">${ALAE_ZEICHEN}</g>`;
  }

  // Unsere Karten: Fotos, 400 × 625 (Seitenverhältnis wie die echten Karten),
  // im Feld 100 × 140 auf volle Höhe eingepasst.
  const FOTO_FARBE = ['schaufel', 'herz', 'kreuz', 'ecke'];
  const FOTO_WERT = ['6', '7', '8', '9', '10', 'bauer', 'dame', 'koenig', 'ass'];
  const FOTO_B = 140 * 400 / 625;
  const FOTO_X = (100 - FOTO_B) / 2;
  const STERN = (x) => `<g transform="translate(${x} 6)"><circle cx="8" cy="8" r="8" fill="#f59e0b"/><path d="M8 2.5l1.6 3.4 3.7.4-2.8 2.5.8 3.6L8 10.6l-3.3 1.8.8-3.6-2.8-2.5 3.7-.4Z" fill="#fff"/></g>`;

  function svgFoto(k, o) {
    const datei = 'karten/foto/' + FOTO_FARBE[J.farbeVon(k)] + '-' + FOTO_WERT[J.wertVon(k)] + '.webp';
    const titel = J.kartenName(k, o.code);
    const trumpf = o.trumpf
      ? `<rect x="${(FOTO_X + 1.2).toFixed(2)}" y="1.2" width="${(FOTO_B - 2.4).toFixed(2)}" height="137.6" rx="4.5" fill="none" stroke="#f59e0b" stroke-width="3"/>${STERN(FOTO_X + FOTO_B - 21)}`
      : '';
    return `<svg class="karte-svg" viewBox="0 0 100 140" role="img" aria-label="${titel}"><title>${titel}</title><image href="${datei}" x="${FOTO_X.toFixed(2)}" y="0" width="${FOTO_B.toFixed(2)}" height="140" preserveAspectRatio="none"/>${trumpf}</svg>`;
  }

  function setzeFarben(name) {
    farben = FARBSCHEMA[name] || FARBSCHEMA.klassisch;
  }
  function farbeHex(f) { return farben[f]; }

  function zeichenPfad(f, x, y, groesse, gedreht) {
    const s = groesse / 100;
    const t = gedreht
      ? `translate(${x + groesse / 2} ${y + groesse / 2}) rotate(180) translate(${-groesse / 2} ${-groesse / 2}) scale(${s})`
      : `translate(${x} ${y}) scale(${s})`;
    return `<path d="${PFADE[f]}" transform="${t}" fill="${farben[f]}"/>`;
  }

  function zeichen(f, klasse) {
    return `<svg class="${klasse || 'farbzeichen'}" viewBox="0 0 100 100" aria-hidden="true"><path d="${PFADE[f]}" fill="${farben[f]}"/></svg>`;
  }

  // Lage der Zeichen auf den Zahlenkarten (Mittelpunkt), Feld 100 × 140.
  const L = 37, R = 63, M = 50;
  const BILD = {
    0: [[L, 36], [R, 36], [L, 70], [R, 70], [L, 104], [R, 104]],
    1: [[L, 36], [R, 36], [M, 53], [L, 70], [R, 70], [L, 104], [R, 104]],
    2: [[L, 36], [R, 36], [M, 53], [L, 70], [R, 70], [M, 87], [L, 104], [R, 104]],
    3: [[L, 32], [R, 32], [L, 58], [R, 58], [M, 70], [L, 82], [R, 82], [L, 108], [R, 108]],
    4: [[L, 32], [R, 32], [M, 45], [L, 58], [R, 58], [L, 82], [R, 82], [M, 95], [L, 108], [R, 108]],
  };

  const KRONE = 'M10 70L18 30L34 52L50 22L66 52L82 30L90 70Z';
  const HUT = 'M14 66C14 50 30 40 50 40C70 40 86 50 86 66ZM6 66H94V74H6Z';

  function svgKlassisch(k, o) {
    const id = KLASSISCH_FARBE[J.farbeVon(k)] + '_' + KLASSISCH_WERT[J.wertVon(k)];
    const titel = J.kartenName(k, o.code);
    const trumpf = o.trumpf
      ? `<rect x="2" y="1.5" width="96" height="137" rx="7" fill="none" stroke="#f59e0b" stroke-width="3.5"/><g transform="translate(78 6)"><circle cx="8" cy="8" r="8" fill="#f59e0b"/><path d="M8 2.5l1.6 3.4 3.7.4-2.8 2.5.8 3.6L8 10.6l-3.3 1.8.8-3.6-2.8-2.5 3.7-.4Z" fill="#fff"/></g>`
      : '';
    return `<svg class="karte-svg" viewBox="0 0 100 140" role="img" aria-label="${titel}"><title>${titel}</title><use href="${KLASSISCH_DATEI}#${id}" transform="${KLASSISCH_LAGE}"/>${trumpf}</svg>`;
  }

  function svg(k, opt) {
    const o = opt || {};
    if (bild === 'klassisch') return svgKlassisch(k, o);
    if (bild === 'foto') return svgFoto(k, o);
    const f = J.farbeVon(k);
    const w = J.wertVon(k);
    const farbe = farben[f];
    const wert = J.WERTE[w];
    const teile = [];
    teile.push(`<rect x="1.5" y="1.5" width="97" height="137" rx="9" fill="#fffdf8" stroke="${o.trumpf ? '#f59e0b' : '#d6d3d1'}" stroke-width="${o.trumpf ? 3 : 1.5}"/>`);
    // Ecken: Wert und Zeichen.
    const gr = wert === '10' ? 25 : 30;
    teile.push(`<text x="15" y="31" font-size="${gr}" font-weight="800" text-anchor="middle" fill="${farbe}" font-family="Inter, system-ui, sans-serif" letter-spacing="-2">${wert}</text>`);
    teile.push(zeichenPfad(f, 7, 36, 16));
    teile.push(`<g transform="rotate(180 50 70)"><text x="15" y="31" font-size="${gr}" font-weight="800" text-anchor="middle" fill="${farbe}" font-family="Inter, system-ui, sans-serif" letter-spacing="-2">${wert}</text>${zeichenPfad(f, 7, 36, 16)}</g>`);
    if (w <= 4) {
      const g = w >= 3 ? 16 : 18;
      for (const [x, y] of BILD[w]) teile.push(zeichenPfad(f, x - g / 2, y - g / 2, g, y > 70));
    } else if (w === J.WA) {
      teile.push(zeichenPfad(f, 22, 42, 56));
    } else {
      // Bauer, Dame, König: ein Rahmen mit Krone bzw. Hut, Buchstabe, Zeichen.
      teile.push(`<rect x="24" y="24" width="52" height="92" rx="7" fill="${farbe}" fill-opacity="0.08" stroke="${farbe}" stroke-opacity="0.55" stroke-width="1.5"/>`);
      const symbol = w === J.WB ? HUT : KRONE;
      teile.push(`<path d="${symbol}" transform="translate(32 28) scale(0.36)" fill="${farbe}" fill-opacity="${w === J.WD ? 0.6 : 0.85}"/>`);
      if (w === J.WD) teile.push(`<circle cx="50" cy="35" r="3" fill="#fffdf8"/>`);
      teile.push(`<text x="50" y="83" font-size="40" font-weight="800" text-anchor="middle" fill="${farbe}" font-family="Georgia, 'Times New Roman', serif">${wert}</text>`);
      teile.push(zeichenPfad(f, 41, 90, 18));
    }
    if (o.trumpf) {
      teile.push(`<g transform="translate(78 6)"><circle cx="8" cy="8" r="8" fill="#f59e0b"/><path d="M8 2.5l1.6 3.4 3.7.4-2.8 2.5.8 3.6L8 10.6l-3.3 1.8.8-3.6-2.8-2.5 3.7-.4Z" fill="#fff"/></g>`);
    }
    const titel = J.kartenName(k, o.code);
    return `<svg class="karte-svg" viewBox="0 0 100 140" role="img" aria-label="${titel}"><title>${titel}</title>${teile.join('')}</svg>`;
  }

  function rueckseite() {
    if (ruecken === 'alae') {
      const schmalA = bild === 'foto' ? `transform="translate(${FOTO_X.toFixed(2)} 0) scale(${(FOTO_B / 100).toFixed(4)} 1)"` : '';
      return `<svg class="karte-svg" viewBox="0 0 100 140" aria-hidden="true"><g ${schmalA}>
        <rect x="1" y="1" width="98" height="138" rx="9" fill="#0b0c10" stroke="#2a2d36" stroke-width="1.5"/>
        <rect x="6.5" y="6.5" width="87" height="127" rx="6" fill="none" stroke="#FE7971" stroke-opacity=".45" stroke-width="1"/>
        ${alaeZeichen(50, 70, 54)}
      </g></svg>`;
    }
    if (bild === 'klassisch') {
      return `<svg class="karte-svg" viewBox="0 0 100 140" aria-hidden="true"><use href="${KLASSISCH_DATEI}#back" transform="${KLASSISCH_LAGE}" fill="#991b1b"/></svg>`;
    }
    // Bei unseren Karten so schmal wie die Fotos.
    const schmal = bild === 'foto' ? `transform="translate(${FOTO_X.toFixed(2)} 0) scale(${(FOTO_B / 100).toFixed(4)} 1)"` : '';
    return `<svg class="karte-svg" viewBox="0 0 100 140" aria-hidden="true"><g ${schmal}>
      <defs><pattern id="jr" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#7f1d1d"/><rect width="5" height="10" fill="#991b1b"/></pattern></defs>
      <rect x="1.5" y="1.5" width="97" height="137" rx="9" fill="#fffdf8" stroke="#d6d3d1" stroke-width="1.5"/>
      <rect x="7" y="7" width="86" height="126" rx="6" fill="url(#jr)"/>
      <circle cx="50" cy="70" r="17" fill="#fffdf8" fill-opacity="0.92"/>
      <path d="M50 58C55 66 64 68 64 75C64 80 58 82 54 78C55 82 56 84 58 86H42C44 84 45 82 46 78C42 82 36 80 36 75C36 68 45 66 50 58Z" fill="#7f1d1d"/>
    </g></svg>`;
  }

  root.JassKarten = { svg, rueckseite, zeichen, setzeFarben, setzeBild, setzeRuecken, alaeZeichen, farbeHex, FARBSCHEMA };
})(typeof self !== 'undefined' ? self : this);
