/*
 * jass-stimme.js – Tipps vorlesen.
 * ---------------------------------------------------------------------------
 * Was gesagt wird, ist eine Liste fester Sätze (JassBot.sprechKarte,
 * sprechGrund, sprechAnsage). Zu jedem Satz gibt es eine Aufnahme mit der
 * Google-Stimme Sulafat (Chirp 3 HD), vorab gemacht von
 * werkzeuge/stimme-google.mjs: stimme/<hash>.mp3, das Verzeichnis steht in
 * jass-stimme-dateien.js (window.JassStimmeDateien).
 *
 * Fehlt auch nur für einen Satz die Aufnahme, liest die Gerätestimme den
 * ganzen Text – lieber eine Stimme als zwei gemischt.
 *
 *   JassStimme.sage(['Spiel das Herz Ass.', 'Bock spielen: …'])
 *   JassStimme.stop()
 */
(function (root) {
  'use strict';

  let audio = null;
  let lauf = 0;

  const dateien = () => root.JassStimmeDateien || {};
  const hatAufnahmen = (teile) => teile.every((t) => dateien()[t]);

  function stop() {
    lauf++;
    if (audio) { audio.pause(); audio.removeAttribute('src'); }
    if (root.speechSynthesis) root.speechSynthesis.cancel();
  }

  function sage(teile, beiEnde) {
    stop();
    const liste = (Array.isArray(teile) ? teile : [teile]).filter(Boolean);
    if (!liste.length) return;
    if (hatAufnahmen(liste)) aufnahmen(liste, beiEnde);
    else geraet(liste.join(' '), beiEnde);
  }

  // Ein einziges Audio-Element für alle Sätze: Auf iOS darf nur abspielen,
  // was einmal durch einen Tipp gestartet wurde – das gilt dann weiter.
  function aufnahmen(liste, beiEnde) {
    const id = lauf;
    if (!audio) audio = new Audio();
    let i = 0;
    const naechster = () => {
      if (id !== lauf) return;
      if (i >= liste.length) { if (beiEnde) beiEnde(); return; }
      audio.src = dateien()[liste[i++]];
      audio.play().catch(() => { if (id === lauf) geraet(liste.slice(i - 1).join(' '), beiEnde); });
    };
    audio.onended = naechster;
    audio.onerror = () => { if (id === lauf) geraet(liste.slice(i - 1).join(' '), beiEnde); };
    naechster();
  }

  function stimmeDesGeraets() {
    const stimmen = root.speechSynthesis ? root.speechSynthesis.getVoices() : [];
    return stimmen.find((v) => /^de-CH/i.test(v.lang)) || stimmen.find((v) => /^de-DE/i.test(v.lang)) || stimmen.find((v) => /^de/i.test(v.lang)) || null;
  }

  function geraet(text, beiEnde) {
    if (!root.speechSynthesis || !root.SpeechSynthesisUtterance) { if (beiEnde) beiEnde(); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/–/g, ','));
    const v = stimmeDesGeraets();
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'de-DE';
    u.rate = 1;
    u.onend = () => { if (beiEnde) beiEnde(); };
    root.speechSynthesis.speak(u);
  }

  // Ein kleiner Lautsprecher-Knopf (HTML), der mit sage() verbunden wird.
  function knopf(titel) {
    return `<button type="button" class="lautsprecher" aria-label="${titel || 'Vorlesen'}" title="${titel || 'Vorlesen'}">🔊</button>`;
  }

  root.JassStimme = { sage, stop, knopf, hatAufnahmen };
})(typeof self !== 'undefined' ? self : this);
