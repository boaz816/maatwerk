# Maatwerk — afspraken voor iedereen die eraan bouwt

Maatwerk is een muziek-oefengame in de browser: **gewone HTML/CSS/JS, geen framework, geen build-stap,
geen npm.** Klassieke `<script>`-bestanden die één globale `App` delen. De app moet ook werken als je
`index.html` direct opent (file://), dus **geen ES-modules, geen fetch van lokale bestanden**.
Testen: `python3 -m http.server 5183` in deze map en open `http://localhost:5183`.

Alle tekst die de gebruiker ziet is **Nederlands**: kort, helder, je-vorm, geen vakjargon zonder
uitleg. Commentaar in de code ook Nederlands; namen in code Engels.

## Mappen en wie wat bezit

| Bestand | Eigenaar | Mag jij het wijzigen? |
|---|---|---|
| `index.html`, `css/base.css`, `js/core/*.js` | basis | **Nee.** Mis je iets? Meld het in je eindverslag (`coreRequests`). |
| `js/modes/<id>.js` + `css/modes/<id>.css` | één bouwer per id | Alleen je eigen twee bestanden. |
| `docs/CONTRACT.md` | basis | Nee. |

De bestanden zijn al aangesloten in `index.html`. Ids: `ritme`, `gehoor`, `bpm`, `maatsoort`,
`statistieken`, `instellingen`.

Schrijf je JS in een IIFE: `(function () { ... })();` — geen globale variabelen behalve `App`.
CSS in `css/modes/<id>.css` **altijd scopen** onder `.view[data-mode="<id>"]` zodat je niemand
anders raakt. Prefix eigen klassen met een kort voorvoegsel (bijv. `.rt-` voor ritme, `.gh-`, `.bp-`, `.ms-`, `.st-`, `.in-`).

## Een pagina aanmelden

```js
App.registerMode({
  id: "ritme",
  title: "Ritme",              // kop, tabtitel
  nav: "Ritme",                // label in het menu (optioneel)
  description: "…",            // tekst op de startkaart (optioneel)
  mount(root) {                // root = <main class="view" data-mode="ritme">
    // bouw de pagina in root
    return () => { /* opruimen: listeners weg, timers weg */ };
  },
});
```

Bij elke paginawissel roept de schil eerst `App.audio.stopAll()` aan en daarna jouw opruimfunctie.
**Verplicht:** alle `window`/`document`-listeners, `setInterval`, `setTimeout` en
`requestAnimationFrame` die je start, ruim je daar op. Sneltoetsen alleen actief zolang jouw pagina
er staat, en niet als de focus in een `<input>` staat (behalve waar dat de bedoeling is).

## Basis-API (lees de bronbestanden voor details)

### `App.ui` (js/core/ui.js)
- `h(tag, attrs, ...kinderen)` — element maken. `attrs`: `class`, `style` (object, ook `--var`),
  `onClick`/`onKeydown`/… (functies), `dataset`, `text`, `html`, overige attributen. Kinderen mogen
  strings, nodes, arrays of `null` zijn. `svg(tag, attrs, ...)` idem voor SVG.
- `icon(naam, size)` — lijn-iconen: home, ritme, gehoor, bpm, maatsoort, statistieken, instellingen,
  play, stop, pause, replay, check, x, back, next, volume, download, upload, trash, info, target,
  clock, flame, trophy, headphones, keyboard, plus, minus. **Geen emoji als icoon.**
- `segmented({options, value, onChange, ariaLabel, block})` — één keuze uit een rij. `el.value`.
- `chips({options, value: [], onChange, min})` — meerdere keuzes. `el.value` (array).
- `stepper({value, min, max, step, unit, format, onChange, ariaLabel})` — plus/min-teller. `el.value`.
- `slider({value, min, max, step, onInput, ariaLabel})`, `toggle({checked, label, onChange})`.
- `field(label, control, hint)` — label + bediening + hint.
- `pageHead({eyebrow, title, lead, back})` — paginakop (met terug-naar-start-link).
- `stat(waarde, label, eenheid)`, `scoreRing(score, label)`.
- `toast(tekst, 'ok'|'bad')`, `confirm({title, text, ok, cancel, danger})` → `Promise<boolean>`.
- Opmaak: `fmtMs(ms)` → "+12 ms" / "−8 ms", `fmtSigned(n, decimalen)`, `fmtDuration(ms)`,
  `fmtDate(ts, metTijd)`, `fmtPct(fractie)`.

### `App.audio` (js/core/audio.js)
- `await App.audio.ready()` — **altijd aanroepen in de klik-handler van je startknop** (browser-regel).
- Losse geluiden op een exacte AudioContext-tijd `t` (seconden):
  `click(t, {accent, voice: 'click'|'wood'|'beep', level})`,
  `drum(t, 'kick'|'snare'|'hat'|'openhat'|'rim'|'clap', {level})`,
  `note(t, midi, {dur, level})` (pianoachtig; midi 60 = C4).
- `sequence(events, {lead, startTime, tail, onEvent})` — **de manier om iets af te spelen.**
  `events = [{t, kind: 'click'|'drum'|'note'|'mark', ...}]` met `t` in seconden vanaf de start.
  Geeft `{startTime, endTime, stop(), done}`; `done` is een Promise die afgaat als het klaar of gestopt is
  (`{completed}`). `startTime` is de exacte AudioContext-tijd van `t = 0`. `onEvent(ev, audioTime)`
  komt rond het moment dat je het event hoort — gebruik het voor beeld (een oplichtende tel), **niet**
  voor de timing-meting.
- `stopAll()`, `now()`, `setVolume(0..1)`, `outputLatency()`.
- **Timing van een klik/toets meten:** `App.audio.offsetMs(event, geplandeAudioTijd)` → ms, `+` = te laat,
  `−` = te vroeg. Dit rekent de vertraging van het geluid én de kalibratie uit Instellingen
  (`latencyMs`) mee. `rawOffsetMs(event, t)` doet hetzelfde zonder kalibratie (alleen voor het
  kalibreren zelf). Gebruik het **echte** event-object (`keydown`/`pointerdown`), want de meting gebruikt
  `event.timeStamp`. Gebruik `pointerdown`, niet `click` (dat komt pas bij loslaten).

### `App.music` (js/core/audio.js)
- `noteName(toonklasse, stijl)` — stijl `'auto'` (volgt instelling `noteNames`), `'sharp'`, `'flat'`, `'nl'`.
- `midiLabel(midi)` → "A4", `midiToFreq`, `pc(midi)` (0–11), `octave(midi)`, `isBlack(pc)`.

### `App.store` (js/core/store.js)
- `addSession(record)` — bewaar een afgeronde sessie (vult `id`, `ts`, `version` aan).
- `sessions(mode?)` — sessies oudste eerst. `deleteSession(id)`, `clearSessions(mode?)`.
- `getSetting(key, fallback)`, `setSetting(key, value)`.
- `modeSettings(mode, defaults)` / `saveModeSettings(mode, settings)` — laatst gekozen instellingen per oefening onthouden.
- `exportJSON()`, `importJSON(tekst)` → aantal nieuwe sessies, `subscribe(fn)` → stopfunctie.

Bekende instellingen: `volume` (0–1, standaard 0.8), `latencyMs` (getal, standaard 0),
`noteNames` (`'sharp'` | `'flat'` | `'nl'`, standaard `'sharp'`).

### Overig
- `App.navigate(route)` — `''` = start, `'statistieken'`, enz.
- `App.dayStreak(sessies)` — dagen op rij geoefend.

## Sessie-records (de statistiekenpagina leest precies dit)

Bewaar **één record per afgeronde sessie**, alleen als de gebruiker hem afmaakt (een sessie die je
halverwege stopt niet bewaren). Gemeenschappelijke velden:

```js
{
  id, ts, version,         // door de store
  mode: "ritme",           // id van de oefening
  durationMs: 61234,       // hoe lang de sessie duurde (van start tot klaar)
  score: 0..100,           // afgerond getal, regels hieronder
  settings: { ... },       // wat de gebruiker instelde
  stats: { ... },          // samenvatting, zodat statistieken niet alles opnieuw hoeft te rekenen
  // plus 'hits' of 'rounds' (per oefening, hieronder)
}
```

### ritme
```js
settings: {
  pattern: "achtsten",       // id uit de patroonbibliotheek, of "eigen"
  patternName: "Achtsten",   // leesbare naam
  steps: [1,0,1,0, ...],     // het ritme als raster (zie ritme-spec), voor 'eigen' belangrijk
  stepsPerBeat: 4,           // rasterverdeling per tel (4 = zestienden, 3 = triolen)
  beatsPerBar: 4,
  bpm: 100,
  introBars: 2,
  playBars: 4,
  guide: "metronoom"         // wat je hoort tijdens het meeklikken: "ritme" | "metronoom" | "stil"
},
hits: [                      // één per verwachte noot in het meeklikdeel, op volgorde
  { i: 0, bar: 0, step: 0, expectedMs: 0, offsetMs: -12.4 }   // offsetMs: null = gemist
],
extras: 3,                   // klikken die bij geen noot hoorden
stats: {
  expected: 32, matched: 30, missed: 2, extras: 3,
  meanAbsMs: 18.2,           // gemiddelde |afwijking| van de geraakte noten
  meanMs: 6.1,               // gemiddelde afwijking met teken: + = je zit gemiddeld te laat
  stdMs: 14.0,               // spreiding (hoe constant je bent)
  medianAbsMs: 15.0,
  earlyPct: 0.4, latePct: 0.6   // aandeel van de geraakte noten dat te vroeg / te laat was (0 telt niet mee)
}
```
**Score ritme:** per verwachte noot `noteScore = geraakt ? clamp(1 − (|afwijking| − 10) / 90, 0, 1) : 0`
(≤ 10 ms = perfect, ≥ 100 ms = 0). `score = round(clamp(100 × gemiddelde(noteScore) − 2 × extras, 0, 100))`.

### gehoor
```js
variant: "absoluut" | "relatief",
settings: { lowMidi: 48, highMidi: 72, rounds: 20, pitchClasses: [0..11],  // welke noten mee mogen doen
            reference: "elke-ronde" | "eenmalig",   // alleen relatief
            referenceMidi: 60 },                   // alleen relatief; null bij "willekeurig" (staat dan per ronde)
rounds: [ { target: 64, answerPc: 4, correct: true, referenceMidi: 60 /* of null */, timeMs: 2300, replays: 0 } ],
stats: { total: 20, correct: 15, accuracy: 0.75, meanTimeMs: 2600,
         semitoneErrors: { "1": 2, "-1": 1, "5": 1 } }  // afstand (antwoord − doel, −5..+6) bij fouten
```
**Score gehoor:** `round(accuracy × 100)`.

### bpm
```js
settings: { minBpm: 60, maxBpm: 180, rounds: 10, sound: "click" | "wood" | "drums", beats: 8 },
rounds: [ { actual: 112, guess: 108, diff: -4, pctErr: 3.57, replays: 1, timeMs: 5200 } ],  // diff = guess − actual
stats: { meanAbsDiff: 4.2, meanDiff: -1.3, meanPctErr: 3.6, within2: 0.3, within5: 0.7 }
```
**Score bpm:** per ronde `max(0, 100 − 10 × pctErr)`, score = afgerond gemiddelde.

### maatsoort
```js
settings: { signatures: ["3/4","4/4","6/8"], difficulty: "makkelijk"|"gemiddeld"|"moeilijk", rounds: 10 },
rounds: [ { actual: "6/8", answer: "3/4", correct: false, bpm: 96, replays: 0, timeMs: 4100 } ],
stats: { total: 10, correct: 7, accuracy: 0.7 }
```
**Score maatsoort:** `round(accuracy × 100)`.

## Vormgeving (kort; zie `design-system/maatwerk/MASTER.md`)

- Donker, rustig, studio-gevoel. **Gebruik de tokens en klassen uit `css/base.css`** (`.panel`,
  `.btn`, `.btn-primary`, `.seg`, `.chip`, `.stepper`, `.stat`, `.badge`, `.kbd`, `.empty`, `.grid-2`…).
  Geen eigen kleuren buiten de tokens. `var(--mode)` is de kleur van de huidige oefening.
- Betekeniskleuren: `--ok` raak/goed, `--early` te vroeg, `--late` te laat, `--bad` fout/gemist.
  **Nooit alleen kleur:** zet er altijd een teken, woord of icoon bij ("+12 ms te laat").
- Cijfers in `var(--mono)` met `tabular-nums` (klasse `.num`).
- Klikdoelen minstens 44×44 px. Zichtbare focus. Werkt met toetsenbord.
- Werkt van 375 px (telefoon) tot breed scherm; geen horizontale scrollbalk.
- Beweging 150–300 ms, betekenisvol, en `prefers-reduced-motion` wordt al in base.css afgevangen.
- Paginaopbouw: `pageHead` → instellingenpaneel → grote startknop → speelscherm → resultaatscherm met
  score, kerncijfers en knoppen "Nog een keer" / "Andere instellingen" / "Naar statistieken".
  Wissel tussen deze drie staten (instellen → spelen → resultaat) binnen dezelfde pagina.

## Aanvullingen na de eerste bouwronde

Basis (nieuw beschikbaar):
- `App.setPlaying(true|false)` — zet de speelstand; op een telefoon verdwijnt dan de onderbalk. Roep hem
  aan bij het begin en einde van spelen. De schil zet hem bij elke paginawissel terug op `false`.
- `App.ui.fmtNum(n, decimalen)` — getal met Nederlandse komma ("4,2"). `fmtSigned` gebruikt nu ook een komma.
- `App.ui.confirm` zet bij `danger` de focus op Annuleren, houdt de focus in het venster, sluit als "nee"
  bij een paginawissel en geeft de focus terug. Zelf focus terugzetten is niet meer nodig.
- `App.audio.previewVolume(v)` — volume alleen hoorbaar aanpassen (tijdens schuiven); `setVolume` bewaart.
- `App.audio.ensure()` zet op iPhone/iPad zelf `navigator.audioSession.type = 'playback'`.
- `App.store.deleteSessions(ids | fn)` — veel sessies in één keer verwijderen. `importJSON` weigert records
  zonder geldige `mode`/`ts` en gooit een fout als opslaan mislukt.
- `base.css`: `[hidden]` verbergt altijd; `.seg button`, `.chip`, schuif en terug-link zijn 44 px hoog;
  `--bottom-nav-h` is de hoogte van de mobiele onderbalk (0 op breed en tijdens spelen).
- Statistieken en Instellingen hebben als `--mode` nu de neutrale `--c-stats` (wit), niet meer paars.

Diepe link naar statistieken: de knop "Naar statistieken" roept `App.navigate('statistieken/<id>')` aan
(bijv. `statistieken/ritme`). De statistiekenpagina opent dan die oefening.

Instellingen-sleutels van de statistiekenpagina (niet hergebruiken): `stats.tab`, `stats.gehoorVariant`,
`stats.range`, `stats.seenTs`.

Verduidelijkingen per record:
- **ritme:** `stats.meanAbsMs`, `meanMs`, `stdMs`, `medianAbsMs` zijn `null` als er geen enkele noot geraakt is.
  `hits[].bar` telt vanaf de eerste meeklikmaat (0, zonder intro); `hits[].expectedMs` is in ms vanaf het
  begin van het meeklikdeel.
- **gehoor:** extra velden in `settings`: `range` ("1"|"2"|"3"), `notes` ("alle"|"wit"|"eigen"),
  `referenceMode` ("vast"|"willekeurig", alleen relatief), `wipe` (boolean, alleen absoluut).
  `rounds[].timeMs` = ms vanaf de aanslag van de doelnoot (eerste keer) tot je antwoord.
  Een doelnoot kan één octaaf buiten `lowMidi..highMidi` liggen als de enige noot van die toonklasse in het
  bereik de vaste referentie zelf is.
- **maatsoort:** extra in `stats`: `perSignature` (`{"6/8": {total, correct}}`), `confusions`
  (`{"6/8": {"3/4": 2}}`), `meanTimeMs`, `replays`; per ronde ook `grouping` en `startBeat`.
- **bpm:** extra velden: `settings.tapHelp` (boolean), `rounds[].tapBpm` (getal of `null`, alleen met tik-hulp),
  `stats.replays` (totaal) en `stats.meanTimeMs`. De sessie wordt bewaard zodra de laatste schatting is gegeven.
- **gehoor:** `settings.referenceMidi` is bij "willekeurig" altijd `null`, ook bij referentie "eenmalig".
- Testhulp: records van `App.dev.seedStats(n)` hebben `demo: true`; `App.dev.clearSeed()` verwijdert alleen die.
- `App.store.addSession` geeft `null` terug als opslaan mislukte (de sessie is dan niet bewaard).

## Online en als app (30 okt 2026)

Maatwerk staat online op **https://boaz816.github.io/maatwerk/**. Elke push naar `main` zet de nieuwe
versie daar binnen een paar minuten neer (`.github/workflows/online.yml`). Lokaal verandert er niets:
`index.html` los openen en `python3 -m http.server 5183` werken zoals altijd.

- `tools/bouw-site.sh <map>` kopieert de app naar een nieuwe map en vult de versie (korte commit) in:
  `<meta name="maatwerk-version">` in index.html, `VERSIE` en `BESTANDEN` in sw.js, en `version.json`.
  Nieuwe bestanden in `css/`, `js/` en `icons/` gaan vanzelf mee. Een nieuw bestand of een nieuwe map in de
  hoofdmap moet je in de `cp`-regel van dat script zetten.
- `sw.js` (service worker): de app start altijd uit één complete, bewaarde versie (snel, en ook zonder
  internet). Een nieuwe versie haalt hij in één keer binnen (alles of niets) en die neemt het pas over als
  alles binnen is. `version.json` gaat altijd langs de server en wordt nooit bewaard.
- `js/core/pwa.js`: registreert sw.js en kijkt bij openen, bij terugkomen in de app en elk halfuur in
  `version.json`. Is die anders dan de eigen versie, dan verschijnt bovenaan een balk "Bijwerken": die wacht
  tot de nieuwe versie binnen is en herlaadt dan. De balk komt niet tijdens de speelstand en is dan ook
  verborgen. Doet niets bij `file://` of bij versie `dev` (lokaal). Dit is de enige `fetch` van een eigen
  bestand, en alleen online. `App.version` geeft de versie.
- `manifest.webmanifest` en `icons/` maken het een app voor het beginscherm. De iconen komen van het logo
  (vier balkjes); ze zijn gemaakt met een los Python-script, geen bronbestand nodig.
- Gegevens blijven per apparaat en per adres in `localStorage`. Op iPhone heeft de app op het beginscherm
  een eigen opslag, los van Safari.
