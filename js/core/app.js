/* Maatwerk — schil: navigatie, routes en startpagina.
   Elke oefening of pagina meldt zich aan met App.registerMode({...}); zie docs/CONTRACT.md. */
(function () {
  const App = (window.App = window.App || {});
  const { h, icon } = App.ui;

  const registry = {};
  const EXERCISES = ["ritme", "gehoor", "bpm", "maatsoort"];
  const PAGES = ["statistieken", "instellingen"];

  /* def: { id, title, nav, description, icon, mount(root) → optionele opruimfunctie } */
  App.registerMode = function (def) {
    if (!def || !def.id || typeof def.mount !== "function") throw new Error("registerMode: id en mount zijn verplicht");
    registry[def.id] = def;
  };
  App.modes = registry;

  /* Speelstand: op een telefoon verdwijnt dan de onderbalk, zodat je hem niet per ongeluk raakt. */
  App.setPlaying = function (on) { document.body.classList.toggle("is-playing", !!on); };

  let cleanup = null;
  let viewEl = null;

  function currentRoute() {
    const r = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
    return r || "";
  }

  /* Navigeer naar een route ('' = start). */
  App.navigate = function (route) {
    const target = "#/" + (route || "");
    if (location.hash === target) render();
    else location.hash = target;
  };

  function render() {
    // Opruimen van de vorige pagina: geluid stoppen, luisteraars weg
    try { App.audio.stopAll(); } catch (e) { /* nog geen geluid */ }
    if (typeof cleanup === "function") {
      try { cleanup(); } catch (e) { console.error("Opruimen mislukt", e); }
    }
    cleanup = null;
    App.setPlaying(false);

    const route = currentRoute();
    const def = registry[route];
    const fresh = h("main", { class: "view", id: "view", tabindex: "-1" });
    viewEl.replaceWith(fresh);
    viewEl = fresh;

    if (def) {
      fresh.dataset.mode = def.id;
      document.body.dataset.mode = def.id;
      document.title = def.title + " · Maatwerk";
      try {
        cleanup = def.mount(fresh) || null;
      } catch (e) {
        console.error(e);
        fresh.append(h("div", { class: "empty" }, h("h3", null, "Er ging iets mis"), h("p", null, String(e.message || e))));
      }
    } else {
      fresh.dataset.mode = "home";
      document.body.dataset.mode = "home";
      document.title = "Maatwerk · train je gehoor en timing";
      cleanup = renderHome(fresh);
    }
    updateNav(def ? def.id : "");
    window.scrollTo(0, 0);
  }

  /* ---------- Navigatie ---------- */
  function navLink(id, label, iconName, withDot) {
    return h("a", { class: "nav-link", href: "#/" + id, dataset: { route: id } },
      icon(iconName, 18), h("span", null, label),
      withDot ? h("span", { class: "dot", style: { background: `var(--c-${id === "maatsoort" ? "maat" : id})` } }) : null
    );
  }

  function buildShell() {
    const root = document.getElementById("app");
    const sidebar = h("aside", { class: "sidebar", "aria-label": "Hoofdmenu" },
      h("a", { class: "brand", href: "#/" }, logo(), h("span", { class: "brand-name" }, "Maatwerk")),
      h("nav", { class: "nav" }, navLink("", "Start", "home")),
      h("nav", { class: "nav", "aria-label": "Oefeningen" },
        h("div", { class: "nav-label" }, "Oefenen"),
        EXERCISES.map((id) => navLink(id, titleOf(id), id, true))
      ),
      h("nav", { class: "nav", "aria-label": "Jij" },
        h("div", { class: "nav-label" }, "Jij"),
        PAGES.map((id) => navLink(id, titleOf(id), id))
      ),
      h("div", { class: "sidebar-foot" }, "Tip: een koptelefoon met draad geeft de eerlijkste timing.")
    );
    const bottom = h("nav", { class: "bottom-nav", "aria-label": "Hoofdmenu" },
      [["", "Start", "home"], ["statistieken", "Statistieken", "statistieken"], ["instellingen", "Instellingen", "instellingen"]].map(([id, label, ic]) =>
        h("a", { href: "#/" + id, dataset: { route: id } }, icon(ic, 20), label)
      )
    );
    viewEl = h("main", { class: "view", id: "view" });
    root.append(h("div", { class: "app" }, sidebar, h("div", { class: "main" }, viewEl)), bottom);
  }

  function updateNav(route) {
    document.querySelectorAll("[data-route]").forEach((a) => {
      if (a.dataset.route === route) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function titleOf(id) {
    const fallback = { ritme: "Ritme", gehoor: "Gehoor", bpm: "BPM", maatsoort: "Maatsoort", statistieken: "Statistieken", instellingen: "Instellingen" };
    return (registry[id] && (registry[id].nav || registry[id].title)) || fallback[id] || id;
  }

  function logo() {
    // Vier balkjes als een geluidsgolf, in de kleuren van de oefeningen
    const s = App.ui.svg("svg", { viewBox: "0 0 30 30", class: "brand-mark", "aria-hidden": "true" });
    const bars = [[5, 12, "var(--c-ritme)"], [11, 6, "var(--c-gehoor)"], [17, 9, "var(--c-bpm)"], [23, 14, "var(--c-maat)"]];
    bars.forEach(([x, y, fill]) => s.append(App.ui.svg("rect", { x, y, width: 3.5, height: 30 - 2 * y, rx: 1.75, fill })));
    return s;
  }

  /* ---------- Startpagina ---------- */
  const CARD_TEXT = {
    ritme: "Hoor een ritme, klik mee en zie per tik hoeveel milliseconden je te vroeg of te laat was.",
    gehoor: "Absoluut of relatief gehoor: hoor een noot en zeg welke het is.",
    bpm: "Een metronoom tikt. Hoe snel is het? Raad het tempo zo precies mogelijk.",
    maatsoort: "Hoor een groove en herken de maatsoort: 3/4, 4/4, 6/8 en meer.",
  };

  function renderHome(root) {
    const all = App.store.sessions();
    root.append(
      h("section", { class: "hero" },
        h("div", { class: "eyebrow" }, "Muziektraining"),
        h("h1", null, "Train je timing en je gehoor."),
        h("p", null, "Korte oefeningen voor ritme, toonhoogte, tempo en maatsoort. Elke sessie wordt bewaard, zodat je ziet dat je beter wordt.")
      ),
      h("div", { class: "mode-cards" }, EXERCISES.map((id) => modeCard(id, all.filter((s) => s.mode === id)))),
      homeStrip(all)
    );
    return null;
  }

  function modeCard(id, list) {
    const def = registry[id] || {};
    const last = list[list.length - 1];
    const meta = list.length
      ? `${list.length} ${list.length === 1 ? "sessie" : "sessies"} · laatste score ${Math.round(last.score ?? 0)}`
      : "Nog niet gespeeld";
    return h("a", { class: "mode-card", href: "#/" + id, "data-mode": id },
      h("div", { class: "icon-tile" }, icon(id, 22)),
      h("div", { class: "stack", style: { gap: "6px" } }, h("h2", null, def.title || titleOf(id)), h("p", null, def.description || CARD_TEXT[id])),
      h("div", { class: "meta" }, h("span", null, meta), h("span", { class: "go" }, "Start", icon("next", 16)))
    );
  }

  function homeStrip(all) {
    const totalMs = all.reduce((a, s) => a + (s.durationMs || 0), 0);
    const week = all.filter((s) => s.ts > Date.now() - 7 * 864e5).length;
    const streak = dayStreak(all);
    const last = all[all.length - 1];
    const tile = (value, label) => h("div", { class: "stat-tile" }, App.ui.stat(value, label));
    return h("section", { class: "home-strip", "aria-label": "Samenvatting" },
      tile(String(all.length), "sessies in totaal"),
      tile(String(week), "sessies deze week"),
      tile(streak + (streak === 1 ? " dag" : " dagen"), "op rij geoefend"),
      tile(totalMs ? App.ui.fmtDuration(totalMs) : "—", last ? "geoefend · laatst " + App.ui.fmtDate(last.ts) : "geoefend")
    );
  }

  /* Aantal dagen op rij (t/m vandaag of gisteren) met minstens één sessie. */
  function dayStreak(all) {
    const days = new Set(all.map((s) => new Date(s.ts).toDateString()));
    const d = new Date();
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  App.dayStreak = dayStreak;

  /* ---------- Opstarten ---------- */
  function boot() {
    buildShell();
    // Geluid mag pas na een handeling van de gebruiker starten
    const unlock = () => { try { App.audio.ensure(); } catch (e) { /* geen geluid mogelijk */ } };
    document.addEventListener("pointerdown", unlock, { once: true, capture: true });
    document.addEventListener("keydown", unlock, { once: true, capture: true });
    window.addEventListener("hashchange", render);
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
