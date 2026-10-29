/* Maatwerk — Ritme.
   Je kiest een ritme en een tempo, hoort het eerst een paar maten (intro) en klikt daarna mee.
   Per klik zie je hoeveel milliseconden je te vroeg of te laat zat. */
(function () {
  "use strict";

  /* ================= REKENLOGICA — zuiver, zonder DOM (los te testen met node) ================= */
  const Logic = (function () {
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const round1 = (v) => Math.round(v * 10) / 10;
    const round3 = (v) => Math.round(v * 1000) / 1000;

    /* Patroonbibliotheek. `cycle` is het ritme over `cycleBeats` tellen, op een raster van `spb`
       stappen per tel (4 = zestienden, 3 = triolen). Een patroon past in een maatsoort als het
       aantal tellen per maat deelbaar is door cycleBeats. */
    const PATTERNS = [
      { id: "kwarten", name: "Kwarten", desc: "Eén noot op elke tel", spb: 4, cycleBeats: 1, cycle: [1, 0, 0, 0] },
      { id: "achtsten", name: "Achtsten", desc: "Twee gelijke noten per tel", spb: 4, cycleBeats: 1, cycle: [1, 0, 1, 0] },
      { id: "zestienden", name: "Zestienden", desc: "Vier gelijke noten per tel", spb: 4, cycleBeats: 1, cycle: [1, 1, 1, 1] },
      { id: "triolen", name: "Triolen", desc: "Drie gelijke noten per tel", spb: 3, cycleBeats: 1, cycle: [1, 1, 1] },
      { id: "gepunteerd", name: "Gepunteerd", desc: "Lang-kort: gepunteerde achtste + zestiende", spb: 4, cycleBeats: 1, cycle: [1, 0, 0, 1] },
      { id: "galop", name: "Galop", desc: "Een achtste en twee zestienden", spb: 4, cycleBeats: 1, cycle: [1, 0, 1, 1] },
      { id: "offbeat", name: "Offbeat", desc: "Alleen de ‘en’ tussen de tellen", spb: 4, cycleBeats: 1, cycle: [0, 0, 1, 0] },
      { id: "syncope", name: "Syncope", desc: "Achtste, kwart, achtste", spb: 4, cycleBeats: 2, cycle: [1, 0, 1, 0, 0, 0, 1, 0] },
      { id: "clave", name: "Clave 3-2", desc: "Drie slagen, dan twee", spb: 4, cycleBeats: 4, cycle: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0] },
      { id: "shuffle", name: "Shuffle", desc: "Triool zonder de middelste: lang-kort", spb: 3, cycleBeats: 1, cycle: [1, 0, 1] },
    ];

    const GUIDE_IDS = ["ritme", "metronoom", "stil"];

    function byId(id) { return PATTERNS.find((p) => p.id === id) || null; }
    function fits(p, beatsPerBar) { return beatsPerBar % p.cycleBeats === 0; }

    /* Eén maat van een bibliotheekpatroon, of null als het niet in de maatsoort past. */
    function barSteps(p, beatsPerBar) {
      if (!p || !fits(p, beatsPerBar)) return null;
      const out = [];
      for (let k = 0; k < beatsPerBar / p.cycleBeats; k++) out.push(...p.cycle);
      return out;
    }

    function countNotes(steps) { return (steps || []).reduce((a, s) => a + (s ? 1 : 0), 0); }

    function cleanSteps(arr, n, fallback) {
      if (!Array.isArray(arr) || arr.length !== n) return fallback.slice();
      return arr.map((v) => (v ? 1 : 0));
    }

    /* Maakt opgeslagen instellingen veilig: alles binnen de grenzen, onbekende waarden terug naar standaard. */
    function sanitizeSettings(raw, defaults) {
      const s = Object.assign({}, defaults, raw || {});
      const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? clamp(n, lo, hi) : d; };
      s.beatsPerBar = Number(s.beatsPerBar) === 3 ? 3 : 4;
      s.bpm = int(s.bpm, 40, 220, defaults.bpm);
      s.introBars = int(s.introBars, 1, 8, defaults.introBars);
      s.playBars = int(s.playBars, 2, 16, defaults.playBars);
      if (!GUIDE_IDS.includes(s.guide)) s.guide = defaults.guide;
      s.ownClick = s.ownClick === true;
      s.customGrid = Number(s.customGrid) === 3 ? 3 : 4;
      s.custom4 = cleanSteps(s.custom4, 16, defaults.custom4);
      s.custom3 = cleanSteps(s.custom3, 12, defaults.custom3);
      if (s.pattern !== "eigen") {
        const p = byId(s.pattern);
        if (!p || !fits(p, s.beatsPerBar)) s.pattern = defaults.pattern;
      }
      return s;
    }

    /* Welk ritme hoort bij deze instellingen: { id, name, spb, steps } (steps = één maat). */
    function resolvePattern(s) {
      if (s.pattern === "eigen") {
        const spb = s.customGrid === 3 ? 3 : 4;
        const src = spb === 3 ? s.custom3 : s.custom4;
        return { id: "eigen", name: "Eigen ritme", spb, steps: src.slice(0, s.beatsPerBar * spb) };
      }
      const p = byId(s.pattern);
      return { id: p.id, name: p.name, spb: p.spb, steps: barSteps(p, s.beatsPerBar) };
    }

    /* De hele sessie als tijdlijn. Alle tijden in ms vanaf t = 0 (de eerste tel van de intro). */
    function buildPlan({ steps, stepsPerBeat, beatsPerBar, bpm, introBars, playBars }) {
      const beatMs = 60000 / bpm;
      const stepMs = beatMs / stepsPerBeat;
      const barMs = beatMs * beatsPerBar;
      const totalBars = introBars + playBars;
      const notes = [];
      let playIdx = 0;
      for (let bar = 0; bar < totalBars; bar++) {
        const intro = bar < introBars;
        for (let step = 0; step < steps.length; step++) {
          if (!steps[step]) continue;
          notes.push({ t: bar * barMs + step * stepMs, bar, step, intro, i: intro ? -1 : playIdx++ });
        }
      }
      // Kleinste afstand tussen twee opeenvolgende noten (ook over de maatstreep heen)
      let minGap = Infinity;
      for (let k = 1; k < notes.length; k++) minGap = Math.min(minGap, notes[k].t - notes[k - 1].t);
      if (!Number.isFinite(minGap)) minGap = barMs;
      const windowMs = Math.min(150, 0.45 * minGap);
      const introMs = introBars * barMs;
      const totalMs = totalBars * barMs;
      const playNotes = notes.filter((n) => !n.intro);
      const lastPlayMs = playNotes.length ? playNotes[playNotes.length - 1].t : totalMs;
      return {
        beatMs, stepMs, barMs, totalBars, introBars, playBars, beatsPerBar, stepsPerBeat,
        stepsPerBar: steps.length,
        introMs, totalMs,
        notes,
        playCount: playIdx,
        minGapMs: minGap,
        windowMs,
        lastPlayMs,
        // Klikken tellen mee tot na de laatste meekliknoot. Een afsluitende tik op de 1 van de
        // volgende maat (of tot een halve tel ervoor) telt niet meer als extra.
        endCutMs: Math.max(lastPlayMs + windowMs, totalMs - beatMs / 2),
        // Tot hoe ver een klik naast een noot nog 'in de buurt' heet (voor de uitleg bij een extra klik)
        nearMs: Math.max(stepMs, 2 * windowMs),
      };
    }

    /* Geluiden voor App.audio.sequence (t in seconden). Intro: ritme + metronoom.
       Meeklikken: afhankelijk van de begeleiding. Op de 1 na de laatste maat een zachte slottik,
       zodat je hoort dat het klaar is (een klik daarop telt niet mee). */
    function buildEvents(plan, steps, guide) {
      const ev = [];
      for (let bar = 0; bar < plan.totalBars; bar++) {
        const intro = bar < plan.introBars;
        const t0 = bar * plan.barMs;
        if (intro || guide !== "stil") {
          for (let b = 0; b < plan.beatsPerBar; b++) {
            ev.push({ t: (t0 + b * plan.beatMs) / 1000, kind: "click", voice: "click", accent: b === 0, level: 0.75 });
          }
        }
        if (intro || guide === "ritme") {
          for (let s = 0; s < steps.length; s++) {
            if (steps[s]) ev.push({ t: (t0 + s * plan.stepMs) / 1000, kind: "drum", sound: "rim", level: 1 });
          }
        }
      }
      ev.push({ t: plan.totalMs / 1000, kind: "click", voice: "wood", accent: true, level: 0.5, end: true });
      return ev;
    }

    /* ---------- Klikken koppelen aan noten ---------- */
    function createMatcher(plan) {
      return {
        notes: plan.notes,
        taken: new Array(plan.notes.length).fill(null), // afwijking in ms per noot, null = nog vrij
        windowMs: plan.windowMs,
        nearMs: plan.nearMs || plan.windowMs,
        playStartMs: plan.introMs,
        clicks: [],
      };
    }

    /* Koppel één klik (positie in ms op de tijdlijn) aan de dichtstbijzijnde nog vrije noot binnen
       het venster. Anders is het een extra klik. `intro` = telt niet mee. */
    function matchClick(m, posMs) {
      const w = m.windowMs;
      const notes = m.notes;
      let lo = 0, hi = notes.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].t < posMs - w) lo = mid + 1; else hi = mid; }
      let best = -1, bestDist = Infinity;
      for (let k = lo; k < notes.length && notes[k].t <= posMs + w; k++) {
        if (m.taken[k] !== null) continue;
        const d = Math.abs(posMs - notes[k].t);
        if (d < bestDist) { bestDist = d; best = k; }
      }
      let res;
      if (best >= 0) {
        const off = posMs - notes[best].t;
        m.taken[best] = off;
        res = { kind: "hit", noteIndex: best, note: notes[best], offsetMs: off, intro: notes[best].intro };
      } else {
        // Geen vrije noot binnen het venster. Zoek toch de dichtstbijzijnde noot (ook bezet of verder
        // weg), zodat we kunnen uitleggen waarom dit een extra klik is.
        let a = 0, b = notes.length;
        while (a < b) { const mid = (a + b) >> 1; if (notes[mid].t < posMs) a = mid + 1; else b = mid; }
        let near = -1, nearDist = Infinity;
        for (const k of [a - 1, a]) {
          if (k < 0 || k >= notes.length) continue;
          const d = Math.abs(posMs - notes[k].t);
          if (d < nearDist) { nearDist = d; near = k; }
        }
        const nearOffsetMs = near >= 0 ? posMs - notes[near].t : null;
        let reason = "none";
        if (near >= 0 && m.taken[near] !== null && nearDist <= w) reason = "double";
        else if (near >= 0 && nearDist <= m.nearMs) reason = "far";
        res = {
          kind: "extra", noteIndex: -1, note: null, offsetMs: null, intro: posMs < m.playStartMs - w,
          near, nearOffsetMs, reason,
        };
      }
      res.posMs = posMs;
      m.clicks.push(res);
      return res;
    }

    function classify(off) {
      if (off == null) return "miss";
      if (Math.abs(off) <= 10) return "ok";
      return off < 0 ? "early" : "late";
    }

    /* Eén regel per verwachte noot in het meeklikdeel, zoals CONTRACT.md vraagt. */
    function buildHits(m, plan) {
      const hits = [];
      m.notes.forEach((n, k) => {
        if (n.intro) return;
        const off = m.taken[k];
        hits.push({
          i: n.i,
          bar: n.bar - plan.introBars,
          step: n.step,
          expectedMs: round1(n.t - plan.introMs),
          offsetMs: off == null ? null : round1(off),
        });
      });
      return hits;
    }

    function countExtras(m) { return m.clicks.filter((c) => c.kind === "extra" && !c.intro).length; }

    function median(arr) {
      if (!arr.length) return null;
      const a = arr.slice().sort((x, y) => x - y);
      const mid = a.length >> 1;
      return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
    }

    function computeStats(hits, extras) {
      const offs = hits.filter((x) => x.offsetMs != null).map((x) => x.offsetMs);
      const n = offs.length;
      const stats = {
        expected: hits.length, matched: n, missed: hits.length - n, extras,
        meanAbsMs: null, meanMs: null, stdMs: null, medianAbsMs: null, earlyPct: 0, latePct: 0,
      };
      if (!n) return stats;
      const abs = offs.map(Math.abs);
      const mean = offs.reduce((a, b) => a + b, 0) / n;
      stats.meanAbsMs = round1(abs.reduce((a, b) => a + b, 0) / n);
      stats.meanMs = round1(mean);
      stats.stdMs = round1(Math.sqrt(offs.reduce((a, o) => a + (o - mean) * (o - mean), 0) / n));
      stats.medianAbsMs = round1(median(abs));
      stats.earlyPct = round3(offs.filter((o) => o < 0).length / n);
      stats.latePct = round3(offs.filter((o) => o > 0).length / n);
      return stats;
    }

    /* Score volgens CONTRACT: ≤ 10 ms = perfect, ≥ 100 ms = 0, gemist = 0, elke extra klik −2. */
    function noteScore(off) { return off == null ? 0 : clamp(1 - (Math.abs(off) - 10) / 90, 0, 1); }
    function computeScore(hits, extras) {
      if (!hits.length) return 0;
      const avg = hits.reduce((a, x) => a + noteScore(x.offsetMs), 0) / hits.length;
      return Math.round(clamp(100 * avg - 2 * extras, 0, 100));
    }

    /* ---------- Teksten ---------- */
    function tempoWord(bpm) {
      if (bpm < 60) return "Heel langzaam";
      if (bpm < 80) return "Langzaam";
      if (bpm < 100) return "Rustig";
      if (bpm < 120) return "Gemiddeld";
      if (bpm < 140) return "Vlot";
      if (bpm < 170) return "Snel";
      return "Heel snel";
    }

    /* Neiging als één woord, op de afgeronde waarde, zodat zin, tegel en grafiek altijd hetzelfde zeggen.
       null = geen geraakte noten, 'ok' = gemiddeld minder dan 3 ms ernaast. */
    function tendencyKind(meanMs) {
      if (meanMs == null) return null;
      if (Math.round(Math.abs(meanMs)) < 3) return "ok";
      return meanMs > 0 ? "late" : "early";
    }

    /* Afgerond met teken, altijd op dezelfde manier (ook bij −2,5): "+3", "−3", "0". */
    function signedInt(v) {
      const a = Math.round(Math.abs(v));
      if (!a) return "0";
      return (v < 0 ? "−" : "+") + a;
    }

    function tendencyText(meanMs) {
      const k = tendencyKind(meanMs);
      if (!k) return "Je hebt geen noten geraakt.";
      if (k === "ok") return "Je zit gemiddeld precies op de tel.";
      return `Je zit gemiddeld ${Math.round(Math.abs(meanMs))} ms te ${k === "late" ? "laat" : "vroeg"}.`;
    }

    /* Zijn twee rondes eerlijk te vergelijken? Zelfde ritme, maatsoort, raster, tempo en begeleiding;
       bij een eigen ritme ook precies dezelfde vakjes. */
    function sameSetup(a, b) {
      if (!a || !b) return false;
      if (a.pattern !== b.pattern || a.beatsPerBar !== b.beatsPerBar || a.bpm !== b.bpm || a.guide !== b.guide) return false;
      if ((a.stepsPerBeat || 4) !== (b.stepsPerBeat || 4)) return false;
      if (a.pattern === "eigen") {
        return Array.isArray(a.steps) && Array.isArray(b.steps) && a.steps.join("") === b.steps.join("");
      }
      return true;
    }

    /* Samenvatting per maat (voor de grafiek als er te veel noten zijn voor losse stippen). */
    function barSummary(hits, playBars) {
      const out = [];
      for (let b = 0; b < playBars; b++) {
        const list = hits.filter((x) => x.bar === b);
        const offs = list.filter((x) => x.offsetMs != null).map((x) => x.offsetMs);
        const n = offs.length;
        out.push({
          bar: b, total: list.length, matched: n, missed: list.length - n,
          mean: n ? offs.reduce((a, v) => a + v, 0) / n : null,
          min: n ? Math.min(...offs) : null,
          max: n ? Math.max(...offs) : null,
        });
      }
      return out;
    }

    function verdict(score) {
      if (score >= 90) return "Strak als een metronoom";
      if (score >= 75) return "Mooi strak";
      if (score >= 55) return "Goed op weg";
      if (score >= 35) return "Het begin is er";
      return "Nog even zoeken";
    }

    /* Plaats van een noot in woorden: "maat 2, tel 3-en". */
    function posLabel(bar, step, spb) {
      const beat = Math.floor(step / spb) + 1;
      const sub = step % spb;
      let s = `maat ${bar + 1}, tel ${beat}`;
      if (sub === 0) return s;
      if (spb === 4 && sub === 2) return s + "-en";
      return s + `, ${sub + 1}e ${spb === 3 ? "triool" : "zestiende"}`;
    }

    /* Hoe hoog de grafiek moet gaan (ms boven en onder de nullijn) en waar de rasterlijnen komen. */
    function chartRange(maxAbs) {
      const options = [[30, 15], [50, 25], [75, 25], [100, 50], [150, 50]];
      const need = Math.max(0, maxAbs || 0) * 1.1;
      const pick = options.find(([max]) => max >= need) || options[options.length - 1];
      const [max, step] = pick;
      const ticks = [];
      for (let t = -max; t <= max + 1e-9; t += step) ticks.push(Math.round(t));
      return { max, ticks };
    }

    /* Hooguit twee concrete tips op basis van de uitslag. Een tip kan een actie hebben
       ({bpm} of {guide}): daar maakt het resultaatscherm een knop "Nog een keer ..." van. */
    function advice(st, s, score, calibrated) {
      const tips = [];
      const slower = Math.max(40, Math.round((s.bpm * 0.85) / 5) * 5);
      const slowerAction = slower < s.bpm ? { bpm: slower } : null;
      if (!st.matched) {
        return [{ text: "Je hebt nog geen noot geraakt. Begin met Kwarten op een rustig tempo. Tel tijdens de intro mee en klik vanaf de eerste tel na het aftellen." }];
      }
      if (!calibrated && st.meanMs >= 35 && st.stdMs < 45) {
        tips.push({ text: `Je zit steeds zo’n ${Math.round(st.meanMs)} ms te laat. Dat kan aan de vertraging van je geluid liggen: kalibreer die eerst.`, link: true });
      } else if (st.meanMs >= 15) {
        tips.push({ text: "Je zit vaak net achter de tel. Probeer de tel aan te voelen komen, in plaats van te reageren op wat je hoort." });
      } else if (st.meanMs <= -15) {
        tips.push({ text: "Je haast een beetje: je klikt vaak vóór de noot. Ontspan en laat de tel naar je toe komen." });
      }
      if (st.missed > st.expected * 0.2) {
        tips.push(slowerAction
          ? { text: `Je miste ${st.missed} van de ${st.expected} noten. Probeer het eens op ${slower} bpm.`, action: slowerAction }
          : { text: `Je miste ${st.missed} van de ${st.expected} noten. Kies een eenvoudiger ritme, zoals Kwarten of Achtsten.` });
      } else if (st.stdMs >= 25) {
        tips.push(slowerAction
          ? { text: `Je timing wisselt nog (spreiding ${Math.round(st.stdMs)} ms). Op een lager tempo, bijvoorbeeld ${slower} bpm, bouw je rust op.`, action: slowerAction }
          : { text: `Je timing wisselt nog (spreiding ${Math.round(st.stdMs)} ms). Tel hardop mee, dan bouw je rust op.` });
      }
      if (st.extras >= 3) {
        tips.push({ text: `Je klikte ${st.extras} keer waar geen noot was. Klik alleen de noten van het ritme, niet elke tel.` });
      }
      if (!tips.length) {
        if (score >= 90) {
          if (s.guide === "ritme") tips.push({ text: "Heel strak! Maak het moeilijker: kies ‘Alleen metronoom’, dan komt het ritme helemaal van jou.", action: { guide: "metronoom" } });
          else if (s.guide === "metronoom") tips.push({ text: "Heel strak! Durf je ‘Stilte’? Dan houd je ook het tempo zelf vast.", action: { guide: "stil" } });
          else if (s.bpm < 220) tips.push({ text: `Heel strak, zelfs in stilte. Probeer het eens op ${Math.min(220, s.bpm + 10)} bpm.`, action: { bpm: Math.min(220, s.bpm + 10) } });
          else tips.push({ text: "Heel strak, zelfs in stilte en op het hoogste tempo. Probeer een moeilijker ritme, zoals de Clave." });
        } else {
          tips.push({ text: "Mooi gelijkmatig. Herhaal deze instelling een paar keer: constant blijven is de echte winst." });
        }
      }
      return tips.slice(0, 2);
    }

    return {
      clamp, round1, PATTERNS, byId, fits, barSteps, countNotes, sanitizeSettings, resolvePattern,
      buildPlan, buildEvents, createMatcher, matchClick, classify, buildHits, countExtras,
      computeStats, noteScore, computeScore, tempoWord, tendencyKind, signedInt, tendencyText,
      sameSetup, barSummary, verdict, posLabel, chartRange, advice,
    };
  })();
  /* ======================================= EINDE REKENLOGICA ======================================= */

  const ui = App.ui;
  const { h, icon } = ui;
  const MODE = "ritme";

  const GUIDES = [
    { value: "ritme", label: "Ritme + metronoom" },
    { value: "metronoom", label: "Alleen metronoom" },
    { value: "stil", label: "Stilte" },
  ];
  const GUIDE_HINT = {
    ritme: "Het makkelijkst: het ritme speelt gewoon door.",
    metronoom: "Je hoort alleen de tellen. Het ritme komt van jou, dus de noten lichten niet meer op.",
    stil: "Het moeilijkst: je hoort én ziet geen tel meer. Je houdt tempo en ritme zelf vast.",
  };
  const GO_SUB = {
    ritme: "Klik mee met het ritme",
    metronoom: "Klik het ritme, de metronoom tikt door",
    stil: "Houd het ritme vast, in stilte",
  };
  const WORD = { ok: "raak", early: "te vroeg", late: "te laat", miss: "gemist" };
  const BADGE = { ok: "ok", early: "early", late: "late", miss: "bad" };

  const DEFAULTS = {
    pattern: "achtsten",
    beatsPerBar: 4,
    bpm: 90,
    introBars: 2,
    playBars: 4,
    guide: "metronoom",
    ownClick: false,
    customGrid: 4,
    custom4: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0],
    custom3: [1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0],
  };

  const pct = (x) => (x * 100).toFixed(3) + "%";
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const kbd = (t) => h("span", { class: "kbd" }, t);
  const msInt = (v) => (v == null ? "—" : String(Math.round(v)));
  const ARM_MS = 700;      // zo lang zijn de resultaatknoppen nog niet klikbaar (tegen doortikken)
  const GUARD_MS = 1200;   // zo lang vangen we Spatie/J/F nog af op het resultaatscherm

  function isTypingTarget(el) {
    return !!(el && el.closest && el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
  }

  const isTapKey = (e) => e.code === "Space" || e.key === " " || e.key === "j" || e.key === "J" || e.key === "f" || e.key === "F";

  /* iPhone en iPad (ook iPadOS dat zich als Mac voordoet). */
  function isIOS() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  /* iPhone-geluid (audioSession 'playback') regelt de basis nu zelf in App.audio.ensure().
     De speelstand (onderbalk weg op de telefoon) zet App.setPlaying. */

  /* Mini-notatie: per tel een groepje blokjes; gekleurd = noot. */
  function miniNotation(steps, spb) {
    const el = h("span", { class: "rt-mini", "aria-hidden": "true" });
    const blocks = [];
    for (let b = 0; b < steps.length / spb; b++) {
      const g = h("span", { class: "rt-mini-beat" });
      for (let s = 0; s < spb; s++) {
        const i = h("i", { class: steps[b * spb + s] ? "on" : null });
        blocks.push(i);
        g.append(i);
      }
      el.append(g);
    }
    return { el, blocks };
  }

  App.registerMode({
    id: MODE,
    title: "Ritme",
    nav: "Ritme",
    description: "Hoor een ritme, klik mee en zie per klik hoeveel milliseconden je te vroeg of te laat was.",

    mount(root) {
      let disposed = false;
      let S = Logic.sanitizeSettings(App.store.modeSettings(MODE, DEFAULTS), DEFAULTS);
      let screen = "setup";
      let saveTimer = null;
      let preview = null;        // lopende 'Beluister'-reeks
      let previewStep = -1;
      let run = null;            // lopende sessie
      let starting = false;
      let rafId = 0;
      let chartCleanup = null;   // opruimen van de grafiek (ResizeObserver + luisteraars)
      let undoTimer = null;      // 'Herstel' na 'Wissen' in de stappeneditor
      let armTimer = null;       // resultaatknoppen pas na ARM_MS klikbaar
      let resultReadyAt = 0;     // vanaf dit moment werkt R voor 'Nog een keer'
      let resultGuardUntil = 0;  // tot dit moment vangen we doorgetikte Spatie/J/F af
      const setup = {};          // verwijzingen naar elementen van het instelscherm

      const head = ui.pageHead({
        eyebrow: "Ritme",
        title: "Klik mee met het ritme",
        lead: "Kies een ritme en een tempo. Je hoort het eerst een paar maten, daarna klik je mee. Per klik zie je hoeveel milliseconden je te vroeg of te laat zat.",
      });
      const body = h("div", { class: "rt-body" });
      const live = h("div", { class: "visually-hidden", "aria-live": "polite" });
      root.append(head, body, live);

      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);
      document.addEventListener("visibilitychange", onVisibility);

      showSetup();

      /* Wissel van scherm (instellen / spelen / resultaat) met een korte, rustige overgang.
         De allereerste keer niet: dan fadet de hele pagina al in (view-in uit base.css). */
      function swapScreen(...nodes) {
        body.replaceChildren(...nodes.filter(Boolean));
        const first = !body.dataset.shown;
        body.dataset.shown = "1";
        if (!first && !reducedMotion() && body.animate) {
          body.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
            { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
        }
      }

      function focusQuiet(el) {
        if (!el) return;
        try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
      }

      function leaveResult() {
        clearTimeout(armTimer);
        armTimer = null;
        resultReadyAt = 0;
        resultGuardUntil = 0;
      }

      /* ============================== Instellen ============================== */

      /* focusStart: zet de focus op Start (na Stop, Esc of 'Andere instellingen'), zodat je met het
         toetsenbord meteen verder kunt. */
      function showSetup(focusStart) {
        screen = "setup";
        App.setPlaying(false);
        dropChart();
        leaveResult();
        head.hidden = false;
        const calibrated = (Number(App.store.getSetting("latencyMs", 0)) || 0) !== 0;

        // --- Ritme kiezen ---
        setup.meterSeg = ui.segmented({
          options: [{ value: 4, label: "4/4" }, { value: 3, label: "3/4" }],
          value: S.beatsPerBar,
          ariaLabel: "Maatsoort",
          onChange: setMeter,
        });
        setup.cards = h("div", { class: "rt-patterns", role: "group", "aria-label": "Ritmes" });
        setup.editorWrap = h("div", { class: "rt-editor" });
        // Beluisteren staat ook vlak bij de kaartjes: kiezen, horen, vergelijken zonder scrollen
        setup.headPreview = h("button", { type: "button", class: "btn rt-preview-head", onClick: togglePreview });
        const patternPanel = h("section", { class: "panel" },
          h("div", { class: "rt-panel-head" },
            h("div", null,
              h("h2", { class: "panel-title" }, "Kies een ritme"),
              h("p", { class: "rt-panel-sub" }, "Elke groep blokjes is één tel. Een gekleurd blokje is een noot.")
            ),
            h("div", { class: "rt-head-tools" },
              h("div", { class: "rt-meter-pick" }, h("span", { class: "rt-meter-label" }, "Maatsoort"), setup.meterSeg),
              setup.headPreview
            )
          ),
          setup.cards,
          setup.editorWrap
        );

        // --- Tempo en lengte ---
        setup.bpmHint = h("span");
        setup.introHint = h("span");
        setup.playHint = h("span");
        setup.guideHint = h("span");
        const bpm = ui.stepper({
          value: S.bpm, min: 40, max: 220, step: 1, bigStep: 10, unit: "bpm", ariaLabel: "Tempo in bpm",
          onChange: (v) => { S.bpm = v; stopPreview(); changed(); },
        });
        const intro = ui.stepper({
          value: S.introBars, min: 1, max: 8, ariaLabel: "Aantal maten intro",
          onChange: (v) => { S.introBars = v; changed(); },
        });
        const play = ui.stepper({
          value: S.playBars, min: 2, max: 16, ariaLabel: "Aantal maten meeklikken",
          onChange: (v) => { S.playBars = v; changed(); },
        });
        const guide = ui.segmented({
          options: GUIDES, value: S.guide, ariaLabel: "Wat je hoort tijdens het meeklikken",
          onChange: (v) => { S.guide = v; changed(); },
        });
        const own = ui.toggle({
          checked: S.ownClick, label: "Hoor je eigen klik",
          onChange: (v) => { S.ownClick = !!v; changed(); },
        });
        const settingsPanel = h("section", { class: "panel" },
          h("h2", { class: "panel-title" }, "Tempo en lengte"),
          h("div", { class: "rt-fields" },
            ui.field("Tempo", bpm, setup.bpmHint),
            ui.field("Intromaten (luisteren)", intro, setup.introHint),
            ui.field("Meeklikmaten", play, setup.playHint)
          ),
          h("div", { class: "rt-guide" },
            ui.field("Tijdens meeklikken hoor je", guide, setup.guideHint),
            h("div", { class: "rt-own" },
              own,
              h("p", { class: "field-hint" }, "Je hoort een zacht geluidje bij elke klik. Handig in stilte en op een telefoon. Met bluetooth klinkt het wat later.")
            )
          )
        );

        // --- Tip over vertraging ---
        const tip = calibrated ? null : h("aside", { class: "rt-tip" },
          icon("headphones", 18),
          h("p", null,
            h("strong", null, "Tip: "),
            "kalibreer eerst de vertraging van je geluid, zeker met bluetooth-oortjes. Anders lijkt het alsof je steeds te laat bent. ",
            h("a", { href: "#/instellingen" }, "Naar kalibreren")
          )
        );

        // --- Start ---
        setup.startBtn = h("button", { type: "button", class: "btn btn-lg btn-primary rt-start", onClick: () => startRun() }, icon("play", 18), "Start");
        setup.previewBtn = h("button", { type: "button", class: "btn btn-lg rt-preview", onClick: togglePreview });
        setup.summary = h("p", { class: "rt-summary" });
        setup.warn = h("p", { class: "rt-warn", role: "status" });
        const last = App.store.sessions(MODE).slice(-1)[0];
        const lastLine = last ? h("p", { class: "rt-last" }, icon("clock", 14),
          `Laatste keer: ${Math.round(last.score || 0)} punten · ${(last.settings && last.settings.patternName) || "Ritme"}` +
          (last.settings && last.settings.bpm ? ` · ${last.settings.bpm} bpm` : "")) : null;
        // iPhone/iPad: Web Audio is stil als de stille modus aan staat
        const iosLine = isIOS() ? h("p", { class: "rt-last" }, icon("volume", 14), "Hoor je niets? Zet de stille modus van je iPhone of iPad uit.") : null;

        const actions = h("section", { class: "rt-actions-wrap" },
          h("div", { class: "rt-actions" }, setup.startBtn, setup.previewBtn),
          h("div", { class: "rt-actions-info" }, setup.summary, setup.warn, lastLine, iosLine)
        );

        // Let op: tip kan null zijn (al gekalibreerd); swapScreen filtert dat eruit
        swapScreen(patternPanel, settingsPanel, tip, actions);
        renderCards();
        renderEditor();
        updatePreviewBtn();
        refreshSummary();
        if (focusStart) focusQuiet(setup.startBtn);
      }

      function renderCards() {
        setup.cards.replaceChildren();
        setup.cardEls = {};
        setup.miniBlocks = {};
        Logic.PATTERNS.forEach((p) => {
          const ok = Logic.fits(p, S.beatsPerBar);
          const mini = miniNotation(Logic.barSteps(p, ok ? S.beatsPerBar : 4), p.spb);
          setup.miniBlocks[p.id] = mini.blocks;
          const card = h("button", {
            type: "button", class: "rt-card",
            "aria-pressed": String(S.pattern === p.id),
            disabled: ok ? null : true,
            title: ok ? null : `${p.name} past alleen in 4/4`,
            onClick: () => selectPattern(p.id),
          },
            h("span", { class: "rt-card-top" },
              h("span", { class: "rt-card-name" }, p.name),
              ok ? h("span", { class: "rt-card-check" }, icon("check", 12)) : h("span", { class: "rt-card-tag" }, "alleen 4/4")
            ),
            mini.el,
            h("span", { class: "rt-card-desc" }, p.desc)
          );
          setup.cardEls[p.id] = card;
          setup.cards.append(card);
        });
        // Eigen ritme
        const own = Logic.resolvePattern(Object.assign({}, S, { pattern: "eigen" }));
        const mini = miniNotation(own.steps, own.spb);
        setup.miniBlocks.eigen = mini.blocks;
        setup.ownMini = mini.el;
        const ownCard = h("button", {
          type: "button", class: "rt-card rt-card-own",
          "aria-pressed": String(S.pattern === "eigen"),
          onClick: () => selectPattern("eigen"),
        },
          h("span", { class: "rt-card-top" },
            h("span", { class: "rt-card-name" }, "Eigen ritme"),
            h("span", { class: "rt-card-check" }, icon("check", 12)),
            h("span", { class: "rt-card-plus" }, icon("plus", 14))
          ),
          mini.el,
          h("span", { class: "rt-card-desc" }, "Klik zelf een maat in elkaar")
        );
        setup.cardEls.eigen = ownCard;
        setup.cards.append(ownCard);
      }

      function updateOwnMini() {
        const own = Logic.resolvePattern(Object.assign({}, S, { pattern: "eigen" }));
        const mini = miniNotation(own.steps, own.spb);
        setup.ownMini.replaceWith(mini.el);
        setup.ownMini = mini.el;
        setup.miniBlocks.eigen = mini.blocks;
      }

      function renderEditor() {
        const wrap = setup.editorWrap;
        wrap.replaceChildren();
        setup.editorBtns = [];
        if (S.pattern !== "eigen") { wrap.hidden = true; return; }
        wrap.hidden = false;
        const spb = S.customGrid;
        const arr = spb === 3 ? S.custom3 : S.custom4;
        // data-beats/data-spb: de CSS kiest daarmee hoeveel tellen naast elkaar passen (container query)
        const grid = h("div", {
          class: "rt-steps",
          dataset: { beats: String(S.beatsPerBar), spb: String(spb) },
          style: { "--beats": String(S.beatsPerBar), "--spb": String(spb) },
        });
        for (let b = 0; b < S.beatsPerBar; b++) {
          const row = h("div", { class: "rt-steps-row" });
          for (let s = 0; s < spb; s++) {
            const idx = b * spb + s;
            const glyph = s === 0 ? String(b + 1) : spb === 4 && s === 2 ? "en" : "·";
            const btn = h("button", {
              type: "button",
              class: "rt-step" + (s === 0 ? " is-beat" : ""),
              "aria-pressed": String(!!arr[idx]),
              "aria-label": Logic.posLabel(0, idx, spb).replace("maat 1, ", ""),
              onClick: () => toggleStep(idx),
            }, glyph);
            setup.editorBtns.push(btn);
            row.append(btn);
          }
          grid.append(h("div", { class: "rt-steps-beat" }, h("div", { class: "rt-steps-label" }, "Tel " + (b + 1)), row));
        }
        const gridSeg = ui.segmented({
          options: [{ value: 4, label: "Zestienden" }, { value: 3, label: "Triolen" }],
          value: spb, ariaLabel: "Raster van het eigen ritme",
          onChange: (v) => { S.customGrid = v; stopPreview(); renderEditor(); updateOwnMini(); changed(); },
        });
        setup.clearBtn = h("button", { type: "button", class: "btn btn-ghost rt-clear", onClick: clearOrUndo });
        setup.editorCount = h("span", { class: "rt-editor-count" });
        wrap.append(
          h("div", { class: "rt-editor-head" },
            h("div", null, h("div", { class: "rt-editor-title" }, "Jouw ritme"), setup.editorCount),
            h("div", { class: "rt-editor-tools" }, gridSeg, setup.clearBtn)
          ),
          grid,
          h("p", { class: "rt-editor-hint" }, "Klik vakjes aan of uit. Het ritme herhaalt elke maat.")
        );
        updateEditorCount();
      }

      /* Wissen, met een paar seconden de kans om het terug te zetten. */
      function clearOrUndo() {
        stopPreview();
        const arr = S.customGrid === 3 ? S.custom3 : S.custom4;
        const u = setup.undo;
        clearTimeout(undoTimer);
        undoTimer = null;
        setup.undo = null;
        if (u && u.spb === S.customGrid) {
          arr.splice(0, arr.length, ...u.steps);
          live.textContent = "Je ritme is teruggezet.";
        } else {
          if (!Logic.countNotes(arr)) return;
          setup.undo = { spb: S.customGrid, steps: arr.slice() };
          arr.fill(0);
          live.textContent = "Je ritme is gewist. Met Herstel zet je het terug.";
          undoTimer = setTimeout(() => {
            undoTimer = null;
            setup.undo = null;
            if (!disposed && screen === "setup") updateEditorCount();
          }, 5000);
        }
        renderEditor();
        updateOwnMini();
        changed();
        focusQuiet(setup.clearBtn);
      }

      function updateEditorCount() {
        if (!setup.editorCount) return;
        const n = Logic.countNotes(Logic.resolvePattern(Object.assign({}, S, { pattern: "eigen" })).steps);
        setup.editorCount.textContent = n === 1 ? "1 noot per maat" : `${n} noten per maat`;
        // Knop Wissen / Herstel
        const b = setup.clearBtn;
        if (!b) return;
        const canUndo = !!(setup.undo && setup.undo.spb === S.customGrid);
        b.replaceChildren(icon(canUndo ? "replay" : "trash", 16), canUndo ? "Herstel" : "Wissen");
        b.setAttribute("aria-label", canUndo ? "Zet je gewiste ritme terug" : "Wis je eigen ritme");
        b.disabled = !canUndo && n === 0;
      }

      function toggleStep(idx) {
        stopPreview();
        // Een nieuwe wijziging maakt 'Herstel' ongeldig (anders gooi je die wijziging weg)
        if (setup.undo) { setup.undo = null; clearTimeout(undoTimer); undoTimer = null; }
        const arr = S.customGrid === 3 ? S.custom3 : S.custom4;
        arr[idx] = arr[idx] ? 0 : 1;
        const btn = setup.editorBtns[idx];
        if (btn) btn.setAttribute("aria-pressed", String(!!arr[idx]));
        updateOwnMini();
        updateEditorCount();
        changed();
      }

      function selectPattern(id) {
        if (S.pattern === id) return;
        stopPreview();
        S.pattern = id;
        Object.keys(setup.cardEls).forEach((k) => setup.cardEls[k].setAttribute("aria-pressed", String(k === id)));
        renderEditor();
        changed();
      }

      function setMeter(v) {
        if (S.beatsPerBar === v) return;
        stopPreview();
        S.beatsPerBar = v;
        if (S.pattern !== "eigen") {
          const p = Logic.byId(S.pattern);
          if (!Logic.fits(p, v)) {
            ui.toast(`${p.name} past alleen in 4/4. Je oefent nu Achtsten.`);
            S.pattern = "achtsten";
          }
        }
        renderCards();
        renderEditor();
        changed();
      }

      function refreshSummary() {
        if (screen !== "setup" || !setup.summary) return;
        const pat = Logic.resolvePattern(S);
        const n = Logic.countNotes(pat.steps);
        const beatMs = 60000 / S.bpm;
        const totalMs = (S.introBars + S.playBars) * S.beatsPerBar * beatMs;
        setup.bpmHint.textContent = `${Logic.tempoWord(S.bpm)} · een tel duurt ${Math.round(beatMs)} ms`;
        setup.introHint.textContent = `Je luistert eerst ${S.introBars} ${S.introBars === 1 ? "maat" : "maten"}.`;
        setup.playHint.textContent = n ? `Daarna klik je ${n * S.playBars} noten mee.` : "Je ritme heeft nog geen noten.";
        setup.guideHint.textContent = GUIDE_HINT[S.guide];
        setup.summary.textContent = `${pat.name} in ${S.beatsPerBar}/4 op ${S.bpm} bpm · duurt ongeveer ${ui.fmtDuration(totalMs)}`;
        setup.startBtn.disabled = n === 0;
        setup.previewBtn.disabled = n === 0;
        if (setup.headPreview) setup.headPreview.disabled = n === 0;
        setup.warn.textContent = n === 0 ? "Zet minstens één vakje aan om te kunnen starten." : "";
        setup.warn.hidden = n !== 0;
      }

      function changed() {
        refreshSummary();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flushSave, 300);
      }

      function flushSave() {
        if (saveTimer === null) return;
        clearTimeout(saveTimer);
        saveTimer = null;
        App.store.saveModeSettings(MODE, {
          pattern: S.pattern, beatsPerBar: S.beatsPerBar, bpm: S.bpm, introBars: S.introBars,
          playBars: S.playBars, guide: S.guide, ownClick: S.ownClick, customGrid: S.customGrid,
          custom4: S.custom4.slice(), custom3: S.custom3.slice(),
        });
      }

      /* ---------- Beluister: één maat van het patroon ---------- */

      async function togglePreview() {
        if (preview) { stopPreview(); return; }
        const pat = Logic.resolvePattern(S);
        if (!Logic.countNotes(pat.steps)) return;
        try { await App.audio.ready(); } catch (e) { /* geen geluid mogelijk */ }
        if (disposed || screen !== "setup" || preview) return;
        const beatMs = 60000 / S.bpm;
        const stepMs = beatMs / pat.spb;
        const ev = [];
        for (let b = 0; b < S.beatsPerBar; b++) ev.push({ t: (b * beatMs) / 1000, kind: "click", voice: "click", accent: b === 0, level: 0.75 });
        pat.steps.forEach((on, s) => {
          if (on) ev.push({ t: (s * stepMs) / 1000, kind: "drum", sound: "rim", level: 1 });
          ev.push({ t: (s * stepMs) / 1000, kind: "mark", step: s });
        });
        ev.push({ t: (S.beatsPerBar * beatMs) / 1000, kind: "mark", step: -1 });
        const seq = App.audio.sequence(ev, {
          lead: 0.12,
          onEvent: (e) => { if (e.kind === "mark" && preview === seq) highlightPreview(e.step); },
        });
        preview = seq;
        updatePreviewBtn();
        seq.done.then(() => {
          if (preview !== seq) return;
          preview = null;
          if (!disposed) { highlightPreview(-1); updatePreviewBtn(); }
        });
      }

      function stopPreview() {
        if (!preview) return;
        const p = preview;
        preview = null;
        p.stop();
        highlightPreview(-1);
        updatePreviewBtn();
      }

      function highlightPreview(step) {
        const blocks = (setup.miniBlocks && setup.miniBlocks[S.pattern]) || [];
        const btns = S.pattern === "eigen" ? setup.editorBtns || [] : [];
        if (previewStep >= 0) {
          if (blocks[previewStep]) blocks[previewStep].classList.remove("is-now");
          if (btns[previewStep]) btns[previewStep].classList.remove("is-now");
        }
        previewStep = step;
        if (step >= 0) {
          if (blocks[step]) blocks[step].classList.add("is-now");
          if (btns[step]) btns[step].classList.add("is-now");
        }
      }

      function updatePreviewBtn() {
        [setup.previewBtn, setup.headPreview].forEach((b) => {
          if (!b) return;
          if (preview) b.replaceChildren(icon("stop", 16), "Stop");
          else b.replaceChildren(icon("volume", 18), "Beluister");
          b.setAttribute("aria-label", preview ? "Stop het voorbeeld" : "Beluister één maat van het ritme");
        });
      }

      /* ============================== Spelen ============================== */

      async function startRun() {
        if (run || starting) return;
        const pat = Logic.resolvePattern(S);
        if (!Logic.countNotes(pat.steps)) { ui.toast("Zet minstens één vakje aan.", "bad"); return; }
        starting = true;
        const startedAt = performance.now();
        stopPreview();
        flushSave();
        leaveResult();
        try { await App.audio.ready(); } catch (e) { /* geen geluid mogelijk */ }
        starting = false;
        if (disposed || run) return;

        const settings = {
          pattern: pat.id, patternName: pat.name, steps: pat.steps.slice(), stepsPerBeat: pat.spb,
          beatsPerBar: S.beatsPerBar, bpm: S.bpm, introBars: S.introBars, playBars: S.playBars, guide: S.guide,
        };
        const plan = Logic.buildPlan({
          steps: settings.steps, stepsPerBeat: settings.stepsPerBeat, beatsPerBar: settings.beatsPerBar,
          bpm: settings.bpm, introBars: settings.introBars, playBars: settings.playBars,
        });
        const cal = Number(App.store.getSetting("latencyMs", 0)) || 0;
        const r = {
          plan, settings, cal, startedAt,
          matcher: Logic.createMatcher(plan),
          clicks: [], missed: new Set(), missCursor: 0, trail: [],
          laneBar: -1, beat: -2, phase: "", subText: "", counterText: "",
          startTime: null, finished: false, anchorCtx: -1, anchorPerf: 0, ui: null,
          // 'Stilte': tijdens het meeklikken geen afspeelkop, tellen of oplichtende noten.
          // De tijdlijn volgt dan jouw klikken (followBar) in plaats van de klok.
          blind: settings.guide === "stil",
          followBar: plan.introBars,
          ownClick: !!S.ownClick,
          countShown: 0,          // aftellen in de laatste intromaat (welk getal staat er)
          announced: plan.introBars, // volgende maat die we voor schermlezers samenvatten
        };
        run = r;
        showStage(r);

        const seq = App.audio.sequence(Logic.buildEvents(plan, settings.steps, settings.guide), {
          lead: 0.6,
          // Wacht na de laatste maat nog het venster (+ kalibratie) af, zodat de laatste klik meetelt
          tail: (plan.windowMs + Math.max(0, cal)) / 1000 + 0.15,
        });
        r.seq = seq;
        r.startTime = seq.startTime;
        seq.done.then((res) => {
          if (disposed || run !== r || r.finished) return;
          if (res && res.completed) finishRun(r);
        });
        cancelRaf();
        rafId = requestAnimationFrame(frame);
      }

      function showStage(r) {
        screen = "play";
        dropChart();
        head.hidden = true;
        const p = r.plan;
        const U = (r.ui = {});

        // Kop: fase, teller, stopknop
        U.phaseText = h("span", null, "Luister");
        U.phase = h("div", { class: "rt-phase", dataset: { phase: "listen" } }, h("span", { class: "rt-phase-dot" }), U.phaseText);
        U.sub = h("div", { class: "rt-phase-sub" }, "Het ritme begint zo…");
        U.counter = h("div", { class: "rt-counter num" }, `Intro 1/${p.introBars}`);
        const stopBtn = h("button", { type: "button", class: "btn btn-ghost rt-stop", "aria-keyshortcuts": "Escape", onClick: () => abortRun() },
          icon("stop", 14), "Stoppen", kbd("Esc"));
        const top = h("div", { class: "rt-stage-top" },
          h("div", { class: "rt-phase-wrap" }, U.phase, U.sub),
          h("div", { class: "rt-stage-tools" }, U.counter, stopBtn)
        );

        // Tellen
        U.beatDots = [];
        const beats = h("div", { class: "rt-beats", "aria-hidden": "true" });
        for (let b = 0; b < p.beatsPerBar; b++) {
          const d = h("span", { class: "rt-beat" + (b === 0 ? " is-one" : "") });
          U.beatDots.push(d);
          beats.append(d);
        }

        // Grote weergave van de laatste klik
        U.num = h("span", { class: "rt-readout-num num" }, "—");
        U.unit = h("span", { class: "rt-readout-unit" });
        U.word = h("div", { class: "rt-readout-word" }, "Luister eerst. Je begint na het aftellen.");
        U.readout = h("div", { class: "rt-readout", dataset: { kind: "none" } }, h("div", { class: "rt-readout-main" }, U.num, U.unit), U.word);

        // Meter van −100 tot +100 ms
        U.needle = h("span", { class: "rt-needle" });
        U.needle.hidden = true;
        U.trail = h("span", { class: "rt-trail" });
        const scale = h("div", { class: "rt-meter-scale num" },
          [["−100", 0], ["−50", 25], ["0", 50], ["+50", 75], ["+100", 100]].map(([t, x]) => h("span", { style: { left: x + "%" } }, t))
        );
        const meter = h("div", { class: "rt-meter", "aria-hidden": "true" },
          h("div", { class: "rt-meter-ends" },
            h("span", { class: "is-early" }, "← te vroeg"),
            h("span", { class: "is-ok" }, "raak ±10 ms"),
            h("span", { class: "is-late" }, "te laat →")
          ),
          h("div", { class: "rt-meter-track" }, h("span", { class: "rt-meter-zone" }), h("span", { class: "rt-meter-zero" }), U.trail, U.needle),
          scale
        );

        // Tijdlijn van de huidige maat
        const grid = h("div", { class: "rt-grid" });
        for (let s = 0; s <= p.stepsPerBar; s++) {
          const cls = s % p.stepsPerBar === 0 ? " is-bar" : s % p.stepsPerBeat === 0 ? " is-beat" : "";
          grid.append(h("span", { class: "rt-gl" + cls, style: { left: pct(s / p.stepsPerBar) } }));
        }
        const beatNums = h("div", { class: "rt-lane-beats num" });
        for (let b = 0; b < p.beatsPerBar; b++) beatNums.append(h("span", { style: { left: pct(b / p.beatsPerBar) } }, String(b + 1)));
        U.notes = h("div", { class: "rt-lane-notes" });
        U.marks = h("div", { class: "rt-lane-marks" });
        U.head = h("div", { class: "rt-head" });
        U.track = h("div", { class: "rt-track" }, grid, beatNums, U.notes, U.marks, U.head);
        U.laneTitle = h("span", { class: "rt-lane-title" });
        U.lane = h("div", { class: "rt-lane", dataset: { phase: "listen" } },
          h("div", { class: "rt-lane-top" },
            U.laneTitle,
            h("span", { class: "rt-lane-legend" },
              h("span", null, h("i", { class: "is-note" }), "noot"),
              h("span", null, h("i", { class: "is-mark" }), "jouw klik (ms)")
            )
          ),
          h("div", { class: "rt-lane-box" }, U.track)
        );

        // Overzicht van alle maten
        U.segs = [];
        U.segFills = [];
        const group = (from, to, cls, cap) => {
          const bars = h("div", { class: "rt-ov-bars" });
          for (let b = from; b < to; b++) {
            const fill = h("i");
            const seg = h("span", { class: "rt-ov-seg" }, fill);
            U.segs.push(seg);
            U.segFills.push(fill);
            bars.append(seg);
          }
          return h("div", { class: "rt-ov-group " + cls, style: { flex: `${to - from} 1 0px` } }, bars, h("div", { class: "rt-ov-cap" }, cap));
        };
        U.ovIntro = group(0, p.introBars, "is-intro", "Luisteren");
        U.ovPlay = group(p.introBars, p.totalBars, "is-play", "Meeklikken");
        const overview = h("div", { class: "rt-overview", "aria-hidden": "true" }, U.ovIntro, U.ovPlay);

        // Tellers
        U.cHit = h("b", null, "0");
        U.cMiss = h("b", null, "0");
        U.cExtra = h("b", null, "0");
        const counts = h("div", { class: "rt-counts" },
          h("span", { class: "rt-count", dataset: { kind: "ok" } }, h("i"), "Geraakt", U.cHit, h("span", { class: "faint" }, `/ ${p.playCount}`)),
          h("span", { class: "rt-count", dataset: { kind: "miss" } }, h("i"), "Gemist", U.cMiss),
          h("span", { class: "rt-count", dataset: { kind: "extra" } }, h("i"), "Extra", U.cExtra)
        );

        const hint = h("p", { class: "rt-hint" }, "Tik op dit vlak, of druk op ", kbd("Spatie"), ", ", kbd("J"), " of ", kbd("F"), ". Klikken tijdens de intro tellen niet mee.");

        U.flash = h("span", { class: "rt-flash", "aria-hidden": "true" });
        U.pad = h("div", {
          class: "rt-pad", tabindex: "0", role: "button",
          "aria-label": "Tikvlak: tik hier mee met het ritme",
          onPointerdown: (e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.preventDefault();
            tap(e);
          },
        }, U.flash, beats, U.readout, meter, U.lane, overview, counts, hint);

        U.stage = h("section", { class: "panel rt-stage", dataset: { phase: "listen", guide: r.settings.guide }, "aria-label": "Meeklikken" }, top, U.pad);
        swapScreen(U.stage);
        renderLane(r, 0);
        updateOverview(r, 0);
        App.setPlaying(true);
        window.scrollTo(0, 0);
        focusQuiet(U.pad);
      }

      /* Wat de gebruiker NU hoort, als positie in ms op de tijdlijn (vloeiend tussen audioblokken). */
      function heardPos(r) {
        const ct = App.audio.now();
        const pn = performance.now();
        if (ct !== r.anchorCtx) { r.anchorCtx = ct; r.anchorPerf = pn; }
        const est = r.anchorCtx + Math.min(0.06, (pn - r.anchorPerf) / 1000);
        return (est - App.audio.outputLatency() - r.cal / 1000 - r.startTime) * 1000;
      }

      function frame() {
        const r = run;
        if (!r || r.finished || disposed) { rafId = 0; return; }
        rafId = requestAnimationFrame(frame);
        if (r.startTime == null) return;
        const p = r.plan, U = r.ui;
        const pos = heardPos(r);
        const bar = Logic.clamp(Math.floor(pos / p.barMs), 0, p.totalBars - 1);
        const phase = pos < p.introMs ? "listen" : pos < p.totalMs ? "go" : "done";
        if (phase !== r.phase) setPhase(r, phase);

        // In 'Stilte' geeft het beeld na de intro geen tel meer weg: geen afspeelkop, geen oplichtende
        // tellen, geen vloeiende voortgang. De tijdlijn volgt dan de maat van jouw laatste klik.
        const blind = r.blind && phase !== "listen";
        const laneBar = blind ? Logic.clamp(r.followBar, p.introBars, p.totalBars - 1) : bar;
        if (laneBar !== r.laneBar) { renderLane(r, laneBar); updateOverview(r, laneBar); }

        const inBar = pos - bar * p.barMs;
        const frac = Logic.clamp(inBar / p.barMs, 0, 1);
        if (!blind) {
          U.head.style.transform = "translateX(" + (frac * 100).toFixed(2) + "%)";
          U.segFills[bar].style.transform = "scaleX(" + frac.toFixed(4) + ")";
        }

        const beat = pos < 0 ? -1 : Math.min(p.beatsPerBar - 1, Math.floor(inBar / p.beatMs));
        const shownBeat = blind ? -1 : beat;
        if (shownBeat !== r.beat) {
          if (r.beat >= 0 && U.beatDots[r.beat]) U.beatDots[r.beat].classList.remove("is-on");
          if (shownBeat >= 0) U.beatDots[shownBeat].classList.add("is-on");
          r.beat = shownBeat;
        }
        updateCounter(r, bar, beat, blind);

        // Noten lichten op zodra ze klinken: tijdens de intro altijd, daarna alleen als je het ritme
        // ook hoort ('Ritme + metronoom'). Anders zou je op het beeld kunnen meetikken.
        if (phase === "listen" || r.settings.guide === "ritme") {
          for (const o of r.laneNoteEls) {
            if (!o.past && pos >= p.notes[o.k].t) { o.past = true; o.el.classList.add("is-past"); }
          }
        }

        if (phase === "listen") {
          let txt;
          if (pos < 0) txt = "Het ritme begint zo…";
          else if (bar < p.introBars - 1) txt = "Luister naar het ritme";
          else {
            const left = Math.max(1, Math.ceil((p.introMs - pos) / p.beatMs - 1e-6));
            txt = `Jij begint over ${left} ${left === 1 ? "tel" : "tellen"}`;
            showCountdown(r, left);
          }
          setSub(r, txt);
        }
        checkMissed(r, pos);
        announceBars(r, pos);
      }

      function setSub(r, txt) {
        if (r.subText === txt) return;
        r.subText = txt;
        r.ui.sub.textContent = txt;
      }

      function updateCounter(r, bar, beat, blind) {
        const p = r.plan;
        const intro = bar < p.introBars;
        const txt = blind ? "In stilte"
          : (intro ? `Intro ${bar + 1}/${p.introBars}` : `Maat ${bar - p.introBars + 1}/${p.playBars}`) + (beat >= 0 ? ` · tel ${beat + 1}` : "");
        if (txt === r.counterText) return;
        r.counterText = txt;
        r.ui.counter.textContent = txt;
      }

      /* Mag het aftellen of de beginstand de grote weergave overnemen? Niet als er al een echte
         meting staat (bijv. een klik net vóór de eerste meekliknoot). */
      function readoutIsFree(r) {
        const k = r.ui.readout.dataset.kind;
        return k === "none" || k === "count" || k === "intro";
      }

      /* Laatste intromaat: groot aftellen in het midden, waar je ogen zijn. */
      function showCountdown(r, left) {
        const U = r.ui;
        if (r.countShown === left || !readoutIsFree(r)) return;
        r.countShown = left;
        U.readout.dataset.kind = "count";
        U.num.textContent = String(left);
        U.unit.textContent = "";
        U.word.className = "rt-readout-word";
        U.word.textContent = `${left === 1 ? "tel" : "tellen"} tot jij begint`;
        if (!reducedMotion() && U.num.animate) {
          U.num.animate([{ transform: "scale(1.12)", opacity: 0.5 }, { transform: "none", opacity: 1 }], { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
        }
      }

      function setPhase(r, phase) {
        const U = r.ui;
        r.phase = phase;
        U.phase.dataset.phase = phase;
        U.stage.dataset.phase = phase;
        if (r.blind && phase !== "listen") U.stage.dataset.blind = "1";
        if (phase === "listen") {
          U.phaseText.textContent = "Luister";
        } else if (phase === "go") {
          U.phaseText.textContent = "Nu jij!";
          setSub(r, GO_SUB[r.settings.guide]);
          live.textContent = "Nu jij! Klik mee.";
          if (readoutIsFree(r)) {
            U.readout.dataset.kind = "none";
            U.num.textContent = "—";
            U.unit.textContent = "";
            U.word.className = "rt-readout-word";
            U.word.textContent = "Klik mee met het ritme";
          }
        } else {
          U.phaseText.textContent = "Klaar";
          setSub(r, "Even de uitslag berekenen…");
        }
        if (phase !== "listen" && !reducedMotion() && U.phase.animate) {
          U.phase.animate([{ transform: "scale(0.94)", opacity: 0.4 }, { transform: "none", opacity: 1 }], { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
        }
      }

      /* Voor schermlezers: na elke meeklikmaat één korte zin (niet per klik, dat stoort de timing).
         Niet in 'Stilte': daar zou de zin de maatstreep verraden. De laatste maat volgt in de uitslag. */
      function announceBars(r, pos) {
        const p = r.plan, m = r.matcher;
        if (r.blind) return;
        while (r.announced < p.totalBars - 1 && pos > (r.announced + 1) * p.barMs + p.windowMs + 60) {
          const b = r.announced++;
          let total = 0, hit = 0, sum = 0;
          p.notes.forEach((n, k) => {
            if (n.bar !== b) return;
            total++;
            if (m.taken[k] !== null) { hit++; sum += m.taken[k]; }
          });
          if (!total) continue;
          live.textContent = `Maat ${b - p.introBars + 1}: ${hit} van ${total} geraakt` +
            (hit ? `, gemiddeld ${Logic.signedInt(sum / hit)} ms.` : ".");
        }
      }

      /* Teken de tijdlijn voor één maat: de verwachte noten en de klikken die erbij horen. */
      function renderLane(r, bar) {
        const p = r.plan, U = r.ui;
        r.laneBar = bar;
        r.laneStagger = 0;
        const intro = bar < p.introBars;
        U.laneTitle.textContent = intro
          ? `Intro · maat ${bar + 1} van ${p.introBars}`
          : `Meeklikken · maat ${bar - p.introBars + 1} van ${p.playBars}`;
        U.lane.dataset.phase = intro ? "listen" : "go";
        U.notes.replaceChildren();
        U.marks.replaceChildren();
        r.laneNoteEls = [];
        r.laneNoteByK = new Map();
        p.notes.forEach((n, k) => {
          if (n.bar !== bar) return;
          // In 'Stilte' geen live kruisjes: die zouden verraden waar de noten vallen
          const miss = r.missed.has(k) && !r.blind;
          const el = h("span", { class: "rt-note" + (miss ? " is-miss" : ""), style: { left: pct(n.step / p.stepsPerBar) } });
          U.notes.append(el);
          const o = { k, el, past: false };
          r.laneNoteEls.push(o);
          r.laneNoteByK.set(k, o);
        });
        r.clicks.forEach((c) => { if (c.bar === bar) drawMark(r, c); });
      }

      function drawMark(r, c) {
        const p = r.plan;
        const x = Logic.clamp((c.posMs - r.laneBar * p.barMs) / p.barMs, -0.03, 1.03);
        const low = c.noteIndex >= 0 ? c.noteIndex % 2 === 1 : r.laneStagger++ % 2 === 1;
        let label = "", isWord = false;
        if (c.kind === "hit") label = ui.fmtMs(c.offsetMs, false);
        else if (!c.intro && !c.after) {
          if (c.reason === "far" && c.nearOff != null) label = ui.fmtMs(c.nearOff, false);
          else { label = "extra"; isWord = true; }
        }
        r.ui.marks.append(h("span", {
          class: "rt-mark" + (low ? " is-low" : ""),
          dataset: { kind: c.cls },
          style: { left: pct(x) },
        }, label ? h("span", { class: "rt-mark-label num" + (isWord ? " is-word" : "") }, label) : null));
      }

      function updateOverview(r, bar) {
        const U = r.ui, p = r.plan;
        U.segs.forEach((s, i) => {
          s.classList.toggle("is-done", i < bar);
          s.classList.toggle("is-now", i === bar);
          if (i !== bar) U.segFills[i].style.transform = i < bar ? "scaleX(1)" : "scaleX(0)";
        });
        const intro = bar < p.introBars;
        U.ovIntro.classList.toggle("is-now", intro);
        U.ovPlay.classList.toggle("is-now", !intro);
      }

      /* Noten waarvan het venster voorbij is zonder klik: 'gemist' (voorlopig; een late klik telt nog). */
      function checkMissed(r, pos) {
        const p = r.plan, m = r.matcher;
        const limit = pos - p.windowMs - 40;
        let changedAny = false;
        while (r.missCursor < p.notes.length && p.notes[r.missCursor].t < limit) {
          const k = r.missCursor++;
          if (p.notes[k].intro || m.taken[k] !== null) continue;
          r.missed.add(k);
          if (!r.blind) markMissedEl(r, k, true);
          changedAny = true;
        }
        if (changedAny) updateCounts(r);
      }

      function markMissedEl(r, k, on) {
        const o = r.laneNoteByK && r.laneNoteByK.get(k);
        if (o) o.el.classList.toggle("is-miss", on);
      }

      /* Eén klik of toetsaanslag tijdens het spelen. */
      function tap(evt) {
        const r = run;
        if (!r || r.finished || r.startTime == null || screen !== "play") return;
        const p = r.plan, m = r.matcher;
        // Eigen klik hoorbaar maken (staat standaard uit). Andere klank dan ritme en metronoom.
        if (r.ownClick) { try { App.audio.drum(App.audio.now(), "hat", { level: 1 }); } catch (e) { /* geen geluid */ } }
        const posMs = App.audio.offsetMs(evt, r.startTime);
        if (posMs > p.endCutMs) {
          // Na de laatste noot, bijv. een afsluitende tik op de 1: wel laten zien, niet meetellen
          if (posMs > p.totalMs + p.windowMs + 400) return;
          const c = { posMs, kind: "after", intro: false, after: true, offsetMs: null, noteIndex: -1, bar: p.totalBars - 1, cls: "intro" };
          r.clicks.push(c);
          flash(r, "intro");
          showReadout(r, c);
          if (c.bar === r.laneBar) drawMark(r, c);
          return;
        }
        const res = Logic.matchClick(m, posMs);
        const c = { posMs, kind: res.kind, intro: res.intro, offsetMs: null, noteIndex: -1, bar: 0, cls: "extra" };
        if (res.kind === "hit") {
          // De eigenlijke meting: afwijking ten opzichte van de verwachte audiotijd van deze noot
          const exact = App.audio.offsetMs(evt, r.startTime + res.note.t / 1000);
          m.taken[res.noteIndex] = exact;
          res.offsetMs = exact;
          c.offsetMs = exact;
          c.noteIndex = res.noteIndex;
          c.bar = res.note.bar;
          c.cls = res.intro ? "intro" : Logic.classify(exact);
          if (r.missed.delete(res.noteIndex) && !r.blind) markMissedEl(r, res.noteIndex, false);
        } else {
          c.bar = Logic.clamp(Math.floor(posMs / p.barMs), 0, p.totalBars - 1);
          c.cls = res.intro ? "intro" : "extra";
          c.reason = res.reason;
          c.nearOff = res.nearOffsetMs;
        }
        // In 'Stilte' volgt de tijdlijn jouw klikken (nooit terug naar een eerdere maat)
        if (!c.intro) r.followBar = Math.max(r.followBar, c.bar);
        r.clicks.push(c);
        flash(r, c.cls);
        // Tijdens het aftellen blijft het aftellen groot staan; een introklik zie je dan alleen subtiel
        if (!(c.intro && r.countShown)) showReadout(r, c);
        if (c.bar === r.laneBar || c.bar === r.laneBar + 1) drawMark(r, c);
        updateCounts(r);
      }

      function flash(r, kind) {
        const f = r.ui.flash;
        f.dataset.kind = kind;
        if (f.animate) f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 120 : 260, easing: "ease-out" });
      }

      function showReadout(r, c) {
        const U = r.ui;
        U.readout.dataset.kind = c.cls;
        delete U.readout.dataset.dir;
        if (c.kind === "hit") {
          U.num.textContent = ui.fmtMs(c.offsetMs, false);
          U.unit.textContent = "ms";
          U.word.textContent = c.intro ? "intro · telt nog niet mee" : WORD[c.cls];
          U.word.className = "rt-readout-word" + (c.intro ? "" : " badge " + BADGE[c.cls]);
          const x = 50 + Logic.clamp(c.offsetMs, -100, 100) / 2;
          if (r.lastNeedle != null) {
            r.trail.push({ x: r.lastNeedle.x, kind: r.lastNeedle.kind });
            if (r.trail.length > 6) r.trail.shift();
          }
          r.lastNeedle = { x, kind: c.cls };
          U.needle.hidden = false;
          U.needle.dataset.kind = c.cls;
          U.needle.style.left = x + "%";
          U.trail.replaceChildren(...r.trail.map((t, i) => h("i", {
            dataset: { kind: t.kind },
            style: { left: t.x + "%", opacity: String(((i + 1) / (r.trail.length + 1)) * 0.7) },
          })));
        } else if (c.intro || c.after) {
          U.num.textContent = "—";
          U.unit.textContent = "";
          U.word.textContent = c.after ? "na afloop · telt niet mee" : "intro · telt nog niet mee";
          U.word.className = "rt-readout-word";
        } else if (c.reason === "far" && c.nearOff != null) {
          // Net te ver naast een noot: laat zien hoeveel, zodat je weet of je te vroeg of te laat was
          const dir = c.nearOff < 0 ? "early" : "late";
          U.readout.dataset.kind = "far";
          U.readout.dataset.dir = dir;
          U.num.textContent = ui.fmtMs(c.nearOff, false);
          U.unit.textContent = "ms";
          U.word.textContent = `${WORD[dir]} · te ver weg, telt als extra`;
          U.word.className = "rt-readout-word badge bad";
        } else {
          U.num.textContent = "extra";
          U.unit.textContent = "";
          U.word.textContent = c.reason === "double" ? "dubbele klik · telt als extra" : "geen noot in de buurt · telt als extra";
          U.word.className = "rt-readout-word badge bad";
        }
        if (!reducedMotion() && U.num.animate) {
          U.num.animate([{ transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
        }
      }

      function updateCounts(r) {
        let hit = 0, extra = 0;
        for (const c of r.clicks) {
          if (c.intro || c.after) continue;
          if (c.kind === "hit") hit++;
          else extra++;
        }
        r.ui.cHit.textContent = String(hit);
        r.ui.cMiss.textContent = String(r.missed.size);
        r.ui.cExtra.textContent = String(extra);
      }

      function cancelRaf() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
      }

      /* Stoppen zonder opslaan. */
      function abortRun(message) {
        const r = run;
        if (!r) return;
        r.finished = true;
        run = null;
        if (r.seq) r.seq.stop();
        cancelRaf();
        ui.toast(message || "Gestopt. Deze ronde is niet bewaard.");
        showSetup(true);
      }

      function finishRun(r) {
        r.finished = true;
        cancelRaf();
        // Geen enkele klik in het meeklikdeel (weggelopen, of niets gehoord)? Dan niet bewaren:
        // zo'n ronde zou je gemiddelde en je reeks vertekenen.
        if (!r.clicks.some((c) => !c.intro && !c.after)) {
          run = null;
          ui.toast("Je hebt niet meegeklikt. Deze ronde is niet bewaard.");
          showSetup(true);
          return;
        }
        const hits = Logic.buildHits(r.matcher, r.plan);
        const extras = Logic.countExtras(r.matcher);
        const stats = Logic.computeStats(hits, extras);
        const score = Logic.computeScore(hits, extras);
        // Alleen eerlijk vergelijkbare rondes: zelfde ritme, maatsoort, raster, tempo en begeleiding
        const same = App.store.sessions(MODE).filter((x) => Logic.sameSetup(x.settings, r.settings));
        const prev = same.length ? same[same.length - 1] : null;
        const best = same.reduce((a, x) => Math.max(a, x.score || 0), -1);
        const record = {
          mode: MODE,
          durationMs: Math.round(performance.now() - r.startedAt),
          score,
          settings: r.settings,
          hits,
          extras,
          stats,
        };
        try { App.store.addSession(record); } catch (e) { console.error(e); ui.toast("Bewaren lukte niet.", "bad"); }
        run = null;
        showResult({ record, prev, best });
      }

      /* ============================== Resultaat ============================== */

      function showResult({ record, prev, best }) {
        screen = "result";
        App.setPlaying(false);
        dropChart();
        head.hidden = true;
        const s = record.settings, st = record.stats, score = record.score;
        const calibrated = (Number(App.store.getSetting("latencyMs", 0)) || 0) !== 0;

        // --- Kop met score ---
        const title = h("h2", { class: "rt-res-title", tabindex: "-1" }, Logic.verdict(score));
        const spread = st.stdMs == null ? "" : ` Je spreiding is ${Math.round(st.stdMs)} ms${st.stdMs <= 12 ? ": heel constant." : st.stdMs <= 25 ? "." : ": nog wisselend."}`;
        const guideLabel = (GUIDES.find((g) => g.value === s.guide) || GUIDES[1]).label;
        const setupName = `${s.patternName} op ${s.bpm} bpm`;
        let prevLine;
        if (prev && best >= 0 && score > best) {
          prevLine = h("p", { class: "rt-res-prev is-record" }, icon("trophy", 16), `Nieuw record voor ${setupName}! Vorige beste: ${Math.round(best)}.`);
        } else if (prev) {
          const d = score - Math.round(prev.score || 0);
          prevLine = h("p", { class: "rt-res-prev" }, icon("clock", 16),
            `Vorige keer met ${setupName}: ${Math.round(prev.score || 0)} → nu ${score}` + (d ? ` (${ui.fmtSigned(d)})` : " (gelijk)"));
        } else {
          prevLine = h("p", { class: "rt-res-prev" }, icon("flame", 16), "Eerste keer met deze instelling. Volgende keer zie je hier of je vooruitgaat.");
        }
        const again = h("button", { type: "button", class: "btn btn-lg btn-primary rt-again", "aria-keyshortcuts": "R", onClick: () => startRun() },
          icon("replay", 18), "Nog een keer", kbd("R"));
        const other = h("button", { type: "button", class: "btn btn-lg", onClick: () => showSetup(true) }, icon("instellingen", 18), "Andere instellingen");
        const toStats = h("button", { type: "button", class: "btn btn-lg btn-ghost", onClick: () => App.navigate("statistieken/" + MODE) }, icon("statistieken", 18), "Naar statistieken");
        // Het resultaat verschijnt vaak terwijl je nog doortikt. Daarom zijn de knoppen heel even
        // niet klikbaar, zodat één tik te veel niet meteen een nieuwe ronde start.
        const actionsRow = h("div", { class: "rt-res-actions is-arming" }, again, other, toStats);
        actionsRow.inert = true;
        const now = performance.now();
        resultReadyAt = now + ARM_MS;
        resultGuardUntil = now + GUARD_MS;
        clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          armTimer = null;
          actionsRow.inert = false;
          actionsRow.classList.remove("is-arming");
        }, ARM_MS);
        const introWord = s.introBars === 1 ? "maat" : "maten";
        const hero = h("section", { class: "panel rt-res-hero" },
          h("div", { class: "rt-res-ring" }, ui.scoreRing(score, "score")),
          h("div", { class: "rt-res-text" },
            h("div", { class: "eyebrow" }, "Ritme · resultaat"),
            title,
            h("p", { class: "rt-res-lead" }, Logic.tendencyText(st.meanMs) + spread),
            h("div", { class: "rt-res-tags" },
              [s.patternName, `${s.beatsPerBar}/4`, `${s.bpm} bpm`, `${s.introBars} ${introWord} luisteren · ${s.playBars} meeklikken`, guideLabel].map((t) => h("span", { class: "badge" }, t))
            ),
            prevLine,
            actionsRow
          )
        );

        // --- Kerncijfers ---
        // Eén bron voor de neiging (afgerond), zodat zin, tegel en legenda hetzelfde zeggen
        const tendKind = Logic.tendencyKind(st.meanMs) || "";
        const tendWord = st.meanMs == null ? "geen geraakte noten" : tendKind === "ok" ? "precies op de tel" : tendKind === "late" ? "gemiddeld te laat" : "gemiddeld te vroeg";
        const tile = (value, label, unit, sub, kind) => h("div", { class: "stat-tile rt-tile" },
          ui.stat(value, label, unit),
          sub ? h("div", { class: "rt-tile-sub" }, kind ? h("i", { dataset: { kind } }) : null, sub) : null
        );
        const tiles = h("div", { class: "grid-4 rt-res-stats" },
          tile(msInt(st.meanAbsMs), "Gemiddelde afwijking", st.meanAbsMs == null ? null : "ms", "hoe ver je gemiddeld naast de noot zat"),
          tile(st.meanMs == null ? "—" : Logic.signedInt(st.meanMs), "Neiging", st.meanMs == null ? null : "ms", tendWord, tendKind),
          tile(msInt(st.stdMs), "Spreiding", st.stdMs == null ? null : "ms", "hoe constant je bent: lager is strakker"),
          tile(`${st.matched}/${st.expected}`, "Geraakt", null, `${st.missed} gemist · ${st.extras} extra`)
        );

        // --- Grafiek ---
        const chartHost = h("div", { class: "rt-chart-host" });
        const legend = h("div", { class: "rt-legend" },
          h("span", null, h("i", { dataset: { kind: "ok" } }), "raak (±10 ms, groene band)"),
          h("span", null, h("i", { dataset: { kind: "early" } }), "te vroeg"),
          h("span", null, h("i", { dataset: { kind: "late" } }), "te laat"),
          h("span", null, h("b", { class: "rt-legend-x" }, "×"), "gemist"),
          st.meanMs == null ? null : h("span", null, h("i", { class: "is-mean" }), `gemiddelde (${Logic.signedInt(st.meanMs)} ms)`)
        );
        const chartSub = h("p", { class: "panel-sub" }, "Elke stip is een noot. Boven de nullijn was je te laat, eronder te vroeg.");
        const chartPanel = h("section", { class: "panel" },
          h("h2", { class: "panel-title" }, "Afwijking per noot"),
          chartSub,
          chartHost,
          legend
        );

        // --- Lijst per noot ---
        const rows = [];
        for (let b = 0; b < s.playBars; b++) {
          const items = record.hits.filter((x) => x.bar === b);
          rows.push(h("div", { class: "rt-list-row" },
            h("span", { class: "rt-list-bar" }, "Maat " + (b + 1)),
            h("div", { class: "rt-list-notes" }, items.map((x) => {
              const kind = Logic.classify(x.offsetMs);
              const where = Logic.posLabel(x.bar, x.step, s.stepsPerBeat);
              const label = x.offsetMs == null ? `${where}: gemist` : `${where}: ${ui.fmtMs(x.offsetMs)}, ${WORD[kind]}`;
              // Zichtbaar kort getal; voor schermlezers de hele zin (aria-label op een span wordt vaak niet voorgelezen)
              return h("span", { class: "badge rt-nb " + BADGE[kind], title: label },
                h("span", { "aria-hidden": "true" }, x.offsetMs == null ? "×" : ui.fmtMs(x.offsetMs, false)),
                h("span", { class: "visually-hidden" }, label));
            }))
          ));
        }
        const listPanel = h("section", { class: "panel" },
          h("h2", { class: "panel-title" }, "Per noot"),
          h("div", { class: "rt-list" }, rows),
          h("p", { class: "rt-list-foot" },
            "Getallen in ms: − is te vroeg, + is te laat, × is gemist.",
            record.extras ? ` Daarnaast ${record.extras} ${record.extras === 1 ? "klik" : "klikken"} zonder noot in de buurt.` : ""
          )
        );

        // --- Tips ---
        const tips = Logic.advice(st, s, score, calibrated);
        // Een tip met een concreet voorstel (ander tempo of andere begeleiding) krijgt een knop
        const act = (tips.find((t) => t.action) || {}).action;
        let actBtn = null;
        if (act) {
          const label = act.bpm ? `Nog een keer op ${act.bpm} bpm`
            : `Nog een keer met ‘${(GUIDES.find((g) => g.value === act.guide) || {}).label || act.guide}’`;
          actBtn = h("button", {
            type: "button", class: "btn rt-advice-btn",
            onClick: () => {
              if (act.bpm) S.bpm = Logic.clamp(act.bpm, 40, 220);
              if (act.guide) S.guide = act.guide;
              changed();
              flushSave();
              startRun();
            },
          }, icon("replay", 16), label);
        }
        const advicePanel = tips.length ? h("section", { class: "panel rt-advice" },
          h("div", { class: "rt-advice-icon" }, icon("target", 20)),
          h("div", { class: "rt-advice-body" },
            h("h2", { class: "panel-title" }, "Zo word je strakker"),
            h("ul", null, tips.map((t) => h("li", null, t.text, t.link ? [" ", h("a", { href: "#/instellingen" }, "Naar kalibreren")] : null))),
            actBtn
          )
        ) : null;

        swapScreen(h("div", { class: "rt-result" }, hero, tiles, chartPanel, advicePanel, listPanel));
        setupChart(chartHost, record, chartSub);
        window.scrollTo(0, 0);
        focusQuiet(title);
      }

      /* Grafiek op de echte breedte tekenen (scherpe tekst) en opnieuw bij een andere breedte. */
      function setupChart(host, record, subEl) {
        let lastW = 0;
        const draw = () => {
          const w = Math.round(host.clientWidth || 0);
          if (!w || Math.abs(w - lastW) < 4) return;
          lastW = w;
          drawChart(host, record, w, subEl);
        };
        let ro = null;
        if (window.ResizeObserver) {
          ro = new ResizeObserver(draw);
          ro.observe(host);
        } else {
          window.addEventListener("resize", draw);
        }
        draw();
        if (!lastW) drawChart(host, record, 640, subEl); // nog geen breedte bekend
        chartCleanup = () => {
          if (ro) ro.disconnect();
          else window.removeEventListener("resize", draw);
        };
      }

      function dropChart() {
        if (chartCleanup) chartCleanup();
        chartCleanup = null;
      }

      function drawChart(host, record, W, subEl) {
        const S2 = ui.svg;
        const s = record.settings, hits = record.hits, st = record.stats;
        const H = W < 480 ? 220 : 260;
        const padL = 50, padR = 12, padT = 24, padB = 40;
        const pw = W - padL - padR, ph = H - padT - padB;

        // Te veel noten voor losse stippen (minder dan 5 px per noot)? Dan één stip per maat
        // (gemiddelde) met een streep van je vroegste tot je laatste klik in die maat.
        const perBar = hits.length > s.playBars && pw / Math.max(1, hits.length) < 5;
        const items = perBar
          ? Logic.barSummary(hits, s.playBars).map((b) => {
            const kind = b.mean == null ? "miss" : Logic.classify(b.mean);
            return {
              value: b.mean, lo: b.min, hi: b.max, miss: b.missed > 0, kind,
              main: b.mean == null ? "alles gemist" : `gemiddeld ${ui.fmtMs(b.mean)} · ${WORD[kind]}`,
              sub: `maat ${b.bar + 1} · ${b.matched} van ${b.total} geraakt` +
                (b.matched ? ` · van ${ui.fmtMs(b.min)} tot ${ui.fmtMs(b.max)}` : ""),
            };
          })
          : hits.map((x, i) => {
            const kind = Logic.classify(x.offsetMs);
            return {
              value: x.offsetMs, lo: null, hi: null, miss: x.offsetMs == null, kind,
              main: x.offsetMs == null ? "gemist" : `${ui.fmtMs(x.offsetMs)} · ${WORD[kind]}`,
              sub: `noot ${i + 1} · ${Logic.posLabel(x.bar, x.step, s.stepsPerBeat)}`,
            };
          });
        const n = items.length;
        if (subEl) {
          subEl.textContent = perBar
            ? "Veel noten, dus één stip per maat: je gemiddelde. De streep loopt van je vroegste tot je laatste klik. Boven de nullijn was je te laat, eronder te vroeg."
            : "Elke stip is een noot. Boven de nullijn was je te laat, eronder te vroeg.";
        }

        const absVals = hits.filter((x) => x.offsetMs != null).map((x) => Math.abs(x.offsetMs));
        const R = Logic.chartRange(absVals.length ? Math.max(...absVals) : 0);
        const y = (v) => padT + ph / 2 - (Logic.clamp(v, -R.max, R.max) / R.max) * (ph / 2);
        const slot = pw / Math.max(1, n);
        const x = (i) => padL + (i + 0.5) * slot;
        const rDot = perBar ? 4.5 : n > 64 ? 3 : 4;
        const unitWord = perBar ? "maat" : "noot";

        const svgEl = S2("svg", {
          class: "rt-chart-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, tabindex: "0", role: "img",
          "aria-label": `Grafiek van je afwijking per ${unitWord}. ${Logic.tendencyText(st.meanMs)} Met de pijltjestoetsen ga je langs de ${perBar ? "maten" : "noten"}.`,
        });
        // Raak-zone ±10 ms
        svgEl.append(S2("rect", { class: "rt-c-zone", x: padL, y: y(10), width: pw, height: Math.max(1, y(-10) - y(10)) }));
        // Rasterlijnen en getallen, met de eenheid boven de as
        R.ticks.forEach((t) => {
          svgEl.append(S2("line", { class: t === 0 ? "rt-c-zero" : "rt-c-grid", x1: padL, x2: W - padR, y1: y(t), y2: y(t) }));
          svgEl.append(S2("text", { class: "rt-c-tick", x: padL - 8, y: y(t) + 4, "text-anchor": "end", text: t === 0 ? "0" : ui.fmtMs(t, false) }));
        });
        svgEl.append(S2("text", { class: "rt-c-tick", x: padL - 8, y: padT - 10, "text-anchor": "end", text: "ms" }));
        // Maatgrenzen met nummers
        const barW = pw / s.playBars;
        const every = barW < 22 ? Math.ceil(22 / barW) : 1;
        for (let b = 0; b <= s.playBars; b++) {
          const xb = padL + b * barW;
          svgEl.append(S2("line", { class: "rt-c-bar", x1: xb, x2: xb, y1: padT, y2: padT + ph }));
          if (b < s.playBars && b % every === 0) {
            svgEl.append(S2("text", { class: "rt-c-tick", x: xb + barW / 2, y: H - 6, "text-anchor": "middle", text: String(b + 1) }));
          }
        }
        svgEl.append(S2("text", { class: "rt-c-tick", x: padL - 8, y: H - 6, "text-anchor": "end", text: "maat" }));
        // Zijlabels
        svgEl.append(S2("text", { class: "rt-c-side", x: padL + 8, y: padT + 13, text: "↑ te laat" }));
        svgEl.append(S2("text", { class: "rt-c-side", x: padL + 8, y: padT + ph - 6, text: "↓ te vroeg" }));
        // Gemiddelde (gestippeld, zodat hij niet op de nullijn lijkt)
        if (st.meanMs != null) svgEl.append(S2("line", { class: "rt-c-mean", x1: padL, x2: W - padR, y1: y(st.meanMs), y2: y(st.meanMs) }));
        // Verbindingslijn (onderbroken bij gemiste noten / maten)
        let d = "", pen = false;
        items.forEach((it, i) => {
          if (it.value == null) { pen = false; return; }
          d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(it.value).toFixed(1) + " ";
          pen = true;
        });
        if (d) svgEl.append(S2("path", { class: "rt-c-line", d }));
        // Kruisdraad (bij aanwijzen)
        const cross = S2("line", { class: "rt-c-cross", x1: 0, x2: 0, y1: padT, y2: padT + ph, visibility: "hidden" });
        svgEl.append(cross);
        // Per noot (of maat) één groep: streep, stip en/of kruisje
        const marks = [];
        const missY = padT + ph + 12;
        items.forEach((it, i) => {
          const g = S2("g", { class: "rt-c-item" }, S2("title", { text: `${it.main}, ${it.sub}` }));
          if (it.lo != null && it.hi != null && it.hi > it.lo) {
            g.append(S2("line", { class: "rt-c-range", x1: x(i), x2: x(i), y1: y(it.hi), y2: y(it.lo), "data-kind": it.kind }));
          }
          if (it.value != null) {
            g.append(S2("circle", { class: "rt-c-dot", cx: x(i), cy: y(it.value), r: rDot, "data-kind": it.kind }));
          }
          if (it.miss) {
            g.append(S2("g", { class: "rt-c-miss" },
              S2("line", { x1: x(i) - 3.5, x2: x(i) + 3.5, y1: missY - 3.5, y2: missY + 3.5 }),
              S2("line", { x1: x(i) - 3.5, x2: x(i) + 3.5, y1: missY + 3.5, y2: missY - 3.5 })
            ));
          }
          svgEl.append(g);
          marks.push(g);
        });

        // Tooltip: breekt af als hij te lang is en blijft altijd binnen de grafiek
        const tip = h("div", { class: "rt-tooltip", "aria-hidden": "true" });
        tip.hidden = true;
        let hot = -1;
        function show(i, fromKey) {
          if (i < 0 || i >= n) return hide();
          if (hot >= 0 && marks[hot]) marks[hot].classList.remove("is-hot");
          hot = i;
          marks[i].classList.add("is-hot");
          const it = items[i];
          cross.setAttribute("x1", x(i));
          cross.setAttribute("x2", x(i));
          cross.setAttribute("visibility", "visible");
          tip.replaceChildren(h("b", null, it.main), h("span", null, it.sub));
          tip.hidden = false;
          const half = (tip.offsetWidth || 200) / 2;
          const left = half * 2 + 8 >= W ? W / 2 : Logic.clamp(x(i), half + 4, W - half - 4);
          tip.style.left = left + "px";
          tip.style.top = (it.value == null ? missY : y(it.value)) + "px";
          // Met het toetsenbord: lees de waarde ook voor (de tooltip zelf is alleen voor het oog)
          if (fromKey) live.textContent = `${it.main}, ${it.sub}`;
        }
        function hide() {
          if (hot >= 0 && marks[hot]) marks[hot].classList.remove("is-hot");
          hot = -1;
          tip.hidden = true;
          cross.setAttribute("visibility", "hidden");
        }
        const pick = (e) => {
          const rect = svgEl.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / (rect.width || W)) * W;
          if (px < padL - 6 || px > W - padR + 6) return hide();
          show(Logic.clamp(Math.floor((px - padL) / slot), 0, n - 1), false);
        };
        svgEl.addEventListener("pointermove", pick);
        svgEl.addEventListener("pointerdown", pick); // op touch: aantikken
        svgEl.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
        svgEl.addEventListener("blur", hide);
        svgEl.addEventListener("keydown", (e) => {
          let i = hot;
          if (e.key === "ArrowRight") i = hot < 0 ? 0 : Math.min(n - 1, hot + 1);
          else if (e.key === "ArrowLeft") i = hot < 0 ? n - 1 : Math.max(0, hot - 1);
          else if (e.key === "Home") i = 0;
          else if (e.key === "End") i = n - 1;
          else if (e.key === "Escape") { hide(); return; }
          else return;
          e.preventDefault();
          show(i, true);
        });

        host.replaceChildren(svgEl, tip);
      }

      /* ============================== Toetsen en opruimen ============================== */

      function onKeyDown(e) {
        if (isTypingTarget(e.target)) return;
        if (screen === "play") {
          if (e.key === "Escape") { e.preventDefault(); abortRun(); return; }
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          if (isTapKey(e)) {
            e.preventDefault();
            if (e.repeat) return;
            tap(e);
          }
        } else if (screen === "result") {
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          const t = performance.now();
          // Doorgetikte Spatie/J/F vlak na het einde: niet de pagina laten scrollen of een knop indrukken
          if (isTapKey(e) && t < resultGuardUntil) { e.preventDefault(); return; }
          // R = Nog een keer (pas na het korte wachtmoment)
          if ((e.key === "r" || e.key === "R") && !e.repeat && t >= resultReadyAt) {
            e.preventDefault();
            startRun();
          }
        } else if (screen === "setup" && e.key === "Escape" && preview) {
          stopPreview();
        }
      }

      function onKeyUp(e) {
        // Voorkom dat spatie tijdens het spelen (of vlak erna) een knop activeert
        const guard = screen === "play" || (screen === "result" && performance.now() < resultGuardUntil);
        if (guard && (e.code === "Space" || e.key === " ") && !isTypingTarget(e.target)) e.preventDefault();
      }

      function onVisibility() {
        if (!document.hidden) return;
        if (run && !run.finished) abortRun("Gestopt omdat je van tabblad wisselde. Niet bewaard.");
        else stopPreview();
      }

      return function cleanup() {
        disposed = true;
        flushSave();
        stopPreview();
        if (run) {
          // Weggenavigeerd tijdens een ronde (bijv. per ongeluk de onderbalk geraakt): zeg het even
          const wasPlaying = !run.finished;
          run.finished = true;
          if (run.seq) run.seq.stop();
          run = null;
          if (wasPlaying) ui.toast("Ritme gestopt. Deze ronde is niet bewaard.");
        }
        cancelRaf();
        dropChart();
        clearTimeout(undoTimer);
        undoTimer = null;
        leaveResult();
        App.setPlaying(false);
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    },
  });
})();
