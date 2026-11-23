/*
 * jass-einstellungen.js – Regeln und Anzeige: speichern und einstellen.
 * ---------------------------------------------------------------------------
 * Spiel und Trumpf-Trainer teilen dieselben Regeln (localStorage). Das
 * Formular zeigt alles, was sich am Schieber einstellen lässt.
 */
(function (root) {
  'use strict';

  const J = root.JassEngine;
  const KEY_REGELN = 'jass-lernen-regeln-v1';
  const KEY_ANZEIGE = 'jass-lernen-anzeige-v1';

  const STANDARD_ANZEIGE = {
    tempo: 'normal',      // langsam | normal | schnell
    hilfen: true,         // erlaubte Karten hervorheben
    tipps: true,          // Tipp-Knopf
    erklaeren: true,      // Computer sagen, warum sie so spielen
    farben: 'klassisch',  // klassisch | vier
    einTipp: false,       // Karte mit einem Tipp spielen (sonst: antippen, dann nochmals)
  };

  const VORLAGEN = [
    { id: 'standard', name: 'Standard', text: 'Trumpf, Obenabe, Undenufe · ohne Weisen, Match und Multiplikatoren · 8 Runden', regeln: {} },
    {
      id: 'klassisch', name: 'Klassisch', text: 'Mit Weisen, Stöck, Matchbonus und Multiplikatoren · bis 2500 Punkte',
      regeln: { weisen: true, stoeck: true, matchBonus: true, multiplikatoren: true, spielende: 'punkte', zielPunkte: 2500 },
    },
    {
      id: 'alles', name: 'Alle Ansagen', text: 'Wie Standard, dazu Slalom und Misère',
      regeln: { modi: { T: true, OBE: true, UNE: true, SLO: true, SLU: true, MIS: true } },
    },
  ];

  function lese(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function schreibe(key, wert) {
    try { localStorage.setItem(key, JSON.stringify(wert)); } catch (e) { /* privat oder voll */ }
  }

  function ladeRegeln() { return J.regelnMitStandard(lese(KEY_REGELN) || {}); }
  function speichereRegeln(r) { schreibe(KEY_REGELN, r); }
  function ladeAnzeige() { return Object.assign({}, STANDARD_ANZEIGE, lese(KEY_ANZEIGE) || {}); }
  function speichereAnzeige(a) { schreibe(KEY_ANZEIGE, a); }

  function vorlage(id) {
    const v = VORLAGEN.find((x) => x.id === id) || VORLAGEN[0];
    return J.regelnMitStandard(JSON.parse(JSON.stringify(v.regeln)));
  }

  const MODUS_TEXTE = [
    ['T', 'Trumpf', 'Schaufel, Herz, Kreuz oder Ecke'],
    ['OBE', 'Obenabe', 'Ohne Trumpf, das Ass ist am höchsten'],
    ['UNE', 'Undenufe', 'Ohne Trumpf, die Sechs ist am höchsten'],
    ['SLO', 'Slalom (obenabe beginnt)', 'Jeder Stich wechselt: obenabe, undenufe, obenabe …'],
    ['SLU', 'Slalom (undenufe beginnt)', 'Jeder Stich wechselt: undenufe, obenabe, undenufe …'],
    ['MIS', 'Misère', 'Wie Obenabe, aber man schreibt die Punkte der Gegner – wenig ist gut'],
  ];

  function zusammenfassung(r) {
    const teile = [];
    teile.push(r.spielende === 'punkte' ? 'bis ' + r.zielPunkte : r.runden + ' Runden');
    const modi = MODUS_TEXTE.filter(([g]) => r.modi[g]).map(([, n]) => n.replace(/ \(.*\)/, ''));
    teile.push([...new Set(modi)].join(', '));
    const extra = [];
    if (r.weisen) extra.push('Weisen');
    if (r.stoeck) extra.push('Stöck');
    if (r.matchBonus) extra.push('Match +' + r.matchPunkte);
    if (r.multiplikatoren) extra.push('Multiplikatoren');
    if (!r.schieben) extra.push('ohne Schieben');
    teile.push(extra.length ? extra.join(', ') : 'nur Stichpunkte');
    return teile.join(' · ');
  }

  function setze(obj, pfad, wert) {
    const teile = pfad.split('.');
    let o = obj;
    for (let i = 0; i < teile.length - 1; i++) o = o[teile[i]];
    o[teile[teile.length - 1]] = wert;
  }
  function hole(obj, pfad) {
    return pfad.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function schalter(pfad, titel, text, an) {
    return `<label class="schalter"><span class="text"><span>${titel}</span>${text ? `<small>${text}</small>` : ''}</span><input type="checkbox" data-r="${pfad}" ${an ? 'checked' : ''}></label>`;
  }
  function segmente(pfad, optionen, wert) {
    return `<div class="segmente">${optionen.map(([w, t]) => `<button type="button" data-r="${pfad}" data-wert="${w}" class="${String(wert) === String(w) ? 'aktiv' : ''}">${t}</button>`).join('')}</div>`;
  }
  function zahl(pfad, wert, min, breite) {
    return `<input class="zahl" type="number" inputmode="numeric" min="${min}" step="1" data-r="${pfad}" value="${wert}"${breite ? ` style="width:${breite}px"` : ''}>`;
  }
  function auswahl(pfad, optionen, wert) {
    return `<select class="text-feld" data-r="${pfad}">${optionen.map(([w, t]) => `<option value="${w}" ${String(wert) === String(w) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  }

  // Zeichnet das Regel-Formular in `container`. `regeln` wird direkt
  // verändert; nach jeder Änderung kommt `beiAenderung(regeln)`.
  function regelFormular(container, regeln, beiAenderung, optionen) {
    const o = optionen || {};
    const offen = new Set(o.offen || ['laenge']);

    function zeichne() {
      const r = regeln;
      const html = [];
      if (o.vorlagen !== false) {
        html.push(`<div class="stack" style="gap:8px"><h3>Vorlagen</h3><div class="segmente">${VORLAGEN.map((v) => `<button type="button" data-vorlage="${v.id}" title="${v.text}">${v.name}</button>`).join('')}</div></div>`);
      }
      if (o.laenge !== false) {
        html.push(`<details class="abschnitt" data-abschnitt="laenge" ${offen.has('laenge') ? 'open' : ''}><summary>Spiellänge <small>${r.spielende === 'punkte' ? 'bis ' + r.zielPunkte + ' Punkte' : r.runden + ' Runden'}</small></summary><div class="inhalt">
          ${segmente('spielende', [['runden', 'Anzahl Runden'], ['punkte', 'Zielpunkte']], r.spielende)}
          ${r.spielende === 'punkte'
            ? `<div class="reihe" style="padding-top:8px">${zahl('zielPunkte', r.zielPunkte, 1, 110)}<div class="segmente">${[1000, 1500, 2500, 3000].map((p) => `<button type="button" data-r="zielPunkte" data-wert="${p}" class="${r.zielPunkte === p ? 'aktiv' : ''}">${p}</button>`).join('')}</div></div>
               <p class="muted klein">Gewonnen hat, wer die Punkte zuerst erreicht – gezählt wird Stöck, dann Weis, dann Stich.</p>`
            : `<div class="reihe" style="padding-top:8px">${zahl('runden', r.runden, 1)}<div class="segmente">${[4, 8, 12, 16].map((n) => `<button type="button" data-r="runden" data-wert="${n}" class="${r.runden === n ? 'aktiv' : ''}">${n}</button>`).join('')}</div></div>
               <p class="muted klein">Beliebig viele Runden. Mit 4, 8, 12 … sagt jeder gleich oft an.</p>`}
        </div></details>`);
      }
      const anzahlModi = MODUS_TEXTE.filter(([g]) => r.modi[g]).length;
      html.push(`<details class="abschnitt" data-abschnitt="modi" ${offen.has('modi') ? 'open' : ''}><summary>Ansagen <small>${anzahlModi} von ${MODUS_TEXTE.length}${r.schieben ? ', mit Schieben' : ''}</small></summary><div class="inhalt">
        ${MODUS_TEXTE.map(([g, t, text]) => schalter('modi.' + g, t, text, r.modi[g])).join('')}
        ${schalter('schieben', 'Schieben erlaubt', 'Wer ansagt, darf dem Partner die Wahl überlassen', r.schieben)}
      </div></details>`);
      if (o.zaehlen !== false) {
        html.push(`<details class="abschnitt" data-abschnitt="zaehlen" ${offen.has('zaehlen') ? 'open' : ''}><summary>Punkte zählen <small>${[r.weisen && 'Weisen', r.stoeck && 'Stöck', r.matchBonus && 'Match', r.multiplikatoren && 'Multipl.'].filter(Boolean).join(', ') || 'nur Stiche'}</small></summary><div class="inhalt">
          ${schalter('weisen', 'Weisen', 'Dreiblatt 20, Vierblatt 50, Fünfblatt 100 … · vier Bauern 200, vier Neuner 150, vier Asse/Könige/Damen/Zehner 100 · nur das Team mit dem höchsten Weis schreibt', r.weisen)}
          ${schalter('stoeck', 'Stöck', 'König und Dame im Trumpf auf einer Hand', r.stoeck)}
          ${r.stoeck ? `<div class="reihe" style="padding:0 0 8px">Punkte für Stöck ${zahl('stoeckPunkte', r.stoeckPunkte, 0)}</div>` : ''}
          ${schalter('matchBonus', 'Matchbonus', 'Zusatzpunkte, wenn ein Team alle 9 Stiche macht', r.matchBonus)}
          ${r.matchBonus ? `<div class="reihe" style="padding:0 0 8px">Bonus ${zahl('matchPunkte', r.matchPunkte, 0)} <span class="muted klein">(Match = 157 + Bonus)</span></div>` : ''}
          <div class="schalter"><span class="text"><span>Letzter Stich</span><small>Zusatzpunkte für den neunten Stich</small></span>${zahl('letzterStich', r.letzterStich, 0, 70)}</div>
          ${schalter('multiplikatoren', 'Multiplikatoren', 'Je nach Ansage zählt die Runde mehrfach', r.multiplikatoren)}
          ${r.multiplikatoren ? `<div class="faktoren">${J.MODUS_REIHENFOLGE.filter((c) => r.modi[J.MODI[c].gruppe]).map((c) => `<label>${J.MODI[c].name} × ${zahl('faktoren.' + c, r.faktoren[c], 1)}</label>`).join('')}</div>` : ''}
        </div></details>`);
      }
      html.push(`<details class="abschnitt" data-abschnitt="regeln" ${offen.has('regeln') ? 'open' : ''}><summary>Spielregeln im Detail</summary><div class="inhalt">
        ${schalter('untertrumpfen', 'Untertrumpfen erlaubt', 'Aus: Hat schon jemand gestochen, darf man keinen tieferen Trumpf geben – ausser man hat nur noch Trümpfe', r.untertrumpfen)}
        ${schalter('puurFrei', 'Puur muss nicht angegeben werden', 'Wird Trumpf gespielt und man hat nur noch den Bauer, darf man ihn behalten', r.puurFrei)}
        <div class="schalter" style="cursor:default"><span class="text"><span>Erste Ansage</span><small>Wer in der ersten Runde Trumpf macht. Danach geht es reihum.</small></span></div>
        ${auswahl('ersterAnsager', [['ecke7', 'Wer die Ecken-7 hat'], ['zufall', 'Zufällig'], ['sitz0', 'Der Spieler unten (Du)']], r.ersterAnsager)}
        <div class="schalter" style="cursor:default"><span class="text"><span>Ausspielen nach dem Schieben</span><small>Wer den ersten Stich anspielt, wenn geschoben wurde</small></span></div>
        ${auswahl('ausspiel', [['vorhand', 'Wer geschoben hat (Vorhand)'], ['ansager', 'Wer Trumpf gemacht hat']], r.ausspiel)}
      </div></details>`);
      container.innerHTML = html.join('');
    }

    function geaendert(neuZeichnen) {
      if (!MODUS_TEXTE.some(([g]) => regeln.modi[g])) regeln.modi.T = true;
      if (neuZeichnen) zeichne();
      beiAenderung(regeln);
    }

    container.addEventListener('toggle', (e) => {
      const d = e.target.closest && e.target.closest('details[data-abschnitt]');
      if (!d) return;
      if (d.open) offen.add(d.dataset.abschnitt); else offen.delete(d.dataset.abschnitt);
    }, true);

    container.addEventListener('click', (e) => {
      const v = e.target.closest('[data-vorlage]');
      if (v) {
        const neu = vorlage(v.dataset.vorlage);
        for (const k of Object.keys(regeln)) delete regeln[k];
        Object.assign(regeln, neu);
        geaendert(true);
        if (o.beiVorlage) o.beiVorlage(v.dataset.vorlage);
        return;
      }
      const b = e.target.closest('button[data-r]');
      if (!b) return;
      const alt = hole(regeln, b.dataset.r);
      const wert = typeof alt === 'number' ? Number(b.dataset.wert) : b.dataset.wert;
      setze(regeln, b.dataset.r, wert);
      geaendert(true);
    });

    container.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.dataset || !el.dataset.r) return;
      if (el.type === 'checkbox') setze(regeln, el.dataset.r, el.checked);
      else if (el.type === 'number') {
        const min = Number(el.min || 0);
        let n = Math.floor(Number(el.value));
        if (!Number.isFinite(n) || n < min) n = Math.max(min, hole(regeln, el.dataset.r) || min);
        setze(regeln, el.dataset.r, n);
      } else setze(regeln, el.dataset.r, el.value);
      geaendert(true);
    });

    container.addEventListener('input', (e) => {
      const el = e.target;
      if (el.type !== 'number' || !el.dataset.r) return;
      const n = Math.floor(Number(el.value));
      if (Number.isFinite(n) && n >= Number(el.min || 0)) {
        setze(regeln, el.dataset.r, n);
        beiAenderung(regeln);
      }
    });

    zeichne();
    return { neuZeichnen: zeichne };
  }

  function anzeigeFormular(container, anzeige, beiAenderung, optionen) {
    const o = optionen || {};
    function zeichne() {
      const a = anzeige;
      container.innerHTML = `
        ${o.tempo !== false ? `<div class="stack" style="gap:8px;padding:6px 0 10px"><span>Tempo der Computer</span>${segmente('tempo', [['langsam', 'Langsam'], ['normal', 'Normal'], ['schnell', 'Schnell']], a.tempo)}</div>` : ''}
        <div class="stack" style="gap:8px;padding:6px 0 10px"><span>Kartenfarben</span>${segmente('farben', [['klassisch', 'Rot & Schwarz'], ['vier', 'Vier Farben']], a.farben)}<small class="muted klein">Vier Farben: Kreuz grün, Ecke blau – leichter zu unterscheiden.</small></div>
        ${o.spiel !== false ? `
        ${schalter('hilfen', 'Erlaubte Karten hervorheben', 'Karten, die du nicht spielen darfst, werden abgedunkelt', a.hilfen)}
        ${schalter('tipps', 'Tipp-Knopf', 'Der Computer schlägt dir eine Karte oder Ansage vor und sagt warum', a.tipps)}
        ${schalter('erklaeren', 'Computer erklären ihre Züge', 'Unter dem Tisch steht, warum der Computer so gespielt hat', a.erklaeren)}
        ${schalter('einTipp', 'Mit einem Tipp spielen', 'Aus: Karte antippen hebt sie an, nochmals tippen spielt sie', a.einTipp)}` : ''}`;
    }
    container.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]');
      if (!b) return;
      anzeige[b.dataset.r] = b.dataset.wert;
      zeichne();
      beiAenderung(anzeige);
    });
    container.addEventListener('change', (e) => {
      const el = e.target;
      if (el.type !== 'checkbox' || !el.dataset.r) return;
      anzeige[el.dataset.r] = el.checked;
      beiAenderung(anzeige);
    });
    zeichne();
  }

  root.JassEinstellungen = {
    ladeRegeln, speichereRegeln, ladeAnzeige, speichereAnzeige, vorlage, VORLAGEN, STANDARD_ANZEIGE,
    regelFormular, anzeigeFormular, zusammenfassung, lese, schreibe,
  };
})(typeof self !== 'undefined' ? self : this);
