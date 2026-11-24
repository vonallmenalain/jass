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
    gedanken: false,      // alle Gedanken und Stiche anzeigen (im Training immer an)
    farben: 'klassisch',  // immer Rot & Schwarz (die Auswahl «Vier Farben» gibt es nicht mehr)
    einTipp: false,       // Karte mit einem Tipp spielen (sonst: antippen, dann nochmals)
    rechnen: 'maximal',   // Rechentiefe der Computer, Tipps und Trainer: «maximal» = 1000 Verteilungen (JassBot.RECHENTIEFE)
    kartenbild: 'foto',   // foto (unsere Karten) | eigen | klassisch (SVG-cards) – karten/README.md
    stichWarten: true,    // gegen den Computer: der volle Stich bleibt liegen, bis man tippt
    austeilen: true,      // das Austeilen zeigen (Karten fliegen zu den Plätzen)
    teppich: 'alae',      // Jassteppich: gruen | ecken | trumpf | alae | kreuz (jass-tisch.js TEPPICHE)
    ruecken: 'alae',      // Kartenrücken: alae (schwarz mit Logo) | rot
    klang: 'papier',      // Töne am Tisch: aus | papier | holz | weich (jass-toene.js)
    lautstaerke: 45,      // 0..100
    stand: 2,             // Version der gespeicherten Anzeige (für Umstellungen)
  };

  // Kartenbild, Rücken und Töne gleich anwenden.
  function wende(a) {
    if (root.JassKarten && root.JassKarten.setzeBild) root.JassKarten.setzeBild(a.kartenbild);
    if (root.JassKarten && root.JassKarten.setzeRuecken) root.JassKarten.setzeRuecken(a.ruecken);
    if (root.JassToene) root.JassToene.setze({ klang: a.klang, lautstaerke: a.lautstaerke });
  }

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
  function ladeAnzeige() {
    const gespeichert = lese(KEY_ANZEIGE) || {};
    const a = Object.assign({}, STANDARD_ANZEIGE, gespeichert);
    a.farben = 'klassisch';
    // Stand 2: «Maximal» ist neu Standard – auch für alle, die noch den
    // alten Standard («Normal») gespeichert haben.
    if ((gespeichert.stand || 1) < 2) {
      if (!gespeichert.rechnen || gespeichert.rechnen === 'normal') a.rechnen = 'maximal';
      a.stand = 2;
      if (Object.keys(gespeichert).length) speichereAnzeige(a);
    }
    wende(a);
    return a;
  }
  function speichereAnzeige(a) { schreibe(KEY_ANZEIGE, a); }

  function vorlage(id) {
    const v = VORLAGEN.find((x) => x.id === id) || VORLAGEN[0];
    return J.regelnMitStandard(JSON.parse(JSON.stringify(v.regeln)));
  }

  const MODUS_TEXTE = [
    ['T', 'Trumpf', ''],
    ['OBE', 'Obenabe', ''],
    ['UNE', 'Undenufe', ''],
    ['SLO', 'Slalom (obenabe beginnt)', ''],
    ['SLU', 'Slalom (undenufe beginnt)', ''],
    ['MIS', 'Misère', 'Wenig Punkte ist gut'],
  ];

  function zusammenfassung(r) {
    const teile = [];
    teile.push(r.spielende === 'punkte' ? 'bis ' + r.zielPunkte : r.runden + (r.runden === 1 ? ' Runde' : ' Runden'));
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
            ? `<div class="reihe" style="padding-top:8px">${zahl('zielPunkte', r.zielPunkte, 1, 110)}<div class="segmente">${[1000, 1500, 2500, 3000].map((p) => `<button type="button" data-r="zielPunkte" data-wert="${p}" class="${r.zielPunkte === p ? 'aktiv' : ''}">${p}</button>`).join('')}</div></div>`
            : `<div class="reihe" style="padding-top:8px">${zahl('runden', r.runden, 1)}<div class="segmente">${[4, 8, 12, 16].map((n) => `<button type="button" data-r="runden" data-wert="${n}" class="${r.runden === n ? 'aktiv' : ''}">${n}</button>`).join('')}</div></div>`}
        </div></details>`);
      }
      const anzahlModi = MODUS_TEXTE.filter(([g]) => r.modi[g]).length;
      html.push(`<details class="abschnitt" data-abschnitt="modi" ${offen.has('modi') ? 'open' : ''}><summary>Ansagen <small>${anzahlModi} von ${MODUS_TEXTE.length}${r.schieben ? ', mit Schieben' : ''}</small></summary><div class="inhalt">
        ${MODUS_TEXTE.map(([g, t, text]) => schalter('modi.' + g, t, text, r.modi[g])).join('')}
        ${schalter('schieben', 'Schieben erlaubt', '', r.schieben)}
      </div></details>`);
      if (o.zaehlen !== false) {
        html.push(`<details class="abschnitt" data-abschnitt="zaehlen" ${offen.has('zaehlen') ? 'open' : ''}><summary>Punkte zählen <small>${[r.weisen && 'Weisen', r.stoeck && 'Stöck', r.matchBonus && 'Match', r.multiplikatoren && 'Multipl.'].filter(Boolean).join(', ') || 'nur Stiche'}</small></summary><div class="inhalt">
          ${schalter('weisen', 'Weisen', '', r.weisen)}
          ${schalter('stoeck', 'Stöck', '', r.stoeck)}
          ${r.stoeck ? `<div class="reihe" style="padding:0 0 8px">Punkte für Stöck ${zahl('stoeckPunkte', r.stoeckPunkte, 0)}</div>` : ''}
          ${schalter('matchBonus', 'Matchbonus', '', r.matchBonus)}
          ${r.matchBonus ? `<div class="reihe" style="padding:0 0 8px">Bonus ${zahl('matchPunkte', r.matchPunkte, 0)}</div>` : ''}
          <div class="schalter"><span class="text"><span>Letzter Stich</span></span>${zahl('letzterStich', r.letzterStich, 0, 70)}</div>
          ${schalter('multiplikatoren', 'Multiplikatoren', '', r.multiplikatoren)}
          ${r.multiplikatoren ? `<div class="faktoren">${J.MODUS_REIHENFOLGE.filter((c) => r.modi[J.MODI[c].gruppe]).map((c) => `<label>${J.MODI[c].name} × ${zahl('faktoren.' + c, r.faktoren[c], 1)}</label>`).join('')}</div>` : ''}
        </div></details>`);
      }
      html.push(`<details class="abschnitt" data-abschnitt="regeln" ${offen.has('regeln') ? 'open' : ''}><summary>Spielregeln im Detail</summary><div class="inhalt">
        ${schalter('untertrumpfen', 'Untertrumpfen erlaubt', '', r.untertrumpfen)}
        ${schalter('puurFrei', 'Buur muss nicht angegeben werden', '', r.puurFrei)}
        <div class="schalter" style="cursor:default"><span class="text"><span>Erste Ansage</span></span></div>
        ${auswahl('ersterAnsager', [['ecke7', 'Wer die Ecken-7 hat'], ['zufall', 'Zufällig'], ['sitz0', 'Der Spieler unten (Du)']], r.ersterAnsager)}
        <div class="schalter" style="cursor:default"><span class="text"><span>Ausspielen nach dem Schieben</span></span></div>
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
        ${o.rechnen !== false ? `<div class="stack" style="gap:8px;padding:6px 0 10px"><span>Rechentiefe</span>${segmente('rechnen', [['schnell', 'Schnell'], ['normal', 'Normal'], ['gruendlich', 'Gründlich'], ['maximal', 'Maximal']], a.rechnen)}<small class="muted klein">120 · 300 · 600 · 1000 durchgespielte Verteilungen</small></div>` : ''}
        <div class="stack" style="gap:8px;padding:6px 0 10px"><span>Kartenbild</span>${segmente('kartenbild', [['foto', 'Unsere Karten'], ['eigen', 'Jass-App'], ['klassisch', 'Klassisch']], a.kartenbild)}</div>
        <div class="stack" style="gap:8px;padding:6px 0 10px"><span>Kartenrücken</span>${segmente('ruecken', [['alae', 'alae.app'], ['rot', 'Rot']], a.ruecken)}</div>
        ${o.spiel !== false ? `<div class="stack" style="gap:8px;padding:6px 0 10px"><span>Jassteppich</span>${segmente('teppich', [['gruen', 'Grün'], ['ecken', 'Vier Farben'], ['trumpf', 'Trumpf'], ['alae', 'alae.app'], ['kreuz', 'Schweiz']], a.teppich)}</div>
        <div class="stack" style="gap:8px;padding:6px 0 10px"><span>Töne am Tisch</span>${segmente('klang', (root.JassToene ? root.JassToene.KLAENGE : [['aus', 'Aus']]), a.klang)}
          <div class="reihe" style="gap:10px;align-items:center"><span class="muted klein">Leise</span><input type="range" min="0" max="100" step="5" value="${Number(a.lautstaerke) || 0}" data-r="lautstaerke" aria-label="Lautstärke" style="flex:1"><span class="muted klein">Laut</span>
          <button class="btn-ghost btn-klein" type="button" data-probe>▶ Probe</button></div></div>` : ''}
        ${o.spiel !== false ? `
        ${schalter('hilfen', 'Erlaubte Karten hervorheben', '', a.hilfen)}
        ${o.tipps !== false ? schalter('tipps', 'Tipp-Knopf', '', a.tipps) : ''}
        ${schalter('austeilen', 'Austeilen zeigen', '', a.austeilen)}
        ${o.stichWarten !== false ? schalter('stichWarten', 'Stich liegen lassen, bis ich tippe', '', a.stichWarten) : ''}
        ${schalter('gedanken', 'Alle Gedanken und Stiche anzeigen', 'Im Training immer an', a.gedanken)}
        ${schalter('einTipp', 'Karte mit einem Tipp spielen', '', a.einTipp)}` : ''}`;
    }
    container.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]');
      if (!b) {
        if (e.target.closest('[data-probe]') && root.JassToene) { wende(anzeige); root.JassToene.probe(anzeige.klang === 'aus' ? 'papier' : anzeige.klang); }
        return;
      }
      anzeige[b.dataset.r] = b.dataset.wert;
      wende(anzeige);
      if (b.dataset.r === 'klang' && root.JassToene && b.dataset.wert !== 'aus') root.JassToene.probe(b.dataset.wert);
      zeichne();
      beiAenderung(anzeige);
    });
    container.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.dataset.r) return;
      if (el.type === 'checkbox') anzeige[el.dataset.r] = el.checked;
      else if (el.type === 'range') { anzeige[el.dataset.r] = Number(el.value); wende(anzeige); if (root.JassToene) root.JassToene.karte(0); }
      else return;
      beiAenderung(anzeige);
    });
    zeichne();
  }

  root.JassEinstellungen = {
    ladeRegeln, speichereRegeln, ladeAnzeige, speichereAnzeige, vorlage, VORLAGEN, STANDARD_ANZEIGE,
    regelFormular, anzeigeFormular, zusammenfassung, lese, schreibe, wende,
  };
})(typeof self !== 'undefined' ? self : this);
