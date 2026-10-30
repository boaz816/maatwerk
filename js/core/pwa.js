/* Maatwerk — als app op je telefoon: werkt zonder internet (sw.js) en meldt het als er een nieuwe
   versie online staat. Doet niets als je index.html los opent of lokaal ontwikkelt (versie "dev"). */
(function () {
  const App = (window.App = window.App || {});
  const meta = document.querySelector('meta[name="maatwerk-version"]');
  const versie = (meta && meta.content) || "dev";
  App.version = versie;
  if (versie === "dev" || !/^https?:$/.test(location.protocol)) return;

  const sw = "serviceWorker" in navigator ? navigator.serviceWorker : null;
  if (sw) sw.register("sw.js").catch((e) => console.warn("Zonder internet spelen lukt hier niet", e));

  // Als app op het beginscherm: vraag de browser je scores niet zomaar op te ruimen.
  // Niet in een gewoon tabblad, want Firefox stelt daar meteen een vraag over.
  const alsApp = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (alsApp && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------- Nieuwe versie? ---------- */
  const MIN_TUSSENPOOS = 60 * 1000;
  let laatst = 0;
  let gemeld = false;

  async function kijkOfErIetsNieuwsIs() {
    if (gemeld || document.hidden || Date.now() - laatst < MIN_TUSSENPOOS) return;
    laatst = Date.now();
    try {
      const res = await fetch("version.json", { cache: "no-store" });
      if (!res.ok) return;
      const online = (await res.json()).version;
      if (online && online !== versie) meld(online);
    } catch (e) { /* geen internet: later opnieuw */ }
  }

  /* Niet midden in een oefening: dan wachten tot de speelstand voorbij is (en tijdens spelen verborgen, zie base.css). */
  function meld(online) {
    if (gemeld) return;
    gemeld = true;
    const toon = () => {
      if (document.body.classList.contains("is-playing")) return false;
      const main = document.querySelector(".main");
      if (!main) return false;
      main.prepend(balk(online));
      return true;
    };
    if (toon()) return;
    const kijker = new MutationObserver(() => { if (toon()) kijker.disconnect(); });
    kijker.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  function balk(online) {
    const { h, icon } = App.ui;
    const knop = h("button", { class: "btn btn-primary", type: "button", onClick: () => werkBij(online, knop) }, "Bijwerken");
    const el = h("div", { class: "update-bar", role: "status" },
      h("span", null, "Er is een nieuwe versie van Maatwerk."),
      h("div", { class: "update-bar-acties" },
        knop,
        h("button", { class: "btn btn-ghost btn-icon", type: "button", "aria-label": "Later", title: "Later", onClick: () => el.remove() }, icon("x", 18))
      )
    );
    return el;
  }

  /* Wacht tot de nieuwe versie helemaal binnen is en de service worker hem heeft overgenomen, dan herladen. */
  async function werkBij(online, knop) {
    knop.disabled = true;
    knop.textContent = "Even geduld…";
    try {
      if (sw && sw.controller && (await swVersie()) !== online) {
        const reg = await sw.getRegistration();
        await new Promise((klaar) => {
          sw.addEventListener("controllerchange", klaar, { once: true });
          setTimeout(klaar, 20000);
          if (reg) reg.update().catch(klaar);
          else klaar();
        });
      }
    } catch (e) { /* dan gewoon herladen */ }
    location.reload();
  }

  function swVersie() {
    return new Promise((klaar) => {
      const kanaal = new MessageChannel();
      kanaal.port1.onmessage = (e) => klaar(e.data);
      sw.controller.postMessage("versie", [kanaal.port2]);
      setTimeout(() => klaar(null), 1000);
    });
  }

  document.addEventListener("visibilitychange", kijkOfErIetsNieuwsIs);
  setInterval(kijkOfErIetsNieuwsIs, 30 * 60 * 1000);
  // Pas als de schil er staat (app.js bouwt die bij DOMContentLoaded)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", kijkOfErIetsNieuwsIs);
  else kijkOfErIetsNieuwsIs();
})();
