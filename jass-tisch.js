/*
 * jass-tisch.js – Der Spieltisch: Plätze, Stich, Hand, Ansage, Dialoge.
 * ---------------------------------------------------------------------------
 * Gemeinsam für das Spiel gegen den Computer (jass-spiel.html) und das
 * Online-Spiel (jass-online.html). Der Tisch zeigt nur an und meldet, was
 * der Mensch tut – wer wann dran ist, entscheidet die Seite.
 *
 *   const tisch = JassTisch.erstelle(wurzel, {
 *     anzeige,                     // Anzeige-Einstellungen (JassEinstellungen)
 *     beiKarte(k), beiAnsage(code), beiMenu(),
 *     tippKarte() → { karte, grund }       // optional
 *   });
 *   tisch.setze({ spiel, ansichtSitz, spieler, eingabe, tipps });
 *   tisch.zeichne();
 *   await tisch.stichZeigen(eintrag, ms);
 */
(function (root) {
  'use strict';

  const J = root.JassEngine;
  const K = root.JassKarten;
  const B = root.JassBot;

  const STUFEN = { leicht: 'Leicht', mittel: 'Mittel', schwer: 'Schwer' };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function modusHtml(code, mitText) {
    const m = J.MODI[code];
    const zeichen = m.trumpf >= 0 ? K.zeichen(m.trumpf) : `<span>${m.symbol}</span>`;
    return zeichen + (mitText ? `<span>${m.name}</span>` : '');
  }

  const VORLAGE = `
    <div class="kopf">
      <button class="icon-btn" type="button" data-rolle="menu" aria-label="Menü">☰</button>
      <div class="info"><strong data-rolle="runden"></strong><span data-rolle="ansageInfo"></span></div>
      <div data-rolle="trumpf"></div>
    </div>
    <div class="stand">
      <div><span class="name team-a" data-rolle="teamA"></span><span><span class="runde" data-rolle="rundeA"></span> <span class="summe" data-rolle="summeA">0</span></span></div>
      <div><span class="name team-b" data-rolle="teamB"></span><span><span class="runde" data-rolle="rundeB"></span> <span class="summe" data-rolle="summeB">0</span></span></div>
    </div>
    <div class="feld" data-rolle="feld">
      <div class="platz" data-pos="1"></div>
      <div class="platz" data-pos="2"></div>
      <div class="platz" data-pos="3"></div>
      <div class="stich" data-rolle="stich"></div>
      <div class="stich-info" data-rolle="stichInfo" hidden></div>
      <div class="hinweis-feld" data-rolle="hinweis" hidden></div>
      <div class="ansage" data-rolle="ansage" hidden></div>
    </div>
    <div class="hand-bereich">
      <div class="kommentar" data-rolle="kommentar"></div>
      <div class="mein-name" data-rolle="meinName"></div>
      <div class="hand" data-rolle="hand"></div>
      <div class="aktionen">
        <button class="btn-ghost" type="button" data-rolle="tipp">💡 Tipp</button>
        <button class="btn-ghost" type="button" data-rolle="letzter">Letzter Stich</button>
      </div>
    </div>`;

  function erstelle(wurzel, optionen) {
    const o = optionen || {};
    wurzel.classList.add('tisch');
    wurzel.innerHTML = VORLAGE;
    const el = (rolle) => wurzel.querySelector(`[data-rolle="${rolle}"]`);

    // Dialog und Toast gehören zur Seite, nicht in den Tisch.
    let dialog = document.getElementById('jass-dialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.className = 'dialog-hinten';
      dialog.id = 'jass-dialog';
      dialog.innerHTML = '<div class="dialog" role="dialog" aria-modal="true"></div>';
      document.body.appendChild(dialog);
    }
    const dialogInhalt = dialog.firstElementChild;
    let dialogSchliessbar = true;

    let z = { spiel: null, ansichtSitz: 0, spieler: [], eingabe: null, tipps: true };
    let gewaehlt = null;
    let neueKarte = -1;
    let anzeigeStich = null;
    let ueberspringen = null;

    const anzeige = () => o.anzeige || {};
    const pos = (sitz) => (sitz - z.ansichtSitz + 4) % 4;
    const name = (s) => (z.spieler[s] && z.spieler[s].name) || 'Sitz ' + (s + 1);
    const teamName = (t) => name(t) + ' & ' + name(t + 2);
    const istDu = (s) => s === z.ansichtSitz && /^du$/i.test(name(s).trim());
    const vonWem = (s) => (istDu(s) ? 'dir' : name(s));
    const tut = (s, er, du) => name(s) + ' ' + (istDu(s) ? du : er);

    function setze(teil) {
      Object.assign(z, teil);
      if (z.eingabe !== 'karte') gewaehlt = null;
    }

    function zeichne() {
      if (!z.spiel) return;
      zeichneKopf();
      zeichnePlaetze();
      zeichneStich();
      zeichneHand();
      zeichneAnsage();
    }

    function zeichneKopf() {
      const spiel = z.spiel;
      const r = spiel.runde;
      const re = spiel.regeln;
      el('runden').textContent = re.spielende === 'punkte'
        ? 'Runde ' + (spiel.rundeNr + 1) + ' · bis ' + re.zielPunkte
        : 'Runde ' + Math.min(spiel.rundeNr + 1, re.runden) + ' von ' + re.runden;
      if (r.code) {
        const f = re.multiplikatoren ? Number(re.faktoren[r.code]) || 1 : 1;
        el('trumpf').innerHTML = `<span class="trumpf-chip">${modusHtml(r.code, true)}${f > 1 ? ' ×' + f : ''}</span>`;
        el('ansageInfo').textContent = 'angesagt von ' + vonWem(r.angesagtVon) + (r.geschoben ? ' (geschoben von ' + vonWem(r.ansager) + ')' : '');
      } else {
        el('trumpf').innerHTML = '';
        el('ansageInfo').textContent = r.phase === 'ansage' ? tut(J.ansageAmZug(r), 'sagt an', 'sagst an') + (r.geschoben ? ' (geschoben)' : '') : '';
      }
      el('teamA').textContent = teamName(0);
      el('teamB').textContent = teamName(1);
      el('summeA').textContent = spiel.summe[0];
      el('summeB').textContent = spiel.summe[1];
      const imSpiel = r.phase !== 'ansage' && !spiel.fertig;
      const rp = r.code === 'MIS' ? [r.punkte[1], r.punkte[0]] : r.punkte;
      el('rundeA').textContent = imSpiel ? '+' + rp[0] : '';
      el('rundeB').textContent = imSpiel ? '+' + rp[1] : '';
    }

    function amZugSitz() {
      const r = z.spiel.runde;
      if (z.spiel.fertig) return -1;
      if (r.phase === 'ansage') return J.ansageAmZug(r);
      if (r.phase === 'spiel') return r.amZug;
      return -1;
    }

    function zeichnePlaetze() {
      const r = z.spiel.runde;
      const dran = anzeigeStich ? -1 : amZugSitz();
      wurzel.querySelectorAll('.platz').forEach((p) => {
        const lage = Number(p.dataset.pos);
        const s = (z.ansichtSitz + lage) % 4;
        const sp = z.spieler[s] || {};
        const anzahl = r.haende[s].length;
        const rolle = [];
        if (s === r.ansager) rolle.push('Vorhand');
        if (r.code && s === r.angesagtVon) rolle.push('Ansage');
        let typ = sp.typ && sp.typ !== 'mensch' ? ' · ' + STUFEN[sp.typ] : '';
        if (sp.online === false) typ = ' · offline';
        p.className = 'platz team' + (s % 2) + (s === dran ? ' dran' : '') + (sp.online === false ? ' weg' : '');
        p.innerHTML = `<div class="avatar">${escapeHtml(name(s).charAt(0).toUpperCase())}</div>
          <div class="ptext"><div class="pname">${escapeHtml(name(s))}</div>
          <div class="mini-karten">${'<i></i>'.repeat(anzahl)}</div>
          <div class="pinfo">${rolle.join(' · ') || (lage === 2 ? 'Partner' : 'Gegner')}${typ}</div></div>`;
      });
      el('meinName').textContent = name(z.ansichtSitz) + (z.ansichtSitz === r.ansager ? ' · Vorhand' : '') + (r.code && z.ansichtSitz === r.angesagtVon ? ' · Ansage' : '');
    }

    function zeichneStich() {
      const r = z.spiel.runde;
      const st = anzeigeStich || { karten: r.stich, sitze: r.stichSitze };
      const stichEl = el('stich');
      if (stichEl.classList.contains('weg')) {
        stichEl.style.transition = 'none';
        stichEl.classList.remove('weg');
        void stichEl.offsetWidth;
        stichEl.style.transition = '';
      }
      stichEl.innerHTML = st.karten.map((k, i) => {
        const s = st.sitze[i];
        const klassen = ['karte'];
        if (k === neueKarte) klassen.push('neu');
        if (anzeigeStich && s === anzeigeStich.sieger) klassen.push('sieger');
        const trumpf = r.code && J.MODI[r.code].trumpf === J.farbeVon(k);
        return `<div class="${klassen.join(' ')}" data-pos="${pos(s)}">${K.svg(k, { trumpf, code: r.code })}</div>`;
      }).join('');
      neueKarte = -1;
      const info = el('stichInfo');
      if (anzeigeStich) {
        info.hidden = false;
        info.textContent = tut(anzeigeStich.sieger, 'macht', 'machst') + ' den Stich · ' + anzeigeStich.punkte + ' Punkte';
      } else if (r.phase === 'spiel') {
        info.hidden = false;
        let t = 'Stich ' + (r.stichNr + 1) + ' von 9';
        if (r.code === 'SLO' || r.code === 'SLU') t += ' · ' + (J.aktuellerEff(r) === J.EFF_OBE ? 'obenabe' : 'undenufe');
        info.textContent = t;
      } else info.hidden = true;
    }

    function meinKartenZug() {
      const r = z.spiel.runde;
      return z.eingabe === 'karte' && !anzeigeStich && r.phase === 'spiel' && r.amZug === z.ansichtSitz;
    }

    function zeichneHand() {
      const r = z.spiel.runde;
      const roh = r.haende[z.ansichtSitz].filter((k) => k >= 0);
      const hand = J.sortiereHand(roh, r.code);
      const handEl = el('hand');
      const breite = handEl.clientWidth || 320;
      const n = hand.length;
      // Die Karten richten sich nach der Breite – und nach der Höhe, damit
      // im Querformat das Feld nicht verschwindet.
      const quer = window.innerWidth > window.innerHeight && window.innerHeight < 600;
      const nachHoehe = (window.innerHeight * (quer ? 0.26 : 0.19)) / 1.4;
      const kw = Math.min(92, nachHoehe, Math.max(46, breite / (1 + Math.max(n - 1, 1) * 0.6)));
      const schritt = n > 1 ? Math.min(kw * 1.06, (breite - kw) / (n - 1)) : 0;
      const start = (breite - (kw + schritt * (n - 1))) / 2;
      handEl.style.setProperty('--kw', kw + 'px');
      const meinZug = meinKartenZug();
      const erlaubt = meinZug ? J.erlaubteFuer(z.spiel, z.ansichtSitz) : null;
      handEl.classList.toggle('aktiv', meinZug);
      const T = r.code ? J.MODI[r.code].trumpf : -1;
      handEl.innerHTML = hand.map((k, i) => {
        const kl = ['karte'];
        if (meinZug && anzeige().hilfen !== false && !erlaubt.includes(k)) kl.push('gesperrt');
        if (k === gewaehlt) kl.push('gewaehlt');
        return `<button type="button" class="${kl.join(' ')}" data-karte="${k}" style="left:${start + i * schritt}px;z-index:${i + 1}" aria-label="${J.kartenName(k, r.code)}">${K.svg(k, { trumpf: J.farbeVon(k) === T, code: r.code })}</button>`;
      }).join('');
      const tippErlaubt = z.tipps !== false && anzeige().tipps !== false;
      el('tipp').hidden = !tippErlaubt;
      el('tipp').disabled = !(meinZug || z.eingabe === 'ansage');
      el('letzter').disabled = !r.stiche.length;
    }

    function zeichneAnsage() {
      const r = z.spiel.runde;
      const box = el('ansage');
      const aktiv = z.eingabe === 'ansage' && r.phase === 'ansage' && J.ansageAmZug(r) === z.ansichtSitz;
      if (!aktiv) { box.hidden = true; box.dataset.fuer = ''; return; }
      const schluessel = r.nr + '-' + (r.geschoben ? 1 : 0);
      if (!box.hidden && box.dataset.fuer === schluessel) return;
      box.dataset.fuer = schluessel;
      const modi = J.erlaubteModi(z.spiel.regeln);
      const darf = J.darfSchieben(r, z.spiel.regeln);
      const tippErlaubt = z.tipps !== false && anzeige().tipps !== false;
      box.hidden = false;
      box.innerHTML = `<div class="ansage-box">
        <h2>${r.geschoben ? escapeHtml(name(r.ansager)) + ' hat geschoben – du musst ansagen' : 'Was ist Trumpf?'}</h2>
        <div class="tipp-text" data-rolle="ansageTipp"></div>
        <div class="ansage-knoepfe">${modi.map((c) => `<button type="button" data-ansage="${c}">${modusHtml(c, true)}</button>`).join('')}</div>
        <div class="zeile">
          ${darf ? '<button class="btn-ghost btn-klein" type="button" data-ansage="SCHIEBEN">Schieben ↔</button>' : ''}
          ${tippErlaubt ? '<button class="btn-ghost btn-klein" type="button" data-tipp-ansage>💡 Tipp</button>' : ''}
        </div>
      </div>`;
    }

    // ------------------------------------------------------------ Eingaben

    el('hand').addEventListener('click', (e) => {
      const b = e.target.closest('[data-karte]');
      if (!b || !meinKartenZug()) return;
      const k = Number(b.dataset.karte);
      if (!J.erlaubteFuer(z.spiel, z.ansichtSitz).includes(k)) {
        kommentar(escapeHtml(warumNicht(k)));
        return;
      }
      if (!anzeige().einTipp && gewaehlt !== k) {
        gewaehlt = k;
        zeichneHand();
        return;
      }
      gewaehlt = null;
      z.eingabe = null;
      if (o.beiKarte) o.beiKarte(k);
    });

    function warumNicht(k) {
      const r = z.spiel.runde;
      const led = J.farbeVon(r.stich[0]);
      const T = J.trumpfVon(J.aktuellerEff(r));
      const farbe = J.FARBEN[led].name;
      if (led === T) return 'Es wurde Trumpf gespielt – du musst Trumpf angeben.';
      if (J.farbeVon(k) === T) return 'Untertrumpfen ist nicht erlaubt: Dein Trumpf ist tiefer als der im Stich.';
      return 'Es wurde ' + farbe + ' angespielt – du musst ' + farbe + ' angeben' + (T >= 0 ? ' (oder stechen).' : '.');
    }

    el('ansage').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ansage]');
      if (b && z.eingabe === 'ansage') {
        z.eingabe = null;
        el('ansage').hidden = true;
        if (o.beiAnsage) o.beiAnsage(b.dataset.ansage);
        return;
      }
      if (e.target.closest('[data-tipp-ansage]')) tippAnsage();
    });

    function tippAnsage() {
      const r = z.spiel.runde;
      const s = J.ansageAmZug(r);
      const hand = r.haende[s];
      const box = wurzel.querySelector('[data-rolle="ansageTipp"]');
      if (!box) return;
      box.textContent = 'Ich spiele deine Karten durch …';
      const b = B.bewertung(hand, z.spiel.regeln, { geschoben: r.geschoben || !J.darfSchieben(r, z.spiel.regeln) });
      const ziel = B.rechentiefe(anzeige().rechnen).ansage * 2;
      const schritt = () => {
        if (z.eingabe !== 'ansage') return;
        b.schritt(20);
        if (b.gemacht < ziel) { setTimeout(schritt, 0); return; }
        const best = b.ergebnis()[0];
        wurzel.querySelectorAll('[data-ansage]').forEach((x) => x.classList.toggle('empfohlen', x.dataset.ansage === best.code));
        const titel = best.code === 'SCHIEBEN' ? 'Schieben' : J.MODI[best.code].lang;
        box.innerHTML = '<b>' + titel + '</b> – im Schnitt etwa ' + Math.round(best.punkte) + ' Punkte für euch' + (z.spiel.regeln.multiplikatoren ? ' (mit Multiplikator)' : '') + '. ' + escapeHtml(B.faustregel(hand, best.code));
      };
      setTimeout(schritt, 30);
    }

    el('tipp').addEventListener('click', () => {
      if (z.eingabe === 'ansage') { tippAnsage(); return; }
      if (!meinKartenZug()) return;
      const t = o.tippKarte ? o.tippKarte() : B.schwerZug(z.spiel, z.ansichtSitz, B.rechentiefe(anzeige().rechnen));
      if (!t) return;
      gewaehlt = anzeige().einTipp ? null : t.karte;
      zeichneHand();
      const b = el('hand').querySelector(`[data-karte="${t.karte}"]`);
      if (b && anzeige().einTipp) b.classList.add('vorschlag');
      kommentar('💡 <b>' + J.kartenName(t.karte, z.spiel.runde.code) + ':</b> ' + escapeHtml(t.grund));
    });

    el('letzter').addEventListener('click', () => {
      const r = z.spiel.runde;
      const st = r.stiche[r.stiche.length - 1];
      if (!st) return;
      oeffneDialog(`<h2>Letzter Stich</h2>
        <div class="letzter-stich">${st.karten.map((k, i) => `<figure class="${st.sitze[i] === st.sieger ? 'sieger' : ''}"><div class="karte">${K.svg(k, { code: r.code })}</div><figcaption>${escapeHtml(name(st.sitze[i]))}</figcaption></figure>`).join('')}</div>
        <p class="muted" style="text-align:center">${escapeHtml(tut(st.sieger, 'hat', 'hast'))} ihn gemacht · ${st.punkte} Punkte</p>
        <button class="btn btn-voll" type="button" data-schliessen>OK</button>`);
    });

    el('menu').addEventListener('click', () => { if (o.beiMenu) o.beiMenu(); });

    el('feld').addEventListener('click', (e) => {
      if (e.target.closest('.ansage')) return;
      if (ueberspringen && anzeigeStich) ueberspringen();
    });

    window.addEventListener('resize', () => { if (z.spiel && wurzel.offsetParent !== null) zeichneHand(); });

    // ----------------------------------------------------------- Abläufe

    // Wartet ms – und länger, solange ein schliessbarer Dialog (das Menü)
    // offen ist. Mit ueberspringbar endet es auch auf einen Tipp ins Feld.
    function warte(ms, ueberspringbar) {
      return new Promise((res) => {
        const fertig = async () => {
          ueberspringen = null;
          while (menuOffen()) await new Promise((r) => setTimeout(r, 200));
          res();
        };
        const t = setTimeout(fertig, ms);
        if (ueberspringbar) ueberspringen = () => { clearTimeout(t); fertig(); };
      });
    }

    // Zeigt einen fertigen Stich, lässt ihn liegen und räumt ihn zum
    // Gewinner weg.
    async function stichZeigen(eintrag, ms) {
      anzeigeStich = eintrag;
      zeichne();
      await warte(ms, true);
      const stichEl = el('stich');
      stichEl.dataset.ziel = pos(eintrag.sieger);
      stichEl.classList.add('weg');
      await new Promise((r) => setTimeout(r, 420));
      anzeigeStich = null;
      zeichne();
    }

    function kommentar(html) { el('kommentar').innerHTML = html || ''; }
    function hinweis(html) {
      const h = el('hinweis');
      h.hidden = !html;
      h.innerHTML = html || '';
    }

    function blase(sitz, html, dauer) {
      const lagen = [
        { left: '50%', bottom: '14px' },
        { left: 'calc(100% - 70px)', top: 'calc(50% - 62px)' },
        { left: '50%', top: '64px' },
        { left: '70px', top: 'calc(50% - 62px)' },
      ];
      const b = document.createElement('div');
      b.className = 'blase';
      b.innerHTML = html;
      Object.assign(b.style, lagen[pos(sitz)]);
      if (dauer) b.style.animationDuration = dauer + 'ms';
      el('feld').appendChild(b);
      setTimeout(() => b.remove(), dauer || 2600);
    }

    function toast(text) {
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = text;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2800);
    }

    function oeffneDialog(html, schliessbar) {
      dialogSchliessbar = schliessbar !== false;
      dialogInhalt.innerHTML = html;
      dialog.classList.add('offen');
      return dialogInhalt;
    }
    function schliesseDialog() { dialog.classList.remove('offen'); }
    const dialogOffen = () => dialog.classList.contains('offen');
    const menuOffen = () => dialogOffen() && dialogSchliessbar;
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-schliessen]') || (e.target === dialog && dialogSchliessbar)) schliesseDialog();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialogSchliessbar) schliesseDialog(); });

    // ------------------------------------------------------------ Tabellen

    function abrechnungHtml(ab) {
      const zeile = (titel, w, immer) => (immer || w[0] || w[1]) ? `<tr><td>${titel}</td><td>${w[0]}</td><td>${w[1]}</td></tr>` : '';
      return `<table class="tabelle">
        <thead><tr><th></th><th class="team-a">${escapeHtml(teamName(0))}</th><th class="team-b">${escapeHtml(teamName(1))}</th></tr></thead>
        <tbody>
          ${zeile(ab.code === 'MIS' ? 'Stiche (Misère: Punkte der Gegner)' : 'Stiche', ab.stich, true)}
          ${zeile('Weisen', ab.weis)}
          ${zeile('Stöck', ab.stoeck)}
          ${zeile('Matchbonus', ab.match)}
          ${ab.faktor > 1 ? `<tr><td>Multiplikator</td><td>×${ab.faktor}</td><td>×${ab.faktor}</td></tr>` : ''}
        </tbody>
        <tfoot><tr><td>Runde</td><td>${ab.total[0]}</td><td>${ab.total[1]}</td></tr></tfoot>
      </table>`;
    }

    // Die Abrechnung der gerade beendeten Runde, mit dem neuen Total.
    function rundenendeHtml(ab, summeNachher) {
      let titel = J.MODI[ab.code].lang;
      if (ab.matchTeam >= 0 && ab.code !== 'MIS') titel = 'Match für ' + teamName(ab.matchTeam) + '!';
      return `<div class="ergebnis-titel">${escapeHtml(titel)}</div>
        <p class="muted" style="text-align:center">${modusHtml(ab.code, false)} angesagt von ${escapeHtml(vonWem(ab.angesagtVon))}${ab.geschoben ? ' (geschoben)' : ''}</p>
        ${abrechnungHtml(ab)}
        <table class="tabelle"><tfoot><tr><td>Total</td><td class="team-a">${summeNachher[0]}</td><td class="team-b">${summeNachher[1]}</td></tr></tfoot></table>`;
    }

    function verlaufHtml() {
      const spiel = z.spiel;
      return `<table class="tabelle">
        <thead><tr><th>Runde</th><th class="team-a">${escapeHtml(teamName(0))}</th><th class="team-b">${escapeHtml(teamName(1))}</th></tr></thead>
        <tbody>${spiel.runden.map((ab, i) => `<tr><td>${i + 1}. ${modusHtml(ab.code, true)} <span class="muted klein">${escapeHtml(name(ab.angesagtVon))}</span></td><td>${ab.total[0]}</td><td>${ab.total[1]}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Noch keine Runde gespielt.</td></tr>'}</tbody>
        <tfoot><tr><td>Total</td><td>${spiel.summe[0]}</td><td>${spiel.summe[1]}</td></tr></tfoot>
      </table>`;
    }

    function siegerText() {
      const w = z.spiel.sieger;
      return w < 0 ? 'Unentschieden!' : teamName(w) + ' gewinnen!';
    }

    // Weise nach der Ansage als Blasen, die eigenen im Kommentar.
    function zeigeWeise(proSitz) {
      for (let s = 0; s < 4; s++) {
        const w = proSitz[s] || [];
        if (!w.length) continue;
        const summe = w.reduce((a, x) => a + x.punkte, 0);
        setTimeout(() => blase(s, 'Weis ' + summe, 3200), 900 + s * 150);
      }
      const eigene = proSitz[z.ansichtSitz] || [];
      if (eigene.length) kommentar('Dein Weis: ' + eigene.map((w) => escapeHtml(J.weisName(w)) + ' (' + w.punkte + ')').join(', '));
    }

    return {
      setze, zeichne, zeichneHand, stichZeigen, warte, kommentar, hinweis, blase, toast,
      oeffneDialog, schliesseDialog, dialogOffen,
      abrechnungHtml, rundenendeHtml, verlaufHtml, siegerText, zeigeWeise,
      teamName, vonWem, tut, name, modusHtml, escapeHtml,
      neueKarte(k) { neueKarte = k; },
      get zustand() { return z; },
    };
  }

  root.JassTisch = { erstelle, escapeHtml, modusHtml, STUFEN };
})(typeof self !== 'undefined' ? self : this);
