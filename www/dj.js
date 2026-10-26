// ══════════════════════════════════════════════
// ── DJ MODE ──
// Two decks, each an <audio> element routed through its own Web Audio chain
//   filter knob (low-pass / high-pass) → sweep filter → deck gain → crossfader gain
//   with an echo send (delay + feedback) that also comes back through the crossfader,
// all mixed into a master gain and a limiter. It runs beside the main player, not
// through it: opening DJ hands the playing song to deck A, and pressing play in the
// player (or on the lock screen) stops the decks.
//   Per deck: play/pause, cue, 4 hot cues (saved per song), an A–B loop (in / out /
//   reloop, halve, double), tempo ±8/16/50 % with key lock and hold-to-nudge, filter.
//   Pads: echo, filter sweep and stutter while held; brake slows a deck to a stop.
//   BPM: guessed from the audio when a song loads (or tapped in), ½ / ×2 fix a half- or
//   double-time guess, SYNC sets this deck's tempo to match the other deck's. With a
//   BPM, the quick loop is counted in beats.
// Loops and stutters are kept by seeking from an animation-frame loop, so they land
// within a frame (~16 ms) — fine by ear, not sample-exact. Uses app.v2.js globals.
// ══════════════════════════════════════════════
(() => {
    const overlay = $("dj-overlay"), body = $("dj-body"), picker = $("dj-picker");
    if (!overlay || !body || !picker) return;

    const CUES_KEY = "spootify-dj-cues", SETTINGS_KEY = "spootify-dj", BPM_KEY = "spootify-dj-bpm";
    const CUE_COLORS = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6"];
    const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7-11-7Z"/></svg>';
    const PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z"/></svg>';
    const settings = { volume: 0.9, target: "both" };
    try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch {}
    const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };
    let cueStore = {};
    try { cueStore = JSON.parse(localStorage.getItem(CUES_KEY) || "{}") || {}; } catch { cueStore = {}; }
    const saveCues = () => { try { localStorage.setItem(CUES_KEY, JSON.stringify(cueStore)); } catch {} };
    let bpmStore = {}; // song key → { bpm, tapped }
    try { bpmStore = JSON.parse(localStorage.getItem(BPM_KEY) || "{}") || {}; } catch { bpmStore = {}; }
    const saveBpm = () => { try { localStorage.setItem(BPM_KEY, JSON.stringify(bpmStore)); } catch {} };

    let ctx = null, master = null, xfade = -100, autoFade = null, raf = null, open = false;
    const decks = { a: makeDeck("a"), b: makeDeck("b") };
    const deckList = [decks.a, decks.b];

    function makeDeck(id) {
        const audio = new Audio();
        audio.preload = "auto";
        const d = { id, audio, song: null, key: null, peaks: null, duration: 0, loadToken: 0,
            tempo: 0, range: 8, keyLock: false, bend: 0, cue: 0, loop: null, loopIn: null, autoLen: 4, autoBeats: 4, filter: 0,
            bpm: 0, bpmBusy: false, taps: [],
            stutter: null, brake: null, nodes: null, els: null, wave: null, waveDirty: true };
        audio.addEventListener("loadedmetadata", () => { d.duration = audio.duration || d.duration; d.waveDirty = true; renderDeck(d); });
        for (const ev of ["play", "pause", "ended"]) audio.addEventListener(ev, () => { renderDeck(d); if (ev === "play") startLoop(); });
        audio.addEventListener("error", () => { if (d.song && open) showToast(`Deck ${id.toUpperCase()} couldn't play that song`); });
        return d;
    }

    // ── Markup ──
    const deckHtml = (id) => `
        <section class="dj-deck is-empty" data-deck="${id}" style="grid-area:${id}">
            <div class="dj-deck-head">
                <span class="dj-deck-badge">${id.toUpperCase()}</span>
                <img class="dj-deck-art" src="${DEFAULT_ART}" alt="">
                <div class="dj-deck-text"><strong class="dj-deck-title">Empty deck</strong><span class="dj-deck-artist">Load a song to start</span></div>
                <button type="button" class="utility-btn dj-load" data-act="load">Load</button>
            </div>
            <div class="dj-wave" title="Tap or drag to jump"><canvas></canvas><span class="dj-wave-empty">No song loaded</span></div>
            <div class="dj-times"><span class="dj-time">0:00</span><span class="dj-tempo-read">0.0%</span><span class="dj-remain">-0:00</span></div>
            <div class="dj-transport">
                <button type="button" class="dj-play" data-act="play" aria-label="Play">${PLAY_SVG}</button>
                <button type="button" class="dj-btn dj-cue" data-act="cue" title="Paused: set the cue point here. Playing: jump back to it and stop.">CUE</button>
                <div class="dj-hotcues">${[0, 1, 2, 3].map((i) => `<button type="button" class="dj-hotcue" data-cue="${i}" style="--cue:${CUE_COLORS[i]}" title="Hot cue ${i + 1}: tap to set, tap again to jump. Hold (or right-click) to clear.">${i + 1}</button>`).join("")}</div>
            </div>
            <div class="dj-row">
                <span class="dj-row-label">Loop</span>
                <div class="dj-row-controls">
                    <button type="button" class="dj-btn" data-act="loop-in" title="Mark where the loop starts">IN</button>
                    <button type="button" class="dj-btn" data-act="loop-out" title="Mark where it ends and start looping">OUT</button>
                    <button type="button" class="dj-btn dj-loop-toggle" data-act="loop" title="Loop on / off (with no loop marked, loops the next few seconds)">LOOP</button>
                    <button type="button" class="dj-btn dj-small" data-act="loop-half" aria-label="Halve the loop">&frac12;</button>
                    <span class="dj-loop-len">4 s</span>
                    <button type="button" class="dj-btn dj-small" data-act="loop-double" aria-label="Double the loop">&times;2</button>
                </div>
            </div>
            <div class="dj-row dj-row-wrap">
                <span class="dj-row-label">Tempo</span>
                <div class="dj-row-controls dj-tempo-controls">
                    <button type="button" class="dj-btn dj-small dj-bend" data-bend="-1" title="Hold to nudge slower">&minus;</button>
                    <input type="range" class="settings-slider dj-tempo" min="-8" max="8" step="0.1" value="0" aria-label="Tempo" title="Double-click to reset">
                    <button type="button" class="dj-btn dj-small dj-bend" data-bend="1" title="Hold to nudge faster">+</button>
                    <div class="segmented dj-range">${[8, 16, 50].map((r) => `<button type="button" data-range="${r}">&plusmn;${r}</button>`).join("")}</div>
                    <label class="dj-keylock" title="Keep the key when the tempo changes"><input type="checkbox" class="dj-keylock-input"> Key lock</label>
                </div>
            </div>
            <div class="dj-row">
                <span class="dj-row-label">BPM</span>
                <div class="dj-row-controls">
                    <span class="dj-bpm-read" title="Beats per minute at the current tempo">&ndash;</span>
                    <button type="button" class="dj-btn" data-act="tap" title="Tap along to the beat to set the BPM">TAP</button>
                    <button type="button" class="dj-btn dj-small" data-act="bpm-half" title="Half the BPM (the guess was double time)">&frac12;</button>
                    <button type="button" class="dj-btn dj-small" data-act="bpm-double" title="Double the BPM (the guess was half time)">&times;2</button>
                    <button type="button" class="dj-btn dj-sync" data-act="sync" title="Match this deck's tempo to the other deck">SYNC</button>
                </div>
            </div>
            <div class="dj-row">
                <span class="dj-row-label">Filter</span>
                <div class="dj-row-controls">
                    <span class="dj-filter-end">LOW</span>
                    <input type="range" class="settings-slider dj-filter" min="-100" max="100" step="1" value="0" aria-label="Filter" title="Left cuts the highs, right cuts the lows. Double-click to reset.">
                    <span class="dj-filter-end">HIGH</span>
                </div>
            </div>
        </section>`;
    body.innerHTML = deckHtml("a") + `
        <section class="dj-mixer" style="grid-area:mix">
            <div class="dj-xfade-wrap">
                <span class="dj-xf-label" data-side="a">A</span>
                <input type="range" id="dj-xfade" class="dj-xfade" min="-100" max="100" step="1" value="-100" aria-label="Crossfader" title="Double-click to centre">
                <span class="dj-xf-label" data-side="b">B</span>
            </div>
            <div class="dj-mixer-row">
                <button type="button" class="dj-btn dj-autofade" id="dj-autofade" title="Glide the crossfader over to the other deck in 8 seconds">Auto-fade &#8644;</button>
                <label class="dj-volume" title="DJ volume">${ICONS.volume}<input type="range" id="dj-volume" class="settings-slider" min="0" max="100" step="1" aria-label="DJ volume"></label>
            </div>
        </section>` + deckHtml("b") + `
        <section class="dj-fx" style="grid-area:fx">
            <div class="dj-fx-head">
                <span class="dj-row-label">Effects</span>
                <div class="segmented" id="dj-fx-target"><button type="button" data-value="a">Deck A</button><button type="button" data-value="both">Both</button><button type="button" data-value="b">Deck B</button></div>
            </div>
            <div class="dj-pads">
                <button type="button" class="dj-pad" data-fx="echo"><strong>Echo</strong><span>hold</span></button>
                <button type="button" class="dj-pad" data-fx="sweep"><strong>Sweep</strong><span>hold</span></button>
                <button type="button" class="dj-pad" data-fx="stutter"><strong>Stutter</strong><span>hold</span></button>
                <button type="button" class="dj-pad" data-fx="brake"><strong>Brake</strong><span>tap</span></button>
            </div>
        </section>`;
    for (const d of deckList) {
        const root = body.querySelector(`.dj-deck[data-deck="${d.id}"]`);
        const q = (sel) => root.querySelector(sel);
        d.els = { root, art: q(".dj-deck-art"), title: q(".dj-deck-title"), artist: q(".dj-deck-artist"), wave: q(".dj-wave"), canvas: q("canvas"),
            time: q(".dj-time"), remain: q(".dj-remain"), tempoRead: q(".dj-tempo-read"), play: q(".dj-play"), cues: [...root.querySelectorAll(".dj-hotcue")],
            loopLen: q(".dj-loop-len"), loopIn: q('[data-act="loop-in"]'), loopOut: q('[data-act="loop-out"]'), loopToggle: q(".dj-loop-toggle"),
            tempo: q(".dj-tempo"), range: q(".dj-range"), keyLock: q(".dj-keylock-input"), filter: q(".dj-filter"),
            bpm: q(".dj-bpm-read"), sync: q('[data-act="sync"]'), tap: q('[data-act="tap"]') };
    }
    const xfadeEl = $("dj-xfade"), volumeEl = $("dj-volume"), autoFadeBtn = $("dj-autofade");
    volumeEl.value = Math.round(settings.volume * 100); updateSliderFill(volumeEl);

    // ── Audio graph ──
    function ensureCtx() {
        if (ctx) { if (ctx.state === "suspended") ctx.resume().catch(() => {}); return true; }
        const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return false;
        try {
            ctx = new Ctx({ latencyHint: "interactive" });
            master = ctx.createGain(); master.gain.value = settings.volume;
            const limiter = ctx.createDynamicsCompressor();
            limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.15;
            master.connect(limiter); limiter.connect(ctx.destination);
            for (const d of deckList) buildChain(d);
            applyXfade();
        } catch (e) { console.warn("DJ audio engine unavailable", e); ctx = null; return false; }
        return true;
    }
    const nyquist = () => (ctx ? ctx.sampleRate / 2 - 100 : 22000);
    function buildChain(d) {
        const src = ctx.createMediaElementSource(d.audio);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = nyquist(); lp.Q.value = 0.7;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 10; hp.Q.value = 0.7;
        const sweep = ctx.createBiquadFilter(); sweep.type = "lowpass"; sweep.frequency.value = nyquist(); sweep.Q.value = 0.7;
        const pre = ctx.createGain(), xf = ctx.createGain(), send = ctx.createGain(); send.gain.value = 0;
        const delay = ctx.createDelay(2); delay.delayTime.value = 0.375;
        const feedback = ctx.createGain(); feedback.gain.value = 0.5;
        const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 3200; // each repeat a little darker
        src.connect(lp); lp.connect(hp); hp.connect(sweep); sweep.connect(pre); pre.connect(xf); xf.connect(master);
        pre.connect(send); send.connect(delay); delay.connect(tone); tone.connect(feedback); feedback.connect(delay); tone.connect(xf);
        d.nodes = { lp, hp, sweep, xf, send };
        applyFilter(d);
    }
    function applyFilter(d) {
        if (!d.nodes) return;
        const t = ctx.currentTime, v = d.filter / 100, top = nyquist();
        const lpF = v < 0 ? Math.max(150, top * Math.pow(150 / top, -v)) : top;
        const hpF = v > 0 ? 10 * Math.pow(500, v) : 10; // up to 5 kHz
        d.nodes.lp.frequency.setTargetAtTime(lpF, t, 0.015);
        d.nodes.hp.frequency.setTargetAtTime(hpF, t, 0.015);
        const q = 0.7 + Math.abs(v) * 2;
        d.nodes.lp.Q.setTargetAtTime(v < 0 ? q : 0.7, t, 0.02);
        d.nodes.hp.Q.setTargetAtTime(v > 0 ? q : 0.7, t, 0.02);
    }
    // Equal-power crossfade, so the middle isn't a dip in volume.
    function applyXfade() {
        const x = (xfade + 100) / 200, gA = Math.cos((x * Math.PI) / 2), gB = Math.sin((x * Math.PI) / 2);
        if (ctx && decks.a.nodes) {
            const t = ctx.currentTime;
            decks.a.nodes.xf.gain.setTargetAtTime(gA, t, 0.01); decks.b.nodes.xf.gain.setTargetAtTime(gB, t, 0.01);
        } else { decks.a.audio.volume = gA * settings.volume; decks.b.audio.volume = gB * settings.volume; }
        if (Number(xfadeEl.value) !== xfade) xfadeEl.value = xfade;
        body.querySelectorAll(".dj-xf-label").forEach((el) => { el.style.opacity = (0.35 + 0.65 * (el.dataset.side === "a" ? gA : gB)).toFixed(2); });
    }

    // ── Transport ──
    function setPitch(el, keep) {
        if ("preservesPitch" in el) el.preservesPitch = keep;
        if ("mozPreservesPitch" in el) el.mozPreservesPitch = keep;
        if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = keep;
    }
    const rateOf = (d) => clamp(1 + (d.tempo + d.bend) / 100, 0.25, 4);
    function applyRate(d) {
        if (d.brake) return;
        try { d.audio.playbackRate = rateOf(d); } catch {}
        setPitch(d.audio, d.keyLock);
    }
    const durationOf = (d) => d.audio.duration || d.duration || 0;
    function seek(d, t) {
        if (!d.song) return;
        const pos = clamp(t, 0, Math.max(0, durationOf(d) - 0.05));
        try { d.audio.currentTime = pos; } catch {}
        if (d.loop && d.loop.on && (pos < d.loop.a - 0.01 || pos > d.loop.b)) d.loop.on = false; // jumping out of a loop leaves it
        if (d.stutter) { d.stutter.at = pos; d.stutter.t0 = performance.now(); }
        renderDeck(d);
    }
    function play(d) {
        if (!d.song) { openPicker(d); return; }
        ensureCtx();
        if (typeof isAudiblyPlaying === "function" && isAudiblyPlaying()) { pausePlayback(); updatePlayPauseIcon(); updateMediaSessionMetadata(); }
        cancelBrake(d);
        const p = d.audio.play();
        if (p && p.catch) p.catch(() => {});
        startLoop();
    }
    function pause(d) { endStutter(d, false); cancelBrake(d); d.audio.pause(); }
    function cuePress(d) {
        if (!d.song) return;
        if (d.audio.paused) { d.cue = d.audio.currentTime || 0; haptic(8); flash(d.els.root.querySelector(".dj-cue")); }
        else { d.audio.pause(); seek(d, d.cue); }
        renderDeck(d);
    }
    function flash(el) { if (!el) return; el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }

    async function loadDeck(d, song, opts = {}) {
        if (!song) return;
        const token = ++d.loadToken;
        if (!song.fileSrc && song.mediaId) song.fileSrc = await getBlobUrl(song.mediaId);
        if (!song.fileSrc) { showToast("This song's audio is missing from the library"); return; }
        if (!song.art && song.artId) song.art = (await getBlobUrl(song.artId)) || DEFAULT_ART;
        if (token !== d.loadToken) return;
        endStutter(d, false); cancelBrake(d);
        d.song = song; d.key = statsKeyFor(song); d.peaks = null; d.loop = null; d.loopIn = null;
        d.bpm = bpmStore[d.key]?.bpm || 0; d.taps = [];
        d.cue = opts.at || 0; d.duration = song.duration || 0; d.waveDirty = true;
        d.audio.src = song.fileSrc;
        applyRate(d);
        d.audio.addEventListener("loadedmetadata", () => {
            if (token !== d.loadToken) return;
            if (opts.at) { try { d.audio.currentTime = opts.at; } catch {} }
            if (opts.play) play(d);
            renderDeck(d);
        }, { once: true });
        renderDeck(d);
        if (song.mediaId) {
            const key = d.key, needBpm = !d.bpm;
            d.bpmBusy = needBpm; renderBpm(d);
            getBlob(song.mediaId).then((blob) => (blob ? decodeLowRate(blob) : null)).then((audio) => {
                if (!audio || token !== d.loadToken) return;
                d.peaks = peaksFromAudio(audio, 1200).peaks; if (!d.duration) d.duration = audio.duration;
                d.waveDirty = true; drawDeck(d);
                if (needBpm) {
                    const bpm = detectBpm(audio);
                    if (bpm && !bpmStore[key]) { bpmStore[key] = { bpm }; saveBpm(); }
                    if (token === d.loadToken && !d.bpm) d.bpm = bpmStore[key]?.bpm || 0;
                }
            }).catch((e) => console.warn("DJ waveform failed", e)).finally(() => { if (token === d.loadToken) { d.bpmBusy = false; renderDeck(d); } });
        }
    }

    // ── Hot cues ──
    const cueList = (d) => (d.key && cueStore[d.key]) || null;
    function hotCue(d, i) {
        if (!d.song) { openPicker(d); return; }
        const list = cueList(d);
        if (!list || list[i] == null) {
            const next = list || (cueStore[d.key] = [null, null, null, null]);
            next[i] = Math.round((d.audio.currentTime || 0) * 100) / 100;
            saveCues(); haptic(10);
        } else {
            seek(d, list[i]);
            if (d.audio.paused) play(d);
        }
        renderDeck(d);
    }
    function clearHotCue(d, i) {
        const list = cueList(d); if (!list || list[i] == null) return;
        list[i] = null;
        if (list.every((v) => v == null)) delete cueStore[d.key];
        saveCues(); haptic(15); renderDeck(d);
        showToast(`Hot cue ${i + 1} cleared`);
    }

    // ── Loops ──
    function fmtLen(s) { return s >= 10 ? `${Math.round(s)} s` : s >= 1 ? `${+s.toFixed(2)} s` : `${Math.round(s * 1000)} ms`; }
    function loopIn(d) {
        if (!d.song) return;
        d.loopIn = d.audio.currentTime || 0;
        if (d.loop) d.loop.on = false;
        haptic(8); renderDeck(d);
    }
    function loopOut(d) {
        if (!d.song) return;
        const t = d.audio.currentTime || 0;
        const a = d.loopIn != null ? d.loopIn : d.loop ? d.loop.a : null;
        if (a == null || t - a < 0.05) { showToast("Press IN at the start of the loop, then OUT at its end"); return; }
        d.loop = { a, b: t, on: true }; d.loopIn = null;
        seek(d, a); d.loop.on = true;
        haptic(8); renderDeck(d);
    }
    function loopToggle(d) {
        if (!d.song) return;
        if (d.loop && d.loop.on) d.loop.on = false;
        else if (d.loop) {
            const t = d.audio.currentTime || 0;
            if (t < d.loop.a || t > d.loop.b) seek(d, d.loop.a);
            d.loop.on = true;
        } else {
            const a = d.audio.currentTime || 0, end = durationOf(d) - 0.05;
            if (end - a < 0.1) return;
            d.loop = { a, b: Math.min(end, a + autoLoopLen(d)), on: true }; d.loopIn = null;
        }
        haptic(8); renderDeck(d);
    }
    function loopResize(d, factor) {
        if (d.loop) {
            const len = clamp((d.loop.b - d.loop.a) * factor, 0.03, 64);
            d.loop.b = Math.min(d.loop.a + len, durationOf(d) - 0.05);
            if (d.loop.on && d.audio.currentTime > d.loop.b) seek(d, d.loop.a);
        } else if (d.bpm) d.autoBeats = clamp(d.autoBeats * factor, 0.125, 64);
        else d.autoLen = clamp(d.autoLen * factor, 0.125, 32);
        renderDeck(d);
    }
    // The quick loop: so many beats when the deck has a BPM, otherwise seconds.
    const autoLoopLen = (d) => (d.bpm ? (d.autoBeats * 60) / d.bpm : d.autoLen);
    function fmtBeats(n) { return n >= 1 ? `${+n.toFixed(2)} beat${n === 1 ? "" : "s"}` : `1/${Math.round(1 / n)} beat`; }

    // ── BPM ──
    // Onset envelope (frame energy rises, local mean removed) from up to a minute in the
    // middle of the song, autocorrelated over 60–200 BPM with a gentle pull towards
    // ~120 and credit for agreeing with half time; the peak is refined between frames.
    function detectBpm(audio) {
        try {
            const sr = audio.sampleRate, data = audio.getChannelData(0), hop = Math.max(1, Math.round(sr / 200)), fps = sr / hop;
            const len = data.length, start = len > sr * 90 ? Math.floor(len * 0.25) : 0, end = Math.min(len, start + sr * 60);
            const n = Math.floor((end - start) / hop); if (n < fps * 8) return 0;
            const env = new Float32Array(n);
            for (let i = 0; i < n; i++) { let sum = 0; const a = start + i * hop; for (let j = 0; j < hop * 2 && a + j < end; j++) { const v = data[a + j]; sum += v * v; } env[i] = Math.log1p(sum * 1000); }
            const on = new Float32Array(n); for (let i = 1; i < n; i++) on[i] = Math.max(0, env[i] - env[i - 1]);
            const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + on[i];
            const W = Math.round(fps * 0.1), flux = new Float32Array(n);
            for (let i = 0; i < n; i++) { const a = Math.max(0, i - W), b = Math.min(n, i + W + 1); flux[i] = Math.max(0, on[i] - (pre[b] - pre[a]) / (b - a)); }
            const minL = Math.floor((fps * 60) / 200), maxL = Math.ceil((fps * 60) / 60), top = Math.min(n - 1, maxL * 2 + 2);
            const ac = new Float32Array(top + 1);
            for (let L = minL - 1; L <= top; L++) { let sum = 0; for (let i = L; i < n; i++) sum += flux[i] * flux[i - L]; ac[L] = sum / (n - L); }
            let best = 0, bestScore = 0;
            for (let L = minL; L <= maxL; L++) {
                if (!(ac[L] >= ac[L - 1] && ac[L] >= ac[L + 1])) continue;
                const bpm = (60 * fps) / L, pull = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.85, 2));
                const score = (ac[L] + 0.5 * (ac[2 * L] || 0)) * pull;
                if (score > bestScore) { bestScore = score; best = L; }
            }
            if (!best) return 0;
            const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1], den = y0 - 2 * y1 + y2;
            let bpm = (60 * fps) / (best + (den ? (0.5 * (y0 - y2)) / den : 0));
            while (bpm < 70) bpm *= 2;
            while (bpm >= 180) bpm /= 2;
            const whole = Math.round(bpm); // most music sits on a whole BPM
            return Math.abs(bpm - whole) < 0.25 ? whole : Math.round(bpm * 10) / 10;
        } catch (e) { console.warn("BPM detection failed", e); return 0; }
    }
    const liveBpm = (d) => (d.bpm ? d.bpm * rateOf(d) : 0);
    function setBpm(d, bpm, tapped) {
        if (!d.song || !(bpm > 20 && bpm < 400)) return;
        d.bpm = Math.round(bpm * 10) / 10;
        bpmStore[d.key] = { bpm: d.bpm, tapped: !!tapped || !!bpmStore[d.key]?.tapped }; saveBpm();
        renderDeck(d);
    }
    // Taps more than 2 s apart start over; the average of the last 8 intervals is the tempo
    // you're hearing, so it's divided by the deck's speed to get the song's own BPM.
    function tapBpm(d) {
        if (!d.song) { openPicker(d); return; }
        const now = performance.now();
        if (d.taps.length && now - d.taps[d.taps.length - 1] > 2000) d.taps = [];
        d.taps.push(now); if (d.taps.length > 9) d.taps.shift();
        flash(d.els.tap); haptic(6);
        if (d.taps.length < 3) { setText(d.els.bpm, `tap ${4 - d.taps.length} more`); return; }
        const gaps = d.taps.slice(1).map((t, i) => t - d.taps[i]), avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        setBpm(d, 60000 / avg / rateOf(d), true);
    }
    // Pick the tempo that lands this deck on the other deck's live BPM (or half / double
    // it, whichever needs the smaller change), widening the tempo range if it has to.
    function syncDeck(d) {
        const other = d === decks.a ? decks.b : decks.a;
        if (!d.song || !other.song) { showToast("Load a song on both decks first"); return; }
        if (!d.bpm || !other.bpm) { showToast(d.bpm ? `Deck ${other.id.toUpperCase()} needs a BPM: tap one in` : "This deck needs a BPM: tap one in"); return; }
        const target = liveBpm(other);
        const options = [target, target / 2, target * 2].map((t) => (t / d.bpm - 1) * 100);
        const pct = options.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
        if (Math.abs(pct) > 50) { showToast("The tempos are too far apart to sync"); return; }
        if (Math.abs(pct) > d.range) d.range = [8, 16, 50].find((r) => r >= Math.abs(pct));
        d.tempo = Math.round(pct * 100) / 100;
        applyRate(d); renderDeck(d); flash(d.els.sync); haptic(10);
    }
    function renderBpm(d) {
        const e = d.els; if (!e || !e.bpm) return;
        const live = liveBpm(d);
        setText(e.bpm, d.song ? (live ? `${live.toFixed(1)} BPM` : d.bpmBusy ? "finding BPM..." : "no BPM yet") : "\u2013");
        e.bpm.classList.toggle("off-zero", !!live && Math.abs(live - d.bpm) >= 0.05);
        e.bpm.title = d.bpm ? `${d.bpm.toFixed(1)} BPM at normal speed${bpmStore[d.key]?.tapped ? " (tapped)" : " (guessed from the audio)"}` : "Beats per minute at the current tempo";
        const other = d === decks.a ? decks.b : decks.a, inSync = !!live && !!liveBpm(other) && [1, 0.5, 2].some((k) => Math.abs(live - liveBpm(other) * k) < 0.05);
        e.sync.classList.toggle("is-active", inSync);
    }

    // ── Pads ──
    const fxTargets = () => (settings.target === "a" ? [decks.a] : settings.target === "b" ? [decks.b] : deckList).filter((d) => d.song);
    function setEcho(d, on) {
        if (!d.nodes) return;
        d.nodes.send.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, on ? 0.02 : 0.05);
    }
    function setSweep(d, on) {
        if (!d.nodes) return;
        const f = d.nodes.sweep.frequency, q = d.nodes.sweep.Q, t = ctx.currentTime, top = nyquist();
        const now = clamp(f.value, 100, top);
        f.cancelScheduledValues(t); q.cancelScheduledValues(t);
        f.setValueAtTime(now, t);
        if (on) { f.exponentialRampToValueAtTime(300, t + 1.8); q.setTargetAtTime(6, t, 0.25); }
        else { f.exponentialRampToValueAtTime(top, t + 0.35); q.setTargetAtTime(0.7, t, 0.08); }
    }
    // Stutter repeats the 120 ms it was pressed at; on release the deck jumps to where
    // the song would have been ("slip"), so the phrasing carries on as if uninterrupted.
    function startStutter(d) {
        if (!d.song || d.audio.paused || d.stutter) return;
        d.stutter = { at: d.audio.currentTime || 0, len: 0.12, t0: performance.now(), rate: d.audio.playbackRate || 1 };
        startLoop();
    }
    function endStutter(d, slip = true) {
        const s = d.stutter; if (!s) return;
        d.stutter = null;
        if (slip && !d.audio.paused) {
            let to = s.at + ((performance.now() - s.t0) / 1000) * s.rate;
            if (d.loop && d.loop.on && to > d.loop.b) to = d.loop.a + ((to - d.loop.a) % Math.max(0.03, d.loop.b - d.loop.a));
            try { d.audio.currentTime = clamp(to, 0, Math.max(0, durationOf(d) - 0.05)); } catch {}
        }
    }
    function startBrake(d) {
        if (!d.song || d.audio.paused || d.brake) return;
        endStutter(d, false);
        d.brake = { t0: performance.now(), from: d.audio.playbackRate || 1, ms: 1100 };
        setPitch(d.audio, false);
        startLoop();
    }
    function stepBrake(d, now) {
        const b = d.brake, p = Math.min(1, (now - b.t0) / b.ms), rate = b.from * Math.pow(1 - p, 1.5);
        if (p >= 1 || rate < 0.08) { d.brake = null; d.audio.pause(); applyRate(d); renderDeck(d); return; }
        try { d.audio.playbackRate = rate; } catch {}
    }
    function cancelBrake(d) { if (!d.brake) return; d.brake = null; applyRate(d); }

    // ── Animation loop: loops, stutter, brake, auto-fade and the waveforms ──
    function startLoop() { if (!raf && open) raf = requestAnimationFrame(tick); }
    function tick(now) {
        raf = null;
        let busy = !!autoFade;
        for (const d of deckList) {
            const a = d.audio;
            if (d.brake) { stepBrake(d, now); busy = true; }
            if (d.song && !a.paused) {
                busy = true;
                const t = a.currentTime, ahead = 0.018 * (a.playbackRate || 1); // about a frame early, so the jump lands on time
                if (d.stutter) { if (t >= d.stutter.at + d.stutter.len - ahead || t < d.stutter.at - 0.25) a.currentTime = d.stutter.at; }
                else if (d.loop && d.loop.on && t >= d.loop.b - ahead) a.currentTime = d.loop.a + Math.max(0, t - d.loop.b);
            }
            drawDeck(d);
        }
        if (autoFade) {
            const p = Math.min(1, (now - autoFade.t0) / autoFade.ms);
            xfade = Math.round(autoFade.from + (autoFade.to - autoFade.from) * (p * p * (3 - 2 * p)));
            applyXfade(); updateSliderFill(xfadeEl);
            if (p >= 1) { autoFade = null; autoFadeBtn.classList.remove("is-active"); }
        }
        if (busy && open) raf = requestAnimationFrame(tick);
    }

    // ── Drawing ──
    function deckColor(d) {
        const v = getComputedStyle(overlay).getPropertyValue(d.id === "a" ? "--deck-a" : "--deck-b").trim();
        return v || (d.id === "a" ? "#1DB954" : "#f97316");
    }
    function buildWave(d, W, H) {
        const make = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
        const dim = make(), lit = make();
        if (d.peaks) {
            const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg-rgb").trim() || "255, 255, 255";
            const n = d.peaks.length, mid = H / 2, gd = dim.getContext("2d"), gl = lit.getContext("2d"), bar = Math.max(1, Math.round(W / 300));
            gd.fillStyle = `rgba(${fg}, 0.28)`; gl.fillStyle = deckColor(d);
            for (let x = 0; x < W; x += bar + 1) {
                const i0 = Math.floor((x / W) * n), i1 = Math.max(i0 + 1, Math.floor(((x + bar) / W) * n));
                let m = 0; for (let i = i0; i < i1 && i < n; i++) if (d.peaks[i] > m) m = d.peaks[i];
                const h = Math.max(1, m * (H * 0.46));
                gd.fillRect(x, mid - h, bar, h * 2); gl.fillRect(x, mid - h, bar, h * 2);
            }
        }
        d.wave = { W, H, dim, lit };
    }
    function drawDeck(d) {
        if (!d.els || !open) return;
        const dur = durationOf(d), t = d.audio.currentTime || 0;
        setText(d.els.time, formatTime(t));
        setText(d.els.remain, "-" + formatTime(Math.max(0, dur - t)));
        const c = d.els.canvas, wrap = d.els.wave, dpr = window.devicePixelRatio || 1;
        const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
        const W = Math.round(w * dpr), H = Math.round(h * dpr);
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; d.waveDirty = true; }
        if (d.waveDirty || !d.wave) { buildWave(d, W, H); d.waveDirty = false; }
        const g = c.getContext("2d");
        g.clearRect(0, 0, W, H);
        if (!d.song) return;
        const X = (s) => (dur ? (s / dur) * W : 0), px = X(t), color = deckColor(d);
        if (d.peaks) {
            g.drawImage(d.wave.dim, 0, 0);
            if (px > 0) g.drawImage(d.wave.lit, 0, 0, px, H, 0, 0, px, H);
        } else { g.fillStyle = "rgba(128,128,128,0.25)"; g.fillRect(0, H / 2 - dpr, W, 2 * dpr); }
        if (d.loop) {
            const x1 = X(d.loop.a), x2 = Math.max(x1 + 2 * dpr, X(d.loop.b));
            g.fillStyle = d.loop.on ? "rgba(250, 204, 21, 0.22)" : "rgba(250, 204, 21, 0.1)";
            g.fillRect(x1, 0, x2 - x1, H);
            g.fillStyle = d.loop.on ? "#facc15" : "rgba(250, 204, 21, 0.5)";
            g.fillRect(x1, 0, 2 * dpr, H); g.fillRect(x2 - 2 * dpr, 0, 2 * dpr, H);
        }
        if (d.loopIn != null) { g.fillStyle = "#facc15"; g.fillRect(X(d.loopIn), 0, 2 * dpr, H); }
        (cueList(d) || []).forEach((v, i) => {
            if (v == null) return;
            const x = X(v); g.fillStyle = CUE_COLORS[i];
            g.fillRect(x, 0, 2 * dpr, H);
            g.fillRect(x, 0, 9 * dpr, 9 * dpr);
        });
        if (d.cue > 0) {
            const x = X(d.cue); g.fillStyle = "rgba(255,255,255,0.85)";
            g.beginPath(); g.moveTo(x - 5 * dpr, H); g.lineTo(x + 5 * dpr, H); g.lineTo(x, H - 7 * dpr); g.closePath(); g.fill();
        }
        g.fillStyle = color; g.fillRect(px - dpr, 0, 2 * dpr, H);
        g.fillStyle = "#fff"; g.fillRect(px - dpr / 2, 0, dpr, H);
    }
    function renderDeck(d) {
        if (!d.els) return;
        const e = d.els, s = d.song, playing = !!s && !d.audio.paused;
        e.root.classList.toggle("is-empty", !s);
        e.root.classList.toggle("is-playing", playing);
        if (s) {
            if (e.art.getAttribute("src") !== (s.art || DEFAULT_ART)) e.art.src = s.art || DEFAULT_ART;
            setText(e.title, s.title || "Unknown"); setText(e.artist, s.artist || "Unknown Artist");
        } else { setText(e.title, "Empty deck"); setText(e.artist, "Load a song to start"); }
        e.play.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
        e.play.setAttribute("aria-label", playing ? "Pause" : "Play");
        const list = cueList(d);
        e.cues.forEach((b, i) => {
            const v = list ? list[i] : null;
            b.classList.toggle("set", v != null);
            b.title = v != null ? `Hot cue ${i + 1} at ${formatTime(v)}: tap to jump, hold (or right-click) to clear` : `Hot cue ${i + 1}: tap to set it here`;
        });
        e.loopIn.classList.toggle("is-active", d.loopIn != null);
        e.loopToggle.classList.toggle("is-active", !!(d.loop && d.loop.on));
        setText(e.loopLen, d.loop ? (d.bpm ? fmtBeats(Math.round(((d.loop.b - d.loop.a) * d.bpm) / 60 * 8) / 8) : fmtLen(d.loop.b - d.loop.a)) : d.bpm ? fmtBeats(d.autoBeats) : fmtLen(d.autoLen));
        const r = d.range;
        if (Number(e.tempo.max) !== r) { e.tempo.min = -r; e.tempo.max = r; }
        if (document.activeElement !== e.tempo) e.tempo.value = d.tempo;
        updateBipolarFill(e.tempo);
        e.range.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.range) === r));
        e.keyLock.checked = d.keyLock;
        const shown = d.tempo + d.bend;
        setText(e.tempoRead, `${shown > 0 ? "+" : ""}${shown.toFixed(1)}%`);
        e.tempoRead.classList.toggle("off-zero", Math.abs(shown) >= 0.05);
        if (document.activeElement !== e.filter) e.filter.value = d.filter;
        updateBipolarFill(e.filter);
        renderBpm(d);
        const other = d === decks.a ? decks.b : decks.a; if (other.els) renderBpm(other); // its SYNC light depends on this deck
        drawDeck(d);
    }

    // ── Song picker ──
    let pickerDeck = null;
    const pickerList = $("dj-picker-list"), pickerSearch = $("dj-picker-search");
    function librarySongs() {
        const seen = new Set(), out = [];
        for (const name of getOrderedPlaylistNames()) for (const s of playlists[name].songs || []) {
            const k = statsKeyFor(s); if (seen.has(k) || !(s.mediaId || s.fileSrc)) continue;
            seen.add(k); out.push({ song: s, key: k });
        }
        return out;
    }
    function openPicker(d) {
        pickerDeck = d;
        setText($("dj-picker-title"), `Load to deck ${d.id.toUpperCase()}`);
        pickerSearch.value = "";
        renderPicker();
        picker.hidden = false;
        if (!isMobile()) setTimeout(() => pickerSearch.focus(), 30);
    }
    function closePicker() { picker.hidden = true; pickerDeck = null; }
    function renderPicker() {
        const terms = normalizeText(pickerSearch.value).split(/\s+/).filter(Boolean);
        let list = librarySongs();
        if (terms.length) list = list.filter(({ song }) => { const h = normalizeText(`${song.title} ${song.artist}`); return terms.every((t) => h.includes(t)); });
        // Nothing typed: what you've played most recently first, then A–Z.
        list.sort((a, b) => terms.length ? cmpText(a.song.title, b.song.title)
            : ((listenStats[b.key]?.lastPlayed || 0) - (listenStats[a.key]?.lastPlayed || 0)) || cmpText(a.song.title, b.song.title));
        if (!list.length) { pickerList.innerHTML = `<div class="stats-empty">${terms.length ? "Nothing matches" : "Your library is empty — add some songs first"}</div>`; return; }
        const other = pickerDeck === decks.a ? decks.b : decks.a;
        pickerList.innerHTML = list.slice(0, 200).map(({ song, key }) => `<div class="stats-row dj-pick" data-key="${escapeHtml(key)}">
            <img src="${escapeHtml(song.art || DEFAULT_ART)}" alt="" loading="lazy">
            <div class="stats-row-info"><strong>${escapeHtml(song.title || "Unknown")}</strong><span>${escapeHtml(song.artist || "Unknown Artist")}${other.key === key ? ` · on deck ${other.id.toUpperCase()}` : ""}</span></div>
            <div class="stats-row-nums">${formatTime(song.duration)}</div></div>`).join("");
    }
    let pickerTimer = null;
    pickerSearch.addEventListener("input", () => { clearTimeout(pickerTimer); pickerTimer = setTimeout(renderPicker, 80); });
    pickerList.addEventListener("click", (e) => {
        const row = e.target.closest(".dj-pick"); if (!row || !pickerDeck) return;
        const hit = librarySongs().find((x) => x.key === row.dataset.key);
        const d = pickerDeck; closePicker();
        if (hit) loadDeck(d, hit.song);
    });
    $("dj-picker-close").addEventListener("click", closePicker);
    picker.addEventListener("click", (e) => { if (e.target === picker) closePicker(); });

    // ── Wiring ──
    const deckOf = (el) => decks[el.closest(".dj-deck")?.dataset.deck];
    body.addEventListener("click", (e) => {
        const actEl = e.target.closest("[data-act]");
        if (actEl) {
            const d = deckOf(actEl); if (!d) return;
            const act = actEl.dataset.act;
            if (act === "load") openPicker(d);
            else if (act === "play") { if (d.audio.paused || d.brake) play(d); else pause(d); }
            else if (act === "cue") cuePress(d);
            else if (act === "loop-in") loopIn(d);
            else if (act === "loop-out") loopOut(d);
            else if (act === "loop") loopToggle(d);
            else if (act === "loop-half") loopResize(d, 0.5);
            else if (act === "loop-double") loopResize(d, 2);
            else if (act === "tap") tapBpm(d);
            else if (act === "bpm-half") { if (d.bpm) setBpm(d, d.bpm / 2); }
            else if (act === "bpm-double") { if (d.bpm) setBpm(d, d.bpm * 2); }
            else if (act === "sync") syncDeck(d);
            return;
        }
        const range = e.target.closest(".dj-range button");
        if (range) {
            const d = deckOf(range); d.range = Number(range.dataset.range) || 8;
            d.tempo = clamp(d.tempo, -d.range, d.range); applyRate(d); renderDeck(d); return;
        }
        const cue = e.target.closest(".dj-hotcue");
        if (cue && e.detail === 0) hotCue(deckOf(cue), Number(cue.dataset.cue)); // keyboard
        const target = e.target.closest("#dj-fx-target button");
        if (target) { settings.target = target.dataset.value; saveSettings(); syncTarget(); return; }
        if (e.target.closest("#dj-autofade")) {
            if (autoFade) { autoFade = null; autoFadeBtn.classList.remove("is-active"); return; }
            autoFade = { from: xfade, to: xfade <= 0 ? 100 : -100, t0: performance.now(), ms: 8000 };
            autoFadeBtn.classList.add("is-active"); startLoop();
        }
    });
    body.addEventListener("input", (e) => {
        const t = e.target;
        if (t.classList.contains("dj-tempo")) { const d = deckOf(t); d.tempo = Math.round(Number(t.value) * 10) / 10; applyRate(d); renderDeck(d); }
        else if (t.classList.contains("dj-filter")) { const d = deckOf(t); d.filter = Number(t.value); applyFilter(d); updateBipolarFill(t); }
        else if (t === xfadeEl) { autoFade = null; autoFadeBtn.classList.remove("is-active"); xfade = Number(t.value); applyXfade(); }
        else if (t === volumeEl) { settings.volume = Number(t.value) / 100; updateSliderFill(t); if (master) master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.02); else applyXfade(); saveSettings(); }
    });
    body.addEventListener("change", (e) => {
        if (e.target.classList.contains("dj-keylock-input")) { const d = deckOf(e.target); d.keyLock = e.target.checked; applyRate(d); }
        if (e.target.classList.contains("dj-tempo")) renderDeck(deckOf(e.target));
    });
    body.addEventListener("dblclick", (e) => {
        const t = e.target;
        if (t.classList.contains("dj-tempo")) { const d = deckOf(t); d.tempo = 0; applyRate(d); renderDeck(d); }
        else if (t.classList.contains("dj-filter")) { const d = deckOf(t); d.filter = 0; applyFilter(d); renderDeck(d); }
        else if (t === xfadeEl) { autoFade = null; xfade = 0; applyXfade(); }
    });
    // Press-and-hold controls: hot cues (hold clears), tempo nudges and the pads.
    let hold = null;
    body.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const cue = e.target.closest(".dj-hotcue"), bend = e.target.closest(".dj-bend"), pad = e.target.closest(".dj-pad");
        if (cue) {
            const d = deckOf(cue), i = Number(cue.dataset.cue);
            hold = { kind: "cue", el: cue, fired: false };
            hold.timer = setTimeout(() => { if (hold && hold.el === cue) { hold.fired = true; clearHotCue(d, i); } }, 550);
        } else if (bend) {
            const d = deckOf(bend);
            d.bend = Number(bend.dataset.bend) * (d.range >= 16 ? 6 : 4);
            applyRate(d); renderDeck(d);
            hold = { kind: "bend", el: bend, deck: d };
        } else if (pad) {
            ensureCtx();
            const fx = pad.dataset.fx, targets = fxTargets();
            if (!targets.length) { showToast("Load a song first"); return; }
            pad.classList.add("is-active"); haptic(10);
            if (fx === "brake") { targets.forEach(startBrake); setTimeout(() => pad.classList.remove("is-active"), 300); return; }
            targets.forEach((d) => (fx === "echo" ? setEcho(d, true) : fx === "sweep" ? setSweep(d, true) : startStutter(d)));
            hold = { kind: "pad", el: pad, fx, targets };
        } else return;
        try { e.target.closest("button").setPointerCapture(e.pointerId); } catch {}
    });
    const endHold = (e, cancelled) => {
        if (!hold) return;
        const h = hold; hold = null;
        clearTimeout(h.timer);
        if (h.kind === "cue") { if (!h.fired && !cancelled) hotCue(deckOf(h.el), Number(h.el.dataset.cue)); }
        else if (h.kind === "bend") { h.deck.bend = 0; applyRate(h.deck); renderDeck(h.deck); }
        else if (h.kind === "pad") {
            h.el.classList.remove("is-active");
            h.targets.forEach((d) => (h.fx === "echo" ? setEcho(d, false) : h.fx === "sweep" ? setSweep(d, false) : endStutter(d, true)));
        }
    };
    body.addEventListener("pointerup", (e) => endHold(e, false));
    body.addEventListener("pointercancel", (e) => endHold(e, true));
    body.addEventListener("contextmenu", (e) => {
        const cue = e.target.closest(".dj-hotcue, .dj-pad, .dj-bend"); if (!cue) return;
        e.preventDefault();
        if (cue.classList.contains("dj-hotcue")) { if (hold) { clearTimeout(hold.timer); hold = null; } clearHotCue(deckOf(cue), Number(cue.dataset.cue)); }
    });
    // Tap or drag on a waveform to move through the song.
    for (const d of deckList) {
        let dragging = false;
        const at = (e) => { const r = d.els.wave.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * durationOf(d); };
        d.els.wave.addEventListener("pointerdown", (e) => {
            if (!d.song || !durationOf(d)) return;
            dragging = true; try { d.els.wave.setPointerCapture(e.pointerId); } catch {}
            seek(d, at(e));
        });
        d.els.wave.addEventListener("pointermove", (e) => { if (dragging) seek(d, at(e)); });
        const stop = () => { dragging = false; };
        d.els.wave.addEventListener("pointerup", stop); d.els.wave.addEventListener("pointercancel", stop);
    }
    function syncTarget() { body.querySelectorAll("#dj-fx-target button").forEach((b) => b.classList.toggle("active", b.dataset.value === settings.target)); }
    syncTarget();
    window.addEventListener("resize", throttle(() => { if (open) deckList.forEach((d) => { d.waveDirty = true; drawDeck(d); }); }, 120));

    // ── Reset ── every knob back to how a fresh session starts; loaded songs and hot cues stay.
    function resetDefaults() {
        autoFade = null; autoFadeBtn.classList.remove("is-active");
        for (const d of deckList) {
            endStutter(d, false); cancelBrake(d);
            Object.assign(d, { tempo: 0, bend: 0, range: 8, keyLock: false, filter: 0, loop: null, loopIn: null, autoLen: 4, autoBeats: 4, cue: 0, taps: [] });
            if (d.nodes) {
                setEcho(d, false);
                d.nodes.sweep.frequency.cancelScheduledValues(ctx.currentTime); d.nodes.sweep.frequency.setValueAtTime(nyquist(), ctx.currentTime);
                d.nodes.sweep.Q.cancelScheduledValues(ctx.currentTime); d.nodes.sweep.Q.setValueAtTime(0.7, ctx.currentTime);
            }
            applyRate(d); applyFilter(d); renderDeck(d);
        }
        body.querySelectorAll(".dj-pad.is-active").forEach((p) => p.classList.remove("is-active"));
        settings.volume = 0.9; settings.target = "both"; saveSettings();
        volumeEl.value = 90; updateSliderFill(volumeEl);
        if (master) master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.02);
        const onlyB = !decks.b.audio.paused && decks.a.audio.paused; // don't silence the deck you're listening to
        xfade = onlyB ? 100 : -100; applyXfade(); updateSliderFill(xfadeEl);
        syncTarget(); haptic(12);
        showToast("DJ reset to defaults");
    }
    $("dj-reset-btn")?.addEventListener("click", resetDefaults);

    // ── Open / close ──
    function openDj() {
        overlay.hidden = false; open = true;
        document.body.classList.add("dj-open");
        ensureCtx();
        // Whatever the player is playing carries on, on deck A (or B if A is busy).
        if (currentTrack && isAudiblyPlaying()) {
            const song = currentTrack, at = audioPlayer.currentTime || 0;
            pausePlayback(); updatePlayPauseIcon(); updateMediaSessionMetadata();
            const d = decks.a.audio.paused ? decks.a : decks.b;
            if (d.key === statsKeyFor(song)) { seek(d, at); play(d); } else loadDeck(d, song, { at, play: true });
            xfade = d.id === "a" ? -100 : 100;
        } else if (!decks.a.song && currentTrack) loadDeck(decks.a, currentTrack, { at: audioPlayer.currentTime || 0 });
        applyXfade(); updateSliderFill(xfadeEl);
        deckList.forEach((d) => { d.waveDirty = true; renderDeck(d); });
        startLoop();
    }
    function stopAll() {
        if (!deckList.some((d) => d.song)) return; // called on every play in the main player
        for (const d of deckList) {
            endStutter(d, false); cancelBrake(d);
            if (!d.audio.paused) d.audio.pause();
            if (d.nodes) { setEcho(d, false); d.nodes.sweep.frequency.cancelScheduledValues(ctx.currentTime); d.nodes.sweep.frequency.setValueAtTime(nyquist(), ctx.currentTime); }
        }
        autoFade = null; autoFadeBtn.classList.remove("is-active");
        body.querySelectorAll(".dj-pad.is-active").forEach((p) => p.classList.remove("is-active"));
    }
    function closeDj() {
        closePicker(); stopAll();
        overlay.hidden = true; open = false;
        document.body.classList.remove("dj-open");
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        if (ctx && ctx.state === "running") ctx.suspend().catch(() => {}); // nothing to hear; saves battery
    }
    $("dj-close-btn").addEventListener("click", closeDj);
    const openBtn = $("dj-open-btn");
    if (openBtn) { openBtn.addEventListener("click", openDj); openBtn.hidden = appearance.showDj === false; }

    window.SpootifyDJ = {
        open: openDj, close: closeDj, stopAll,
        isOpen: () => open,
        isPlaying: () => deckList.some((d) => d.song && !d.audio.paused),
        back: () => { if (!picker.hidden) closePicker(); else closeDj(); },
        mediaIds: () => deckList.map((d) => d.song && d.song.mediaId).filter(Boolean),
        detectBpm
    };
})();
