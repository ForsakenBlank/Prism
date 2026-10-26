// ══════════════════════════════════════════════
// ── THEMES ──
// Loaded in <head>, before the body renders, so the saved theme is on screen from
// the very first paint (no flash of the default colours). A theme is a handful of
// inputs (mode, background style + colours, accent…) that buildVars() expands into
// every CSS custom property style.css uses. On top of that sits the background
// layer (#theme-bg, and a copy inside the full-screen player): colour dots, a
// picture (yours, or the playing song's cover), grain and a vignette, painted by
// paintLayer(). Pictures live in their own IndexedDB store; a tiny blurred
// thumbnail is kept in the theme so the first paint isn't empty while it loads.
// app.v2.js drives the Appearance tab and the theme editor through window.SpootifyThemes.
// ══════════════════════════════════════════════
(function () {
    const SETTINGS_KEY = "spootify-appearance";
    const CUSTOM_KEY = "spootify-custom-themes";

    const DEFAULT_SETTINGS = {
        theme: "spootify", accent: null, artColors: true, visualizer: "bars",
        compact: false, cardSize: "m", reduceMotion: false, nativeColorPicker: false,
        showStats: true, miniChart: true, showRecent: true, showAdded: true, showSongOfDay: true, showDj: true, showRated: true,
        starsInLists: true, starsOnPlayer: true, vizExtreme: false, animations: true, showQuiet: true,
        quietArt: true, quietText: true, quietProgress: true, quietButtons: true, quietDrift: false, quietSmooth: false
    };

    // style: classic = solid app + tinted main panel (the original look);
    //        linear / glow / aurora = the colours paint the whole window; plain = just the base colour.
    // glass: panels are see-through so the background runs behind them.
    const BASE_THEMES = [
        { id: "spootify", name: "Prism", mode: "dark", style: "classic", bg: "#0a0a0a", colors: ["#1a1a2e"],
          accent: "#1DB954", accentHi: "#1ed760", accentInk: "#1ed760", onAccent: "#ffffff", onAccentIcon: "#000000" },
        { id: "midnight", name: "Midnight", mode: "dark", style: "aurora", bg: "#070718", surface: "#0d0c26",
          colors: ["#3b2a9e", "#6d28d9", "#0e7490"], glass: true, accent: "#a78bfa", accent2: "#22d3ee" },
        { id: "ember", name: "Ember", mode: "dark", style: "glow", bg: "#120807", surface: "#1a0c0a",
          colors: ["#9a3412", "#9d174d", "#7c2d12"], glass: true, accent: "#fb923c", accent2: "#f43f5e" },
        { id: "neon", name: "OLED Neon", mode: "dark", style: "glow", bg: "#000000", surface: "#000000",
          colors: ["#4a0843", "#053447", "#16002b"], glass: false, accent: "#ff3cac", accent2: "#2bd2ff" },
        { id: "cloud", name: "Cloud", mode: "light", style: "linear", angle: 160, bg: "#f3f5fb", surface: "#f6f7fc",
          colors: ["#dde6ff", "#eee4ff", "#fde6f2"], glass: true, accent: "#4f46e5", accent2: "#9333ea" },
        { id: "peach", name: "Peach", mode: "light", style: "glow", bg: "#fff5ee", surface: "#fff8f3",
          colors: ["#fdd2ad", "#fbcde6", "#ffe2c4"], glass: true, accent: "#ea580c", accent2: "#db2777" },
        { id: "mint", name: "Mint", mode: "light", style: "aurora", bg: "#effaf5", surface: "#f3fbf7",
          colors: ["#b5efd4", "#c0e5fb", "#fcefc0"], glass: true, accent: "#059669", accent2: "#0284c7" }
    ];

    const FONTS = {
        default: { name: "Default", stack: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif" },
        modern: { name: "Modern", stack: "system-ui, 'Segoe UI Variable Text', Roboto, 'Helvetica Neue', sans-serif" },
        serif: { name: "Serif", stack: "Georgia, 'Noto Serif', 'Times New Roman', serif" },
        mono: { name: "Mono", stack: "'Cascadia Code', Consolas, 'Roboto Mono', 'Droid Sans Mono', monospace" },
        condensed: { name: "Condensed", stack: "'Bahnschrift SemiCondensed', 'Roboto Condensed', sans-serif-condensed, 'Arial Narrow', sans-serif" },
        wide: { name: "Wide", stack: "Verdana, 'Trebuchet MS', 'DejaVu Sans', sans-serif" },
        playful: { name: "Playful", stack: "'Comic Sans MS', 'Coming Soon', 'Chalkboard SE', casual, cursive" }
    };
    const STYLES = ["classic", "linear", "glow", "aurora", "plain"];

    // ── Elements ── one part of the app restyled per theme (Theme editor → Elements).
    // fields: [key, type, label, default, extra]; colour defaults of "accent"/"accent2"
    // take the theme's own. "when" hides a field until that toggle is on. vars() turns a
    // filled-in element into the --el-* properties the html[data-el-*] rules in style.css use.
    const paint = (e) => (e.grad ? `linear-gradient(90deg, ${e.c}, ${e.c2})` : `linear-gradient(${e.c}, ${e.c})`);
    const ELEMENTS = {
        stars: { name: "Star ratings", fields: [["c", "color", "Colour", "#f5c542"], ["grad", "toggle", "Gradient", false], ["c2", "color", "Fade to", "#ff6b6b", { when: "grad" }], ["glow", "toggle", "Glow", false]],
            vars: (e) => ({ "--el-stars": e.c, "--el-stars-paint": paint(e), "--el-stars-glow": e.glow ? `drop-shadow(0 0 4px ${rgba(e.c, 0.8)})` : "none" }) },
        progress: { name: "Progress bars & sliders", fields: [["c", "color", "Fill", "accent"], ["grad", "toggle", "Gradient", true], ["c2", "color", "Fade to", "accent2", { when: "grad" }], ["track", "color", "Track", "#3a3a3a"], ["thumb", "color", "Knob", "#ffffff"], ["size", "select", "Thickness", "normal", { options: [["thin", "Thin"], ["normal", "Normal"], ["thick", "Thick"]] }]],
            vars: (e) => ({ "--el-progress-paint": paint(e), "--el-progress-track": e.track, "--el-progress-thumb": e.thumb, "--el-progress-h": e.size === "thin" ? "2px" : e.size === "thick" ? "7px" : "4px" }) },
        play: { name: "Play buttons", fields: [["c", "color", "Colour", "accent"], ["grad", "toggle", "Gradient", false], ["c2", "color", "Fade to", "accent2", { when: "grad" }], ["icon", "color", "Icon", "#000000"], ["shape", "select", "Shape", "round", { options: [["round", "Round"], ["rounded", "Rounded"], ["square", "Square"]] }], ["glow", "toggle", "Glow", false]],
            vars: (e) => ({ "--el-play-paint": e.grad ? `linear-gradient(135deg, ${e.c}, ${e.c2})` : e.c, "--el-play-icon": e.icon, "--el-play-radius": e.shape === "square" ? "6px" : e.shape === "rounded" ? "30%" : "50%", "--el-play-glow": e.glow ? `0 0 18px ${rgba(e.c, 0.65)}` : "0 4px 12px rgba(0, 0, 0, 0.35)" }) },
        like: { name: "Like hearts", fields: [["c", "color", "Colour", "#ff4d6d"], ["glow", "toggle", "Glow", false]],
            vars: (e) => ({ "--el-like": e.c, "--el-like-glow": e.glow ? `drop-shadow(0 0 5px ${rgba(e.c, 0.8)})` : "none" }) },
        titles: { name: "Headings", fields: [["c", "color", "Colour", "#ffffff"], ["grad", "toggle", "Gradient", true], ["c2", "color", "Fade to", "accent", { when: "grad" }]],
            vars: (e) => ({ "--el-titles": e.c, "--el-titles-paint": paint(e) }) },
        // Starred (pinned) playlists keep their gold look unless "Starred playlists too" is on;
        // then they take this style with an outline of their own colour so they still stand out.
        cards: { name: "Playlist cards", fields: [["c", "color", "Background", "#ffffff"], ["alpha", "range", "Opacity", 5, { min: 0, max: 100, unit: "%" }], ["radius", "range", "Corners", 10, { min: 0, max: 28, unit: "px" }], ["border", "toggle", "Outline", false], ["bc", "color", "Outline colour", "accent", { when: "border" }], ["bw", "range", "Outline width", 2, { min: 1, max: 5, unit: "px", when: "border" }], ["glow", "toggle", "Glow", false], ["pinned", "toggle", "Starred playlists too", false], ["pc", "color", "Starred outline", "#f5c542", { when: "pinned" }]],
            flags: (e) => ({ elCardsPinned: e.pinned ? "1" : "0" }),
            vars: (e) => ({ "--el-cards-bg": rgba(e.c, e.alpha / 100), "--el-cards-radius": `${e.radius}px`, "--el-cards-outline": e.border ? `${e.bw}px solid ${e.bc}` : "0 solid transparent", "--el-cards-offset": e.border ? `-${e.bw}px` : "0px", "--el-cards-glow": e.glow ? `0 0 18px ${rgba(e.border ? e.bc : e.c, 0.55)}` : "none",
                "--el-cards-pin-outline": `${Math.max(2, e.bw)}px solid ${e.pc}`, "--el-cards-pin-offset": `-${Math.max(2, e.bw)}px`, "--el-cards-pin-glow": e.glow ? `0 0 18px ${rgba(e.pc, 0.55)}` : `0 4px 18px ${rgba(e.pc, 0.15)}` }) },
        playing: { name: "Now-playing highlight", fields: [["c", "color", "Colour", "accent"], ["grad", "toggle", "Gradient", false], ["c2", "color", "Fade to", "accent2", { when: "grad" }]],
            vars: (e) => ({ "--el-playing": e.c, "--el-playing-paint": paint(e) }) },
        // The grey details under and beside song titles, which some backgrounds swallow.
        // "All faded text" recolours every secondary text in the app the same way.
        songText: { name: "Song details & faded text", fields: [["artist", "color", "Artists", "text"], ["length", "color", "Lengths, times & dates", "text"], ["num", "color", "Track numbers", "text"],
                ["all", "toggle", "All faded text too", false], ["faded", "color", "Faded text", "text", { when: "all" }]],
            vars: (e) => Object.assign({ "--el-song-artist": e.artist, "--el-song-length": e.length, "--el-song-num": e.num },
                e.all ? { "--text-2": e.faded, "--text-3": e.faded, "--text-4": e.faded, "--text-5": e.faded } : {}) },
        scrollbar: { name: "Scrollbars", fields: [["c", "color", "Colour", "accent"], ["width", "select", "Width", "normal", { options: [["thin", "Thin"], ["normal", "Normal"], ["wide", "Wide"]] }]],
            vars: (e) => ({ "--el-scrollbar": e.c, "--el-scrollbar-w": e.width === "thin" ? "5px" : e.width === "wide" ? "12px" : "8px" }) }
    };
    function elementDefaults(id, t) {
        const def = ELEMENTS[id], e = {}, accent = (t && t.accent) || "#1db954", accent2 = (t && t.accent2) || hslToHex(hexToHsl(accent)[0] + 45, 0.8, 0.62);
        // "text": a readable light grey on dark themes, a dark grey on light ones.
        const text = t && t.mode === "light" ? "#3d414b" : "#d2d4da";
        for (const [k, type, , d] of def.fields) e[k] = type === "color" ? (d === "accent" ? accent : d === "accent2" ? accent2 : d === "text" ? text : d) : d;
        return e;
    }
    function sanitizeElement(id, raw, t) {
        const e = elementDefaults(id, t);
        if (!raw || typeof raw !== "object") return e;
        for (const [k, type, , , x] of ELEMENTS[id].fields) {
            const v = raw[k];
            if (type === "color") { if (isHex(v)) e[k] = v.toLowerCase(); }
            else if (type === "toggle") { if (v != null) e[k] = !!v; }
            else if (type === "range") e[k] = num(v, x.min, x.max, e[k]);
            else if (type === "select") { if (x.options.some(([o]) => o === v)) e[k] = v; }
        }
        return e;
    }
    const MAX_COLORS = 6, MAX_DOTS = 12, MAX_SPOTS = 6;

    // ── colour helpers ──
    function hexToRgb(hex) {
        let h = String(hex || "").trim().replace(/^#/, "");
        if (h.length === 3) h = h.split("").map((c) => c + c).join("");
        if (!/^[0-9a-f]{6}/i.test(h)) return [0, 0, 0];
        const n = parseInt(h.slice(0, 6), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgbToHex(rgb) { return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
    function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A.map((v, i) => v + (B[i] - v) * t)); }
    function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r}, ${g}, ${b}, ${+(+a).toFixed(3)})`; }
    function lum(hex) {
        const c = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function contrast(a, b) { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
    function readableOn(bg) { return contrast(bg, "#000000") >= contrast(bg, "#ffffff") ? "#000000" : "#ffffff"; }
    // Nudge a colour toward black/white until it reads on the given background.
    function inkFor(color, bg, min) {
        let c = color; const toward = lum(bg) > 0.35 ? "#000000" : "#ffffff";
        for (let i = 0; i < 14 && contrast(c, bg) < min; i++) c = mix(c, toward, 0.12);
        return c;
    }
    function hexToHsl(hex) {
        const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
        const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
        if (max === min) return [0, 0, l];
        const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return [h * 60, s, l];
    }
    function hslToHex(h, s, l) {
        h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
        const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
        const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
    }
    const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
    const num = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };

    // Where glow / aurora put each colour: [x %, y %, width %, height %, strength, fade %].
    const GLOW_SPOTS = [[0, 0, 110, 80, 0.9, 62], [100, 100, 95, 75, 0.85, 62], [100, 0, 60, 50, 0.55, 70], [0, 100, 70, 60, 0.6, 70], [50, 50, 60, 50, 0.4, 70], [50, 0, 50, 40, 0.45, 70]];
    const AURORA_SPOTS = [[12, 8, 60, 55, 0.85, 70], [88, 22, 55, 50, 0.75, 70], [50, 105, 75, 60, 0.8, 70], [10, 75, 50, 45, 0.6, 70], [75, 65, 45, 40, 0.5, 70], [40, 30, 40, 40, 0.45, 70]];
    function themeColors(t, dark) {
        const list = (Array.isArray(t.colors) ? t.colors.filter(isHex) : []).slice(0, MAX_COLORS);
        if (!list.length) list.push(dark ? "#1a1a2e" : "#e4e8f5");
        return list;
    }
    function appBackground(t, bg, colors) {
        const style = t.style || "classic", c = colors.slice();
        while (c.length < 3) c.push(c[c.length - 1]);
        if (style === "linear") {
            const angle = Number.isFinite(t.angle) ? t.angle : 160;
            const stops = colors.length === 3 ? `${c[0]} 0%, ${c[1]} 55%, ${c[2]} 100%`
                : colors.length === 1 ? `${c[0]} 0%, ${c[0]} 100%` : colors.map((x, i) => `${x} ${Math.round((i / (colors.length - 1)) * 100)}%`).join(", ");
            if (t.gradType === "radial") return `radial-gradient(circle at 50% 35%, ${stops})`;
            if (t.gradType === "conic") return `conic-gradient(from ${angle}deg at 50% 50%, ${colors.concat(colors[0]).join(", ")})`;
            return `linear-gradient(${angle}deg, ${stops})`;
        }
        if (style === "glow" || style === "aurora") {
            const spots = style === "glow" ? GLOW_SPOTS : AURORA_SPOTS;
            return c.slice(0, Math.max(3, colors.length)).map((col, i) => {
                const [x, y, w, h, a, fade] = spots[i];
                return `radial-gradient(${w}% ${h}% at ${x}% ${y}%, ${rgba(col, a)} 0%, ${rgba(col, 0)} ${fade}%)`;
            }).join(", ") + `, ${bg}`;
        }
        return bg;
    }
    // A glow / aurora layout as editable dots, so the colours can be pushed around by hand.
    function dotsFromStyle(t) {
        const dark = t.mode !== "light", colors = themeColors(t, dark);
        const spots = t.style === "glow" ? GLOW_SPOTS : AURORA_SPOTS;
        return colors.slice(0, 6).map((c, i) => {
            const [x, y, w, h, a] = spots[i];
            return { x: Math.max(4, Math.min(96, x)), y: Math.max(4, Math.min(96, y)), c, r: Math.round((w + h) / 4 + 10), s: 70, o: Math.round(a * 100) };
        });
    }

    // Panel transparency: 50 is the designed look; lower is more see-through.
    function panelAlpha(base, opacity) {
        const p = num(opacity, 0, 100, 50);
        return p >= 50 ? base + (1 - base) * ((p - 50) / 50) : base * (p / 50);
    }

    // Expand a theme (+ the user's accent override) into CSS custom properties.
    function buildVars(t, settings) {
        const dark = t.mode !== "light";
        const bg = t.bg || (dark ? "#0a0a0a" : "#f5f6f8");
        const surf = t.surface || bg;
        const S = (f) => mix(surf, dark ? "#ffffff" : "#000000", f);
        const colors = themeColors(t, dark);
        const style = t.style || "classic", glass = !!t.glass && style !== "classic";
        const v = {};

        const t1 = isHex(t.text) ? t.text : dark ? "#ffffff" : "#15171c";
        v["--text-1"] = t1;
        v["--text-soft"] = mix(t1, surf, dark ? 0.14 : 0.12);
        v["--text-2"] = mix(t1, surf, dark ? 0.4 : 0.36);
        v["--text-3"] = mix(t1, surf, dark ? 0.52 : 0.47);
        v["--text-4"] = mix(t1, surf, dark ? 0.64 : 0.56);
        v["--text-5"] = mix(t1, surf, dark ? 0.7 : 0.64);
        v["--fg-rgb"] = dark ? "255, 255, 255" : "0, 0, 0";
        v["--shadow-rgb"] = dark ? "0, 0, 0" : "40, 44, 70";
        v["--scrim"] = dark ? "rgba(0, 0, 0, 0.8)" : "rgba(24, 28, 42, 0.38)";
        v["--font"] = (FONTS[t.font] || FONTS.default).stack;

        v["--bg"] = bg;
        if (dark) {
            v["--bg-2"] = S(0.015); v["--surface-1"] = S(0.04); v["--surface-2"] = S(0.055); v["--surface-3"] = S(0.08);
            v["--surface-4"] = S(0.105); v["--surface-5"] = S(0.12);
            v["--line-1"] = S(0.065); v["--line-2"] = S(0.12); v["--line-3"] = S(0.17); v["--track"] = S(0.22);
        } else {
            v["--bg-2"] = mix(surf, "#000000", 0.02); v["--surface-1"] = mix(surf, "#000000", 0.035);
            v["--surface-2"] = mix(surf, "#ffffff", 0.6); v["--surface-3"] = mix(surf, "#000000", 0.06);
            v["--surface-4"] = "#ffffff"; v["--surface-5"] = "#ffffff";
            v["--line-1"] = mix(surf, "#000000", 0.07); v["--line-2"] = mix(surf, "#000000", 0.1);
            v["--line-3"] = mix(surf, "#000000", 0.14); v["--track"] = mix(surf, "#000000", 0.16);
        }
        v["--menu-bg"] = v["--surface-5"]; v["--modal-bg"] = v["--surface-4"];
        v["--card-bg"] = `rgba(${v["--fg-rgb"]}, ${dark ? 0.04 : 0.035})`;
        v["--strong-bg"] = dark ? "#ffffff" : "#15171c"; v["--strong-fg"] = dark ? "#000000" : "#ffffff";
        v["--danger"] = dark ? "#ff6b6b" : "#d92d2d"; v["--danger-rgb"] = dark ? "255, 107, 107" : "217, 45, 45";
        v["--gold"] = dark ? "#f5c542" : "#b98204"; v["--gold-rgb"] = dark ? "245, 197, 66" : "185, 130, 4";

        const appBg = appBackground(t, bg, colors);
        v["--app-bg"] = appBg;
        if (style === "classic") {
            v["--sidebar-bg"] = bg; v["--queue-bg"] = v["--bg-2"];
            v["--player-bg"] = `linear-gradient(to right, ${v["--surface-2"]}, ${v["--line-1"]}, ${v["--surface-2"]})`;
            v["--main-base"] = bg; v["--main-tint"] = colors[0];
            v["--mobile-main-bg"] = bg; v["--nav-bg"] = bg; v["--mini-bg"] = v["--line-1"];
            v["--np-bg"] = bg; v["--np-tint-default"] = colors[0];
            v["--panel-blur"] = "none";
        } else {
            const op = t.panelOpacity, a = (x) => rgba(surf, panelAlpha(x, op));
            v["--sidebar-bg"] = glass ? a(dark ? 0.32 : 0.42) : surf;
            v["--queue-bg"] = glass ? a(dark ? 0.32 : 0.42) : v["--bg-2"];
            v["--player-bg"] = glass ? a(dark ? 0.58 : 0.68) : v["--surface-2"];
            v["--main-base"] = glass ? a(dark ? 0.22 : 0.34) : (dark ? S(0.02) : mix(surf, "#ffffff", 0.45));
            v["--main-tint"] = "rgba(0, 0, 0, 0)";
            v["--mobile-main-bg"] = "rgba(0, 0, 0, 0)";
            v["--nav-bg"] = glass ? a(dark ? 0.74 : 0.8) : surf;
            v["--mini-bg"] = glass ? rgba(S(0.07), panelAlpha(dark ? 0.84 : 0.88, op)) : v["--line-1"];
            v["--np-bg"] = appBg; v["--np-tint-default"] = "rgba(0, 0, 0, 0)";
            const gb = num(t.glassBlur, 0, 40, 20);
            v["--panel-blur"] = glass && gb > 0 ? `blur(${gb}px) saturate(1.3)` : "none";
        }

        const override = settings && settings.accent;
        const accent = override || t.accent || "#1DB954";
        const accent2 = override ? accent : (t.accent2 || accent);
        const mid = mix(accent, accent2, 0.5);
        v["--accent"] = accent; v["--accent-2"] = accent2;
        v["--accent-rgb"] = hexToRgb(accent).join(", ");
        v["--accent-hi"] = !override && t.accentHi ? t.accentHi : (dark ? mix(accent, "#ffffff", 0.14) : mix(accent, "#000000", 0.1));
        v["--accent-grad"] = accent2 !== accent ? `linear-gradient(135deg, ${accent}, ${accent2})` : accent;
        v["--accent-ink"] = !override && t.accentInk ? t.accentInk : inkFor(dark ? mix(accent, "#ffffff", 0.06) : accent, dark ? S(0.1) : surf, dark ? 3.6 : 3.4);
        const on = readableOn(mid);
        v["--on-accent"] = !override && t.onAccent ? t.onAccent : on;
        v["--on-accent-icon"] = !override && t.onAccentIcon ? t.onAccentIcon : on;
        if (t.elements) for (const id in t.elements) if (ELEMENTS[id]) Object.assign(v, ELEMENTS[id].vars(sanitizeElement(id, t.elements[id], t)));
        return v;
    }

    // ── Pictures ──
    const IMG_DB = "spootify-theme-images", IMG_STORE = "images";
    let imgDb = null;
    const urlCache = new Map(); // image id → object URL (or a pending Promise)
    function openImgDb() {
        if (imgDb) return imgDb;
        imgDb = new Promise((resolve, reject) => {
            const req = indexedDB.open(IMG_DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(IMG_STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        imgDb.catch(() => { imgDb = null; });
        return imgDb;
    }
    async function putImage(blob) {
        const id = "img-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const db = await openImgDb();
        await new Promise((resolve, reject) => { const tx = db.transaction(IMG_STORE, "readwrite"); tx.objectStore(IMG_STORE).put(blob, id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
        urlCache.set(id, URL.createObjectURL(blob));
        return id;
    }
    function getImageUrl(id) {
        if (!id) return Promise.resolve(null);
        const hit = urlCache.get(id);
        if (hit) return Promise.resolve(hit);
        const p = openImgDb().then((db) => new Promise((resolve) => {
            const r = db.transaction(IMG_STORE, "readonly").objectStore(IMG_STORE).get(id);
            r.onsuccess = () => { const url = r.result ? URL.createObjectURL(r.result) : null; if (url) urlCache.set(id, url); else urlCache.delete(id); resolve(url); };
            r.onerror = () => { urlCache.delete(id); resolve(null); };
        })).catch(() => { urlCache.delete(id); return null; });
        urlCache.set(id, p);
        return p;
    }
    const cachedUrl = (id) => { const v = id && urlCache.get(id); return typeof v === "string" ? v : null; };
    async function deleteImage(id) {
        if (!id) return;
        const v = urlCache.get(id); if (typeof v === "string") URL.revokeObjectURL(v);
        urlCache.delete(id);
        try { const db = await openImgDb(); db.transaction(IMG_STORE, "readwrite").objectStore(IMG_STORE).delete(id); } catch {}
    }
    // Drop stored pictures no saved theme points at (after a delete, or an editor cancel).
    async function pruneImages(keep = []) {
        try {
            const used = new Set(keep.concat(loadCustom().map((t) => t.image && t.image.id).filter(Boolean)));
            const db = await openImgDb();
            const keys = await new Promise((resolve) => { const r = db.transaction(IMG_STORE, "readonly").objectStore(IMG_STORE).getAllKeys(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]); });
            for (const k of keys) if (!used.has(k)) deleteImage(k);
        } catch {}
    }

    // ── Background layer ──
    // Painted onto canvases, not built from CSS filters: the picture and its blur spots,
    // then the colour dots, then grain and dark edges on top, each on its own canvas and
    // only when the theme has it. A canvas keeps its pixels, so opening a pop-up, scrolling
    // or moving a slider never makes the browser redo a full-screen blur or the grain
    // texture (which is what made effects flash and stutter on phones), and every change
    // repaints in one go, at most once a frame, instead of swapping elements in and out.
    // Drifting dots get a small canvas of their own, redrawn about 30 times a second while
    // it's on screen; it pauses while a pop-up covers it and when the app is hidden.
    // Sizes are relative to the box a layer sits in (the window, the editor's preview box,
    // a theme card), so a theme looks the same in all of them.
    let artUrl = null;
    const CAN_FILTER = typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;
    function layerImageUrl(t, opts) {
        const im = t.image; if (!im) return null;
        if (im.src === "art") return opts.artUrl !== undefined ? opts.artUrl : artUrl;
        return (opts.thumbOnly ? null : cachedUrl(im.id)) || im.thumb || null;
    }
    function hasLayer(t) {
        return !!((Array.isArray(t.dots) && t.dots.length) || t.image || num(t.grain, 0, 100, 0) || num(t.vignette, 0, 100, 0));
    }
    function layerParts(t, opts) {
        return {
            base: !!layerImageUrl(t, opts),
            dots: Array.isArray(t.dots) && t.dots.length > 0,
            top: !!(num(t.grain, 0, 100, 0) || num(t.vignette, 0, 100, 0))
        };
    }

    // Pictures are decoded once per size (off the main thread where the browser can) and
    // kept in a small cache; a layer waiting for one is repainted when it arrives, and keeps
    // showing what it had until then rather than going blank.
    const pics = new Map(); // "url|maxSide" -> { state, img, waiters }
    async function decodePicture(url, maxSide) {
        if (typeof createImageBitmap === "function" && typeof fetch === "function") {
            const blob = await (await fetch(url)).blob();
            let bmp = await createImageBitmap(blob);
            const side = Math.max(bmp.width, bmp.height);
            if (side > maxSide * 1.2) {
                const k = maxSide / side;
                const small = await createImageBitmap(bmp, { resizeWidth: Math.max(1, Math.round(bmp.width * k)), resizeHeight: Math.max(1, Math.round(bmp.height * k)), resizeQuality: "high" });
                bmp.close(); bmp = small;
            }
            return bmp;
        }
        return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    }
    function picture(url, maxSide, el) {
        const key = url + "|" + maxSide;
        let p = pics.get(key);
        if (p) { pics.delete(key); pics.set(key, p); } // most recently used goes last
        else {
            p = { state: "loading", img: null, waiters: new Set() };
            pics.set(key, p);
            decodePicture(url, maxSide).then((img) => { p.state = "ready"; p.img = img; }, () => { p.state = "error"; })
                .then(() => { for (const w of p.waiters) queueDraw(w); p.waiters.clear(); });
            for (const [k, old] of pics) {
                if (pics.size <= 16) break;
                if (old.state === "loading") continue;
                if (old.img && typeof old.img.close === "function") old.img.close();
                pics.delete(k);
            }
        }
        if (p.state === "loading" && el) p.waiters.add(el);
        return p.state === "ready" ? p.img : p.state === "error" ? false : null;
    }

    // Small still layers (theme cards, the editor's preview boxes) are drawn on the CPU
    // ("soft"): a GPU canvas is a layer of its own, and a grid of them made pop-ups flicker.
    function fitCanvas(c, w, h) {
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        return c.getContext("2d", c.__soft ? { willReadFrequently: true } : undefined);
    }
    // Reusable off-screen canvases: "spot" for one blur spot at a time, "draft" for the
    // half-size picture drawn while a slider moves (which can contain spots of its own).
    const scratchCanvases = {};
    function scratch(slot, w, h) {
        const c = scratchCanvases[slot] || (scratchCanvases[slot] = document.createElement("canvas"));
        fitCanvas(c, w, h).clearRect(0, 0, w, h);
        return c;
    }

    // The picture: fitted (fill / fit / tile) into the layer's box, which a blurred picture
    // overhangs a little so its edges stay solid, then moved, zoomed, blurred and tinted.
    // W, H: the box in CSS pixels; k: canvas pixels per CSS pixel.
    function drawPicture(ctx, img, t, W, H, k) {
        const im = t.image, M = Math.max(W, H), blur = num(t.blur, 0, 50, 0);
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        if (!iw || !ih) return;
        const pad = blur * 0.002 * M, bx = -pad, by = -pad, bw = W + 2 * pad, bh = H + 2 * pad;
        const zoom = num(im.zoom, 30, 300, 100) / 100, px = num(im.x, 0, 100, 50) / 100, py = num(im.y, 0, 100, 50) / 100;
        const filters = [], br = num(im.bright, 10, 200, 100), sat = num(im.sat, 0, 250, 100);
        if (blur) filters.push(`blur(${(blur * 0.001 * M * k).toFixed(2)}px)`);
        if (br !== 100) filters.push(`brightness(${br / 100})`);
        if (sat !== 100) filters.push(`saturate(${sat / 100})`);
        ctx.save();
        if (CAN_FILTER && filters.length) ctx.filter = filters.join(" ");
        ctx.globalAlpha = num(im.opacity, 0, 100, 100) / 100;
        if (im.fit === "tile") {
            const tw = 0.2 * zoom * M, th = tw * ih / iw, ox = bx + (bw - tw) * px, oy = by + (bh - th) * py;
            const pat = ctx.createPattern(img, "repeat");
            if (pat) {
                if (typeof pat.setTransform === "function" && typeof DOMMatrix === "function") pat.setTransform(new DOMMatrix([tw * k / iw, 0, 0, th * k / ih, ox * k, oy * k]));
                ctx.fillStyle = pat; ctx.fillRect(bx * k, by * k, bw * k, bh * k);
            }
        } else {
            const s = im.fit === "contain" ? Math.min(bw / iw, bh / ih) : Math.max(bw / iw, bh / ih);
            const dw = iw * s, dh = ih * s, ox = bx + bw * px, oy = by + bh * py; // zoom pivots on the chosen spot
            const dx = ox + (bx + (bw - dw) * px - ox) * zoom, dy = oy + (by + (bh - dh) * py - oy) * zoom;
            ctx.drawImage(img, dx * k, dy * k, dw * zoom * k, dh * zoom * k);
        }
        ctx.restore();
    }
    // Blur spots: soft-edged circles that blur whatever of the picture is under them.
    function drawSpots(canvas, t, W, H, k) {
        const im = t.image, spots = Array.isArray(im.spots) ? im.spots.slice(0, MAX_SPOTS) : [];
        if (!spots.length || !CAN_FILTER) return;
        const ctx = canvas.getContext("2d"), M = Math.max(W, H);
        for (const sp of spots) {
            const R = num(sp.r, 4, 70, 20) / 100 * M * k, b = num(sp.b, 1, 60, 20) * 0.001 * M * k;
            const cx = num(sp.x, 0, 100, 50) / 100 * W * k, cy = num(sp.y, 0, 100, 50) / 100 * H * k;
            const m = Math.ceil(b * 2), x0 = Math.floor(cx - R - m), y0 = Math.floor(cy - R - m), size = Math.max(2, Math.ceil(2 * (R + m)));
            const tmp = scratch("spot", size, size), g = tmp.getContext("2d");
            g.filter = `blur(${b.toFixed(2)}px)`;
            g.drawImage(canvas, -x0, -y0);
            g.filter = "none";
            g.globalCompositeOperation = "destination-in";
            const solid = (1 - num(sp.s, 0, 100, 60) / 100) * 0.8, mask = g.createRadialGradient(cx - x0, cy - y0, 0, cx - x0, cy - y0, R);
            mask.addColorStop(0, "#000"); if (solid > 0) mask.addColorStop(solid, "#000"); mask.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = mask; g.fillRect(0, 0, size, size);
            g.globalCompositeOperation = "source-over";
            ctx.drawImage(tmp, x0, y0);
        }
    }
    // Colour dots: soft circles of colour. pos (drifting): [x %, y %, size factor] per dot.
    // soften (drifting, where a blur filter every frame would cost too much) widens each
    // dot's edge by that many canvas pixels instead.
    function drawDots(ctx, list, W, H, k, blurPx, pos, soften) {
        const M = Math.max(W, H) * k;
        if (blurPx && CAN_FILTER) ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
        list.forEach((d, i) => {
            const p = pos && pos[i];
            const x = (p ? p[0] : num(d.x, -20, 120, 50)) / 100 * W * k, y = (p ? p[1] : num(d.y, -20, 120, 50)) / 100 * H * k;
            const r = num(d.r, 3, 90, 30) / 100 * M * (p ? p[2] : 1);
            if (r < 0.5) return;
            const R = r + (soften || 0), c = isHex(d.c) ? d.c : "#888888", o = num(d.o, 0, 100, 80) / 100;
            const solid = Math.max(0, ((1 - num(d.s, 0, 100, 70) / 100) * 0.85 * r - (soften || 0)) / R);
            const g = ctx.createRadialGradient(x, y, 0, x, y, R);
            g.addColorStop(0, rgba(c, o)); if (solid > 0) g.addColorStop(solid, rgba(c, o)); g.addColorStop(1, rgba(c, 0));
            ctx.fillStyle = g; ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
        });
        ctx.filter = "none";
    }
    // Grain: a tile of soft speckles (white on dark themes, black on light), made once.
    const grainTiles = {};
    function grainTile(light) {
        if (grainTiles[light]) return grainTiles[light];
        const n = 180, c = document.createElement("canvas"); c.width = c.height = n;
        const g = c.getContext("2d"), img = g.createImageData(n, n), d = img.data, v = light ? 0 : 255;
        for (let i = 0; i < d.length; i += 4) {
            const r = (Math.random() + Math.random()) / 2;
            d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = Math.max(0, Math.min(255, (2.2 * r - 0.9) * 255));
        }
        g.putImageData(img, 0, 0);
        return (grainTiles[light] = c);
    }
    function drawTop(ctx, t, k) {
        const dark = t.mode !== "light", cw = ctx.canvas.width, ch = ctx.canvas.height;
        const grain = num(t.grain, 0, 100, 0), vig = num(t.vignette, 0, 100, 0);
        if (grain) {
            const pat = ctx.createPattern(grainTile(!dark), "repeat");
            if (pat) {
                if (typeof pat.setTransform === "function" && typeof DOMMatrix === "function") pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
                ctx.globalAlpha = grain / 100 * (dark ? 0.55 : 0.7);
                ctx.fillStyle = pat; ctx.fillRect(0, 0, cw, ch);
                ctx.globalAlpha = 1;
            }
        }
        if (vig) {
            // An ellipse centred a little above the middle that reaches the far corners.
            const a = vig / 100 * (dark ? 0.85 : 0.45), inner = Math.max(0, (70 - vig * 0.35) / 100);
            const cx = cw / 2, cy = ch * 0.45, rx = Math.max(cx, cw - cx) * Math.SQRT2, ry = Math.max(cy, ch - cy) * Math.SQRT2, sy = ry / rx;
            ctx.save(); ctx.translate(cx, cy); ctx.scale(1, sy);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
            g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(inner, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${a.toFixed(3)})`);
            ctx.fillStyle = g; ctx.fillRect(-cx, -cy / sy, cw, ch / sy);
            ctx.restore();
        }
    }

    // ── Drift ── every dot wanders smoothly around the screen (or nearer its own spot with
    // a smaller "Wander"), on a path worked out from the time, so all copies agree.
    function seeded(i, k) {
        let h = Math.imul(i + 1, 374761393) ^ Math.imul(k + 7, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }
    function driftPos(d, i, sec, speed, wander) {
        const T = 40 / speed, TAU = Math.PI * 2;
        const wave = (k, lo, hi) => Math.sin(TAU * sec / (T * (lo + (hi - lo) * seeded(i, k))) + TAU * seeded(i, k + 50));
        const sx = 0.62 * wave(1, 0.8, 1.25) + 0.38 * wave(2, 0.42, 0.68);
        const sy = 0.62 * wave(3, 0.75, 1.2) + 0.38 * wave(4, 0.4, 0.7);
        const hx = num(d.x, -20, 120, 50), hy = num(d.y, -20, 120, 50), a = 47 * wander;
        return [hx * (1 - wander) + 50 * wander + a * sx, hy * (1 - wander) + 50 * wander + a * sy, 1 + 0.12 * wave(5, 1.3, 2.1)];
    }
    const drifting = new Map(); // dots canvas -> { el, dots, speed, wander, soften }
    let driftRaf = 0, driftLast = 0;
    function startDrift(canvas, el, t, dots) {
        drifting.set(canvas, { el, dots, speed: num(t.speed, 0.25, 4, 1), wander: num(t.wander, 10, 100, 100) / 100, blur: num(t.blur, 0, 50, 0) });
        canvas.__sig = null;
        if (!driftRaf) driftRaf = requestAnimationFrame(driftTick);
    }
    function stopDrift(canvas) { if (canvas) drifting.delete(canvas); }
    function resumeDrift() { if (!driftRaf && drifting.size) driftRaf = requestAnimationFrame(driftTick); }
    function driftTick(now) {
        driftRaf = 0;
        const root = document.documentElement;
        // Quiet mode (battery saver): no frames at all until resumeDrift().
        if (!drifting.size || (root.dataset.quiet === "1" && root.dataset.qDrift !== "1")) return;
        driftRaf = requestAnimationFrame(driftTick);
        // About 30 frames a second is plenty for something this slow, and nothing is drawn
        // while a pop-up covers the screen.
        if (now - driftLast < 31 || root.dataset.overlay === "1" || root.dataset.motion === "reduce") return;
        driftLast = now;
        const sec = Date.now() / 1000;
        for (const [canvas, st] of drifting) {
            if (!canvas.isConnected) { drifting.delete(canvas); continue; }
            if (st.el.dataset.covered === "1") continue;
            const W = st.el.clientWidth, H = st.el.clientHeight;
            if (!W || !H) continue;
            // Low resolution: the dots are soft, and it keeps every frame cheap on a phone.
            const k = Math.min(1, 420 / Math.max(W, H)), cw = Math.max(1, Math.round(W * k)), ch = Math.max(1, Math.round(H * k));
            const ctx = fitCanvas(canvas, cw, ch);
            ctx.clearRect(0, 0, cw, ch);
            drawDots(ctx, st.dots, W, H, k, 0, st.dots.map((d, i) => driftPos(d, i, sec, st.speed, st.wander)), st.blur * 0.0006 * Math.max(W, H) * k);
        }
    }

    // ── Painting ── paintLayer() only records what to show; the drawing happens on the next
    // frame, once, however many times it was asked for in between.
    const dirtyLayers = new Set(), observedLayers = new Set();
    let flushQueued = false, resizeObs = null;
    function queueDraw(el) {
        if (!el) return;
        dirtyLayers.add(el);
        if (!flushQueued) { flushQueued = true; requestAnimationFrame(flushDraws); }
    }
    function flushDraws() {
        flushQueued = false;
        const list = [...dirtyLayers]; dirtyLayers.clear();
        for (const el of list) { try { drawLayer(el); } catch (e) { console.warn("Theme layer paint failed", e); } }
        for (const el of observedLayers) if (!el.isConnected) { observedLayers.delete(el); if (resizeObs) resizeObs.unobserve(el); el.__tlInit = false; }
    }
    function observeLayer(el) {
        if (typeof ResizeObserver !== "function") return;
        if (!resizeObs) resizeObs = new ResizeObserver((entries) => {
            for (const e of entries) {
                const el = e.target;
                clearTimeout(el.__tlResize);
                el.__tlResize = setTimeout(() => queueDraw(el), el.__tlSized ? 120 : 0); // a window drag repaints once at the end
            }
        });
        resizeObs.observe(el); observedLayers.add(el);
    }
    if (typeof ResizeObserver !== "function") window.addEventListener("resize", () => { for (const id of ["theme-bg", "np-theme-bg"]) queueDraw(document.getElementById(id)); });
    // Canvases in order: picture, dots, grain + edges. Ones a theme doesn't use are removed.
    function layerCanvases(el, want, soft) {
        const store = el.__tlC || (el.__tlC = {}), out = {};
        let prev = null;
        for (const kind of ["base", "dots", "top"]) {
            let c = store[kind];
            if (want[kind]) {
                if (!c) { c = store[kind] = document.createElement("canvas"); c.className = "tl-" + kind; c.__soft = !!soft; }
                const at = prev ? prev.nextSibling : el.firstChild;
                if (c !== at) el.insertBefore(c, at);
                prev = out[kind] = c;
            } else if (c) { stopDrift(c); c.remove(); store[kind] = null; }
        }
        return out;
    }
    function drawLayer(el) {
        const spec = el.__tlSpec; if (!spec || !el.isConnected) return;
        const { t, opts } = spec, want = layerParts(t, opts), any = want.base || want.dots || want.top;
        if (el.hidden !== !any) el.hidden = !any;
        const cans = layerCanvases(el, want, opts.static);
        if (!any) return;
        const W = el.clientWidth, H = el.clientHeight;
        if (!W || !H) return; // not on screen (a closed player, a folded section): painted once it shows
        el.__tlSized = true;
        const dpr = Math.min(3, window.devicePixelRatio || 1), k = Math.max(0.2, Math.min(dpr, 2600 / Math.max(W, H)));
        const cw = Math.max(1, Math.round(W * k)), ch = Math.max(1, Math.round(H * k));
        if (cans.base) drawBase(el, cans.base, t, opts, W, H, k, cw, ch);
        if (cans.dots) {
            const dots = t.dots.slice(0, MAX_DOTS);
            if (t.animate && !opts.static && document.documentElement.dataset.motion !== "reduce") startDrift(cans.dots, el, t, dots);
            else {
                stopDrift(cans.dots);
                const blur = num(t.blur, 0, 50, 0), sig = JSON.stringify([dots, blur, cw, ch]);
                if (cans.dots.__sig !== sig) {
                    const ctx = fitCanvas(cans.dots, cw, ch);
                    ctx.clearRect(0, 0, cw, ch);
                    drawDots(ctx, dots, W, H, k, blur * 0.0006 * Math.max(W, H) * k);
                    cans.dots.__sig = sig;
                }
            }
        }
        if (cans.top) {
            const sig = JSON.stringify([t.mode, t.grain, t.vignette, cw, ch]);
            if (cans.top.__sig !== sig) {
                const ctx = fitCanvas(cans.top, cw, ch);
                ctx.clearRect(0, 0, cw, ch);
                drawTop(ctx, t, k);
                cans.top.__sig = sig;
            }
        }
    }
    // While a slider is being dragged (paints arriving close together) the picture is drawn
    // at half size first, which is far cheaper with a big blur, then sharp once it settles.
    function drawBase(el, canvas, t, opts, W, H, k, cw, ch) {
        const url = layerImageUrl(t, opts), im = t.image, now = performance.now();
        const maxSide = Math.max(cw, ch) <= 720 ? 640 : 2600;
        let img = picture(url, maxSide, el);
        if (img === null && im.thumb && url !== im.thumb && !canvas.__sig) img = picture(im.thumb, 64, el) || null; // first paint: the tiny preview
        if (img === null) return; // still loading: keep what's there
        const quick = !el.__tlFinal && now - (el.__tlBaseAt || 0) < 160;
        el.__tlFinal = false;
        const sig = JSON.stringify([url, im.fit, im.x, im.y, im.zoom, im.opacity, im.bright, im.sat, im.spots, t.blur, cw, ch, img ? (img.width || img.naturalWidth) : 0]);
        if (canvas.__sig === sig) return;
        el.__tlBaseAt = now;
        const ctx = fitCanvas(canvas, cw, ch);
        if (!img) { ctx.clearRect(0, 0, cw, ch); canvas.__sig = sig; return; } // picture missing
        if (quick) {
            const half = Math.max(1, Math.round(cw / 2)), halfH = Math.max(1, Math.round(ch / 2)), tmp = scratch("draft", half, halfH);
            drawPicture(tmp.getContext("2d"), img, t, W, H, k / 2);
            drawSpots(tmp, t, W, H, k / 2);
            ctx.clearRect(0, 0, cw, ch);
            ctx.drawImage(tmp, 0, 0, cw, ch);
            canvas.__sig = sig + "~";
            clearTimeout(el.__tlFinalTimer);
            el.__tlFinalTimer = setTimeout(() => { el.__tlFinal = true; queueDraw(el); }, 220);
            return;
        }
        ctx.clearRect(0, 0, cw, ch);
        drawPicture(ctx, img, t, W, H, k);
        drawSpots(canvas, t, W, H, k);
        canvas.__sig = sig;
    }
    function paintLayer(el, t, opts = {}) {
        if (!el || !t) return;
        if (!el.__tlInit) {
            el.__tlInit = true;
            for (const c of [...el.children]) if (!/^tl-(base|dots|top)$/.test(c.className)) c.remove(); // markup from the old renderer
            observeLayer(el);
        }
        el.__tlSpec = { t, opts };
        const im = t.image;
        if (im && im.src !== "art" && im.id && !opts.thumbOnly && !cachedUrl(im.id)) getImageUrl(im.id).then((u) => { if (u && el.__tlSpec && el.__tlSpec.t === t) queueDraw(el); });
        // Hide or show straight away, so a theme without a layer never shows the last one's.
        const p = layerParts(t, opts), any = p.base || p.dots || p.top;
        if (el.hidden !== !any) el.hidden = !any;
        queueDraw(el);
    }

    function readJson(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? fallback : v; } catch { return fallback; } }
    function loadSettings() { const s = readJson(SETTINGS_KEY, {}); return Object.assign({}, DEFAULT_SETTINGS, s && typeof s === "object" ? s : {}); }
    function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }

    // Everything a theme can hold, checked and clamped: themes are pasted in from
    // codes other people made, and their values end up inside style attributes.
    function sanitizeTheme(raw) {
        if (!raw || typeof raw !== "object") return null;
        const t = {}, hex = (c, d) => (isHex(c) ? c.toLowerCase() : d);
        t.id = typeof raw.id === "string" && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : "custom-" + Date.now().toString(36);
        t.name = String(raw.name || "My theme").slice(0, 32);
        t.mode = raw.mode === "light" ? "light" : "dark";
        t.style = STYLES.includes(raw.style) ? raw.style : "classic";
        const dark = t.mode === "dark";
        t.bg = hex(raw.bg, dark ? "#0a0a0a" : "#f5f6f8");
        t.surface = hex(raw.surface, t.bg);
        t.colors = (Array.isArray(raw.colors) ? raw.colors.filter(isHex).map((c) => c.toLowerCase()) : []).slice(0, MAX_COLORS);
        if (!t.colors.length) t.colors = [dark ? "#1a1a2e" : "#e4e8f5"];
        if (raw.angle != null) t.angle = num(raw.angle, 0, 360, 160);
        if (["radial", "conic"].includes(raw.gradType)) t.gradType = raw.gradType;
        t.glass = !!raw.glass;
        if (raw.glassBlur != null) t.glassBlur = num(raw.glassBlur, 0, 40, 20);
        if (raw.panelOpacity != null) t.panelOpacity = num(raw.panelOpacity, 0, 100, 50);
        t.accent = hex(raw.accent, "#1db954");
        t.accent2 = isHex(raw.accent2) ? raw.accent2.toLowerCase() : null;
        for (const k of ["accentHi", "accentInk", "onAccent", "onAccentIcon"]) if (isHex(raw[k])) t[k] = raw[k];
        if (isHex(raw.text)) t.text = raw.text.toLowerCase();
        if (FONTS[raw.font] && raw.font !== "default") t.font = raw.font;
        if (Array.isArray(raw.dots) && raw.dots.length) {
            t.dots = raw.dots.slice(0, MAX_DOTS).filter((d) => d && typeof d === "object").map((d) => ({
                x: num(d.x, -20, 120, 50), y: num(d.y, -20, 120, 50), c: hex(d.c, "#888888"), r: num(d.r, 3, 90, 30), s: num(d.s, 0, 100, 70), o: num(d.o, 0, 100, 80)
            }));
        }
        if (raw.animate) { t.animate = true; t.speed = num(raw.speed, 0.25, 4, 1); t.wander = num(raw.wander, 10, 100, 100); }
        if (raw.image && typeof raw.image === "object") {
            const im = raw.image, src = im.src === "art" ? "art" : "file";
            const id = typeof im.id === "string" && /^img-[\w]{1,40}$/.test(im.id) ? im.id : null;
            if (src === "art" || id) {
                t.image = { src, fit: ["contain", "tile"].includes(im.fit) ? im.fit : "cover", x: num(im.x, 0, 100, 50), y: num(im.y, 0, 100, 50),
                    zoom: num(im.zoom, 30, 300, 100), opacity: num(im.opacity, 0, 100, 100), bright: num(im.bright, 10, 200, 100), sat: num(im.sat, 0, 250, 100) };
                if (Array.isArray(im.spots) && im.spots.length) t.image.spots = im.spots.slice(0, MAX_SPOTS).filter((sp) => sp && typeof sp === "object")
                    .map((sp) => ({ x: num(sp.x, 0, 100, 50), y: num(sp.y, 0, 100, 50), r: num(sp.r, 4, 70, 20), b: num(sp.b, 1, 60, 20), s: num(sp.s, 0, 100, 60) }));
                if (id) t.image.id = id;
                if (typeof im.thumb === "string" && im.thumb.length < 40000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(im.thumb)) t.image.thumb = im.thumb;
            }
        }
        for (const k of ["blur", "grain", "vignette"]) if (raw[k]) t[k] = num(raw[k], 0, k === "blur" ? 50 : 100, 0);
        if (raw.elements && typeof raw.elements === "object") {
            const els = {};
            for (const id of Object.keys(ELEMENTS)) if (raw.elements[id]) els[id] = sanitizeElement(id, raw.elements[id], t);
            if (Object.keys(els).length) t.elements = els;
        }
        return t;
    }
    // Your themes are read and checked once, then kept until they're saved again: the
    // Appearance tab and every theme switch used to re-read them all from storage, many
    // times over (a lot of work with a few themes that have pictures). Callers get their
    // own copy of the list but share the theme objects, which nothing changes in place.
    let customCache = null;
    function loadCustom() {
        if (!customCache) { const list = readJson(CUSTOM_KEY, []); customCache = Array.isArray(list) ? list.filter((t) => t && t.id && t.name).map(sanitizeTheme).filter(Boolean) : []; }
        return customCache.slice();
    }
    function saveCustom(list) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); customCache = null; return true; } catch { return false; } }
    window.addEventListener("storage", (e) => { if (e.key === CUSTOM_KEY || e.key === null) customCache = null; });
    function allThemes() { return loadCustom().reverse().concat(BASE_THEMES); }
    function findTheme(id) { return loadCustom().find((t) => t.id === id) || BASE_THEMES.find((t) => t.id === id) || BASE_THEMES[0]; }

    // ── Theme codes ── (no picture: those stay on the device that has them)
    const CODE_PREFIX = "SPOOTIFY-THEME:";
    function encodeTheme(t) {
        const c = JSON.parse(JSON.stringify(t));
        delete c.id;
        if (c.image) { if (c.image.src === "art") { delete c.image.id; delete c.image.thumb; } else delete c.image; }
        return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(c))));
    }
    function decodeTheme(code) {
        const s = String(code || "").trim(), i = s.indexOf(CODE_PREFIX);
        if (i < 0) return null;
        try {
            const t = sanitizeTheme(JSON.parse(decodeURIComponent(escape(atob(s.slice(i + CODE_PREFIX.length).replace(/\s+/g, ""))))));
            if (t) t.id = "custom-" + Date.now().toString(36);
            return t;
        } catch { return null; }
    }

    // ── Applying ──
    let current = null; // { theme, settings } last applied
    function layerTargets() { return ["theme-bg", "np-theme-bg"].map((id) => document.getElementById(id)).filter(Boolean); }
    function paintLayers() {
        if (!current) return;
        for (const el of layerTargets()) paintLayer(el, current.theme);
    }
    // Only what actually changed is written. Every colour lives on <html>, and changing one
    // there makes the browser restyle the whole app, so a slider that only moves the
    // picture or the grain now costs no restyle at all.
    let appliedVars = {};
    function setData(root, key, value) { if (root.dataset[key] !== value) root.dataset[key] = value; }
    function apply(theme, settings) {
        const root = document.documentElement, vars = buildVars(theme, settings || DEFAULT_SETTINGS);
        for (const k in vars) if (appliedVars[k] !== vars[k]) root.style.setProperty(k, vars[k]);
        for (const k in appliedVars) if (!(k in vars)) root.style.removeProperty(k);
        appliedVars = vars;
        const s = settings || DEFAULT_SETTINGS;
        setData(root, "mode", theme.mode === "light" ? "light" : "dark");
        setData(root, "style", theme.style || "classic");
        setData(root, "glass", theme.glass && theme.style !== "classic" ? "1" : "0");
        setData(root, "layer", hasLayer(theme) ? "1" : "0");
        for (const id in ELEMENTS) {
            const on = !!(theme.elements && theme.elements[id]), E = ELEMENTS[id];
            setData(root, "el" + id[0].toUpperCase() + id.slice(1), on ? "1" : "0");
            if (E.flags) { const f = E.flags(on ? sanitizeElement(id, theme.elements[id], theme) : elementDefaults(id, theme)); for (const k in f) setData(root, k, on ? f[k] : "0"); }
        }
        setData(root, "compact", s.compact ? "1" : "0");
        setData(root, "cards", s.cardSize || "m");
        setData(root, "motion", s.reduceMotion ? "reduce" : "full");
        for (const [k, attr] of [["quietArt", "qArt"], ["quietText", "qText"], ["quietProgress", "qProgress"], ["quietButtons", "qButtons"]]) setData(root, attr, s[k] === false ? "0" : "1");
        setData(root, "qDrift", s.quietDrift ? "1" : "0");
        setData(root, "qSmooth", s.quietSmooth ? "1" : "0");
        setData(root, "anim", s.animations === false || s.reduceMotion ? "0" : "1");
        const scheme = theme.mode === "light" ? "light" : "dark";
        if (root.style.colorScheme !== scheme) root.style.colorScheme = scheme;
        const meta = document.querySelector('meta[name="theme-color"]'), bg = theme.bg || "#0a0a0a";
        if (meta && meta.getAttribute("content") !== bg) meta.setAttribute("content", bg);
        current = { theme, settings: s };
        if (document.body) paintLayers();
        return vars;
    }
    function setArtUrl(url) {
        if (artUrl === url) return;
        artUrl = url || null;
        if (current && current.theme.image && current.theme.image.src === "art") paintLayers();
    }

    window.SpootifyThemes = {
        BASE_THEMES, DEFAULT_SETTINGS, FONTS, STYLES, MAX_COLORS, MAX_DOTS, MAX_SPOTS, ELEMENTS, elementDefaults,
        loadSettings, saveSettings, loadCustom, saveCustom, allThemes, findTheme, buildVars, apply, sanitizeTheme,
        paintLayer, paintLayers, resumeDrift, hasLayer, dotsFromStyle, setArtUrl, getArtUrl: () => artUrl,
        putImage, getImageUrl, deleteImage, pruneImages, encodeTheme, decodeTheme,
        util: { hexToRgb, rgbToHex, mix, rgba, lum, contrast, readableOn, hexToHsl, hslToHex, isHex }
    };
    try { const s = loadSettings(); apply(findTheme(s.theme), s); } catch (e) { console.warn("Theme apply failed", e); }
    document.addEventListener("DOMContentLoaded", paintLayers);
})();
