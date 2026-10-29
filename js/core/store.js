/* Maatwerk — opslag (App.store). Alles staat in localStorage van deze browser.
   Vorm van de sessies: zie docs/CONTRACT.md. */
(function () {
  const App = (window.App = window.App || {});
  const KEY = "maatwerk.v1";
  const listeners = new Set();
  let data = null;

  function blank() { return { version: 1, sessions: [], settings: {} }; }

  function load() {
    if (data) return data;
    try {
      const raw = localStorage.getItem(KEY);
      data = raw ? JSON.parse(raw) : blank();
      if (!Array.isArray(data.sessions)) data.sessions = [];
      if (!data.settings || typeof data.settings !== "object") data.settings = {};
    } catch (e) {
      console.warn("Opslag kon niet gelezen worden", e);
      data = blank();
    }
    return data;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Opslag kon niet geschreven worden", e);
      if (App.ui) App.ui.toast("Opslaan lukte niet: de browser blokkeert opslag.", "bad");
    }
    listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Bewaar een afgeronde sessie. Vult id, ts en version aan als die ontbreken. */
  function addSession(rec) {
    load();
    const full = Object.assign({ id: uid(), ts: Date.now(), version: 1 }, rec);
    if (!full.mode) throw new Error("addSession: 'mode' ontbreekt");
    data.sessions.push(full);
    save();
    return full;
  }

  /* Alle sessies (oudste eerst), optioneel alleen van één oefening. */
  function sessions(mode) {
    load();
    const list = mode ? data.sessions.filter((s) => s.mode === mode) : data.sessions.slice();
    return list.sort((a, b) => a.ts - b.ts);
  }

  function deleteSession(id) {
    load();
    data.sessions = data.sessions.filter((s) => s.id !== id);
    save();
  }

  /* Wis sessies; zonder mode alles. Instellingen blijven staan. */
  function clearSessions(mode) {
    load();
    data.sessions = mode ? data.sessions.filter((s) => s.mode !== mode) : [];
    save();
  }

  function getSetting(key, fallback) {
    load();
    return key in data.settings ? data.settings[key] : fallback;
  }

  function setSetting(key, value) {
    load();
    data.settings[key] = value;
    save();
  }

  /* Laatst gebruikte instellingen van een oefening onthouden. */
  function modeSettings(mode, defaults) {
    return Object.assign({}, defaults, getSetting("mode." + mode, {}));
  }
  function saveModeSettings(mode, settings) {
    setSetting("mode." + mode, settings);
  }

  function exportJSON() {
    load();
    return JSON.stringify({ app: "maatwerk", exportedAt: Date.now(), ...data }, null, 2);
  }

  /* Importeer een eerder geëxporteerd bestand. Sessies met een bekend id worden overgeslagen.
     Geeft het aantal nieuwe sessies terug. */
  function importJSON(text, { replaceSettings = false } = {}) {
    load();
    const inc = JSON.parse(text);
    if (!inc || !Array.isArray(inc.sessions)) throw new Error("Dit is geen Maatwerk-bestand.");
    const known = new Set(data.sessions.map((s) => s.id));
    let added = 0;
    for (const s of inc.sessions) {
      if (!s || !s.mode || !s.ts) continue;
      if (!s.id) s.id = uid();
      if (known.has(s.id)) continue;
      data.sessions.push(s);
      known.add(s.id);
      added++;
    }
    if (replaceSettings && inc.settings) data.settings = Object.assign({}, data.settings, inc.settings);
    save();
    return added;
  }

  /* Luister naar wijzigingen; geeft een functie terug om te stoppen. */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  App.store = {
    addSession, sessions, deleteSession, clearSessions,
    getSetting, setSetting, modeSettings, saveModeSettings,
    exportJSON, importJSON, subscribe,
  };
})();
