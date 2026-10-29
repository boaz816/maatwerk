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

  /* Schrijft alles weg. Geeft true terug als het lukte. */
  function save() {
    let ok = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      ok = false;
      console.warn("Opslag kon niet geschreven worden", e);
      if (App.ui) App.ui.toast("Opslaan lukte niet: de opslag van de browser is vol of geblokkeerd.", "bad");
    }
    listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    return ok;
  }

  function validSession(s) {
    return !!s && typeof s === "object" && typeof s.mode === "string" && s.mode.length > 0 &&
      Number.isFinite(s.ts) && s.ts > 0 && s.ts < 8.64e15;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Bewaar een afgeronde sessie. Vult id, ts en version aan als die ontbreken.
     Geeft het record terug, of null als opslaan mislukte. */
  function addSession(rec) {
    load();
    const full = Object.assign({ id: uid(), ts: Date.now(), version: 1 }, rec);
    if (!full.mode) throw new Error("addSession: 'mode' ontbreekt");
    data.sessions.push(full);
    // Lukt opslaan niet, dan ook niet in het geheugen laten staan (anders lijkt hij bewaard)
    if (!save()) { data.sessions.pop(); return null; }
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

  /* Meerdere sessies tegelijk verwijderen (één keer opslaan). ids: array, of een functie (sessie) → boolean. */
  function deleteSessions(ids) {
    load();
    const drop = typeof ids === "function" ? ids : ((set) => (s) => set.has(s.id))(new Set(ids));
    const before = data.sessions.length;
    data.sessions = data.sessions.filter((s) => !drop(s));
    save();
    return before - data.sessions.length;
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
    if (!inc || !Array.isArray(inc.sessions) || (inc.app && inc.app !== "maatwerk")) throw new Error("Dit is geen Maatwerk-bestand.");
    const known = new Set(data.sessions.map((s) => s.id));
    let added = 0;
    const backup = data.sessions.slice();
    const backupSettings = data.settings;
    for (const s of inc.sessions) {
      if (!validSession(s)) continue;
      if (!s.id) s.id = uid();
      if (known.has(s.id)) continue;
      data.sessions.push(s);
      known.add(s.id);
      added++;
    }
    if (replaceSettings && inc.settings) data.settings = Object.assign({}, data.settings, inc.settings);
    if (!save()) {
      data.sessions = backup;
      data.settings = backupSettings;
      throw new Error("Opslaan lukte niet: de opslag van de browser is vol.");
    }
    return added;
  }

  /* Luister naar wijzigingen; geeft een functie terug om te stoppen. */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  App.store = {
    addSession, sessions, deleteSession, deleteSessions, clearSessions,
    getSetting, setSetting, modeSettings, saveModeSettings,
    exportJSON, importJSON, subscribe,
  };
})();
