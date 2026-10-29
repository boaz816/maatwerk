/* Maatwerk — Gehoortraining (id "gehoor", CSS-voorvoegsel .gh-).
   Relatief: je hoort (en ziet) eerst een bekende referentienoot, daarna een andere noot die jij benoemt.
   Absoluut: je hoort alleen de noot en benoemt hem zonder houvast.
   Je antwoordt op een pianotoetsenbord van één octaaf; alleen de toonklasse telt, de octaaf niet.
   Opslaan volgens docs/CONTRACT.md (mode "gehoor"). */
(function () {
  "use strict";

  const MODE = "gehoor";
  const ALL_PCS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
  /* Sneltoetsen zoals in een DAW: A W S E D F T G Y H U J = C t/m B (index = toonklasse). */
  const KEY_LETTERS = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j"];
  /* Midden van elke zwarte toets, in breedtes van een witte toets. Net als op een echte piano iets verschoven. */
  const BLACK_X = { 1: 0.92, 3: 2.08, 6: 3.9, 8: 5, 10: 6.1 };

  const RANGES = {
    "1": { low: 60, high: 71, label: "1 octaaf", span: "C4–B4" },
    "2": { low: 48, high: 71, label: "2 octaven", span: "C3–B4" },
    "3": { low: 48, high: 83, label: "3 octaven", span: "C3–B5" },
  };
  const REF_MIN = 48; // C3
  const REF_MAX = 84; // C6

  const DEFAULTS = {
    variant: "relatief",       // "relatief" | "absoluut"
    range: "1",                // sleutel uit RANGES
    notes: "alle",             // "alle" | "wit" | "eigen"
    customPcs: WHITE_PCS.slice(),
    rounds: 20,                // 10 | 20 | 30
    reference: "elke-ronde",   // alleen relatief: "elke-ronde" | "eenmalig"
    refMode: "vast",           // alleen relatief: "vast" | "willekeurig"
    refMidi: 60,               // alleen relatief, bij "vast"
    wipe: true,                // alleen absoluut: gehoor wissen tussen rondes
  };

  /* Tijdlijn van een ronde, in seconden. */
  const T = {
    lead: 0.3,          // stilte voor het eerste geluid van een ronde
    firstLead: 1.0,     // in de eerste ronde langer: het scherm wisselt net en oortjes 'wakker' laten worden
    refDur: 1.1,        // uitklinktijd referentie
    refOn: 0.9,         // zolang licht de referentiekaart op
    gap: 0.7,           // pauze tussen referentie en doelnoot
    onceGap: 1.2,       // iets langere pauze als je de referentie maar één keer hoort
    targetDur: 1.5,     // uitklinktijd doelnoot
    targetOn: 1.0,      // zolang licht de doelkaart op (de reactietijd telt vanaf de aanslag)
    wipeOn: 0.45,       // duur van het wis-geluidje
    wipeGap: 0.85,      // stilte na het wissen
    feedbackLead: 0.35, // na een fout: even wachten, dan de juiste noot
    autoNextMs: 1000,   // na een goed antwoord automatisch verder
  };

  /* Zoveel pixels mag een vinger bewegen en toch nog als tik op een toets tellen. */
  const TAP_SLOP = 10;

  const INTERVALS = [
    "prime", "kleine secunde", "grote secunde", "kleine terts", "grote terts", "kwart",
    "tritonus", "kwint", "kleine sext", "grote sext", "kleine septiem", "grote septiem",
  ];

  /* ================= Zuivere rekenlogica (zonder DOM, los te testen) ================= */

  function pcOf(m) { return ((m % 12) + 12) % 12; }

  /* Afstand antwoord − doel in halve tonen, genormaliseerd naar −5..+6. */
  function semitoneError(answerPc, targetMidi) {
    let d = (((answerPc - pcOf(targetMidi)) % 12) + 12) % 12;
    if (d > 6) d -= 12;
    return d;
  }

  function cleanPcs(list) {
    if (!Array.isArray(list)) return [];
    const set = new Set(list.map(Number).filter((p) => Number.isInteger(p) && p >= 0 && p < 12));
    return Array.from(set).sort((a, b) => a - b);
  }

  /* Opgeslagen instellingen controleren en aanvullen. */
  function loadSettings(raw) {
    const s = Object.assign({}, DEFAULTS, raw || {});
    if (s.variant !== "relatief" && s.variant !== "absoluut") s.variant = DEFAULTS.variant;
    if (!RANGES[s.range]) s.range = DEFAULTS.range;
    if (!["alle", "wit", "eigen"].includes(s.notes)) s.notes = DEFAULTS.notes;
    s.customPcs = cleanPcs(s.customPcs);
    if (s.customPcs.length < 2) s.customPcs = WHITE_PCS.slice();
    s.rounds = [10, 20, 30].includes(+s.rounds) ? +s.rounds : DEFAULTS.rounds;
    if (s.reference !== "elke-ronde" && s.reference !== "eenmalig") s.reference = DEFAULTS.reference;
    if (s.refMode !== "vast" && s.refMode !== "willekeurig") s.refMode = DEFAULTS.refMode;
    const rm = Math.round(Number(s.refMidi));
    s.refMidi = Number.isFinite(rm) ? Math.min(REF_MAX, Math.max(REF_MIN, rm)) : DEFAULTS.refMidi;
    s.wipe = s.wipe !== false;
    return s;
  }

  function effectivePcs(s) {
    if (s.notes === "wit") return WHITE_PCS.slice();
    if (s.notes === "eigen") return cleanPcs(s.customPcs);
    return ALL_PCS.slice();
  }

  /* Instellingen → vaste configuratie voor één sessie. */
  function sessionConfig(s) {
    const r = RANGES[s.range] || RANGES[DEFAULTS.range];
    return {
      variant: s.variant, rangeKey: s.range, low: r.low, high: r.high,
      notes: s.notes, pcs: effectivePcs(s), rounds: s.rounds,
      reference: s.reference, refMode: s.refMode, refMidi: s.refMidi, wipe: !!s.wipe,
    };
  }

  function rangeMidis(low, high) {
    const out = [];
    for (let m = low; m <= high; m++) out.push(m);
    return out;
  }

  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* Mogelijke doelnoten per toonklasse, nooit precies de vaste referentie.
     Is de enige noot van een klasse in het bereik juist de referentie (bijv. C bij C4–B4 met
     referentie C4), dan vragen we die noot een octaaf hoger of lager: de kant die het dichtst bij
     het bereik ligt (hier C5). Zo doet elke gekozen toonklasse altijd mee. */
  function targetsByPc(cfg, fixedRef) {
    const midis = rangeMidis(cfg.low, cfg.high);
    const dist = (m) => (m < cfg.low ? cfg.low - m : m > cfg.high ? m - cfg.high : 0);
    const byPc = new Map();
    cfg.pcs.forEach((p) => {
      let c = midis.filter((m) => pcOf(m) === p && m !== fixedRef);
      if (!c.length && fixedRef != null && pcOf(fixedRef) === p) {
        const up = fixedRef + 12;
        const down = fixedRef - 12;
        c = [dist(up) <= dist(down) ? up : down];
      }
      if (c.length) byPc.set(p, c);
    });
    return byPc;
  }

  /* Plant alle rondes vooraf. Toonklassen komen uit een geschudde 'zak', zodat elke noot ongeveer
     even vaak langskomt en dezelfde noot niet twee keer achter elkaar komt.
     Geeft { fixedRef, available, list: [{ target, ref }] }. */
  function plan(cfg, rng) {
    rng = rng || Math.random;
    const relative = cfg.variant === "relatief";
    const midis = rangeMidis(cfg.low, cfg.high);
    let fixedRef = null;
    if (relative) {
      if (cfg.refMode === "vast") fixedRef = cfg.refMidi;
      else if (cfg.reference === "eenmalig") fixedRef = pick(midis, rng);
    }
    const randomEachRound = relative && fixedRef === null;

    const byPc = targetsByPc(cfg, fixedRef);
    const available = Array.from(byPc.keys()).sort((a, b) => a - b);

    const list = [];
    let bag = [];
    let prevPc = null;
    let prevMidi = null;
    for (let i = 0; i < cfg.rounds && available.length; i++) {
      if (!bag.length) {
        bag = shuffle(available.slice(), rng);
        const last = bag.length - 1;
        if (bag.length > 1 && bag[last] === prevPc) {
          const j = Math.floor(rng() * last);
          [bag[j], bag[last]] = [bag[last], bag[j]];
        }
      }
      const p = bag.pop();
      let cands = byPc.get(p);
      if (cands.length > 1 && prevMidi !== null) {
        const other = cands.filter((m) => m !== prevMidi);
        if (other.length) cands = other;
      }
      const target = pick(cands, rng);
      let ref = relative ? fixedRef : null;
      if (randomEachRound) {
        // Andere toonklasse dan het doel, liefst binnen een octaaf ervan
        const other = midis.filter((m) => pcOf(m) !== p);
        const near = other.filter((m) => Math.abs(m - target) <= 12);
        ref = pick(near.length ? near : other, rng);
      }
      list.push({ target, ref });
      prevPc = p;
      prevMidi = target;
    }
    return { fixedRef, available, list };
  }

  /* Samenvatting volgens het contract. */
  function computeStats(rounds) {
    const total = rounds.length;
    const correct = rounds.filter((r) => r.correct).length;
    const accuracy = total ? correct / total : 0;
    const meanTimeMs = total ? Math.round(rounds.reduce((a, r) => a + (r.timeMs || 0), 0) / total) : 0;
    const semitoneErrors = {};
    rounds.forEach((r) => {
      if (r.correct) return;
      const k = String(semitoneError(r.answerPc, r.target));
      semitoneErrors[k] = (semitoneErrors[k] || 0) + 1;
    });
    return { total, correct, accuracy: +accuracy.toFixed(4), meanTimeMs, semitoneErrors };
  }

  function scoreOf(stats) { return Math.round(stats.accuracy * 100); }

  /* Per toonklasse: hoe vaak gevraagd en hoe vaak goed. */
  function perPitchClass(rounds) {
    const out = ALL_PCS.map(() => ({ asked: 0, correct: 0 }));
    rounds.forEach((r) => {
      const p = pcOf(r.target);
      out[p].asked++;
      if (r.correct) out[p].correct++;
    });
    return out;
  }

  /* Welke verwisselingen kwamen het vaakst voor? */
  function topConfusions(rounds) {
    const map = new Map();
    rounds.forEach((r) => {
      if (r.correct) return;
      const k = pcOf(r.target) * 12 + r.answerPc;
      map.set(k, (map.get(k) || 0) + 1);
    });
    return Array.from(map, ([k, count]) => ({ targetPc: Math.floor(k / 12), answerPc: k % 12, count }))
      .sort((a, b) => b.count - a.count || a.targetPc - b.targetPc);
  }

  /* Hoe vaak koos je te laag of te hoog? (6 = tritonus, beide kanten op, telt niet mee) */
  function tendency(semitoneErrors) {
    let low = 0;
    let high = 0;
    Object.keys(semitoneErrors || {}).forEach((k) => {
      const d = +k;
      if (d < 0) low += semitoneErrors[k];
      else if (d > 0 && d < 6) high += semitoneErrors[k];
    });
    return { low, high };
  }

  function halfSteps(n) { return n + (n === 1 ? " halve toon" : " halve tonen"); }

  /* Feedbacktekst vanuit het doel gezien: "Het was E4 (2 halve tonen hoger)". err = antwoord − doel. */
  function feedbackDistance(err) {
    if (Math.abs(err) === 6) return "6 halve tonen ernaast";
    return halfSteps(Math.abs(err)) + (err < 0 ? " hoger" : " lager");
  }

  /* Vanuit jouw antwoord gezien: "2 halve tonen te laag". */
  function answerDistance(err) {
    if (Math.abs(err) === 6) return "6 halve tonen ernaast";
    return halfSteps(Math.abs(err)) + (err > 0 ? " te hoog" : " te laag");
  }

  /* "grote terts", "kwint + octaaf", "2 octaven" */
  function intervalFull(n) {
    const oct = Math.floor(n / 12);
    const rest = n % 12;
    const octTxt = oct === 1 ? "octaaf" : oct + " octaven";
    if (!rest) return octTxt;
    return INTERVALS[rest] + (oct ? " + " + octTxt : "");
  }

  function fmtSec(ms) { return (Math.max(0, ms) / 1000).toFixed(1).replace(".", ","); }

  function headline(score) {
    if (score >= 90) return "Uitstekend gehoord!";
    if (score >= 75) return "Sterk gedaan";
    if (score >= 50) return "Goed op weg";
    if (score >= 25) return "Je komt er wel";
    return "Elke ronde telt";
  }

  /* Wis-geluidje: een snel, zacht rolletje losse tonen door elkaar plus wat ruis.
     Daarna kun je de vorige noot niet meer als houvast gebruiken. */
  function wipeEvents(rng) {
    rng = rng || Math.random;
    const ev = [];
    const used = new Set();
    while (used.size < 7) used.add(42 + Math.floor(rng() * 50));
    Array.from(used).forEach((m, i) => ev.push({ t: i * 0.018, kind: "note", midi: m, dur: 0.5, level: 0.13 }));
    ev.push({ t: 0, kind: "drum", sound: "openhat", level: 0.35 });
    return ev;
  }

  /* ================= Bouwstenen voor het scherm ================= */

  /* iPhone of iPad? Daar zet de stilteknop webgeluid uit (een iPad meldt zich soms als Mac). */
  function isIOS() {
    try {
      const n = window.navigator || {};
      return /iP(hone|ad|od)/.test(n.userAgent || "") || (n.platform === "MacIntel" && n.maxTouchPoints > 1);
    } catch (e) { return false; }
  }

  /* Pianotoetsenbord van één octaaf (C t/m B) om mee te antwoorden.
     De toetsen staan in de DOM op toonhoogte (C, C♯, D …), zodat Tab en schermlezer ze in die
     volgorde langsgaan. De zwarte toetsen staan absoluut, dus de rij witte toetsen blijft heel. */
  function buildPiano({ available, onPress, later }) {
    const { h, icon } = App.ui;
    const keys = [];
    let touch = null; // vinger of pen die nu op een toets staat: { id, pc, x, y, evt }
    function endTouch() {
      if (touch) keys[touch.pc].classList.remove("is-press");
      touch = null;
    }
    for (let pc = 0; pc < 12; pc++) {
      const black = App.music.isBlack(pc);
      const name = App.music.noteName(pc, "auto");
      const letter = KEY_LETTERS[pc].toUpperCase();
      const on = available.has(pc);
      const btn = h("button", {
        type: "button",
        class: "gh-key " + (black ? "gh-key-black" : "gh-key-white"),
        style: black ? { "--x": String(BLACK_X[pc]) } : null,
        dataset: { pc: String(pc) },
        disabled: !on,
        "aria-label": on ? name : `${name}, doet niet mee`,
        "aria-keyshortcuts": on ? letter : null,
        title: on ? null : "Doet niet mee",
        onPointerdown: (e) => {
          if (!e.pointerType || e.pointerType === "mouse") {
            // Muis: meteen antwoorden, zo voelt het als een echte toets
            if (e.button !== 0) return;
            e.preventDefault(); // geen focus of tekstselectie bij klikken
            onPress(pc, e);
            return;
          }
          // Vinger of pen: pas tellen bij loslaten, zodat vegen om te scrollen geen antwoord geeft.
          // De reactietijd rekenen we wel vanaf dit moment (het event gaat mee).
          endTouch();
          touch = { id: e.pointerId, pc, x: e.clientX, y: e.clientY, evt: e };
          btn.classList.add("is-press");
        },
        onPointerup: (e) => {
          if (!touch || touch.id !== e.pointerId) return;
          const t = touch;
          endTouch();
          const moved = Math.hypot(e.clientX - t.x, e.clientY - t.y);
          if (t.pc === pc && moved <= TAP_SLOP) onPress(pc, t.evt);
        },
        onPointercancel: (e) => { if (touch && touch.id === e.pointerId) endTouch(); },
        // Alleen kliks zonder muis of vinger (bijv. schermlezer); muis en touch lopen via pointer-events
        onClick: (e) => { if (e.detail === 0) onPress(pc, e); },
      },
        h("span", { class: "gh-key-mark", "aria-hidden": "true" }),
        h("span", { class: "gh-key-name" }, name),
        h("span", { class: "gh-key-letter", "aria-hidden": "true" }, letter)
      );
      keys[pc] = btn;
    }
    const row = h("div", { class: "gh-keys", role: "group", "aria-label": "Pianotoetsen, één octaaf" }, keys);
    const el = h("div", { class: "gh-piano" }, row);
    return {
      el,
      keys,
      lock(v) { el.classList.toggle("is-locked", !!v); },
      clear() {
        keys.forEach((k) => {
          k.classList.remove("is-ok", "is-bad");
          k.querySelector(".gh-key-mark").replaceChildren();
        });
      },
      setState(pc, state) {
        const k = keys[pc];
        k.classList.add("is-" + state);
        k.querySelector(".gh-key-mark").replaceChildren(icon(state === "ok" ? "check" : "x", 14));
      },
      flash(pc) {
        const k = keys[pc];
        k.classList.add("is-press");
        later(() => k.classList.remove("is-press"), 140);
      },
    };
  }

  /* Klein toetsenbord voor het resultaat: per toets kleur, percentage en aantal. */
  function buildMiniPiano(per) {
    const { h } = App.ui;
    const items = []; // op toonhoogte, net als het speel-toetsenbord
    for (let pc = 0; pc < 12; pc++) {
      const black = App.music.isBlack(pc);
      const name = App.music.noteName(pc, "auto");
      const p = per[pc];
      const frac = p.asked ? p.correct / p.asked : null;
      const cls = frac == null ? "is-none" : frac >= 0.8 ? "is-good" : frac >= 0.5 ? "is-mid" : "is-low";
      const pct = frac == null ? "—" : Math.round(frac * 100) + "%";
      const key = h("div", {
        class: `gh-key ${black ? "gh-key-black" : "gh-key-white"} ${cls}`,
        style: black ? { "--x": String(BLACK_X[pc]) } : null,
        role: "listitem",
        "aria-label": p.asked ? `${name}: ${p.correct} van ${p.asked} goed (${pct})` : `${name}: niet gevraagd`,
        title: p.asked ? `${name}: ${p.correct} van ${p.asked} goed` : `${name}: niet gevraagd`,
      },
        h("span", { class: "gh-key-name" }, name),
        h("span", { class: "gh-key-pct" }, pct),
        !black && p.asked ? h("span", { class: "gh-key-count" }, `${p.correct}/${p.asked}`) : null
      );
      items.push(key);
    }
    return h("div", { class: "gh-piano gh-piano-mini" },
      h("div", { class: "gh-keys gh-keys-mini", role: "list", "aria-label": "Score per noot" }, items));
  }

  /* De DAW-sneltoetsen als klein toetsenbordje: bovenste rij zwarte, onderste rij witte toetsen. */
  function keyMap() {
    const { h } = App.ui;
    const cells = [];
    WHITE_PCS.forEach((pc, i) => {
      cells.push(h("div", { class: "gh-km", style: { gridColumn: `${i * 2 + 1} / span 2`, gridRow: "2" } },
        h("span", { class: "kbd" }, KEY_LETTERS[pc].toUpperCase()),
        h("span", { class: "gh-km-name" }, App.music.noteName(pc, "auto"))));
    });
    // Zwarte toetsen staan op de grens tussen twee witte
    [[1, 1], [3, 2], [6, 4], [8, 5], [10, 6]].forEach(([pc, edge]) => {
      cells.push(h("div", { class: "gh-km is-black", style: { gridColumn: `${edge * 2} / span 2`, gridRow: "1" } },
        h("span", { class: "kbd" }, KEY_LETTERS[pc].toUpperCase()),
        h("span", { class: "gh-km-name" }, App.music.noteName(pc, "auto"))));
    });
    return h("div", { class: "gh-kmap", "aria-label": "Sneltoetsen: A W S E D F T G Y H U J is C tot en met B", role: "img" }, cells);
  }

  /* ================= De pagina ================= */

  function mount(root) {
    const { h, icon } = App.ui;
    const nm = (pc) => App.music.noteName(pc, "auto");
    const lbl = (midi) => App.music.midiLabel(midi, "auto");

    const timers = new Set();
    const handles = new Set();
    let alive = true;
    let view = "setup";
    let settings = loadSettings(App.store.modeSettings(MODE, DEFAULTS));
    let session = null; // lopende sessie
    let ui = null;      // verwijzingen naar het speelscherm
    let extra = null;   // los geluid buiten een ronde (voorbeeldnoot, terugluisteren)

    /* ---------- Hulpjes voor timers en geluid (alles wordt bij opruimen gestopt) ---------- */
    function later(fn, ms) {
      const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
      timers.add(id);
      return id;
    }
    function cancel(id) {
      if (id == null) return;
      clearTimeout(id);
      timers.delete(id);
    }
    function sound(events, opts) {
      const hd = App.audio.sequence(events, opts);
      handles.add(hd);
      hd.done.then(() => handles.delete(hd));
      return hd;
    }
    function stopAllSound() {
      handles.forEach((hd) => hd.stop());
      handles.clear();
      extra = null;
    }
    async function playExtra(events) {
      try { await App.audio.ready(); } catch (e) { /* geen geluid mogelijk */ }
      if (!alive) return;
      if (extra) extra.stop();
      extra = sound(events, { lead: 0.05 });
    }

    /* ---------- Kop en houder ---------- */
    const head = App.ui.pageHead({
      eyebrow: "Gehoor",
      title: "Welke noot hoor je?",
      lead: "Train je relatieve of absolute gehoor. Je hoort een noot en kiest hem op het pianotoetsenbord.",
    });
    const body = h("div", { class: "gh" });
    root.append(head, body);

    function setView(v) {
      view = v;
      // Tijdens het spelen geen paginakop: de bovenbalk zegt genoeg, het hele speelscherm past
      // dan op een laptop of telefoon, en de link 'Start' kan je sessie niet per ongeluk afbreken.
      head.hidden = v === "play";
      root.classList.toggle("gh-playing", v === "play");
    }

    /* Iets voorlezen voor een schermlezer, alleen op stille momenten (niet over de tonen heen). */
    function announce(text) {
      if (ui && ui.live) ui.live.textContent = text;
    }

    /* Korte omschrijving van een configuratie (zonder de variant zelf). */
    function describeParts(cfg, fixedRef) {
      const notes = cfg.notes === "alle" ? "alle 12 noten" : cfg.notes === "wit" ? "witte toetsen" : cfg.pcs.length + " noten";
      const parts = [cfg.rounds + " rondes", notes, RANGES[cfg.rangeKey].span];
      if (cfg.variant === "relatief") {
        let ref;
        if (cfg.refMode === "vast") ref = "referentie " + lbl(cfg.refMidi);
        else if (fixedRef != null) ref = "referentie " + lbl(fixedRef);
        else ref = "willekeurige referentie";
        parts.push(ref + (cfg.reference === "eenmalig" ? ", eenmalig" : ", elke ronde"));
      } else {
        parts.push(cfg.wipe ? "gehoor wissen aan" : "gehoor wissen uit");
      }
      return parts;
    }

    /* ================= 1. Instellen ================= */

    function showSetup() {
      stopAllSound();
      session = null;
      ui = null;
      setView("setup");
      body.replaceChildren(buildSetup());
    }

    function variantOption(title, text, flow) {
      return h("span", { class: "gh-variant-opt" },
        h("span", { class: "gh-variant-top" }, h("span", { class: "gh-variant-title" }, title), flow),
        h("span", { class: "gh-variant-text" }, text));
    }

    function buildSetup() {
      const changed = () => { App.store.saveModeSettings(MODE, settings); sync(); };

      // Soort gehoor
      const flowRef = h("b", null, "C4");
      const variantSeg = App.ui.segmented({
        options: [
          {
            value: "relatief",
            label: variantOption("Relatief",
              "Je hoort en ziet eerst een bekende noot. Daarna benoem je een andere noot.",
              h("span", { class: "gh-flow", "aria-hidden": "true" }, flowRef, icon("next", 12), h("b", { class: "is-q" }, "?"))),
          },
          {
            value: "absoluut",
            label: variantOption("Absoluut",
              "Je hoort alleen de noot en benoemt hem zonder houvast.",
              h("span", { class: "gh-flow", "aria-hidden": "true" }, h("b", { class: "is-q" }, "?"))),
          },
        ],
        value: settings.variant, block: true, ariaLabel: "Soort gehoor",
        onChange: (v) => { settings.variant = v; changed(); },
      });
      variantSeg.classList.add("gh-variant");

      // Bereik
      const rangeSeg = App.ui.segmented({
        options: Object.keys(RANGES).map((k) => ({
          value: k,
          title: `${RANGES[k].label} (${RANGES[k].span})`,
          label: h("span", { class: "gh-two" }, RANGES[k].label, h("small", null, RANGES[k].span)),
        })),
        value: settings.range, block: true, ariaLabel: "Bereik",
        onChange: (v) => { settings.range = v; changed(); },
      });
      rangeSeg.classList.add("gh-seg-tall");

      // Rondes
      const roundsSeg = App.ui.segmented({
        options: [10, 20, 30].map((n) => ({ value: n, label: h("span", { class: "gh-two" }, String(n), h("small", null, "rondes")) })),
        value: settings.rounds, block: true, ariaLabel: "Aantal rondes",
        onChange: (v) => { settings.rounds = v; changed(); },
      });
      roundsSeg.classList.add("gh-seg-tall");

      // Noten
      const pcsChips = App.ui.chips({
        options: ALL_PCS.map((p) => ({ value: p, label: nm(p) })),
        value: settings.customPcs, min: 2, ariaLabel: "Kies de noten die meedoen",
        onChange: (v) => { settings.customPcs = v; changed(); },
      });
      const chipsWrap = h("div", { class: "gh-chips" }, pcsChips);
      const notesSeg = App.ui.segmented({
        options: [
          { value: "alle", label: "Alle 12 noten" },
          { value: "wit", label: "Alleen witte toetsen" },
          { value: "eigen", label: "Zelf kiezen" },
        ],
        value: settings.notes, block: true, ariaLabel: "Welke noten",
        onChange: (v) => { settings.notes = v; changed(); },
      });

      // Referentie (alleen relatief)
      const refSeg = App.ui.segmented({
        options: [{ value: "elke-ronde", label: "Elke ronde" }, { value: "eenmalig", label: "Eenmalig aan het begin" }],
        value: settings.reference, block: true, ariaLabel: "Hoe vaak de referentie klinkt",
        onChange: (v) => { settings.reference = v; changed(); },
      });
      const refModeSeg = App.ui.segmented({
        options: [{ value: "vast", label: "Vast" }, { value: "willekeurig", label: "Willekeurig" }],
        value: settings.refMode, block: true, ariaLabel: "Soort referentienoot",
        onChange: (v) => { settings.refMode = v; changed(); },
      });
      const refStepper = App.ui.stepper({
        value: settings.refMidi, min: REF_MIN, max: REF_MAX, step: 1, bigStep: 12,
        format: (v) => lbl(v), ariaLabel: "Referentienoot",
        onChange: (v) => { settings.refMidi = v; refValueText(v); changed(); },
      });
      // Zo noemt een schermlezer de noot ("C4") in plaats van het getal 60
      function refValueText(v) {
        refStepper.setAttribute("aria-valuenow", String(v));
        refStepper.setAttribute("aria-valuetext", lbl(v));
      }
      refValueText(settings.refMidi);
      const listenBtn = h("button", {
        type: "button", class: "btn",
        onClick: () => playExtra([{ t: 0, kind: "note", midi: settings.refMidi, dur: 1.4 }]),
      }, icon("volume", 18), "Luister");
      const refPick = h("div", { class: "gh-refpick" }, refStepper, listenBtn);
      const refHint = h("span");

      // Gehoor wissen (alleen absoluut)
      const wipeToggle = App.ui.toggle({
        checked: settings.wipe, label: "Gehoor wissen",
        onChange: (v) => { settings.wipe = v; changed(); },
      });

      const fRange = App.ui.field("Bereik", rangeSeg, "Uit dit gebied komen de noten.");
      const fRounds = App.ui.field("Rondes", roundsSeg);
      const fNotes = App.ui.field("Noten", h("div", { class: "gh-notes" }, notesSeg, chipsWrap), "Toetsen die niet meedoen, worden grijs.");
      fNotes.classList.add("gh-span");
      const fRef = App.ui.field("Referentie", refSeg,
        "Eenmalig is moeilijker: je hoort hem alleen aan het begin, en tussen de rondes wissen we je gehoor even.");
      const fRefNote = App.ui.field("Referentienoot", h("div", { class: "gh-notes" }, refModeSeg, refPick), refHint);
      const fWipe = App.ui.field("Tussen de rondes", wipeToggle,
        "Voor elke noot klinkt kort een zacht ruisje met losse tonen. Zo kun je de vorige noot niet als houvast gebruiken.");
      fWipe.classList.add("gh-span");

      const warnText = h("span");
      const warn = h("p", { class: "gh-warn", hidden: true }, icon("info", 16), warnText);
      const summary = h("p", { class: "gh-summary" });

      let starting = false;
      const startBtn = h("button", {
        type: "button", class: "btn btn-lg btn-primary gh-start",
        onClick: async () => {
          if (starting) return;
          starting = true;
          startBtn.disabled = true;
          try { await App.audio.ready(); } catch (e) { /* zonder geluid kan het niet, maar we proberen het */ }
          if (!alive || view !== "setup") return;
          startSession();
        },
      }, icon("play", 18), "Start oefening");

      function sync() {
        const rel = settings.variant === "relatief";
        fRef.hidden = !rel;
        fRefNote.hidden = !rel;
        fWipe.hidden = rel;
        chipsWrap.hidden = settings.notes !== "eigen";
        refPick.hidden = settings.refMode !== "vast";
        flowRef.textContent = settings.refMode === "vast" ? lbl(settings.refMidi) : "noot";
        refHint.textContent = settings.refMode === "vast"
          ? "Kies de noot met − en + en luister hoe hij klinkt."
          : settings.reference === "eenmalig"
            ? "Bij de start kiezen we een willekeurige noot. Je ziet welke het is."
            : "Elke ronde een andere noot. Je ziet steeds welke het is.";
        const cfg = sessionConfig(settings);
        const minutes = Math.max(1, Math.round((cfg.rounds * (rel ? 6 : 5)) / 60));
        summary.replaceChildren(
          h("b", null, rel ? "Relatief" : "Absoluut"),
          " · " + describeParts(cfg, null).join(" · ") + " · ongeveer " + minutes + " min"
        );
        // Vangnet: met minder dan twee noten valt er niets te raden
        const tooFew = cfg.pcs.length < 2;
        warn.hidden = !tooFew;
        warnText.textContent = tooFew ? "Kies minstens twee noten om te oefenen." : "";
        startBtn.disabled = tooFew || starting;
      }

      // Zijkolom: uitleg, sneltoetsen en de vorige sessie
      const mine = App.store.sessions(MODE);
      const last = mine[mine.length - 1];
      const aside = h("aside", { class: "panel gh-aside", "aria-label": "Zo werkt het" },
        h("h2", { class: "panel-title" }, "Zo werkt het"),
        h("ol", { class: "gh-steps" },
          h("li", null, "Luister. Bij relatief hoor je eerst de referentie, daarna de noot."),
          h("li", null, "Kies de naam op het toetsenbord. Welke octaaf maakt niet uit."),
          h("li", null, "Fout? Je ziet en hoort meteen welke noot het wel was.")
        ),
        h("div", { class: "gh-kbd-only" },
          h("hr", { class: "divider" }),
          h("h3", { class: "gh-aside-title" }, "Sneltoetsen"),
          keyMap(),
          h("ul", { class: "gh-shortcuts" },
            h("li", null, h("span", { class: "kbd" }, "R"), "Opnieuw horen"),
            h("li", null, h("span", { class: "kbd" }, "Enter"), "Volgende ronde"),
            h("li", null, h("span", { class: "kbd" }, "Esc"), "Stoppen")
          )
        ),
        h("hr", { class: "divider" }),
        h("p", { class: "gh-tip" }, icon("headphones", 16), "Een koptelefoon geeft de zuiverste klank."),
        isIOS() ? h("p", { class: "gh-tip" }, icon("volume", 16), "Hoor je niets? Zet de stilteknop van je iPhone of iPad uit.") : null,
        last ? h("p", { class: "gh-last" }, "Vorige keer: score ", h("b", { class: "num" }, String(Math.round(last.score || 0))),
          " · " + (last.variant === "absoluut" ? "absoluut" : "relatief") + " · " + App.ui.fmtDate(last.ts)) : null
      );

      const wrap = h("div", { class: "gh-setup" },
        h("div", { class: "gh-setup-main" },
          h("section", { class: "panel" }, h("h2", { class: "panel-title" }, "Wat wil je trainen?"), variantSeg),
          h("section", { class: "panel" },
            h("h2", { class: "panel-title" }, "Instellingen"),
            h("div", { class: "gh-fields" }, fRange, fRounds, fNotes, fRef, fRefNote, fWipe),
            warn
          ),
          h("section", { class: "panel gh-startbar" }, summary, startBtn)
        ),
        aside
      );
      sync();
      return wrap;
    }

    /* ================= 2. Spelen ================= */

    function startSession() {
      stopAllSound();
      const cfg = sessionConfig(settings);
      const planned = plan(cfg);
      if (planned.available.length < 2 || !planned.list.length) {
        App.ui.toast("Kies minstens twee noten om te oefenen.", "bad");
        showSetup();
        return;
      }
      session = {
        cfg,
        planned,
        available: new Set(planned.available),
        startedAt: Date.now(),
        index: -1,
        rounds: [],
        round: null,
      };
      setView("play");
      body.replaceChildren(buildPlay());
      window.scrollTo(0, 0);
      nextRound();
    }

    function wave() {
      return h("span", { class: "gh-wave", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"));
    }

    function buildPlay() {
      const s = session;
      const cfg = s.cfg;
      const rel = cfg.variant === "relatief";

      // Bovenbalk: ronde, voortgang per ronde, telling, stoppen
      const segs = Array.from({ length: cfg.rounds }, () => h("span", { class: "gh-seg" }));
      const roundNow = h("b", null, "1");
      const okCount = h("span", null, "0");
      const badCount = h("span", null, "0");
      const topbar = h("div", { class: "gh-topbar" },
        h("div", { class: "gh-round" }, "Ronde ", roundNow, h("span", { class: "gh-round-of" }, " / " + cfg.rounds)),
        h("div", { class: "gh-segs", "aria-hidden": "true" }, segs),
        h("div", { class: "gh-tally" },
          // Op de telefoon alleen teken + getal; de woorden blijven voor de schermlezer
          h("span", { class: "badge ok" }, icon("check", 14), okCount, h("span", { class: "gh-tally-word" }, " goed")),
          h("span", { class: "badge bad" }, icon("x", 14), badCount, h("span", { class: "gh-tally-word" }, " fout"))),
        h("button", {
          type: "button", class: "btn btn-ghost gh-stop", onClick: onStop,
          "aria-label": "Stoppen", "aria-keyshortcuts": "Escape", title: "Stoppen (Esc)",
        }, icon("stop", 14), h("span", { class: "gh-stop-text" }, "Stoppen"))
      );

      // Kaarten: referentie (relatief) en de doelnoot
      const refLabel = h("div", { class: "gh-card-label" }, "Dit is");
      const refName = h("div", { class: "gh-card-name" }, "");
      const refSub = h("div", { class: "gh-card-sub" }, "Referentie");
      const refCard = rel ? h("div", { class: "gh-card gh-card-ref" }, wave(), refLabel, refName, refSub) : null;
      const tMark = h("span", { class: "gh-card-mark", "aria-hidden": "true" });
      const tLabel = h("div", { class: "gh-card-label" }, "Welke noot?");
      const tName = h("div", { class: "gh-card-name" }, "?");
      const tSub = h("div", { class: "gh-card-sub" }, "");
      const targetCard = h("div", { class: "gh-card gh-card-target" }, tMark, wave(), tLabel, tName, tSub);

      // Melding: status tijdens luisteren, feedback na je antwoord.
      // Bewust geen aria-live hier: die tekst wisselt precies als er een toon klinkt. Een schermlezer
      // krijgt alleen de stille momenten te horen, via het aparte element 'live' hieronder.
      const status = h("p", { class: "gh-status" });
      const fbIcon = h("span", { class: "gh-fb-icon", "aria-hidden": "true" });
      const fbText = h("span");
      const fbSub = h("p", { class: "gh-feedback-sub" });
      const feedback = h("div", { class: "gh-feedback", hidden: true }, h("p", { class: "gh-feedback-main" }, fbIcon, fbText), fbSub);
      const message = h("div", { class: "gh-message" }, status, feedback);
      const live = h("p", { class: "visually-hidden", role: "status", "aria-live": "polite" });

      // Bediening. Op een smal scherm een korte tekst op de knoppen (de volledige naam staat in aria-label).
      const labels = (long, short) => [h("span", { class: "gh-long" }, long), h("span", { class: "gh-short", "aria-hidden": "true" }, short)];
      const replayCount = h("span", { class: "gh-replay-n num", "aria-hidden": "true", hidden: true });
      const replayBtn = h("button", {
        type: "button", class: "btn gh-replay", disabled: true,
        "aria-label": "Opnieuw horen", "aria-keyshortcuts": "R",
        onClick: (e) => {
          // Na een muisklik de focus loslaten, anders vangt deze knop later Enter af (bedoeld voor "Volgende")
          if (e.detail > 0) e.currentTarget.blur();
          replay();
        },
      }, icon("replay", 18), labels("Opnieuw horen", "Opnieuw"), replayCount, h("span", { class: "kbd", "aria-hidden": "true" }, "R"));
      const [nextLong, nextShort] = labels("Volgende", "Volgende");
      const nextBtn = h("button", {
        type: "button", class: "btn btn-primary gh-next", hidden: true, onClick: advance,
        "aria-label": "Volgende", "aria-keyshortcuts": "Enter",
      }, nextLong, nextShort, icon("next", 18), h("span", { class: "kbd", "aria-hidden": "true" }, "Enter"));

      const piano = buildPiano({ available: s.available, onPress: (pc, e) => answer(pc, e), later });
      const hintFine = h("span", { class: "gh-hint-fine" });
      const hintTouch = h("span", { class: "gh-hint-touch" });
      const hint = h("p", { class: "gh-hint" }, hintFine, hintTouch);

      ui = {
        segs, roundNow, okCount, badCount,
        refCard, refLabel, refName, refSub,
        targetCard, tMark, tLabel, tName, tSub,
        status, feedback, fbIcon, fbText, fbSub, live,
        replayBtn, replayCount, nextBtn, nextLong, nextShort,
        piano, hintFine, hintTouch,
      };

      return h("div", { class: "gh-play" },
        h("h1", { class: "visually-hidden" }, "Gehoor: welke noot hoor je?"),
        topbar,
        h("section", { class: "panel gh-stage", "aria-label": "Luisteren" },
          h("div", { class: "gh-cards" + (rel ? "" : " is-single") },
            refCard,
            rel ? h("div", { class: "gh-arrow", "aria-hidden": "true" }, icon("next", 22)) : null,
            targetCard),
          message,
          // 'Volgende' houdt altijd zijn plek (onzichtbaar als hij niet nodig is), zodat er niets verspringt
          h("div", { class: "gh-controls" }, replayBtn, nextBtn)
        ),
        h("section", { class: "panel gh-board", "aria-label": "Antwoord" }, piano.el, hint),
        live
      );
    }

    /* Aantal keer opnieuw gehoord in deze ronde, als klein getal op de knop. */
    function showReplays(n) {
      if (!ui) return;
      ui.replayCount.textContent = n + "×";
      ui.replayCount.hidden = !n;
      ui.replayBtn.setAttribute("aria-label", n ? `Opnieuw horen (al ${n} keer gedaan)` : "Opnieuw horen");
      if (n) ui.replayBtn.title = n === 1 ? "Deze ronde 1 keer opnieuw gehoord" : `Deze ronde ${n} keer opnieuw gehoord`;
      else ui.replayBtn.removeAttribute("title");
    }

    function setHint(kind) {
      if (!ui) return;
      if (kind === "compare") {
        ui.hintFine.textContent = "Druk gerust op andere toetsen om ze te vergelijken. Klaar? Druk op Enter.";
        ui.hintTouch.textContent = "Tik gerust op andere toetsen om ze te vergelijken.";
      } else if (kind === "wait") {
        ui.hintFine.textContent = "De volgende ronde komt eraan.";
        ui.hintTouch.textContent = "De volgende ronde komt eraan.";
      } else {
        ui.hintFine.textContent = "Klik op de noot of gebruik de letters op je toetsenbord. Welke octaaf maakt niet uit.";
        ui.hintTouch.textContent = "Tik op de noot. Welke octaaf maakt niet uit.";
      }
    }

    function nextRound() {
      const s = session;
      s.index++;
      if (s.index >= s.planned.list.length) { finish(); return; }
      const p = s.planned.list[s.index];
      s.round = {
        target: p.target, ref: p.ref,
        phase: "listening", // listening → answering → feedback
        stage: null,        // wat er nu klinkt: ref | gap | wipe | target
        replays: 0,
        targetStart: null,  // AudioContext-tijd van de eerste aanslag van de doelnoot: start van de reactietijd
        handle: null, announced: false,
        correct: null, answerPc: null, advanced: false, autoTimer: null,
      };
      renderRoundStart();
      playRound(false);
    }

    function renderRoundStart() {
      const s = session;
      const r = s.round;
      const cfg = s.cfg;
      ui.roundNow.textContent = String(s.index + 1);
      ui.segs.forEach((el, i) => el.classList.toggle("is-now", i === s.index));
      ui.piano.clear();
      ui.piano.lock(true);
      ui.targetCard.classList.remove("is-on", "is-ok", "is-bad", "is-wipe");
      ui.tMark.replaceChildren();
      ui.tLabel.textContent = "Welke noot?";
      ui.tName.textContent = "?";
      ui.tSub.textContent = "";
      if (ui.refCard) {
        const once = cfg.reference === "eenmalig";
        const live = !once || s.index === 0;
        ui.refCard.classList.remove("is-on");
        ui.refCard.classList.toggle("is-dim", !live);
        ui.refName.textContent = lbl(r.ref);
        ui.refLabel.textContent = live ? "Dit is" : "Referentie";
        ui.refSub.textContent = !live ? "Alleen aan het begin gehoord"
          : once ? "Onthoud hem goed"
            : cfg.refMode === "willekeurig" ? "Referentie van deze ronde" : "Referentie";
      }
      ui.feedback.hidden = true;
      ui.status.hidden = false;
      ui.status.textContent = s.index === 0 ? "Klaar? Daar komt hij…" : "Luister…";
      ui.nextBtn.hidden = true;
      ui.replayBtn.disabled = true;
      showReplays(0);
      setHint("answer");
    }

    function clearGlow() {
      if (!ui) return;
      if (ui.refCard) ui.refCard.classList.remove("is-on");
      ui.targetCard.classList.remove("is-on", "is-wipe");
    }

    /* Stop wat er in deze ronde klinkt. */
    function stopRound(r) {
      const hd = r.handle;
      r.handle = null;
      r.stage = null;
      if (hd) hd.stop();
      clearGlow();
    }

    /* Speel geluid voor een ronde en houd bij wanneer het klaar is. */
    function playForRound(s, r, events, lead) {
      stopRound(r);
      const hd = sound(events, { lead, onEvent: (ev) => onCue(ev, s, r) });
      r.handle = hd;
      ui.replayBtn.disabled = true;
      hd.done.then(() => {
        if (!alive || session !== s || s.round !== r || r.handle !== hd || !ui) return;
        r.handle = null;
        r.stage = null;
        clearGlow();
        if (r.phase === "listening") setAnswering(r); // vangnet als de cue niet doorkwam
        if (r.phase === "answering") promptOnce(s, r);
        ui.replayBtn.disabled = r.advanced || (r.phase === "feedback" && r.correct);
      });
      return hd;
    }

    function targetEvents(midi, t) {
      return [
        { t, kind: "note", midi, dur: T.targetDur, level: 1 },
        { t, kind: "mark", cue: "target-on" },
        { t: t + T.targetOn, kind: "mark", cue: "target-off" },
      ];
    }

    /* De ronde afspelen. isReplay: via "Opnieuw horen" (dan geen wis-geluid, en bij 'eenmalig' geen referentie). */
    function playRound(isReplay) {
      const s = session;
      const r = s.round;
      const cfg = s.cfg;
      const rel = cfg.variant === "relatief";
      const once = cfg.reference === "eenmalig";
      const withRef = rel && r.ref != null && (!once || (s.index === 0 && !isReplay));
      // Gehoor wissen vóór de noot, zodat de vorige (benoemde) noot geen houvast is:
      // bij absoluut als het aan staat, en bij relatief-eenmalig altijd (anders werkt de vorige
      // noot als nieuwe referentie). Niet in de eerste ronde (nog niets te wissen) en niet bij opnieuw horen.
      const withWipe = !isReplay && s.index > 0 && (rel ? once : cfg.wipe);
      const lead = s.index === 0 && !isReplay ? T.firstLead : T.lead;
      const events = [];
      let t = 0;
      if (withRef) {
        events.push(
          { t: 0, kind: "note", midi: r.ref, dur: T.refDur, level: 0.9 },
          { t: 0, kind: "mark", cue: "ref-on" },
          { t: T.refOn, kind: "mark", cue: "ref-off" }
        );
        t = T.refOn + (once ? T.onceGap : T.gap);
      } else if (withWipe) {
        events.push(...wipeEvents(Math.random),
          { t: 0, kind: "mark", cue: "wipe-on" },
          { t: T.wipeOn, kind: "mark", cue: "wipe-off" });
        t = T.wipeOn + T.wipeGap;
      }
      events.push(...targetEvents(r.target, t));
      const hd = playForRound(s, r, events, lead);
      // Reactietijd telt vanaf de aanslag van de doelnoot, de eerste keer dat je hem hoort.
      // Dat is ook het moment waarop de toetsen vrijkomen, dus een snel antwoord wordt nooit 0.
      if (r.targetStart == null) r.targetStart = hd.startTime + t;
    }

    /* Beeld bij geluid: kaarten laten oplichten op het moment dat je het hoort. */
    function onCue(ev, s, r) {
      if (!alive || session !== s || s.round !== r || !ui || !ev.cue) return;
      const quiet = r.phase === "feedback"; // tijdens feedback de tekst niet overschrijven
      switch (ev.cue) {
        case "ref-on":
          r.stage = "ref";
          if (ui.refCard) ui.refCard.classList.add("is-on");
          if (!quiet) ui.status.textContent = `Dit is ${lbl(r.ref)}. Luister goed…`;
          break;
        case "ref-off":
          r.stage = "gap";
          if (ui.refCard) ui.refCard.classList.remove("is-on");
          if (!quiet) ui.status.textContent = "En nu de noot…";
          break;
        case "wipe-on":
          r.stage = "wipe";
          ui.targetCard.classList.add("is-wipe");
          ui.tLabel.textContent = "Even wissen";
          if (!quiet) ui.status.textContent = "Even je gehoor wissen…";
          break;
        case "wipe-off":
          r.stage = "gap";
          ui.targetCard.classList.remove("is-wipe");
          ui.tLabel.textContent = "Welke noot?";
          if (!quiet) ui.status.textContent = "Let op, daar komt hij…";
          break;
        case "target-on":
          r.stage = "target";
          ui.targetCard.classList.add("is-on");
          if (r.phase === "listening") setAnswering(r);
          // Na 'Opnieuw horen' de vraag terugzetten (referentie en pauze hebben hem overschreven)
          else if (r.phase === "answering") ui.status.textContent = "Welke noot was dit? Kies een toets.";
          break;
        case "target-off":
          r.stage = null;
          ui.targetCard.classList.remove("is-on");
          if (r.phase === "answering") promptOnce(s, r);
          break;
      }
    }

    function setAnswering(r) {
      r.phase = "answering";
      ui.piano.lock(false);
      ui.status.textContent = "Welke noot was dit? Kies een toets.";
    }

    /* Eén keer per ronde de vraag voorlezen, pas als de doelnoot is weggeklonken. */
    function promptOnce(s, r) {
      if (r.announced) return;
      r.announced = true;
      announce(`Ronde ${s.index + 1}: welke noot was dit? Kies een toets.`);
    }

    /* Een toets is ingedrukt (muis, vinger of letter). Geeft true terug als er iets mee gebeurde. */
    function answer(pc, evt) {
      const s = session;
      if (!s || view !== "play" || !ui) return false;
      const r = s.round;
      if (!r || r.advanced) return false;
      if (r.phase === "feedback") {
        // Na een fout: toetsen vergelijken in de octaaf van de juiste noot
        if (r.correct || !s.available.has(pc)) return false;
        const midi = r.target - pcOf(r.target) + pc;
        playForRound(s, r, [{ t: 0, kind: "note", midi, dur: 1.2, level: 0.9 }], 0.02);
        return true;
      }
      if (r.phase !== "answering") {
        ui.status.textContent = "Wacht even: luister eerst naar de noot.";
        return false;
      }
      if (!s.available.has(pc)) return false;

      // Reactietijd: van de aanslag van de doelnoot tot je toets (event.timeStamp, omgerekend naar de audioklok)
      let timeMs = 0;
      try {
        if (r.targetStart != null) timeMs = Math.max(0, Math.round((App.audio.eventToAudioTime(evt) - r.targetStart) * 1000));
      } catch (e) { timeMs = 0; }
      const correct = pc === pcOf(r.target);
      r.phase = "feedback";
      r.correct = correct;
      r.answerPc = pc;
      const rec = { target: r.target, answerPc: pc, correct, referenceMidi: r.ref, timeMs, replays: r.replays };
      s.rounds.push(rec);

      // Goed terwijl de doelnoot nog klinkt: laat hem uitklinken. Anders stoppen.
      if (!correct || r.stage !== "target") stopRound(r);
      renderFeedback(s, r, rec);

      if (correct) {
        r.autoTimer = later(advance, T.autoNextMs);
      } else {
        playForRound(s, r, targetEvents(r.target, 0), T.feedbackLead);
      }
      return true;
    }

    function renderFeedback(s, r, rec) {
      const rel = s.cfg.variant === "relatief";
      const tpc = pcOf(r.target);
      const err = semitoneError(rec.answerPc, r.target);
      ui.piano.setState(tpc, "ok");
      if (!rec.correct) ui.piano.setState(rec.answerPc, "bad");

      ui.targetCard.classList.remove("is-wipe");
      ui.targetCard.classList.add(rec.correct ? "is-ok" : "is-bad");
      ui.tLabel.textContent = "Het was";
      ui.tName.textContent = lbl(r.target);
      ui.tMark.replaceChildren(icon(rec.correct ? "check" : "x", 16));
      ui.tSub.textContent = rec.correct ? "Goed" : "Jij koos " + nm(rec.answerPc);

      const seg = ui.segs[s.index];
      seg.classList.remove("is-now");
      seg.classList.add(rec.correct ? "is-ok" : "is-bad");
      const good = s.rounds.filter((x) => x.correct).length;
      ui.okCount.textContent = String(good);
      ui.badCount.textContent = String(s.rounds.length - good);

      ui.status.hidden = true;
      ui.feedback.hidden = false;
      ui.feedback.classList.toggle("is-ok", rec.correct);
      ui.feedback.classList.toggle("is-bad", !rec.correct);
      ui.fbIcon.replaceChildren(icon(rec.correct ? "check" : "x", 18));
      ui.fbText.textContent = rec.correct
        ? `Goed — het was ${lbl(r.target)}`
        : `Jij: ${nm(rec.answerPc)} · Het was ${lbl(r.target)} (${feedbackDistance(err)})`;
      let sub = "";
      if (rel && r.ref != null) {
        const d = r.target - r.ref;
        sub = d === 0
          ? "Dezelfde noot als de referentie."
          : `Van ${lbl(r.ref)} naar ${lbl(r.target)}: ${halfSteps(Math.abs(d))} ${d > 0 ? "omhoog" : "omlaag"} (${intervalFull(Math.abs(d))}).`;
      } else if (!rec.correct) {
        sub = `Luister: zo klinkt ${lbl(r.target)}.`;
      }
      ui.fbSub.textContent = sub;
      ui.fbSub.hidden = !sub;
      announce(ui.fbText.textContent + (sub ? ". " + sub : ""));

      const lastRound = s.index >= s.planned.list.length - 1;
      ui.nextLong.textContent = lastRound ? "Bekijk resultaat" : "Volgende";
      ui.nextShort.textContent = lastRound ? "Resultaat" : "Volgende";
      ui.nextBtn.setAttribute("aria-label", ui.nextLong.textContent);
      ui.nextBtn.hidden = rec.correct;
      ui.replayBtn.disabled = true;
      setHint(rec.correct ? "wait" : "compare");
    }

    function advance() {
      const s = session;
      if (!s || view !== "play") return;
      const r = s.round;
      if (!r || r.phase !== "feedback" || r.advanced) return;
      r.advanced = true;
      cancel(r.autoTimer);
      stopRound(r);
      nextRound();
    }

    function replay() {
      const s = session;
      if (!s || view !== "play" || !ui) return;
      const r = s.round;
      if (!r || r.handle || r.advanced) return; // eerst laten uitspelen
      if (r.phase === "answering") {
        r.replays++;
        showReplays(r.replays);
        playRound(true);
      } else if (r.phase === "feedback" && !r.correct) {
        playRound(true); // na een fout: telt niet mee
      }
    }

    async function onStop() {
      const s = session;
      if (!s) return;
      const r = s.round;
      if (!s.rounds.length) { showSetup(); return; }
      // Even pauzeren zolang de vraag openstaat
      if (r) { cancel(r.autoTimer); r.autoTimer = null; stopRound(r); }
      let pausedAt = 0;
      try { pausedAt = App.audio.now(); } catch (e) { pausedAt = 0; }
      const ok = await App.ui.confirm({
        title: "Oefening stoppen?",
        text: `Je hebt ${s.rounds.length} van de ${s.cfg.rounds} rondes gedaan. Een sessie die je stopt, wordt niet bewaard.`,
        ok: "Stoppen", cancel: "Doorgaan", danger: true,
      });
      if (!alive || session !== s || view !== "play") return;
      if (ok) { showSetup(); return; }
      // Doorgaan waar je was
      if (!r || r.advanced) return;
      if (r.phase === "listening") {
        r.targetStart = null;
        playRound(false);
      } else if (r.phase === "feedback" && r.correct) {
        r.autoTimer = later(advance, 600);
      } else {
        // De tijd dat het venster openstond telt niet mee als reactietijd (zelfde audioklok)
        if (r.phase === "answering" && r.targetStart != null && pausedAt) {
          try { r.targetStart += Math.max(0, App.audio.now() - pausedAt); } catch (e) { /* laten staan */ }
        }
        ui.replayBtn.disabled = false;
      }
    }

    /* ================= 3. Resultaat ================= */

    function recordSettings(cfg, planned) {
      const out = {
        lowMidi: cfg.low, highMidi: cfg.high, rounds: cfg.rounds, pitchClasses: cfg.pcs.slice(),
        range: cfg.rangeKey, notes: cfg.notes,
      };
      if (cfg.variant === "relatief") {
        out.reference = cfg.reference;
        out.referenceMode = cfg.refMode;
        out.referenceMidi = planned.fixedRef; // null = elke ronde een andere (staat per ronde in rounds)
      } else {
        out.wipe = cfg.wipe;
      }
      return out;
    }

    function finish() {
      const s = session;
      const cfg = s.cfg;
      const stats = computeStats(s.rounds);
      const score = scoreOf(stats);
      let prev = null;
      try {
        const list = App.store.sessions(MODE).filter((x) => x.variant === cfg.variant);
        prev = list[list.length - 1] || null;
      } catch (e) { prev = null; }
      const record = {
        mode: MODE,
        variant: cfg.variant,
        durationMs: Date.now() - s.startedAt,
        score,
        settings: recordSettings(cfg, s.planned),
        rounds: s.rounds.map((r) => Object.assign({}, r)),
        stats,
      };
      try {
        App.store.addSession(record);
      } catch (e) {
        console.error(e);
        App.ui.toast("Opslaan lukte niet.", "bad");
      }
      showResult(s, record, prev);
    }

    function insights(rec, rel) {
      const out = [];
      const conf = topConfusions(rec.rounds);
      if (conf.length && conf[0].count >= 2) {
        out.push(`${nm(conf[0].targetPc)} hield je ${conf[0].count}× voor ${nm(conf[0].answerPc)}.`);
      }
      const { low, high } = tendency(rec.stats.semitoneErrors);
      if (low + high >= 3 && low >= 2 * high && low > high) {
        out.push(`Je koos vaker een te lage noot (${low}×) dan een te hoge (${high}×).`);
      } else if (low + high >= 3 && high >= 2 * low && high > low) {
        out.push(`Je koos vaker een te hoge noot (${high}×) dan een te lage (${low}×).`);
      }
      if (rec.stats.total && rec.stats.correct === rec.stats.total) {
        out.push(rel
          ? "Alles goed. Tijd voor meer uitdaging: een groter bereik of een willekeurige referentie."
          : "Alles goed. Tijd voor meer uitdaging: een groter bereik of meer noten.");
      }
      return out;
    }

    function errorRow(r, i) {
      const err = semitoneError(r.answerPc, r.target);
      const n = Math.abs(err);
      const answerMidi = r.target + err; // jouw antwoord, zo dicht mogelijk bij het doel
      return h("li", { class: "gh-err" },
        h("span", { class: "gh-err-round" }, h("span", { class: "visually-hidden" }, "Ronde "), String(i + 1)),
        h("div", { class: "gh-err-main" },
          h("div", { class: "gh-err-line" },
            "Het was ", h("b", { class: "mono" }, lbl(r.target)),
            h("span", { class: "muted" }, " · jij: "), h("b", { class: "mono" }, nm(r.answerPc))),
          h("div", { class: "gh-err-sub" },
            answerDistance(err) + (n >= 1 && n <= 6 ? ` (${INTERVALS[n]})` : "") +
            (r.referenceMidi != null ? " · referentie " + lbl(r.referenceMidi) : ""))
        ),
        h("span", { class: "badge bad num", title: answerDistance(err) }, App.ui.fmtSigned(err)),
        h("button", {
          type: "button", class: "btn btn-ghost btn-icon",
          "aria-label": `Beluister ${lbl(r.target)} en daarna jouw ${nm(r.answerPc)}`,
          title: "Beluister het verschil",
          onClick: () => playExtra([
            { t: 0, kind: "note", midi: r.target, dur: 1.2 },
            { t: 0.85, kind: "note", midi: answerMidi, dur: 1.2 },
          ]),
        }, icon("play", 16))
      );
    }

    function showResult(s, rec, prev) {
      setView("result");
      ui = null;
      session = null;
      const cfg = s.cfg;
      const st = rec.stats;
      const rel = cfg.variant === "relatief";
      const replays = rec.rounds.reduce((a, r) => a + (r.replays || 0), 0);
      const tile = (node) => h("div", { class: "stat-tile" }, node);

      const title = h("h2", { class: "gh-result-title", tabindex: "-1" }, headline(rec.score));
      let delta = null;
      if (prev && typeof prev.score === "number") {
        const d = rec.score - Math.round(prev.score);
        delta = h("span", { class: "badge" + (d > 0 ? " ok" : "") },
          d === 0 ? "Gelijk aan vorige keer" : App.ui.fmtSigned(d) + " sinds vorige keer");
      }
      const headPanel = h("section", { class: "panel gh-result-head" },
        App.ui.scoreRing(rec.score, "score"),
        h("div", { class: "gh-result-text" },
          title,
          h("p", { class: "gh-result-meta" }, (rel ? "Relatief" : "Absoluut") + " · " + describeParts(cfg, s.planned.fixedRef).join(" · ")),
          delta ? h("div", { class: "row" }, delta) : null
        )
      );

      const tiles = h("section", { class: "grid-4", "aria-label": "Kerncijfers" },
        tile(App.ui.stat(`${st.correct}/${st.total}`, "goed beantwoord")),
        tile(App.ui.stat(fmtSec(st.meanTimeMs), "gemiddelde reactietijd", "s")),
        tile(App.ui.stat(String(replays), "keer opnieuw gehoord")),
        tile(App.ui.stat(App.ui.fmtDuration(rec.durationMs), "duur van de sessie"))
      );

      const tips = insights(rec, rel);
      const perPanel = h("section", { class: "panel" },
        h("h3", { class: "panel-title" }, "Per noot"),
        h("p", { class: "panel-sub" }, "Hoe vaak je elke noot goed had in deze sessie."),
        buildMiniPiano(perPitchClass(rec.rounds)),
        h("div", { class: "gh-legend", "aria-hidden": "true" },
          [["is-good", "80% of meer"], ["is-mid", "50–79%"], ["is-low", "onder 50%"], ["is-none", "niet gevraagd"]]
            .map(([c, t]) => h("span", { class: c }, h("i"), t))),
        tips.length ? h("ul", { class: "gh-insights" }, tips.map((t) => h("li", null, icon("info", 16), h("span", null, t)))) : null
      );

      const wrong = rec.rounds.map((r, i) => ({ r, i })).filter((x) => !x.r.correct);
      const errPanel = h("section", { class: "panel" },
        h("h3", { class: "panel-title" }, wrong.length ? `Fouten (${wrong.length})` : "Fouten"),
        wrong.length
          ? [h("p", { class: "panel-sub" }, "Met de afstand in halve tonen. Druk op afspelen om het verschil te horen."),
            h("ul", { class: "gh-errors" }, wrong.map(({ r, i }) => errorRow(r, i)))]
          : h("p", { class: "gh-none" }, icon("check", 18), "Geen fouten. Alles goed!")
      );

      let again = false;
      const actions = h("div", { class: "gh-actions" },
        h("button", {
          type: "button", class: "btn btn-lg btn-primary",
          onClick: async () => {
            if (again) return;
            again = true;
            try { await App.audio.ready(); } catch (e) { /* negeren */ }
            if (alive && view === "result") startSession();
          },
        }, icon("replay", 18), "Nog een keer"),
        h("button", { type: "button", class: "btn btn-lg", onClick: showSetup }, icon("instellingen", 18), "Andere instellingen"),
        h("button", { type: "button", class: "btn btn-lg btn-ghost", onClick: () => App.navigate("statistieken") }, icon("statistieken", 18), "Naar statistieken")
      );

      body.replaceChildren(h("div", { class: "gh-result" }, headPanel, tiles, h("div", { class: "gh-result-grid" }, perPanel, errPanel), actions));
      window.scrollTo(0, 0);
      try { title.focus({ preventScroll: true }); } catch (e) { /* oudere browser */ }
    }

    /* ================= Sneltoetsen ================= */

    function isTyping(el) {
      return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    }

    function onKeydown(e) {
      if (!alive || view !== "play" || !session || !ui) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // Cmd+R en dergelijke niet kapen
      if (isTyping(e.target)) return;
      if (document.querySelector(".modal-back")) return; // venster open: niets doen
      const r = session.round;
      const el = e.target && e.target.closest ? e.target : null;
      const pianoKey = el && el.closest(".gh-key");
      const otherControl = el && !pianoKey && el.closest("button, a, [role='spinbutton']");

      if (e.key === "Escape") {
        // Stoppen (met de vraag of je het zeker weet). Is er al een venster open, dan sluit dat zelf.
        e.preventDefault();
        if (!e.repeat) onStop();
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        if (otherControl) return; // laat de knop met focus zelf reageren
        e.preventDefault();
        if (e.repeat) return;
        if (r && r.phase === "feedback") { advance(); return; }
        if (pianoKey && !pianoKey.disabled) {
          const pc = +pianoKey.dataset.pc;
          if (answer(pc, e)) ui.piano.flash(pc);
        }
        return;
      }
      if (e.repeat) return;
      const k = e.key && e.key.length === 1 ? e.key.toLowerCase() : "";
      if (k === "r") { e.preventDefault(); replay(); return; }
      const pc = KEY_LETTERS.indexOf(k);
      if (pc >= 0) {
        e.preventDefault();
        if (!session.available.has(pc)) return;
        if (answer(pc, e)) ui.piano.flash(pc);
      }
    }

    // Spatie op een pianotoets: voorkom een extra klik bij het loslaten
    function onKeyup(e) {
      if (!alive || view !== "play") return;
      if (e.key === " " && e.target && e.target.closest && e.target.closest(".gh-key")) e.preventDefault();
    }

    document.addEventListener("keydown", onKeydown);
    document.addEventListener("keyup", onKeyup);
    showSetup();

    /* Opruimen bij paginawissel: luisteraars, timers en geluid weg. */
    return function cleanup() {
      alive = false;
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("keyup", onKeyup);
      timers.forEach(clearTimeout);
      timers.clear();
      stopAllSound();
      root.classList.remove("gh-playing");
      session = null;
      ui = null;
    };
  }

  App.registerMode({
    id: MODE,
    title: "Gehoor",
    nav: "Gehoor",
    description: "Absoluut of relatief gehoor: hoor een noot en kies hem op een pianotoetsenbord.",
    mount,
    // Zuivere rekenlogica, zodat die los te testen is
    logic: {
      pcOf, semitoneError, cleanPcs, loadSettings, effectivePcs, sessionConfig, targetsByPc, plan,
      computeStats, scoreOf, perPitchClass, topConfusions, tendency, feedbackDistance, answerDistance,
      intervalFull, fmtSec, wipeEvents, RANGES, DEFAULTS,
    },
  });
})();
