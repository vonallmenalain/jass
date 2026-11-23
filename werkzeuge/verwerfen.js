'use strict';
// Was bringt die Regel «beim Verwerfen die schwächste Farbe»?
//
//   node werkzeuge/verwerfen.js duell 250 [start] [tiefe]
//       Team A: Schwer wie in der App (bei Gleichstand die schwächste
//       Farbe), Team B: Schwer ohne diese Regel. Jede Verteilung zweimal,
//       mit vertauschten Plätzen. Ausgabe: Ø Vorsprung von A pro Runde.
//
//   node werkzeuge/verwerfen.js faelle 150 [start] [tiefe]
//       Spielt Runden mit vier Mal Schwer und schaut bei jedem echten
//       Verwerfen (Farbe nicht da, Gegner vorne, Karten aus mindestens zwei
//       Farben), was die Rechnung über die Karte aus der schwächsten Farbe
//       sagt: wie oft sie auch die beste ist und was sie im Schnitt kostet.
//
// Mehrere Prozesse mit verschiedenem [start] laufen lassen und zusammenzählen.
const J = require('../jass-engine.js');
const B = require('../jass-bot.js');

const [befehl = 'duell', nStr = '100', startStr = '0', tiefe = 'normal'] = process.argv.slice(2);
const N = Number(nStr);
const START = Number(startStr);

function ansagen(spiel, rng) {
  const r = spiel.runde;
  while (r.phase === 'ansage') {
    const s = J.ansageAmZug(r);
    const w = B.waehleAnsage(spiel, s, 'mittel', { rng });
    if (w.code === 'SCHIEBEN') J.schieben(spiel); else J.ansagen(spiel, w.code);
  }
}

if (befehl === 'duell') {
  const mit = B.rechentiefe(tiefe);
  const ohne = Object.assign({}, mit, { verwerfSchwelle: 0 });
  const diffs = [];
  for (let i = START; i < START + N; i++) {
    let d = 0;
    for (const tausch of [false, true]) {
      const spiel = J.neuesSpiel({ runden: 1 }, { seed: 90000 + i });
      const r = spiel.runde;
      const rng = J.zufall(i * 7 + (tausch ? 1 : 0));
      ansagen(spiel, rng);
      while (r.phase === 'spiel') {
        const s = r.amZug;
        const teamA = (s % 2 === 0) !== tausch;
        const z = B.schwerZug(spiel, s, Object.assign({ rng }, teamA ? mit : ohne));
        J.spiele(spiel, s, z.karte);
      }
      const t = r.abrechnung.total;
      const a = tausch ? 1 : 0;
      d += t[a] - t[1 - a];
    }
    diffs.push(d / 2);
  }
  const m = diffs.reduce((x, y) => x + y, 0) / N;
  const sd = Math.sqrt(diffs.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, N - 1));
  console.log(JSON.stringify({ befehl, n: N, start: START, tiefe, vorsprung: +m.toFixed(2), fehler: +(sd / Math.sqrt(N)).toFixed(2) }));
} else if (befehl === 'faelle') {
  const st = { faelle: 0, besteIstSchwach: 0, innerhalbSchwelle: 0, kostenSchwach: 0 };
  for (let i = START; i < START + N; i++) {
    const spiel = J.neuesSpiel({ runden: 1 }, { seed: 70000 + i });
    const r = spiel.runde;
    const rng = J.zufall(i);
    ansagen(spiel, rng);
    while (r.phase === 'spiel') {
      const s = r.amZug;
      // Ohne die Regel rechnen, damit man sieht, was die Statistik allein sagt.
      const z = B.schwerZug(spiel, s, Object.assign({ rng, verwerfSchwelle: 0 }, B.rechentiefe(tiefe)));
      const eff = J.effModus(r.code, r.stichNr);
      const vk = z.werte ? B.verwerfKarte(B.ansichtAus(spiel, s), eff, J.erlaubteFuer(spiel, s)) : null;
      if (vk != null) {
        const T = J.trumpfVon(eff);
        const ohneTrumpf = z.werte.filter((x) => J.farbeVon(x.karte) !== T);
        const best = ohneTrumpf[0];
        const x = z.werte.find((y) => y.karte === vk);
        st.faelle++;
        if (J.farbeVon(best.karte) === J.farbeVon(vk)) st.besteIstSchwach++;
        if (best.wert - x.wert <= 2) st.innerhalbSchwelle++;
        st.kostenSchwach += (best.wert - x.wert) / 2; // in eigenen Punkten
      }
      J.spiele(spiel, s, z.karte);
    }
  }
  console.log(JSON.stringify(st));
} else {
  console.error('Befehle: duell, faelle');
  process.exit(2);
}
