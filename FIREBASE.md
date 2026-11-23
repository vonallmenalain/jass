# Firebase: was dahintersteht und was einmal eingerichtet werden muss

Projekt: **`jassen-bc258`**

| Dienst | wofür | Regeln |
|---|---|---|
| Firestore | Turniere (`turnier.html`, `turnier-allgemein.html`) | `firestore.rules`, von Hand in die Console kopiert |
| Realtime Database | Online spielen (`jass-online.html`) | `database.rules.json`, **veröffentlicht die GitHub Action** |
| Authentication (anonym) | damit die Datenbank weiss, wem welcher Platz gehört | – |

Die Realtime Database liegt in Belgien:
`https://jassen-bc258-default-rtdb.europe-west1.firebasedatabase.app`

## Das Online-Spiel in der Realtime Database

Es gibt keinen Server, der mitrechnet. Jedes Gerät spielt die Liste der
Spielzüge mit derselben Engine nach (`jass-protokoll.js`) und kommt so zum
selben Stand.

```
jass/<CODE>/                     CODE: 6 Zeichen, A–Z ohne I/L/O, 2–9
    info        name, host (uid), hostSitz, erstellt, status (lobby · spiel ·
                fertig), spielNr, regeln, tipps, oeffentlich
                lesen: wer angemeldet ist und den Code kennt
                schreiben: der Gastgeber – oder ein Mitspieler, wenn der
                Gastgeber offline ist (Übernahme)
    sitze/<0–3> typ (mensch · schwer; ältere Tische auch leicht · mittel –
                alle Computer spielen heute schwer), uid, name, online, bereit
                Platz nehmen: nur einen freien Menschenplatz, nur für sich
                ändern: der Spieler selbst (online, bereit, Platz verlassen),
                der Gastgeber alles – auch Plätze tauschen
    log/<n>     ein Spielzug, angehängt, nie überschrieben:
                { t:'r', nr, a }           Runde nr, a sagt an (Gastgeber)
                { t:'p', s }               Platz s schiebt
                { t:'a', s, c }            Platz s sagt c an
                { t:'k', s, k, w?, st? }   Platz s legt Karte k
                schreiben: nur für den eigenen Platz; der Gastgeber auch
                für Computer und für Mitspieler, die weg sind
    haende/<s>  { nr, karten }   die Karten von Platz s in Runde nr
                lesen: nur wer auf s sitzt – und der Gastgeber, der austeilt
                schreiben: nur der Gastgeber
    (ganzer Tisch) löschen: nur der Gastgeber («Tisch für alle schliessen»)

offen/<CODE>                     Verzeichnis der öffentlichen Tische
                { name, gastgeber, frei, zeit, regeln }
                lesen: wer angemeldet ist (die Liste «Offene Tische»)
                schreiben: der Gastgeber des Tisches – solange er öffentlich
                ist, in der Lobby wartet und Plätze frei hat. Geht er
                offline, löscht der Server den Eintrag (onDisconnect).
                löschen: auch jeder andere, wenn der Tisch nicht mehr in der
                Lobby ist oder es ihn nicht mehr gibt (Aufräumen)
```

Wer einen Tisch öffentlich macht, zeigt seinen Namen und den des Tisches
allen, die «Online spielen» öffnen.

Was die Regeln **nicht** verhindern: Der Gastgeber teilt aus und kennt darum
alle Karten. Und ein Gerät könnte einen ungültigen Zug in die Liste
schreiben – die App prüft das vor dem Schreiben, die Datenbank prüft nur die
Form. Für Familien- und Freundesrunden ist das in Ordnung. Für Turniere mit
Fremden bräuchte es einen Server, der austeilt (Cloud Functions, nicht im
Gratis-Tarif).

### Gratis-Kontingent (Spark)

| Grenze | Spark | ein Online-Spiel (8 Runden, 4 Geräte) |
|---|---|---|
| Download | 10 GB pro Monat | grob 0.3–0.5 MB → weit über 10'000 Spiele im Monat |
| gleichzeitige Verbindungen | **100** | 1 pro Gerät – Computer zählen nicht |
| Speicher | 1 GB | etwa 20 KB pro Tisch |

Für Turniere ist die Grenze von **100 Geräten gleichzeitig** die, auf die man
achten muss: Das sind 25 Tische mit vier Menschen – oder mehr Tische, wenn
Computer mitspielen. Alte Tische bleiben liegen; bei 20 KB pro Tisch muss
man sie lange nicht aufräumen.

## Die Regeln fahren von selbst nach Firebase

`database.rules.json` im Repository ist die Wahrheit. In der Firebase-Console
wird an den Regeln der Realtime Database **nichts von Hand** geändert.

`.github/workflows/firebase-regeln.yml`:

| wann | was |
|---|---|
| Pull Request | die Regeln im Emulator durchspielen (`werkzeuge/test-regeln.mjs`) |
| Merge nach `main` | nochmals prüfen, dann veröffentlichen – **sofort wirksam** |
| von Hand («Run workflow») | dasselbe, z. B. nach dem Einrichten |

Anders als bei Netlify gibt es hier kein gesperrtes Publishing dazwischen.

### Einzurichten (einmal)

1. **Anonyme Anmeldung einschalten.** Firebase-Console → *Authentication* →
   (beim ersten Mal *Jetzt starten*) → *Anmeldemethode* → *Anonym* →
   aktivieren. Ohne das zeigt «Online spielen» eine Meldung und tut nichts.

2. **Schlüssel holen.** Firebase-Console → *Projekteinstellungen* →
   *Dienstkonten* → *Neuen privaten Schlüssel generieren*. Heraus kommt eine
   JSON-Datei für `firebase-adminsdk-…@jassen-bc258.iam.gserviceaccount.com`.

3. **Diesem Konto zwei Rollen geben.** Google Cloud Console → *IAM und
   Verwaltung* → *IAM* → Projekt **`jassen-bc258`** (auf die ID schauen,
   nicht auf den Namen) → den Eintrag `firebase-adminsdk-…` bearbeiten:
   - `Firebase Realtime Database Admin` (`roles/firebasedatabase.admin`)
   - `Service Usage-Nutzer` (`roles/serviceusage.serviceUsageConsumer`) –
     die Firebase CLI fragt vor dem Deploy nach, ob die API eingeschaltet
     ist, und bricht ohne dieses Recht ab.

4. **GitHub-Umgebung anlegen.** Repository → *Settings* → *Environments* →
   *New environment* → Name **`produktion`** →
   *Deployment branches and tags*: *Selected branches and tags* → `main`.
   Dann in dieser Umgebung *Add environment secret*:
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Wert: der **ganze Inhalt** der JSON-Datei aus Schritt 2, im Klartext
     (nicht base64).

   Der Schlüssel gehört in die Umgebung, nicht zu den Repository-Secrets:
   So bekommt ihn nur ein Lauf auf `main`, nie ein Pull Request.

5. **Einmal veröffentlichen.** *Actions* → *Firebase-Regeln* →
   *Run workflow* (Branch `main`). Danach geht jede Änderung an
   `database.rules.json` mit dem Merge von selbst hinaus.

### Wenn der Deploy scheitert

- *fehlt das Secret FIREBASE_SERVICE_ACCOUNT*: Schritt 4 – liegt es in der
  Umgebung `produktion` (nicht bei den Repository-Secrets)?
- *Der Schlüssel ist kein gültiges JSON … base64*: Den Inhalt der Datei im
  Klartext einfügen.
- *HTTP Error: 403 … serviceusage*: Rolle `Service Usage-Nutzer` fehlt
  (Schritt 3).
- *403 … firebasedatabase* oder *Permission denied* beim Hochladen der Regeln:
  Rolle `Firebase Realtime Database Admin` fehlt (Schritt 3).
- Im Protokoll steht, welches Konto benutzt wurde (`Dienstkonto: …`) – es
  muss zu `jassen-bc258` gehören.

## Selbst testen

Braucht Node 22 und Java 21 (der Emulator ist ein Java-Programm).

```
cd werkzeuge
npm ci
npm run test:regeln    # die Regeln im Emulator, wie in der Action
npm run test:online    # ein ganzes Online-Spiel mit drei Browsern (Playwright)
npm run test:lobby     # offene Tische, privat/öffentlich, Plätze tauschen, Tisch schliessen
```

`test:online` startet einen kleinen Webserver, lädt die Regeln in den
Emulator, lässt Papa einen Tisch eröffnen, Mia und Tim beitreten, und spielt
drei Runden. Nach der ersten verschwindet Tim, und der Computer muss für ihn
einspringen. Screenshots: `werkzeuge/bilder-online/`.

Im Browser lässt sich die Online-Seite gegen die Emulatoren öffnen mit
`jass-online.html?emulator=1` (nur von `localhost`/`127.0.0.1` aus).
