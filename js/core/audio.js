/* Maatwerk — geluid (App.audio) en muziekhulpjes (App.music).
   Alles via de Web Audio-klok: geluiden worden vooruit ingepland op een exacte tijd,
   zodat timing tot op de milliseconde klopt. Geen compressor in de keten: die geeft vertraging. */
(function () {
  const App = (window.App = window.App || {});
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  const active = new Set();

  /* ---------- Context ---------- */

  /* Maakt de AudioContext (pas na een klik of toets van de gebruiker) en hervat hem. */
  function ensure() {
    if (!ctx) {
      // iPhone/iPad: anders is alles stil als de stilteknop aan staat (Safari 16.4+)
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* niet ondersteund */ }
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: "interactive" });
      master = ctx.createGain();
      master.gain.value = volumeToGain(App.store ? App.store.getSetting("volume", 0.8) : 0.8);
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /* Wacht tot de context echt loopt (handig vlak voor een start). */
  async function ready() {
    const c = ensure();
    if (c.state !== "running") { try { await c.resume(); } catch (e) { /* negeren */ } }
    return c;
  }

  function now() { return ensure().currentTime; }

  function volumeToGain(v) { return Math.pow(Math.max(0, Math.min(1, v)), 2); }
  /* Volume zetten en bewaren. */
  function setVolume(v) {
    if (App.store) App.store.setSetting("volume", v);
    previewVolume(v);
  }
  /* Volume alleen hoorbaar aanpassen, zonder op te slaan (tijdens het schuiven). */
  function previewVolume(v) {
    if (master) master.gain.setTargetAtTime(volumeToGain(v), ctx.currentTime, 0.02);
  }

  /* Vertraging tussen inplannen en horen, zoals de browser die zelf opgeeft (seconden). */
  function outputLatency() {
    if (!ctx) return 0;
    return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  }

  function noise() {
    if (noiseBuf) return noiseBuf;
    const c = ensure();
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /* Envelop: 0 → peak in `atk` seconden, daarna exponentieel naar stil in `dec`. */
  function env(param, t, peak, atk, dec) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + atk);
    param.exponentialRampToValueAtTime(0.0001, t + atk + dec);
  }

  /* ---------- Geluiden ----------
     Alle functies: (tijd in AudioContext-seconden, opties). opts.dest = doelknoop (standaard master).
     opts.level = 0..1 (standaard 1). */

  /* Metronoomtik. accent: hogere, hardere tik (tel 1). voice: 'click' | 'wood' | 'beep'. */
  function click(t, opts = {}) {
    const c = ensure();
    const dest = opts.dest || master;
    const accent = !!opts.accent;
    const level = (opts.level ?? 1) * (accent ? 1 : 0.62);
    const voice = opts.voice || "click";

    const osc = c.createOscillator();
    const g = c.createGain();
    if (voice === "beep") {
      osc.type = "sine";
      osc.frequency.value = accent ? 1760 : 880;
      env(g.gain, t, level * 0.5, 0.002, 0.08);
    } else if (voice === "wood") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(accent ? 1400 : 950, t);
      osc.frequency.exponentialRampToValueAtTime(accent ? 900 : 650, t + 0.04);
      env(g.gain, t, level * 0.7, 0.001, 0.05);
    } else {
      osc.type = "sine";
      osc.frequency.value = accent ? 1568 : 1046.5;
      env(g.gain, t, level * 0.55, 0.001, 0.055);
    }
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.15);

    // Korte ruisflits voor een scherpe aanzet
    const n = c.createBufferSource();
    n.buffer = noise();
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = voice === "wood" ? 2200 : 4000;
    bp.Q.value = 1.2;
    const ng = c.createGain();
    env(ng.gain, t, level * (voice === "beep" ? 0.05 : 0.22), 0.0008, 0.012);
    n.connect(bp).connect(ng).connect(dest);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.03);
  }

  /* Drumgeluid. kind: 'kick' | 'snare' | 'hat' | 'openhat' | 'rim' | 'clap'. */
  function drum(t, kind = "kick", opts = {}) {
    const c = ensure();
    const dest = opts.dest || master;
    const level = opts.level ?? 1;

    if (kind === "kick") {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
      env(g.gain, t, level * 0.95, 0.002, 0.38);
      o.connect(g).connect(dest);
      o.start(t); o.stop(t + 0.45);
      noiseHit(t, dest, { type: "lowpass", freq: 1800, level: level * 0.25, dec: 0.012 });
      return;
    }
    if (kind === "snare") {
      noiseHit(t, dest, { type: "highpass", freq: 1400, level: level * 0.55, dec: 0.17 });
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
      env(g.gain, t, level * 0.45, 0.001, 0.09);
      o.connect(g).connect(dest);
      o.start(t); o.stop(t + 0.15);
      return;
    }
    if (kind === "hat") { noiseHit(t, dest, { type: "highpass", freq: 7500, level: level * 0.32, dec: 0.045 }); return; }
    if (kind === "openhat") { noiseHit(t, dest, { type: "highpass", freq: 7000, level: level * 0.26, dec: 0.28 }); return; }
    if (kind === "clap") {
      [0, 0.011, 0.022].forEach((d, i) => noiseHit(t + d, dest, { type: "bandpass", freq: 1500, q: 0.9, level: level * (i === 2 ? 0.55 : 0.35), dec: i === 2 ? 0.14 : 0.01 }));
      return;
    }
    if (kind === "rim") {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "square";
      o.frequency.value = 820;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 3;
      env(g.gain, t, level * 0.45, 0.0008, 0.035);
      o.connect(bp).connect(g).connect(dest);
      o.start(t); o.stop(t + 0.08);
      noiseHit(t, dest, { type: "bandpass", freq: 3500, level: level * 0.2, dec: 0.01 });
    }
  }

  function noiseHit(t, dest, { type, freq, q = 0.8, level, dec }) {
    const c = ensure();
    const n = c.createBufferSource();
    n.buffer = noise();
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    env(g.gain, t, level, 0.001, dec);
    n.connect(f).connect(g).connect(dest);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dec + 0.05);
  }

  /* Pianoachtige toon. midi: 60 = middelste C (C4). opts.dur = uitklinktijd in seconden. */
  function note(t, midi, opts = {}) {
    const c = ensure();
    const dest = opts.dest || master;
    const level = (opts.level ?? 1) * 0.32;
    const dur = opts.dur ?? 1.6;
    const f0 = midiToFreq(midi);

    const out = c.createGain();
    out.gain.value = 1;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(Math.min(f0 * 9, 14000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f0 * 2.2, 400), t + dur * 0.8);
    lp.connect(out).connect(dest);

    // Lagere tonen iets harder: oren horen ze zachter
    const loudness = Math.min(1.6, Math.max(0.75, Math.pow(440 / f0, 0.25)));
    const partials = [[1, 1], [2, 0.42], [3, 0.2], [4, 0.1], [5, 0.05], [6, 0.03]];
    partials.forEach(([k, amp], i) => {
      const f = f0 * k * (1 + 0.0004 * k * k); // pianosnaren zijn net iets 'te hoog' in de boventonen
      if (f > 16000) return;
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      if (i === 0) o.detune.value = -2;
      const g = c.createGain();
      const pd = dur / Math.pow(k, 0.6);
      env(g.gain, t, level * amp * loudness, 0.004, pd);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + pd + 0.1);
    });
    // Tweede grondtoon iets verstemd: maakt het levendiger
    const o2 = c.createOscillator();
    o2.type = "sine";
    o2.frequency.value = f0;
    o2.detune.value = 3;
    const g2 = c.createGain();
    env(g2.gain, t, level * 0.5 * loudness, 0.004, dur);
    o2.connect(g2).connect(lp);
    o2.start(t);
    o2.stop(t + dur + 0.1);
    // Hamertje
    noiseHit(t, lp, { type: "bandpass", freq: Math.min(f0 * 4, 6000), level: level * 0.25, dec: 0.015 });
  }

  /* ---------- Reeksen inplannen ----------
     events: [{ t: seconden vanaf start, kind: 'click'|'drum'|'note'|'mark', ...opties }]
       click: { accent, voice, level }     drum: { sound: 'kick'|..., level }
       note:  { midi, dur, level }          mark: geen geluid, alleen voor onEvent
     opts.lead: seconden tot de eerste tel (standaard 0.15)
     opts.startTime: exacte AudioContext-starttijd (overschrijft lead)
     opts.tail: extra seconden na het laatste event voordat 'done' afgaat
     opts.onEvent(ev, audioTime): wordt aangeroepen rond het moment dat je het event HOORT
     Geeft { startTime, endTime, stop(), done } terug. done = Promise<{completed: boolean}>. */
  function sequence(events, opts = {}) {
    const c = ensure();
    const bus = c.createGain();
    bus.connect(master);
    const list = events.slice().sort((a, b) => a.t - b.t);
    const start = opts.startTime ?? c.currentTime + (opts.lead ?? 0.15);
    const lastT = list.length ? list[list.length - 1].t : 0;
    const timeouts = new Set();
    let i = 0;
    let timer = null;
    let stopped = false;
    let resolveDone;
    const done = new Promise((r) => (resolveDone = r));

    const handle = {
      startTime: start,
      endTime: start + lastT + (opts.tail ?? 0),
      stop,
      done,
      get stopped() { return stopped; },
    };

    function later(fn, ms) {
      const id = setTimeout(() => { timeouts.delete(id); fn(); }, Math.max(0, ms));
      timeouts.add(id);
    }

    function pump() {
      if (stopped) return;
      const horizon = c.currentTime + 0.15;
      while (i < list.length && start + list[i].t < horizon) {
        const ev = list[i++];
        const at = start + ev.t;
        if (at >= c.currentTime - 0.01) play(ev, Math.max(at, c.currentTime), bus);
        if (opts.onEvent) later(() => { if (!stopped) opts.onEvent(ev, at); }, (at - c.currentTime + outputLatency()) * 1000);
      }
      if (i >= list.length && timer !== null) {
        clearInterval(timer);
        timer = null;
        later(finish, (handle.endTime - c.currentTime + outputLatency()) * 1000 + 30);
      }
    }

    function finish() {
      if (stopped) return;
      stopped = true;
      active.delete(handle);
      resolveDone({ completed: true });
      setTimeout(() => { try { bus.disconnect(); } catch (e) { /* al los */ } }, 4000);
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      timeouts.forEach(clearTimeout);
      timeouts.clear();
      bus.gain.setTargetAtTime(0, c.currentTime, 0.008);
      setTimeout(() => { try { bus.disconnect(); } catch (e) { /* al los */ } }, 120);
      active.delete(handle);
      resolveDone({ completed: false });
    }

    active.add(handle);
    timer = setInterval(pump, 25);
    pump();
    return handle;
  }

  function play(ev, at, dest) {
    const o = Object.assign({}, ev, { dest });
    if (ev.kind === "click") click(at, o);
    else if (ev.kind === "drum") drum(at, ev.sound || "kick", o);
    else if (ev.kind === "note") note(at, ev.midi, o);
    // 'mark' maakt geen geluid
  }

  /* Stop alles wat nu speelt (bij wisselen van pagina). */
  function stopAll() { Array.from(active).forEach((h) => h.stop()); }

  /* ---------- Timing van invoer ----------
     Zet een toets-/klikgebeurtenis om naar het AudioContext-moment dat de gebruiker op dat
     moment HOORDE. Zo is "te vroeg/te laat" eerlijk, ook als het geluid vertraging heeft. */
  function eventToAudioTime(evt) {
    const c = ensure();
    const stamp = evt && typeof evt.timeStamp === "number" && evt.timeStamp > 0 ? evt.timeStamp : performance.now();
    if (typeof c.getOutputTimestamp === "function") {
      const ts = c.getOutputTimestamp();
      if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
        return ts.contextTime + (stamp - ts.performanceTime) / 1000;
      }
    }
    return c.currentTime - outputLatency() - (performance.now() - stamp) / 1000;
  }

  /* Afwijking in ms tussen invoer en gepland moment, zonder kalibratie. + = te laat. */
  function rawOffsetMs(evt, scheduledAt) {
    return (eventToAudioTime(evt) - scheduledAt) * 1000;
  }

  /* Idem, gecorrigeerd met de kalibratie uit Instellingen (setting 'latencyMs'). */
  function offsetMs(evt, scheduledAt) {
    const cal = App.store ? App.store.getSetting("latencyMs", 0) : 0;
    return rawOffsetMs(evt, scheduledAt) - cal;
  }

  App.audio = {
    ensure, ready, now, setVolume, previewVolume, outputLatency,
    click, drum, note, sequence, stopAll,
    eventToAudioTime, rawOffsetMs, offsetMs,
    get context() { return ctx; },
  };

  /* ---------- Muziekhulpjes ---------- */
  const NAMES = {
    sharp: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"],
    flat: ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"],
    // Nederlandse namen: B = B, Bes = B♭ (niet zoals in het Duits)
    nl: ["C", "Cis", "D", "Es", "E", "F", "Fis", "G", "As", "A", "Bes", "B"],
  };

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function pc(midi) { return ((midi % 12) + 12) % 12; }
  function octave(midi) { return Math.floor(midi / 12) - 1; }
  /* Naam van een toonklasse (0 = C). style: 'auto' volgt de instelling 'noteNames'. */
  function noteName(pitchClass, style = "auto") {
    const s = style === "auto" ? (App.store ? App.store.getSetting("noteNames", "sharp") : "sharp") : style;
    return (NAMES[s] || NAMES.sharp)[pc(pitchClass)];
  }
  /* "A4", "C♯3" */
  function midiLabel(midi, style = "auto") { return noteName(pc(midi), style) + octave(midi); }
  const isBlack = (pitchClass) => [1, 3, 6, 8, 10].includes(pc(pitchClass));

  App.music = { NAMES, midiToFreq, pc, octave, noteName, midiLabel, isBlack };
})();
