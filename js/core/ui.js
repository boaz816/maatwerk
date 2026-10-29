/* Maatwerk — kleine bouwstenen voor de interface (App.ui). Geen framework: gewone DOM. */
(function () {
  const App = (window.App = window.App || {});
  const SVG_NS = "http://www.w3.org/2000/svg";

  /* h('div', {class: 'panel', onClick: fn}, 'tekst', kindElement, [lijst]) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    applyAttrs(el, attrs);
    append(el, children);
    return el;
  }

  /* Hetzelfde, maar voor SVG-elementen (grafieken, iconen). */
  function svg(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    applyAttrs(el, attrs);
    append(el, children);
    return el;
  }

  function applyAttrs(el, attrs) {
    if (!attrs) return;
    for (const [key, val] of Object.entries(attrs)) {
      if (val == null || val === false) continue;
      if (key.startsWith("on") && typeof val === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === "style" && typeof val === "object") {
        for (const [k, v] of Object.entries(val)) {
          if (k.startsWith("--")) el.style.setProperty(k, v);
          else el.style[k] = v;
        }
      } else if (key === "dataset") {
        Object.assign(el.dataset, val);
      } else if (key === "html") {
        el.innerHTML = val;
      } else if (key === "text") {
        el.textContent = val;
      } else if (val === true) {
        el.setAttribute(key, "");
      } else {
        el.setAttribute(key, val);
      }
    }
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  /* ---------- Iconen (lijnstijl, 24x24) ---------- */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    ritme: '<path d="M2 12h3l2-6 3 12 3-9 2 6 2-3h5"/>',
    gehoor: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    bpm: '<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    maatsoort: '<path d="M8 3h8l4 18H4z"/><path d="M12 17l4-9"/><path d="M8 13h8"/>',
    statistieken: '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V7"/><path d="M17 16v-3"/>',
    instellingen: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
    replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z"/>',
    trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/>',
    headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3z"/><path d="M3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
  };

  function icon(name, size = 20, extraClass = "") {
    const el = document.createElementNS(SVG_NS, "svg");
    el.setAttribute("viewBox", "0 0 24 24");
    el.setAttribute("width", size);
    el.setAttribute("height", size);
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", "currentColor");
    el.setAttribute("stroke-width", "2");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("aria-hidden", "true");
    if (extraClass) el.setAttribute("class", extraClass);
    el.innerHTML = ICONS[name] || ICONS.info;
    return el;
  }

  /* ---------- Bedieningselementen ---------- */

  /* Eén keuze uit een rij. options: [{value, label}] of ['a','b'].
     Geeft het element terug; el.value leest/zet de keuze. */
  function segmented({ options, value, onChange, ariaLabel, block = false }) {
    const opts = options.map((o) => (typeof o === "object" ? o : { value: o, label: String(o) }));
    const el = h("div", { class: "seg" + (block ? " seg-block" : ""), role: "group", "aria-label": ariaLabel || null });
    let current = value;
    const buttons = opts.map((o) =>
      h("button", {
        type: "button",
        "aria-pressed": String(o.value === current),
        title: o.title || null,
        onClick: () => set(o.value, true),
      }, o.label)
    );
    buttons.forEach((b) => el.append(b));
    function set(v, fire) {
      current = v;
      opts.forEach((o, i) => buttons[i].setAttribute("aria-pressed", String(o.value === v)));
      if (fire && onChange) onChange(v);
    }
    Object.defineProperty(el, "value", { get: () => current, set: (v) => set(v, false) });
    return el;
  }

  /* Meerdere keuzes tegelijk (chips). value: array. min: minimaal aantal aan. */
  function chips({ options, value = [], onChange, min = 1, ariaLabel }) {
    const opts = options.map((o) => (typeof o === "object" ? o : { value: o, label: String(o) }));
    let current = new Set(value);
    const el = h("div", { class: "chips", role: "group", "aria-label": ariaLabel || null });
    const buttons = opts.map((o) =>
      h("button", {
        type: "button", class: "chip",
        "aria-pressed": String(current.has(o.value)),
        onClick: () => {
          if (current.has(o.value)) {
            if (current.size <= min) return toast(`Kies er minstens ${min}.`);
            current.delete(o.value);
          } else current.add(o.value);
          sync();
          if (onChange) onChange(getValue());
        },
      }, o.label)
    );
    buttons.forEach((b) => el.append(b));
    function getValue() { return opts.map((o) => o.value).filter((v) => current.has(v)); }
    function sync() { opts.forEach((o, i) => buttons[i].setAttribute("aria-pressed", String(current.has(o.value)))); }
    Object.defineProperty(el, "value", { get: getValue, set: (v) => { current = new Set(v); sync(); } });
    return el;
  }

  /* Plus/min-teller met pijltjestoetsen en ingedrukt-houden. */
  function stepper({ value, min = -Infinity, max = Infinity, step = 1, bigStep, unit = "", format, onChange, ariaLabel }) {
    let current = value;
    const out = h("output", { "aria-live": "polite" });
    const fmt = format || ((v) => String(v));
    function render() {
      out.textContent = fmt(current);
      if (unit) out.append(h("small", null, unit));
      if (el) {
        el.setAttribute("aria-valuenow", String(current));
        el.setAttribute("aria-valuetext", fmt(current) + (unit ? " " + unit : ""));
      }
    }
    function set(v, fire) {
      const nv = Math.min(max, Math.max(min, Math.round(v / step) * step));
      const changed = nv !== current;
      current = +nv.toFixed(6);
      render();
      if (fire && changed && onChange) onChange(current);
    }
    let el = null;
    let holdTimer = null, holdInt = null;
    function hold(dir) {
      release();
      set(current + dir * step, true);
      holdTimer = setTimeout(() => {
        holdInt = setInterval(() => {
          // Pagina gewisseld terwijl de knop nog ingedrukt was: stoppen
          if (!el.isConnected) return release();
          set(current + dir * step, true);
        }, 60);
      }, 380);
    }
    function release() { clearTimeout(holdTimer); clearInterval(holdInt); }
    const minus = h("button", { type: "button", "aria-label": "Minder", onPointerdown: (e) => { e.preventDefault(); hold(-1); }, onPointerup: release, onPointerleave: release, onPointercancel: release }, icon("minus", 18));
    const plus = h("button", { type: "button", "aria-label": "Meer", onPointerdown: (e) => { e.preventDefault(); hold(1); }, onPointerup: release, onPointerleave: release, onPointercancel: release }, icon("plus", 18));
    // Toetsenbord: klik via Enter/spatie op de knoppen
    minus.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(current - step, true); } });
    plus.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(current + step, true); } });
    el = h("div", {
      class: "stepper", role: "spinbutton", tabindex: "0",
      "aria-label": ariaLabel || null, "aria-valuemin": isFinite(min) ? min : null, "aria-valuemax": isFinite(max) ? max : null,
      onKeydown: (e) => {
        const big = bigStep || step * 10;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); set(current + step, true); }
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); set(current - step, true); }
        if (e.key === "PageUp") { e.preventDefault(); set(current + big, true); }
        if (e.key === "PageDown") { e.preventDefault(); set(current - big, true); }
      },
    }, minus, out, plus);
    render();
    Object.defineProperty(el, "value", { get: () => current, set: (v) => set(v, false) });
    return el;
  }

  /* Schuif met gekleurde vulling. */
  function slider({ value, min = 0, max = 100, step = 1, onInput, ariaLabel }) {
    const el = h("input", { type: "range", min, max, step, value, "aria-label": ariaLabel || null });
    const paint = () => el.style.setProperty("--fill", ((el.value - min) / (max - min)) * 100 + "%");
    el.addEventListener("input", () => { paint(); if (onInput) onInput(+el.value); });
    paint();
    return el;
  }

  /* Aan/uit-schakelaar met label. */
  function toggle({ checked = false, label, onChange }) {
    const input = h("input", { type: "checkbox", checked: checked || null, onChange: () => onChange && onChange(input.checked) });
    const el = h("label", { class: "switch" }, input, h("span", { class: "track" }), label ? h("span", null, label) : null);
    Object.defineProperty(el, "checked", { get: () => input.checked, set: (v) => (input.checked = v) });
    return el;
  }

  /* Veld met label erboven en eventueel een hint eronder. */
  function field(label, control, hint) {
    return h("div", { class: "field" },
      h("div", { class: "field-label" }, label),
      control,
      hint ? h("div", { class: "field-hint" }, hint) : null
    );
  }

  /* Paginakop. back: true voor een terugknop naar de start. */
  function pageHead({ eyebrow, title, lead, back = true }) {
    return h("header", { class: "page-head" },
      back ? h("a", { class: "back", href: "#/" }, icon("back", 16), "Start") : null,
      eyebrow ? h("div", { class: "eyebrow" }, eyebrow) : null,
      h("h1", null, title),
      lead ? h("p", { class: "lead" }, lead) : null
    );
  }

  /* Cijfertegel. */
  function stat(value, label, unit) {
    return h("div", { class: "stat" },
      h("div", { class: "stat-value" }, value, unit ? h("small", null, unit) : null),
      h("div", { class: "stat-label" }, label)
    );
  }

  /* Scorering 0–100. */
  function scoreRing(score, label = "score") {
    const s = Math.max(0, Math.min(100, Math.round(score)));
    return h("div", { class: "score-ring", style: { "--p": s }, role: "img", "aria-label": `${label} ${s} van 100` },
      h("div", null, h("div", null, h("b", null, String(s)), h("span", null, label)))
    );
  }

  /* ---------- Meldingen ---------- */
  let toastHost = null;
  function toast(message, kind = "") {
    if (!toastHost) { toastHost = h("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(toastHost); }
    const t = h("div", { class: "toast " + kind }, message);
    toastHost.append(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 200ms"; setTimeout(() => t.remove(), 220); }, 2600);
  }

  /* Bevestigingsvenster → Promise<boolean>. */
  /* Bij een gevaarlijke actie staat de focus op Annuleren, zodat één Enter niets wist.
     Het venster sluit (als "nee") bij een paginawissel, en geeft de focus daarna terug. */
  function confirm({ title, text, ok = "Doorgaan", cancel = "Annuleren", danger = false }) {
    return new Promise((resolve) => {
      const opener = document.activeElement;
      let closed = false;
      const done = (v) => {
        if (closed) return;
        closed = true;
        back.remove();
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("hashchange", onRoute);
        if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true });
        resolve(v);
      };
      const onRoute = () => done(false);
      const onKey = (e) => {
        // Escape en Tab horen bij het venster: niet doorgeven aan sneltoetsen van de pagina
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); return; }
        if (e.key === "Tab") {
          e.stopPropagation();
          // Focus binnen het venster houden
          const items = [cancelBtn, okBtn];
          const i = items.indexOf(document.activeElement);
          e.preventDefault();
          items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
        }
      };
      const okBtn = h("button", { class: "btn " + (danger ? "btn-danger" : "btn-primary"), onClick: () => done(true) }, ok);
      const cancelBtn = h("button", { class: "btn btn-ghost", onClick: () => done(false) }, cancel);
      const back = h("div", { class: "modal-back", onClick: (e) => { if (e.target === back) done(false); } },
        h("div", { class: "modal", role: "alertdialog", "aria-modal": "true", "aria-label": title },
          h("h3", null, title),
          text ? h("p", null, text) : null,
          h("div", { class: "row" }, cancelBtn, okBtn)
        )
      );
      document.body.append(back);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("hashchange", onRoute);
      (danger ? cancelBtn : okBtn).focus();
    });
  }

  /* ---------- Opmaak van getallen ---------- */
  const MINUS = "−";
  /* +12 ms / −8 ms / 0 ms */
  function fmtMs(ms, withUnit = true) {
    const r = Math.round(ms);
    const s = r > 0 ? "+" + r : r < 0 ? MINUS + Math.abs(r) : "0";
    return withUnit ? s + " ms" : s;
  }
  /* Getal met Nederlandse komma: fmtNum(4.25, 1) → "4,3"; zonder overbodige ",0" als trim. */
  function fmtNum(n, digits = 0, trim = true) {
    if (!Number.isFinite(n)) return "—";
    let s = n.toFixed(digits);
    if (trim && digits > 0) s = s.replace(/\.?0+$/, "");
    return s.replace(".", ",");
  }
  function fmtSigned(n, digits = 0) {
    if (!Number.isFinite(n)) return "—";
    const v = +n.toFixed(digits);
    return v > 0 ? "+" + fmtNum(v, digits, false) : v < 0 ? MINUS + fmtNum(Math.abs(v), digits, false) : fmtNum(0, digits, false);
  }
  /* 95000 → "1 min 35 s" */
  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + " s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " min" + (s % 60 ? " " + (s % 60) + " s" : "");
    const hrs = Math.floor(m / 60);
    return hrs + " u " + (m % 60) + " min";
  }
  const nlDate = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
  const nlDateTime = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  function fmtDate(ts, withTime = false) {
    const d = new Date(ts);
    return Number.isFinite(d.getTime()) ? (withTime ? nlDateTime : nlDate).format(d) : "—";
  }
  function fmtPct(fraction) { return Math.round(fraction * 100) + "%"; }

  App.ui = {
    h, svg, icon, ICONS, segmented, chips, stepper, slider, toggle, field, pageHead, stat, scoreRing,
    toast, confirm, fmtMs, fmtNum, fmtSigned, fmtDuration, fmtDate, fmtPct, MINUS,
  };
})();
