/* Maatwerk — Statistieken: een overzicht van al je sessies, per oefening, met eigen SVG-grafieken.
   Leest de sessie-records zoals docs/CONTRACT.md ze beschrijft (App.store.sessions()).
   Testhulp (niet in de interface): App.dev.seedStats(n) en App.dev.clearSeed(). */
(function () {
  "use strict";
  const App = window.App;
  const { h, svg, icon } = App.ui;

  /* ---------- Vaste gegevens ---------- */
  const EXERCISES = ["ritme", "gehoor", "bpm", "maatsoort"];
  const TABS = ["overzicht"].concat(EXERCISES);
  const LABEL = { overzicht: "Overzicht", ritme: "Ritme", gehoor: "Gehoor", bpm: "BPM", maatsoort: "Maatsoort" };
  const COLOR = { ritme: "var(--c-ritme)", gehoor: "var(--c-gehoor)", bpm: "var(--c-bpm)", maatsoort: "var(--c-maat)" };
  const DAY = 864e5;
  const MINUS = "−";
  const SET_TAB = "stats.tab";
  const SET_VARIANT = "stats.gehoorVariant";
  const SET_RANGE = "stats.range";
  const SET_SEEN = "stats.seenTs"; // ts van de nieuwste sessie bij het vorige bezoek
  const RANGES = [{ value: 20, label: "Laatste 20" }, { value: 50, label: "Laatste 50" }, { value: 0, label: "Alles" }];
  /* Kleur voor alles wat over álle oefeningen gaat (neutraal, zodat het niet op één oefening lijkt) */
  const ALL_COLOR = "var(--c-stats)";
  /* Woorden voor sessies per oefening (Nederlands: aan elkaar, kleine letter) */
  const SESSION_WORD = {
    ritme: ["ritmesessie", "ritmesessies"],
    gehoor: ["gehoorsessie", "gehoorsessies"],
    bpm: ["BPM-sessie", "BPM-sessies"],
    maatsoort: ["maatsoortsessie", "maatsoortsessies"],
  };
  function sessionWord(mode, n) {
    const w = SESSION_WORD[mode] || ["sessie", "sessies"];
    return n === 1 ? w[0] : w[1];
  }
  /* Wat je hoorde tijdens het meeklikken bij Ritme (zelfde namen als in de oefening) */
  const GUIDE_LABEL = { ritme: "Ritme + metronoom", metronoom: "Alleen metronoom", stil: "Stilte" };
  const GUIDE_PHRASE = { ritme: "met ritme en metronoom", metronoom: "met alleen de metronoom", stil: "in stilte" };
  const EMPTY_TEXT = {
    ritme: "Klik mee met een ritme. Daarna zie je hier per sessie hoe strak je speelt.",
    gehoor: "Raad een paar noten. Daarna zie je hier welke noten je goed herkent.",
    bpm: "Raad een paar tempo's. Daarna zie je hier hoe dicht je erbij zit.",
    maatsoort: "Herken een paar maatsoorten. Daarna zie je hier welke je nog verwart.",
  };
  /* Intervalnamen op afstand in halve tonen */
  const INTERVALS = ["prime", "kleine secunde", "grote secunde", "kleine terts", "grote terts", "kwart",
    "tritonus", "kwint", "kleine sext", "grote sext", "kleine septiem", "grote septiem", "octaaf"];
  const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
  const BLACK_PCS = [1, 3, 6, 8, 10];
  const BLACK_LEFT = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // zwarte toets → index van de witte toets links ervan
  const SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

  function modeLabel(id) {
    if (LABEL[id]) return LABEL[id];
    const d = App.modes && App.modes[id];
    return (d && (d.nav || d.title)) || String(id || "Onbekend");
  }
  function noteName(pc) {
    try { if (App.music && App.music.noteName) return App.music.noteName(pc); } catch (e) { /* val terug */ }
    return SHARP[((pc % 12) + 12) % 12];
  }

  /* ---------- Rekenhulpjes ---------- */
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function num(v) {
    if (typeof v === "string" && v.trim() !== "") v = Number(v);
    return isNum(v) ? v : null;
  }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function rows(v) { return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []; }
  function pick() {
    for (let i = 0; i < arguments.length; i++) { const v = arguments[i]; if (v !== null && v !== undefined) return v; }
    return null;
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function nums(a) { return a.filter(isNum); }
  function sum(a) { return nums(a).reduce((s, x) => s + x, 0); }
  function mean(a) { const v = nums(a); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
  function median(a) {
    const v = nums(a).sort((x, y) => x - y);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function std(a) {
    const v = nums(a);
    if (!v.length) return null;
    const m = mean(v);
    return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / v.length);
  }
  function maxOf(a) { const v = nums(a); return v.length ? v.reduce((m, x) => (x > m ? x : m), -Infinity) : null; }
  function minOf(a) { const v = nums(a); return v.length ? v.reduce((m, x) => (x < m ? x : m), Infinity) : null; }
  function fracOf(a, pred) { return a.length ? a.filter(pred).length / a.length : null; }
  function pcOf(m) { return ((Math.round(m) % 12) + 12) % 12; }
  /* Afstand in halve tonen terugbrengen tot −5..+6 (zoals semitoneErrors in het contract) */
  function wrapSemi(d) { let x = ((Math.round(d) % 12) + 12) % 12; if (x > 6) x -= 12; return x; }

  /* Voortschrijdend gemiddelde over de laatste w geldige waarden */
  function movingAvg(values, w) {
    const win = [];
    return values.map((x) => {
      if (!isNum(x)) return null;
      win.push(x);
      if (win.length > w) win.shift();
      return mean(win);
    });
  }

  /* Gemiddelde van de laatste n sessies tegenover de n daarvoor */
  function compareLast(items, get, n) {
    const vals = items.map(get).filter(isNum);
    const recent = vals.slice(-n);
    const prev = vals.slice(-2 * n, -n);
    return { recent: mean(recent), prev: prev.length ? mean(prev) : null, nRecent: recent.length, nPrev: prev.length };
  }

  function niceStep(span, count) {
    if (!(span > 0)) return 1;
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }
  function niceMax(v, count) {
    if (!(v > 0)) return 1;
    const s = niceStep(v, count || 4);
    return Math.ceil(v / s - 1e-9) * s;
  }
  function ticks(min, max, count) {
    const s = niceStep(max - min, count || 4);
    const out = [];
    for (let t = Math.ceil(min / s - 1e-9) * s; t <= max + s * 1e-6; t += s) out.push(Math.round(t * 1e6) / 1e6);
    return out;
  }

  /* ---------- Opmaak ---------- */
  const NF = {};
  function nf(d) {
    return NF[d] || (NF[d] = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d }));
  }
  function isZeroAt(a, d) { return Math.round(a * Math.pow(10, d)) === 0; }
  /* 4,2 · −1,3 · 1.234 */
  function fmtNum(v, d) {
    d = d || 0;
    if (!isNum(v)) return "—";
    const a = Math.abs(v);
    return (v < 0 && !isZeroAt(a, d) ? MINUS : "") + nf(d).format(a);
  }
  /* +4,2 · −1,3 · 0 */
  function fmtSigned(v, d) {
    d = d || 0;
    if (!isNum(v)) return "—";
    const a = Math.abs(v);
    if (isZeroAt(a, d)) return nf(d).format(0);
    return (v > 0 ? "+" : MINUS) + nf(d).format(a);
  }
  function tickFmt(t) { return fmtNum(t, Number.isInteger(t) ? 0 : 1); }
  function fmtPct(f) { return isNum(f) ? Math.round(f * 100) + "%" : "—"; }
  function fmtMsSigned(ms) { return isNum(ms) ? fmtSigned(ms) + " ms" : "—"; }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function sessionsText(n) { return n + " " + plural(n, "sessie", "sessies"); }

  const fmtLongDay = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  const fmtMonthShort = new Intl.DateTimeFormat("nl-NL", { month: "short" });
  function dateShort(ts) { return App.ui.fmtDate(ts); }
  function dateTime(ts) { return App.ui.fmtDate(ts, true); }
  function monthName(ts) { return fmtMonthShort.format(new Date(ts)).replace(".", ""); }

  function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }
  function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }
  function daysAgo(ts) { return Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY); }
  function relDay(ts) {
    const n = daysAgo(ts);
    if (n <= 0) return "vandaag";
    if (n === 1) return "gisteren";
    if (n < 7) return n + " dagen geleden";
    return dateShort(ts);
  }
  /* Oefentijd als [waarde, eenheid]: 45 s · 12 min · 2,4 uur */
  function durParts(ms) {
    if (!(ms > 0)) return ["0", "min"];
    const min = ms / 60000;
    if (min < 1) return [String(Math.round(ms / 1000)), "s"];
    if (min < 60) return [String(Math.round(min)), "min"];
    return [fmtNum(min / 60, min < 600 ? 1 : 0), "uur"];
  }

  /* ---------- Sessies lezen (robuust: ontbrekende velden, NaN, oude records) ---------- */
  function ritmeScoreFromHits(hits, extras) {
    if (!hits.length) return null;
    const ns = hits.map((x) => {
      const o = num(x.offsetMs);
      return o === null ? 0 : clamp(1 - (Math.abs(o) - 10) / 90, 0, 1);
    });
    return Math.round(clamp(100 * mean(ns) - 2 * extras, 0, 100));
  }

  function readRitme(s, v, st, stats) {
    const hits = rows(s.hits);
    const offs = [];
    let missedHits = 0;
    hits.forEach((x) => { const o = num(x.offsetMs); if (o === null) missedHits++; else offs.push(o); });
    v.offsets = offs;
    v.expected = pick(num(stats.expected), hits.length || null);
    v.matched = pick(num(stats.matched), hits.length ? offs.length : null);
    v.missed = pick(num(stats.missed), hits.length ? missedHits : v.expected !== null && v.matched !== null ? v.expected - v.matched : null);
    v.extras = Math.max(0, pick(num(s.extras), num(stats.extras), 0));
    v.meanAbsMs = pick(num(stats.meanAbsMs), mean(offs.map(Math.abs)));
    v.meanMs = pick(num(stats.meanMs), mean(offs));
    v.stdMs = pick(num(stats.stdMs), offs.length ? std(offs) : null);
    v.hitRate = v.expected > 0 && v.matched !== null ? clamp(v.matched / v.expected, 0, 1) : null;
    v.bpm = num(st.bpm);
    const pname = typeof st.patternName === "string" && st.patternName.trim() ? st.patternName.trim() : null;
    const pid = typeof st.pattern === "string" && st.pattern.trim() ? st.pattern.trim() : null;
    v.patternKey = pid || pname || "?";
    v.patternName = pname || (pid === "eigen" ? "Eigen ritme" : pid) || "Onbekend patroon";
    v.guide = GUIDE_LABEL[st.guide] ? st.guide : null;
    v.beatsPerBar = num(st.beatsPerBar);
    if (v.score === null) v.score = ritmeScoreFromHits(hits, v.extras);
  }

  function readGehoor(s, v, st, stats) {
    const raw = rows(s.rounds);
    let variant = s.variant === "relatief" || s.variant === "absoluut" ? s.variant : null;
    if (!variant) variant = raw.some((r) => num(r.referenceMidi) !== null) || st.reference ? "relatief" : "absoluut";
    v.variant = variant;
    const fixedRef = num(st.referenceMidi);
    v.rounds = raw.map((r) => {
      const target = num(r.target);
      const ap = num(r.answerPc);
      const answerPc = ap !== null ? pcOf(ap) : null;
      const correct = typeof r.correct === "boolean" ? r.correct
        : target !== null && answerPc !== null ? pcOf(target) === answerPc : null;
      const ref = pick(num(r.referenceMidi), variant === "relatief" ? fixedRef : null);
      return { target, pc: target !== null ? pcOf(target) : null, answerPc, correct, ref, timeMs: num(r.timeMs), replays: num(r.replays) };
    });
    const judged = v.rounds.filter((r) => r.correct !== null);
    v.total = pick(num(stats.total), judged.length || null);
    v.correct = pick(num(stats.correct), judged.length ? judged.filter((r) => r.correct).length : null);
    v.accuracy = pick(num(stats.accuracy), v.total > 0 && v.correct !== null ? v.correct / v.total : null);
    if (v.accuracy !== null) v.accuracy = clamp(v.accuracy, 0, 1);
    v.meanTimeMs = pick(num(stats.meanTimeMs), mean(v.rounds.map((r) => r.timeMs)));
    v.replays = mean(v.rounds.map((r) => r.replays));
    // Verwisselingen liefst uit de rondes; anders uit stats.semitoneErrors
    const semi = {};
    let fromRounds = 0;
    v.rounds.forEach((r) => {
      if (r.correct !== false || r.pc === null || r.answerPc === null) return;
      const d = wrapSemi(r.answerPc - r.pc);
      if (d !== 0) { semi[d] = (semi[d] || 0) + 1; fromRounds++; }
    });
    if (!fromRounds) {
      const se = obj(stats.semitoneErrors);
      Object.keys(se).forEach((k) => {
        const d = num(k), c = num(se[k]);
        if (d === null || c === null || c <= 0) return;
        const dd = Math.round(d);
        if (dd >= -5 && dd <= 6 && dd !== 0) semi[dd] = (semi[dd] || 0) + c;
      });
    }
    v.semi = semi;
    if (v.score === null && v.accuracy !== null) v.score = Math.round(v.accuracy * 100);
  }

  function readBpm(s, v, st, stats) {
    v.rounds = rows(s.rounds).map((r) => {
      const actual = num(r.actual), guess = num(r.guess);
      const diff = pick(num(r.diff), actual !== null && guess !== null ? guess - actual : null);
      const pctErr = pick(num(r.pctErr), diff !== null && actual > 0 ? (Math.abs(diff) / actual) * 100 : null);
      return { actual, guess, diff, pctErr, timeMs: num(r.timeMs), replays: num(r.replays) };
    });
    const diffs = v.rounds.map((r) => r.diff).filter(isNum);
    v.meanAbsDiff = pick(num(stats.meanAbsDiff), mean(diffs.map(Math.abs)));
    v.meanDiff = pick(num(stats.meanDiff), mean(diffs));
    v.meanPctErr = pick(num(stats.meanPctErr), mean(v.rounds.map((r) => r.pctErr)));
    v.within2 = pick(num(stats.within2), fracOf(diffs, (d) => Math.abs(d) <= 2));
    v.within5 = pick(num(stats.within5), fracOf(diffs, (d) => Math.abs(d) <= 5));
    v.minBpm = num(st.minBpm);
    v.maxBpm = num(st.maxBpm);
    if (v.score === null) {
      const p = v.rounds.map((r) => r.pctErr).filter(isNum);
      if (p.length) v.score = Math.round(mean(p.map((e) => Math.max(0, 100 - 10 * e))));
    }
  }

  function readMaat(s, v, st, stats) {
    v.rounds = rows(s.rounds).map((r) => {
      const actual = typeof r.actual === "string" && r.actual ? r.actual : null;
      const answer = typeof r.answer === "string" && r.answer ? r.answer : null;
      const correct = typeof r.correct === "boolean" ? r.correct : actual && answer ? actual === answer : null;
      return { actual, answer, correct, timeMs: num(r.timeMs), replays: num(r.replays), bpm: num(r.bpm) };
    });
    const judged = v.rounds.filter((r) => r.correct !== null);
    v.total = pick(num(stats.total), judged.length || null);
    v.correct = pick(num(stats.correct), judged.length ? judged.filter((r) => r.correct).length : null);
    v.accuracy = pick(num(stats.accuracy), v.total > 0 && v.correct !== null ? v.correct / v.total : null);
    if (v.accuracy !== null) v.accuracy = clamp(v.accuracy, 0, 1);
    v.meanTimeMs = mean(v.rounds.map((r) => r.timeMs));
    v.replays = mean(v.rounds.map((r) => r.replays));
    v.signatures = Array.isArray(st.signatures) ? st.signatures.filter((x) => typeof x === "string") : [];
    v.difficulty = typeof st.difficulty === "string" ? st.difficulty : null;
    if (v.score === null && v.accuracy !== null) v.score = Math.round(v.accuracy * 100);
  }

  /* Maakt van een ruw record een vast, veilig leesbaar object */
  function normalize(s) {
    const st = obj(s.settings), stats = obj(s.stats);
    const v = {
      id: s.id, ts: num(s.ts), mode: String(s.mode || ""), demo: s.demo === true,
      durationMs: Math.max(0, num(s.durationMs) || 0), settings: st, score: num(s.score),
    };
    if (v.mode === "ritme") readRitme(s, v, st, stats);
    else if (v.mode === "gehoor") readGehoor(s, v, st, stats);
    else if (v.mode === "bpm") readBpm(s, v, st, stats);
    else if (v.mode === "maatsoort") readMaat(s, v, st, stats);
    if (v.score !== null) v.score = clamp(v.score, 0, 100);
    return v;
  }

  function loadAll() {
    let raw = [];
    try { raw = App.store.sessions() || []; } catch (e) { console.error("Sessies lezen mislukt", e); }
    const all = [];
    raw.forEach((s) => {
      if (!s || typeof s !== "object" || !s.mode) return;
      try {
        const v = normalize(s);
        if (v.ts !== null) all.push(v);
      } catch (e) { console.warn("Sessie overgeslagen", e); }
    });
    all.sort((a, b) => a.ts - b.ts);
    const by = {};
    EXERCISES.forEach((id) => (by[id] = []));
    all.forEach((v) => { if (by[v.mode]) by[v.mode].push(v); });
    return { all, by };
  }

  function longestStreak(all) {
    const days = Array.from(new Set(all.map((v) => startOfDay(v.ts)))).sort((a, b) => a - b);
    let best = 0, run = 0, prev = null;
    days.forEach((d) => {
      run = prev !== null && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    });
    return best;
  }

  function streakOf(all) {
    try { if (typeof App.dayStreak === "function") return App.dayStreak(all) || 0; } catch (e) { /* val terug */ }
    const days = new Set(all.map((v) => new Date(v.ts).toDateString()));
    const d = new Date();
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* Kerngetal van één sessie, kort */
  function keyText(v) {
    if (v.mode === "ritme") {
      if (isNum(v.meanAbsMs)) return fmtNum(v.meanAbsMs) + " ms naast de tel";
      return v.expected ? (v.matched ?? "?") + "/" + v.expected + " geraakt" : "—";
    }
    if (v.mode === "gehoor" || v.mode === "maatsoort") return v.total ? (v.correct ?? "?") + "/" + v.total + " goed" : "—";
    if (v.mode === "bpm") return isNum(v.meanAbsDiff) ? fmtNum(v.meanAbsDiff, 1) + " bpm ernaast" : "—";
    return "—";
  }
  /* Instellingen van één sessie, kort */
  function detailText(v) {
    const parts = [];
    if (v.mode === "ritme") {
      parts.push(v.patternName);
      if (isNum(v.bpm)) parts.push(fmtNum(v.bpm) + " bpm");
      if (v.beatsPerBar === 3) parts.push("3/4");
      // Hoe moeilijk het was: zonder geluid is veel zwaarder dan met het ritme erbij
      if (v.guide === "stil") parts.push("in stilte");
      else if (v.guide === "ritme") parts.push("met ritme");
    } else if (v.mode === "gehoor") {
      parts.push(v.variant === "relatief" ? "relatief" : "absoluut");
      if (v.total) parts.push(v.total + " " + plural(v.total, "ronde", "rondes"));
    } else if (v.mode === "bpm") {
      if (isNum(v.minBpm) && isNum(v.maxBpm)) parts.push(fmtNum(v.minBpm) + "–" + fmtNum(v.maxBpm) + " bpm");
      if (v.rounds && v.rounds.length) parts.push(v.rounds.length + " " + plural(v.rounds.length, "ronde", "rondes"));
    } else if (v.mode === "maatsoort") {
      if (v.signatures && v.signatures.length) parts.push(v.signatures.join(", "));
      if (v.difficulty) parts.push(v.difficulty);
    }
    return parts.filter(Boolean).join(" · ");
  }
  function tendText(ms) {
    if (!isNum(ms)) return "—";
    if (Math.abs(ms) < 0.5) return "precies op de tel";
    return fmtMsSigned(ms) + (ms > 0 ? " te laat" : " te vroeg");
  }

  /* Kerncijfers per oefening. better: welke kant op beter is (bij afwijking: lager). */
  const METRICS = {
    ritme: [
      { label: "Score", get: (v) => v.score, better: "higher" },
      { label: "Gem. afwijking", get: (v) => v.meanAbsMs, better: "lower", unit: "ms" },
      { label: "Spreiding", get: (v) => v.stdMs, better: "lower", unit: "ms" },
      { label: "Noten geraakt", get: (v) => v.hitRate, better: "higher", unit: "%", scale: 100 },
    ],
    gehoor: [
      { label: "Goed", get: (v) => v.accuracy, better: "higher", unit: "%", scale: 100 },
      { label: "Reactietijd", get: (v) => v.meanTimeMs, better: "lower", unit: "s", scale: 0.001, digits: 1 },
      { label: "Opnieuw beluisterd", get: (v) => v.replays, better: "lower", unit: "× per ronde", deltaUnit: "×", digits: 1 },
      { label: "Beste sessie", kind: "best", unit: "%" },
    ],
    bpm: [
      { label: "Score", get: (v) => v.score, better: "higher" },
      { label: "Gem. verschil", get: (v) => v.meanAbsDiff, better: "lower", unit: "bpm", digits: 1 },
      { label: "Binnen 2 bpm", get: (v) => v.within2, better: "higher", unit: "%", scale: 100 },
      { label: "Binnen 5 bpm", get: (v) => v.within5, better: "higher", unit: "%", scale: 100 },
    ],
    maatsoort: [
      { label: "Goed", get: (v) => v.accuracy, better: "higher", unit: "%", scale: 100 },
      { label: "Reactietijd", get: (v) => v.meanTimeMs, better: "lower", unit: "s", scale: 0.001, digits: 1 },
      { label: "Opnieuw beluisterd", get: (v) => v.replays, better: "lower", unit: "× per ronde", deltaUnit: "×", digits: 1 },
      { label: "Beste sessie", kind: "best", unit: "%" },
    ],
  };

  /* Korte zin over de richting: eerste k sessies tegenover de laatste k.
     o.ranged: er staat een periodefilter aan, dus "eerste" is het begin van die periode. */
  function trendNote(values, o) {
    const v = nums(values);
    if (v.length < 4) return "Speel nog een paar sessies, dan zie je hier je verloop.";
    const k = Math.min(5, Math.floor(v.length / 2));
    const a = mean(v.slice(0, k)), b = mean(v.slice(-k));
    const diff = b - a;
    if (Math.abs(diff) < o.threshold) return "Je blijft stabiel rond " + o.fmt(b) + ".";
    const better = o.lowerBetter ? diff < 0 : diff > 0;
    const basis = "eerste " + k + " tegenover laatste " + k + " sessies" + (o.ranged ? " in deze periode" : "");
    return (better ? "Je gaat vooruit" : "Je zakt wat terug") + ": van gemiddeld " + o.fmt(a) + " naar " + o.fmt(b) + " (" + basis + ").";
  }

  /* ---------- Grafiek-motor: meten, tekenen, tooltip ---------- */
  function makeKit(root) {
    const tip = h("div", { class: "st-tip", role: "status", "aria-live": "polite", hidden: true });
    root.append(tip);
    const charts = new Map();
    const dirty = new Set();
    let raf = 0;
    const ro = typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
        entries.forEach((e) => {
          const rec = charts.get(e.target);
          if (rec && Math.floor(e.contentRect.width) !== rec.w) dirty.add(e.target);
        });
        if (dirty.size && !raf) raf = requestAnimationFrame(flush);
      })
      : null;
    function onWinResize() {
      charts.forEach((rec, host) => dirty.add(host));
      if (!raf) raf = requestAnimationFrame(flush);
    }
    if (!ro) window.addEventListener("resize", onWinResize);

    function flush() {
      raf = 0;
      const list = Array.from(dirty);
      dirty.clear();
      list.forEach(draw);
    }
    function draw(host) {
      const rec = charts.get(host);
      if (!rec || !host.isConnected || host.hidden) return;
      const w = Math.floor(host.clientWidth);
      if (w < 60) return;
      rec.w = w;
      hide();
      host.textContent = "";
      try { rec.draw(host, w); } catch (err) {
        console.error("Grafiek tekenen mislukt", err);
        host.textContent = "";
        host.append(h("p", { class: "st-fig-empty" }, "Deze grafiek kon niet getekend worden."));
      }
    }
    function show(content, x, y) {
      tip.textContent = "";
      tip.append(content);
      tip.hidden = false;
      // Eerst linksboven zetten en dán meten: op de oude plek (bijv. tegen de rechterrand) is er minder
      // ruimte, en dan zou een bredere tooltip te smal gemeten worden
      tip.style.left = "0px";
      tip.style.top = "0px";
      const r = tip.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const left = clamp(x - r.width / 2, 8, Math.max(8, vw - r.width - 8));
      let top = y - r.height - 14;
      if (top < 8) top = Math.min(vh - r.height - 8, y + 18);
      tip.style.left = Math.round(left) + "px";
      tip.style.top = Math.round(top) + "px";
    }
    function hide() { tip.hidden = true; }
    // Op een aanraakscherm blijft de tooltip staan tot je ergens anders tikt
    const onDocDown = (e) => {
      if (tip.hidden) return;
      const t = e.target;
      if (!(t && t.closest && t.closest("[data-st-hover]"))) hide();
    };
    const onScroll = () => { if (!tip.hidden) hide(); };
    document.addEventListener("pointerdown", onDocDown, true);
    window.addEventListener("scroll", onScroll, { passive: true });

    function reset() {
      if (ro) ro.disconnect();
      charts.clear();
      dirty.clear();
      hide();
    }
    return {
      register(host, fn) { charts.set(host, { draw: fn, w: 0 }); if (ro) ro.observe(host); },
      drawAll() { charts.forEach((rec, host) => draw(host)); },
      redraw: draw,
      reset,
      show,
      hide,
      /* De tooltip hangt buiten de oefensectie; geef hem dezelfde accentkleur */
      tint(color) { tip.style.setProperty("--mode", color); },
      destroy() {
        reset();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (!ro) window.removeEventListener("resize", onWinResize);
        document.removeEventListener("pointerdown", onDocDown, true);
        window.removeEventListener("scroll", onScroll);
        tip.remove();
      },
    };
  }

  /* Inhoud van de tooltip: waarde voorop, label erachter, lijnsleutel in de reekskleur */
  function tipBody(title, list, note) {
    return h("div", null,
      title ? h("div", { class: "st-tip-title" }, title) : null,
      (list || []).map((r) => h("div", { class: "st-tip-row" },
        r.color ? h("i", { class: "st-tip-key" + (r.dot ? " dot" : ""), style: { background: r.color }, "aria-hidden": "true" }) : null,
        h("b", { class: "st-tip-val" }, r.value),
        r.label ? h("span", { class: "st-tip-lab" }, r.label) : null)),
      note ? h("div", { class: "st-tip-note" }, note) : null);
  }

  /* Hover, aanraking en pijltjestoetsen voor grafieken met posities 0..n−1 */
  function bindIndex(kit, el, o) {
    let cur = -1;
    el.setAttribute("tabindex", "0");
    el.setAttribute("data-st-hover", "");
    const set = (i) => { if (i < 0 || i >= o.n) return; cur = i; o.show(i); };
    const off = () => { cur = -1; o.clear(); kit.hide(); };
    el.addEventListener("pointermove", (e) => {
      const i = o.hit(e.clientX, e.clientY);
      if (i < 0) { if (cur >= 0) off(); } else if (i !== cur) set(i);
    });
    el.addEventListener("pointerdown", (e) => { const i = o.hit(e.clientX, e.clientY); if (i >= 0) set(i); });
    el.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") off(); });
    el.addEventListener("focus", () => {
      let kb = true;
      try { kb = el.matches(":focus-visible"); } catch (e) { /* oude browser */ }
      if (kb) set(cur >= 0 ? cur : o.start != null ? o.start : o.n - 1);
    });
    el.addEventListener("blur", off);
    el.addEventListener("keydown", (e) => {
      let i = cur >= 0 ? cur : o.start != null ? o.start : o.n - 1;
      if (e.key === "ArrowLeft") i -= 1;
      else if (e.key === "ArrowRight") i += 1;
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = o.n - 1;
      else if (e.key === "Escape") { off(); return; }
      else return;
      e.preventDefault();
      set(clamp(i, 0, o.n - 1));
    });
  }

  const R1 = (v) => Math.round(v * 10) / 10;
  function labelWidth(strings) {
    const len = strings.reduce((m, s) => Math.max(m, String(s).length), 1);
    return Math.ceil(len * 6.8 + 10);
  }
  /* Geschatte breedte van een monospace-tekst (letterbreedte ≈ 0,6 × lettergrootte) */
  function monoWidth(s, size) { return String(s).length * size * 0.61; }
  function lastIndex(vals) {
    for (let i = vals.length - 1; i >= 0; i--) if (isNum(vals[i])) return i;
    return -1;
  }
  function svgRoot(w, H, aria) {
    return svg("svg", { width: w, height: H, viewBox: "0 0 " + w + " " + H, role: "img", "aria-label": aria || null, class: "st-svg" });
  }
  function txt(x, y, s, cls, anchor) {
    return svg("text", { x: R1(x), y: R1(y), class: cls || "st-tick", "text-anchor": anchor || "middle" }, s);
  }
  /* Staaf met 4px afgeronde data-kant en een rechte voet op de nullijn */
  function vbar(x, yBase, yEnd, w, r) {
    const hgt = Math.abs(yBase - yEnd);
    if (hgt < 0.5) return "";
    r = Math.min(r, hgt, w / 2);
    const X = R1(x), W = R1(w), B = R1(yBase), E = R1(yEnd), Rr = R1(r);
    if (yEnd < yBase) {
      return "M" + X + "," + B + "V" + R1(E + Rr) + "A" + Rr + "," + Rr + " 0 0 1 " + R1(X + Rr) + "," + E +
        "H" + R1(X + W - Rr) + "A" + Rr + "," + Rr + " 0 0 1 " + R1(X + W) + "," + R1(E + Rr) + "V" + B + "Z";
    }
    return "M" + X + "," + B + "V" + R1(E - Rr) + "A" + Rr + "," + Rr + " 0 0 0 " + R1(X + Rr) + "," + E +
      "H" + R1(X + W - Rr) + "A" + Rr + "," + Rr + " 0 0 0 " + R1(X + W) + "," + R1(E - Rr) + "V" + B + "Z";
  }
  function yGrid(root, tks, y, x0, x1, fmt) {
    const g = svg("g", { class: "st-grid" });
    tks.forEach((t) => {
      g.append(svg("line", { x1: x0, x2: x1, y1: R1(y(t)), y2: R1(y(t)) }));
      g.append(svg("text", { x: x0 - 8, y: R1(y(t) + 4), class: "st-tick", "text-anchor": "end" }, fmt(t)));
    });
    root.append(g);
  }
  /* Datumlabels onder een tijdas, zonder dubbele buren */
  function dateTicks(root, n, pw, x, yPos, label) {
    if (n < 1) return;
    const k = Math.min(n, clamp(Math.floor(pw / 92) + 1, 2, 7));
    const idx = n === 1 ? [0] : Array.from(new Set(Array.from({ length: k }, (_, j) => Math.round((j * (n - 1)) / (k - 1)))));
    let last = null;
    idx.forEach((i, j) => {
      const t = label(i);
      if (t === last) return;
      last = t;
      const anchor = n === 1 ? "middle" : j === 0 ? "start" : j === idx.length - 1 ? "end" : "middle";
      root.append(txt(x(i), yPos, t, "st-tick", anchor));
    });
  }

  /* Lijngrafiek per sessie (gelijk verdeeld), met kruisdraad en tooltip */
  function drawLine(kit, host, w, c) {
    const n = c.items.length;
    const H = c.height || (w < 480 ? 190 : 230);
    const tks = c.y.ticks;
    const fmt = c.y.fmt || tickFmt;
    // Rechtermarge uit het echte eindlabel, zodat het binnen de grafiek blijft (bijv. "12,3 bpm").
    // Wordt de marge te breed voor een smal scherm, dan zonder eenheid (de ondertitel noemt die al).
    const endText = (s, short) => {
      const li = lastIndex(s.values);
      return li < 0 ? "" : ((short && s.endShort) || s.endFmt || fmt)(s.values[li]);
    };
    const endMargin = (short) => c.series.reduce((mx, s) => (s.endLabel ? Math.max(mx, 9 + monoWidth(endText(s, short), 12) + 6) : mx), 14);
    let endShort = false;
    let mr = endMargin(false);
    if (mr > w * 0.2 && c.series.some((s) => s.endLabel && s.endShort)) { endShort = true; mr = endMargin(true); }
    const m = { t: 12, r: Math.ceil(mr), b: 28, l: labelWidth(tks.map(fmt)) };
    const pw = Math.max(10, w - m.l - m.r), ph = H - m.t - m.b;
    const x = (i) => m.l + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));
    const y = (v) => m.t + ph - ((clamp(v, c.y.min, c.y.max) - c.y.min) / (c.y.max - c.y.min)) * ph;
    const root = svgRoot(w, H, c.aria);
    if (c.band) {
      const yT = y(Math.min(c.band.to, c.y.max)), yB = y(Math.max(c.band.from, c.y.min));
      root.append(svg("rect", { x: m.l, y: R1(yT), width: R1(pw), height: R1(Math.max(0, yB - yT)), class: "st-band" }));
      // Label linksonder in de zone (daar loopt de lijn zelden); bij een smalle zone erboven
      const bandH = yB - yT;
      root.append(txt(m.l + 6, bandH >= 18 ? yB - 6 : yT - 5, c.band.label, "st-band-label", "start"));
    }
    yGrid(root, tks, y, m.l, w - m.r, fmt);
    dateTicks(root, n, pw, x, H - 8, (i) => dateShort(c.items[i].ts));

    c.series.forEach((s) => {
      const vals = s.values;
      const count = nums(vals).length;
      // Vlak onder de hoofdlijn (10%), per aaneengesloten stuk
      if (s.area && count > 1) {
        let seg = [];
        const flushSeg = () => {
          if (seg.length > 1) {
            const d = "M" + R1(x(seg[0])) + "," + R1(y(c.y.min)) + seg.map((i) => "L" + R1(x(i)) + "," + R1(y(vals[i]))).join("") +
              "L" + R1(x(seg[seg.length - 1])) + "," + R1(y(c.y.min)) + "Z";
            root.append(svg("path", { d, class: "st-area" }));
          }
          seg = [];
        };
        vals.forEach((v, i) => { if (isNum(v)) seg.push(i); else flushSeg(); });
        flushSeg();
      }
      let d = "", pen = false;
      vals.forEach((v, i) => {
        if (!isNum(v)) { pen = false; return; }
        d += (pen ? "L" : "M") + R1(x(i)) + "," + R1(y(v));
        pen = true;
      });
      if (d && count > 1) root.append(svg("path", { d, class: "st-line " + (s.cls || "main") }));
      if (s.dots === true ? n <= 40 || count <= 1 : count <= 1) {
        vals.forEach((v, i) => { if (isNum(v)) root.append(svg("circle", { cx: R1(x(i)), cy: R1(y(v)), r: n <= 40 ? 3.5 : 3, class: "st-dot " + (s.cls || "main") })); });
      }
      if (s.endLabel) {
        const li = lastIndex(vals);
        if (li >= 0) {
          root.append(svg("circle", { cx: R1(x(li)), cy: R1(y(vals[li])), r: 4, class: "st-dot end " + (s.cls || "main") }));
          root.append(txt(x(li) + 9, y(vals[li]) + 4, endText(s, endShort), "st-endlabel", "start"));
        }
      }
    });

    // Kruisdraad en gemarkeerde punten
    const hover = svg("g", { class: "st-hover", display: "none" });
    const cross = svg("line", { class: "st-cross", y1: m.t, y2: m.t + ph });
    hover.append(cross);
    const hdots = c.series.map((s) => { const dot = svg("circle", { r: 5, class: "st-dot hot " + (s.cls || "main") }); hover.append(dot); return dot; });
    root.append(hover);
    host.append(root);

    bindIndex(kit, root, {
      n,
      hit: (cx) => {
        const r = root.getBoundingClientRect();
        const px = cx - r.left;
        if (px < m.l - 12 || px > w - m.r + 12) return -1;
        return n <= 1 ? 0 : clamp(Math.round(((px - m.l) / pw) * (n - 1)), 0, n - 1);
      },
      show: (i) => {
        hover.removeAttribute("display");
        cross.setAttribute("x1", R1(x(i)));
        cross.setAttribute("x2", R1(x(i)));
        let top = m.t + ph;
        c.series.forEach((s, k) => {
          const v = s.values[i];
          if (isNum(v)) {
            hdots[k].setAttribute("cx", R1(x(i)));
            hdots[k].setAttribute("cy", R1(y(v)));
            hdots[k].setAttribute("visibility", "visible");
            top = Math.min(top, y(v));
          } else hdots[k].setAttribute("visibility", "hidden");
        });
        const r = root.getBoundingClientRect();
        kit.show(c.tip(i), r.left + x(i), r.top + top);
      },
      clear: () => hover.setAttribute("display", "none"),
    });
  }

  /* Staven rond een nullijn per sessie (neiging), boven = +, onder = − */
  function drawDiverging(kit, host, w, c) {
    const n = c.items.length;
    const H = c.height || (w < 480 ? 180 : 210);
    const vals = c.values;
    const maxAbs = Math.max(c.minRange || 5, maxOf(vals.map((v) => (isNum(v) ? Math.abs(v) : null))) || 0);
    const M = niceMax(maxAbs, 2);
    const half = M / 2;
    const tks = [-M, -half, 0, half, M];
    const fmt = (t) => fmtSigned(t, Number.isInteger(t) ? 0 : 1);
    const m = { t: 10, r: 8, b: 28, l: labelWidth(tks.map(fmt)) };
    const pw = Math.max(10, w - m.l - m.r), ph = H - m.t - m.b;
    const y = (v) => m.t + ph / 2 - (clamp(v, -M, M) / M) * (ph / 2);
    const band = pw / Math.max(1, n);
    const bw = band < 4 ? Math.max(1, band - 0.6) : clamp(band * 0.6, 2, 14);
    const cx = (i) => m.l + band * (i + 0.5);
    const root = svgRoot(w, H, c.aria);
    yGrid(root, tks, y, m.l, w - m.r, fmt);
    const hl = svg("rect", { class: "st-colhl", y: m.t, width: R1(band), height: R1(ph), display: "none" });
    root.append(hl);
    const bars = vals.map((v, i) => {
      if (!isNum(v)) return null;
      const d = vbar(cx(i) - bw / 2, y(0), y(v), bw, 4);
      if (!d) return null;
      const p = svg("path", { d, class: "st-bar " + (v > 0 ? c.pos.cls : c.neg.cls) });
      root.append(p);
      return p;
    });
    root.append(svg("line", { class: "st-zero", x1: m.l, x2: w - m.r, y1: R1(y(0)), y2: R1(y(0)) }));
    dateTicks(root, n, pw, cx, H - 8, (i) => dateShort(c.items[i].ts));
    host.append(root);
    let hot = null;
    bindIndex(kit, root, {
      n,
      hit: (px0) => {
        const r = root.getBoundingClientRect();
        const px = px0 - r.left;
        if (px < m.l || px > w - m.r) return -1;
        return clamp(Math.floor((px - m.l) / band), 0, n - 1);
      },
      show: (i) => {
        hl.removeAttribute("display");
        hl.setAttribute("x", R1(m.l + band * i));
        if (hot) hot.classList.remove("hot");
        hot = bars[i];
        if (hot) hot.classList.add("hot");
        root.classList.add("has-hot");
        const v = vals[i];
        const r = root.getBoundingClientRect();
        kit.show(c.tip(i), r.left + cx(i), r.top + (isNum(v) ? Math.min(y(v), y(0)) : m.t));
      },
      clear: () => {
        hl.setAttribute("display", "none");
        if (hot) hot.classList.remove("hot");
        hot = null;
        root.classList.remove("has-hot");
      },
    });
  }

  /* Stapgrootte in hele getallen (1, 2, 5, 10, 20, 50 …) met hooguit maxSteps stappen tot v */
  function intStep(v, maxSteps) {
    for (let mag = 1; ; mag *= 10) {
      for (const f of [1, 2, 5]) { const s = f * mag; if (Math.ceil(v / s) <= maxSteps) return s; }
      if (mag > 1e9) return mag;
    }
  }
  /* Asmarkeringen onder de kolommen kiezen zonder overlap. Past het volledige label ("100–119") niet,
     dan het korte (b.tickShort, bijv. "100"); daarna van links naar rechts alleen wat vrij staat. */
  function columnTicks(bins, cx) {
    const GAP = 6;
    const pick = (short) => bins.map((b) => (short && b.tickShort != null ? b.tickShort : b.tick));
    const fits = (labels) => {
      let right = -Infinity;
      return labels.every((t, i) => {
        if (t == null) return true;
        const half = monoWidth(t, 11) / 2;
        if (cx(i) - half < right + GAP) return false;
        right = cx(i) + half;
        return true;
      });
    };
    let short = false;
    let labels = pick(false);
    if (!fits(labels) && bins.some((b) => b.tickShort != null)) { short = true; labels = pick(true); }
    const out = [];
    let right = -Infinity;
    labels.forEach((t, i) => {
      if (t == null) return;
      const half = monoWidth(t, 11) / 2;
      if (cx(i) - half < right + GAP) return;
      right = cx(i) + half;
      out.push({ i, t });
    });
    return { list: out, short };
  }

  /* Kolommen per vak (histogram, verwisselingen, tempobereik).
     c.integer: tellingen, dus alleen hele getallen op de as. */
  function drawColumns(kit, host, w, c) {
    const bins = c.bins;
    const n = bins.length;
    const H = c.height || (w < 480 ? 190 : 220);
    const vals = bins.map((b) => (isNum(b.value) ? Math.max(0, b.value) : 0));
    const peak = Math.max(maxOf(vals) || 0, c.minMax || 1);
    let yMax, tks;
    if (c.integer) {
      const step = intStep(peak, 4);
      yMax = Math.max(step, Math.ceil(peak / step) * step);
      tks = [];
      for (let t = 0; t <= yMax; t += step) tks.push(t);
    } else {
      yMax = niceMax(peak * 1.05, 3);
      tks = ticks(0, yMax, 3);
    }
    const fmt = c.yFmt || tickFmt;
    const m = { t: 18, r: 10, b: 28, l: labelWidth(tks.map(fmt)) };
    const pw = Math.max(10, w - m.l - m.r);
    const band = pw / Math.max(1, n);
    const cx = (i) => m.l + band * (i + 0.5);
    const tickPlan = columnTicks(bins, cx);
    const notes = tickPlan.short && c.shortNote ? [null, c.shortNote] : c.axisNotes || null;
    if (notes) m.b = 44;
    const ph = H - m.t - m.b;
    const bw = c.dense ? Math.max(1, Math.min(24, band - 2)) : Math.max(2, Math.min(24, band * 0.62));
    const y = (v) => m.t + ph - (v / yMax) * ph;
    const root = svgRoot(w, H, c.aria);
    yGrid(root, tks, y, m.l, w - m.r, fmt);
    const hl = svg("rect", { class: "st-colhl", y: m.t, width: R1(band), height: R1(ph), display: "none" });
    root.append(hl);
    const bars = vals.map((v, i) => {
      if (!(v > 0)) return null;
      const d = vbar(cx(i) - bw / 2, y(0), y(v), bw, 4);
      if (!d) return null;
      const p = svg("path", { d, class: "st-bar " + (bins[i].cls || "mode") });
      root.append(p);
      return p;
    });
    root.append(svg("line", { class: "st-base", x1: m.l, x2: w - m.r, y1: R1(y(0)), y2: R1(y(0)) }));
    // Waardelabels: spaarzaam (top 3) of bij weinig staven allemaal
    let labelIdx = [];
    if (c.labels === "all") labelIdx = vals.map((v, i) => i).filter((i) => vals[i] > 0);
    else if (c.labels === "top") labelIdx = vals.map((v, i) => i).filter((i) => vals[i] > 0).sort((a, b) => vals[b] - vals[a]).slice(0, 3);
    labelIdx.forEach((i) => root.append(txt(cx(i), y(vals[i]) - 6, (c.vFmt || fmt)(vals[i]), "st-vlabel")));
    tickPlan.list.forEach((tk) => root.append(txt(cx(tk.i), m.t + ph + 17, tk.t, "st-tick")));
    if (notes) {
      if (notes[0]) root.append(txt(m.l, H - 4, notes[0], "st-axisnote", "start"));
      if (notes[1]) root.append(txt(w - m.r, H - 4, notes[1], "st-axisnote", "end"));
    }
    host.append(root);
    let hot = null;
    bindIndex(kit, root, {
      n,
      start: c.start,
      hit: (px0) => {
        const r = root.getBoundingClientRect();
        const px = px0 - r.left;
        if (px < m.l || px > w - m.r) return -1;
        return clamp(Math.floor((px - m.l) / band), 0, n - 1);
      },
      show: (i) => {
        hl.removeAttribute("display");
        hl.setAttribute("x", R1(m.l + band * i));
        if (hot) hot.classList.remove("hot");
        hot = bars[i];
        if (hot) hot.classList.add("hot");
        root.classList.add("has-hot");
        const r = root.getBoundingClientRect();
        kit.show(c.tip(i), r.left + cx(i), r.top + y(vals[i]));
      },
      clear: () => {
        hl.setAttribute("display", "none");
        if (hot) hot.classList.remove("hot");
        hot = null;
        root.classList.remove("has-hot");
      },
    });
  }

  /* Pianotoetsenbord (één octaaf) als heatmap: percentage goed per toonklasse */
  function keyPath(g, r) {
    const x = R1(g.x), y = R1(g.y), w = R1(g.w), hh = R1(g.h);
    return "M" + x + "," + y + "H" + R1(x + w) + "V" + R1(y + hh - r) + "A" + r + "," + r + " 0 0 1 " + R1(x + w - r) + "," + R1(y + hh) +
      "H" + R1(x + r) + "A" + r + "," + r + " 0 0 1 " + x + "," + R1(y + hh - r) + "Z";
  }
  /* Eén tint, donker → licht. Begrensd op 66%: tot daar haalt witte tekst op de toets nog ≥ 4,5:1
     (nagerekend voor --c-gehoor op --surface-3). Zo is elk label leesbaar zonder van kleur te wisselen. */
  const HEAT_MIN = 14, HEAT_MAX = 66;
  function heatMix(acc) { return Math.round(HEAT_MIN + (HEAT_MAX - HEAT_MIN) * clamp(acc, 0, 1)); }
  function drawKeyboard(kit, host, w0, keys, aria) {
    const w = Math.min(w0, 760);
    const H = Math.round(clamp(w * 0.38, 160, 224));
    const ww = w / 7;
    const bw = ww * 0.62, bh = Math.round(H * 0.6);
    const root = svgRoot(w, H, aria);
    root.classList.add("st-kb");
    const geo = {};
    WHITE_PCS.forEach((pc, i) => { geo[pc] = { x: i * ww + 1, y: 0, w: ww - 2, h: H, black: false }; });
    BLACK_PCS.forEach((pc) => { geo[pc] = { x: (BLACK_LEFT[pc] + 1) * ww - bw / 2, y: 0, w: bw, h: bh, black: true }; });
    const shapes = {};
    const small = ww < 40;
    function drawKey(pc) {
      const g = geo[pc], k = keys[pc];
      const p = svg("path", { d: keyPath(g, g.black ? 4 : 6), class: "st-key" + (g.black ? " black" : " white") + (k.n ? "" : " nodata") });
      if (k.n) p.style.fill = "color-mix(in srgb, var(--mode) " + heatMix(k.ok / k.n) + "%, var(--surface-3))";
      shapes[pc] = p;
      root.append(p);
      const cx = g.x + g.w / 2;
      const pct = k.n ? Math.round((k.ok / k.n) * 100) + "%" : "—";
      if (!g.black) {
        root.append(txt(cx, H - (small ? 40 : 48), noteName(pc), "st-kb-name"));
        root.append(txt(cx, H - (small ? 25 : 29), pct, "st-kb-pct"));
        if (k.n) root.append(txt(cx, H - 11, k.ok + "/" + k.n, "st-kb-cnt"));
      } else if (bw >= 22) {
        root.append(txt(cx, bh - 24, noteName(pc), "st-kb-name sm"));
        root.append(txt(cx, bh - 10, pct, "st-kb-pct sm"));
      } else if (bw >= 15) {
        root.append(txt(cx, bh - 10, k.n ? String(Math.round((k.ok / k.n) * 100)) : "—", "st-kb-pct sm"));
      }
    }
    WHITE_PCS.forEach(drawKey);
    BLACK_PCS.forEach(drawKey);
    host.append(root);
    let hot = null;
    bindIndex(kit, root, {
      n: 12,
      start: 0,
      hit: (cx, cy) => {
        const r = root.getBoundingClientRect();
        const px = cx - r.left, py = cy - r.top;
        if (py < 0 || py > H) return -1;
        for (const pc of BLACK_PCS) { const g = geo[pc]; if (px >= g.x && px <= g.x + g.w && py <= g.h) return pc; }
        for (const pc of WHITE_PCS) { const g = geo[pc]; if (px >= g.x - 1 && px <= g.x + g.w + 1) return pc; }
        return -1;
      },
      show: (pc) => {
        if (hot) hot.classList.remove("hot");
        // Alleen een rand; de toets blijft op zijn plek. Zwarte toetsen liggen al boven de witte
        // en overlappen elkaar niet, dus hun rand is toch helemaal te zien.
        hot = shapes[pc];
        hot.classList.add("hot");
        const k = keys[pc], g = geo[pc];
        const r = root.getBoundingClientRect();
        const list = k.n
          ? [{ value: Math.round((k.ok / k.n) * 100) + "%", label: "goed" }, { value: k.ok + " van " + k.n, label: plural(k.n, "keer gevraagd", "keer gevraagd") }]
          : [{ value: "Nog niet gevraagd" }];
        let note = null;
        const wrong = Object.keys(k.wrong).map(Number).sort((a, b) => k.wrong[b] - k.wrong[a]);
        if (wrong.length) note = "Vaakst verward met " + noteName(wrong[0]) + " (" + k.wrong[wrong[0]] + "×)";
        kit.show(tipBody(noteName(pc), list, note), r.left + g.x + g.w / 2, r.top + 6);
      },
      clear: () => { if (hot) hot.classList.remove("hot"); hot = null; },
    });
  }

  /* Kleine trendlijn voor de kaarten in het overzicht (zonder interactie; de details staan een klik verder) */
  function drawSpark(host, w, values) {
    const H = 44;
    const vals = nums(values);
    const root = svg("svg", { width: w, height: H, viewBox: "0 0 " + w + " " + H, class: "st-svg st-spark", "aria-hidden": "true" });
    if (!vals.length) { host.append(root); return; }
    const lo = Math.max(0, (minOf(vals) || 0) - 8), hi = Math.min(100, (maxOf(vals) || 100) + 8);
    const span = Math.max(1, hi - lo);
    const n = values.length;
    const x = (i) => 6 + (n <= 1 ? (w - 12) / 2 : (i * (w - 12)) / (n - 1));
    const y = (v) => 6 + (H - 12) * (1 - (v - lo) / span);
    let d = "", pen = false, li = -1;
    values.forEach((v, i) => {
      if (!isNum(v)) { pen = false; return; }
      d += (pen ? "L" : "M") + R1(x(i)) + "," + R1(y(v));
      pen = true;
      li = i;
    });
    if (vals.length > 1) root.append(svg("path", { d, class: "st-spark-line" }));
    if (li >= 0) root.append(svg("circle", { cx: R1(x(li)), cy: R1(y(values[li])), r: 4, class: "st-spark-end" }));
    host.append(root);
  }

  /* ---------- HTML-bouwstenen ---------- */
  function legendEl(items) {
    return h("div", { class: "st-legend" }, items.map((it) =>
      h("span", { class: "st-leg" }, h("i", { class: "st-key st-key-" + (it.key || "line"), style: { background: it.color }, "aria-hidden": "true" }), it.label)));
  }

  function dataTable(t) {
    const table = h("table", { class: "st-table" },
      t.caption ? h("caption", { class: "visually-hidden" }, t.caption) : null,
      h("thead", null, h("tr", null, t.columns.map((c) => h("th", { scope: "col", class: c.num ? "r" : null }, c.label)))),
      h("tbody", null, t.rows.map((r) => h("tr", null, r.map((cell, j) => h("td", { class: t.columns[j] && t.columns[j].num ? "r num" : null }, cell))))));
    return h("div", { class: "st-table-wrap" }, table);
  }

  /* Balkjes met tekst (percentage per maatsoort of interval) */
  function meterList(list) {
    return h("div", { class: "st-meters" }, list.map((r) =>
      h("div", { class: "st-meter", style: r.color ? { "--mode": r.color } : null },
        h("span", { class: "st-meter-label" },
          r.color ? h("i", { class: "st-key st-key-dot", style: { background: r.color }, "aria-hidden": "true" }) : null,
          h("span", null, r.label)),
        h("span", { class: "st-meter-track", "aria-hidden": "true" },
          h("span", { class: "st-meter-fill", style: { width: (clamp(r.frac || 0, 0, 1) * 100).toFixed(1) + "%" } })),
        h("span", { class: "st-meter-val" }, h("b", { class: "num" }, r.value), r.sub ? h("span", { class: "st-meter-sub num" }, r.sub) : null))));
  }

  /* Kaartje met een grafiek, titel, legenda, toelichting en een tabelweergave */
  function figure(kit, o) {
    const head = h("div", { class: "st-fig-head" },
      h("div", { class: "st-fig-titles" },
        h("h3", { class: "st-fig-title" }, o.title),
        o.sub ? h("p", { class: "st-fig-sub" }, o.sub) : null));
    const fig = h("figure", { class: "panel st-fig" + (o.cls ? " " + o.cls : "") }, head);
    if (o.empty) {
      fig.append(h("div", { class: "st-fig-empty" }, o.empty));
      return fig;
    }
    if (o.legend && o.legend.length) fig.append(legendEl(o.legend));
    if (o.before) fig.append(o.before);
    let host = null;
    if (o.draw) {
      host = h("div", { class: "st-plot" + (o.center ? " is-center" : "") });
      fig.append(host);
      kit.register(host, o.draw);
    }
    if (o.body) fig.append(o.body);
    if (o.table && host) {
      let wrap = null;
      // Aan/uit-knop met een vaste naam; de stand staat in aria-pressed (en is zichtbaar als ingedrukt)
      const btn = h("button", {
        type: "button", class: "btn btn-ghost btn-sm st-tview", "aria-pressed": "false",
        title: "Toon de cijfers van deze grafiek als tabel",
      }, "Als tabel");
      btn.addEventListener("click", () => {
        const showTable = !wrap || wrap.hidden;
        if (showTable && !wrap) {
          wrap = dataTable(o.table());
          wrap.classList.add("st-tview-wrap");
          host.after(wrap);
        }
        wrap.hidden = !showTable;
        host.hidden = showTable;
        btn.setAttribute("aria-pressed", String(showTable));
        if (!showTable) kit.redraw(host);
      });
      head.append(btn);
    }
    if (o.note) fig.append(h("figcaption", { class: "st-fig-note" }, o.note));
    return fig;
  }

  function scaleLegend(text) {
    return h("div", { class: "st-scale", "aria-hidden": "true" },
      h("span", null, "0%"), h("i", { class: "st-scale-bar" }), h("span", null, "100% goed"),
      h("span", { class: "st-scale-na" }, h("i", { class: "st-key st-key-rect na" }), text || "niet gevraagd"));
  }

  /* ---------- De pagina ---------- */
  App.registerMode({
    id: "statistieken",
    title: "Statistieken",
    nav: "Statistieken",
    description: "Je voortgang per oefening: scores, trends en waar je nog winst haalt.",
    mount(root) {
      let alive = true;
      let ignoreStore = false;
      let redrawTimer = 0;
      let focusAfter = null;
      let tabsSeg = null, tabsRow = null, tabsAnchor = null, sectionEl = null, histEl = null;
      let stickIO = null;
      let data = { all: [], by: {} };

      function persist(key, value) {
        ignoreStore = true;
        try { App.store.setSetting(key, value); } catch (e) { /* opslaan mag mislukken */ } finally { ignoreStore = false; }
      }

      const savedTab = App.store.getSetting(SET_TAB, "overzicht");
      const savedRange = num(App.store.getSetting(SET_RANGE, 50));
      const savedVariant = App.store.getSetting(SET_VARIANT, null);
      const state = {
        tab: TABS.includes(savedTab) ? savedTab : "overzicht",
        // null = nog nooit gekozen: dan volgt de pagina je laatste gehoorsessie
        variant: savedVariant === "relatief" || savedVariant === "absoluut" ? savedVariant : null,
        variantPicked: false, // in dit bezoek zelf gekozen (dan niet stilletjes omzetten)
        range: [0, 20, 50].includes(savedRange) ? savedRange : 50,
        histLimit: 20,
      };

      /* Waar opent de pagina? 1) een diepe link (#/statistieken/ritme), anders 2) de oefening die je net
         speelde (een sessie die nieuwer is dan bij je vorige bezoek), anders 3) je laatste keuze. */
      (function chooseStart() {
        let first = { all: [] };
        try { first = loadAll(); } catch (e) { /* dan gewoon de laatste keuze */ }
        const newest = first.all[first.all.length - 1] || null;
        const sub = String(location.hash || "").split("/")[2];
        const deep = sub ? sub.split("?")[0] : "";
        if (deep && TABS.includes(deep)) {
          state.tab = deep;
          persist(SET_TAB, deep);
          try { history.replaceState(null, "", "#/statistieken"); } catch (e) { /* niet erg */ }
        } else if (newest && EXERCISES.includes(newest.mode)) {
          const seen = num(App.store.getSetting(SET_SEEN, null));
          if (seen === null || newest.ts > seen) {
            state.tab = newest.mode;
            persist(SET_TAB, newest.mode);
            if (newest.mode === "gehoor" && newest.variant) {
              state.variant = newest.variant;
              state.variantPicked = true;
              persist(SET_VARIANT, newest.variant);
            }
          }
        }
        if (newest && num(App.store.getSetting(SET_SEEN, null)) !== newest.ts) persist(SET_SEEN, newest.ts);
      })();

      /* Welke gehoorvariant tonen we? Je eigen keuze; zonder keuze die van je laatste sessie.
         Heeft die variant (nog) geen sessies en de andere wel, dan de andere (zonder het op te slaan). */
      function gehoorVariant(items) {
        const nRel = items.filter((v) => v.variant === "relatief").length;
        const nAbs = items.length - nRel;
        let v = state.variant;
        if (!v) {
          const last = items[items.length - 1];
          v = last && last.variant === "absoluut" ? "absoluut" : "relatief";
        }
        if (!state.variantPicked) {
          if (v === "relatief" && !nRel && nAbs) v = "absoluut";
          else if (v === "absoluut" && !nAbs && nRel) v = "relatief";
        }
        return v;
      }
      function pickVariant(v) {
        state.variant = v;
        state.variantPicked = true;
        persist(SET_VARIANT, v);
        fillSection();
      }

      const content = h("div", { class: "st" });
      root.append(content);
      const kit = makeKit(root);

      // Bij een wijziging in de opslag opnieuw tekenen; meerdere wijzigingen achter elkaar worden één keer tekenen
      const unsubscribe = App.store.subscribe(() => {
        if (ignoreStore || !alive || redrawTimer) return;
        redrawTimer = setTimeout(() => { redrawTimer = 0; if (alive) renderAll(); }, 0);
      });

      /* ----- Focus vasthouden bij opnieuw tekenen ----- */
      function captureFocus() {
        const a = document.activeElement;
        if (!a || !content.contains(a)) return null;
        const keyEl = a.closest("[data-st-key]");
        return keyEl ? { key: keyEl.getAttribute("data-st-key") } : null;
      }
      function restoreFocus(f) {
        if (!f) return;
        if (f.kind === "hist") {
          const btns = histEl ? histEl.querySelectorAll(".st-hdel") : [];
          if (btns.length) btns[Math.min(f.index, btns.length - 1)].focus({ preventScroll: true });
          else {
            const t = content.querySelector("#st-hist-title") || content.querySelector("h1");
            if (t) { t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true }); }
          }
          return;
        }
        const el = content.querySelector('[data-st-key="' + f.key + '"]');
        if (!el) return;
        const target = el.matches("button, a") ? el : el.querySelector('[aria-pressed="true"]') || el.querySelector("button, a");
        if (target) target.focus({ preventScroll: true });
      }

      /* ----- Opbouw ----- */
      function renderAll() {
        const keep = focusAfter || captureFocus();
        focusAfter = null;
        kit.reset();
        if (stickIO) { stickIO.disconnect(); stickIO = null; }
        data = loadAll();
        content.textContent = "";
        tabsSeg = tabsRow = tabsAnchor = sectionEl = histEl = null;
        content.append(App.ui.pageHead({
          eyebrow: "Statistieken",
          title: "Je voortgang",
          lead: "Hoe vaak je oefent, hoe je scoort en waar je nog winst kunt halen.",
        }));
        if (!data.all.length) {
          content.append(emptyAll());
          restoreFocus(keep);
          return;
        }
        // De keuzebalk staat bovenaan en blijft bij scrollen in beeld; het algemene overzicht
        // (tegels + kalender) hoort bij de tab Overzicht
        tabsSeg = buildTabs();
        tabsAnchor = h("div", { class: "st-tabs-anchor", "aria-hidden": "true" });
        tabsRow = h("div", { class: "st-tabs-row" }, tabsSeg);
        sectionEl = h("section", { class: "st-section" });
        histEl = h("section", { class: "panel st-hist-panel", "aria-labelledby": "st-hist-title" });
        content.append(tabsAnchor, tabsRow, sectionEl, histEl);
        watchStuck();
        fillSection(keep);
      }

      /* Schaduw onder de keuzebalk zodra hij aan de bovenkant blijft plakken */
      function watchStuck() {
        if (typeof IntersectionObserver !== "function" || !tabsAnchor) return;
        const row = tabsRow;
        // De balk plakt zodra het ankertje minder dan 8 px (zijn binnenruimte) van de bovenkant is
        stickIO = new IntersectionObserver((entries) => {
          entries.forEach((e) => row.classList.toggle("is-stuck", !e.isIntersecting && e.boundingClientRect.top < 9));
        }, { rootMargin: "-9px 0px 0px 0px" });
        stickIO.observe(tabsAnchor);
      }

      /* Na het wisselen: ben je al voorbij de keuzebalk gescrold, ga dan naar het begin van de nieuwe inhoud */
      function scrollToSection() {
        if (!tabsAnchor) return;
        const top = tabsAnchor.getBoundingClientRect().top;
        if (top < 8) window.scrollBy(0, top - 8);
      }

      /* Tekent de oefensectie en de geschiedenis opnieuw; de focus blijft waar hij was */
      function fillSection(keepArg) {
        const keep = keepArg !== undefined ? keepArg : captureFocus();
        kit.reset();
        sectionEl.textContent = "";
        histEl.textContent = "";
        const color = state.tab === "overzicht" ? ALL_COLOR : COLOR[state.tab];
        sectionEl.style.setProperty("--mode", color);
        sectionEl.setAttribute("aria-label", state.tab === "overzicht" ? "Overzicht van alle oefeningen" : "Statistieken van " + LABEL[state.tab]);
        histEl.style.setProperty("--mode", color);
        kit.tint(color);
        if (state.tab === "overzicht") renderOverview(sectionEl);
        else renderExercise(sectionEl, state.tab);
        renderHistory(histEl);
        kit.drawAll();
        restoreFocus(keep);
      }

      function setTab(v) {
        if (!TABS.includes(v) || v === state.tab || !tabsSeg) return;
        state.tab = v;
        state.histLimit = 20;
        persist(SET_TAB, v);
        tabsSeg.value = v;
        tintTabs();
        fillSection();
        scrollToSection();
      }
      function tintTabs() {
        if (tabsSeg) tabsSeg.style.setProperty("--mode", state.tab === "overzicht" ? ALL_COLOR : COLOR[state.tab]);
      }
      function buildTabs() {
        const seg = App.ui.segmented({
          options: TABS.map((t, i) => ({
            value: t,
            label: [icon(t === "overzicht" ? "statistieken" : t, 16), h("span", null, LABEL[t])],
            title: "Sneltoets " + (i + 1),
          })),
          value: state.tab,
          onChange: setTab,
          ariaLabel: "Kies wat je wilt zien",
        });
        seg.classList.add("st-tabs");
        seg.setAttribute("data-st-key", "tabs");
        tabsSeg = seg;
        tintTabs();
        return seg;
      }

      /* ----- Lege pagina ----- */
      function emptyAll() {
        return h("div", { class: "empty st-empty st-empty-all" },
          h("div", { class: "st-empty-icon" }, icon("statistieken", 26)),
          h("h3", null, "Nog geen sessies"),
          h("p", null, "Maak een oefening helemaal af. Daarna zie je hier je voortgang per oefening."),
          h("div", { class: "st-empty-actions" }, EXERCISES.map((id) =>
            h("a", { class: "btn st-go", href: "#/" + id, style: { "--mode": COLOR[id] } }, icon(id, 18), LABEL[id]))));
      }

      /* ----- Bovenaan: kerncijfers en activiteitskalender ----- */
      function topBlock() {
        const all = data.all;
        const now = Date.now();
        const week = all.filter((v) => v.ts > now - 7 * DAY);
        const prevWeek = all.filter((v) => v.ts > now - 14 * DAY && v.ts <= now - 7 * DAY);
        const totalMs = sum(all.map((v) => v.durationMs));
        const streak = streakOf(all);
        const best = longestStreak(all);
        const avg7 = mean(week.map((v) => v.score));
        const avgPrev = mean(prevWeek.map((v) => v.score));
        const [dv, du] = durParts(totalMs);

        let scoreSub = "Geen sessies in de afgelopen 7 dagen", scoreCls = "";
        if (avg7 !== null && avgPrev !== null) {
          const d = Math.round(avg7) - Math.round(avgPrev);
          if (d === 0) { scoreSub = "= gelijk aan de week ervoor"; scoreCls = "same"; }
          else { scoreSub = (d > 0 ? "▲ " : "▼ ") + Math.abs(d) + (d > 0 ? " beter" : " slechter") + " dan de week ervoor"; scoreCls = d > 0 ? "better" : "worse"; }
        } else if (avg7 !== null) scoreSub = "Over " + sessionsText(nums(week.map((v) => v.score)).length);

        const tile = (ic, value, label, unit, subText, subCls) => h("div", { class: "stat-tile st-kpi" },
          h("span", { class: "st-kpi-ico", "aria-hidden": "true" }, icon(ic, 16)),
          App.ui.stat(value, label, unit),
          subText ? h("div", { class: "st-kpi-sub " + (subCls || "") }, subText) : null);

        const kpis = h("div", { class: "grid-4 st-kpi-grid", role: "group", "aria-label": "Samenvatting" },
          tile("statistieken", fmtNum(all.length), plural(all.length, "sessie in totaal", "sessies in totaal"), null,
            week.length + " in de afgelopen 7 dagen"),
          tile("clock", dv, "geoefend in totaal", du,
            "gem. " + App.ui.fmtDuration(totalMs / all.length) + " per sessie"),
          tile("flame", String(streak), "op rij geoefend", plural(streak, "dag", "dagen"),
            "langste reeks: " + best + " " + plural(best, "dag", "dagen")),
          tile("trophy", avg7 !== null ? fmtNum(avg7) : "—", "gem. score, laatste 7 dagen", null, scoreSub, scoreCls));
        return h("div", { class: "st-top" }, kpis, activityPanel(all));
      }

      function activityPanel(all) {
        const today = startOfDay(Date.now());
        const dow = (new Date(today).getDay() + 6) % 7; // 0 = maandag
        const start = addDays(today, -dow - 7 * 11);
        const map = new Map();
        all.forEach((v) => {
          if (v.ts < start) return;
          const k = dayKey(v.ts);
          let e = map.get(k);
          if (!e) map.set(k, (e = { n: 0, ms: 0, by: {} }));
          e.n++;
          e.ms += v.durationMs;
          e.by[v.mode] = (e.by[v.mode] || 0) + 1;
        });
        const level = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);
        const inWindow = all.filter((v) => v.ts >= start);
        const daysActive = map.size;

        const grid = h("div", {
          class: "st-cal", role: "group", "data-st-hover": "",
          "aria-label": "Activiteit in de laatste 12 weken: " + daysActive + " " + plural(daysActive, "dag", "dagen") + " geoefend, " + sessionsText(inWindow.length) + ". Gebruik de pijltjestoetsen om per dag te kijken.",
        });
        // Maandlabels boven de weken waarin de 1e van een maand valt
        for (let wk = 0; wk < 12; wk++) {
          const ws = addDays(start, wk * 7);
          let label = "";
          for (let d = 0; d < 7; d++) { const t = addDays(ws, d); if (new Date(t).getDate() === 1) label = monthName(t); }
          if (wk === 0 && !label) {
            let soon = false;
            for (let d = 7; d < 21; d++) if (new Date(addDays(start, d)).getDate() === 1) soon = true;
            if (!soon) label = monthName(ws);
          }
          grid.append(h("span", { class: "st-cal-month", style: { gridColumn: String(wk + 2), gridRow: "1" }, "aria-hidden": "true" }, label));
        }
        ["ma", "", "wo", "", "vr", "", ""].forEach((t, d) => {
          grid.append(h("span", { class: "st-cal-day", style: { gridColumn: "1", gridRow: String(d + 2) }, "aria-hidden": "true" }, t));
        });
        const cells = [];
        for (let wk = 0; wk < 12; wk++) {
          for (let d = 0; d < 7; d++) {
            const ts = addDays(start, wk * 7 + d);
            const future = ts > today;
            const e = map.get(dayKey(ts));
            const n = e ? e.n : 0;
            const cell = h("span", {
              class: "st-cal-cell" + (future ? " is-future" : "") + (ts === today ? " is-today" : ""),
              style: { gridColumn: String(wk + 2), gridRow: String(d + 2) },
              "data-l": String(level(n)),
            });
            if (!future) {
              cell.setAttribute("role", "img");
              cell.setAttribute("tabindex", "-1");
              cell.setAttribute("data-i", String(cells.length));
              cell.setAttribute("aria-label", fmtLongDay.format(new Date(ts)) + ": " + (n ? sessionsText(n) : "geen sessies"));
              cells.push({ el: cell, ts, e });
            }
            grid.append(cell);
          }
        }
        let cur = cells.length - 1;
        if (cur >= 0) cells[cur].el.setAttribute("tabindex", "0");
        function showCell(i) {
          const c = cells[i];
          const r = c.el.getBoundingClientRect();
          const list = [];
          if (c.e) {
            list.push({ value: sessionsText(c.e.n), label: c.e.ms ? App.ui.fmtDuration(c.e.ms) : "" });
            EXERCISES.concat(Object.keys(c.e.by).filter((k) => !EXERCISES.includes(k))).forEach((id) => {
              if (c.e.by[id]) list.push({ value: c.e.by[id] + "×", label: modeLabel(id), color: COLOR[id] || "var(--text-3)" });
            });
          } else list.push({ value: "Geen sessies" });
          const title = fmtLongDay.format(new Date(c.ts)) + (c.ts === today ? " · vandaag" : "");
          kit.show(tipBody(title, list), r.left + r.width / 2, r.top);
        }
        function setCur(i) {
          if (cur >= 0 && cells[cur]) cells[cur].el.setAttribute("tabindex", "-1");
          cur = i;
          cells[cur].el.setAttribute("tabindex", "0");
        }
        const idxOf = (t) => { const c = t && t.closest ? t.closest(".st-cal-cell[data-i]") : null; return c ? Number(c.getAttribute("data-i")) : -1; };
        grid.addEventListener("pointerover", (e) => { const i = idxOf(e.target); if (i >= 0) showCell(i); });
        grid.addEventListener("pointerdown", (e) => { const i = idxOf(e.target); if (i >= 0) showCell(i); });
        grid.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") kit.hide(); });
        grid.addEventListener("focusin", (e) => {
          const i = idxOf(e.target);
          if (i < 0) return;
          setCur(i);
          let kb = true;
          try { kb = e.target.matches(":focus-visible"); } catch (err) { /* oude browser */ }
          if (kb) showCell(i);
        });
        grid.addEventListener("focusout", () => kit.hide());
        grid.addEventListener("keydown", (e) => {
          if (cur < 0) return;
          let i = cur;
          if (e.key === "ArrowLeft") i -= 7;
          else if (e.key === "ArrowRight") i += 7;
          else if (e.key === "ArrowUp") i -= 1;
          else if (e.key === "ArrowDown") i += 1;
          else if (e.key === "Home") i = 0;
          else if (e.key === "End") i = cells.length - 1;
          else if (e.key === "Escape") { kit.hide(); return; }
          else return;
          e.preventDefault();
          i = clamp(i, 0, cells.length - 1);
          setCur(i);
          cells[i].el.focus();
          showCell(i);
        });

        const legend = h("div", { class: "st-cal-legend", "aria-hidden": "true" },
          h("span", null, "Sessies per dag"),
          [["0", 0], ["1", 1], ["2", 2], ["3–4", 3], ["5+", 4]].map(([t, l]) =>
            h("span", { class: "st-cal-lg" }, h("i", { class: "st-cal-cell", "data-l": String(l) }), t)));

        const total = inWindow.length || 1;
        const split = meterList(EXERCISES.map((id) => {
          const n = inWindow.filter((v) => v.mode === id).length;
          return { label: LABEL[id], frac: n / total, value: String(n), sub: inWindow.length ? fmtPct(n / total) : "", color: COLOR[id] };
        }));
        const weekMs = sum(all.filter((v) => v.ts > Date.now() - 7 * DAY).map((v) => v.durationMs));
        const [wv, wu] = durParts(weekMs);

        return h("section", { class: "panel st-activity", "aria-labelledby": "st-act-title" },
          h("div", { class: "st-fig-head" }, h("div", { class: "st-fig-titles" },
            h("h2", { class: "st-h2", id: "st-act-title" }, "Activiteit"),
            h("p", { class: "st-sec-sub" }, "De laatste 12 weken. Hoe voller het vakje, hoe meer sessies die dag."))),
          h("div", { class: "st-act-body" },
            h("div", { class: "st-act-cal" }, grid, legend),
            h("div", { class: "st-act-side" },
              h("div", { class: "st-act-facts" },
                // Noemer = het aantal dagen dat al voorbij is in het venster (de rest van deze week bestaat nog niet)
                App.ui.stat(String(daysActive), plural(daysActive, "dag geoefend", "dagen geoefend"), "van " + cells.length),
                App.ui.stat(wv, "geoefend, laatste 7 dagen", wu)),
              h("h3", { class: "st-side-title" }, "Verdeling over de oefeningen"),
              split)));
      }

      /* ----- Overzicht: een kaart per oefening ----- */
      function renderOverview(sec) {
        sec.append(topBlock());
        sec.append(h("div", { class: "st-sec-head" },
          h("h2", { class: "st-h2" }, "Per oefening"),
          h("p", { class: "st-sec-sub" }, "Je laatste en beste score, en hoe je laatste sessies gingen.")));
        sec.append(h("div", { class: "st-cards" }, EXERCISES.map((id) => exCard(id, data.by[id]))));
      }

      function exCard(id, items) {
        const card = h("article", { class: "panel st-card", style: { "--mode": COLOR[id] }, "aria-label": LABEL[id] });
        const last = items[items.length - 1];
        const head = h("div", { class: "st-card-head" },
          h("div", { class: "st-icon-tile", "aria-hidden": "true" }, icon(id, 20)),
          h("div", { class: "st-card-titles" },
            h("h3", null, LABEL[id]),
            h("p", { class: "st-card-meta" }, items.length ? "Laatst gespeeld: " + relDay(last.ts) : "Nog niet gespeeld")));
        card.append(head);
        if (!items.length) {
          card.classList.add("is-empty");
          card.append(
            h("p", { class: "st-card-empty" }, EMPTY_TEXT[id]),
            h("div", { class: "st-card-actions" }, h("a", { class: "btn btn-primary btn-sm", href: "#/" + id }, icon("play", 14), "Start " + LABEL[id])));
          return card;
        }
        const scored = items.filter((v) => isNum(v.score));
        const lastScored = scored[scored.length - 1];
        const best = maxOf(scored.map((v) => v.score));
        const pctMode = id === "gehoor" || id === "maatsoort";
        const unit = pctMode ? "%" : null;
        card.append(h("div", { class: "st-card-stats" },
          App.ui.stat(lastScored ? fmtNum(lastScored.score) : "—", "laatste score", lastScored ? unit : null),
          App.ui.stat(best !== null ? fmtNum(best) : "—", "beste score", best !== null ? unit : null),
          App.ui.stat(fmtNum(items.length), plural(items.length, "sessie", "sessies"))));
        const sparkVals = items.slice(-12).map((v) => v.score);
        const sv = nums(sparkVals);
        const spark = h("div", { class: "st-spark-host" });
        const sparkWrap = h("div", { class: "st-card-spark" },
          h("div", { class: "st-card-spark-label" },
            h("span", null, sv.length > 1 ? "Laatste " + sv.length + " sessies" : "Eerste sessie"),
            h("span", { class: "visually-hidden" }, sv.length > 1 ? ": van " + fmtNum(sv[0]) + " naar " + fmtNum(sv[sv.length - 1]) : "")),
          spark);
        kit.register(spark, (host, w) => drawSpark(host, w, sparkVals));
        card.append(sparkWrap);
        let keyLine = "Laatste sessie: " + keyText(last);
        if (id === "ritme" && isNum(last.meanMs)) keyLine += ", " + tendText(last.meanMs);
        card.append(h("p", { class: "st-card-key" }, keyLine));
        card.append(h("div", { class: "st-card-actions" },
          h("button", { type: "button", class: "btn btn-sm", onClick: () => openTab(id) }, "Bekijk details", icon("next", 16)),
          h("a", { class: "btn btn-ghost btn-sm", href: "#/" + id }, icon("play", 14), "Oefenen")));
        return card;
      }

      function openTab(id) {
        if (!tabsSeg) return;
        setTab(id); // scrolt zelf naar het begin van de oefening
        const b = tabsSeg.querySelector('[aria-pressed="true"]');
        if (b) b.focus({ preventScroll: true });
      }

      /* ----- Eén oefening ----- */
      function renderExercise(sec, id) {
        let items = data.by[id] || [];
        const allCount = items.length;
        const controls = h("div", { class: "st-excontrols" });
        let variant = null;
        if (id === "gehoor" && items.length) {
          variant = gehoorVariant(items);
          const nRel = items.filter((v) => v.variant === "relatief").length;
          const nAbs = items.length - nRel;
          const vseg = App.ui.segmented({
            options: [{ value: "relatief", label: "Relatief (" + nRel + ")" }, { value: "absoluut", label: "Absoluut (" + nAbs + ")" }],
            value: variant,
            ariaLabel: "Soort gehoor",
            onChange: pickVariant,
          });
          vseg.setAttribute("data-st-key", "variant");
          controls.append(vseg);
          items = items.filter((v) => (variant === "relatief" ? v.variant === "relatief" : v.variant !== "relatief"));
        }
        // Periode: 'Laatste 50' alleen als er meer dan 50 zijn (anders is het hetzelfde als Alles)
        const range = state.range === 50 && items.length <= 50 ? 0 : state.range;
        if (items.length > 20) {
          const rseg = App.ui.segmented({
            options: RANGES.filter((r) => r.value !== 50 || items.length > 50),
            value: range,
            ariaLabel: "Periode",
            onChange: (v) => { state.range = v; persist(SET_RANGE, v); fillSection(); },
          });
          rseg.setAttribute("data-st-key", "range");
          controls.append(rseg);
        }
        // Zonder sessies staat de startknop al in de lege staat
        if (items.length) controls.append(h("a", { class: "btn btn-primary", href: "#/" + id }, icon("play", 16), "Oefenen"));
        const last = items[items.length - 1];
        const meta = !allCount ? "Nog niet gespeeld"
          : items.length ? sessionsText(items.length) + " · laatst " + relDay(last.ts)
          : "Nog geen sessies met " + variant + " gehoor";
        sec.append(h("div", { class: "st-exhead" },
          h("div", { class: "st-extitle" },
            h("div", { class: "st-icon-tile", "aria-hidden": "true" }, icon(id, 22)),
            h("div", null, h("h2", { class: "st-h2" }, LABEL[id]), h("p", { class: "st-sec-sub" }, meta))),
          controls));

        if (!items.length) {
          sec.append(emptyExercise(id, allCount, variant));
          return;
        }
        sec.append(kpiBlock(id, items));
        const ranged = range && items.length > range ? items.slice(-range) : items;
        // Sessienummers blijven kloppen met een periodefilter: de eerste in beeld is bijv. je 61e
        const offset = items.length - ranged.length;
        sec.append(scoreFigure(id, ranged, offset, items));
        if (id === "ritme") ritmeBlock(sec, items, ranged, offset);
        else if (id === "gehoor") gehoorBlock(sec, ranged, offset, variant);
        else if (id === "bpm") bpmBlock(sec, ranged, offset);
        else if (id === "maatsoort") maatBlock(sec, ranged);
      }

      function emptyExercise(id, allCount, variant) {
        const isVariant = id === "gehoor" && allCount > 0 && !!variant;
        const other = variant === "relatief" ? "absoluut" : "relatief";
        return h("div", { class: "empty st-empty" },
          h("div", { class: "st-empty-icon" }, icon(id, 24)),
          h("h3", null, isVariant ? "Nog geen sessies met " + variant + " gehoor" : "Nog geen " + sessionWord(id, 2)),
          h("p", null, isVariant ? "Kies " + variant + " in de oefening Gehoor. Je andere sessies staan bij " + other + "." : EMPTY_TEXT[id]),
          h("div", { class: "st-empty-actions" },
            h("a", { class: "btn btn-primary", href: "#/" + id }, icon("play", 16), "Start " + LABEL[id]),
            // Zelfde sleutel als de variantkeuze, zodat de focus daar terechtkomt na het wisselen
            isVariant ? h("button", { type: "button", class: "btn", "data-st-key": "variant", onClick: () => pickVariant(other) }, "Bekijk " + other) : null));
      }

      /* Kerncijfers: gemiddelde van de laatste 5 sessies tegenover de 5 daarvoor */
      function kpiBlock(id, items) {
        const sub = items.length > 5
          ? "Gemiddelde van je laatste 5 sessies, vergeleken met de 5 daarvoor."
          : items.length === 1 ? "Uit je enige sessie tot nu toe." : "Gemiddelde van je " + items.length + " sessies tot nu toe.";
        return h("div", { class: "st-kpis" },
          h("p", { class: "st-sec-sub" }, sub),
          h("div", { class: "grid-4 st-kpi-grid" }, METRICS[id].map((m) => metricTile(items, m))));
      }

      function metricTile(items, m) {
        if (m.kind === "best") {
          const best = items.reduce((b, v) => (isNum(v.score) && (!b || v.score > b.score) ? v : b), null);
          return h("div", { class: "stat-tile st-kpi" },
            App.ui.stat(best ? fmtNum(best.score) : "—", m.label, best ? m.unit : null),
            h("div", { class: "st-kpi-sub" }, best ? "op " + dateShort(best.ts) : "Nog geen score"));
        }
        const c = compareLast(items, m.get, 5);
        const scale = m.scale || 1, d = m.digits || 0;
        const value = c.recent === null ? "—" : fmtNum(c.recent * scale, d);
        return h("div", { class: "stat-tile st-kpi" },
          App.ui.stat(value, m.label, c.recent === null ? null : m.unit || null),
          deltaEl(c, m));
      }

      function deltaEl(c, m) {
        if (c.recent === null) return h("div", { class: "st-delta none" }, "Nog geen gegevens");
        if (c.prev === null) return h("div", { class: "st-delta none" }, "Nog niets om mee te vergelijken");
        const scale = m.scale || 1, d = m.digits || 0;
        const diff = (c.recent - c.prev) * scale;
        if (isZeroAt(Math.abs(diff), d)) return h("div", { class: "st-delta same" }, h("span", { "aria-hidden": "true" }, "= "), "gelijk");
        const good = m.better === "lower" ? diff < 0 : diff > 0;
        const du = m.deltaUnit || m.unit;
        const unit = !du || du === "%" ? "" : du === "×" ? du : " " + du;
        return h("div", { class: "st-delta " + (good ? "better" : "worse") },
          h("span", { "aria-hidden": "true" }, diff > 0 ? "▲ " : "▼ "),
          fmtNum(Math.abs(diff), d) + unit + " " + (good ? "beter" : "slechter"));
      }

      function rangeText(items) {
        if (!items.length) return "";
        const span = items.length === 1 ? dateShort(items[0].ts) : dateShort(items[0].ts) + " – " + dateShort(items[items.length - 1].ts);
        return sessionsText(items.length) + " · " + span;
      }

      /* offset: hoeveel eerdere sessies buiten de gekozen periode vallen */
      function sessionTipTitle(items, i, offset) { return "Sessie " + (i + 1 + (offset || 0)) + " · " + dateTime(items[i].ts); }

      /* Scoreverloop: elke sessie plus het voortschrijdend gemiddelde over 5 */
      function scoreFigure(id, items, offset, allItems) {
        offset = offset || 0;
        const pctMode = id === "gehoor" || id === "maatsoort";
        const scores = items.map((v) => v.score);
        // Het gemiddelde loopt door over de sessies vóór de periode, zodat het eerste punt ook over 5 gaat
        const avg = allItems && offset ? movingAvg(allItems.map((v) => v.score), 5).slice(offset) : movingAvg(scores, 5);
        const valid = nums(scores);
        const unit = pctMode ? "%" : "";
        const yf = (t) => fmtNum(t) + unit;
        const lastAvg = avg.filter(isNum).pop();
        const trend = trendNote(scores, { threshold: 3, fmt: yf, ranged: offset > 0 });
        const aria = (pctMode ? "Percentage goed" : "Score") + " per sessie, " + sessionsText(items.length) + ". " +
          (isNum(lastAvg) ? "Gemiddelde van de laatste 5: " + fmtNum(lastAvg) + unit + ". " : "") + trend;
        return figure(kit, {
          title: pctMode ? "Percentage goed per sessie" : "Score per sessie",
          sub: rangeText(items),
          legend: [
            { label: "per sessie", key: "dot", color: "var(--text-3)" },
            { label: "gemiddelde van 5", key: "line", color: "var(--mode)" },
          ],
          empty: valid.length ? null : "Deze sessies hebben nog geen score.",
          note: trend,
          draw: (host, w) => drawLine(kit, host, w, {
            items,
            series: [
              { values: scores, cls: "raw", dots: true },
              { values: avg, cls: "main", area: true, endLabel: true, endFmt: (v) => fmtNum(v) },
            ],
            y: { min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: yf },
            aria,
            tip: (i) => tipBody(sessionTipTitle(items, i, offset), [
              { value: isNum(scores[i]) ? fmtNum(scores[i]) + unit : "—", label: pctMode ? "goed" : "score", color: "var(--text-3)", dot: true },
              { value: isNum(avg[i]) ? fmtNum(avg[i]) + unit : "—", label: "gemiddelde van 5", color: "var(--mode)" },
            ], [keyText(items[i]), detailText(items[i])].filter((s) => s && s !== "—").join(" · ")),
          }),
          table: () => ({
            caption: "Score per sessie",
            columns: [{ label: "#", num: true }, { label: "Datum" }, { label: pctMode ? "Goed" : "Score", num: true }, { label: "Gem. van 5", num: true }],
            rows: items.map((v, i) => [String(i + 1 + offset), dateTime(v.ts), isNum(scores[i]) ? fmtNum(scores[i]) + unit : "—", isNum(avg[i]) ? fmtNum(avg[i]) + unit : "—"]),
          }),
        });
      }

      /* Eén waarde per sessie als lijn (afwijking, reactietijd …) */
      function metricLineFigure(items, o) {
        const vals = items.map(o.get);
        const valid = nums(vals);
        const maxV = maxOf(valid) || 0;
        const yMax = niceMax(Math.max(maxV, o.minMax || 1) * 1.08, 4);
        const tks = ticks(0, yMax, 4);
        const yf = (t) => fmtNum(t, o.tickDigits != null ? o.tickDigits : Number.isInteger(t) ? 0 : 1);
        const offset = o.offset || 0;
        const note = o.note || trendNote(vals, { threshold: o.threshold, fmt: o.fmt, lowerBetter: true, ranged: offset > 0 });
        return figure(kit, {
          title: o.title,
          sub: o.sub,
          empty: valid.length ? null : "Geen gegevens in deze sessies.",
          note,
          draw: (host, w) => drawLine(kit, host, w, {
            items,
            series: [{ values: vals, cls: "main", dots: true, endLabel: true, endFmt: o.fmt, endShort: o.fmtShort }],
            y: { min: 0, max: yMax, ticks: tks, fmt: yf },
            band: o.band,
            aria: o.title + ". " + note,
            tip: (i) => tipBody(sessionTipTitle(items, i, offset), o.tipRows(items[i], vals[i]), detailText(items[i])),
          }),
          table: () => ({
            caption: o.title,
            columns: [{ label: "#", num: true }, { label: "Datum" }, { label: o.colLabel, num: true }],
            rows: items.map((v, i) => [String(i + 1 + offset), dateTime(v.ts), isNum(vals[i]) ? o.fmt(vals[i]) : "—"]),
          }),
        });
      }

      /* Neiging per sessie rond de nullijn */
      function tendencyFigure(items, o) {
        const vals = items.map(o.get);
        const offset = o.offset || 0;
        const valid = nums(vals);
        return figure(kit, {
          title: o.title,
          sub: o.sub,
          legend: [{ label: o.neg + " (−)", key: "rect", color: "var(--early)" }, { label: o.pos + " (+)", key: "rect", color: "var(--late)" }],
          empty: valid.length ? null : "Geen gegevens in deze sessies.",
          note: o.note,
          draw: (host, w) => drawDiverging(kit, host, w, {
            items,
            values: vals,
            minRange: o.minRange,
            pos: { cls: "late" },
            neg: { cls: "early" },
            aria: o.title + ". " + o.note,
            tip: (i) => {
              const v = vals[i];
              const word = !isNum(v) ? "geen gegevens" : Math.abs(v) < 0.05 ? "precies goed" : v > 0 ? o.pos : o.neg;
              return tipBody(sessionTipTitle(items, i, offset), [{ value: isNum(v) ? o.fmt(v) : "—", label: word, color: !isNum(v) || v === 0 ? null : v > 0 ? "var(--late)" : "var(--early)" }], detailText(items[i]));
            },
          }),
          table: () => ({
            caption: o.title,
            columns: [{ label: "#", num: true }, { label: "Datum" }, { label: "Neiging", num: true }],
            rows: items.map((v, i) => [String(i + 1 + offset), dateTime(v.ts), isNum(vals[i]) ? o.fmt(vals[i]) + " " + (vals[i] > 0 ? o.pos : vals[i] < 0 ? o.neg : "") : "—"]),
          }),
        });
      }

      /* Tabelkaart (per patroon, per tempo) */
      function tableCard(title, sub, t, note) {
        return h("section", { class: "panel st-fig st-tablecard" },
          h("div", { class: "st-fig-head" }, h("div", { class: "st-fig-titles" }, h("h3", { class: "st-fig-title" }, title), sub ? h("p", { class: "st-fig-sub" }, sub) : null)),
          t.rows.length ? dataTable(t) : h("div", { class: "st-fig-empty" }, "Nog geen gegevens."),
          note ? h("p", { class: "st-fig-note" }, note) : null);
      }
      function scoreCell(v) {
        if (!isNum(v)) return "—";
        return h("span", { class: "st-scorecell" },
          h("span", { class: "st-minibar", "aria-hidden": "true" }, h("span", { style: { width: clamp(v, 0, 100) + "%" } })),
          h("span", { class: "num" }, fmtNum(v)));
      }

      /* ----- Ritme ----- */
      function ritmeBlock(sec, all, items, offset) {
        const absF = metricLineFigure(items, {
          title: "Hoe ver zit je naast de tel?",
          sub: "Gemiddelde afwijking per sessie, in ms. Lager is beter.",
          get: (v) => v.meanAbsMs,
          minMax: 24,
          band: { from: 0, to: 10, label: "perfect (≤ 10 ms)" },
          threshold: 2,
          offset,
          fmt: (v) => fmtNum(v) + " ms",
          fmtShort: (v) => fmtNum(v),
          colLabel: "Gem. afwijking",
          tipRows: (v, val) => [
            { value: isNum(val) ? fmtNum(val) + " ms" : "—", label: "gem. afwijking", color: "var(--mode)" },
            { value: isNum(v.stdMs) ? fmtNum(v.stdMs) + " ms" : "—", label: "spreiding" },
            { value: v.expected ? (v.matched ?? "?") + "/" + v.expected : "—", label: "noten geraakt" },
          ],
        });
        const tend = mean(items.map((v) => v.meanMs));
        const lateN = items.filter((v) => isNum(v.meanMs) && v.meanMs > 0).length;
        const withT = items.filter((v) => isNum(v.meanMs)).length;
        let tendNote = "Nog geen gegevens.";
        if (isNum(tend) && withT < 3) {
          tendNote = "Gemiddeld " + tendText(tend) + ". Na een paar sessies zie je of dat een patroon is.";
        } else if (isNum(tend)) {
          if (Math.abs(tend) < 3) tendNote = "Je zit gemiddeld mooi op de tel (" + fmtMsSigned(tend) + ").";
          else if (tend > 0) tendNote = "Je speelt meestal iets achter de tel: gemiddeld " + fmtMsSigned(tend) + " (" + lateN + " van " + withT + " sessies te laat). Zit je altijd te laat? Kijk dan of de kalibratie in Instellingen klopt.";
          else tendNote = "Je loopt meestal iets voor de tel uit: gemiddeld " + fmtMsSigned(tend) + " (" + (withT - lateN) + " van " + withT + " sessies te vroeg). Laat de tel naar je toe komen.";
        }
        const tendF = tendencyFigure(items, {
          title: "Te vroeg of te laat?",
          sub: "Gemiddelde afwijking met teken per sessie, in ms.",
          get: (v) => v.meanMs,
          pos: "te laat",
          neg: "te vroeg",
          minRange: 10,
          offset,
          fmt: (v) => fmtMsSigned(v),
          note: tendNote,
        });
        sec.append(h("div", { class: "st-pair" }, absF, tendF));
        sec.append(histFigure(all.slice(-10)));
        sec.append(h("div", { class: "st-pair" }, patternTable(items), ritmeTempoTable(items)));
        const gt = guideTable(items);
        if (gt) sec.append(gt);
      }

      /* Per begeleiding: hoe strak je speelt met het ritme erbij, met alleen de metronoom en in stilte.
         Zo zie je dat een lagere score in stilte geen achteruitgang is. Alleen als je er meer dan één speelde. */
      function guideTable(items) {
        const groups = ["ritme", "metronoom", "stil"].map((g) => ({ g, list: items.filter((v) => v.guide === g) })).filter((x) => x.list.length);
        if (groups.length < 2) return null;
        const solid = groups.filter((x) => x.list.length >= 2 && isNum(mean(x.list.map((v) => v.meanAbsMs))));
        let note = null;
        if (solid.length >= 2) {
          const ms = (x) => mean(x.list.map((v) => v.meanAbsMs));
          const easy = solid[0], hard = solid[solid.length - 1];
          const d = ms(hard) - ms(easy);
          const H = GUIDE_PHRASE[hard.g], E = GUIDE_PHRASE[easy.g];
          const Hc = H.charAt(0).toUpperCase() + H.slice(1);
          if (d >= 2) note = Hc + " zit je gemiddeld " + fmtNum(d) + " ms verder van de tel dan " + E + ". Vergelijk je scores dus per begeleiding.";
          else if (d <= -2) note = Hc + " zit je juist " + fmtNum(-d) + " ms dichter op de tel dan " + E + ". Met minder hulp luister je kennelijk scherper.";
          else note = Hc + " speel je even strak als " + E + ". Sterk: de tel zit in jezelf.";
        }
        return tableCard("Per begeleiding", "Wat je hoorde tijdens het meeklikken. Stilte is het moeilijkst.", {
          caption: "Per begeleiding",
          columns: [{ label: "Begeleiding" }, { label: "Sessies", num: true }, { label: "Naast de tel", num: true }, { label: "Neiging", num: true }, { label: "Score", num: true }],
          rows: groups.map((x) => [
            GUIDE_LABEL[x.g],
            String(x.list.length),
            fmtNum(mean(x.list.map((v) => v.meanAbsMs))) + " ms",
            fmtMsSigned(mean(x.list.map((v) => v.meanMs))),
            scoreCell(mean(x.list.map((v) => v.score))),
          ]),
        }, note);
      }

      function histFigure(last) {
        const offs = [];
        let missed = 0;
        last.forEach((v) => { (v.offsets || []).forEach((o) => offs.push(o)); missed += v.missed || 0; });
        const counts = new Array(21).fill(0);
        offs.forEach((o) => { counts[clamp(Math.round(o / 10), -10, 10) + 10]++; });
        const total = offs.length;
        const bins = counts.map((cnt, k) => {
          const c = (k - 10) * 10;
          return { c, value: cnt, cls: c < 0 ? "early" : c > 0 ? "late" : "neutral", tick: c % 50 === 0 ? fmtSigned(c) : null };
        });
        const med = median(offs);
        const within = fracOf(offs, (o) => Math.abs(o) <= 10);
        const lastN = last.length;
        const sub = total
          ? "Al je " + total + " geraakte tikken uit je laatste " + (lastN === 1 ? "sessie" : lastN + " sessies") + ", in vakjes van 10 ms."
          : "Uit je laatste " + (lastN === 1 ? "sessie" : lastN + " sessies") + ".";
        const note = total
          ? "Mediaan " + fmtMsSigned(med) + " · " + fmtPct(within) + " binnen ±10 ms" + (missed ? " · " + missed + " " + plural(missed, "noot", "noten") + " gemist (niet in de grafiek)" : "") + "."
          : null;
        const binLabel = (b) => (b.c === -100 ? "−100 ms of vroeger" : b.c === 100 ? "+100 ms of later" : fmtSigned(b.c) + " ms (" + fmtSigned(b.c - 5) + " tot " + fmtSigned(b.c + 5) + ")");
        return figure(kit, {
          title: "Verdeling van je tikken",
          sub,
          legend: [
            { label: "te vroeg", key: "rect", color: "var(--early)" },
            { label: "op de tel (±5 ms)", key: "rect", color: "var(--text-3)" },
            { label: "te laat", key: "rect", color: "var(--late)" },
          ],
          empty: total ? null : "Geen geraakte tikken in je laatste sessies.",
          note,
          draw: (host, w) => drawColumns(kit, host, w, {
            bins,
            dense: true,
            integer: true,
            start: 10,
            labels: "none",
            axisNotes: ["← te vroeg", "te laat →"],
            aria: "Histogram van je afwijkingen van −100 tot +100 ms. " + (note || ""),
            tip: (i) => {
              const b = bins[i];
              return tipBody(binLabel(b), [{ value: b.value + "×", label: total ? fmtPct(b.value / total) + " van je tikken" : "" }]);
            },
          }),
          table: () => ({
            caption: "Verdeling van je tikken",
            columns: [{ label: "Afwijking" }, { label: "Aantal", num: true }, { label: "Aandeel", num: true }],
            rows: bins.map((b) => [binLabel(b), String(b.value), total ? fmtPct(b.value / total) : "—"]),
          }),
        });
      }

      function patternTable(items) {
        const groups = new Map();
        items.forEach((v) => {
          let g = groups.get(v.patternKey);
          if (!g) groups.set(v.patternKey, (g = { name: v.patternName, list: [] }));
          g.name = v.patternName;
          g.list.push(v);
        });
        const list = Array.from(groups.values()).sort((a, b) => b.list.length - a.list.length);
        const best = list.filter((g) => g.list.length >= 2 && isNum(mean(g.list.map((v) => v.meanAbsMs))))
          .sort((a, b) => mean(a.list.map((v) => v.meanAbsMs)) - mean(b.list.map((v) => v.meanAbsMs)));
        const note = best.length >= 2 ? "Het strakst: " + best[0].name + ". Het meeste werk: " + best[best.length - 1].name + "." : null;
        return tableCard("Per patroon", "Gemiddelden per ritme over deze periode.", {
          caption: "Per patroon",
          columns: [{ label: "Patroon" }, { label: "Sessies", num: true }, { label: "Naast de tel", num: true }, { label: "Score", num: true }],
          rows: list.map((g) => [g.name, String(g.list.length), fmtNum(mean(g.list.map((v) => v.meanAbsMs))) + " ms", scoreCell(mean(g.list.map((v) => v.score)))]),
        }, note);
      }

      function tempoBins(values) {
        const map = new Map();
        values.forEach((x) => {
          if (!isNum(x.bpm)) return;
          const lo = Math.floor(x.bpm / 20) * 20;
          let g = map.get(lo);
          if (!g) map.set(lo, (g = { lo, list: [] }));
          g.list.push(x);
        });
        return Array.from(map.values()).sort((a, b) => a.lo - b.lo);
      }

      function ritmeTempoTable(items) {
        const bins = tempoBins(items);
        return tableCard("Per tempo", "In vakken van 20 bpm. Neiging: + is te laat, − is te vroeg.", {
          caption: "Per tempo",
          columns: [{ label: "Tempo (bpm)" }, { label: "Sessies", num: true }, { label: "Naast de tel", num: true }, { label: "Neiging", num: true }, { label: "Score", num: true }],
          rows: bins.map((b) => [
            b.lo + "–" + (b.lo + 19),
            String(b.list.length),
            fmtNum(mean(b.list.map((v) => v.meanAbsMs))) + " ms",
            fmtMsSigned(mean(b.list.map((v) => v.meanMs))),
            scoreCell(mean(b.list.map((v) => v.score))),
          ]),
        });
      }

      /* ----- Gehoor ----- */
      function gehoorBlock(sec, items, offset, variant) {
        const keys = [];
        for (let pc = 0; pc < 12; pc++) keys.push({ pc, n: 0, ok: 0, wrong: {} });
        const semi = {};
        let intervals = null;
        items.forEach((v) => {
          v.rounds.forEach((r) => {
            if (r.pc === null || r.correct === null) return;
            const k = keys[r.pc];
            k.n++;
            if (r.correct) k.ok++;
            else if (r.answerPc !== null && r.answerPc !== r.pc) k.wrong[r.answerPc] = (k.wrong[r.answerPc] || 0) + 1;
            if (v.variant === "relatief" && r.ref !== null && r.target !== null) {
              if (!intervals) intervals = {};
              const d = Math.abs(Math.round(r.target - r.ref));
              const key = d > 12 ? 13 : d;
              const g = intervals[key] || (intervals[key] = { n: 0, ok: 0 });
              g.n++;
              if (r.correct) g.ok++;
            }
          });
          Object.keys(v.semi || {}).forEach((d) => { semi[d] = (semi[d] || 0) + v.semi[d]; });
        });
        const asked = keys.filter((k) => k.n > 0);
        const ranked = keys.filter((k) => k.n >= 3).sort((a, b) => b.ok / b.n - a.ok / a.n);
        let kbNote = asked.length ? "Speel meer rondes voor een betrouwbaar beeld per noot." : null;
        if (ranked.length >= 2) {
          const top = ranked[0], low = ranked[ranked.length - 1];
          kbNote = "Sterkst: " + noteName(top.pc) + " (" + fmtPct(top.ok / top.n) + "). Zwakst: " + noteName(low.pc) + " (" + fmtPct(low.ok / low.n) + ").";
        }
        sec.append(figure(kit, {
          title: "Welke noten herken je?",
          sub: "Percentage goed per toon, alle octaven samen.",
          before: scaleLegend(),
          center: true,
          empty: asked.length ? null : "Nog geen rondes met een bekende noot.",
          note: kbNote,
          draw: (host, w) => drawKeyboard(kit, host, w, keys, "Toetsenbord met per toon het percentage goed. " + (kbNote || "")),
          table: () => ({
            caption: "Percentage goed per toon",
            columns: [{ label: "Toon" }, { label: "Goed", num: true }, { label: "Gevraagd", num: true }, { label: "Percentage", num: true }],
            rows: keys.map((k) => [noteName(k.pc), String(k.ok), String(k.n), k.n ? fmtPct(k.ok / k.n) : "—"]),
          }),
        }));

        // Verwisselingen in halve tonen (−5..+6)
        const dists = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];
        const semiTotal = sum(dists.map((d) => semi[d] || 0));
        const bins = dists.map((d) => ({ d, value: semi[d] || 0, cls: d < 0 ? "early" : d === 6 ? "neutral" : "late", tick: fmtSigned(d) }));
        const semiName = (d) => {
          const n = Math.abs(d);
          const base = n + " halve " + plural(n, "toon", "tonen") + " (" + INTERVALS[n] + ")";
          return d === 6 ? base + ", omhoog of omlaag" : base + (d < 0 ? " te laag" : " te hoog");
        };
        const topBin = bins.slice().sort((a, b) => b.value - a.value)[0];
        const semiNote = semiTotal
          ? "Je zit het vaakst " + semiName(topBin.d) + " naast: " + topBin.value + " van je " + semiTotal + " fouten."
          : null;
        const semiF = figure(kit, {
          title: "Waar zit je naast?",
          sub: "Bij een fout: hoeveel halve tonen je antwoord van de echte noot af zat.",
          legend: [
            { label: "te laag", key: "rect", color: "var(--early)" },
            { label: "te hoog", key: "rect", color: "var(--late)" },
            { label: "tritonus (±6)", key: "rect", color: "var(--text-3)" },
          ],
          empty: semiTotal ? null : "Nog geen fouten om te tellen. Knap!",
          note: semiNote,
          draw: (host, w) => drawColumns(kit, host, w, {
            bins,
            labels: "top",
            integer: true,
            aria: "Verwisselingen in halve tonen. " + (semiNote || ""),
            tip: (i) => tipBody(semiName(bins[i].d), [{ value: bins[i].value + "×", label: semiTotal ? fmtPct(bins[i].value / semiTotal) + " van je fouten" : "" }]),
          }),
          table: () => ({
            caption: "Verwisselingen in halve tonen",
            columns: [{ label: "Afstand" }, { label: "Aantal", num: true }],
            rows: bins.map((b) => [fmtSigned(b.d) + " · " + semiName(b.d), String(b.value)]),
          }),
        });
        const timeF = metricLineFigure(items, {
          title: "Reactietijd",
          sub: "Gemiddelde tijd tot je antwoord, per sessie. Lager is sneller.",
          get: (v) => (isNum(v.meanTimeMs) ? v.meanTimeMs / 1000 : null),
          minMax: 2,
          threshold: 0.3,
          tickDigits: null,
          offset,
          fmt: (v) => fmtNum(v, 1) + " s",
          colLabel: "Reactietijd",
          tipRows: (v, val) => [
            { value: isNum(val) ? fmtNum(val, 1) + " s" : "—", label: "gem. reactietijd", color: "var(--mode)" },
            { value: v.total ? fmtPct(v.accuracy) : "—", label: "goed" },
          ],
        });
        sec.append(h("div", { class: "st-pair" }, semiF, timeF));

        if (intervals && variant === "relatief") {
          const keysI = Object.keys(intervals).map(Number).sort((a, b) => a - b);
          const list = keysI.map((d) => {
            const g = intervals[d];
            return { label: d > 12 ? "meer dan een octaaf" : INTERVALS[d], frac: g.ok / g.n, value: fmtPct(g.ok / g.n), sub: g.ok + "/" + g.n };
          });
          const rankedI = keysI.filter((d) => intervals[d].n >= 3).sort((a, b) => intervals[a].ok / intervals[a].n - intervals[b].ok / intervals[b].n);
          sec.append(figure(kit, {
            title: "Per interval vanaf de referentie",
            sub: "Omhoog en omlaag samen. Percentage goed en aantal rondes.",
            body: meterList(list),
            note: rankedI.length >= 2 ? "Oefen vooral de " + (rankedI[0] > 12 ? "grote sprongen" : INTERVALS[rankedI[0]]) + ": daar scoor je het laagst." : null,
          }));
        }
      }

      /* ----- BPM ----- */
      /* Tempovakken van 20 bpm voor BPM-rondes. De bovengrens van een sessiebereik (bijv. 180 bij 60–180)
         telt mee in het vak eronder; anders krijgt die ene waarde een eigen, onbetrouwbaar staafje.
         Labels worden afgekapt op het bereik dat je echt oefende ("50–59" in plaats van "40–59"). */
      function bpmTempoGroups(items) {
        let gLo = Infinity, gHi = -Infinity;
        const map = new Map();
        items.forEach((v) => {
          const sMin = isNum(v.minBpm) ? v.minBpm : null, sMax = isNum(v.maxBpm) ? v.maxBpm : null;
          (v.rounds || []).forEach((r) => {
            if (!isNum(r.actual) || !isNum(r.diff)) return;
            let lo = Math.floor(r.actual / 20) * 20;
            let top = false;
            if (lo === r.actual && sMax !== null && r.actual >= sMax && (sMin === null || r.actual > sMin)) { lo -= 20; top = true; }
            let g = map.get(lo);
            if (!g) map.set(lo, (g = { lo, top: false, list: [] }));
            if (top) g.top = true;
            g.list.push(r);
            // Bereik voor de labels: dat van de sessie; zonder bekend bereik gewoon de vakgrenzen
            gLo = Math.min(gLo, r.actual, sMin !== null ? sMin : lo);
            gHi = Math.max(gHi, r.actual, sMax !== null ? sMax : lo + 19);
          });
        });
        return Array.from(map.values()).sort((a, b) => a.lo - b.lo).map((g) => {
          const from = Math.max(g.lo, gLo);
          const to = g.top ? g.lo + 20 : Math.min(g.lo + 19, gHi);
          return {
            lo: g.lo, from, to, label: from === to ? String(from) : from + "–" + to,
            n: g.list.length,
            abs: mean(g.list.map((r) => Math.abs(r.diff))),
            signed: mean(g.list.map((r) => r.diff)),
            within5: fracOf(g.list, (r) => Math.abs(r.diff) <= 5),
          };
        });
      }

      function bpmBlock(sec, items, offset) {
        const diffF = metricLineFigure(items, {
          title: "Hoe ver zit je ernaast?",
          sub: "Gemiddeld verschil met het echte tempo per sessie, in bpm. Lager is beter.",
          get: (v) => v.meanAbsDiff,
          minMax: 6,
          band: { from: 0, to: 2, label: "binnen 2 bpm" },
          threshold: 0.5,
          offset,
          fmt: (v) => fmtNum(v, 1) + " bpm",
          fmtShort: (v) => fmtNum(v, 1),
          colLabel: "Gem. verschil",
          tipRows: (v, val) => [
            { value: isNum(val) ? fmtNum(val, 1) + " bpm" : "—", label: "gem. verschil", color: "var(--mode)" },
            { value: fmtPct(v.within5), label: "binnen 5 bpm" },
          ],
        });
        const tend = mean(items.map((v) => v.meanDiff));
        let note = "Nog geen gegevens.";
        if (isNum(tend) && nums(items.map((v) => v.meanDiff)).length < 3) {
          note = "Gemiddeld " + fmtSigned(tend, 1) + " bpm. Na een paar sessies zie je of je structureel te hoog of te laag schat.";
        } else if (isNum(tend)) {
          if (Math.abs(tend) < 1) note = "Je schat niet structureel te hoog of te laag (" + fmtSigned(tend, 1) + " bpm).";
          else if (tend > 0) note = "Je schat tempo's meestal te hoog: gemiddeld " + fmtSigned(tend, 1) + " bpm.";
          else note = "Je schat tempo's meestal te laag: gemiddeld " + fmtSigned(tend, 1) + " bpm.";
        }
        const tendF = tendencyFigure(items, {
          title: "Te hoog of te laag?",
          sub: "Gemiddeld verschil met teken per sessie, in bpm.",
          get: (v) => v.meanDiff,
          pos: "te hoog",
          neg: "te laag",
          minRange: 4,
          offset,
          fmt: (v) => fmtSigned(v, 1) + " bpm",
          note,
        });
        sec.append(h("div", { class: "st-pair" }, diffF, tendF));

        // Fout per tempobereik (vakken van 20 bpm), over alle rondes
        const groups = bpmTempoGroups(items);
        const bins = groups.map((g) => ({ value: g.abs, cls: "mode", tick: g.label, tickShort: String(g.from) }));
        let binNote = null;
        const solid = groups.filter((g) => g.n >= 3);
        if (solid.length >= 2) {
          const worst = solid.slice().sort((a, b) => b.abs - a.abs)[0];
          const bestG = solid.slice().sort((a, b) => a.abs - b.abs)[0];
          binNote = "Het lastigst: " + worst.label + " bpm (" + fmtNum(worst.abs, 1) + " ernaast). Het makkelijkst: " + bestG.label + " bpm (" + fmtNum(bestG.abs, 1) + ").";
          // Muzikale tip bij het lastigste bereik
          if (worst.from >= 140) binNote += " Tip: voel bij snelle tempo's alleen elke tweede tel (halve maten) en verdubbel dan je schatting.";
          else if (worst.to <= 90) binNote += " Tip: tel bij langzame tempo's de achtsten in je hoofd mee (‘1-en-2-en’); dan blijft je gevoel voor de tel stabieler.";
        }
        sec.append(figure(kit, {
          title: "Fout per tempobereik",
          sub: "Gemiddeld verschil in bpm, per vak van 20 bpm, over alle rondes.",
          empty: groups.length ? null : "Nog geen rondes met een bekend tempo.",
          note: binNote,
          draw: (host, w) => drawColumns(kit, host, w, {
            bins,
            labels: groups.length <= 8 ? "all" : "top",
            vFmt: (v) => fmtNum(v, 1),
            shortNote: "begin van elk vak, in bpm",
            aria: "Gemiddeld verschil per tempobereik. " + (binNote || ""),
            tip: (i) => {
              const g = groups[i];
              return tipBody(g.label + " bpm", [
                { value: fmtNum(g.abs, 1) + " bpm", label: "gem. verschil", color: "var(--mode)" },
                { value: fmtSigned(g.signed, 1) + " bpm", label: g.signed > 0.05 ? "neiging te hoog" : g.signed < -0.05 ? "neiging te laag" : "geen neiging" },
                { value: fmtPct(g.within5), label: "binnen 5 bpm" },
              ], g.n + " " + plural(g.n, "ronde", "rondes"));
            },
          }),
          table: () => ({
            caption: "Fout per tempobereik",
            columns: [{ label: "Tempo" }, { label: "Rondes", num: true }, { label: "Gem. verschil", num: true }, { label: "Neiging", num: true }, { label: "Binnen 5", num: true }],
            rows: groups.map((g) => [g.label + " bpm", String(g.n), fmtNum(g.abs, 1), fmtSigned(g.signed, 1), fmtPct(g.within5)]),
          }),
        }));
      }

      /* ----- Maatsoort ----- */
      function sigSort(a, b) {
        const [na, da] = a.split("/").map(Number), [nb, db] = b.split("/").map(Number);
        if (isNum(da) && isNum(db) && da !== db) return da - db;
        if (isNum(na) && isNum(nb) && na !== nb) return na - nb;
        return a < b ? -1 : a > b ? 1 : 0;
      }
      /* Muzikale tip per verwisseling. Sleutels in de volgorde van sigSort (eerst /4, dan /8). */
      const SIG_TIPS = {
        "2/4|3/4": "Tel vanaf de zware tel: komt die na twee tellen terug (2/4) of na drie (3/4)?",
        "2/4|4/4": "4/4 klinkt als twee maten 2/4, maar tel 3 is lichter dan tel 1. Is elke tweede tel even zwaar? Dan is het 2/4.",
        "2/4|5/4": "5/4 heeft een groep van twee tellen die op 2/4 lijkt, maar daarnaast ook een groep van drie.",
        "2/4|6/8": "Beide hebben twee zware tellen. In 2/4 gaat elke tel in tweeën, in 6/8 in drieën.",
        "3/4|4/4": "Tel vanaf de zware tel: komt hij na drie tellen terug (3/4) of na vier (4/4)?",
        "3/4|5/4": "5/4 is drie tellen plus twee. Hoor je na drie tellen nog een kort stukje voordat tel 1 terugkomt? Dan is het 5/4.",
        "3/4|6/8": "In 3/4 voel je drie gelijke tellen; in 6/8 twee zware tellen die elk in drieën zijn verdeeld.",
        "3/4|7/8": "Allebei drie tellen, maar in 7/8 is één tel langer (bijv. 2+2+3). In 3/4 lopen alle tellen gelijk door.",
        "3/4|9/8": "Drie tellen in allebei. In 3/4 gaat elke tel in tweeën, in 9/8 in drieën.",
        "4/4|5/4": "Tel hardop mee vanaf de zware tel: bij 5/4 komt er net één tel meer voordat het opnieuw begint.",
        "4/4|6/8": "6/8 voelt als twee wiegende tellen (elk in drieën), 4/4 als vier rechte tellen (elk in tweeën).",
        "4/4|7/8": "7/8 is één achtste korter dan 4/4. Daardoor struikelt de maat net even.",
        "4/4|12/8": "Allebei vier tellen. 12/8 swingt in drieën binnen elke tel, 4/4 gaat in tweeën.",
        "5/4|7/8": "5/4 is veel langer (vijf hele tellen). 7/8 is kort en hinkt, met groepjes van twee en drie.",
        "6/8|7/8": "7/8 voelt alsof er een tel mank gaat: tel de korte groepjes (2+2+3).",
        "6/8|9/8": "Allebei tellen in drieën. Tel de zware tellen tot de herhaling: twee (6/8) of drie (9/8)?",
        "6/8|12/8": "Tel de zware tellen tot de groove zich herhaalt: twee bij 6/8, vier bij 12/8.",
        "7/8|9/8": "Allebei drie tellen, maar in 9/8 zijn ze even lang (3+3+3) en in 7/8 niet (2+2+3).",
        "9/8|12/8": "Tel de zware tellen tot de herhaling: drie bij 9/8, vier bij 12/8.",
      };

      function maatBlock(sec, items) {
        const rounds = [];
        items.forEach((v) => v.rounds.forEach((r) => { if (r.actual && r.correct !== null) rounds.push(r); }));
        const sigSet = new Set();
        rounds.forEach((r) => { sigSet.add(r.actual); if (r.answer) sigSet.add(r.answer); });
        const sigs = Array.from(sigSet).sort(sigSort);
        const per = sigs.map((s) => {
          const list = rounds.filter((r) => r.actual === s);
          return { s, n: list.length, ok: list.filter((r) => r.correct).length };
        }).filter((p) => p.n > 0);
        const perList = per.map((p) => ({ label: p.s, frac: p.ok / p.n, value: fmtPct(p.ok / p.n), sub: p.ok + "/" + p.n }));
        const rankedP = per.filter((p) => p.n >= 3).sort((a, b) => a.ok / a.n - b.ok / b.n);
        const perF = figure(kit, {
          title: "Per maatsoort",
          sub: "Percentage goed en aantal rondes per echte maatsoort.",
          empty: per.length ? null : "Nog geen rondes.",
          body: per.length ? meterList(perList) : null,
          note: rankedP.length >= 2 ? "Het lastigst: " + rankedP[0].s + " (" + fmtPct(rankedP[0].ok / rankedP[0].n) + " goed)." : null,
        });

        // Verwisselingsmatrix: echte maatsoort (rij) × jouw antwoord (kolom)
        const counts = {};
        sigs.forEach((a) => { counts[a] = {}; sigs.forEach((b) => (counts[a][b] = 0)); });
        rounds.forEach((r) => { if (r.answer && counts[r.actual] && r.answer in counts[r.actual]) counts[r.actual][r.answer]++; });
        let topConf = null;
        sigs.forEach((a) => sigs.forEach((b) => {
          if (a !== b && counts[a][b] > 0 && (!topConf || counts[a][b] > topConf.n)) topConf = { a, b, n: counts[a][b] };
        }));
        let matrixNote = rounds.length ? "Op de diagonaal staan je goede antwoorden." : null;
        if (topConf) {
          const tipKey = [topConf.a, topConf.b].sort(sigSort).join("|");
          matrixNote = "Je verwart " + topConf.a + " het vaakst met " + topConf.b + " (" + topConf.n + "×). " + (SIG_TIPS[tipKey] || "Tel hardop mee en zoek de zware tel.");
        }
        const answered = rounds.filter((r) => r.answer).length;
        const matrixF = figure(kit, {
          title: "Wat verwar je met wat?",
          sub: "Rij: de echte maatsoort. Kolom: jouw antwoord.",
          empty: sigs.length && answered ? null : "Nog geen antwoorden om te vergelijken.",
          body: sigs.length && answered ? matrixTable(sigs, counts) : null,
          note: matrixNote,
        });
        sec.append(h("div", { class: "st-pair" }, perF, matrixF));
      }

      function matrixTable(sigs, counts) {
        const table = h("table", { class: "st-matrix", "data-st-hover": "" },
          h("caption", { class: "visually-hidden" }, "Verwisselingsmatrix: rijen zijn de echte maatsoort, kolommen jouw antwoord. Op de diagonaal staan de goede antwoorden."),
          h("thead", null,
            h("tr", null, h("td", { class: "st-mx-corner" }), h("th", { scope: "colgroup", colspan: String(sigs.length), class: "st-mx-axis" }, "Jouw antwoord →")),
            h("tr", null, h("th", { scope: "col", class: "st-mx-axis" }, "Echt ↓"), sigs.map((s) => h("th", { scope: "col", class: "num" }, s)))),
          h("tbody", null, sigs.map((a) => {
            const rowTotal = sigs.reduce((t, b) => t + counts[a][b], 0);
            return h("tr", null,
              h("th", { scope: "row", class: "num" }, a),
              sigs.map((b) => {
                const n = counts[a][b];
                const share = rowTotal ? n / rowTotal : 0;
                const diag = a === b;
                // Begrensd op 48%: tot daar blijft witte tekst ≥ 4,5:1 op zowel groen als rood (nagerekend)
                const mix = n ? Math.round(16 + 32 * share) : 0;
                const td = h("td", {
                  class: "st-mx-cell" + (diag ? " diag" : "") + (n ? "" : " zero"),
                  "data-a": a, "data-b": b, "data-n": String(n), "data-s": String(Math.round(share * 100)),
                },
                n ? h("b", { class: "num" }, String(n)) : h("span", { "aria-hidden": "true" }, "·"),
                n ? h("span", { class: "st-mx-pct num" }, Math.round(share * 100) + "%") : h("span", { class: "visually-hidden" }, "0"));
                if (n) td.style.background = "color-mix(in srgb, var(" + (diag ? "--ok" : "--bad") + ") " + mix + "%, var(--surface-2))";
                return td;
              }));
          })));
        table.addEventListener("pointerover", (e) => {
          const td = e.target.closest ? e.target.closest("td[data-a]") : null;
          if (!td) return;
          const a = td.getAttribute("data-a"), b = td.getAttribute("data-b"), n = Number(td.getAttribute("data-n"));
          const r = td.getBoundingClientRect();
          kit.show(tipBody("Echt " + a + " → jij zei " + b, [
            { value: n + "×", label: td.getAttribute("data-s") + "% van de " + a + "-rondes" },
          ], a === b ? "Goed geraden" : n ? "Verwisseld" : null), r.left + r.width / 2, r.top);
        });
        table.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") kit.hide(); });
        return h("div", { class: "st-matrix-wrap" }, table);
      }

      /* ----- Geschiedenis ----- */
      function renderHistory(el) {
        const mode = state.tab === "overzicht" ? null : state.tab;
        const src = mode ? data.by[mode] || [] : data.all;
        const list = src.slice().reverse();
        const shown = list.slice(0, state.histLimit);
        const what = (n) => (mode ? sessionWord(mode, n) : plural(n, "sessie", "sessies"));
        const sub = !list.length ? "Nog geen " + what(2) + "."
          : list.length === 1 ? "Je enige " + what(1) + "."
          : list.length <= shown.length ? "Al je " + list.length + " " + what(list.length) + ", nieuwste eerst."
          : "Je laatste " + shown.length + " van " + list.length + " " + what(list.length) + ", nieuwste eerst.";
        el.append(h("div", { class: "st-fig-head" }, h("div", { class: "st-fig-titles" },
          h("h2", { class: "st-h2", id: "st-hist-title", tabindex: "-1" }, "Geschiedenis"),
          h("p", { class: "st-sec-sub" }, sub))));
        if (!list.length) return;
        el.append(h("ol", { class: "st-hist" }, shown.map((v, idx) => histRow(v, idx))));
        if (list.length > shown.length) {
          el.append(h("div", { class: "st-more-row" }, h("button", {
            type: "button", class: "btn btn-sm st-more",
            onClick: () => {
              const from = state.histLimit;
              state.histLimit += 20;
              el.textContent = "";
              renderHistory(el);
              const btns = el.querySelectorAll(".st-hdel");
              if (btns[from]) btns[from].focus();
            },
          }, "Toon meer")));
        }
      }

      function histRow(v, idx) {
        const canDelete = (typeof v.id === "string" && v.id !== "") || isNum(v.id);
        const detail = detailText(v);
        const name = modeLabel(v.mode);
        return h("li", { class: "st-hrow", style: { "--mode": COLOR[v.mode] || "var(--text-3)" } },
          h("span", { class: "st-hdot", "aria-hidden": "true" }),
          h("div", { class: "st-hmain" },
            h("div", { class: "st-hname" },
              h("span", { class: "st-hmode" }, name),
              detail ? h("span", { class: "st-hdetail" }, detail) : null,
              v.demo ? h("span", { class: "badge st-demo" }, "voorbeeld") : null),
            h("div", { class: "st-hdate" }, dateTime(v.ts) + (v.durationMs ? " · " + App.ui.fmtDuration(v.durationMs) : ""))),
          h("div", { class: "st-hkey" }, keyText(v)),
          h("div", { class: "st-hscore" },
            h("span", { class: "visually-hidden" }, "score "),
            h("span", { class: "num" }, isNum(v.score) ? fmtNum(v.score) : "—")),
          canDelete
            ? h("button", {
              type: "button", class: "btn btn-ghost btn-icon st-hdel",
              "aria-label": "Verwijder " + (SESSION_WORD[v.mode] ? sessionWord(v.mode, 1) : "sessie " + name) + " van " + dateTime(v.ts), title: "Verwijderen",
              onClick: () => removeSession(v, idx),
            }, icon("trash", 18))
            : h("span", { class: "st-hdel-none" }));
      }

      async function removeSession(v, idx) {
        const name = modeLabel(v.mode);
        // confirm() geeft de focus niet terug; bij Annuleren zetten we hem zelf terug op de knop
        const back = document.activeElement;
        let ok = false;
        try {
          ok = await App.ui.confirm({
            title: "Sessie verwijderen?",
            text: name + " van " + dateTime(v.ts) + (isNum(v.score) ? " met score " + fmtNum(v.score) : "") + ". Dit kun je niet ongedaan maken.",
            ok: "Verwijderen",
            cancel: "Annuleren",
            danger: true,
          });
        } catch (e) { ok = false; }
        if (!alive) return;
        if (!ok) {
          if (back && back.isConnected && typeof back.focus === "function") back.focus({ preventScroll: true });
          return;
        }
        focusAfter = { kind: "hist", index: idx };
        App.store.deleteSession(v.id);
        App.ui.toast("Sessie verwijderd.", "ok");
      }

      /* ----- Sneltoetsen: 1–5 kiest wat je ziet ----- */
      const onKey = (e) => {
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target;
        if (t && (t.isContentEditable || (t.closest && t.closest("input, textarea, select")))) return;
        if (document.querySelector(".modal-back")) return;
        const i = "12345".indexOf(e.key);
        if (i < 0 || !tabsSeg) return;
        e.preventDefault();
        setTab(TABS[i]);
      };
      document.addEventListener("keydown", onKey);

      renderAll();

      return () => {
        alive = false;
        unsubscribe();
        clearTimeout(redrawTimer);
        redrawTimer = 0;
        document.removeEventListener("keydown", onKey);
        if (stickIO) { stickIO.disconnect(); stickIO = null; }
        kit.destroy();
      };
    },
  });

  /* ---------- Testhulp (niet in de interface) ----------
     App.dev.seedStats(n): n nep-sessies (standaard 80, hooguit 500) verdeeld over de vier oefeningen en de
     laatste 8 weken, precies volgens docs/CONTRACT.md en met demo: true. App.dev.clearSeed() haalt alleen die weer weg.
     Hooguit 500: 2000 nep-sessies zijn ±3,7 miljoen tekens, vlak onder de grens van localStorage. Lukt opslaan
     daarna niet meer, dan gaat ook een echte sessie verloren bij herladen. */
  const SEED_MAX = 500;
  function gauss(mu, sd) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function choice(a) { return a[Math.floor(Math.random() * a.length)]; }
  function weighted(pairs) {
    const total = pairs.reduce((t, p) => t + p[1], 0);
    let r = Math.random() * total;
    for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; }
    return pairs[pairs.length - 1][0];
  }
  const R2 = (v) => Math.round(v * 100) / 100;
  const R4 = (v) => Math.round(v * 1e4) / 1e4;
  function seedId(ts) { return "demo-" + ts.toString(36) + Math.random().toString(36).slice(2, 8); }

  const SEED_PATTERNS = [
    { id: "kwarten", name: "Kwarten", spb: 4, bar: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], hard: 0.8, w: 2 },
    { id: "achtsten", name: "Achtsten", spb: 4, bar: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], hard: 1, w: 4 },
    { id: "zestienden", name: "Zestienden", spb: 4, bar: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], hard: 1.3, w: 2 },
    { id: "syncopen", name: "Syncopen", spb: 4, bar: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0], hard: 1.35, w: 3 },
    { id: "triolen", name: "Triolen", spb: 3, bar: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], hard: 1.2, w: 2 },
    { id: "eigen", name: "Eigen ritme", spb: 4, bar: null, hard: 1.15, w: 1 },
  ];

  function seedRitme(ts, p) {
    const pat = weighted(SEED_PATTERNS.map((x) => [x, x.w]));
    const bar = pat.bar ? pat.bar.slice() : Array.from({ length: 16 }, (_, i) => (i === 0 || Math.random() < 0.4 ? 1 : 0));
    const spb = pat.spb, beatsPerBar = 4;
    const bpm = 5 * rint(14, 28);
    const playBars = choice([2, 4, 4, 8]);
    const introBars = choice([1, 2, 2]);
    const guide = choice(["metronoom", "metronoom", "ritme", "stil"]);
    const stepMs = 60000 / bpm / spb;
    const tempoF = 1 + (bpm - 100) / 250;
    const guideF = guide === "stil" ? 1.25 : guide === "ritme" ? 0.9 : 1;
    const sd = Math.max(6, (30 - 16 * p) * pat.hard * tempoF * guideF);
    const bias = 10 - 7 * p + gauss(0, 3);
    const missP = clamp((0.07 - 0.05 * p) * pat.hard, 0.005, 0.2);
    const lim = Math.min(150, stepMs * 0.45);
    const hits = [];
    let i = 0;
    for (let b = 0; b < playBars; b++) {
      bar.forEach((on, step) => {
        if (!on) return;
        const off = Math.random() < missP ? null : R1(clamp(gauss(bias, sd), -lim, lim));
        hits.push({ i: i++, bar: b, step, expectedMs: R1((b * bar.length + step) * stepMs), offsetMs: off });
      });
    }
    const offs = hits.map((x) => x.offsetMs).filter((x) => x !== null);
    const extras = Math.max(0, Math.round(gauss(1.6 - 1.3 * p, 1)));
    const matched = offs.length;
    const abs = offs.map(Math.abs);
    const stats = {
      expected: hits.length, matched, missed: hits.length - matched, extras,
      meanAbsMs: R1(mean(abs) || 0), meanMs: R1(mean(offs) || 0), stdMs: R1(std(offs) || 0), medianAbsMs: R1(median(abs) || 0),
      earlyPct: matched ? R2(offs.filter((o) => o < 0).length / matched) : 0,
      latePct: matched ? R2(offs.filter((o) => o > 0).length / matched) : 0,
    };
    return {
      id: seedId(ts), ts, version: 1, mode: "ritme", demo: true,
      durationMs: Math.round(((introBars + playBars) * beatsPerBar * 60000) / bpm + rint(600, 2400)),
      score: ritmeScoreFromHits(hits, extras),
      settings: { pattern: pat.id, patternName: pat.name, steps: bar, stepsPerBeat: spb, beatsPerBar, bpm, introBars, playBars, guide },
      hits, extras, stats,
    };
  }

  const SEED_ERRS = [[-1, 3], [1, 3], [-2, 2], [2, 2], [-3, 1], [3, 1], [4, 1], [-4, 0.8], [5, 1.2], [-5, 1.2], [6, 0.6]];
  const PC_EASE = [0.1, -0.12, 0.04, -0.1, 0.06, 0.02, -0.16, 0.08, -0.12, 0.1, -0.08, 0];

  function seedGehoor(ts, p) {
    const variant = Math.random() < 0.6 ? "absoluut" : "relatief";
    const pcs = Math.random() < 0.3 ? WHITE_PCS.slice() : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const nRounds = choice([10, 20, 20]);
    const settings = { lowMidi: 48, highMidi: 72, rounds: nRounds, pitchClasses: pcs };
    if (variant === "relatief") { settings.reference = choice(["elke-ronde", "eenmalig"]); settings.referenceMidi = 60; }
    const cands = [];
    for (let m = 48; m <= 72; m++) if (pcs.includes(pcOf(m))) cands.push(m);
    const rounds = [];
    const semitoneErrors = {};
    for (let r = 0; r < nRounds; r++) {
      const target = choice(cands);
      const pc = pcOf(target);
      let pOk = variant === "absoluut" ? 0.22 + 0.55 * p : 0.45 + 0.42 * p;
      pOk += PC_EASE[pc];
      if (variant === "relatief") {
        const dist = Math.abs(target - 60);
        if (dist > 7) pOk -= 0.08;
        if (dist % 12 === 6) pOk -= 0.1;
      }
      const correct = Math.random() < clamp(pOk + gauss(0, 0.04), 0.04, 0.97);
      let answerPc = pc;
      if (!correct) {
        for (let t = 0; t < 30; t++) {
          const e = weighted(SEED_ERRS);
          const a = pcOf(pc + e);
          if (pcs.includes(a) && a !== pc) { answerPc = a; break; }
        }
      }
      const ok = answerPc === pc;
      if (!ok) { const d = wrapSemi(answerPc - pc); semitoneErrors[String(d)] = (semitoneErrors[String(d)] || 0) + 1; }
      rounds.push({
        target, answerPc, correct: ok,
        referenceMidi: variant === "relatief" ? 60 : null,
        timeMs: Math.round(clamp(gauss(4300 - 2100 * p, 1000), 900, 15000)),
        replays: weighted([[0, 0.5 + 0.3 * p], [1, 0.35], [2, 0.15 - 0.1 * p]]),
      });
    }
    const correctN = rounds.filter((r) => r.correct).length;
    const accuracy = R4(correctN / nRounds);
    return {
      id: seedId(ts), ts, version: 1, mode: "gehoor", demo: true, variant,
      durationMs: rounds.reduce((t, r) => t + r.timeMs, 0) + nRounds * rint(1200, 2200),
      score: Math.round(accuracy * 100),
      settings, rounds,
      stats: { total: nRounds, correct: correctN, accuracy, meanTimeMs: Math.round(mean(rounds.map((r) => r.timeMs))), semitoneErrors },
    };
  }

  function seedBpm(ts, p) {
    const settings = { minBpm: 60, maxBpm: 180, rounds: 10, sound: choice(["click", "wood", "drums"]), beats: 8 };
    const rounds = [];
    for (let r = 0; r < settings.rounds; r++) {
      const actual = rint(settings.minBpm, settings.maxBpm);
      const sd = (1.5 + actual * 0.035) * (1.25 - 0.6 * p);
      const bias = -(actual - 110) * 0.03; // naar een 'prettig' middentempo toe trekken
      const guess = Math.round(actual + gauss(bias, sd));
      const diff = guess - actual;
      rounds.push({
        actual, guess, diff, pctErr: R2((Math.abs(diff) / actual) * 100),
        replays: weighted([[0, 0.55], [1, 0.32], [2, 0.13]]),
        timeMs: Math.round(clamp(gauss(6200 - 1600 * p, 1500), 2000, 20000)),
      });
    }
    const diffs = rounds.map((r) => r.diff);
    return {
      id: seedId(ts), ts, version: 1, mode: "bpm", demo: true,
      durationMs: rounds.reduce((t, r) => t + r.timeMs + Math.round((settings.beats * 60000) / r.actual), 0),
      score: Math.round(mean(rounds.map((r) => Math.max(0, 100 - 10 * r.pctErr)))),
      settings, rounds,
      stats: {
        meanAbsDiff: R1(mean(diffs.map(Math.abs))), meanDiff: R1(mean(diffs)), meanPctErr: R2(mean(rounds.map((r) => r.pctErr))),
        within2: R2(diffs.filter((d) => Math.abs(d) <= 2).length / diffs.length),
        within5: R2(diffs.filter((d) => Math.abs(d) <= 5).length / diffs.length),
      },
    };
  }

  const SEED_SIGS = {
    makkelijk: ["3/4", "4/4"],
    gemiddeld: ["2/4", "3/4", "4/4", "6/8"],
    moeilijk: ["3/4", "4/4", "5/4", "6/8", "7/8", "12/8"],
  };
  const SEED_CONF = { "2/4": ["4/4", "6/8"], "3/4": ["6/8", "4/4"], "4/4": ["2/4", "12/8", "3/4"], "5/4": ["4/4", "3/4"], "6/8": ["3/4", "12/8"], "7/8": ["6/8", "4/4"], "12/8": ["6/8", "4/4"] };

  function seedMaat(ts, p) {
    const difficulty = weighted([["makkelijk", 1], ["gemiddeld", 2], ["moeilijk", 1.2]]);
    const signatures = SEED_SIGS[difficulty];
    const base = { makkelijk: 0.7, gemiddeld: 0.55, moeilijk: 0.4 }[difficulty];
    const rounds = [];
    for (let r = 0; r < 10; r++) {
      const actual = choice(signatures);
      const correct = Math.random() < clamp(base + 0.3 * p + gauss(0, 0.05), 0.05, 0.97);
      let answer = actual;
      if (!correct) {
        const near = (SEED_CONF[actual] || []).filter((s) => signatures.includes(s));
        const others = signatures.filter((s) => s !== actual);
        answer = near.length && Math.random() < 0.8 ? near[0] : choice(others.length ? others : [actual]);
      }
      rounds.push({ actual, answer, correct: answer === actual, bpm: rint(72, 140), replays: weighted([[0, 0.55], [1, 0.33], [2, 0.12]]), timeMs: Math.round(clamp(gauss(5200 - 1500 * p, 1300), 1500, 18000)) });
    }
    const correctN = rounds.filter((r) => r.correct).length;
    const accuracy = R4(correctN / rounds.length);
    return {
      id: seedId(ts), ts, version: 1, mode: "maatsoort", demo: true,
      durationMs: rounds.reduce((t, r) => t + r.timeMs, 0) + rounds.length * rint(4000, 8000),
      score: Math.round(accuracy * 100),
      settings: { signatures, difficulty, rounds: rounds.length },
      rounds,
      stats: { total: rounds.length, correct: correctN, accuracy },
    };
  }

  App.dev = App.dev || {};
  App.dev.seedStats = function (n) {
    const count = Math.max(1, Math.min(SEED_MAX, Math.round(num(n) || 80)));
    if (num(n) > SEED_MAX) console.warn("Maatwerk: seedStats maakt er hooguit " + SEED_MAX + ".");
    const now = Date.now();
    const today = startOfDay(now);
    const first = addDays(today, -55);
    // Kies oefendagen; de laatste drie dagen altijd, zodat er een reeks te zien is
    const days = [];
    for (let d = 55; d >= 0; d--) if (d <= 2 || Math.random() < 0.5) days.push(addDays(today, -d));
    const perDay = days.map((d, i) => (i >= days.length - 3 && count >= 3 ? 1 : 0));
    for (let left = count - sum(perDay); left > 0; left--) perDay[Math.floor(Math.random() * days.length)]++;
    const stamps = [];
    days.forEach((day, i) => {
      for (let k = 0; k < perDay[i]; k++) {
        let ts = day + rint(9 * 60, 22 * 60 + 30) * 60000 + rint(0, 59) * 1000;
        if (ts > now - 60000) ts = Math.max(day + 1000, now - rint(2, 120) * 60000);
        stamps.push(ts);
      }
    });
    stamps.sort((a, b) => a - b);
    const span = Math.max(1, now - first);
    const list = stamps.map((ts) => {
      const p = clamp((ts - first) / span + gauss(0, 0.06), 0, 1);
      const mode = weighted([["ritme", 0.34], ["gehoor", 0.26], ["bpm", 0.2], ["maatsoort", 0.2]]);
      if (mode === "ritme") return seedRitme(ts, p);
      if (mode === "gehoor") return seedGehoor(ts, p);
      if (mode === "bpm") return seedBpm(ts, p);
      return seedMaat(ts, p);
    });
    const added = App.store.importJSON(JSON.stringify({ app: "maatwerk", sessions: list }));
    console.info("Maatwerk: " + added + " voorbeeldsessies toegevoegd (demo: true). Weghalen: App.dev.clearSeed()");
    return added;
  };
  /* In één keer: alles wissen en de echte sessies terugzetten (2 keer opslaan in plaats van één keer per
     sessie, en één melding per stap aan de abonnees). id en ts blijven gewoon behouden. */
  App.dev.clearSeed = function () {
    const all = App.store.sessions();
    const demo = all.filter((s) => s && s.demo === true);
    if (!demo.length) { console.info("Maatwerk: geen voorbeeldsessies gevonden."); return 0; }
    const keep = all.filter((s) => !(s && s.demo === true));
    // importJSON slaat records zonder mode, ts of met een dubbel id over; dan liever per stuk verwijderen
    const safe = keep.every((s) => s && s.mode && s.ts && s.id) && new Set(keep.map((s) => s.id)).size === keep.length;
    if (safe) {
      App.store.clearSessions();
      if (keep.length) App.store.importJSON(JSON.stringify({ app: "maatwerk", sessions: keep }));
    } else {
      demo.forEach((s) => { if (s.id != null && s.id !== "") App.store.deleteSession(s.id); });
    }
    console.info("Maatwerk: " + demo.length + " voorbeeldsessies verwijderd.");
    return demo.length;
  };
  /* Alleen voor losse tests van de rekenlogica */
  App.dev.statsCalc = { normalize, movingAvg, compareLast, longestStreak, wrapSemi, niceMax, ticks, fmtNum, fmtSigned, ritmeScoreFromHits };
})();
