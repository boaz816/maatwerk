/* Maatwerk — Instellingen: geluid, timing kalibreren, notennamen, je gegevens en "over".
   Eigen klassen beginnen met .in- (stijl in css/modes/instellingen.css).
   Woordgebruik op deze pagina: een "tel" is het geluid dat Maatwerk afspeelt, een "tik" is wat jij doet. */
(function () {
  const { h, icon } = App.ui;

  /* --- rekenkern --- */
  /* Vaste waarden van de kalibratie. */
  const CAL = {
    bpm: 90,
    countIn: 4,            // eerste tellen = aftellen (met accent), tellen niet mee
    total: 20,             // totaal aantal tellen
    maxAbsMs: 300,         // verder dan dit van elke tel af = buiten de meetgrens
    maxFromMedianMs: 100,  // zoveel naast je eigen mediaan = losse misser, telt ook niet mee
    minUsable: 8,          // minimaal aantal bruikbare tikken
    maxSpreadMs: 30,       // meer spreiding = niet regelmatig genoeg
    greatSpreadMs: 15,     // tot hier is het "heel regelmatig"
    minClipped: 2,         // zoveel tikken net over de meetgrens bij je eigen groepje = meting afgeknot
    limitMs: 300,          // bereik van de correctie (−300..+300)
  };

  function median(values) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* Spreiding: standaardafwijking van een steekproef (n − 1). */
  function stdDev(values) {
    if (values.length < 2) return null;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sq = values.reduce((a, b) => a + (b - mean) * (b - mean), 0);
    return Math.sqrt(sq / (values.length - 1));
  }

  /* Koppel een tik aan de dichtstbijzijnde geplande tel.
     baseMs = afwijking ten opzichte van tel 0, intervalMs = afstand tussen de tellen. */
  function nearestBeat(baseMs, intervalMs, count) {
    const index = Math.max(0, Math.min(count - 1, Math.round(baseMs / intervalMs)));
    return { index, offsetMs: baseMs - index * intervalMs };
  }

  /* Afstand tussen twee afwijkingen, met de tel ernaast meegerekend:
     +340 ms na tel 5 is hetzelfde moment als −327 ms vóór tel 6 (bij 90 bpm). */
  function beatDistance(a, b, intervalMs) {
    const d = a - b;
    return d - intervalMs * Math.round(d / intervalMs);
  }

  /* Werk een meting uit.
     offsets: per meettel de afwijking in ms, of null (geen tik).
     opts.far: afwijkingen van tikken die buiten de meetgrens vielen (die tellen nooit mee).
     Stappen: tikken buiten de meetgrens vallen af; daarna losse missers ver naast je eigen mediaan.
     Het oordeel wordt strenger als er veel missers afvallen (dan lijkt de spreiding te mooi) of als
     tikken van je eigen groepje net over de meetgrens vallen (dan is de waarde afgeknot). */
  function analyzeTaps(offsets, opts) {
    const o = opts || {};
    const c = o.cfg || CAL;
    const beatMs = 60000 / c.bpm;
    const far = (o.far || []).filter((v) => typeof v === "number" && isFinite(v));
    const present = [];
    const outliers = [];
    offsets.forEach((v, i) => {
      if (typeof v !== "number" || !isFinite(v)) return;
      if (Math.abs(v) > c.maxAbsMs) { outliers.push(i); far.push(v); }
      else present.push({ i, v });
    });
    const first = median(present.map((p) => p.v));
    const kept = present.filter((p) => Math.abs(p.v - first) <= c.maxFromMedianMs);
    const rejected = present.length - kept.length;
    present.forEach((p) => { if (!kept.includes(p)) outliers.push(p.i); });
    outliers.sort((a, b) => a - b);
    const values = kept.map((p) => p.v);
    const n = values.length;
    const med = median(values);
    const sd = stdDev(values);
    // Tikken buiten de grens die eigenlijk bij je groepje horen (vlak achter de grens)
    const clipped = med == null ? 0 : far.filter((v) => Math.abs(beatDistance(v, med, beatMs)) <= c.maxFromMedianMs).length;
    const maxRejected = Math.max(2, Math.round(present.length * 0.15));
    let verdict;
    if (n < c.minUsable) verdict = "few";
    else if (rejected > maxRejected) verdict = "scattered";
    else if (sd > c.maxSpreadMs) verdict = "irregular";
    else if (clipped >= c.minClipped) verdict = "edge";
    else if (sd <= c.greatSpreadMs && rejected <= 1) verdict = "great";
    else verdict = "good";
    return {
      n,
      total: offsets.length,
      missed: offsets.filter((v) => v == null).length,
      present: present.length,
      rejected,
      clipped,
      outliers,
      median: med,
      sd,
      value: med == null ? null : Math.max(-c.limitMs, Math.min(c.limitMs, Math.round(med))) || 0,
      verdict,
    };
  }
  /* --- einde rekenkern --- */

  const EXERCISES = [
    { id: "ritme", title: "Ritme", color: "var(--c-ritme)" },
    { id: "gehoor", title: "Gehoor", color: "var(--c-gehoor)" },
    { id: "bpm", title: "BPM", color: "var(--c-bpm)" },
    { id: "maatsoort", title: "Maatsoort", color: "var(--c-maat)" },
  ];

  const NAME_STYLES = [
    { value: "sharp", main: "Internationaal", sub: "C♯" },
    { value: "flat", main: "Mollen", sub: "D♭" },
    { value: "nl", main: "Nederlands", sub: "Cis, Es, Bes" },
  ];

  /* Grootste bestand dat we inlezen; de opslag van een browser is meestal maar ~5 MB. */
  const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
  /* Grootste tijdstempel die een datum nog aankan. */
  const MAX_TS = 8.64e15;

  /* ---------- Kleine hulpjes ---------- */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const fmtMs = (ms, unit = true) => App.ui.fmtMs(ms, unit);

  function validTs(ts) { return typeof ts === "number" && isFinite(ts) && ts > 0 && ts < MAX_TS; }

  /* Datum als tekst, of null als het tijdstempel niet klopt (nooit een fout). */
  function safeDate(ts) {
    if (!validTs(ts)) return null;
    try { return App.ui.fmtDate(ts); } catch (e) { return null; }
  }

  /* Een sessie die de rest van Maatwerk veilig kan lezen: met een oefening en een echt tijdstempel. */
  function isUsableSession(s) {
    return !!s && typeof s === "object" && typeof s.mode === "string" && s.mode.length > 0 && validTs(s.ts);
  }

  /* Alleen echte typvelden; een schuif of knop met focus mag de spatie niet opeten. */
  const NON_TEXT_INPUT = /^(range|checkbox|radio|button|submit|reset|file|color|image)$/i;
  function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    const t = el.tagName;
    if (t === "INPUT") return !NON_TEXT_INPUT.test(el.type || "");
    return t === "TEXTAREA" || t === "SELECT" || !!el.isContentEditable;
  }

  /* Start een CSS-animatie opnieuw (klasse eraf, herberekenen, klasse erop). */
  function restartAnim(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  /* Schuif een element rustig in beeld als het (deels) buiten het scherm staat.
     De ruimte voor de onderbalk op mobiel staat als scroll-margin in de CSS. */
  function scrollIntoViewSoft(el) {
    if (!el || typeof el.scrollIntoView !== "function") return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try { el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }); } catch (e) { /* oude browser */ }
  }

  function modeTitle(id) {
    const def = App.modes && App.modes[id];
    const known = EXERCISES.find((e) => e.id === id);
    return (def && (def.nav || def.title)) || (known && known.title) || String(id);
  }

  function exportName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `maatwerk-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
  }

  function toneClass(v) { return Math.abs(v) < 5 ? "is-zero" : v < 0 ? "is-early" : "is-late"; }
  function sideWord(v) { return Math.abs(v) < 5 ? "precies op de tel" : v < 0 ? "vóór de tel" : "na de tel"; }

  function currentLatency() {
    const v = Number(App.store.getSetting("latencyMs", 0));
    return isFinite(v) ? clamp(Math.round(v), -CAL.limitMs, CAL.limitMs) : 0;
  }

  /* Proef of de browser nog zoveel tekens extra kan bewaren: schrijf even een proefsleutel en haal
     hem meteen weer weg. Zo zeggen we nooit "toegevoegd" als het na herladen weg zou zijn.
     'ok' = past, 'full' = opslag vol, 'blocked' = de browser bewaart helemaal niets. */
  function storageRoom(chars) {
    let ls = null;
    try { ls = window.localStorage; } catch (e) { return "blocked"; }
    if (!ls) return "blocked";
    const key = "maatwerk.ruimteproef";
    try {
      try { ls.setItem(key, "x"); } catch (e) { return "blocked"; }
      try { ls.setItem(key, "x".repeat(Math.max(1, chars))); return "ok"; } catch (e) { return "full"; }
    } finally {
      try { ls.removeItem(key); } catch (e) { /* negeren */ }
    }
  }

  /* Eén instellingenblok: uitleg links (of boven), paneel rechts. */
  function section({ id, iconName, title, text, extra, key }, ...panelChildren) {
    const texts = text == null ? [] : Array.isArray(text) ? text : [text];
    return h("section", { class: "in-section", "aria-labelledby": "in-h-" + id },
      h("div", { class: "in-aside" },
        h("div", { class: "in-aside-head" },
          h("span", { class: "in-icon" }, icon(iconName, 20)),
          h("h2", { id: "in-h-" + id }, title)
        ),
        texts.map((t) => h("p", null, t)),
        extra || null
      ),
      h("div", { class: "panel in-panel" + (key ? " in-panel-key" : "") }, ...panelChildren)
    );
  }

  App.registerMode({
    id: "instellingen",
    title: "Instellingen",
    nav: "Instellingen",
    description: "Geluid, timing kalibreren, notennamen en je gegevens.",
    mount(root) {
      let disposed = false;
      const cleanups = [];
      const timeouts = new Set();
      const intervals = new Set();
      const blobUrls = new Set();

      function listen(target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        cleanups.push(() => target.removeEventListener(type, fn, opts));
      }
      function later(fn, ms) {
        const id = setTimeout(() => { timeouts.delete(id); if (!disposed) fn(); }, ms);
        timeouts.add(id);
        return id;
      }
      function every(fn, ms) {
        const id = setInterval(() => { if (!disposed) fn(); }, ms);
        intervals.add(id);
        return id;
      }

      /* Zet het geluid aan (moet vanuit een klik). Geeft false als dat niet lukt.
         Op iOS kan resume() blijven hangen (na een telefoontje of Siri); wacht daarom hooguit 1,5 s. */
      async function audioReady() {
        try {
          await Promise.race([App.audio.ready(), new Promise((res) => later(res, 1500))]);
        } catch (e) { console.warn("Geluid starten mislukt", e); }
        if (disposed) return false;
        const ctx = App.audio.context;
        if (!ctx || ctx.state !== "running") {
          App.ui.toast("Geluid kon niet starten. Probeer het nog een keer.", "bad");
          return false;
        }
        return true;
      }

      /* Kalibratiestaat; de andere blokken kijken hiernaar zodat er niets door de meting heen klinkt. */
      let phase = "idle"; // idle | starting | run | result
      let run = null;
      let rafId = 0;
      let resultUi = null; // knoppen van een uitslag met een bruikbare waarde (zie syncResultUi)

      /* ================= 1. Geluid ================= */
      let testHandle = null;
      let volTimer = null;
      let volPending = null;

      /* Volume niet bij elke schuifbeweging opslaan, maar hooguit elke 120 ms. */
      function flushVolume() {
        if (volTimer) { clearTimeout(volTimer); volTimer = null; }
        if (volPending != null) { const v = volPending; volPending = null; App.audio.setVolume(v); }
      }
      function queueVolume(v) {
        volPending = v;
        if (!volTimer) volTimer = setTimeout(() => { volTimer = null; flushVolume(); }, 120);
      }
      const pctLabel = (v) => (v <= 0 ? "Stil" : Math.round(v * 100) + "%");

      const rawVol = Number(App.store.getSetting("volume", 0.8));
      const vol0 = isFinite(rawVol) ? clamp(rawVol, 0, 1) : 0.8;
      const volOut = h("output", { class: "num in-vol-val", "aria-hidden": "true" }, pctLabel(vol0));
      const volSlider = App.ui.slider({
        value: Math.round(vol0 * 100), min: 0, max: 100, step: 1, ariaLabel: "Volume",
        onInput: (v) => {
          volOut.textContent = pctLabel(v / 100);
          volSlider.setAttribute("aria-valuetext", pctLabel(v / 100));
          queueVolume(v / 100);
        },
      });
      volSlider.setAttribute("aria-valuetext", pctLabel(vol0));
      volSlider.addEventListener("change", () => { flushVolume(); previewVolume(); });

      function currentVolume() { return clamp(Number(volSlider.value) / 100, 0, 1) || 0; }

      /* Staat het volume op stil? Zeg het dan, in plaats van geluidloos te starten. */
      function warnIfSilent() {
        if (currentVolume() > 0) return false;
        App.ui.toast("Je volume staat op stil. Zet de schuif hoger.", "bad");
        return true;
      }

      /* Eén zachte tel na het loslaten van de schuif, zodat je het nieuwe volume meteen hoort. */
      function previewVolume() {
        if (phase === "run" || phase === "starting" || testHandle) return;
        if (currentVolume() <= 0) return;
        try { App.audio.sequence([{ t: 0, kind: "click" }], { lead: 0.08 }); } catch (e) { /* geen geluid mogelijk */ }
      }

      const indTick = h("span", { class: "in-ind" }, h("i"), "Metronoom");
      const indNote = h("span", { class: "in-ind" }, h("i"), "Pianonoot");
      const testBtn = h("button", { type: "button", class: "btn", onClick: testSound }, icon("play", 18), "Test geluid");

      async function testSound() {
        if (phase === "run" || phase === "starting") return;
        if (warnIfSilent()) return;
        if (!(await audioReady())) return;
        if (phase === "run" || phase === "starting") return;
        if (testHandle) testHandle.stop();
        testBtn.classList.add("is-playing");
        const handle = App.audio.sequence([
          { t: 0, kind: "click", accent: true, ind: "tick" },
          { t: 0.45, kind: "click", ind: "tick" },
          { t: 0.95, kind: "note", midi: 60, dur: 1.8, ind: "note" },
        ], {
          lead: 0.08, tail: 1.0,
          onEvent: (ev) => restartAnim(ev.ind === "note" ? indNote : indTick, "is-on"),
        });
        testHandle = handle;
        handle.done.then(() => {
          if (testHandle !== handle) return;
          testHandle = null;
          if (!disposed) testBtn.classList.remove("is-playing");
        });
        refreshLatency();
      }

      const soundSection = section(
        { id: "geluid", iconName: "volume", title: "Geluid", text: "Hoe hard Maatwerk klinkt. Het volume van je apparaat telt daar nog bij op." },
        App.ui.field("Volume", h("div", { class: "in-vol" }, volSlider, volOut)),
        h("div", { class: "in-test" }, testBtn, h("div", { class: "in-inds", "aria-hidden": "true" }, indTick, indNote)),
        h("p", { class: "in-hint" }, "Hoor je niets? Kijk of je apparaat of dit tabblad niet op stil staat. Op een iPhone moet de stil-schakelaar uit.")
      );

      /* ================= 2. Timing kalibreren ================= */
      const T_MS = 60000 / CAL.bpm;
      const MEASURE = CAL.total - CAL.countIn;
      const LEAD_S = 1.2; // stilte vóór het aftellen: tijd om je hand klaar te leggen (en voor een schermlezer)
      const SECONDS = Math.round((CAL.total * T_MS + 1500) / 1000);

      const stage = h("div", { class: "in-stage" });
      const calBadge = h("span", { class: "badge in-cal-badge" });
      const corrHint = h("p", { class: "field-hint in-corr-hint" });
      const corrStepper = App.ui.stepper({
        value: currentLatency(), min: -CAL.limitMs, max: CAL.limitMs, step: 1, bigStep: 10, unit: "ms",
        format: (v) => fmtMs(v, false), ariaLabel: "Correctie in milliseconden",
        onChange: (v) => { App.store.setSetting("latencyMs", v); syncLatencyUi(); },
      });
      const resetBtn = h("button", {
        type: "button", class: "btn btn-ghost",
        onClick: () => {
          if (currentLatency() === 0) return;
          // De knop gaat zo uit; zet de focus eerst op de teller, anders valt hij weg
          if (document.activeElement === resetBtn) corrStepper.focus();
          App.store.setSetting("latencyMs", 0);
          App.store.setSetting("latencyAt", null);
          corrStepper.value = 0;
          syncLatencyUi();
          App.ui.toast("De correctie staat weer op 0 ms.");
        },
      }, icon("replay", 18), "Terug naar 0");
      const browserVal = h("span", { class: "num in-info-val" }, "—");
      const browserSub = h("p", { class: "in-info-sub" });

      function syncLatencyUi() {
        if (disposed) return;
        const v = currentLatency();
        const isSet = App.store.getSetting("latencyMs", null) !== null;
        const when = safeDate(Number(App.store.getSetting("latencyAt", 0)));
        calBadge.className = "badge in-cal-badge " + (isSet ? "is-set" : "is-unset");
        calBadge.textContent = isSet ? "Correctie " + fmtMs(v) + (when ? " · gemeten " + when : "") : "Nog niet gekalibreerd";
        if (v > 0) corrHint.textContent = `Maatwerk trekt ${v} ms af van elke timingmeting.`;
        else if (v < 0) corrHint.textContent = `Maatwerk telt ${Math.abs(v)} ms op bij elke timingmeting.`;
        else corrHint.textContent = "Geen correctie: metingen tellen zoals ze zijn.";
        resetBtn.disabled = v === 0;
        syncResultUi();
      }

      function refreshLatency() {
        if (disposed) return;
        const ctx = App.audio.context;
        if (!ctx) {
          browserVal.textContent = "—";
          browserSub.textContent = "Nog onbekend: dit zie je zodra er een geluid heeft geklonken.";
          return;
        }
        browserVal.textContent = Math.round(App.audio.outputLatency() * 1000) + " ms";
        browserSub.textContent = "";
      }

      /* Tijdlijn: 4 aftel-tellen en 4 maten van 4 meettellen. */
      function buildTimeline() {
        const countCells = [];
        for (let i = 0; i < CAL.countIn; i++) countCells.push(h("span", { class: "in-cnt num" }, String(i + 1)));
        const cells = [];
        const bars = [];
        for (let b = 0; b < MEASURE / 4; b++) {
          const inBar = [];
          for (let j = 0; j < 4; j++) {
            const c = h("span", { class: "in-cell num" });
            cells.push(c);
            inBar.push(c);
          }
          bars.push(h("div", { class: "in-bar" },
            h("span", { class: "in-bar-label" }, "Maat " + (b + 1)),
            h("div", { class: "in-bar-cells" }, inBar)
          ));
        }
        const el = h("div", { class: "in-tl", "aria-hidden": "true" },
          h("div", { class: "in-tl-count" }, h("span", { class: "in-tl-label" }, "Aftellen"), h("div", { class: "in-cnts" }, countCells)),
          h("div", { class: "in-bars" }, bars)
        );
        return { el, countCells, cells };
      }

      function paintCell(cell, v, fresh) {
        cell.className = "in-cell num";
        if (v == null) {
          cell.textContent = "—";
          cell.classList.add("is-miss");
          cell.title = "Geen tik op deze tel";
          return;
        }
        cell.textContent = fmtMs(v, false);
        cell.classList.add(toneClass(v));
        if (fresh) cell.classList.add("is-new");
        cell.title = fmtMs(v) + " " + sideWord(v);
      }

      function paintFar(cell) {
        cell.className = "in-cell num is-far";
        cell.textContent = "×";
        cell.title = "Te ver van de tel af, niet meegeteld";
      }

      function stageHead() {
        return h("div", { class: "in-stage-head" },
          h("h3", null, "Meet je vertraging"),
          h("span", { class: "in-meta" }, `${CAL.total} tellen · ${CAL.bpm} bpm · ongeveer ${SECONDS} s`)
        );
      }

      function tip(iconName, content) {
        return h("li", null, icon(iconName, 18), h("span", null, content));
      }

      function renderIdle() {
        phase = "idle";
        resultUi = null;
        const tl = buildTimeline();
        const startBtn = h("button", { type: "button", class: "btn btn-primary btn-lg", onClick: () => startCal(startBtn) },
          icon("play", 20), "Start kalibratie");
        stage.replaceChildren(
          stageHead(),
          tl.el,
          h("div", { class: "in-intro" },
            h("p", null, `Je hoort eerst ${CAL.countIn} hogere aftel-tellen en daarna ${MEASURE} gewone tellen. Tik op elke gewone tel precies mee.`),
            h("ul", { class: "in-tips" },
              tip("headphones", "Gebruik de koptelefoon of speakers waarmee je straks oefent."),
              tip("target", "Luister en kijk niet naar het scherm. Ogen dicht mag."),
              tip("keyboard", [h("span", { class: "kbd" }, "Spatie"), " of het tikvlak om te tikken, ", h("span", { class: "kbd" }, "Esc"), " om te stoppen."])
            ),
            h("div", { class: "in-intro-go" }, startBtn)
          )
        );
        return startBtn;
      }

      async function startCal(btn) {
        if (phase === "run" || phase === "starting") return;
        if (warnIfSilent()) return;
        const before = phase;
        phase = "starting";
        if (btn) btn.disabled = true;
        const ok = await audioReady();
        if (disposed) return;
        if (!ok) {
          phase = before;
          if (btn) {
            btn.disabled = false;
            if (btn.isConnected) btn.focus();
          }
          return;
        }
        if (testHandle) { testHandle.stop(); testHandle = null; testBtn.classList.remove("is-playing"); }
        resultUi = null;

        const tl = buildTimeline();
        const padBig = h("div", { class: "in-pad-big num" }, "Luister");
        const padSub = h("div", { class: "in-pad-sub" }, "Het aftellen begint zo");
        // Kort label: een schermlezer moet klaar zijn vóór het aftellen begint
        const pad = h("div", { class: "in-pad", role: "button", tabindex: "0", "aria-label": "Tikvlak" },
          h("div", { class: "in-pad-inner" }, padBig, padSub));
        const prog = h("i");
        const stopBtn = h("button", { type: "button", class: "btn btn-ghost", onClick: () => stopCal(true) }, icon("stop", 16), "Stoppen");
        stage.replaceChildren(
          stageHead(),
          tl.el,
          h("div", { class: "in-prog", "aria-hidden": "true" }, prog),
          pad,
          h("div", { class: "in-run-foot" },
            h("span", { class: "in-hint" }, h("span", { class: "kbd" }, "Spatie"), " of tik op het vlak · ", h("span", { class: "kbd" }, "Esc"), " stopt"),
            stopBtn
          )
        );

        const r = {
          tl, pad, padBig, padSub, prog,
          taps: new Array(MEASURE).fill(null),
          far: new Array(MEASURE).fill(false), // tik in de buurt, maar meer dan maxAbsMs ernaast
          farOffsets: [],                      // afwijkingen van die tikken, voor de rekenkern
          measured: 0, outside: 0, doubles: 0, countTaps: 0, finalized: 0,
          startTime: 0, handle: null,
        };
        pad.addEventListener("pointerdown", (e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          e.preventDefault();
          tap(r, e);
        });

        const events = [];
        for (let i = 0; i < CAL.total; i++) {
          events.push({ t: (i * T_MS) / 1000, kind: "click", accent: i < CAL.countIn, beat: i });
        }
        const handle = App.audio.sequence(events, { lead: LEAD_S, tail: 0.45, onEvent: (ev) => onBeat(r, ev) });
        r.handle = handle;
        r.startTime = handle.startTime;
        run = r;
        phase = "run";
        // Speelstand: op de telefoon verdwijnt de onderbalk, zodat je hem niet per ongeluk raakt
        App.setPlaying(true);
        pad.focus({ preventScroll: true });
        scrollIntoViewSoft(pad);
        loop();
        handle.done.then((res) => {
          if (disposed || run !== r) return;
          if (res && res.completed) finishCal(r);
        });
        refreshLatency();
      }

      /* Rond het moment dat je een tel hoort. Alleen het aftellen krijgt beeld:
         tijdens het meten wil je op je oren tikken, niet op je ogen. */
      function onBeat(r, ev) {
        if (run !== r) return;
        if (ev.beat < CAL.countIn) {
          r.tl.countCells.forEach((c, i) => c.classList.toggle("is-lit", i <= ev.beat));
          restartAnim(r.tl.countCells[ev.beat], "is-now");
          r.padBig.className = "in-pad-big num";
          r.padBig.textContent = String(ev.beat + 1);
          r.padSub.textContent = ev.beat === CAL.countIn - 1 ? "Nu meetikken" : "Aftellen";
        } else if (ev.beat === CAL.countIn && r.measured === 0) {
          r.padBig.className = "in-pad-big";
          r.padBig.textContent = "Tik mee";
          r.padSub.textContent = "Op elke tel, op je gehoor";
        }
      }

      function tap(r, e) {
        if (run !== r || phase !== "run") return;
        restartAnim(r.pad, "is-hit");
        const base = App.audio.rawOffsetMs(e, r.startTime);
        const { index, offsetMs } = nearestBeat(base, T_MS, CAL.total);
        if (index < CAL.countIn) {
          r.countTaps++;
          if (r.measured === 0) r.padSub.textContent = "Dit is nog het aftellen: tik pas na de 4";
          return;
        }
        const k = index - CAL.countIn;
        if (Math.abs(offsetMs) > CAL.maxAbsMs) {
          r.outside++;
          r.farOffsets.push(offsetMs);
          if (r.taps[k] == null) { r.far[k] = true; paintFar(r.tl.cells[k]); }
          r.padBig.className = "in-pad-big num is-off";
          r.padBig.textContent = "—";
          r.padSub.textContent = "Te ver van een tel af, niet meegeteld";
          return;
        }
        if (r.taps[k] != null) { r.doubles++; return; } // tweede tik op dezelfde tel: de eerste telt
        r.taps[k] = offsetMs;
        r.measured++;
        paintCell(r.tl.cells[k], offsetMs, true);
        r.padBig.className = "in-pad-big num " + toneClass(offsetMs);
        r.padBig.textContent = fmtMs(offsetMs);
        r.padSub.textContent = `${sideWord(offsetMs)} · ${r.measured} van ${MEASURE} gemeten`;
      }

      function loop() {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(frame);
      }

      /* Elk beeldje: voortgangsbalk bijwerken en tellen waarvan het venster voorbij is als gemist tonen. */
      function frame() {
        rafId = 0;
        const r = run;
        if (!r || phase !== "run" || disposed) return;
        const heard = App.audio.now() - App.audio.outputLatency();
        const totalS = ((CAL.total - 1) * T_MS + CAL.maxAbsMs) / 1000;
        r.prog.style.transform = `scaleX(${clamp((heard - r.startTime) / totalS, 0, 1)})`;
        while (r.finalized < MEASURE) {
          const due = r.startTime + ((r.finalized + CAL.countIn) * T_MS + CAL.maxAbsMs + 40) / 1000;
          if (heard < due) break;
          if (r.taps[r.finalized] == null && !r.far[r.finalized]) paintCell(r.tl.cells[r.finalized], null);
          r.finalized++;
        }
        rafId = requestAnimationFrame(frame);
      }

      function stopCal(byUser) {
        const r = run;
        if (!r) return;
        run = null;
        cancelAnimationFrame(rafId);
        rafId = 0;
        r.handle.stop();
        App.setPlaying(false);
        const btn = renderIdle();
        if (byUser) {
          App.ui.toast("Kalibratie gestopt. Er is niets veranderd.");
          btn.focus();
        }
      }

      function finishCal(r) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        for (let k = r.finalized; k < MEASURE; k++) if (r.taps[k] == null && !r.far[k]) paintCell(r.tl.cells[k], null);
        r.finalized = MEASURE;
        run = null;
        App.setPlaying(false);
        renderResult(r, analyzeTaps(r.taps, { far: r.farOffsets }));
      }

      function verdictFor(res, r) {
        if (res.verdict === "few" && r.measured === 0 && r.outside === 0 && r.countTaps === 0) {
          return {
            kind: "bad", iconName: "volume", title: "Geen tikken gemeten", silent: true,
            text: "Hoorde je de tellen? Zet je geluid aan (op een iPhone de stil-schakelaar uit) en probeer eerst Test geluid. Tik daarna met de spatiebalk of op het tikvlak.",
          };
        }
        if (res.verdict === "few" && r.outside >= 4) {
          return {
            kind: "bad", iconName: "x", title: "Je tikken lagen te ver van de tel af",
            text: `${plural(r.outside, "tik lag", "tikken lagen")} meer dan ${CAL.maxAbsMs} ms naast de tel. Tik precies op de tel die je hoort. Blijft dit zo, dan is je vertraging groter dan Maatwerk kan meten: gebruik dan een koptelefoon met draad.`,
          };
        }
        if (res.verdict === "few") {
          return {
            kind: "bad", iconName: "x", title: "Te weinig bruikbare tikken",
            text: `Je had ${plural(res.n, "bruikbare tik", "bruikbare tikken")}; er zijn er minstens ${CAL.minUsable} nodig. Tik op elke tel mee, ook als je twijfelt.`,
          };
        }
        const sd = Math.round(res.sd);
        const val = fmtMs(res.value);
        if (res.verdict === "scattered") {
          return {
            kind: "warn", iconName: "info", title: "Probeer het nog eens, je tikken waren niet regelmatig.",
            text: `Een deel van je tikken lag ver van de rest (${res.rejected} van ${res.present}), dus het is niet duidelijk wat je vertraging is. Luister eerst rustig een paar tellen en tik dan ontspannen mee.`,
          };
        }
        if (res.verdict === "irregular") {
          return {
            kind: "warn", iconName: "info", title: "Probeer het nog eens, je tikken waren niet regelmatig.",
            text: `Je vertraging lijkt ${val}, maar de spreiding was ±${sd} ms; pas onder de ${CAL.maxSpreadMs} ms is de meting betrouwbaar. Luister eerst rustig een paar tellen en tik dan ontspannen mee.`,
          };
        }
        if (res.verdict === "edge") {
          return {
            kind: "warn", iconName: "info", title: "Je vertraging ligt dicht bij de meetgrens",
            text: `${plural(res.clipped, "tik viel", "tikken vielen")} net buiten de grens van ${CAL.maxAbsMs} ms, dus ${val} is waarschijnlijk te laag. Gebruik liever een koptelefoon met draad. Kan dat niet, dan is deze waarde nog altijd beter dan geen correctie.`,
          };
        }
        if (res.verdict === "great") {
          return { kind: "ok", iconName: "check", title: "Heel regelmatig getikt", text: `Je vertraging is ${val}, met een spreiding van ±${sd} ms. Deze waarde is betrouwbaar.` };
        }
        return {
          kind: "ok", iconName: "check", title: "Regelmatig genoeg",
          text: `Je vertraging is ${val}, met een spreiding van ±${sd} ms. Deze waarde is bruikbaar; nog een keer meten maakt hem iets preciezer.`,
        };
      }

      function contextText(v) {
        if (v > 80) return `${fmtMs(v)} past bij een bluetooth-koptelefoon of draadloze speakers. Precies daarvoor is deze kalibratie.`;
        if (v > 25) return "Een beetje extra vertraging: normaal voor veel speakers en koptelefoons, plus je eigen reactie.";
        if (v >= -25) return "Bijna geen extra vertraging: je apparaat en je timing sluiten goed op elkaar aan.";
        return "Je tikt gemiddeld net vóór de tel; veel muzikanten lopen zo iets vooruit. De correctie vangt dat op. Wil je dat juist zien in je scores, laat de correctie dan op 0.";
      }

      function statTile(value, label, unit) {
        return h("div", { class: "stat-tile" }, App.ui.stat(value, label, unit));
      }

      /* Stippengrafiek: waar vielen je tikken ten opzichte van de tel (0)? */
      function buildPlot(r, res, showLine) {
        const pts = [];
        r.taps.forEach((v, i) => { if (v != null) pts.push({ v, out: res.outliers.includes(i) }); });
        if (!pts.length) return null;
        const vals = pts.map((p) => p.v).concat(0);
        if (res.median != null) vals.push(res.median);
        const lo = Math.min(-100, Math.floor((Math.min(...vals) - 20) / 50) * 50);
        const hi = Math.max(100, Math.ceil((Math.max(...vals) + 20) / 50) * 50);
        const span = hi - lo;
        const step = span > 250 ? 100 : 50;
        const pos = (v) => ((v - lo) / span) * 100;

        // Stippen die elkaar zouden raken komen in een baan erboven
        const lanes = [];
        pts.slice().sort((a, b) => a.v - b.v).forEach((p) => {
          p.x = pos(p.v);
          let lane = lanes.findIndex((lastX) => p.x - lastX >= 3);
          if (lane === -1) {
            if (lanes.length < 5) lane = lanes.length;
            else lane = lanes.indexOf(Math.min(...lanes));
          }
          lanes[lane] = p.x;
          p.lane = lane;
        });

        const plot = h("div", { class: "in-plot", style: { "--lanes": lanes.length }, "aria-hidden": "true" },
          h("span", { class: "in-plot-axis" })
        );
        for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
          plot.append(h("span", { class: "in-plot-tick num", style: { left: pos(v) + "%" } }, v === 0 ? "0" : fmtMs(v, false)));
        }
        plot.append(h("span", { class: "in-plot-zero", style: { left: pos(0) + "%" } }));
        if (res.median != null && showLine) {
          const mx = pos(res.median);
          plot.append(h("span", {
            class: "in-plot-med" + (mx < 18 ? " is-start" : mx > 82 ? " is-end" : ""),
            style: { left: mx + "%" },
          }, h("span", null, "vertraging " + fmtMs(res.median))));
        }
        pts.forEach((p) => plot.append(h("span", {
          class: "in-plot-dot" + (p.out ? " is-out" : ""),
          style: { left: p.x + "%", "--lane": p.lane },
        })));

        const caption = "Elke stip is een tik van jou. Rechts van de 0 tikte je na de tel, links ervoor."
          + (res.outliers.length ? " Holle stippen lagen ver van de rest en zijn niet meegeteld." : "");
        return h("figure", { class: "in-plot-fig" }, plot, h("figcaption", null, caption));
      }

      /* Houd de knoppen van de uitslag gelijk met de opgeslagen correctie
         (ook als je daarna de teller of "Terug naar 0" gebruikt). */
      function syncResultUi() {
        const u = resultUi;
        if (!u || disposed) return;
        const cur = currentLatency();
        const saved = cur === u.value;
        const b = (text) => h("b", { class: "num" }, text);
        u.useBtn.classList.toggle("in-saved", saved);
        u.useBtn.classList.toggle("btn-primary", !saved && u.preferUse);
        if (saved) {
          // aria-disabled in plaats van disabled: de focus blijft dan op de knop staan
          u.useBtn.setAttribute("aria-disabled", "true");
          u.useBtn.replaceChildren(icon("check", 18), u.savedHere ? "Opgeslagen" : "Al ingesteld");
          u.cmp.replaceChildren("Ingesteld: ", b(fmtMs(cur)));
        } else {
          u.useBtn.removeAttribute("aria-disabled");
          u.useBtn.replaceChildren(icon("check", 18), "Gebruik deze waarde");
          u.cmp.replaceChildren("Nu ingesteld: ", b(fmtMs(cur)), " · nieuw: ", b(fmtMs(u.value)));
        }
        // Staat de waarde erin, dan is de volgende stap: ermee oefenen
        if (u.nextBtn) u.nextBtn.hidden = !saved;
      }

      function renderResult(r, res) {
        phase = "result";
        res.outliers.forEach((k) => {
          r.tl.cells[k].classList.add("is-out");
          r.tl.cells[k].title += " · ver van de rest, niet meegeteld";
        });
        const v = verdictFor(res, r);
        const verdictEl = h("div", { class: "in-verdict is-" + v.kind, tabindex: "-1", role: "status" },
          h("span", { class: "in-verdict-icon" }, icon(v.iconName, 20)),
          h("div", null, h("b", null, v.title), h("p", null, v.text))
        );

        // Knoppen direct onder het oordeel, zodat de hoofdknop ook op een telefoon in beeld staat
        const againBtn = h("button", { type: "button", class: "btn", onClick: () => startCal(againBtn) }, icon("replay", 18), "Nog een keer");
        const actions = h("div", { class: "in-result-actions" });
        const usable = res.verdict !== "few" && res.verdict !== "scattered";
        resultUi = null;
        if (!usable) {
          againBtn.classList.add("btn-primary");
          actions.append(againBtn);
          if (v.silent) actions.append(h("button", { type: "button", class: "btn btn-ghost", onClick: testSound }, icon("volume", 18), "Test geluid"));
        } else {
          const retryFirst = res.verdict === "irregular" || res.verdict === "edge";
          const useBtn = h("button", {
            type: "button", class: "btn",
            onClick: () => {
              if (currentLatency() === res.value) return;
              App.store.setSetting("latencyMs", res.value);
              App.store.setSetting("latencyAt", Date.now());
              corrStepper.value = res.value;
              if (resultUi) resultUi.savedHere = true;
              syncLatencyUi();
              App.ui.toast("Correctie opgeslagen: " + fmtMs(res.value), "ok");
            },
          });
          const cmp = h("span", { class: "in-cmp" });
          const nextBtn = App.modes && App.modes.ritme
            ? h("button", { type: "button", class: "btn btn-ghost", hidden: true, onClick: () => App.navigate("ritme") }, "Probeer het in Ritme", icon("next", 18))
            : null;
          if (retryFirst) { againBtn.classList.add("btn-primary"); actions.append(againBtn, useBtn); }
          else actions.append(useBtn, againBtn);
          if (nextBtn) actions.append(nextBtn);
          actions.append(cmp);
          resultUi = { value: res.value, preferUse: !retryFirst, savedHere: false, useBtn, cmp, nextBtn };
          syncResultUi();
        }
        const outcome = h("div", { class: "in-outcome" }, verdictEl, actions);
        const parts = [stageHead(), r.tl.el, outcome];

        if (res.n > 0) {
          parts.push(h("div", { class: "in-stats" },
            statTile(res.median == null ? "—" : fmtMs(res.median, false), "je vertraging", "ms"),
            statTile(res.sd == null ? "—" : "±" + Math.round(res.sd), "spreiding", "ms"),
            statTile(String(res.n), "bruikbare tikken", "van " + MEASURE)
          ));
          parts.push(h("p", { class: "in-explain" },
            "Je vertraging is de middelste waarde van je tikken. De spreiding laat zien hoeveel je tikken onderling verschilden: hoe kleiner, hoe betrouwbaarder."));
        }
        const skipped = [];
        const missed = r.taps.filter((x, k) => x == null && !r.far[k]).length;
        if (missed) skipped.push(plural(missed, "tel zonder tik", "tellen zonder tik"));
        if (r.outside) skipped.push(plural(r.outside, "tik te ver van de tel", "tikken te ver van de tel"));
        if (res.outliers.length) skipped.push(plural(res.outliers.length, "tik ver van de rest", "tikken ver van de rest"));
        if (r.doubles) skipped.push(plural(r.doubles, "dubbele tik", "dubbele tikken"));
        if (skipped.length) parts.push(h("p", { class: "in-skipped" }, "Niet meegeteld: " + skipped.join(", ") + "."));

        const plot = buildPlot(r, res, usable);
        if (plot) parts.push(plot);
        if (usable && res.verdict !== "irregular") parts.push(h("p", { class: "in-context" }, contextText(res.value)));

        stage.replaceChildren(...parts);
        verdictEl.focus({ preventScroll: true });
        scrollIntoViewSoft(outcome);
      }

      const corrBlock = h("div", { class: "in-corr" },
        h("div", { class: "field" },
          h("div", { class: "field-label" }, "Correctie, handmatig bijstellen"),
          h("div", { class: "in-corr-ctrl" }, corrStepper, resetBtn),
          corrHint
        ),
        h("div", { class: "in-info" },
          h("div", { class: "in-info-head" }, h("span", { class: "in-info-label" }, "Vertraging volgens je browser"), browserVal),
          h("p", { class: "in-info-text" }, "Die rekent Maatwerk al automatisch mee. De kalibratie corrigeert de rest: vertraging die je apparaat niet doorgeeft (vaak bij bluetooth) en je eigen reactie-gewoonte."),
          browserSub
        )
      );

      const calSection = section(
        {
          id: "timing", iconName: "clock", title: "Timing kalibreren", key: true,
          text: "Tussen het moment dat Maatwerk een geluid afspeelt en het moment dat jij het hoort zit altijd wat vertraging; vooral bluetooth-koptelefoons lopen 100–250 ms achter. Kalibreer één keer met de koptelefoon of speakers waarmee je oefent, dan meten de oefeningen je timing eerlijk.",
          extra: calBadge,
        },
        stage,
        h("hr", { class: "divider" }),
        corrBlock
      );

      /* ================= 3. Notennamen ================= */
      let nameStyle = App.store.getSetting("noteNames", "sharp");
      if (!App.music.NAMES[nameStyle]) nameStyle = "sharp";

      const keyEls = [];
      for (let p = 0; p < 12; p++) {
        const name = App.music.noteName(p, nameStyle);
        const el = h("button", {
          type: "button",
          class: "in-key" + (App.music.isBlack(p) ? " is-black" : ""),
          "aria-label": "Speel " + name,
          onClick: () => playKey(p, el),
        }, name);
        keyEls.push(el);
      }

      function updateKeys(style, animate) {
        keyEls.forEach((el, i) => {
          const name = App.music.noteName(i, style);
          if (el.textContent !== name) {
            el.textContent = name;
            if (animate) restartAnim(el, "is-changed");
          }
          el.setAttribute("aria-label", "Speel " + name);
        });
      }

      async function playKey(p, el) {
        if (phase === "run" || phase === "starting") return;
        restartAnim(el, "is-playing");
        if (warnIfSilent()) return;
        if (!(await audioReady())) return;
        if (phase === "run" || phase === "starting") return;
        App.audio.sequence([{ t: 0, kind: "note", midi: 60 + p, dur: 1.4 }], { lead: 0.03, tail: 1.2 });
      }

      const namesSeg = App.ui.segmented({
        options: NAME_STYLES.map((s) => ({
          value: s.value,
          label: [h("span", { class: "in-seg-main" }, s.main), h("span", { class: "in-seg-sub" }, s.sub)],
        })),
        value: nameStyle,
        block: true,
        ariaLabel: "Notennamen",
        onChange: (v) => {
          App.store.setSetting("noteNames", v);
          updateKeys(v, true);
        },
      });
      namesSeg.classList.add("in-names");

      const namesSection = section(
        { id: "noten", iconName: "gehoor", title: "Notennamen", text: "Hoe noten heten in de oefeningen en in je statistieken." },
        namesSeg,
        h("div", { class: "field" },
          h("div", { class: "field-label" }, "Zo heten de 12 noten"),
          h("div", { class: "in-keys" }, keyEls),
          h("div", { class: "field-hint" }, "Tik op een noot om hem te horen, vanaf de middelste C.")
        )
      );

      /* ================= 4. Gegevens ================= */
      const dataList = h("ul", { class: "in-list" });
      // De uitslag van importeren staat alleen hier (geen extra melding), zodat een schermlezer hem één keer voorleest
      const dataStatus = h("p", { class: "in-status", role: "status", "aria-live": "polite" });
      const fileInput = h("input", { type: "file", accept: ".json,application/json", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
      fileInput.addEventListener("change", onFilePicked);
      const exportBtn = h("button", { type: "button", class: "btn", onClick: exportData }, icon("download", 18), "Exporteren");
      const importBtn = h("button", { type: "button", class: "btn", onClick: () => fileInput.click() }, icon("upload", 18), "Importeren");
      const wipeAllBtn = h("button", { type: "button", class: "btn btn-ghost btn-danger", onClick: wipeAll }, icon("trash", 18), "Alles wissen");
      let dataSig = "";
      let reader = null;

      /* Lijst per oefening. Mag nooit een fout gooien: één rare sessie mag de pagina niet breken. */
      function renderData(force) {
        if (disposed) return;
        try {
          const all = App.store.sessions();
          const by = new Map();
          all.forEach((s) => {
            const e = by.get(s.mode) || { n: 0, last: 0 };
            e.n++;
            const ts = Number(s.ts);
            if (validTs(ts)) e.last = Math.max(e.last, ts);
            by.set(s.mode, e);
          });
          const ids = EXERCISES.map((e) => e.id).concat([...by.keys()].filter((id) => !EXERCISES.some((e) => e.id === id)));
          const sig = ids.map((id) => { const e = by.get(id); return String(id) + ":" + (e ? e.n + ":" + e.last : 0); }).join("|");
          if (sig === dataSig && !force) return;
          dataSig = sig;
          dataList.replaceChildren(
            ...ids.map((id) => dataRow(id, by.get(id) || { n: 0, last: 0 })),
            h("li", { class: "in-row in-row-total" },
              h("span", { class: "in-row-dot", "aria-hidden": "true" }),
              h("div", { class: "in-row-main" }, h("span", { class: "in-row-name" }, "Totaal")),
              h("span", { class: "in-row-count" }, h("b", { class: "num" }, String(all.length)), h("small", null, all.length === 1 ? "sessie" : "sessies")),
              h("span", { "aria-hidden": "true" })
            )
          );
          wipeAllBtn.disabled = all.length === 0;
        } catch (e) {
          console.error("Gegevens tonen mislukt", e);
          dataSig = "";
          dataList.replaceChildren(h("li", { class: "in-row-msg" }, "Je sessies konden niet worden getoond. Exporteren en wissen werken nog wel."));
          wipeAllBtn.disabled = false;
        }
      }

      function dataRow(id, info) {
        const known = EXERCISES.find((e) => e.id === id);
        const title = modeTitle(id);
        const when = info.n ? safeDate(info.last) : null;
        return h("li", { class: "in-row", style: { "--dot": known ? known.color : "var(--text-3)" } },
          h("span", { class: "in-row-dot", "aria-hidden": "true" }),
          h("div", { class: "in-row-main" },
            h("span", { class: "in-row-name" }, title),
            h("span", { class: "in-row-sub" }, info.n ? (when ? "Laatst " + when : "Datum onbekend") : "Nog niet gespeeld")
          ),
          h("span", { class: "in-row-count" }, h("b", { class: "num" }, String(info.n)), h("small", null, info.n === 1 ? "sessie" : "sessies")),
          h("button", {
            type: "button", class: "btn btn-ghost btn-icon in-row-del",
            "aria-label": "Wis de sessies van " + title, title: "Wis " + title,
            dataset: { wipe: String(id) },
            disabled: info.n === 0,
            onClick: () => wipeMode(id, title),
          }, icon("trash", 18))
        );
      }

      /* Bij Annuleren zet App.ui.confirm de focus zelf terug op de knop die het venster opende. */

      /* Na het wissen van één oefening: naar de volgende prullenbak die nog iets te wissen heeft
         (nooit naar "Alles wissen"), anders naar Exporteren. */
      function focusAfterModeWipe(id) {
        if (disposed) return;
        renderData(false);
        const btns = [...dataList.querySelectorAll(".in-row-del")];
        const idx = btns.findIndex((b) => b.dataset.wipe === String(id));
        const next = btns.slice(idx + 1).find((b) => !b.disabled)
          || btns.slice(0, Math.max(idx, 0)).reverse().find((b) => !b.disabled);
        (next || exportBtn).focus();
      }

      async function wipeMode(id, title) {
        const n = App.store.sessions(id).length;
        if (!n) return;
        const what = n === 1 ? `Je ene sessie van ${title} wordt verwijderd.` : `Je ${n} sessies van ${title} worden verwijderd.`;
        const ok = await App.ui.confirm({
          title: `${title} wissen?`,
          text: `${what} Dit kun je niet terugdraaien. Wil je ze bewaren, exporteer dan eerst.`,
          ok: "Wissen", cancel: "Annuleren", danger: true,
        });
        if (!ok || disposed) return;
        App.store.clearSessions(id);
        App.ui.toast(`${title}: ${plural(n, "sessie", "sessies")} gewist.`, "ok");
        focusAfterModeWipe(id);
      }

      async function wipeAll() {
        const n = App.store.sessions().length;
        if (!n) return;
        const what = n === 1 ? "Je ene sessie wordt verwijderd." : `Al je ${n} sessies, van alle oefeningen, worden verwijderd.`;
        const ok = await App.ui.confirm({
          title: "Alle gegevens wissen?",
          text: `${what} Dit kun je niet terugdraaien. Je instellingen, zoals je kalibratie, blijven staan.`,
          ok: "Alles wissen", cancel: "Annuleren", danger: true,
        });
        if (!ok || disposed) return;
        App.store.clearSessions();
        App.ui.toast(`Alles gewist: ${plural(n, "sessie", "sessies")}.`, "ok");
        if (!disposed) exportBtn.focus();
      }

      function exportData() {
        try {
          const name = exportName();
          const blob = new Blob([App.store.exportJSON()], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = h("a", { href: url, download: name, style: { display: "none" } });
          document.body.append(a);
          a.click();
          a.remove();
          blobUrls.add(url);
          later(() => { URL.revokeObjectURL(url); blobUrls.delete(url); }, 5000);
          const n = App.store.sessions().length;
          App.ui.toast(`Download gestart: ${name} (${plural(n, "sessie", "sessies")})`, "ok");
        } catch (e) {
          console.error(e);
          App.ui.toast("Exporteren lukte niet in deze browser.", "bad");
        }
      }

      function setStatus(kind, iconName, text) {
        dataStatus.className = "in-status" + (kind ? " is-" + kind : "");
        dataStatus.replaceChildren(iconName ? icon(iconName, 16) : "", h("span", null, text));
      }

      function importFailed(reason, withHint = true) {
        setStatus("bad", "x", reason + (withHint ? " Kies een bestand dat je eerder met Exporteren hebt gemaakt (maatwerk-…json)." : ""));
      }

      /* Lees een exportbestand: eerst zelf controleren, dan alleen de bruikbare sessies doorgeven. */
      function importText(text, fileName) {
        let inc;
        try { inc = JSON.parse(text); } catch (e) { importFailed("Dit bestand is geen leesbaar Maatwerk-bestand."); return; }
        if (!inc || typeof inc !== "object" || inc.app !== "maatwerk" || !Array.isArray(inc.sessions)) {
          importFailed("Dit is geen Maatwerk-bestand.");
          return;
        }
        const total = inc.sessions.length;
        if (!total) { setStatus("", "info", "Dit bestand bevat geen sessies. Er is niets veranderd."); return; }
        const usable = inc.sessions.filter(isUsableSession);
        const broken = total - usable.length;
        if (!usable.length) {
          setStatus("bad", "x", (total === 1 ? "De sessie in dit bestand is" : `Alle ${total} sessies in dit bestand zijn`) + " onvolledig. Er is niets veranderd.");
          return;
        }

        // Past het in de opslag van de browser? Anders klopt de melding na herladen niet meer.
        const known = new Set(App.store.sessions().map((s) => s.id));
        const fresh = usable.filter((s) => s.id == null || !known.has(s.id));
        const room = fresh.length ? storageRoom(JSON.stringify(fresh).length + 256) : "ok";
        if (room === "full") {
          setStatus("bad", "x", "De opslag van deze browser is te vol voor deze sessies. Er is niets veranderd.");
          return;
        }

        let added;
        try {
          added = App.store.importJSON(JSON.stringify({ app: "maatwerk", sessions: usable }));
        } catch (e) {
          console.error(e);
          // De opslag gooit ook een fout als bewaren mislukt (opslag vol); dan is het bestand wél goed
          if (e && /^Opslaan/.test(String(e.message || ""))) {
            setStatus("bad", "x", "Bewaren lukte niet: de opslag van deze browser is vol. Na herladen zijn de nieuwe sessies weg.");
          } else {
            importFailed("Dit is geen Maatwerk-bestand.");
          }
          return;
        }
        const skipNote = broken ? ` ${plural(broken, "onvolledige sessie", "onvolledige sessies")} overgeslagen.` : "";
        if (added > 0 && room === "blocked") {
          setStatus("bad", "x", `${plural(added, "sessie", "sessies")} ingelezen, maar deze browser bewaart niets: na herladen zijn ze weg.${skipNote}`);
        } else if (added > 0) {
          setStatus("ok", "check", `${plural(added, "nieuwe sessie", "nieuwe sessies")} toegevoegd uit ${fileName}.${skipNote}`);
        } else {
          setStatus("", "info", `Geen nieuwe sessies: alles uit dit bestand stond er al.${skipNote}`);
        }
      }

      function onFilePicked() {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = ""; // zodat hetzelfde bestand nog eens gekozen kan worden
        if (!file) return;
        if (file.size > MAX_IMPORT_BYTES) { importFailed("Dit bestand is te groot om in de browser te bewaren.", false); return; }
        const rd = new FileReader();
        reader = rd;
        rd.onload = () => {
          if (disposed || reader !== rd) return;
          reader = null;
          importText(String(rd.result || ""), file.name);
        };
        rd.onerror = () => {
          if (disposed || reader !== rd) return;
          reader = null;
          importFailed("Het bestand kon niet worden gelezen.");
        };
        rd.readAsText(file);
      }

      const dataSection = section(
        { id: "gegevens", iconName: "download", title: "Gegevens", text: "Je sessies per oefening, een reservekopie maken en opschonen." },
        h("div", { class: "in-callout" },
          icon("info", 18),
          h("p", null, "Alles wat je oefent staat alleen in deze browser, op dit apparaat. Wis je je browsergegevens of stap je over op een ander apparaat, dan ben je het kwijt. Exporteren is de manier om een reservekopie te maken.")
        ),
        dataList,
        h("div", { class: "in-actions" }, exportBtn, importBtn, fileInput, h("span", { class: "in-spacer" }), wipeAllBtn),
        h("p", { class: "in-hint" }, "Importeren voegt alleen sessies toe die er nog niet zijn. Je huidige instellingen blijven staan."),
        dataStatus
      );

      /* ================= 5. Over Maatwerk ================= */
      const aboutSection = section(
        { id: "over", iconName: "info", title: "Over Maatwerk" },
        h("div", { class: "in-about" },
          h("p", null, "Maatwerk traint je timing en je gehoor met korte oefeningen voor ritme, toonhoogte, tempo en maatsoort."),
          h("p", null, "Alles draait in je browser, zonder account; je oefengegevens verlaten dit apparaat niet.")
        )
      );

      /* ================= Sneltoetsen ================= */
      /* Tijdens het kalibreren: spatie = tik, Esc = stoppen. Op document in de capture-fase, zodat dit
         vóór de eigen toetsen van een knop, teller of schuif komt: waar de focus ook staat, de spatie is
         dan altijd een tik (en verstelt bijvoorbeeld niet ook de correctie). */
      function onKeyDown(e) {
        if (phase !== "run") return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (isTypingTarget(e.target)) return;
        if (e.key === "Escape" || e.key === "Esc") {
          if (document.querySelector(".modal-back")) return; // een open venster sluit eerst zelf
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) stopCal(true);
          return;
        }
        if (e.code === "Space" || e.key === " ") {
          e.preventDefault(); // niet scrollen en geen knop indrukken
          e.stopPropagation();
          if (e.repeat) return;
          if (run) tap(run, e);
        }
      }
      function onKeyUp(e) {
        if (phase === "run" && !isTypingTarget(e.target) && (e.code === "Space" || e.key === " ")) e.preventDefault();
      }
      function onVisibility() {
        if (document.hidden && phase === "run") {
          stopCal(false);
          App.ui.toast("Kalibratie gestopt omdat je van tabblad wisselde.", "bad");
        }
      }

      function dispose() {
        disposed = true;
        if (run) { try { run.handle.stop(); } catch (e) { /* al gestopt */ } run = null; }
        cancelAnimationFrame(rafId);
        rafId = 0;
        resultUi = null;
        if (testHandle) { try { testHandle.stop(); } catch (e) { /* al gestopt */ } testHandle = null; }
        if (reader && reader.readyState === 1) { try { reader.abort(); } catch (e) { /* negeren */ } }
        reader = null;
        cleanups.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
        cleanups.length = 0;
        flushVolume(); // laatste volumestand niet kwijtraken
        timeouts.forEach(clearTimeout);
        timeouts.clear();
        intervals.forEach(clearInterval);
        intervals.clear();
        blobUrls.forEach((u) => URL.revokeObjectURL(u));
        blobUrls.clear();
        App.setPlaying(false);
      }

      /* ================= Pagina ================= */
      // Eerst alle luisteraars, dan pas tekenen. Gaat er toch iets mis, dan ruimen we zelf op
      // voordat de fout naar de schil gaat (die krijgt dan geen opruimfunctie).
      try {
        root.append(
          App.ui.pageHead({
            eyebrow: "Instellingen",
            title: "Stel Maatwerk af",
            lead: "Stel je geluid en timing af, kies hoe noten heten en beheer je gegevens.",
          }),
          h("div", { class: "in-page" }, soundSection, calSection, namesSection, dataSection, aboutSection)
        );
        cleanups.push(App.store.subscribe(() => renderData(false)));
        every(refreshLatency, 1500);
        listen(document, "keydown", onKeyDown, true);
        listen(document, "keyup", onKeyUp, true);
        listen(document, "visibilitychange", onVisibility);

        renderIdle();
        syncLatencyUi();
        refreshLatency();
        renderData(true);
      } catch (e) {
        dispose();
        throw e;
      }

      return dispose;
    },
  });
})();
