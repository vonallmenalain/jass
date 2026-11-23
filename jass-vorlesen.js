/*
 * jass-vorlesen.js – Texte im Training mit 🔊 vorlesen.
 * ---------------------------------------------------------------------------
 * Jedes Element mit dem Attribut data-vorlesen bekommt einen kleinen
 * Lautsprecher-Knopf. Ein Tipp darauf liest den Text vor – mit den Aufnahmen
 * der Google-Stimme (jass-stimme.js), sonst mit der Stimme des Geräts.
 *
 * Was gesagt wird:
 *   data-sprechen='["Satz eins.", "Satz zwei."]'   genau diese Sätze
 *                                                  (Texte mit Zahlen, siehe
 *                                                  jass-sprechtexte.js)
 *   sonst                                          der sichtbare Text, in
 *                                                  Sätze geteilt
 *   data-vorlesen="vorne"                          Knopf vor den Text statt
 *                                                  dahinter
 *
 * Dieselben Funktionen (textAusHtml, saetze) laufen auch in Node: Das
 * Werkzeug zum Vertonen holt sich damit die festen Texte aus den Seiten
 * (statischeSaetze), damit es genau dieselben Sätze aufnimmt.
 */
(function (root) {
  'use strict';

  const ENTITAETEN = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&apos;': "'" };

  // HTML → Text mit Zeilen: Block-Enden und <br> werden zu Zeilenumbrüchen,
  // Knöpfe, Bilder und Auswahllisten fallen weg.
  function textAusHtml(html) {
    return String(html)
      .replace(/<(script|style|button|svg|select|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|h[1-6]|div|tr|summary|ul|ol|table|strong)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z]+;|&#\d+;/gi, (e) => (e in ENTITAETEN ? ENTITAETEN[e] : ' '));
  }

  // Zeichen, die keine Stimme sagen soll (Emoji, Pfeile, Sterne).
  const BILDZEICHEN = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

  // Text → Liste von Sätzen. Jede Zeile ist mindestens ein Satz; getrennt
  // wird nach . ! ? …, wenn danach ein neuer Satz beginnt.
  function saetze(text) {
    const aus = [];
    for (const zeile of String(text).split('\n')) {
      const z = zeile.replace(BILDZEICHEN, ' ').replace(/\s+/g, ' ').trim();
      if (!z) continue;
      for (const t of z.split(/(?<=[.!?…])\s+(?=[A-ZÄÖÜ0-9«„"(])/)) {
        const s = t.trim();
        if (s && /[A-Za-zÄÖÜäöü0-9]/.test(s)) aus.push(s);
      }
    }
    return aus;
  }

  // Geschrieben «Buur», gesprochen (und aufgenommen) «Puur».
  const sprechform = (satz) => String(satz).replace(/\bBuur\b/g, 'Puur');

  // Die Sätze eines Elements – wie im Browser, so im Werkzeug.
  function sprechliste(el) {
    let liste;
    if (el.dataset && el.dataset.sprechen) {
      try { liste = JSON.parse(el.dataset.sprechen); } catch (e) { liste = []; }
    } else {
      liste = saetze(textAusHtml(el.innerHTML));
    }
    return liste.filter(Boolean).map(sprechform);
  }

  // Für das Werkzeug: alle festen Texte einer HTML-Datei (Elemente mit
  // data-vorlesen ohne data-sprechen, ausserhalb von <script>).
  function statischeSaetze(quelle) {
    const html = String(quelle).replace(/<script\b[\s\S]*?<\/script>/gi, '');
    const aus = [];
    const start = /<([a-z][a-z0-9]*)\b([^>]*\bdata-vorlesen\b[^>]*)>/gi;
    let m;
    while ((m = start.exec(html))) {
      if (/\bdata-sprechen\b/.test(m[2])) continue;
      const tag = m[1].toLowerCase();
      // passendes Ende suchen (gleiche Tags dürfen verschachtelt sein)
      const muster = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
      muster.lastIndex = start.lastIndex;
      let tiefe = 1, ende = -1, t;
      while ((t = muster.exec(html))) {
        tiefe += t[1] ? -1 : 1;
        if (!tiefe) { ende = t.index; break; }
      }
      if (ende < 0) continue;
      saetze(textAusHtml(html.slice(start.lastIndex, ende))).forEach((s) => aus.push(sprechform(s)));
    }
    return aus;
  }

  // ------------------------------------------------------------ Browser

  function knopfFuer(el) {
    const b = root.document.createElement('button');
    b.type = 'button';
    b.className = 'lautsprecher';
    b.dataset.vorlesenKnopf = '';
    b.setAttribute('aria-label', 'Vorlesen');
    b.title = 'Vorlesen';
    b.textContent = '🔊';
    return b;
  }

  function einrichten(wurzel) {
    const w = wurzel || root.document;
    w.querySelectorAll('[data-vorlesen]').forEach((el) => {
      if (el.querySelector(':scope > [data-vorlesen-knopf]')) return;
      const b = knopfFuer(el);
      if (el.dataset.vorlesen === 'vorne') el.insertBefore(b, el.firstChild);
      else el.appendChild(b);
    });
  }

  function starte() {
    const doc = root.document;
    doc.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-vorlesen-knopf]');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      const el = b.closest('[data-vorlesen]');
      if (!el || !root.JassStimme) return;
      root.JassStimme.sage(sprechliste(el));
    }, true);
    einrichten(doc);
    let geplant = false;
    new root.MutationObserver(() => {
      if (geplant) return;
      geplant = true;
      root.requestAnimationFrame(() => { geplant = false; einrichten(doc); });
    }).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-vorlesen'] });
  }

  const api = { textAusHtml, saetze, sprechform, sprechliste, statischeSaetze, einrichten };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.JassVorlesen = api;
    if (root.document) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', starte);
      else starte();
    }
  }
})(typeof self !== 'undefined' ? self : this);
