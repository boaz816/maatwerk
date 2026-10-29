/* Maatwerk — BPM-training (id "bpm", CSS-voorvoegsel .bp-).
   Je hoort een metronoom of drumgroove in een willekeurig tempo en schat hoeveel bpm het is.
   Drie staten op één pagina: instellen → spelen (per ronde: vraag, dan uitslag) → resultaat.
   Sessie-record en score volgens docs/CONTRACT.md. */
(function () {
  "use strict";

  const { h, icon } = App.ui;
  const MINUS = App.ui.MINUS;
  const MODE = "bpm";

  /* ---------- Vaste waarden ---------- */
  const PRESETS = [
    { id: "langzaam", label: "Langzaam", min: 50, max: 90 },
    { id: "middel", label: "Middel", min: 80, max: 140 },
    { id: "snel", label: "Snel", min: 130, max: 200 },
    { id: "alles", label: "Alles", min: 50, max: 200 },
  ];
  const RANGE_LO = 40;       // laagste tempo dat je kunt instellen
  const RANGE_HI = 300;      // hoogste tempo dat je kunt instellen
  const MIN_SPAN = 10;       // 'van' en 'tot' liggen minstens zoveel bpm uit elkaar
  const GUESS_LO = 20;       // grenzen voor een schatting
  const GUESS_HI = 400;
  const ROUND_OPTIONS = [5, 10, 20];
  const BEAT_OPTIONS = [8, 16];
  const SOUNDS = [
    { value: "click", label: "Klik", title: "Elektronische metronoomtik" },
    { value: "wood", label: "Hout", title: "Houtblok, zoals een klassieke metronoom" },
    { value: "drums", label: "Drums", title: "Kick, snare en hihat" },
  ];
  /* customMin/customMax: je laatste eigen bereik, apart bewaard zodat het terugkomt bij 'Eigen'. */
  const DEFAULTS = {
    preset: "middel", minBpm: 80, maxBpm: 140, customMin: null, customMax: null,
    rounds: 10, sound: "click", beats: 8, tapHelp: false,
  };
  const TAP_MIN = 3;          // zoveel tikken voordat er een geschat tempo verschijnt
  const TAP_RESET_MS = 2000;  // langer dan dit stil = opnieuw beginnen met tikken

  /* ==== REKENLOGICA-BEGIN — zuiver (geen DOM, geen geluid), los te testen ==== */
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function mean(list) { return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0; }
  function round2(x) { return Math.round(x * 100) / 100; }

  /* Geldig tempobereik: hele getallen binnen de grenzen en ver genoeg uit elkaar. */
  function validRange(lo, hi) {
    return Number.isInteger(lo) && Number.isInteger(hi) && lo >= RANGE_LO && hi <= RANGE_HI && hi - lo >= MIN_SPAN;
  }
  function matchPreset(lo, hi) {
    const p = PRESETS.find((x) => x.min === lo && x.max === hi);
    return p ? p.id : "eigen";
  }

  /* Opgeslagen instellingen controleren en aanvullen. De gekozen voorkeuze is leidend;
     een oud record zonder geldige voorkeuze leidt hem af uit het bereik. */
  function normalizeSettings(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const s = Object.assign({}, DEFAULTS);
    const int = (v) => Math.round(Number(v));
    const lo = int(r.minBpm);
    const hi = int(r.maxBpm);
    const cLo = int(r.customMin);
    const cHi = int(r.customMax);
    if (validRange(cLo, cHi)) { s.customMin = cLo; s.customMax = cHi; }
    const preset = PRESETS.find((p) => p.id === r.preset);
    if (preset) {
      s.preset = preset.id;
      s.minBpm = preset.min;
      s.maxBpm = preset.max;
    } else if (validRange(lo, hi)) {
      s.preset = r.preset === "eigen" ? "eigen" : matchPreset(lo, hi);
      s.minBpm = lo;
      s.maxBpm = hi;
      if (s.preset === "eigen" && s.customMin == null) { s.customMin = lo; s.customMax = hi; }
    } else if (r.preset === "eigen" && s.customMin != null) {
      s.preset = "eigen";
      s.minBpm = s.customMin;
      s.maxBpm = s.customMax;
    }
    if (ROUND_OPTIONS.includes(Number(r.rounds))) s.rounds = Number(r.rounds);
    if (SOUNDS.some((o) => o.value === r.sound)) s.sound = r.sound;
    if (BEAT_OPTIONS.includes(Number(r.beats))) s.beats = Number(r.beats);
    s.tapHelp = r.tapHelp === true;
    return s;
  }

  /* Willekeurig heel tempo in [min, max], nooit gelijk aan het vorige. */
  function pickTempo(min, max, prev, rand) {
    const rnd = rand || Math.random;
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    if (hi <= lo) return lo;
    const skip = Number.isInteger(prev) && prev >= lo && prev <= hi;
    const count = hi - lo + 1 - (skip ? 1 : 0);
    let v = lo + Math.min(count - 1, Math.floor(rnd() * count));
    if (skip && v >= prev) v += 1;
    return v;
  }

  /* Fout in procenten van het echte tempo, afgerond op 2 decimalen (zo staat het in het record). */
  function pctError(actual, guess) { return round2((Math.abs(guess - actual) / actual) * 100); }

  /* Rondescore volgens CONTRACT: max(0, 100 − 10 × pctErr). */
  function roundScore(pctErr) { return Math.max(0, 100 - 10 * pctErr); }

  /* Eén ronde zoals hij bewaard wordt. diff = schatting − echt. */
  function makeRound(actual, guess, replays, timeMs) {
    return { actual, guess, diff: guess - actual, pctErr: pctError(actual, guess), replays, timeMs };
  }

  /* Oordeel over één ronde: een woord en een toon (ok | warn | bad). */
  function verdict(diff, pctErr) {
    if (diff === 0) return { word: "Precies goed", tone: "ok" };
    if (pctErr <= 2) return { word: "Heel dichtbij", tone: "ok" };
    if (pctErr <= 5) return { word: "Dichtbij", tone: "warn" };
    if (pctErr <= 10) return { word: "Een eind ernaast", tone: "bad" };
    return { word: "Ver ernaast", tone: "bad" };
  }

  /* Richting van het verschil in woorden. */
  function diffWord(diff) {
    if (diff > 0) return "te hoog";
    if (diff < 0) return "te laag";
    return "precies goed";
  }

  /* Octaaffout: je schatting ligt binnen 5% van het dubbele of het halve tempo.
     De meest gemaakte fout bij tempo schatten: de puls klopt, je telt alleen op een ander niveau. */
  function octaveSlip(actual, guess) {
    if (!(actual > 0) || !(guess > 0)) return null;
    const ratio = guess / actual;
    const tol = 0.05 + 1e-9;   // marge voor afrondingsfouten precies op de grens
    if (Math.abs(ratio / 2 - 1) <= tol) return "dubbel";
    if (Math.abs(ratio * 2 - 1) <= tol) return "half";
    return null;
  }

  /* Uitleg bij een octaaffout, passend bij de klank. */
  function octaveNote(slip, sound) {
    const drums = sound === "drums";
    if (slip === "dubbel") {
      return drums
        ? "Je hoorde het dubbele tempo: je telde de hihat (de achtsten) als tel. Tel mee op kick en snare."
        : "Je hoorde het dubbele tempo: je telde twee keer per tik. Elke tik is één tel.";
    }
    if (slip === "half") {
      return drums
        ? "Je hoorde het halve tempo: je telde alleen de kick op 1 en 3. De snare op 2 en 4 is ook een tel."
        : "Je hoorde het halve tempo: je telde één keer per twee tikken. Elke tik is een tel.";
    }
    return "";
  }

  /* Score en stats van een hele sessie (CONTRACT), plus totaal replays en gemiddelde denktijd. */
  function summarize(rounds) {
    const n = rounds.length;
    if (!n) {
      return { score: 0, stats: { meanAbsDiff: 0, meanDiff: 0, meanPctErr: 0, within2: 0, within5: 0, replays: 0, meanTimeMs: 0 } };
    }
    const abs = rounds.map((r) => Math.abs(r.diff));
    const frac = (count) => Math.round((count / n) * 1000) / 1000;
    return {
      score: Math.round(mean(rounds.map((r) => roundScore(r.pctErr)))),
      stats: {
        meanAbsDiff: round2(mean(abs)),
        meanDiff: round2(mean(rounds.map((r) => r.diff))),
        meanPctErr: round2(mean(rounds.map((r) => r.pctErr))),
        within2: frac(abs.filter((d) => d <= 2).length),
        within5: frac(abs.filter((d) => d <= 5).length),
        replays: rounds.reduce((a, r) => a + (r.replays || 0), 0),
        meanTimeMs: Math.round(mean(rounds.map((r) => r.timeMs || 0))),
      },
    };
  }

  /* Neiging: schat je structureel te hoog of te laag? We kijken naar de waarde zoals hij op het
     scherm staat (één decimaal); onder een halve bpm telt het niet. */
  function tendency(meanDiff) {
    const amount = Math.round(Math.abs(meanDiff) * 10) / 10;
    if (amount < 0.5) return { dir: null, amount };
    return { dir: meanDiff > 0 ? "hoog" : "laag", amount };
  }

  /* Trek je naar het midden (langzaam te hoog, snel te laag) of juist uit elkaar?
     Vergelijkt de langzaamste helft van de rondes met de snelste helft. */
  function centerPull(rounds) {
    if (rounds.length < 4) return null;
    const sorted = rounds.slice().sort((a, b) => a.actual - b.actual);
    const half = Math.floor(sorted.length / 2);
    const low = sorted.slice(0, half);
    const high = sorted.slice(sorted.length - half);
    const spread = mean(high.map((r) => r.actual)) - mean(low.map((r) => r.actual));
    if (spread < 15) return null;
    const lo = mean(low.map((r) => r.diff));
    const hi = mean(high.map((r) => r.diff));
    if (lo - hi >= 4 && lo > 0.5 && hi < -0.5) return { kind: "midden", low: lo, high: hi };
    if (hi - lo >= 4 && lo < -0.5 && hi > 0.5) return { kind: "uiteen", low: lo, high: hi };
    return null;
  }

  /* Korte zinnen voor "Wat valt op". sound = de klank van de sessie (voor de tel-tip). */
  function insights(rounds, stats, sound) {
    const out = [];
    const drums = sound === "drums";
    const times = (n) => (n === 1 ? "Eén keer" : `${n} keer`);
    const t = tendency(stats.meanDiff);
    out.push(t.dir
      ? `Je schat gemiddeld ${fmtNum(t.amount)} bpm te ${t.dir}.`
      : "Je schat niet structureel te hoog of te laag: mooi in balans.");
    const cp = centerPull(rounds);
    if (cp && cp.kind === "midden") out.push("Langzame tempo's schat je te hoog en snelle te laag: je trekt naar het midden. Let vooral op bij de uitersten.");
    if (cp && cp.kind === "uiteen") out.push("Langzame tempo's schat je te laag en snelle te hoog: je overdrijft het verschil.");
    const slips = { dubbel: 0, half: 0 };
    rounds.forEach((r) => { const s = octaveSlip(r.actual, r.guess); if (s) slips[s] += 1; });
    if (slips.dubbel) {
      out.push(`${times(slips.dubbel)} hoorde je het dubbele tempo. ${drums ? "Tel op kick en snare, niet op de hihat." : "Elke tik is één tel."}`);
    }
    if (slips.half) {
      out.push(`${times(slips.half)} hoorde je het halve tempo. ${drums ? "Kick én snare zijn allebei een tel." : "Elke tik is een tel."}`);
    }
    const exact = rounds.filter((r) => r.diff === 0).length;
    if (exact) out.push(exact === 1 ? "Eén keer precies goed geraden." : `${exact} keer precies goed geraden.`);
    if (rounds.length > 1) {
      let best = 0;
      let worst = 0;
      rounds.forEach((r, i) => {
        if (Math.abs(r.diff) < Math.abs(rounds[best].diff)) best = i;
        if (Math.abs(r.diff) > Math.abs(rounds[worst].diff)) worst = i;
      });
      const b = rounds[best];
      const w = rounds[worst];
      if (!exact && best !== worst) out.push(`Het dichtst zat je in ronde ${best + 1}: ${b.actual} bpm, jij zei ${b.guess}.`);
      if (w.diff !== 0 && best !== worst) out.push(`Het verst ernaast zat je in ronde ${worst + 1}: ${w.actual} bpm, jij zei ${w.guess}.`);
    }
    if (stats.replays > 0) out.push(`Je luisterde in totaal ${stats.replays}× opnieuw.`);
    return out;
  }

  /* Alleen sessies met dezelfde tik-hulp-stand: met tik-hulp is raden bijna meten. */
  function sameTapHelp(list, tapHelp) {
    return list.filter((s) => !!(s && s.settings && s.settings.tapHelp) === !!tapHelp);
  }

  /* Tekst voor het verschil in score met de vorige sessie. */
  function scoreDeltaText(d) {
    if (d === 0) return "Gelijk aan vorige keer";
    const n = Math.abs(d);
    return `${n} ${n === 1 ? "punt" : "punten"} ${d > 0 ? "hoger" : "lager"} dan vorige keer`;
  }

  /* Tikken bijhouden (tijden in ms). Na een lange stilte begin je opnieuw. */
  function addTap(times, stamp) {
    const last = times.length ? times[times.length - 1] : null;
    if (last == null || stamp - last > TAP_RESET_MS || stamp <= last) return [stamp];
    return times.concat(stamp).slice(-16);
  }

  /* Geschat tempo uit tiktijden: rechte lijn door (tiknummer, tijd); de helling = ms per tel.
     Rustiger dan het gemiddelde van losse intervallen, en één slordige tik weegt minder. */
  function tapBpm(times) {
    const t = times.slice(-12);
    const n = t.length;
    if (n < 2) return null;
    const mx = (n - 1) / 2;
    const my = mean(t);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - mx) * (t[i] - my);
      den += (i - mx) * (i - mx);
    }
    const msPerBeat = num / den;
    if (!(msPerBeat > 0)) return null;
    return 60000 / msPerBeat;
  }

  /* Meetlat rond twee waarden: ingezoomd zodat ook een klein verschil zichtbaar is. */
  function rulerScale(actual, guess) {
    const lo = Math.min(actual, guess);
    const hi = Math.max(actual, guess);
    const span = Math.max(20, (hi - lo) * 1.6 + 8);
    const mid = (lo + hi) / 2;
    let min = mid - span / 2;
    let max = mid + span / 2;
    if (min < 0) { max -= min; min = 0; }
    const [minor, major] = span <= 32 ? [1, 5] : span <= 64 ? [2, 10] : span <= 130 ? [5, 20] : [10, 50];
    const ticks = [];
    for (let v = Math.ceil(min / minor) * minor; v <= max + 1e-9; v += minor) {
      ticks.push({ v, major: v % major === 0, pos: (v - min) / (max - min) });
    }
    return { min, max, ticks };
  }

  /* Y-as van de rondegrafiek: ronde stappen (5, 10, 20, 25, 50, 100). */
  function chartAxis(values) {
    let lo = Math.min.apply(null, values);
    let hi = Math.max.apply(null, values);
    const pad = Math.max(4, (hi - lo) * 0.08);
    lo -= pad;
    hi += pad;
    const raw = (hi - lo) / 4;
    const step = [5, 10, 20, 25, 50, 100].find((s) => s >= raw) || 100;
    lo = Math.max(0, Math.floor(lo / step) * step);
    hi = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
    return { min: lo, max: hi, ticks };
  }

  /* Geluidsreeks voor App.audio.sequence. 'mark' per tel is alleen voor het beeld.
     Drums: kick op 1 en 3, snare op 2 en 4, hihat op de achtsten. Klik/hout: accent op tel 1. */
  function buildEvents(bpm, beats, sound) {
    const spb = 60 / bpm;
    const out = [];
    for (let i = 0; i < beats; i++) {
      const t = i * spb;
      const pos = i % 4;
      out.push({ t, kind: "mark", beat: i });
      if (sound === "drums") {
        const kick = pos === 0 || pos === 2;
        out.push({ t, kind: "drum", sound: kick ? "kick" : "snare", level: kick ? 1 : 0.8 });
        out.push({ t, kind: "drum", sound: "hat", level: 0.7 });
        out.push({ t: t + spb / 2, kind: "drum", sound: "hat", level: 0.45 });
      } else {
        out.push({ t, kind: "click", voice: sound === "wood" ? "wood" : "click", accent: pos === 0 });
      }
    }
    return out;
  }

  /* Getal met Nederlandse komma; een ",0" op het eind valt weg (2,0 → 2). */
  function fmtNum(x, digits) {
    const d = digits == null ? 1 : digits;
    const f = Math.pow(10, d);
    const v = Math.round(Math.abs(x) * f) / f;
    let s = v.toFixed(d).replace(".", ",");
    if (d > 0) s = s.replace(/,?0+$/, "");
    return (x < 0 && v !== 0 ? MINUS : "") + s;
  }
  /* +1,3 / −2 / 0 — rondt precies zo af als fmtNum, zodat tegel en tekst hetzelfde getal tonen. */
  function fmtSignedNum(x) {
    const s = fmtNum(Math.abs(x));
    if (s === "0") return "0";
    return (x > 0 ? "+" : MINUS) + s;
  }
  /* +4 / −4 / 0 */
  function fmtSignedInt(n) {
    return n > 0 ? "+" + n : n < 0 ? MINUS + Math.abs(n) : "0";
  }
  /* Procent zonder misleidende "0%" bij een heel kleine fout. */
  function fmtPctNum(x) {
    return x > 0 && x < 0.05 ? "minder dan 0,1" : fmtNum(x);
  }

  function resultTitle(score) {
    if (score >= 90) return "Uitstekend tempogevoel";
    if (score >= 75) return "Sterk gehoord";
    if (score >= 55) return "Goed op weg";
    if (score >= 30) return "Je komt in de buurt";
    return "Oefening baart kunst";
  }
  /* ==== REKENLOGICA-EINDE ==== */

  App.registerMode({
    id: MODE,
    title: "BPM-training",
    nav: "BPM",
    description: "Een metronoom tikt. Hoe snel is het? Raad het tempo zo precies mogelijk.",
    mount,
  });

  /* ---------- Losse hulpjes (zonder toestand) ---------- */

  /* Laatst gekozen instellingen, gecontroleerd op geldige waarden. */
  function loadSettings() {
    return normalizeSettings(App.store.modeSettings(MODE, {}));
  }
  function soundName(v) {
    const o = SOUNDS.find((x) => x.value === v);
    return o ? o.label : v;
  }
  /* Positie (%) op de schaal van het instelbare bereik. */
  function scalePos(v) { return ((v - RANGE_LO) / (RANGE_HI - RANGE_LO)) * 100; }
  function matches(query) {
    try { return window.matchMedia(query).matches; } catch (e) { return false; }
  }
  /* Typt de gebruiker ergens? Dan doen de sneltoetsen van de pagina niets. */
  function isTypingTarget(t) {
    if (!t || !t.tagName) return false;
    return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || !!t.isContentEditable;
  }
  /* Staat de focus op een knop of link? Dan regelt Enter die knop zelf. */
  function isControl(t) {
    return !!(t && t.closest && t.closest("button, a, [role='button'], [role='spinbutton'], summary, label"));
  }
  /* CSS-animatie opnieuw laten beginnen. */
  function restartAnim(el, cls, others) {
    el.classList.remove(cls);
    if (others) others.forEach((c) => el.classList.remove(c));
    void el.offsetWidth;
    el.classList.add(cls);
  }
  /* Toetslabel in een knop. Verborgen voor schermlezers: de knop krijgt aria-keyshortcuts. */
  function kbd(label) {
    return h("span", { class: "kbd", "aria-hidden": "true" }, label);
  }
  /* Een muisklik laat de focus waar hij was (net als bij de plus/min-knoppen). Anders pakt de knop
     in Chrome en Firefox de focus, en doet Enter daarna iets anders dan de pagina belooft. */
  function noFocusSteal(btn) {
    btn.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") e.preventDefault(); });
  }

  /* ================================================================== */
  function mount(root) {
    const S = loadSettings();
    const ui = {};                 // verwijzingen naar elementen van de huidige staat
    const frames = new Set();      // lopende requestAnimationFrame-id's
    const hold = { t: null, i: null };
    const finePointer = matches("(hover: hover) and (pointer: fine)");
    let alive = true;
    let state = "setup";
    let session = null;
    let playHandle = null;         // de reeks die nu speelt (de ronde zelf)
    let compare = null;            // { handle, btn } bij "vergelijk" in de uitslag
    let modalOpen = false;
    let starting = false;
    let saveTimer = null;

    const head = App.ui.pageHead({
      eyebrow: "BPM-training",
      title: "Hoe snel is het?",
      lead: "Je hoort een metronoom of een drumgroove in een willekeurig tempo. Schat hoeveel bpm (tellen per minuut) het is en zie meteen hoe dicht je erbij zat.",
    });
    const body = h("div", { class: "bp-body" });
    const wrap = h("div", { class: "bp", dataset: { state } }, head, body);
    root.append(wrap);

    document.addEventListener("keydown", onKeydown);
    document.addEventListener("keyup", onKeyup);
    showSetup(false);

    return function cleanup() {
      alive = false;
      if (saveTimer) flushSettings();
      stopPlayback();
      stopCompare();
      stopHold();
      frames.forEach(cancelAnimationFrame);
      frames.clear();
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("keyup", onKeyup);
    };

    /* ---------- Algemene hulpjes ---------- */
    function frame(fn) {
      const id = requestAnimationFrame(() => { frames.delete(id); if (alive) fn(); });
      frames.add(id);
      return id;
    }
    /* Opslaan met een korte vertraging: ingedrukt gehouden plus/min-knoppen schrijven niet elke 60 ms. */
    function saveSettings() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSettings, 250);
    }
    function flushSettings() {
      clearTimeout(saveTimer);
      saveTimer = null;
      App.store.saveModeSettings(MODE, {
        preset: S.preset, minBpm: S.minBpm, maxBpm: S.maxBpm,
        customMin: S.customMin, customMax: S.customMax,
        rounds: S.rounds, sound: S.sound, beats: S.beats, tapHelp: S.tapHelp,
      });
    }
    function setState(next) {
      state = next;
      wrap.dataset.state = next;
      body.replaceChildren();
      Object.keys(ui).forEach((k) => delete ui[k]);
    }
    function stopPlayback() {
      if (!playHandle) return;
      const hd = playHandle;
      playHandle = null;
      hd.stop();
    }
    function stopCompare() {
      if (!compare) return;
      const c = compare;
      compare = null;
      c.handle.stop();
      c.btn.classList.remove("is-playing");
    }
    function stopHold() {
      clearTimeout(hold.t);
      clearInterval(hold.i);
      hold.t = null;
      hold.i = null;
    }

    /* Schuif zo weinig mogelijk, zodat 'lastEl' boven de onderbalk (telefoon) in beeld staat
       zonder dat de bovenkant van 'firstEl' uit beeld raakt. De bovenkant gaat voor. */
    function keepInView(firstEl, lastEl) {
      if (!firstEl || !lastEl || typeof firstEl.getBoundingClientRect !== "function") return;
      const margin = 12;
      const vh = window.innerHeight || 0;
      if (!vh) return;
      const nav = document.querySelector(".bottom-nav");
      const navTop = nav && nav.offsetHeight ? nav.getBoundingClientRect().top : vh;
      const limit = Math.min(vh, navTop) - margin;
      const top = firstEl.getBoundingClientRect().top;
      const bottom = lastEl.getBoundingClientRect().bottom;
      let dy = 0;
      if (top < margin) dy = top - margin;
      else if (bottom > limit) dy = Math.min(bottom - limit, top - margin);
      if (Math.abs(dy) >= 1) window.scrollBy(0, dy);
    }

    /* ================= Instellen ================= */
    function showSetup(focusStart) {
      stopPlayback();
      stopCompare();
      session = null;
      setState("setup");

      const band = h("div", { class: "bp-range-band" });
      const rangeBar = h("div", { class: "bp-range", "aria-hidden": "true" },
        h("div", { class: "bp-range-track" }, band),
        h("div", { class: "bp-range-scale" },
          [60, 120, 180, 240].map((v) => h("span", { style: { left: scalePos(v) + "%" } }, String(v))))
      );
      const summary = h("p", { class: "bp-summary" });
      const eigenRange = h("span", { class: "bp-preset-range" });

      const presetSeg = App.ui.segmented({
        options: PRESETS.map((p) => ({
          value: p.id,
          title: `${p.min} tot ${p.max} bpm`,
          label: [h("span", { class: "bp-preset-name" }, p.label), h("span", { class: "bp-preset-range num" }, `${p.min}–${p.max}`)],
        })).concat({
          value: "eigen",
          title: "Kies zelf het laagste en hoogste tempo",
          label: [h("span", { class: "bp-preset-name" }, "Eigen"), eigenRange],
        }),
        value: S.preset,
        block: true,
        ariaLabel: "Tempobereik",
        onChange: (v) => {
          S.preset = v;
          const p = PRESETS.find((x) => x.id === v);
          if (p) {
            S.minBpm = p.min;
            S.maxBpm = p.max;
          } else {
            // Eigen: terug naar je laatste eigen bereik, of begin bij wat er net stond
            if (S.customMin == null) { S.customMin = S.minBpm; S.customMax = S.maxBpm; }
            S.minBpm = S.customMin;
            S.maxBpm = S.customMax;
          }
          minStep.value = S.minBpm;
          maxStep.value = S.maxBpm;
          saveSettings();
          renderRange();
        },
      });
      presetSeg.classList.add("bp-presets");

      const minStep = App.ui.stepper({
        value: S.minBpm, min: RANGE_LO, max: RANGE_HI - MIN_SPAN, step: 1, bigStep: 10,
        ariaLabel: "Laagste tempo in bpm",
        onChange: (v) => {
          S.minBpm = v;
          if (S.maxBpm < v + MIN_SPAN) { S.maxBpm = v + MIN_SPAN; maxStep.value = S.maxBpm; }
          afterRangeEdit();
        },
      });
      const maxStep = App.ui.stepper({
        value: S.maxBpm, min: RANGE_LO + MIN_SPAN, max: RANGE_HI, step: 1, bigStep: 10,
        ariaLabel: "Hoogste tempo in bpm",
        onChange: (v) => {
          S.maxBpm = v;
          if (S.minBpm > v - MIN_SPAN) { S.minBpm = v - MIN_SPAN; minStep.value = S.minBpm; }
          afterRangeEdit();
        },
      });
      /* De tellers staan alleen open bij 'Eigen': wat je instelt is je eigen bereik. */
      function afterRangeEdit() {
        S.customMin = S.minBpm;
        S.customMax = S.maxBpm;
        saveSettings();
        renderRange();
      }
      const rangeEditor = h("div", { class: "bp-range-row", id: "bp-custom-range" },
        App.ui.field("Van", minStep), App.ui.field("Tot", maxStep), rangeBar);

      const roundsSeg = App.ui.segmented({
        options: ROUND_OPTIONS.map((n) => ({ value: n, label: String(n) })),
        value: S.rounds, ariaLabel: "Aantal rondes",
        onChange: (v) => { S.rounds = v; saveSettings(); renderRange(); },
      });
      const soundSeg = App.ui.segmented({
        options: SOUNDS, value: S.sound, ariaLabel: "Klank",
        onChange: (v) => { S.sound = v; saveSettings(); renderRange(); },
      });
      const beatsSeg = App.ui.segmented({
        options: BEAT_OPTIONS.map((n) => ({ value: n, label: n + " tellen" })),
        value: S.beats, ariaLabel: "Lengte",
        onChange: (v) => { S.beats = v; saveSettings(); renderRange(); },
      });
      const tapToggle = App.ui.toggle({
        checked: S.tapHelp,
        onChange: (v) => { S.tapHelp = v; saveSettings(); renderRange(); renderHistory(); },
      });
      const tapInput = tapToggle.querySelector("input");
      if (tapInput) {
        tapInput.setAttribute("id", "bp-taphelp");
        tapInput.setAttribute("aria-describedby", "bp-tap-hint");
      }

      const hintEl = (text, opts) => h("div", {
        class: "bp-opt-hint" + (opts && opts.optional ? " is-optional" : ""),
        id: (opts && opts.id) || null,
      }, text);
      const opt = (title, hint, control) => h("div", { class: "bp-opt" },
        typeof title === "string" ? h("div", { class: "bp-opt-title" }, title) : title,
        hint,
        h("div", { class: "bp-opt-control" }, control)
      );
      const soundHintEl = hintEl(soundHint(S.sound));

      const settingsPanel = h("section", { class: "panel bp-settings", "aria-labelledby": "bp-settings-title" },
        h("h2", { class: "panel-title", id: "bp-settings-title" }, "Instellingen"),
        h("div", { class: "bp-section-head" }, h("span", { class: "bp-section-label" }, "Tempobereik")),
        presetSeg,
        rangeEditor,
        h("div", { class: "bp-opts" },
          opt("Rondes", hintEl("Hoeveel tempo's je raadt.", { optional: true }), roundsSeg),
          opt("Klank", soundHintEl, soundSeg),
          opt("Lengte", hintEl("Hoeveel tellen je per keer hoort.", { optional: true }), beatsSeg),
          opt(h("label", { class: "bp-opt-title", for: "bp-taphelp" }, "Tik-hulp"),
            hintEl("Tik mee met de spatiebalk of op het tikvlak en zie een geschat tempo.", { id: "bp-tap-hint" }),
            tapToggle))
      );

      const startBtn = h("button", { type: "button", class: "btn btn-primary btn-lg bp-start", onClick: start },
        icon("play", 18), "Start");
      const historySlot = h("div", { class: "bp-history-slot" });

      body.append(
        h("div", { class: "bp-setup" },
          h("div", { class: "bp-setup-grid" },
            h("div", { class: "bp-setup-main" }, settingsPanel, h("div", { class: "bp-start-row" }, startBtn, summary)),
            howPanel(historySlot)))
      );

      function renderRange() {
        const custom = S.preset === "eigen";
        rangeEditor.hidden = !custom;
        band.style.left = scalePos(S.minBpm) + "%";
        band.style.width = scalePos(S.maxBpm) - scalePos(S.minBpm) + "%";
        const hasCustom = S.customMin != null;
        eigenRange.textContent = hasCustom ? `${S.customMin}–${S.customMax}` : "zelf kiezen";
        eigenRange.classList.toggle("num", hasCustom);
        soundHintEl.textContent = soundHint(S.sound);
        const avg = (S.minBpm + S.maxBpm) / 2;
        const perRound = 0.4 + (S.beats * 60) / avg + 6;   // luisteren + denken + uitslag
        const minutes = Math.max(1, Math.round((S.rounds * perRound) / 60));
        summary.textContent = `${S.rounds} rondes · ${S.minBpm}–${S.maxBpm} bpm · ${soundName(S.sound)}`
          + `${S.tapHelp ? " · met tik-hulp" : ""} · ongeveer ${minutes} min`;
      }
      function renderHistory() {
        const block = historyBlock(S.tapHelp);
        historySlot.replaceChildren(...(block ? [block] : []));
      }
      renderRange();
      renderHistory();
      if (focusStart) frame(() => startBtn.focus({ preventScroll: true }));
    }

    function soundHint(sound) {
      if (sound === "drums") return "Drums: kick op 1 en 3, snare op 2 en 4, hihat op de achtsten.";
      if (sound === "wood") return "Hout: een warme tik, zoals een klassieke metronoom. Tel 1 klinkt hoger.";
      return "Klik: een strakke metronoomtik. Tel 1 klinkt hoger.";
    }

    /* Zijpaneel: uitleg, houvast en (in historySlot) je laatste sessies. */
    function howPanel(historySlot) {
      const steps = [
        ["Luister", "Een metronoom of groove speelt 8 of 16 tellen in een willekeurig tempo."],
        ["Schat", "Typ hoeveel bpm het is. Raden mag al terwijl het nog speelt."],
        ["Vergelijk", "Je ziet het echte tempo, jouw schatting en hoeveel je ernaast zat."],
      ];
      return h("aside", { class: "panel bp-how", "aria-label": "Zo werkt het" },
        h("h2", { class: "panel-title" }, "Zo werkt het"),
        h("ol", { class: "bp-how-steps" },
          steps.map(([title, text], i) => h("li", null,
            h("span", { class: "bp-how-no num", "aria-hidden": "true" }, String(i + 1)),
            h("div", null, h("b", null, title), h("p", null, text))))),
        h("div", { class: "bp-anchors" },
          h("div", { class: "bp-side-title" }, "Houvast"),
          h("div", { class: "bp-anchor" }, h("b", null, "60"), h("span", null, "één tel per seconde, als een secondewijzer")),
          h("div", { class: "bp-anchor" }, h("b", null, "120"), h("span", null, "twee tellen per seconde, een marstempo")),
          h("p", { class: "bp-anchor-tip" }, "Tel in je hoofd in vieren mee en vergelijk met een tempo dat je kent.")),
        historySlot
      );
    }

    /* Je laatste sessies, alleen met dezelfde tik-hulp-stand (anders vergelijk je appels met peren). */
    function historyBlock(tapHelp) {
      const prior = sameTapHelp(App.store.sessions(MODE), tapHelp);
      if (!prior.length) return null;
      const recent = prior.slice(-12);
      const scoreOf = (s) => Math.round(Number(s.score) || 0);
      const best = Math.max.apply(null, prior.map(scoreOf));
      return h("div", { class: "bp-history" },
        h("div", { class: "bp-side-title" }, tapHelp ? "Jouw sessies met tik-hulp" : "Jouw sessies"),
        h("div", {
          class: "bp-spark", role: "img",
          "aria-label": `Scores van je laatste ${recent.length} sessies: ${recent.map(scoreOf).join(", ")}`,
        }, recent.map((s) => h("span", {
          style: { "--h": Math.max(4, scoreOf(s)) + "%" },
          title: `${App.ui.fmtDate(s.ts, true)}: score ${scoreOf(s)}`,
        }))),
        h("div", { class: "bp-history-stats" },
          App.ui.stat(String(scoreOf(prior[prior.length - 1])), "laatste"),
          App.ui.stat(String(best), "beste"),
          App.ui.stat(String(prior.length), prior.length === 1 ? "sessie" : "sessies"))
      );
    }

    /* ================= Spelen ================= */
    async function start() {
      if (starting) return;
      starting = true;
      try {
        await App.audio.ready();
      } catch (e) {
        starting = false;
        App.ui.toast("Het geluid kon niet starten. Probeer het nog eens.", "bad");
        return;
      }
      starting = false;
      if (!alive) return;
      if (saveTimer) flushSettings();
      session = {
        settings: { minBpm: S.minBpm, maxBpm: S.maxBpm, rounds: S.rounds, sound: S.sound, beats: S.beats, tapHelp: S.tapHelp },
        startedAt: performance.now(),
        rounds: [],
        prev: null,
        current: null,
        phase: "ask",
        revealAt: 0,
        saved: null,            // { rec, prior } zodra de laatste ronde geraden is
      };
      setState("play");
      body.append(buildStage());
      window.scrollTo(0, 0);
      startRound();
    }

    function buildStage() {
      const n = session.settings.rounds;
      ui.round = h("span", { class: "bp-round", tabindex: "-1" });
      ui.runScore = h("span", { class: "bp-runscore" });
      ui.segs = Array.from({ length: n }, () => h("span"));
      ui.live = h("p", { class: "visually-hidden", "aria-live": "polite" });
      ui.face = h("div", { class: "bp-face" });
      ui.stage = h("section", { class: "panel bp-stage", "aria-label": "Oefening" },
        h("div", { class: "bp-stage-top" },
          ui.round,
          ui.runScore,
          h("button", { type: "button", class: "btn btn-ghost bp-quit", onClick: askStop }, icon("x", 16), "Stoppen"),
          h("div", { class: "bp-progress", "aria-hidden": "true" }, ui.segs)),
        ui.face,
        ui.live
      );
      return ui.stage;
    }

    function startRound() {
      const set = session.settings;
      const actual = pickTempo(set.minBpm, set.maxBpm, session.prev);
      session.prev = actual;
      session.current = { actual, replays: 0, startedAt: performance.now(), taps: [], tapBpm: null };
      session.phase = "ask";
      updateProgress();
      renderAsk();
      ui.live.textContent = `Ronde ${session.rounds.length + 1} van ${set.rounds}.`;
      playCurrent();
      frame(() => {
        if (state !== "play" || !ui.input) return;
        // Muis en toetsenbord: meteen typen. Aanraken: geen toetsenbord opdringen, wel een vaste plek
        // voor de focus (de vorige knop is weg), zodat een schermlezer niet de draad kwijtraakt.
        if (finePointer) ui.input.focus({ preventScroll: true });
        else if (ui.round) ui.round.focus({ preventScroll: true });
        keepInView(ui.stage, ui.confirmBtn);
      });
    }

    function updateProgress() {
      const n = session.settings.rounds;
      const done = session.rounds.length;
      const asking = session.phase === "ask";
      ui.round.textContent = `Ronde ${asking ? done + 1 : done} van ${n}`;
      ui.segs.forEach((s, i) => {
        s.classList.toggle("is-done", i < done);
        s.classList.toggle("is-current", asking && i === done);
      });
      if (done) {
        const avg = Math.round(mean(session.rounds.map((r) => roundScore(r.pctErr))));
        ui.runScore.replaceChildren("Score ", h("b", null, String(avg)));
      } else {
        ui.runScore.textContent = "";
      }
    }

    /* Vraagscherm: het beeld, de invoer (veld + Bevestig in één rij) en eventueel het tikvlak.
       Op breed staan beeld en tikvlak links en de invoer rechts; op smal staat alles onder elkaar,
       met het tikvlak ná de invoer, zodat veld en Bevestig meteen in beeld zijn. */
    function renderAsk() {
      const set = session.settings;

      ui.count = h("span", { class: "bp-count num" }, "·");
      ui.pulse = h("div", { class: "bp-pulse", "aria-hidden": "true" },
        h("div", { class: "bp-ripple" }),
        h("div", { class: "bp-core" }, ui.count));
      ui.dots = [];
      const bars = [];
      for (let b = 0; b < set.beats / 4; b++) {
        const bar = h("div", { class: "bp-bar" });
        for (let k = 0; k < 4; k++) {
          const d = h("span", { class: "bp-dot" + (k === 0 ? " is-one" : "") });
          ui.dots.push(d);
          bar.append(d);
        }
        bars.push(bar);
      }
      ui.status = h("p", { class: "bp-status", "aria-live": "polite" });
      const visual = h("div", { class: "bp-visual" },
        ui.pulse,
        h("div", { class: "bp-beats" },
          h("div", { class: "bp-dots", "aria-hidden": "true" }, bars),
          ui.status)
      );

      ui.input = h("input", {
        id: "bp-guess", class: "input num bp-guess", type: "text",
        inputmode: "numeric", pattern: "[0-9]*", maxlength: "3",
        autocomplete: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "done",
        placeholder: "—", "aria-describedby": "bp-guess-err",
      });
      ui.input.addEventListener("input", onGuessInput);
      ui.input.addEventListener("keydown", onGuessKey);
      ui.err = h("p", { class: "bp-err", id: "bp-guess-err", role: "alert" });
      ui.confirmBtn = h("button", {
        type: "button", class: "btn btn-primary bp-confirm", "aria-keyshortcuts": "Enter",
        onClick: () => confirmGuess(),
      }, icon("check", 18), h("span", { class: "bp-confirm-text" }, "Bevestig"), kbd("Enter"));
      ui.replayBtn = h("button", {
        type: "button", class: "btn bp-replay", "aria-keyshortcuts": "R",
        onClick: (e) => {
          replay();
          // Vangnet: na een klik hoort de focus in het veld, zodat Enter bevestigt
          if (e.detail > 0 && finePointer && ui.input && document.activeElement === e.currentTarget) {
            ui.input.focus({ preventScroll: true });
          }
        },
      }, icon("replay", 18), "Opnieuw horen", kbd("R"));
      noFocusSteal(ui.replayBtn);
      ui.replays = h("span", { class: "bp-replays" });

      const answer = h("div", { class: "bp-answer" },
        h("label", { class: "bp-answer-label", for: "bp-guess" }, "Jouw schatting in bpm"),
        h("div", { class: "bp-guess-row" },
          h("div", { class: "bp-guess-box" }, ui.input, h("span", { class: "bp-guess-unit", "aria-hidden": "true" }, "bpm")),
          ui.confirmBtn),
        ui.err,
        h("div", { class: "bp-steps", role: "group", "aria-label": "Schatting aanpassen" },
          stepButton(-5), stepButton(-1), stepButton(1), stepButton(5)),
        ui.replayBtn,
        h("div", { class: "bp-meta" },
          ui.replays,
          h("span", { class: "bp-keys" },
            h("span", { class: "kbd" }, "↑"), h("span", { class: "kbd" }, "↓"), "±1 · met Shift ±5"))
      );

      ui.face.replaceChildren(h("div", { class: "bp-ask" + (set.tapHelp ? " has-tap" : "") },
        visual, answer, set.tapHelp ? buildTapZone() : null));
      updateReplays();
    }

    /* Plus/min-knop voor de schatting; ingedrukt houden herhaalt. */
    function stepButton(delta) {
      const label = (delta > 0 ? "+" : MINUS) + Math.abs(delta);
      const b = h("button", {
        type: "button", class: "btn bp-step",
        "aria-label": `${delta > 0 ? "Plus" : "Min"} ${Math.abs(delta)} bpm`,
      }, label);
      b.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (e.pointerType === "mouse") e.preventDefault();   // focus blijft in het invoerveld
        stopHold();
        nudge(delta);
        hold.t = setTimeout(() => { hold.i = setInterval(() => nudge(delta), 90); }, 420);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((type) => b.addEventListener(type, stopHold));
      // Met het toetsenbord (Enter op de knop) komt er alleen een click zonder detail
      b.addEventListener("click", (e) => { if (e.detail === 0) nudge(delta); });
      return b;
    }

    function buildTapZone() {
      ui.tapPad = h("button", {
        type: "button", class: "bp-tap", "aria-label": "Tikvlak: tik mee op de tel", "aria-keyshortcuts": "Space",
      }, icon("target", 18), h("span", null, "Tik mee"), kbd("Spatie"));
      ui.tapPad.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        tap(e);
      });
      ui.tapPad.addEventListener("click", (e) => { if (e.detail === 0) tap(e); });   // Enter op het tikvlak
      ui.tapValue = h("span", { class: "bp-tap-value num" }, "—");
      ui.tapNote = h("span", { class: "bp-tap-note" });
      ui.tapUse = h("button", {
        type: "button", class: "btn bp-tap-use", disabled: true, title: "Zet het getikte tempo in je schatting",
        onClick: useTap,
      }, "Gebruik");
      noFocusSteal(ui.tapUse);
      const zone = h("div", { class: "bp-tapzone" },
        ui.tapPad,
        h("div", { class: "bp-tap-read" },
          h("div", { class: "bp-tap-est" }, ui.tapValue, h("small", null, "bpm")),
          ui.tapNote),
        ui.tapUse
      );
      renderTap();
      return zone;
    }

    function renderTap() {
      if (!ui.tapValue || !session) return;
      const r = session.current;
      const n = r.taps.length;
      if (r.tapBpm != null) {
        const v = Math.round(r.tapBpm);
        ui.tapValue.textContent = String(v);
        ui.tapNote.textContent = `geschat uit ${n} tikken`;
        ui.tapUse.textContent = `Gebruik ${clamp(v, GUESS_LO, GUESS_HI)}`;
        ui.tapUse.disabled = false;
      } else {
        ui.tapValue.textContent = "—";
        ui.tapNote.textContent = n ? `${n} ${n === 1 ? "tik" : "tikken"}, tik door` : `tik minstens ${TAP_MIN} keer`;
        ui.tapUse.textContent = "Gebruik";
        ui.tapUse.disabled = true;
      }
    }

    function tap(e) {
      if (!session || session.phase !== "ask" || !ui.tapPad) return;
      const r = session.current;
      const stamp = e && e.timeStamp > 0 ? e.timeStamp : performance.now();
      r.taps = addTap(r.taps, stamp);
      r.tapBpm = r.taps.length >= TAP_MIN ? tapBpm(r.taps) : null;
      restartAnim(ui.tapPad, "is-hit");
      renderTap();
    }

    function useTap() {
      const r = session && session.current;
      if (!r || r.tapBpm == null || !ui.input) return;
      ui.input.value = String(clamp(Math.round(r.tapBpm), GUESS_LO, GUESS_HI));
      clearError();
      if (finePointer) ui.input.focus({ preventScroll: true });
    }

    /* Speelt het tempo van deze ronde (opnieuw) vanaf het begin. */
    function playCurrent() {
      stopCompare();
      stopPlayback();
      const r = session.current;
      const set = session.settings;
      const spb = 60 / r.actual;
      resetVisual();
      ui.pulse.style.setProperty("--pulse-ms", Math.round(Math.min(spb * 0.92, 0.7) * 1000) + "ms");
      let handle;
      try {
        handle = App.audio.sequence(buildEvents(r.actual, set.beats, set.sound), {
          lead: 0.35,
          tail: Math.min(spb, 0.6),
          onEvent: (ev) => { if (ev.kind === "mark") onBeat(ev.beat); },
        });
      } catch (e) {
        console.error(e);
        App.ui.toast("Het geluid kon niet afspelen.", "bad");
        return;
      }
      playHandle = handle;
      setPlaying(true);
      handle.done.then(() => {
        if (!alive || playHandle !== handle) return;
        playHandle = null;
        setPlaying(false);
      });
    }

    function replay() {
      if (state !== "play" || !session || session.phase !== "ask") return;
      session.current.replays += 1;
      updateReplays();
      playCurrent();
    }

    function updateReplays() {
      const n = session.current.replays;
      ui.replays.textContent = n ? `${n}× opnieuw gehoord` : "";
    }

    function resetVisual() {
      ui.dots.forEach((d) => d.classList.remove("is-played", "is-now"));
      ui.count.textContent = "·";
      ui.pulse.classList.remove("is-hit", "is-accent");
    }

    function setPlaying(on) {
      if (!ui.stage || !ui.status) return;
      ui.stage.classList.toggle("is-playing", on);
      if (on) {
        ui.status.textContent = "Luister… je mag al raden.";
      } else {
        ui.status.textContent = "Klaar. Hoeveel bpm was het?";
        ui.dots.forEach((d) => { d.classList.remove("is-now"); d.classList.add("is-played"); });
        ui.count.textContent = "?";
        ui.pulse.classList.remove("is-hit", "is-accent");
      }
    }

    /* Op elke tel (via onEvent, rond het moment dat je hem hoort). */
    function onBeat(i) {
      if (!ui.dots || !ui.dots[i]) return;
      ui.dots.forEach((d, j) => {
        d.classList.toggle("is-played", j < i);
        d.classList.toggle("is-now", j === i);
      });
      ui.count.textContent = String((i % 4) + 1);
      if (i % 4 === 0) restartAnim(ui.pulse, "is-accent", ["is-hit"]);
      else restartAnim(ui.pulse, "is-hit", ["is-accent"]);
    }

    /* ---------- Invoer ---------- */
    function onGuessInput() {
      const clean = ui.input.value.replace(/\D/g, "").slice(0, 3);
      if (clean !== ui.input.value) ui.input.value = clean;
      clearError();
    }

    /* Toetsen in het eigen getalveld: dat is hier de bedoeling (CONTRACT: "behalve waar dat de bedoeling is").
       Het veld neemt alleen cijfers aan, dus R en spatie botsen niet met typen. */
    function onGuessKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      if (key === "Enter") {
        e.preventDefault();   // voorkomt ook dat de focus-wissel een klik op de volgende knop geeft
        if (!e.repeat) confirmGuess();
        return;
      }
      if (key === "ArrowUp" || key === "ArrowDown") {
        e.preventDefault();
        nudge((key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 5 : 1));
        return;
      }
      if (key === "PageUp" || key === "PageDown") {
        e.preventDefault();
        nudge(key === "PageUp" ? 5 : -5);
        return;
      }
      if (key === " " || e.code === "Space") {
        e.preventDefault();
        if (!e.repeat && session && session.settings.tapHelp) tap(e);
        return;
      }
      if (key === "r" || key === "R") {
        e.preventDefault();
        if (!e.repeat) replay();
      }
    }

    function nudge(delta) {
      if (!session || session.phase !== "ask" || !ui.input) return;
      const cur = parseInt(ui.input.value, 10);
      const base = Number.isFinite(cur) ? cur : Math.round((session.settings.minBpm + session.settings.maxBpm) / 2);
      ui.input.value = String(clamp(base + delta, GUESS_LO, GUESS_HI));
      clearError();
    }

    function typeDigit(d) {
      const cur = ui.input.value;
      ui.input.value = cur.length >= 3 ? d : cur + d;
      clearError();
      ui.input.focus({ preventScroll: true });
    }
    function removeDigit() {
      ui.input.value = ui.input.value.slice(0, -1);
      clearError();
      ui.input.focus({ preventScroll: true });
    }

    function showError(msg) {
      ui.err.textContent = msg;
      ui.input.setAttribute("aria-invalid", "true");
      restartAnim(ui.input, "is-invalid");
      ui.input.focus({ preventScroll: true });
    }
    function clearError() {
      if (ui.err && ui.err.textContent) ui.err.textContent = "";
      if (ui.input) {
        ui.input.classList.remove("is-invalid");
        ui.input.removeAttribute("aria-invalid");
      }
    }

    function confirmGuess() {
      if (state !== "play" || !session || session.phase !== "ask") return;
      const v = parseInt(ui.input.value, 10);
      if (!Number.isFinite(v)) { showError("Typ eerst je schatting in bpm."); return; }
      if (v < GUESS_LO || v > GUESS_HI) { showError(`Kies een tempo tussen ${GUESS_LO} en ${GUESS_HI} bpm.`); return; }
      stopPlayback();
      stopHold();
      const r = session.current;
      const round = makeRound(r.actual, v, r.replays, Math.round(performance.now() - r.startedAt));
      if (session.settings.tapHelp) round.tapBpm = r.tapBpm != null ? Math.round(r.tapBpm) : null;
      session.rounds.push(round);
      session.phase = "reveal";
      // Laatste ronde geraden: de sessie is af en wordt nu al bewaard, ook als je hierna stopt of weggaat
      if (session.rounds.length >= session.settings.rounds) saveSession();
      renderReveal(round);
    }

    /* ---------- Uitslag van één ronde ---------- */
    function renderReveal(rd) {
      const v = verdict(rd.diff, rd.pctErr);
      const pts = Math.round(roundScore(rd.pctErr));
      const isLast = !!session.saved;
      const dir = diffWord(rd.diff);
      const slip = octaveSlip(rd.actual, rd.guess);
      const slipText = slip ? octaveNote(slip, session.settings.sound) : "";

      ui.nextBtn = h("button", {
        type: "button", class: "btn btn-primary bp-next", "aria-keyshortcuts": "Enter", onClick: () => next(),
      }, isLast ? "Bekijk resultaat" : "Volgende ronde", icon("next", 18), kbd("Enter"));

      const big = (label, value, unit, cls) => h("div", { class: "bp-big " + cls },
        h("span", { class: "bp-big-label" }, label),
        h("span", { class: "bp-big-value num" }, String(value), unit ? h("small", null, unit) : null));

      ui.face.replaceChildren(
        h("div", { class: "bp-reveal", dataset: { tone: v.tone } },
          h("div", { class: "bp-compare" },
            big("Echt tempo", rd.actual, "bpm", "is-actual"),
            h("span", { class: "bp-compare-sep", "aria-hidden": "true" }),
            big("Jij", rd.guess, null, "is-guess")),
          h("div", { class: "bp-verdict" },
            h("span", { class: "bp-tone" }, icon(v.tone === "ok" ? "check" : "target", 16), v.word),
            h("p", { class: "bp-diff" },
              h("span", { class: "num" }, fmtSignedInt(rd.diff) + " bpm"),
              rd.diff ? [
                h("span", { class: "bp-diff-sep", "aria-hidden": "true" }, "·"),
                h("span", { class: "bp-diff-word" }, dir),
              ] : null),
            h("p", { class: "bp-subline" },
              h("span", { class: "num" }, fmtNum(rd.pctErr) + "%"), " naast het echte tempo · rondescore ",
              h("b", { class: "num" }, String(pts))),
            slip ? h("p", { class: "bp-octave" }, icon("info", 16), h("span", null, slipText)) : null),
          rulerEl(rd.actual, rd.guess),
          h("div", { class: "bp-reveal-actions" },
            h("div", { class: "bp-listen", role: "group", "aria-label": "Vergelijk de tempo's" },
              h("span", { class: "bp-listen-label" }, "Vergelijk"),
              compareButton(rd.actual, "Echt"),
              compareButton(rd.guess, "Jij")),
            ui.nextBtn)
        )
      );
      ui.live.textContent = `Echt ${rd.actual} bpm, jij ${rd.guess}. ${v.word}`
        + `${rd.diff ? `, ${Math.abs(rd.diff)} bpm ${dir}` : ""}. Rondescore ${pts}.${slipText ? " " + slipText : ""}`;
      session.revealAt = performance.now();
      updateProgress();
      frame(() => {
        if (!ui.nextBtn) return;
        ui.nextBtn.focus({ preventScroll: true });
        // 'Echt tegen jij' bovenaan in beeld, en de knop niet achter de onderbalk
        keepInView(ui.face, ui.nextBtn);
      });
    }

    /* Horizontale meetlat met het echte tempo boven en jouw schatting onder de lijn. */
    function rulerEl(actual, guess) {
      const sc = rulerScale(actual, guess);
      const pos = (val) => ((val - sc.min) / (sc.max - sc.min)) * 100;
      const pa = pos(actual);
      const pg = pos(guess);
      const parts = [];
      sc.ticks.forEach((t) => {
        const p = t.pos * 100;
        parts.push(h("span", { class: "bp-tick" + (t.major ? " is-major" : ""), style: { left: p + "%" } }));
        // Getallen vlak bij een markering laten we weg: daar staat de waarde al
        if (t.major && Math.abs(p - pa) > 8 && Math.abs(p - pg) > 8) {
          parts.push(h("span", { class: "bp-tick-label num", style: { left: p + "%" } }, String(t.v)));
        }
      });
      const gap = h("span", { class: "bp-ruler-gap", style: { left: pa + "%", width: "0%" } });
      const actualMark = h("div", { class: "bp-mark is-actual", style: { left: pa + "%" } },
        h("span", { class: "bp-mark-label" }, h("b", null, String(actual)), "echt"),
        h("span", { class: "bp-mark-stem" }));
      const guessMark = h("div", { class: "bp-mark is-guess", style: { left: pa + "%" } },
        h("span", { class: "bp-mark-stem" }),
        h("span", { class: "bp-mark-label" }, h("b", null, String(guess)), "jij"));
      const el = h("div", { class: "bp-ruler", role: "img", "aria-label": `Meetlat: echt ${actual} bpm, jij ${guess} bpm` },
        h("span", { class: "bp-ruler-line" }), parts, gap, actualMark, guessMark);
      // Jouw markering schuift vanaf het echte tempo naar je schatting
      frame(() => frame(() => {
        guessMark.style.left = pg + "%";
        gap.style.left = Math.min(pa, pg) + "%";
        gap.style.width = Math.abs(pg - pa) + "%";
      }));
      return el;
    }

    function compareButton(bpm, who) {
      const name = who === "Echt" ? `Speel het echte tempo: ${bpm} bpm` : `Speel jouw schatting: ${bpm} bpm`;
      const b = h("button", { type: "button", class: "btn bp-hear", "aria-label": name },
        icon("play", 14), h("span", null, who), h("span", { class: "num" }, String(bpm)));
      noFocusSteal(b);
      b.addEventListener("click", (e) => {
        playCompare(bpm, b);
        // Vangnet: na een klik blijft Enter 'Volgende ronde' betekenen
        if (e.detail > 0 && ui.nextBtn && document.activeElement === b) ui.nextBtn.focus({ preventScroll: true });
      });
      return b;
    }

    /* Eén maat in het gekozen klankje, om echt en geschat naast elkaar te horen. */
    function playCompare(bpm, btn) {
      if (!session) return;
      stopCompare();
      let handle;
      try {
        handle = App.audio.sequence(buildEvents(bpm, 4, session.settings.sound), { lead: 0.08, tail: Math.min(60 / bpm, 0.5) });
      } catch (e) {
        console.error(e);
        return;
      }
      compare = { handle, btn };
      btn.classList.add("is-playing");
      handle.done.then(() => {
        btn.classList.remove("is-playing");
        if (compare && compare.handle === handle) compare = null;
      });
    }

    function next() {
      if (state !== "play" || !session || session.phase !== "reveal") return;
      if (performance.now() - session.revealAt < 200) return;   // per ongeluk dubbel drukken
      stopCompare();
      if (session.saved) showFinal();
      else startRound();
    }

    async function askStop() {
      if (!session || modalOpen) return;
      if (session.saved) { showFinal(); return; }     // alles al geraden: gewoon naar de uitslag
      if (!session.rounds.length) { quitSession(); return; }
      modalOpen = true;
      let ok = false;
      try {
        ok = await App.ui.confirm({
          title: "Sessie stoppen?",
          text: `Je hebt ${session.rounds.length} van de ${session.settings.rounds} rondes gedaan. Een sessie die je stopt, wordt niet bewaard.`,
          ok: "Stoppen",
          cancel: "Doorgaan",
          danger: true,
        });
      } finally {
        modalOpen = false;
      }
      if (alive && ok && state === "play") quitSession();
    }
    function quitSession() {
      stopPlayback();
      stopCompare();
      session = null;
      showSetup(true);
      window.scrollTo(0, 0);
    }

    /* ---------- Sneltoetsen (alleen tijdens het spelen) ---------- */
    function onKeydown(e) {
      if (!alive || modalOpen || state !== "play" || !session) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      if (key === "Enter" && e.repeat) { e.preventDefault(); return; }   // Enter vasthouden klikt niet door
      if (isTypingTarget(e.target)) return;   // in een invoerveld: dat veld regelt zijn eigen toetsen
      const asking = session.phase === "ask";
      if (key === " " || e.code === "Space") {
        if (asking && session.settings.tapHelp) {
          e.preventDefault();
          if (!e.repeat) tap(e);
        }
        return;
      }
      if (e.repeat) return;
      if (key === "r" || key === "R") {
        if (asking) { e.preventDefault(); replay(); }
        return;
      }
      if (asking && ui.input) {
        // Ook buiten het veld werken cijfers, wissen en ↑ ↓, zoals de hint belooft
        if (/^[0-9]$/.test(key)) { e.preventDefault(); typeDigit(key); return; }
        if (key === "Backspace") { e.preventDefault(); removeDigit(); return; }
        if (key === "ArrowUp" || key === "ArrowDown") {
          e.preventDefault();
          nudge((key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 5 : 1));
          return;
        }
      }
      if (key === "Enter" && !isControl(e.target)) {
        e.preventDefault();
        if (asking) confirmGuess();
        else next();
      }
    }
    function onKeyup(e) {
      if (!alive || modalOpen || state !== "play" || !session) return;
      // Spatie op een knop klikt bij loslaten; met tik-hulp aan is spatie een tik, geen klik
      if ((e.key === " " || e.code === "Space") && session.phase === "ask" && session.settings.tapHelp && !isTypingTarget(e.target)) {
        e.preventDefault();
      }
    }

    /* ================= Resultaat ================= */
    /* Record opbouwen en bewaren (CONTRACT). 'prior' = eerdere sessies met dezelfde tik-hulp-stand,
       vastgelegd vóór het opslaan, voor 'vorige keer' en 'beste score'. */
    function saveSession() {
      if (!session || session.saved) return;
      const set = session.settings;
      const sum = summarize(session.rounds);
      const prior = sameTapHelp(App.store.sessions(MODE), set.tapHelp);
      const rec = {
        mode: MODE,
        durationMs: Math.round(performance.now() - session.startedAt),
        score: sum.score,
        settings: { minBpm: set.minBpm, maxBpm: set.maxBpm, rounds: set.rounds, sound: set.sound, beats: set.beats, tapHelp: set.tapHelp },
        rounds: session.rounds.map((r) => Object.assign({}, r)),
        stats: sum.stats,
      };
      try {
        App.store.addSession(rec);
      } catch (err) {
        console.error(err);
        App.ui.toast("Opslaan lukte niet.", "bad");
      }
      session.saved = { rec, prior };
    }

    function showFinal() {
      if (!session || !session.saved) return;
      const saved = session.saved;
      stopPlayback();
      stopCompare();
      session = null;
      showResult(saved.rec, saved.prior);
    }

    function showResult(rec, prior) {
      setState("result");
      const st = rec.stats;
      const set = rec.settings;
      const n = rec.rounds.length;
      const scoreOf = (s) => Math.round(Number(s.score) || 0);
      const ctx = set.tapHelp ? " met tik-hulp" : "";

      const badges = [];
      if (!prior.length) {
        badges.push(h("span", { class: "badge" }, "Eerste sessie" + ctx));
      } else {
        const best = Math.max.apply(null, prior.map(scoreOf));
        const d = rec.score - scoreOf(prior[prior.length - 1]);
        if (rec.score > best) badges.push(h("span", { class: "badge ok" }, icon("trophy", 14), "Nieuwe beste score" + ctx));
        badges.push(h("span", { class: "badge" + (d > 0 ? " ok" : "") }, scoreDeltaText(d) + ctx));
      }

      const title = h("h2", { class: "bp-result-title", tabindex: "-1" }, resultTitle(rec.score));
      const lead = st.meanAbsDiff === 0
        ? "Je raadde elk tempo precies goed."
        : `Je zat gemiddeld ${fmtNum(st.meanAbsDiff)} bpm naast het echte tempo. Dat is ${fmtPctNum(st.meanPctErr)}% van het tempo.`;
      const hero = h("section", { class: "panel bp-hero", "aria-label": "Je score" },
        App.ui.scoreRing(rec.score, "score"),
        h("div", { class: "bp-hero-text" },
          title,
          h("p", { class: "bp-hero-lead" }, lead),
          h("p", { class: "bp-hero-meta" },
            `${n} rondes · ${App.ui.fmtDuration(rec.durationMs)} · ${set.minBpm}–${set.maxBpm} bpm · ${soundName(set.sound)} · ${set.beats} tellen${ctx ? " ·" + ctx : ""}`),
          h("div", { class: "bp-badges" }, badges))
      );

      const within2n = rec.rounds.filter((r) => Math.abs(r.diff) <= 2).length;
      const within5n = rec.rounds.filter((r) => Math.abs(r.diff) <= 5).length;
      const tend = tendency(st.meanDiff);
      const tile = (value, label, unit, sub) => h("div", { class: "stat-tile" },
        App.ui.stat(value, label, unit),
        sub ? h("div", { class: "bp-tile-sub" }, sub) : null);
      const tiles = h("section", { class: "grid-4 bp-tiles", "aria-label": "Kerncijfers" },
        tile(fmtNum(st.meanAbsDiff), "gemiddeld ernaast", "bpm", `${fmtPctNum(st.meanPctErr)}% van het tempo`),
        tile(fmtSignedNum(st.meanDiff), "neiging", "bpm", tend.dir ? `je schat gemiddeld te ${tend.dir}` : "geen duidelijke neiging"),
        tile(App.ui.fmtPct(st.within2), "binnen 2 bpm", null, `${within2n} van de ${n} rondes`),
        tile(App.ui.fmtPct(st.within5), "binnen 5 bpm", null, `${within5n} van de ${n} rondes`)
      );

      const actions = h("div", { class: "bp-result-actions" },
        h("button", { type: "button", class: "btn btn-primary btn-lg", onClick: start }, icon("replay", 18), "Nog een keer"),
        h("button", { type: "button", class: "btn btn-lg", onClick: () => { showSetup(true); window.scrollTo(0, 0); } },
          icon("instellingen", 18), "Andere instellingen"),
        h("button", { type: "button", class: "btn btn-lg btn-ghost", onClick: () => App.navigate("statistieken") },
          icon("statistieken", 18), "Naar statistieken")
      );

      const notes = insights(rec.rounds, st, set.sound);
      const insightPanel = h("section", { class: "panel bp-insights", "aria-labelledby": "bp-insights-title" },
        h("h3", { class: "panel-title", id: "bp-insights-title" }, "Wat valt op"),
        h("ul", null, notes.map((t) => h("li", null, t))));

      const legend = h("div", { class: "bp-legend", "aria-hidden": "true" },
        h("span", null, h("i", { class: "bp-key is-actual" }), "Echt tempo"),
        h("span", null, h("i", { class: "bp-key is-guess" }), "Jouw schatting"));
      const roundsPanel = h("section", { class: "panel bp-rounds", "aria-labelledby": "bp-rounds-title" },
        h("div", { class: "bp-rounds-head" }, h("h3", { class: "panel-title", id: "bp-rounds-title" }, "Alle rondes"), legend),
        chartEl(rec.rounds),
        tableEl(rec.rounds));

      body.append(h("div", { class: "bp-result" }, hero, tiles, actions, insightPanel, roundsPanel));
      window.scrollTo(0, 0);
      frame(() => title.focus({ preventScroll: true }));
    }

    /* Grafiek per ronde: open rondje = echt, gevuld = jij, lijntje = het verschil. */
    function chartEl(rounds) {
      const ax = chartAxis(rounds.reduce((list, r) => list.concat(r.actual, r.guess), []));
      const y = (v) => (1 - (v - ax.min) / (ax.max - ax.min)) * 100;
      const n = rounds.length;
      const cols = rounds.map((r, i) => {
        const v = verdict(r.diff, r.pctErr);
        const ya = y(r.actual);
        const yg = y(r.guess);
        return h("div", {
          class: "bp-col", dataset: { tone: v.tone },
          title: `Ronde ${i + 1}: echt ${r.actual}, jij ${r.guess} (${fmtSignedInt(r.diff)})`,
        },
          h("span", { class: "bp-col-err", style: { top: Math.min(ya, yg) + "%", height: Math.abs(ya - yg) + "%" } }),
          h("span", { class: "bp-pt is-actual", style: { top: ya + "%" } }),
          h("span", { class: "bp-pt is-guess", style: { top: yg + "%" } }));
      });
      return h("div", {
        class: "bp-chart" + (n > 12 ? " is-dense" : ""), role: "img",
        "aria-label": `Grafiek van ${n} rondes: echt tempo en jouw schatting. De tabel hieronder geeft dezelfde cijfers.`,
      },
        h("div", { class: "bp-chart-y", "aria-hidden": "true" },
          ax.ticks.map((v) => h("span", { class: "num", style: { top: y(v) + "%" } }, String(v)))),
        h("div", { class: "bp-chart-plot" },
          ax.ticks.map((v) => h("span", { class: "bp-grid", style: { top: y(v) + "%" } })),
          h("div", { class: "bp-cols" }, cols)),
        h("span"),
        h("div", { class: "bp-chart-x", "aria-hidden": "true" },
          rounds.map((r, i) => h("span", { class: "num" }, n <= 10 || i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : "")))
      );
    }

    function tableEl(rounds) {
      return h("div", { class: "bp-table-wrap" },
        h("table", { class: "bp-table" },
          h("caption", { class: "visually-hidden" }, "Alle rondes: echt tempo, jouw schatting, verschil en score"),
          h("thead", null, h("tr", null,
            h("th", { scope: "col" }, "Ronde"),
            h("th", { scope: "col", class: "is-num" }, "Echt"),
            h("th", { scope: "col", class: "is-num" }, "Jij"),
            h("th", { scope: "col" }, "Verschil"),
            h("th", { scope: "col", class: "is-num bp-hide-sm" }, "Opnieuw"),
            h("th", { scope: "col", class: "is-num" }, "Score"))),
          h("tbody", null, rounds.map((r, i) => {
            const v = verdict(r.diff, r.pctErr);
            const slip = octaveSlip(r.actual, r.guess);
            const word = slip === "dubbel" ? "dubbel tempo" : slip === "half" ? "half tempo" : diffWord(r.diff);
            return h("tr", { dataset: { tone: v.tone } },
              h("td", { class: "num" }, String(i + 1)),
              h("td", { class: "num is-num" }, String(r.actual)),
              h("td", { class: "num is-num" }, String(r.guess)),
              h("td", null,
                h("span", { class: "bp-cell-diff num" }, fmtSignedInt(r.diff)),
                h("span", { class: "bp-cell-word" }, word)),
              h("td", { class: "num is-num bp-hide-sm" }, r.replays ? r.replays + "×" : "—"),
              h("td", { class: "num is-num" }, String(Math.round(roundScore(r.pctErr)))));
          }))
        )
      );
    }
  }
})();
