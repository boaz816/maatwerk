/* Maatwerk — Maatsoort-trainer.
   Je hoort een paar maten ritme (metronoom of drumgroove) en kiest de maatsoort.
   Staten binnen deze pagina: instellen → spelen (luisteren → feedback) → resultaat.
   Elk fragment wordt in één App.audio.sequence ingepland; alle tijden in seconden vanaf t = 0. */
(function () {
  "use strict";
  const App = window.App;
  const MODE = "maatsoort";

  /* ====================================================================
     Muziektheorie
     ==================================================================== */

  const ORDER = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8"];
  const WORDS = ["nul", "één", "twee", "drie", "vier", "vijf", "zes", "zeven", "acht", "negen", "tien", "elf", "twaalf"];
  const word = (n) => WORDS[n] || String(n);

  /* Alles wordt in achtsten gerekend.
     kind:      'simple'   = tel is een kwart, verdeeld in twee achtsten (2/4, 3/4, 4/4, 5/4)
                'compound' = tel is een gepunteerde kwart, verdeeld in drie achtsten (6/8, 9/8, 12/8)
                'mixed'    = ongelijke tellen van twee en drie achtsten (7/8)
     beatCount: aantal tellen per maat (zoals een muzikant ze voelt)
     tempo:     [min, max] bpm van de tel waarin je het tempo noemt
                (kwart bij simple en 7/8, gepunteerde kwart bij compound). De bereiken overlappen in
                achtsten per minuut, zodat het tempo alleen de maatsoort niet verraadt.
     variants:  mogelijke groeperingen. beats = lengte van elke tel in achtsten;
                secondary = index van tellen met een middelsterk accent (zoals tel 3 in 4/4);
                hardOnly = alleen op Moeilijk. */
  const SIGS = {
    "2/4": { kind: "simple", beatCount: 2, tempo: [80, 126], variants: [{ label: "", beats: [2, 2], secondary: [] }] },
    "3/4": { kind: "simple", beatCount: 3, tempo: [84, 138], variants: [{ label: "", beats: [2, 2, 2], secondary: [] }] },
    "4/4": { kind: "simple", beatCount: 4, tempo: [80, 126], variants: [{ label: "", beats: [2, 2, 2, 2], secondary: [2] }] },
    "5/4": {
      kind: "simple", beatCount: 5, tempo: [88, 132],
      variants: [
        { label: "3+2", beats: [2, 2, 2, 2, 2], secondary: [3] },
        { label: "2+3", beats: [2, 2, 2, 2, 2], secondary: [2] },
      ],
    },
    "6/8": { kind: "compound", beatCount: 2, tempo: [56, 88], variants: [{ label: "", beats: [3, 3], secondary: [] }] },
    "7/8": {
      kind: "mixed", beatCount: 3, tempo: [90, 130],
      variants: [
        { label: "2+2+3", beats: [2, 2, 3], secondary: [] },
        { label: "3+2+2", beats: [3, 2, 2], secondary: [], hardOnly: true },
        { label: "2+3+2", beats: [2, 3, 2], secondary: [], hardOnly: true },
      ],
    },
    "9/8": { kind: "compound", beatCount: 3, tempo: [56, 84], variants: [{ label: "", beats: [3, 3, 3], secondary: [] }] },
    "12/8": { kind: "compound", beatCount: 4, tempo: [58, 84], variants: [{ label: "", beats: [3, 3, 3, 3], secondary: [2] }] },
  };
  ORDER.forEach((k) => {
    const s = SIGS[k];
    const [num, den] = k.split("/").map(Number);
    s.key = k;
    s.num = num;
    s.den = den;
    s.eighths = s.variants[0].beats.reduce((a, b) => a + b, 0);
    s.sub = s.kind === "simple" ? 2 : s.kind === "compound" ? 3 : 0; // 0 = gemengd
  });

  const TIPS = {
    "2/4": "Sterk, zwak, sterk, zwak: het gevoel van een mars.",
    "3/4": "Het walsgevoel: één sterke tel en twee lichtere. Tel 1-2-3.",
    "4/4": "De maat van de meeste pop en rock: kick op 1 en rond tel 3, snare op 2 en 4.",
    "5/4": "Een groep van drie en een groep van twee tellen, zoals in Take Five. Het kan ook andersom: 2 + 3.",
    "6/8": "Wiegend: twee grote tellen die elk in drieën gaan.",
    "7/8": "Voelt alsof er een stukje mist: twee korte tellen en één lange. Op Moeilijk staat de lange tel soms vooraan of in het midden.",
    "9/8": "Drie grote tellen die elk in drieën gaan.",
    "12/8": "Vier grote tellen in drieën: het shuffle- en bluesgevoel.",
  };

  const LEVELS = [
    { value: "makkelijk", label: "Makkelijk", desc: "Een metronoom met een duidelijk accent op tel 1 en zachtere tikken op de andere tellen." },
    { value: "gemiddeld", label: "Gemiddeld", desc: "Een drumgroove met bas, zonder metronoom. Kick en bas vallen op tel 1; snare en hihat laten de rest van de maat horen." },
    { value: "moeilijk", label: "Moeilijk", desc: "Een levendige groove met fills en een zachtere tel 1. Het fragment begint niet altijd op tel 1." },
  ];
  const levelLabel = (v) => (LEVELS.find((l) => l.value === v) || LEVELS[0]).label;

  /* Accentniveau per achtste: 3 = tel 1, 2 = middelsterk (bv. tel 3 in 4/4), 1 = begin van een tel, 0 = onderverdeling. */
  function levelsOf(variant) {
    const lv = [];
    variant.beats.forEach((len, bi) => {
      lv.push(bi === 0 ? 3 : variant.secondary.includes(bi) ? 2 : 1);
      for (let k = 1; k < len; k++) lv.push(0);
    });
    return lv;
  }

  /* Posities (in achtsten) waar een tel begint. */
  function beatStarts(variant) {
    const out = [];
    let p = 0;
    variant.beats.forEach((len) => { out.push(p); p += len; });
    return out;
  }

  const spaced = (label) => label.split("+").join(" + ");

  /* Korte beschrijving van de verdeling: "twee groepen van drie achtsten". */
  function describe(key, variant) {
    const v = variant || SIGS[key].variants[0];
    switch (key) {
      case "2/4": return "twee tellen van twee achtsten";
      case "3/4": return "drie tellen van twee achtsten";
      case "4/4": return "vier tellen van twee achtsten";
      case "5/4": return `vijf tellen van twee achtsten, in groepen van ${spaced(v.label)} tellen`;
      case "6/8": return "twee groepen van drie achtsten";
      case "7/8": return `zeven achtsten in groepen van ${spaced(v.label)}`;
      case "9/8": return "drie groepen van drie achtsten";
      case "12/8": return "vier groepen van drie achtsten";
      default: return "";
    }
  }

  /* Wat je telt onder de noten: "1 en 2 en" bij kwart-tellen, "1 2 3 4 5 6" bij achtsten-groepen. */
  function countLabels(key, variant) {
    const out = [];
    if (SIGS[key].kind === "simple") {
      variant.beats.forEach((len, bi) => {
        out.push(String(bi + 1));
        for (let k = 1; k < len; k++) out.push("en");
      });
    } else {
      for (let i = 0; i < SIGS[key].eighths; i++) out.push(String(i + 1));
    }
    return out;
  }

  function tempoText(frag) {
    const unit = SIGS[frag.key].kind === "compound" ? "per gepunteerde kwart" : "per kwart";
    return `${frag.bpm} bpm ${unit}`;
  }

  /* Waar een fragment begon, in dezelfde woorden als de telling onder het raster:
     kwartmaten tellen in tellen ("tel 3"), de andere maten in achtsten ("achtste 4 (het begin van groep 2)"). */
  function startText(key, variant, offset) {
    const beat = beatStarts(variant).indexOf(offset) + 1;
    if (SIGS[key].kind === "simple") return `tel ${beat}`;
    return `achtste ${offset + 1} (het begin van groep ${beat})`;
  }

  /* ---------- Waarom leek het op jouw antwoord? ---------- */
  const WHY = {
    "2/4|3/4": "Allebei tellen van twee achtsten. Het verschil is hoe vaak de sterke tel terugkomt: om de twee tellen (2/4) of om de drie (3/4).",
    "2/4|4/4": "4/4 klinkt bijna als twee maten 2/4 achter elkaar. Het verschil zit in tel 3: in 4/4 is die lichter dan tel 1, in 2/4 begint daar een nieuwe maat met een volle tel 1.",
    "2/4|5/4": "5/4 bevat een groep van twee tellen, en die klinkt als 2/4. Maar de andere groep heeft drie tellen.",
    "2/4|6/8": "Allebei twee tellen per maat. Bij 2/4 gaat elke tel in twee achtsten, bij 6/8 in drie. Tel de tikken binnen één tel: twee of drie?",
    "3/4|4/4": "Allebei tellen van twee achtsten. Tel vanaf een sterke tel tot de volgende: drie tellen (3/4) of vier (4/4)?",
    "3/4|5/4": "5/4 is een groep van drie tellen plus een groep van twee. Het stuk van drie klinkt als 3/4; let op het korte stuk erna.",
    "3/4|6/8": "Allebei zes achtsten per maat. 3/4 deelt ze in drie tellen van twee, 6/8 in twee groepen van drie. In achtsten geteld: 3/4 legt de nadruk op 1, 3 en 5, 6/8 op 1 en 4.",
    "3/4|7/8": "Allebei drie tellen, maar in 7/8 is één tel een achtste langer. Daardoor hapert de maat even; in 3/4 lopen alle tellen gelijk door.",
    "3/4|9/8": "Allebei drie tellen per maat. Bij 3/4 gaat elke tel in twee achtsten, bij 9/8 in drie.",
    "4/4|5/4": "Bij 5/4 komt er na vier tellen nog één tel bij voordat tel 1 terugkomt. Tel door tot de volgende sterke tel.",
    "4/4|6/8": "6/8 heeft twee tellen die elk in drieën gaan, 4/4 vier tellen die in tweeën gaan. Tel de tikken binnen één tel: twee of drie?",
    "4/4|7/8": "7/8 is precies één achtste korter dan 4/4. Die achtste ontbreekt in één van de tellen, waardoor de maat net iets struikelt.",
    "4/4|12/8": "Allebei vier tellen per maat. Bij 4/4 gaat elke tel in twee achtsten, bij 12/8 in drie: het shuffle-gevoel.",
    "5/4|7/8": "Allebei oneven en ongelijk gegroepeerd. Maar 5/4 telt vijf kwarten (tien achtsten), 7/8 maar zeven achtsten: een stuk korter.",
    "6/8|7/8": "7/8 heeft één achtste meer dan 6/8, en groepen van twee én drie in plaats van alleen drieën.",
    "6/8|9/8": "Allebei groepen van drie achtsten. Tel de groepen tot de sterke tel terugkomt: twee (6/8) of drie (9/8)?",
    "6/8|12/8": "12/8 klinkt bijna als twee maten 6/8 achter elkaar. Het verschil: in 12/8 is de derde groep lichter dan de eerste, in 6/8 begint daar een nieuwe maat.",
    "7/8|9/8": "Allebei drie tellen, maar in 9/8 zijn ze gelijk (drie keer drie achtsten). In 7/8 zijn twee tellen korter: ze hebben maar twee achtsten.",
    "9/8|12/8": "Allebei groepen van drie achtsten. Tel de groepen: drie (9/8) of vier (12/8)?",
  };

  function pairKey(a, b) {
    return ORDER.indexOf(a) < ORDER.indexOf(b) ? a + "|" + b : b + "|" + a;
  }

  function subText(sig) {
    return sig.sub === 2 ? "twee achtsten" : sig.sub === 3 ? "drie achtsten" : "twee of drie achtsten";
  }

  /* Eén of twee zinnen die uitleggen waarom 'answer' op 'actual' leek. */
  function whyText(actual, answer, variant) {
    if (actual === answer) return "";
    const fixed = WHY[pairKey(actual, answer)];
    if (fixed) return fixed;
    const A = SIGS[actual];
    const B = SIGS[answer];
    if (A.eighths === B.eighths) {
      return `Allebei ${word(A.eighths)} achtsten per maat; alleen de verdeling in tellen verschilt.`;
    }
    if (A.beatCount === B.beatCount) {
      return `Allebei ${word(A.beatCount)} tellen per maat, maar bij ${actual} gaat een tel in ${subText(A)} en bij ${answer} in ${subText(B)}.`;
    }
    if (A.sub && A.sub === B.sub) {
      return `Allebei tellen van ${subText(A)}. Het verschil is het aantal tellen per maat: ${word(A.beatCount)} bij ${actual}, ${word(B.beatCount)} bij ${answer}.`;
    }
    return `${actual} heeft ${describe(actual, variant)}; ${answer} heeft ${describe(answer)}. Tel de achtsten van de ene tel 1 tot de volgende: ${word(A.eighths)} bij ${actual}, ${word(B.eighths)} bij ${answer}.`;
  }

  /* ====================================================================
     Fragmenten maken (zuivere logica, zonder DOM)
     ==================================================================== */

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const chance = (p) => Math.random() < p;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* Metronoomtik op een achtste, sterkte volgens het accentniveau. */
  function clickHit(bar, pos, level) {
    return {
      bar, pos, frac: 0, kind: "click", accent: level === 3,
      level: level === 3 ? 1 : level === 2 ? 0.95 : level === 1 ? 0.8 : 0.32,
    };
  }

  /* Skelet van de groove: waar kick en snare (of clap/rim) vallen, in achtsten binnen de maat.
     4/4 en 12/8 krijgen een kickpatroon dat halverwege de maat níet herhaalt. Anders klinkt één maat 4/4
     precies als twee maten 2/4 (en 12/8 als twee maten 6/8) en is het verschil niet te horen. */
  function backbone(key, variant) {
    const starts = beatStarts(variant);
    switch (key) {
      // Rock/pop: kick op 1 en op 3-en (soms ook op 3), backbeat op 2 en 4
      case "4/4": return { kick: pick([[0, 5], [0, 4, 5]]), snare: [2, 6] };
      // Slow blues: kick op 1, een aanloop naar tel 3 of een tik na tel 3, backbeat op 2 en 4
      case "12/8": return { kick: pick([[0, 5, 6], [0, 6, 8]]), snare: [3, 9] };
      case "5/4":
        // Groep van drie tellen: K . S — groep van twee tellen: K S
        return variant.label === "3+2" ? { kick: [0, 6], snare: [4, 8] } : { kick: [0, 4], snare: [2, 8] };
      default:
        // 2/4, 3/4, 6/8, 7/8, 9/8: kick op tel 1, snare op het begin van elke andere tel/groep
        return { kick: [0], snare: starts.slice(1) };
    }
  }

  /* Sterkte van de kick. Tel 1 ligt duidelijk boven de andere kicks (±6 dB), op Moeilijk ook,
     al is tel 1 daar zachter dan op Gemiddeld. Zo hoor je waar de maat begint en niet alleen de tel. */
  const KICK = {
    gemiddeld: { one: 1, other: 0.5, ghost: [0.42, 0.48] },
    moeilijk: { one: 0.78, other: 0.39, ghost: [0.28, 0.4] },
  };

  /* Drumgroove voor Gemiddeld en Moeilijk. Geeft een lijst 'hits' {bar, pos, frac, sound, level}. */
  function grooveHits(key, variant, { genBars, bars, hard }) {
    const sig = SIGS[key];
    const lv = levelsOf(variant);
    const n = lv.length;
    const starts = beatStarts(variant);
    const offbeats = lv.map((l, p) => (l === 0 ? p : -1)).filter((p) => p >= 0);
    const bb = backbone(key, variant);
    const kick = hard ? KICK.moeilijk : KICK.gemiddeld;
    const back = hard ? pick(["snare", "snare", "clap", "rim"]) : pick(["snare", "snare", "clap"]);
    const backLevel = back === "rim" ? 1 : back === "clap" ? 0.9 : 0.82;
    const hits = [];
    const add = (bar, pos, sound, level, extra) =>
      hits.push(Object.assign({ bar, pos, frac: 0, kind: "drum", sound, level }, extra));

    // Moeilijk: een fill (meestal aan het eind, bij lange fragmenten soms ook na een frase van vier maten),
    // en soms een maat zonder kick op tel 1
    const fillBars = new Set();
    let fillStart = n;
    if (hard) {
      fillBars.add(chance(0.65) ? bars - 1 : randInt(1, Math.max(1, bars - 2)));
      for (let b = 3; b < bars - 1; b += 4) if (chance(0.5)) fillBars.add(b);
      const fillBeats = sig.kind === "simple" && starts.length >= 4 ? 2 : 1;
      fillStart = starts[starts.length - fillBeats];
    }
    let dropBar = hard && chance(0.6) ? randInt(1, genBars - 1) : -1;
    if (fillBars.has(dropBar - 1)) dropBar = -1; // na een fill komt er een crash op 1: die maat houdt zijn kick

    for (let b = 0; b < genBars; b++) {
      const isFill = fillBars.has(b);
      const afterFill = fillBars.has(b - 1);
      const inFill = (p) => isFill && p >= fillStart;
      const openAt = (!hard && b === bars - 1 && chance(0.5)) || (hard && chance(0.2)) ? n - 1 : -1;

      // Hihat op elke achtste; accent op het begin van de tellen (op Moeilijk bijna vlak).
      // Na een fill vervangt de crash de hihat op tel 1.
      for (let p = 0; p < n; p++) {
        if (inFill(p) || (afterFill && p === 0)) continue;
        const l = lv[p];
        const level = hard ? (l >= 1 ? 0.5 : 0.44) : l === 3 ? 0.62 : l >= 1 ? 0.54 : 0.34;
        if (p === openAt) add(b, p, "openhat", level * 0.8);
        else add(b, p, "hat", level);
      }
      // Kick en backbeat. De kick op tel 1 krijgt geen willekeurige sterkte: die moet altijd de zwaarste zijn.
      bb.kick.forEach((p) => {
        if (inFill(p) || (p === 0 && b === dropBar)) return;
        if (p === 0) add(b, p, "kick", kick.one, { steady: true });
        else add(b, p, "kick", kick.other);
      });
      bb.snare.forEach((p) => { if (!inFill(p)) add(b, p, back, backLevel); });

      // Variatie op lichte achtsten (nooit op een telbegin, zodat de maat zelf niet verschuift)
      const free = offbeats.filter((p) => !inFill(p) && !bb.kick.includes(p) && !bb.snare.includes(p));
      if (free.length) {
        if (!hard) {
          if (b % 2 === 1 && chance(0.5)) add(b, pick(free), "kick", rand(kick.ghost[0], kick.ghost[1]));
          if (chance(0.25)) add(b, pick(free), "snare", 0.17);
        } else {
          // Hooguit één extra kick per achtste: twee kicks op één plek klinken samen harder dan tel 1
          const spots = free.slice();
          const ghostKick = () => {
            const pos = spots.splice(Math.floor(Math.random() * spots.length), 1)[0];
            add(b, pos, "kick", rand(kick.ghost[0], kick.ghost[1]));
          };
          if (chance(0.55)) ghostKick();
          if (spots.length && chance(0.25)) ghostKick();
          if (chance(0.5)) add(b, pick(free), "snare", rand(0.14, 0.22));
        }
      }

      // Fill: snare op elke achtste van de laatste tel(len), aanzwellend; in kwartmaten met zestienden op het eind
      if (isFill) {
        const len = n - fillStart;
        for (let p = fillStart; p < n; p++) {
          const k = p - fillStart;
          const level = 0.45 + 0.5 * (k / Math.max(1, len - 1));
          add(b, p, "snare", level);
          if (sig.kind === "simple" && p >= n - 2) add(b, p, "snare", level * 0.8, { frac: 0.5 });
        }
        if (chance(0.5)) add(b, fillStart, "kick", kick.other);
        if (b + 1 < genBars) add(b + 1, 0, "openhat", 0.55); // 'crash' op de volgende tel 1
      }
    }
    return hits;
  }

  /* Baslijn voor Gemiddeld en Moeilijk: op elke tel 1 een nieuwe grondtoon, zoals een akkoordwissel in
     een echt nummer. Zo hoor je waar de maat begint en hoe lang hij duurt, ook als de drums twijfel laten.
     Op Moeilijk soms een korte aanloopnoot op de laatste tel, naar de volgende grondtoon toe. */
  const PROGRESSIONS = [[0, 5, 7, 5], [0, -5, -3, -7], [0, -2, -4, -5], [0, 3, 5, 7]]; // halve tonen vanaf de grondtoon
  function bassHits(variant, { genBars, bars, hard, barSec }) {
    const root = randInt(45, 50);                       // A2 … D3
    const prog = pick(PROGRESSIONS);
    const starts = beatStarts(variant);
    const last = starts[starts.length - 1];
    const level = hard ? 0.6 : 0.8;
    const dur = clamp(barSec * 0.9, 0.7, 2.4);
    const fold = (m) => { while (m > 57) m -= 12; while (m < 38) m += 12; return m; }; // binnen D2 … A3 blijven
    const rootOf = (b) => fold(root + prog[b % prog.length]);
    const hits = [];
    for (let b = 0; b < genBars; b++) {
      hits.push({ bar: b, pos: 0, frac: 0, kind: "note", midi: rootOf(b), dur, level, steady: true });
      if (hard && chance(0.35)) {
        const target = rootOf(b + 1);
        hits.push({ bar: b, pos: last, frac: 0, kind: "note", midi: fold(pick([target - 1, target + 2, rootOf(b) + 7])), dur: 0.35, level: level * 0.55 });
      }
    }
    // Gemiddeld eindigt met een slot op de grondtoon
    if (!hard) hits.push({ bar: bars, pos: 0, frac: 0, kind: "note", midi: root, dur: 1.4, level, steady: true, landing: true });
    return hits;
  }

  /* Zo lang duurt een fragment ongeveer, voor elke maatsoort even lang; het aantal maten volgt uit het tempo.
     Met een vast aantal maten verraadt de lengte de maatsoort (4 maten 2/4 duren half zo lang als 4 maten 4/4),
     en dan raad je op duur in plaats van te luisteren. */
  const LISTEN_SEC = { normal: [7.5, 11], hard: [10, 14] };
  const HARD_MAX_SEC = 16;

  /* Eén luisterfragment.
     opts (optioneel, vooral voor voorbeelden en tests): variant, bpm, bars, offset.
     Geeft { key, variant, grouping, bpm, bars, n, offset, startBeat, duration, events }. */
  function buildFragment(key, difficulty, opts = {}) {
    const sig = SIGS[key];
    const hard = difficulty === "moeilijk";
    const pool = hard ? sig.variants : sig.variants.filter((v) => !v.hardOnly);
    const variant = opts.variant || pick(pool);
    const lv = levelsOf(variant);
    const n = lv.length;
    const starts = beatStarts(variant);
    const per = sig.kind === "compound" ? 3 : 2;            // achtsten per tempo-tel
    const bpm = opts.bpm || randInt(sig.tempo[0], sig.tempo[1]);
    const e = 60 / (bpm * per);                             // duur van één achtste (s)
    const barSec = n * e;
    let bars = opts.bars;
    if (!bars) {
      const [lo, hi] = hard ? LISTEN_SEC.hard : LISTEN_SEC.normal;
      // Moeilijk: minstens 3 maten, want het fragment begint vaak midden in een maat
      bars = clamp(Math.round(rand(lo, hi) / barSec), hard ? 3 : 2, 16);
      while (hard && bars > 3 && bars * barSec > HARD_MAX_SEC) bars--;
    }
    // Moeilijk: meestal niet op tel 1 beginnen, maar op het begin van een willekeurige andere tel
    const offset = opts.offset != null ? opts.offset : hard && chance(0.75) ? pick(starts.slice(1)) : 0;
    const landing = !hard; // Makkelijk en Gemiddeld eindigen met een slot op de volgende tel 1

    let hits;
    if (difficulty === "makkelijk") {
      hits = [];
      for (let b = 0; b < bars; b++) lv.forEach((l, p) => hits.push(clickHit(b, p, l)));
      hits.push(Object.assign(clickHit(bars, 0, 3), { landing: true }));
    } else {
      const genBars = hard ? bars + 1 : bars;
      hits = grooveHits(key, variant, { genBars, bars, hard }).concat(bassHits(variant, { genBars, bars, hard, barSec }));
      if (landing) {
        hits.push({ bar: bars, pos: 0, frac: 0, kind: "drum", sound: "kick", level: 1, landing: true, steady: true });
        hits.push({ bar: bars, pos: 0, frac: 0, kind: "drum", sound: "openhat", level: 0.5, landing: true });
      }
    }

    const total = bars * n; // aantal achtsten in het fragment
    const human = difficulty !== "makkelijk";
    const events = [];
    hits.forEach((hit) => {
      const rel = hit.bar * n + hit.pos + (hit.frac || 0) - offset;
      if (rel < 0 || rel > total || (rel === total && !hit.landing)) return;
      const t = Math.max(0, rel * e + (human ? rand(-0.004, 0.004) : 0));
      const level = clamp(hit.level * (human && !hit.steady ? rand(0.92, 1.06) : 1), 0.05, 1);
      if (hit.kind === "click") events.push({ t, kind: "click", accent: !!hit.accent, voice: "click", level: hit.level });
      else if (hit.kind === "note") events.push({ t, kind: "note", midi: hit.midi, dur: hit.dur, level });
      else events.push({ t, kind: "drum", sound: hit.sound, level });
    });
    // Stille markeringen op elke achtste: voor het beeld (pulsen, oplichtende noot)
    const marks = total + (landing ? 1 : 0);
    for (let rel = 0; rel < marks; rel++) {
      events.push({ t: rel * e, kind: "mark", pos: (rel + offset) % n, rel });
    }
    events.sort((a, b) => a.t - b.t);

    return {
      key, difficulty, variant, grouping: variant.label || null, bpm, eighthSec: e, bars, n,
      offset, startBeat: starts.indexOf(offset) + 1, duration: total * e, events,
    };
  }

  /* Voorbeeld voor het spiekbriefje: twee maten metronoom in een rustig middentempo. */
  function buildExample(key) {
    const sig = SIGS[key];
    const bpm = Math.round((sig.tempo[0] + sig.tempo[1]) / 2);
    return buildFragment(key, "makkelijk", { variant: sig.variants[0], bpm, bars: 2, offset: 0 });
  }

  /* Kiest de maatsoort van de volgende ronde met gewogen willekeur. Een maatsoort die al vaker kwam dan
     gemiddeld krijgt minder kans, zodat alles ongeveer even vaak voorkomt. Toch ligt geen enkele ronde vast
     (zoals de laatste trekking uit een zak), dus 'die moet nu nog komen' helpt je niet: je moet luisteren.
     Twee keer achter elkaar kan gewoon, drie keer zelden, vier keer nooit. */
  const PICK_BALANCE = 0.7; // hoe sterk de weging naar evenwicht trekt (0 = puur toeval)
  function makePicker(keys) {
    const count = {};
    keys.forEach((k) => { count[k] = 0; });
    const history = [];
    return function next() {
      if (keys.length < 2) return keys[0];
      const drawn = history.length;
      const mean = drawn / keys.length;
      const [a, b, c] = [history[drawn - 1], history[drawn - 2], history[drawn - 3]];
      const weights = keys.map((k) => {
        let w = Math.exp(-PICK_BALANCE * (count[k] - mean));
        if (k === a && k === b) w *= k === c ? 0 : 0.25;
        return w;
      });
      let r = Math.random() * weights.reduce((s, w) => s + w, 0);
      let k = null;
      for (let i = 0; i < keys.length; i++) {
        if (weights[i] <= 0) continue;
        k = keys[i];                 // de laatste met kans blijft over bij afrondingsfouten
        r -= weights[i];
        if (r < 0) break;
      }
      count[k]++;
      history.push(k);
      return k;
    };
  }

  /* Samenvatting van de rondes, voor het resultaat en het sessie-record. */
  function summarize(rounds) {
    const total = rounds.length;
    let correct = 0;
    let timeSum = 0;
    let replays = 0;
    const perSignature = {};
    const confusions = {};
    rounds.forEach((r) => {
      const ps = perSignature[r.actual] || (perSignature[r.actual] = { total: 0, correct: 0 });
      ps.total++;
      if (r.correct) { ps.correct++; correct++; }
      else {
        const c = confusions[r.actual] || (confusions[r.actual] = {});
        c[r.answer] = (c[r.answer] || 0) + 1;
      }
      timeSum += r.timeMs || 0;
      replays += r.replays || 0;
    });
    return {
      total, correct, accuracy: total ? correct / total : 0,
      meanTimeMs: total ? Math.round(timeSum / total) : 0, replays, perSignature, confusions,
    };
  }

  /* Verwisselingen als lijst, vaakste eerst. */
  function confusionList(confusions) {
    const out = [];
    Object.keys(confusions || {}).forEach((actual) => {
      Object.keys(confusions[actual]).forEach((answer) => out.push({ actual, answer, count: confusions[actual][answer] }));
    });
    return out.sort((a, b) => b.count - a.count || ORDER.indexOf(a.actual) - ORDER.indexOf(b.actual));
  }

  const scoreOf = (stats) => Math.round(stats.accuracy * 100);

  const DEFAULTS = { signatures: ["3/4", "4/4", "6/8"], difficulty: "makkelijk", rounds: 10 };
  const ROUND_OPTIONS = [5, 10, 20];

  /* Opgeslagen instellingen controleren (onbekende waarden vallen terug op de standaard). */
  function cleanSettings(s) {
    s = s || {};
    let signatures = Array.isArray(s.signatures) ? ORDER.filter((k) => s.signatures.includes(k)) : [];
    if (signatures.length < 2) signatures = DEFAULTS.signatures.slice();
    const difficulty = LEVELS.some((l) => l.value === s.difficulty) ? s.difficulty : DEFAULTS.difficulty;
    const rounds = ROUND_OPTIONS.includes(+s.rounds) ? +s.rounds : DEFAULTS.rounds;
    return { signatures, difficulty, rounds };
  }

  // Alleen voor losse tests in node: haak voor de zuivere logica (doet niets in de browser)
  if (typeof App.__msTest === "function") {
    App.__msTest({
      SIGS, ORDER, levelsOf, beatStarts, describe, countLabels, whyText, buildFragment, buildExample,
      makePicker, summarize, confusionList, scoreOf, cleanSettings, backbone, measureView,
      grooveHits, bassHits, startText, KICK, LISTEN_SEC, HARD_MAX_SEC,
    });
  }

  /* ====================================================================
     Beeld: maatraster (noten met waardestrepen, accenten en tellen)
     ==================================================================== */

  /* Tekent één maat als achtsten, gegroepeerd per tel, met accenttekens (>) en de telling eronder.
     opts.compact = spiekbriefje (niet groter dan ware grootte); opts.scale = groter tekenen (feedback);
     opts.startPos = achtste waar het fragment begon.
     De SVG schaalt mee met de breedte. Zodat de telling op een smal scherm leesbaar blijft, zet de pagina
     via data-w (de breedte in tekeneenheden) de CSS-variabele --ms-k = tekenbreedte / schermbreedte;
     de CSS houdt daarmee de letters op minstens ±11 px (zie fitMeasure in mount).
     Geeft { el, highlight(pos), clear() }. */
  function measureView(key, variant, opts = {}) {
    const { svg } = App.ui;
    const lv = levelsOf(variant);
    const n = lv.length;
    const counts = countLabels(key, variant);
    const U = 24;            // afstand tussen achtsten
    const G = 12;            // extra ruimte tussen tellen
    const X0 = 56;           // eerste noot
    const xs = [];
    const groups = [];
    let x = X0;
    variant.beats.forEach((len, bi) => {
      if (variant.secondary.includes(bi)) x += 8; // iets meer lucht voor een middelsterke groep (5/4 → 3 + 2)
      const first = xs.length;
      for (let k = 0; k < len; k++) { xs.push(x); x += U; }
      groups.push({ first, last: xs.length - 1 });
      x += G;
    });
    const W = Math.round(xs[n - 1] + 30);
    const startPos = opts.startPos > 0 ? opts.startPos : -1;
    const H = startPos >= 0 ? 140 : 108;
    const Y_ACC = 14, Y_BEAM = 25, Y_HEAD = 68, Y_COUNT = 98, STEM = 5.6;

    const el = svg("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "ms-measure" + (opts.compact ? " is-compact" : ""),
      role: "img",
      "aria-label": `Maat ${key}: ${describe(key, variant)}` + (startPos >= 0 ? `. Het fragment begon op ${startText(key, variant, startPos)}.` : "."),
      "data-w": W,
      style: { maxWidth: Math.round(W * (opts.compact ? 1 : opts.scale || 1)) + "px" },
    });

    // Vlakken per tel: maken de groepering in één oogopslag zichtbaar
    groups.forEach((g, gi) => {
      el.append(svg("rect", {
        class: "ms-m-group" + (gi === 0 ? " is-first" : ""),
        x: xs[g.first] - U / 2 + 2, y: 3, width: xs[g.last] - xs[g.first] + U - 4, height: Y_COUNT + 6, rx: 9,
      }));
    });
    el.append(svg("line", { class: "ms-m-staff", x1: X0 - 24, y1: Y_HEAD, x2: W - 8, y2: Y_HEAD }));
    el.append(svg("line", { class: "ms-m-bar", x1: W - 8, y1: Y_HEAD - 13, x2: W - 8, y2: Y_HEAD + 13 }));
    // Maatsoort zoals op bladmuziek: twee getallen boven elkaar
    const sig = SIGS[key];
    el.append(svg("text", { class: "ms-m-sig", x: 22, y: Y_HEAD - 4, "text-anchor": "middle" }, String(sig.num)));
    el.append(svg("text", { class: "ms-m-sig", x: 22, y: Y_HEAD + 22, "text-anchor": "middle" }, String(sig.den)));
    // Waardestrepen (beams): één per tel
    groups.forEach((g) => {
      el.append(svg("rect", {
        class: "ms-m-beam", x: xs[g.first] + STEM - 0.9, y: Y_BEAM, width: xs[g.last] - xs[g.first] + 1.8, height: 5.5, rx: 1,
      }));
    });

    const noteEls = [];
    const countEls = [];
    for (let p = 0; p < n; p++) {
      const nx = xs[p];
      const note = svg("g", { class: "ms-m-note" },
        svg("ellipse", { cx: nx, cy: Y_HEAD, rx: 6.6, ry: 4.7, transform: `rotate(-22 ${nx} ${Y_HEAD})` }),
        svg("line", { x1: nx + STEM, y1: Y_HEAD - 2, x2: nx + STEM, y2: Y_BEAM + 2.5 })
      );
      el.append(note);
      noteEls.push(note);
      // Accentteken: groter en in de oefeningskleur op tel 1
      const l = lv[p];
      if (l > 0) {
        const w = l === 3 ? 15 : l === 2 ? 12 : 10;
        const hh = l === 3 ? 11 : l === 2 ? 9 : 7;
        const cx = nx + 1.5;
        el.append(svg("path", {
          class: "ms-m-acc lv-" + l,
          d: `M ${cx - w / 2} ${Y_ACC - hh / 2} L ${cx + w / 2} ${Y_ACC} L ${cx - w / 2} ${Y_ACC + hh / 2}`,
        }));
      }
      const c = svg("text", {
        class: "ms-m-count" + (l > 0 ? " is-beat" : "") + (l === 3 ? " is-one" : ""),
        x: nx, y: Y_COUNT, "text-anchor": "middle",
      }, counts[p]);
      el.append(c);
      countEls.push(c);
    }
    if (startPos >= 0) {
      const sx = xs[startPos];
      el.append(svg("g", { class: "ms-m-start" },
        svg("path", { d: `M ${sx - 5} ${Y_COUNT + 16} L ${sx} ${Y_COUNT + 9} L ${sx + 5} ${Y_COUNT + 16} Z` }),
        svg("text", { x: sx, y: Y_COUNT + 35, "text-anchor": "middle" }, "start")
      ));
    }

    let current = -1;
    function clear() {
      if (current >= 0) {
        noteEls[current].classList.remove("is-on");
        countEls[current].classList.remove("is-on");
      }
      current = -1;
    }
    function highlight(pos) {
      if (pos === current || pos < 0 || pos >= n) return;
      clear();
      noteEls[pos].classList.add("is-on");
      countEls[pos].classList.add("is-on");
      current = pos;
    }
    return { el, highlight, clear };
  }

  /* ====================================================================
     De pagina
     ==================================================================== */

  App.registerMode({
    id: MODE,
    title: "Maatsoort",
    nav: "Maatsoort",
    description: "Hoor een groove en herken de maatsoort: 3/4, 4/4, 6/8 en meer.",
    mount(root) {
      const ui = App.ui;
      const { h, icon } = ui;

      let disposed = false;
      let phase = "setup";           // setup | starting | listen | feedback | result
      let settings = cleanSettings(App.store.modeSettings(MODE, DEFAULTS));
      let session = null;
      let player = null;             // handle van de sequence die nu speelt
      let raf = 0;
      let els = {};                  // elementen van het huidige scherm
      const timers = new Set();

      const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      function later(fn, ms) {
        const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms);
        timers.add(id);
      }
      function saveSettings() { App.store.saveModeSettings(MODE, settings); }
      const kbd = (text) => h("span", { class: "kbd" }, text);
      const sigTag = (key) => h("span", { class: "ms-sig num" }, key);
      const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      const fmtSec = (ms) => ui.fmtNum(ms / 1000, 1, false); // 4,2 (met Nederlandse komma)

      /* Leesbare telling in het maatraster. Een raster schaalt mee met zijn vak; deze waarnemer zet per raster
         --ms-k (tekenbreedte / schermbreedte), zodat de CSS de letters bij verkleinen groter tekent. */
      const sizer = typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
          entries.forEach((en) => {
            const w = en.contentRect.width;
            const W = +en.target.getAttribute("data-w");
            if (w > 0 && W > 0) en.target.style.setProperty("--ms-k", (W / w).toFixed(3));
          });
        })
        : null;
      const sized = new Set();
      function fitMeasure(m) {
        if (!sizer) return m;
        // Rasters die niet meer op de pagina staan niet langer volgen
        sized.forEach((el) => { if (!el.isConnected) { sizer.unobserve(el); sized.delete(el); } });
        sizer.observe(m.el);
        sized.add(m.el);
        return m;
      }

      /* ---------- Afspelen ---------- */

      /* Speel een fragment. onMark(ev) bij elke achtste die je hoort; onEnd(completed) als het klaar of gestopt is. */
      function play(frag, { onMark, onEnd } = {}) {
        stopPlayer();
        const handle = App.audio.sequence(frag.events, {
          lead: 0.12,
          tail: 0.35,
          onEvent: (ev) => { if (!disposed && ev.kind === "mark" && onMark) onMark(ev); },
        });
        player = handle;
        handle.done.then((res) => {
          if (player === handle) player = null;
          if (!disposed && onEnd) onEnd(!!(res && res.completed));
        });
        return handle;
      }
      function stopPlayer() {
        const p = player;
        player = null;
        if (p) p.stop();
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      }

      /* ---------- Toetsenbord ---------- */
      function onKey(e) {
        if (e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
        if (t && t.isContentEditable) return;
        if (document.querySelector(".modal-back")) return; // een bevestigingsvenster staat open
        const onControl = !!(t && t.closest && t.closest("button, a, [role='spinbutton'], [role='button']"));
        const k = e.key;

        if (phase === "setup" || phase === "result") {
          // Enter start (opnieuw); op een knop laat je de knop zelf zijn werk doen
          if (k === "Enter" && !onControl) { e.preventDefault(); startSession(); }
          return;
        }
        // Esc = stoppen (met de vraag of je het zeker weet, als je al iets beantwoord hebt)
        if (k === "Escape" && (phase === "listen" || phase === "feedback")) {
          e.preventDefault();
          stopSession();
          return;
        }
        if (phase === "listen") {
          if (/^[1-9]$/.test(k)) {
            const key = session.settings.signatures[+k - 1];
            if (key) { e.preventDefault(); answer(key); }
          } else if (k === "r" || k === "R") {
            e.preventDefault();
            replay();
          }
          return;
        }
        if (phase === "feedback") {
          if (k === "Enter" && !onControl) { e.preventDefault(); next(); }
          else if (k === "r" || k === "R") { e.preventDefault(); replayFeedback(); }
        }
      }

      /* ---------- Scherm 1: instellen ----------
         fromPlay: true als je terugkomt uit een sessie of het resultaat; dan gaat de pagina naar boven
         en krijgt de startknop de focus, zodat je niet halverwege de pagina of zonder focus blijft staan. */
      function renderSetup({ fromPlay = false } = {}) {
        phase = "setup";
        session = null;
        stopPlayer();
        els = {};
        root.classList.remove("ms-in-play", "ms-in-result");
        App.setPlaying(false);

        const sigChips = ui.chips({
          options: ORDER.map((k) => ({ value: k, label: k })),
          value: settings.signatures,
          min: 2,
          ariaLabel: "Maatsoorten",
          onChange: (v) => { settings.signatures = v; saveSettings(); renderSheet(); paintStartHint(); },
        });

        const levelText = h("span", null);
        const levelDesc = h("div", { class: "ms-level-desc", "aria-live": "polite" }, icon("info", 18), levelText);
        const paintLevel = () => { levelText.textContent = LEVELS.find((l) => l.value === settings.difficulty).desc; };
        const levelSeg = ui.segmented({
          options: LEVELS.map((l) => ({ value: l.value, label: l.label })),
          value: settings.difficulty,
          block: true,
          ariaLabel: "Moeilijkheid",
          onChange: (v) => { settings.difficulty = v; saveSettings(); paintLevel(); paintStartHint(); },
        });
        paintLevel();

        const roundsSeg = ui.segmented({
          options: ROUND_OPTIONS.map((n) => ({ value: n, label: String(n) })),
          value: settings.rounds,
          ariaLabel: "Aantal rondes",
          onChange: (v) => { settings.rounds = v; saveSettings(); paintStartHint(); },
        });

        const startHint = h("p", { class: "ms-start-hint" });
        function paintStartHint() {
          // Per ronde: ±9–12 s luisteren, kiezen en de uitleg lezen
          const perRound = settings.difficulty === "moeilijk" ? 20 : 16;
          const min = Math.max(1, Math.round((settings.rounds * perRound) / 60));
          startHint.replaceChildren(
            h("span", null, `${settings.rounds} rondes · ${settings.signatures.length} maatsoorten · ongeveer ${min} min`),
            h("span", { class: "ms-hide-touch" }, " · of druk op ", kbd("Enter"))
          );
        }
        paintStartHint();

        const startBtn = h("button", { type: "button", class: "btn btn-lg btn-primary ms-start-btn", onClick: () => startSession() },
          icon("play", 18), "Start");

        const settingsPanel = h("section", { class: "panel ms-settings", "aria-labelledby": "ms-set-title" },
          h("h2", { class: "panel-title", id: "ms-set-title" }, "Instellingen"),
          h("div", { class: "stack ms-fields" },
            ui.field("Maatsoorten", sigChips, "Kies er minstens twee. Begin met 3/4, 4/4 en 6/8; voeg later de rest toe."),
            ui.field("Moeilijkheid", h("div", { class: "stack ms-level" }, levelSeg, levelDesc)),
            ui.field("Rondes", roundsSeg)
          )
        );
        const startRow = h("div", { class: "ms-start" }, startBtn, startHint);

        els.sheetList = h("div", { class: "ms-sheet" });
        const sheetPanel = h("section", { class: "panel ms-sheet-panel", "aria-labelledby": "ms-sheet-title" },
          h("h2", { class: "panel-title", id: "ms-sheet-title" }, "Spiekbriefje"),
          h("p", { class: "panel-sub" }, "Zo zijn de gekozen maatsoorten verdeeld. De pijltjes (>) laten zien waar de nadruk valt. Druk op afspelen om er een te horen."),
          els.sheetList
        );

        root.querySelector(".ms-body").replaceChildren(
          h("div", { class: "ms-setup" },
            h("div", { class: "ms-col" }, settingsPanel, startRow),
            h("div", { class: "ms-col" }, sheetPanel)
          )
        );
        renderSheet();
        if (fromPlay) {
          window.scrollTo(0, 0);
          try { startBtn.focus({ preventScroll: true }); } catch (e) { /* oudere browser */ }
        }
      }

      /* Spiekbriefje: per gekozen maatsoort het raster, een korte uitleg en een voorbeeld om te horen. */
      function renderSheet() {
        if (!els.sheetList) return;
        stopPlayer();
        els.sheetList.replaceChildren(...settings.signatures.map((key) => sheetRow(key)));
      }

      function sheetRow(key) {
        const sig = SIGS[key];
        const variant = sig.variants[0];
        const m = fitMeasure(measureView(key, variant, { compact: true }));
        const btn = h("button", { type: "button", class: "btn btn-icon ms-sheet-play", "aria-label": `Voorbeeld van ${key} afspelen`, "aria-pressed": "false" },
          icon("play", 16));
        const row = h("div", { class: "ms-sheet-row" },
          btn,
          h("div", { class: "ms-sheet-text" },
            h("div", { class: "ms-sheet-title" }, sigTag(key), h("span", null, capital(describe(key, variant)))),
            h("p", { class: "ms-sheet-tip" }, TIPS[key])
          ),
          h("div", { class: "ms-sheet-fig" }, m.el)
        );
        let playingHere = false;
        const setState = (on) => {
          playingHere = on;
          row.classList.toggle("is-playing", on);
          btn.setAttribute("aria-pressed", String(on));
          btn.setAttribute("aria-label", on ? `Voorbeeld van ${key} stoppen` : `Voorbeeld van ${key} afspelen`);
          btn.replaceChildren(icon(on ? "stop" : "play", 16));
          if (!on) m.clear();
        };
        btn.addEventListener("click", async () => {
          if (playingHere) { stopPlayer(); return; }
          await App.audio.ready();
          if (disposed || phase !== "setup" || !row.isConnected) return;
          const frag = buildExample(key);
          setState(true);
          play(frag, { onMark: (ev) => m.highlight(ev.pos), onEnd: () => setState(false) });
        });
        return row;
      }

      /* ---------- Scherm 2: spelen ---------- */
      async function startSession() {
        if (phase !== "setup" && phase !== "result") return;
        phase = "starting";
        stopPlayer();
        try { await App.audio.ready(); } catch (e) { /* zonder geluid gaat het niet, maar het scherm werkt */ }
        if (disposed) return;
        session = {
          settings: { signatures: settings.signatures.slice(), difficulty: settings.difficulty, rounds: settings.rounds },
          picker: makePicker(settings.signatures),
          rounds: [],
          index: -1,
          current: null,
          startPerf: performance.now(),
        };
        buildPlayScreen();
        window.scrollTo(0, 0);
        nextRound();
      }

      /* Eén vaste, onzichtbare live-regio voor schermlezers: een regio die al gevuld de pagina in komt,
         wordt vaak niet voorgelezen. */
      function announce(text) {
        if (els.live) els.live.textContent = text;
      }

      function buildPlayScreen() {
        const s = session.settings;
        els = {};
        root.classList.add("ms-in-play"); // verbergt de inleiding boven de pagina, zodat de knoppen hoger staan
        root.classList.remove("ms-in-result");
        // Speelstand: op de telefoon verdwijnt de onderbalk, zodat je hem niet per ongeluk raakt
        App.setPlaying(true);
        els.live = h("p", { class: "visually-hidden", "aria-live": "polite" });
        els.roundLabel = h("div", { class: "ms-round-label" });
        els.pips = h("div", { class: "ms-pips", role: "img" });
        els.stageInner = h("div", { class: "ms-stage-inner" });
        els.stage = h("section", { class: "panel ms-stage", tabindex: "-1", "aria-label": "Luisteren" }, els.stageInner);
        els.answers = new Map();
        // Kolommen: alles op één rij als het past; op smalle schermen in nette rijen (4 → 2×2, 8 → 2×4)
        const count = s.signatures.length;
        const grid = els.answersGrid = h("div", {
          class: "ms-answers", role: "group", "aria-label": "Kies de maatsoort",
          style: {
            "--cols": String(count),
            "--cols-t": String(count <= 4 ? count : Math.ceil(count / 2)),
            "--cols-m": String(count <= 3 ? count : count === 4 ? 2 : Math.ceil(count / 2)),
          },
        });
        s.signatures.forEach((key, i) => {
          const sig = SIGS[key];
          const mark = h("span", { class: "ms-answer-mark", "aria-hidden": "true" });
          const btn = h("button", {
            type: "button", class: "ms-answer", dataset: { key }, "aria-label": `${key}, toets ${i + 1}`,
            "aria-keyshortcuts": String(i + 1),
            onClick: () => answer(key),
          },
            h("span", { class: "kbd ms-hide-touch", "aria-hidden": "true" }, String(i + 1)),
            h("span", { class: "ms-frac", "aria-hidden": "true" }, h("span", null, String(sig.num)), h("span", null, String(sig.den))),
            mark
          );
          btn._mark = mark;
          els.answers.set(key, btn);
          grid.append(btn);
        });
        const n = s.signatures.length;
        const foot = h("div", { class: "ms-foot" },
          h("p", { class: "ms-keys ms-hide-touch" },
            kbd("1"), "–", kbd(String(n)), " antwoord", h("span", { class: "ms-dot" }, "·"),
            kbd("R"), " opnieuw horen", h("span", { class: "ms-dot" }, "·"),
            kbd("Enter"), " volgende"),
          h("button", { type: "button", class: "btn btn-ghost", "aria-keyshortcuts": "Escape", onClick: stopSession },
            icon("stop", 14), "Stoppen", h("span", { class: "kbd ms-hide-touch", "aria-hidden": "true" }, "Esc"))
        );
        els.play = h("div", { class: "ms-play" },
          h("div", { class: "ms-topbar" },
            els.roundLabel,
            els.pips,
            h("span", { class: "badge ms-level-badge" }, levelLabel(s.difficulty))
          ),
          els.stage,
          grid,
          foot,
          els.live
        );
        root.querySelector(".ms-body").replaceChildren(els.play);
      }

      function paintTop() {
        const s = session.settings;
        const cur = Math.min(session.index + 1, s.rounds);
        els.roundLabel.replaceChildren("Ronde ", h("span", { class: "num" }, String(cur)), h("span", { class: "faint" }, " van " + s.rounds));
        const good = session.rounds.filter((r) => r.correct).length;
        els.pips.setAttribute("aria-label", `${good} van ${session.rounds.length} goed`);
        els.pips.replaceChildren(...Array.from({ length: s.rounds }, (_, i) => {
          const r = session.rounds[i];
          const cls = r ? (r.correct ? " is-ok" : " is-bad") : i === session.index ? " is-current" : "";
          return h("span", { class: "ms-pip" + cls }, r ? icon(r.correct ? "check" : "x", 10) : null);
        }));
      }

      function nextRound() {
        stopPlayer();
        session.index++;
        if (session.index >= session.settings.rounds) { finishSession(); return; }
        const key = session.picker();
        const frag = buildFragment(key, session.settings.difficulty);
        const round = { index: session.index, frag, replays: 0, firstPlayAt: 0, answer: null, correct: null, timeMs: 0 };
        session.current = round;
        showListen(round);
        later(() => { if (session && session.current === round && phase === "listen") playRound(round); }, 420);
      }

      /* Luisterscherm: een rustige puls op elke achtste, zonder groepering, zodat het beeld niets verraadt. */
      function showListen(round) {
        phase = "listen";
        paintTop();
        // Tot het fragment echt start, doen de antwoorden en 'Opnieuw horen' nog niets: laat dat ook zien
        els.answersGrid.classList.add("is-waiting");
        els.answers.forEach((btn) => {
          btn.disabled = false;
          btn.setAttribute("aria-disabled", "true");
          btn.dataset.state = "";
          btn._mark.replaceChildren();
        });
        els.play.classList.remove("is-feedback");

        const rings = [0, 1, 2, 3].map(() => h("span", { class: "ms-ripple" }));
        const core = h("span", { class: "ms-core" }, icon("headphones", 30));
        const orb = h("div", { class: "ms-orb", "aria-hidden": "true" }, rings, core);
        let ringIdx = 0;
        els.pulse = () => {
          const r = rings[ringIdx++ % rings.length];
          r.classList.remove("is-go");
          void r.offsetWidth; // animatie opnieuw starten
          r.classList.add("is-go");
          core.classList.remove("is-beat");
          void core.offsetWidth;
          core.classList.add("is-beat");
        };
        els.statusTitle = h("h2", null, "Luister goed…");
        els.statusSub = h("p", null, round.frag.difficulty === "moeilijk"
          ? "Let op: het fragment begint niet altijd op tel 1."
          : "Waar valt de nadruk? Gaan de tellen in tweeën of in drieën?");
        els.progressFill = h("span", null);
        els.replayInfo = h("span", { class: "ms-replays faint" });
        els.replayBtn = h("button", { type: "button", class: "btn", disabled: true, "aria-keyshortcuts": "R", onClick: () => replay() },
          icon("replay", 16), "Opnieuw horen", h("span", { class: "kbd ms-hide-touch", "aria-hidden": "true" }, "R"));

        els.fbMeasure = null;
        els.nextBtn = null;
        els.stage.classList.remove("is-feedback");
        els.stage.setAttribute("aria-label", "Luisteren");
        els.stageInner.replaceChildren(
          h("div", { class: "ms-listen" },
            orb,
            h("div", { class: "ms-status" }, els.statusTitle, els.statusSub),
            h("div", { class: "ms-progress", "aria-hidden": "true" }, els.progressFill),
            h("div", { class: "ms-listen-actions" }, els.replayBtn, els.replayInfo)
          )
        );
        announce(`Ronde ${round.index + 1} van ${session.settings.rounds}. Luister.`);
        try { els.stage.focus({ preventScroll: true }); } catch (e) { /* oudere browser */ }
        // Na een lange uitleg (telefoon) staat de pagina vaak te ver omlaag: zet het speelvlak weer in beeld
        if (els.play.getBoundingClientRect().top < 0) {
          els.play.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
        }
      }

      /* Het fragment speelt: antwoorden en 'Opnieuw horen' doen vanaf nu mee. */
      function enableAnswers() {
        els.answersGrid.classList.remove("is-waiting");
        els.answers.forEach((btn) => btn.removeAttribute("aria-disabled"));
        if (els.replayBtn) els.replayBtn.disabled = false;
      }

      /* Speelt het fragment van een ronde. Tijdens het luisteren pulst het beeld op elke achtste;
         staat de feedback al open, dan licht de juiste noot in het raster op. */
      function playRound(round) {
        const handle = play(round.frag, {
          onMark: (ev) => {
            if (!session || session.current !== round) return;
            if (phase === "listen" && els.pulse) els.pulse();
            else if (phase === "feedback" && els.fbMeasure) els.fbMeasure.highlight(ev.pos);
          },
          onEnd: (completed) => {
            if (!session || session.current !== round) return;
            if (phase === "listen" && completed) setListenDone();
            if (phase === "feedback" && els.fbMeasure && player === null) els.fbMeasure.clear();
          },
        });
        if (!round.firstPlayAt) round.firstPlayAt = performance.now() + 120;
        if (phase === "listen") {
          enableAnswers();
          els.statusTitle.textContent = "Luister goed…";
          els.stage.classList.add("is-playing");
          runProgress(handle, round.frag.duration);
        }
        return handle;
      }

      function setListenDone() {
        els.stage.classList.remove("is-playing");
        els.statusTitle.textContent = "Welke maatsoort was het?";
        els.statusSub.textContent = "Kies hieronder, of luister nog een keer.";
        announce("Kies de maatsoort.");
        if (els.progressFill) els.progressFill.style.transform = "scaleX(1)";
      }

      function runProgress(handle, duration) {
        if (raf) cancelAnimationFrame(raf);
        const fill = els.progressFill;
        const step = () => {
          raf = 0;
          if (disposed || player !== handle || phase !== "listen") return;
          const elapsed = App.audio.now() - App.audio.outputLatency() - handle.startTime;
          const p = clamp(elapsed / Math.max(0.1, duration), 0, 1);
          fill.style.transform = `scaleX(${p.toFixed(4)})`;
          if (p < 1) raf = requestAnimationFrame(step);
        };
        fill.style.transform = "scaleX(0)";
        raf = requestAnimationFrame(step);
      }

      function replay() {
        if (phase !== "listen" || !session || !session.current || !session.current.firstPlayAt) return;
        const round = session.current;
        round.replays++;
        els.replayInfo.textContent = `${round.replays}× opnieuw gehoord`;
        playRound(round);
      }

      function answer(key) {
        if (phase !== "listen" || !session) return;
        const round = session.current;
        if (!round || !round.firstPlayAt || round.answer) return;
        round.answer = key;
        round.correct = key === round.frag.key;
        round.timeMs = Math.max(0, Math.round(performance.now() - round.firstPlayAt));
        session.rounds.push({
          actual: round.frag.key,
          answer: key,
          correct: round.correct,
          bpm: round.frag.bpm,
          replays: round.replays,
          timeMs: round.timeMs,
          grouping: round.frag.grouping,     // bv. "2+2+3" bij 7/8, anders null
          startBeat: round.frag.startBeat,   // tel (bij 6/8, 7/8, 9/8, 12/8: groep) waarop het fragment begon; 1 = gewoon op tel 1
        });
        showFeedback(round);
      }

      /* Feedbackscherm: goed/fout, het raster van de echte maat (licht mee op als het fragment nog speelt),
         en bij fout ook jouw antwoord ernaast met uitleg waarom ze op elkaar lijken. */
      function showFeedback(round) {
        phase = "feedback";
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        paintTop();
        const f = round.frag;
        const ok = round.correct;
        els.answers.forEach((btn, key) => {
          btn.disabled = true;
          const state = key === f.key ? "correct" : key === round.answer ? "wrong" : "dim";
          btn.dataset.state = state;
          btn._mark.replaceChildren(state === "correct" ? icon("check", 18) : state === "wrong" ? icon("x", 18) : "");
        });

        const actualM = fitMeasure(measureView(f.key, f.variant, { startPos: f.offset, scale: ok ? 1.6 : 1.3 }));
        els.fbMeasure = actualM;
        els.play.classList.add("is-feedback"); // op de telefoon verdwijnen de antwoordknoppen dan (zie css)
        els.stage.classList.remove("is-playing");
        els.stage.classList.add("is-feedback");
        els.stage.setAttribute("aria-label", "Uitleg");

        const figure = (caption, meta, m, extraClass) => h("figure", { class: "ms-figure" + (extraClass || "") },
          h("figcaption", { class: "ms-figure-cap" }, h("span", null, caption), meta ? h("span", { class: "num" }, meta) : null),
          m.el
        );

        const figs = [figure(`Zo is ${f.key} verdeeld`, tempoText(f), actualM)];
        let why = null;
        if (!ok) {
          const ansSig = SIGS[round.answer];
          const answerM = fitMeasure(measureView(round.answer, ansSig.variants[0], { scale: 1.3 }));
          figs.push(figure(`Jouw antwoord: ${round.answer}`, null, answerM, " is-answer"));
          // Beide rasters even groot per achtste tekenen, ook als het vak te smal is voor het bredere:
          // de smallere krijgt dan naar verhouding minder breedte
          const wA = +actualM.el.getAttribute("data-w");
          const wB = +answerM.el.getAttribute("data-w");
          const wMax = Math.max(wA, wB);
          [[actualM, wA], [answerM, wB]].forEach(([m, w]) => {
            m.el.style.maxWidth = `min(${Math.round(w * 1.3)}px, ${((w / wMax) * 100).toFixed(2)}%)`;
          });
          why = h("div", { class: "ms-why" }, icon("info", 18),
            h("div", null,
              h("b", null, `Waarom leek het op ${round.answer}?`),
              h("p", null, whyText(f.key, round.answer, f.variant))
            ));
        } else {
          why = h("div", { class: "ms-why is-tip" }, icon("target", 18), h("div", null, h("b", null, "Zo herken je het"), h("p", null, TIPS[f.key])));
        }

        const notes = [];
        if (f.offset > 0) notes.push(`Dit fragment begon op ${startText(f.key, f.variant, f.offset)} en niet op tel 1. Kijk bij ‘start’ in het raster.`);
        if (!ok && f.difficulty !== "makkelijk" && SIGS[f.key].eighths !== SIGS[round.answer].eighths) {
          notes.push("Tip: de bas speelt op elke tel 1 een nieuwe noot. Tel van basnoot tot basnoot.");
        }
        if (f.difficulty === "moeilijk" && !ok) notes.push("Op Moeilijk zitten er fills in en is tel 1 zachter: luister naar het hele patroon, niet naar één klap.");

        const last = session.index + 1 >= session.settings.rounds;
        const replayBtn = h("button", { type: "button", class: "btn", "aria-keyshortcuts": "R", onClick: () => replayFeedback() },
          icon("replay", 16), "Opnieuw horen", h("span", { class: "kbd ms-hide-touch", "aria-hidden": "true" }, "R"));
        els.nextBtn = h("button", { type: "button", class: "btn btn-primary", "aria-keyshortcuts": "Enter", "aria-describedby": "ms-verdict", onClick: () => next() },
          last ? "Bekijk resultaat" : "Volgende", icon("next", 16), h("span", { class: "kbd ms-hide-touch", "aria-hidden": "true" }, "Enter"));

        els.stageInner.replaceChildren(
          h("div", { class: "ms-feedback" },
            h("div", { class: "ms-verdict " + (ok ? "is-ok" : "is-bad"), id: "ms-verdict" },
              h("span", { class: "ms-verdict-icon" }, icon(ok ? "check" : "x", 24)),
              h("div", null,
                h("h2", null, ok ? "Goed" : "Fout"),
                h("p", { class: "ms-explain" }, "Het was ", h("b", { class: "num" }, f.key), ": " + describe(f.key, f.variant) + ".")
              )
            ),
            h("div", { class: "ms-figures" + (ok ? "" : " is-two") }, figs),
            why,
            notes.length ? h("div", { class: "ms-notes muted" }, notes.map((t) => h("p", null, t))) : null,
            h("div", { class: "ms-fb-actions" },
              h("span", { class: "ms-fb-hint faint" }, "Bij opnieuw horen licht de maat mee op."),
              replayBtn, els.nextBtn)
          )
        );
        announce(`${ok ? "Goed" : "Fout"}. Het was ${f.key}: ${describe(f.key, f.variant)}.`);
        try { els.nextBtn.focus({ preventScroll: true }); } catch (e) { /* oudere browser */ }
        const top = els.stage.getBoundingClientRect().top;
        if (top < 0) els.stage.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
      }

      function replayFeedback() {
        if (phase !== "feedback" || !session || !session.current) return;
        if (els.fbMeasure) els.fbMeasure.clear();
        playRound(session.current);
      }

      function next() {
        if (phase !== "feedback") return;
        nextRound();
      }

      async function stopSession() {
        if (!session) return;
        if (session.rounds.length) {
          const sure = await ui.confirm({
            title: "Sessie stoppen?",
            text: `Je hebt ${session.rounds.length} van de ${session.settings.rounds} rondes gedaan. Een sessie die je stopt, wordt niet bewaard.`,
            ok: "Stoppen",
            cancel: "Doorgaan",
            danger: true,
          });
          if (!sure || disposed) return;
        }
        renderSetup({ fromPlay: true });
      }

      /* ---------- Scherm 3: resultaat ---------- */
      function finishSession() {
        stopPlayer();
        phase = "result";
        const s = session;
        const stats = summarize(s.rounds);
        const score = scoreOf(stats);
        // Alleen vergelijken met een sessie met dezelfde moeilijkheid én dezelfde maatsoorten:
        // met twee maatsoorten gok je de helft goed, met acht maar een achtste
        const sameSet = (x) => Array.isArray(x.signatures) && x.signatures.slice().sort().join() === s.settings.signatures.slice().sort().join();
        const earlier = App.store.sessions(MODE).filter((x) => x.settings && x.settings.difficulty === s.settings.difficulty && sameSet(x.settings));
        const prevScore = earlier.length ? earlier[earlier.length - 1].score : null;
        const rec = {
          mode: MODE,
          durationMs: Math.round(performance.now() - s.startPerf),
          score,
          settings: { signatures: s.settings.signatures.slice(), difficulty: s.settings.difficulty, rounds: s.settings.rounds },
          rounds: s.rounds.map((r) => Object.assign({}, r)),
          stats,
        };
        try { App.store.addSession(rec); } catch (e) { console.error(e); ui.toast("Opslaan lukte niet.", "bad"); }
        renderResult(rec, prevScore);
      }

      function renderResult(rec, prevScore) {
        els = {};
        root.classList.remove("ms-in-play");
        root.classList.add("ms-in-result"); // inleiding boven de pagina weg, net als bij de andere oefeningen
        App.setPlaying(false);
        const st = rec.stats;
        const lvl = levelLabel(rec.settings.difficulty);
        const headline = rec.score >= 90 ? "Uitstekend gehoord." : rec.score >= 70 ? "Goed bezig." : rec.score >= 50 ? "Je bent op weg." : "Blijf luisteren, het komt.";
        const tile = (value, label, unit) => h("div", { class: "stat-tile" }, ui.stat(value, label, unit));

        let compare = null;
        if (prevScore != null) {
          const d = rec.score - prevScore;
          compare = h("p", { class: "ms-compare" },
            "Vorige keer met deze instellingen: ", h("span", { class: "num" }, String(prevScore)), " ",
            // Zelfde afspraak als bij de andere oefeningen: groen bij vooruitgang, anders neutraal (met teken)
            h("span", { class: "badge" + (d > 0 ? " ok" : "") }, d === 0 ? "gelijk" : `${ui.fmtSigned(d)} ${Math.abs(d) === 1 ? "punt" : "punten"}`));
        }

        const again = h("button", { type: "button", class: "btn btn-primary btn-lg", onClick: () => startSession() }, icon("replay", 18), "Nog een keer");
        const actions = h("div", { class: "ms-result-actions" },
          again,
          h("button", { type: "button", class: "btn btn-lg", onClick: () => renderSetup({ fromPlay: true }) }, icon("instellingen", 18), "Andere instellingen"),
          h("button", { type: "button", class: "btn btn-lg btn-ghost", onClick: () => App.navigate("statistieken/" + MODE) }, icon("statistieken", 18), "Naar statistieken")
        );

        const summary = h("section", { class: "panel ms-result-head" },
          h("div", { class: "ms-result-score" },
            ui.scoreRing(rec.score, "score"),
            h("div", { class: "stack", style: { gap: "6px" } },
              h("h2", { class: "ms-headline" }, headline),
              h("p", { class: "muted" }, `${st.correct} van de ${st.total} maatsoorten goed herkend op ${lvl}.`),
              compare)
          ),
          h("div", { class: "ms-result-stats" },
            tile(`${st.correct}/${st.total}`, "goed"),
            tile(fmtSec(st.meanTimeMs), "gemiddeld per antwoord", "s"),
            tile(String(st.replays), "keer opnieuw gehoord"),
            tile(ui.fmtDuration(rec.durationMs), "sessieduur")
          )
        );

        // Per maatsoort: hoe vaak goed
        const perRows = rec.settings.signatures.map((key) => {
          const ps = st.perSignature[key] || { total: 0, correct: 0 };
          const pct = ps.total ? Math.round((ps.correct / ps.total) * 100) : 0;
          return h("div", { class: "ms-sig-row" + (ps.total ? "" : " is-empty") },
            sigTag(key),
            h("div", { class: "ms-meter", role: "img", "aria-label": ps.total ? `${key}: ${ps.correct} van ${ps.total} goed` : `${key}: niet voorgekomen` },
              h("span", { style: { width: pct + "%" } })),
            h("span", { class: "ms-sig-score" }, ps.total
              ? [h("span", { class: "num" }, String(ps.correct)), " van ", h("span", { class: "num" }, String(ps.total)), " goed"]
              : h("span", { class: "faint" }, "niet gehoord"))
          );
        });
        const perPanel = h("section", { class: "panel" },
          h("h2", { class: "panel-title" }, "Per maatsoort"),
          h("div", { class: "ms-sig-rows" }, perRows));

        // Verwisselingen: wat hoorde je als wat
        const conf = confusionList(st.confusions);
        const confPanel = h("section", { class: "panel" },
          h("h2", { class: "panel-title" }, "Verwisselingen"),
          conf.length
            ? h("div", { class: "ms-confusions" }, conf.map((c) => h("div", { class: "ms-confusion" },
              h("div", { class: "ms-confusion-head" },
                sigTag(c.actual), h("span", { class: "faint" }, "gehoord als"), sigTag(c.answer),
                h("span", { class: "badge bad ms-count" }, icon("x", 12), `${c.count}×`)),
              h("p", { class: "ms-confusion-why" }, whyText(c.actual, c.answer))
            )))
            : h("div", { class: "ms-none" }, icon("check", 18), h("span", null, "Geen verwisselingen. Je hield alles goed uit elkaar."))
        );

        // Alle rondes op een rij
        const list = h("ol", { class: "ms-round-list" }, rec.rounds.map((r, i) =>
          h("li", { class: "ms-round-item " + (r.correct ? "is-ok" : "is-bad") },
            h("span", { class: "faint num" }, String(i + 1)),
            icon(r.correct ? "check" : "x", 14),
            h("span", { class: "visually-hidden" }, r.correct ? "goed:" : "fout:"),
            h("b", { class: "num" }, r.actual),
            r.correct ? null : h("span", { class: "faint" }, `jij: ${r.answer}`)
          )));
        const roundsPanel = h("section", { class: "panel" },
          h("h2", { class: "panel-title" }, "Alle rondes"),
          list);

        root.querySelector(".ms-body").replaceChildren(
          h("div", { class: "ms-result" },
            summary,
            actions,
            h("div", { class: "grid-2 ms-result-grid" }, perPanel, confPanel),
            roundsPanel
          )
        );
        try { again.focus({ preventScroll: true }); } catch (e) { /* oudere browser */ }
        window.scrollTo(0, 0);
      }

      /* ---------- Opbouw ---------- */
      root.append(
        ui.pageHead({
          eyebrow: "Maatsoort",
          title: "Welke maatsoort hoor je?",
          lead: "Je hoort een paar maten ritme. Is het 3/4, 4/4, 6/8 of iets anders? Luister waar de nadruk valt en of de tellen in tweeën of in drieën gaan.",
        }),
        h("div", { class: "ms-body" })
      );
      document.addEventListener("keydown", onKey);
      renderSetup();

      return function cleanup() {
        disposed = true;
        document.removeEventListener("keydown", onKey);
        timers.forEach(clearTimeout);
        timers.clear();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        stopPlayer();
        if (sizer) sizer.disconnect();
        sized.clear();
        App.setPlaying(false);
      };
    },
  });
})();
