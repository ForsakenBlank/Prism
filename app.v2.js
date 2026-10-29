console.log("Prism V2: Script Load Start");

// ── DATA STORES ──
let playlists = {};
let currentPlaylist = null;
let modalMode = "";
let activeTrackId = null;
let activePlaylistName = null;
// Two <audio> elements: the active one is what the user hears as "the song"; the
// standby pre-rolls the next track during an overlapping crossfade and the two are
// swapped when the fade lands. Media events are bound to both, but handlers only
// react to the active element so the standby's own play/timeupdate/ended never
// leak into stats, the progress bar or track advance.
const playerA = new Audio(), playerB = new Audio();
let audioPlayer = playerA;
let standbyPlayer = playerB;
function onPlayer(event, handler) {
    for (const el of [playerA, playerB]) el.addEventListener(event, (e) => { if (e.currentTarget === audioPlayer) handler(e); });
}
let currentTrack = null;
let currentTrackSource = null;
let contextTrack = null;
let contextSource = null;
let isPlaybackIntentActive = false;
let queue = [];
let playbackHistory = [];
let shuffleEnabled = true; // default on; the saved now-playing state overrides it
let shuffledOrder = [];
let loopMode = "off";
let progressFrameId = null;
let isScrubbing = false;
let lastMediaSessionPositionUpdate = 0;
let playbackSpeed = 100;
let preservePitch = false;
let sleepTimerId = null;
let sleepTimerEnd = null;
let sleepTimerDisplayId = null;
let sleepAtTrackEnd = false;   // "End of current song" sleep timer
let crossfadeDuration = 0;
let crossfadeTriggered = false;
let crossfadeOverlap = false;
let crossfadePending = null;   // { song, source, fromQueue } pre-rolled on standbyPlayer
let libraryLoadedOk = false;
let crossfadeFadeId = null;
let likedSongs = new Map();    // song key (see statsKeyFor) → when it was liked
let likedVersion = 0;
let libraryVersion = 0;        // bumped on every save; keys the sorted-list caches
let lastSongId = 0;
let homeQuery = "";            // live Home search text (normalised)
let analyser = null;           // visualizer tap on the audio graph
const undoProtectedIds = new Set(); // media an Undo toast can still bring back
let trash = [];                // Recently deleted: songs and playlists kept for TRASH_DAYS

const DB_NAME = "spootify-db";
const DB_VERSION = 2;
const DB_STORE = "state";
const DB_MEDIA = "media";
const DB_KEY = "library";
// A see-through note: the <img> background (a theme surface) shows around it, so the
// placeholder suits light and dark themes alike.
const DEFAULT_ART = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><g fill='%23888' fill-opacity='0.5'><path d='M40 34 70 27v31h-5V36l-20 5v25h-5z'/><ellipse cx='59' cy='59' rx='8' ry='6.5'/><ellipse cx='34' cy='67' rx='8' ry='6.5'/></g></svg>";
const LEGACY_DEFAULT_ART = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23282828'/><circle cx='50' cy='50' r='25' fill='%23121212'/></svg>";

const HEART_PATH = "M12 21.2 10.6 20C5.4 15.3 2 12.2 2 8.4 2 5.3 4.4 3 7.4 3c1.8 0 3.5.8 4.6 2.1C13.1 3.8 14.8 3 16.6 3 19.6 3 22 5.3 22 8.4c0 3.8-3.4 6.9-8.6 11.6L12 21.2Z";
const ICONS = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-6H9v6H3.5a.5.5 0 0 1-.5-.5v-9.7Z"/></svg>',
    panelLeft: '<svg viewBox="0 0 24 24"><path d="M15 18 9 12l6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    panelRight: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7-11-7Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6V5Zm3 7 10 7V5L9 12Z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2V5ZM5 19l10-7L5 5v14Z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M17 3h4v4h-2V6h-2.4l-3.2 4.1-1.3-1.6L15.6 4H19V3h-2ZM4 7h3.4l10.2 13H19v-1h2v4h-4v-2h-1.4L5.4 9H4V7Zm0 10h1.4l3.2-4.1 1.3 1.6L6.4 19H4v-2Z"/></svg>',
    loop: '<svg viewBox="0 0 24 24"><path d="M7 7h9.6L15 5.4 16.4 4 20.4 8l-4 4L15 10.6 16.6 9H7a3 3 0 0 0-3 3H2a5 5 0 0 1 5-5Zm10 10H7.4L9 18.6 7.6 20l-4-4 4-4L9 13.4 7.4 15H17a3 3 0 0 0 3-3h2a5 5 0 0 1-5 5Z"/></svg>',
    loopOne: '<svg viewBox="0 0 24 24"><path d="M7 7h9.6L15 5.4 16.4 4 20.4 8l-4 4L15 10.6 16.6 9H7a3 3 0 0 0-3 3H2a5 5 0 0 1 5-5Zm10 10H7.4L9 18.6 7.6 20l-4-4 4-4L9 13.4 7.4 15H17a3 3 0 0 0 3-3h2a5 5 0 0 1-5 5Z"/><path d="M13.4 9.6v4.8h-2.3v-2.7l-1.5.9v-2l1.9-1z"/></svg>',
    volume: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4Zm12.2-1.6-1.4 1.4a4.5 4.5 0 0 1 0 6.4l1.4 1.4a6.5 6.5 0 0 0 0-9.2Zm2.8-2.8-1.4 1.4a8.5 8.5 0 0 1 0 12l1.4 1.4a10.5 10.5 0 0 0 0-14.8Z"/></svg>',
    volumeLow: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4Zm12.2-1.6-1.4 1.4a4.5 4.5 0 0 1 0 6.4l1.4 1.4a6.5 6.5 0 0 0 0-9.2Z"/></svg>',
    volumeMute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="m15.5 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8L12 2.5Z"/></svg>',
    heart: `<svg viewBox="0 0 24 24"><path d="${HEART_PATH}" fill="none" stroke="currentColor" stroke-width="2.1" transform="translate(1.2 1.3) scale(0.9)"/></svg>`,
    heartFill: `<svg viewBox="0 0 24 24"><path d="${HEART_PATH}" fill="currentColor"/></svg>`,
    // The Liked Songs cover: a heart with a little four-point sparkle.
    likedTile: `<svg viewBox="0 0 24 24"><g transform="translate(1 3.4) scale(0.8)"><path d="${HEART_PATH}" fill="currentColor"/></g><path d="M19.2 1.6c.25 2.15 1.2 3.1 3.3 3.35-2.1.25-3.05 1.2-3.3 3.35-.25-2.15-1.2-3.1-3.3-3.35 2.1-.25 3.05-1.2 3.3-3.35Z" fill="currentColor" opacity="0.9"/></svg>`,
    queue: '<svg viewBox="0 0 24 24"><path d="M3 5h13v2H3V5Zm0 4.5h13v2H3v-2ZM3 14h8v2H3v-2Zm11 0 7 4-7 4v-8Z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
    handle: '<svg viewBox="0 0 24 24"><path d="M4 7h16v2H4V7Zm0 4h16v2H4v-2Zm0 4h16v2H4v-2Z"/></svg>',
    replay10: '<svg viewBox="0 0 24 24"><path d="M12 5V1.5L7 6l5 4.5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z"/><text x="12.2" y="16.6" font-size="6.6" font-weight="800" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">10</text></svg>',
    forward10: '<svg viewBox="0 0 24 24"><path d="M12 5V1.5L17 6l-5 4.5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8Z"/><text x="11.8" y="16.6" font-size="6.6" font-weight="800" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">10</text></svg>',
    locate: '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.9 3A9 9 0 0 0 13 3.1V1h-2v2.1A9 9 0 0 0 3.1 11H1v2h2.1a9 9 0 0 0 7.9 7.9V23h2v-2.1a9 9 0 0 0 7.9-7.9H23v-2h-2.1ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"/></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M3 17.2V21h3.8L17.8 10l-3.8-3.8L3 17.2Zm17.7-10.2a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8 1.7-1.9Z"/></svg>',
    speaker: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-9.8v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    user: '<svg viewBox="0 0 24 24"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z"/></svg>',
    scissors: '<svg viewBox="0 0 24 24"><path d="M9.6 7.6A3.5 3.5 0 1 0 6.5 9.5c.5 0 1-.1 1.4-.3L10.7 12l-2.8 2.8a3.5 3.5 0 1 0 1.7 1.6L12 14l7 7h3v-1L9.6 7.6ZM6.5 7.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm0 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM19 3l-6 6 2 2 7-7V3h-3Z"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M13.5.7s.7 2.6.7 4.7c0 2-1.3 3.6-3.3 3.6S7.4 7.4 7.4 5.4l.1-.4C5.5 7.4 4 10.5 4 14a8 8 0 0 0 16 0C20 8.6 17.4 3.8 13.5.7ZM11.7 19c-1.8 0-3.2-1.4-3.2-3.1 0-1.6 1-2.8 2.8-3.1 1.8-.4 3.6-1.2 4.6-2.6.4 1.3.6 2.6.6 4 0 2.6-2.2 4.8-4.8 4.8Z"/></svg>',
    arrowDown: '<svg viewBox="0 0 24 24"><path d="M11 4h2v12.2l5.3-5.3 1.4 1.4L12 20l-7.7-7.7 1.4-1.4 5.3 5.3V4Z"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24"><path d="M13 20h-2V7.8l-5.3 5.3-1.4-1.4L12 4l7.7 7.7-1.4 1.4L13 7.8V20Z"/></svg>',
    chevronLeft: '<svg viewBox="0 0 24 24"><path d="M15 18 9 12l6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
};

// ── DOM REFS ──
const $ = (id) => document.getElementById(id);
const sidebar = $("sidebar");
const toggleSidebarBtn = $("toggle-sidebar-btn");
const homeBtn = $("home-btn");
const createPlaylistBtn = $("create-playlist-btn");
const addSongBtn = $("add-song-btn");
const playlistLinks = $("playlist-links");
const homeDashboard = $("home-dashboard");
const playlistView = $("playlist-view");
const playlistGrid = $("playlist-grid");
const currentPlaylistName = $("current-playlist-name");
const playlistViewArt = $("playlist-view-art");
const playlistStatsSongs = $("playlist-stats-songs");
const playlistStatsDuration = $("playlist-stats-duration");
const songList = $("song-list");
const modalOverlay = $("modal-overlay");
const modalTitle = $("modal-title");
const modalForm = $("modal-form");
const modalCancelBtn = $("modal-cancel-btn");
const modalSubmitBtn = $("modal-submit-btn");
const input1 = $("input-1");
const input2 = $("input-2");
const group2 = $("group-2");
const fileGroup1 = $("file-group-1");
const fileGroup2 = $("file-group-2");
const fileInputSong = $("file-input-song");
const fileInputArt = $("file-input-art");
const trackArt = $("track-art");
const trackTitle = $("track-title");
const trackArtist = $("track-artist");
const playPauseBtn = $("play-pause-btn");
const shuffleBtn = $("shuffle-btn");
const prevBtn = $("prev-btn");
const nextBtn = $("next-btn");
const loopBtn = $("loop-btn");
const volumeIconBtn = $("volume-icon-btn");
const currentTimeLabel = $("current-time");
const totalTimeLabel = $("total-time");
const progressBar = $("progress-bar");
const volumeBar = $("volume-bar");
const playlistOptionsBtn = $("playlist-options-btn");
const queueList = $("queue-list");
const nextList = $("next-list");
const clearQueueBtn = $("clear-queue-btn");
const exportLibraryBtn = $("export-library-btn");
const importLibraryInput = $("import-library-input");
const confirmOverlay = $("confirm-overlay");
const confirmTitle = $("confirm-title");
const confirmMessage = $("confirm-message");
const confirmCancelBtn = $("confirm-cancel-btn");
const confirmDeleteBtn = $("confirm-delete-btn");
const homeSearch = $("home-search");
const homeSearchClear = $("home-search-clear");
const playlistSearch = $("playlist-search");
const playlistSearchClear = $("playlist-search-clear");
const noPlaylistsMsg = $("no-playlists-msg");
const noSearchResults = $("no-search-results");
const greetingText = $("greeting-text");
const backToHomeBtn = $("back-to-home-btn");
const playAllBtn = $("play-all-btn");
const mobileMiniPlayer = $("mobile-mini-player");
const miniTrackArt = $("mini-track-art");
const miniTrackTitle = $("mini-track-title");
const miniTrackArtist = $("mini-track-artist");
const miniPlayBtn = $("mini-play-btn");
const miniNextBtn = $("mini-next-btn");
const miniProgressFill = $("mini-progress-fill");
const mobileBottomNav = $("mobile-bottom-nav");
const nowPlayingScreen = $("now-playing-screen");
const npCollapseBtn = $("np-collapse-btn");
const npArt = $("np-art");
const npTitle = $("np-title");
const npArtist = $("np-artist");
const npSource = $("np-source");
const npProgressBar = $("np-progress-bar");
const npCurrentTime = $("np-current-time");
const npTotalTime = $("np-total-time");
const npPlayBtn = $("np-play-btn");
const npPrevBtn = $("np-prev-btn");
const npNextBtn = $("np-next-btn");
const npShuffleBtn = $("np-shuffle-btn");
const npLoopBtn = $("np-loop-btn");
const npOptionsBtn = $("np-options-btn");
const mainContent = $("main-content");
const playerLikeBtn = $("player-like-btn"), miniLikeBtn = $("mini-like-btn"), npLikeBtn = $("np-like-btn");
const queueToggleBtn = $("queue-toggle-btn"), progressTip = $("progress-tip"), nextHeading = $("next-heading");
const npQueueList = $("np-queue-list"), npNextList = $("np-next-list"), npNextLabel = $("np-next-label"), npQueueClear = $("np-queue-clear");
const importLinkBtn = $("import-link-btn");
const searchResultsEl = $("search-results"), playlistsHeading = $("playlists-heading");

function isMobile() { return window.innerWidth <= 768; }
function isNowPlayingOpen() { return !!nowPlayingScreen && nowPlayingScreen.classList.contains("open"); }
function isShown(el) { return !!el && !el.hidden && el.style.display !== "none"; }

// ── PREFERENCES (Settings → General, plus a few playback switches) ──
const PREFS_KEY = "spootify-prefs";
const DEFAULT_PREFS = {
    name: "", openOnHome: true, smoothPause: true, upNextReminder: true, vibration: true,
    remainingTime: false, skipButtons: true, jumpButton: true, scrollEndButton: true, nextUpCount: 10, smartShuffle: true,
    milestoneToasts: true, playlistSort: "custom", listenAfter: 10, skipBefore: 0
};
function loadPrefs() {
    try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); return { ...DEFAULT_PREFS, ...(p && typeof p === "object" ? p : {}) }; }
    catch { return { ...DEFAULT_PREFS }; }
}
let prefs = loadPrefs();
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} }

// Appearance settings live in themes.js (applied before first paint); mirrored here.
const Themes = window.SpootifyThemes || null;
let appearance = Themes ? Themes.loadSettings() : { theme: "spootify", accent: null, artColors: true, visualizer: "bars", compact: false, cardSize: "m", reduceMotion: false, showStats: true, miniChart: true, showRecent: true, showAdded: true, showSongOfDay: true, showDj: true, animations: true, showQuiet: true };
// The visualizer routes all audio through Web Audio. On Android that path hasn't been
// proven with the screen off yet, so there it stays opt-in (Settings → Appearance).
try {
    const raw = JSON.parse(localStorage.getItem("spootify-appearance") || "{}");
    if (!("visualizer" in raw) && window.Capacitor && typeof window.Capacitor.getPlatform === "function" && window.Capacitor.getPlatform() === "android") appearance.visualizer = "off";
} catch {}

// ── SMALL HELPERS ──
const textCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function normalizeText(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function throttle(fn, ms) {
    let last = 0, timer = null;
    return (...args) => {
        const now = Date.now(), wait = ms - (now - last);
        if (wait <= 0) { last = now; fn(...args); }
        else if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(...args); }, wait);
    };
}
// Song ids are millisecond timestamps; this keeps them unique even when many songs are
// added in the same millisecond (bulk add, copies), which used to give duplicate ids.
function newSongId() { lastSongId = Math.max(Date.now(), lastSongId + 1); return lastSongId; }
function haptic(ms = 10) { if (prefs.vibration && navigator.vibrate) { try { navigator.vibrate(ms); } catch {} } }

// ── PROBLEMS LOG ── errors and unexpected restarts, newest first (Settings → General →
// Problems), so a crash on a phone can be traced afterwards without a debugger.
const PROBLEMS_KEY = "spootify-problems", ACTIVITY_KEY = "spootify-activity";
function loadProblems() { try { const a = JSON.parse(localStorage.getItem(PROBLEMS_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }
function logProblem(text) {
    text = String(text || "Unknown problem").slice(0, 400);
    const list = loadProblems();
    if (list[0] && list[0].text === text && Date.now() - list[0].at < 60000) list[0].n = (list[0].n || 1) + 1;
    else list.unshift({ at: Date.now(), text });
    try { localStorage.setItem(PROBLEMS_KEY, JSON.stringify(list.slice(0, 25))); } catch {}
    renderProblems();
}
function renderProblems() {
    const box = document.getElementById("problem-log"); if (!box) return;
    const list = loadProblems();
    box.innerHTML = list.length ? list.map((p) => `<div class="problem"><time>${escapeHtml(new Date(p.at).toLocaleString())}${p.n > 1 ? ` · ${p.n}×` : ""}</time>${escapeHtml(p.text)}</div>`).join("") : '<span class="problem-none">Nothing so far.</span>';
}
// What a heavy job is doing right now; a crash in the middle of it is logged with it.
function noteActivity(what) { try { if (what) localStorage.setItem(ACTIVITY_KEY, JSON.stringify({ what, at: Date.now() })); else localStorage.removeItem(ACTIVITY_KEY); } catch {} }
function takeLastActivity() {
    try { const a = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || "null"); localStorage.removeItem(ACTIVITY_KEY); return a && Date.now() - a.at < 10 * 60000 ? a.what : null; } catch { return null; }
}
window.addEventListener("error", (e) => logProblem(`Error: ${e.message || e.error}${e.filename ? ` (${String(e.filename).split("/").pop()}:${e.lineno})` : ""}`));
window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason; if (r && (r.name === "AbortError" || r.name === "NotAllowedError")) return; // play() interrupted: normal
    logProblem(`Error: ${(r && (r.message || r)) || "unknown"}`);
});

// ── ICON HELPERS ──
function setIcon(button, icon, label) {
    if (!button) return;
    button.innerHTML = icon;
    button.setAttribute("aria-label", label);
    button.title = label;
}

function applyIcons() {
    setIcon(toggleSidebarBtn, ICONS.panelLeft, "Collapse sidebar");
    setIcon(shuffleBtn, ICONS.shuffle, "Shuffle");
    setIcon(prevBtn, ICONS.prev, "Previous");
    setIcon(playPauseBtn, ICONS.play, "Play");
    setIcon(nextBtn, ICONS.next, "Next");
    updateLoopButton();
    setIcon(volumeIconBtn, ICONS.volume, "Mute");
    setIcon(playlistOptionsBtn, ICONS.dots, "Playlist options");
    setIcon($("skip-back-btn"), ICONS.replay10, "Back 10 seconds");
    setIcon($("skip-fwd-btn"), ICONS.forward10, "Forward 10 seconds");
    setIcon($("np-skip-back-btn"), ICONS.replay10, "Back 10 seconds");
    setIcon($("np-skip-fwd-btn"), ICONS.forward10, "Forward 10 seconds");
    const jump = $("jump-playing-btn"); if (jump) { jump.innerHTML = `${ICONS.locate}<span>Now playing</span>`; jump.setAttribute("aria-label", "Jump to the playing song"); jump.title = "Jump to the playing song"; }
}

function updateGreeting() {
    if (!greetingText) return;
    const hour = new Date().getHours();
    const base = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";
    const name = String(prefs.name || "").trim();
    greetingText.textContent = name ? `${base}, ${name}` : base;
}

// ══════════════════════════════════════════════
// ── BLOB STORAGE ENGINE ──
// Media (audio/images) stored as individual Blobs
// in their own object store. Metadata store stays tiny.
// ══════════════════════════════════════════════
const blobUrlCache = new Map();

// One shared connection: opening IndexedDB per blob (the old behaviour) made a
// large library take seconds to boot.
let dbPromise = null;
function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
            if (!db.objectStoreNames.contains(DB_MEDIA)) db.createObjectStore(DB_MEDIA);
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); dbPromise = null; };
            db.onclose = () => { dbPromise = null; };
            resolve(db);
        };
        request.onerror = () => { dbPromise = null; reject(request.error); };
    });
    return dbPromise;
}

function genId() { return "m" + Date.now() + Math.random().toString(36).slice(2, 8); }

// Media stored in the last few minutes is never cleaned up: a song being added (from a
// file, a download, a trim) has its audio and cover saved before it's in a playlist, and
// a clean-up running in between (an Undo running out, the one at start-up) used to delete them.
const freshBlobIds = new Map(); // id -> when stored
const FRESH_BLOB_MS = 10 * 60 * 1000;
async function storeBlob(blob, id) {
    const mid = id || genId();
    freshBlobIds.set(mid, Date.now());
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_MEDIA, "readwrite");
        tx.objectStore(DB_MEDIA).put(blob, mid);
        tx.oncomplete = () => resolve(mid);
        tx.onerror = () => reject(tx.error);
    });
}

async function getBlob(mid) {
    if (!mid) return null;
    const db = await openDb();
    return new Promise((resolve) => {
        const tx = db.transaction(DB_MEDIA, "readonly");
        const r = tx.objectStore(DB_MEDIA).get(mid);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
    });
}

// Covers are shown small almost everywhere, but every one on screen is decoded at full
// size: a handful of 3000 px album covers from music files was enough for Android to kill
// the WebView, which takes the whole app down ("it just closes"). Pictures are kept at up
// to COVER_MAX px; the cropper keeps working from these (it scales its rectangle).
const COVER_MAX = 640, COVER_MAX_BYTES = 200 * 1024;
async function shrinkCover(blob) {
    if (!(blob instanceof Blob) || typeof createImageBitmap !== "function" || (blob.type && !blob.type.startsWith("image/"))) return blob;
    let bmp = null;
    try {
        bmp = await createImageBitmap(blob);
        const W = bmp.width, H = bmp.height;
        if (!W || !H || (Math.max(W, H) <= COVER_MAX && blob.size <= COVER_MAX_BYTES)) return blob;
        const k = Math.min(1, COVER_MAX / Math.max(W, H)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
        const g = c.getContext("2d"); g.imageSmoothingQuality = "high";
        g.drawImage(bmp, 0, 0, c.width, c.height);
        const out = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
        c.width = c.height = 0; // let go of the canvas memory now, not at the next GC
        if (!out) return blob;
        return k < 1 || out.size < blob.size ? out : blob;
    } catch { return blob; }
    finally { if (bmp && typeof bmp.close === "function") bmp.close(); }
}
// Libraries from before shrinkCover: shrink the big covers already stored, once, one at a
// time in the background. A picture kept as a song's crop source (thumbId) is left whole.
async function shrinkStoredCovers() {
    const DONE_KEY = "spootify-covers-shrunk-v1";
    try { if (localStorage.getItem(DONE_KEY)) return; } catch { return; }
    if (!libraryLoadedOk) return;
    const owners = new Map(), keep = new Set(); // artId -> [songs / playlists showing it]
    const own = (o) => { if (o?.artId) { if (!owners.has(o.artId)) owners.set(o.artId, []); owners.get(o.artId).push(o); } if (o?.thumbId) keep.add(o.thumbId); };
    for (const pl of Object.values(playlists)) { own(pl); for (const s of pl.songs || []) own(s); }
    for (const item of queue) own(item?.song);
    for (const t of trash) { own(t.song); if (t.playlist) { own(t.playlist); for (const s of t.playlist.songs || []) own(s); } }
    own(currentTrack);
    let changed = 0;
    for (const [id, list] of owners) {
        if (keep.has(id)) continue;
        try {
            const blob = await getBlob(id);
            if (!blob || blob.size <= COVER_MAX_BYTES) continue;
            const small = await shrinkCover(blob);
            if (small === blob) continue;
            await storeBlob(small, id);
            const old = blobUrlCache.get(id);
            if (old) { blobUrlCache.delete(id); try { URL.revokeObjectURL(old); } catch {} }
            artThumbCache.delete(id);
            const url = await getBlobUrl(id);
            for (const o of list) if (o.art === old || !o.art) o.art = url || DEFAULT_ART;
            if (currentTrack?.artId === id) currentTrack.art = url || DEFAULT_ART;
            changed++;
        } catch (e) { console.warn("Couldn't shrink a cover", e); }
        await new Promise((r) => setTimeout(r, 25)); // stay out of the way of scrolling and playback
    }
    try { localStorage.setItem(DONE_KEY, "1"); } catch {}
    if (changed) {
        console.log(`Storage: shrank ${changed} oversized cover(s)`);
        renderPlaylists(); renderQueue();
        if (playlistView && playlistView.style.display !== "none") renderSongs();
        if (currentTrack) showTrackInfo(currentTrack, currentTrackSource);
    }
}

async function getBlobUrl(mid) {
    if (!mid) return null;
    if (blobUrlCache.has(mid)) return blobUrlCache.get(mid);
    const blob = await getBlob(mid);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    blobUrlCache.set(mid, url);
    return url;
}

// Resolve many ids in a single transaction (boot-time hydration).
async function getBlobUrls(ids) {
    const result = new Map();
    const missing = [];
    for (const id of new Set(ids.filter(Boolean))) {
        if (blobUrlCache.has(id)) result.set(id, blobUrlCache.get(id)); else missing.push(id);
    }
    if (!missing.length) return result;
    const db = await openDb();
    await new Promise((resolve) => {
        const tx = db.transaction(DB_MEDIA, "readonly");
        const store = tx.objectStore(DB_MEDIA);
        for (const id of missing) {
            const r = store.get(id);
            r.onsuccess = () => { if (r.result) { const url = URL.createObjectURL(r.result); blobUrlCache.set(id, url); result.set(id, url); } };
        }
        tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    });
    return result;
}

async function deleteBlobs(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return;
    const db = await openDb();
    await new Promise((resolve) => {
        const tx = db.transaction(DB_MEDIA, "readwrite");
        for (const id of list) tx.objectStore(DB_MEDIA).delete(id);
        tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    });
    for (const id of list) { const url = blobUrlCache.get(id); if (url) { try { URL.revokeObjectURL(url); } catch {} blobUrlCache.delete(id); } artThumbCache.delete(id); }
}


// Every media id still referenced by a playlist cover, a song, the queue, the playing
// track, or something an Undo toast can still bring back.
function collectReferencedBlobIds() {
    const ids = new Set();
    const addSong = (s) => { if (s?.mediaId) ids.add(s.mediaId); if (s?.artId) ids.add(s.artId); if (s?.thumbId) ids.add(s.thumbId); };
    for (const pl of Object.values(playlists)) {
        if (pl.artId) ids.add(pl.artId);
        for (const s of pl.songs || []) addSong(s);
    }
    for (const item of queue) addSong(item?.song);
    addSong(currentTrack); addSong(crossfadePending?.song);
    for (const t of trash) {
        if (t.song) addSong(t.song);
        if (t.playlist) { if (t.playlist.artId) ids.add(t.playlist.artId); for (const s of t.playlist.songs || []) addSong(s); }
    }
    for (const id of undoProtectedIds) ids.add(id);
    for (const id of window.SpootifyDJ?.mediaIds?.() || []) ids.add(id); // songs loaded on the DJ decks
    const cutoff = Date.now() - FRESH_BLOB_MS;
    for (const [id, at] of freshBlobIds) { if (at < cutoff) freshBlobIds.delete(id); else ids.add(id); }
    return ids;
}

// While a Wi-Fi sync runs (sync.js sets this), deleting waits: the other device may be
// reading that song's audio, and media received for the sync isn't in a playlist yet.
// Playing, browsing and editing keep working.
let syncActive = false;
function blockedBySync() {
    if (!syncActive) return false;
    showToast("Wait for the sync to finish before deleting anything");
    return true;
}

// Songs copied between playlists share their media, so a blob is only garbage
// once nothing references it. Called after removals and once at boot; skipped
// unless the library loaded properly so a bad load can never wipe media.
let gcRunning = false;
async function gcUnreferencedBlobs() {
    if (gcRunning || !libraryLoadedOk || syncActive) return; // media for a sync isn't in a playlist until it's applied
    gcRunning = true;
    try {
        const db = await openDb();
        const keys = await new Promise((resolve) => {
            const r = db.transaction(DB_MEDIA, "readonly").objectStore(DB_MEDIA).getAllKeys();
            r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]);
        });
        const referenced = collectReferencedBlobIds();
        const orphans = keys.filter((k) => !referenced.has(k));
        if (orphans.length) { await deleteBlobs(orphans); console.log(`Storage: removed ${orphans.length} unused media blob(s)`); }
    } catch (e) { console.warn("Blob GC failed", e); }
    finally { gcRunning = false; }
}

// Songs that were "added to playlist" from another playlist share a mediaId, so an
// edit to one is an edit to all of them (and to their copies in the queue).
function propagateSongEdit(edited) {
    if (!edited?.mediaId) return;
    const apply = (s) => { if (s && s !== edited && s.mediaId === edited.mediaId) { s.title = edited.title; s.artist = edited.artist; s.artId = edited.artId; s.art = edited.art; s.thumbId = edited.thumbId; s.coverCrop = edited.coverCrop; } };
    for (const pl of Object.values(playlists)) for (const s of pl.songs || []) apply(s);
    for (const item of queue) apply(item?.song);
    apply(currentTrack);
}

function dataUrlToBlob(dataUrl) {
    try {
        const [header, base64] = dataUrl.split(",");
        const mime = header.match(/:(.*?);/)[1];
        const bin = atob(base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
    } catch { return null; }
}


function isDataUrl(v) { return typeof v === "string" && v.startsWith("data:") && v !== DEFAULT_ART && v !== LEGACY_DEFAULT_ART && v.length > 200; }

// Save: only metadata, no media blobs
async function saveLibrary() {
    libraryVersion++;
    try {
        const db = await openDb();
        const cleanSong = (s) => ({
            id: s.id, title: s.title, artist: s.artist,
            timestamp: s.timestamp, duration: s.duration,
            mediaId: s.mediaId || null, artId: s.artId || null,
            loudness: Number.isFinite(s.loudness) ? s.loudness : undefined,
            src: typeof s.src === "string" ? s.src : undefined, // where it was imported from ("yt:<video id>")
            thumbId: s.thumbId || undefined, coverCrop: s.coverCrop || undefined // the full picture its cover was cut from
        });
        const cleanPlaylist = (pl) => ({
            name: pl.name, artId: pl.artId || null, sort: pl.sort || null,
            pinned: !!pl.pinned, order: Number.isFinite(pl.order) ? pl.order : undefined,
            songs: (pl.songs || []).map(cleanSong)
        });
        const cleanPlaylists = {};
        for (const [name, pl] of Object.entries(playlists)) cleanPlaylists[name] = cleanPlaylist(pl);
        const cleanQueue = queue.filter(i => i?.song).map(i => ({
            playlistName: i.playlistName, song: cleanSong(i.song)
        }));
        const cleanTrash = trash.map((t) => t.type === "playlist"
            ? { id: t.id, type: t.type, deletedAt: t.deletedAt, name: t.name, playlist: cleanPlaylist(t.playlist) }
            : { id: t.id, type: t.type, deletedAt: t.deletedAt, playlistName: t.playlistName, index: t.index, song: cleanSong(t.song) });
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put({ playlists: cleanPlaylists, currentPlaylist, queue: cleanQueue, liked: [...likedSongs], trash: cleanTrash }, DB_KEY);
        scheduleCarLibrary();
    } catch (e) {
        console.error("Save failed", e);
    }
}

async function loadLibrary() {
    try {
        const db = await openDb();
        return new Promise((resolve) => {
            const tx = db.transaction(DB_STORE, "readonly");
            const r = tx.objectStore(DB_STORE).get(DB_KEY);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => resolve(null);
        });
    } catch (e) {
        console.error("Load failed", e);
        return null;
    }
}

// Resolve artId → blob URLs. Audio (fileSrc) is resolved lazily by playSong(), so
// boot only has to touch the small cover images — and does it playlist by playlist
// so the UI can show up before the whole library is hydrated.
async function hydrateSongArt(songs) {
    const pending = songs.filter((s) => s && !s.art);
    if (!pending.length) return false;
    const urls = await getBlobUrls(pending.map((s) => s.artId));
    for (const s of pending) s.art = (s.artId && urls.get(s.artId)) || DEFAULT_ART;
    return true;
}
async function hydratePlaylistCovers() {
    const list = Object.values(playlists);
    const urls = await getBlobUrls(list.map((pl) => pl.artId));
    for (const pl of list) pl.art = (pl.artId && urls.get(pl.artId)) || DEFAULT_ART;
}
function setBootProgress(fraction) {
    const bar = $("boot-progress"); if (!bar) return;
    const fill = bar.firstElementChild;
    if (fraction >= 1) { if (fill) fill.style.width = "100%"; setTimeout(() => bar.classList.remove("show"), 350); return; }
    bar.classList.add("show");
    if (fill) fill.style.width = Math.max(4, Math.round(fraction * 100)) + "%";
}

// Migrate old data URLs → separate blobs
async function migrateOldData(data) {
    if (!data?.playlists) return false;
    let migrated = false;
    for (const pl of Object.values(data.playlists)) {
        if (isDataUrl(pl.art)) {
            const blob = dataUrlToBlob(pl.art);
            if (blob) { pl.artId = await storeBlob(blob); pl.art = DEFAULT_ART; migrated = true; }
        }
        for (const song of pl.songs || []) {
            if (isDataUrl(song.fileSrc)) {
                const blob = dataUrlToBlob(song.fileSrc);
                if (blob) { song.mediaId = await storeBlob(blob); song.fileSrc = null; migrated = true; }
            }
            if (isDataUrl(song.art)) {
                const blob = dataUrlToBlob(song.art);
                if (blob) { song.artId = await storeBlob(blob); song.art = DEFAULT_ART; migrated = true; }
            }
        }
    }
    for (const item of data.queue || []) {
        if (!item.song) continue;
        if (isDataUrl(item.song.fileSrc)) {
            const blob = dataUrlToBlob(item.song.fileSrc);
            if (blob) { item.song.mediaId = await storeBlob(blob); item.song.fileSrc = null; migrated = true; }
        }
        if (isDataUrl(item.song.art)) {
            const blob = dataUrlToBlob(item.song.art);
            if (blob) { item.song.artId = await storeBlob(blob); item.song.art = DEFAULT_ART; migrated = true; }
        }
    }
    return migrated;
}


// ── UTILITY ──
// "3:07", or "1:02:03" for long mixes.
function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const s = Math.floor(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// "23 sec" / "14 min" / "2 hr 5 min" — for totals that may be short (artist pages).
function formatMusicLength(totalSeconds) {
    const s = Math.floor(totalSeconds || 0);
    if (s < 60) return `${s} sec`;
    return formatPlaylistTotalDuration(s);
}
function formatPlaylistTotalDuration(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hr ${mins % 60} min`;
}

// Broken art falls back to the placeholder through one capture-phase listener below,
// so images no longer need a handler each.
function addImageFallback(img) { if (img) img.decoding = "async"; }
document.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t.tagName === "IMG" && t.getAttribute("src") !== DEFAULT_ART && !t.dataset.noFallback) t.src = DEFAULT_ART;
}, true);

function getRelativeTimeString(timestamp) {
    const diffInSeconds = Math.floor((Date.now() - timestamp) / 1000);
    if (diffInSeconds < 60) return "Just now";
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays <= 7) return `${diffInDays} ${diffInDays === 1 ? "day" : "days"} ago`;
    return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function findSongById(songId) {
    for (const playlistName of Object.keys(playlists)) {
        const song = (playlists[playlistName].songs || []).find((item) => item.id === songId);
        if (song) return { song, playlistName };
    }
    return null;
}

// ── SORTING ──
// Each playlist remembers a view sort ({ key, dir }); null = the order songs were added.
// Both the song list and "next track" logic go through these so playback follows the view.
const SORT_COMPARATORS = {
    title: (a, b) => cmpText(a.title, b.title) || cmpText(a.artist, b.artist),
    artist: (a, b) => cmpText(a.artist, b.artist) || cmpText(a.title, b.title),
    date: (a, b) => (a.timestamp || 0) - (b.timestamp || 0),
    length: (a, b) => (a.duration || 0) - (b.duration || 0),
    // Most played first on the first click, like the stats page.
    plays: (a, b) => playsOf(b) - playsOf(a) || cmpText(a.title, b.title),
    rating: (a, b) => ratingOf(b) - ratingOf(a) || playsOf(b) - playsOf(a) || cmpText(a.title, b.title)
};
function playsOf(song) { return listenStats[statsKeyFor(song)]?.plays || 0; }

// ── RATINGS ──
// 1-5 stars per song, kept per audio file so every copy in every playlist shares it.
// Set from the song menu or the full-screen player; playlists can sort by it and Home
// has a "Top rated" shelf.
const RATINGS_KEY = "spootify-ratings";
let ratings = {};
try { const r = JSON.parse(localStorage.getItem(RATINGS_KEY) || "{}"); ratings = r && typeof r === "object" ? r : {}; } catch { ratings = {}; }
function ratingOf(song) { const v = ratings[statsKeyFor(song)]; return v >= 1 && v <= 5 ? v : 0; }
function saveRatings() { try { localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings)); } catch {} }
function setRating(song, n) {
    const key = statsKeyFor(song); if (!key) return;
    if (n >= 1 && n <= 5) ratings[key] = n; else delete ratings[key];
    saveRatings();
    sortedCache.clear();
    haptic(8);
    renderSongs(); renderQueue(); scheduleShelves(); updateRatingButtons();
}
const STAR = "&#9733;";
function rowStarsHtml(song) { const r = ratingOf(song); return r ? ` <i class="row-stars" title="Rated ${r} of 5">${STAR.repeat(r)}</i>` : ""; }
function ratingButtonsHtml(current) { return [1, 2, 3, 4, 5].map((i) => `<button type="button" data-rate="${i}" class="${i <= current ? "on" : ""}" aria-label="${i} star${i > 1 ? "s" : ""}">${STAR}</button>`).join(""); }
function updateRatingButtons() {
    const r = currentTrack ? ratingOf(currentTrack) : 0;
    for (const el of [$("np-rating"), $("player-rating")]) {
        if (!el) continue;
        el.hidden = !currentTrack;
        el.querySelectorAll("[data-rate]").forEach((b) => b.classList.toggle("on", Number(b.dataset.rate) <= r));
        el.setAttribute("aria-label", r ? `Rated ${r} of 5` : "Not rated");
    }
}
// ── RATING EFFECTS ── a little flourish for 5 stars and 1 star (Appearance → Star Ratings).
// Short-lived spans in one fixed layer, animated with transform/opacity only, removed when done.
const RATE_FX_DEFAULTS = { 5: "sparkle", 1: "rain" };
function rateFxLayer() {
    let l = $("rate-fx-layer");
    if (!l) { l = document.createElement("div"); l.id = "rate-fx-layer"; l.setAttribute("aria-hidden", "true"); document.body.appendChild(l); }
    return l;
}
function rateFxBit(x, y, cls, html = "", style = "") {
    const el = document.createElement("span");
    el.className = "rfx " + cls; el.innerHTML = html;
    el.style.cssText = `left:${x}px;top:${y}px;${style}`;
    rateFxLayer().appendChild(el);
    return el;
}
function rateFxRun(el, frames, ms, delay = 0, easing = "cubic-bezier(0.2, 0.6, 0.35, 1)") {
    const a = el.animate(frames, { duration: ms, delay, easing, fill: "both" });
    a.onfinish = a.oncancel = () => el.remove();
}
const rnd = (a, b) => a + Math.random() * (b - a);
const RATE_FX = {
    sparkle(x, y) {
        for (let i = 0; i < 14; i++) {
            const ang = (i / 14) * Math.PI * 2 + rnd(-0.2, 0.2), d = rnd(40, 90);
            const el = rateFxBit(x, y, "rfx-star", STAR, `font-size:${rnd(12, 22)}px`);
            rateFxRun(el, [{ transform: "translate(-50%,-50%) scale(0.2) rotate(0deg)", opacity: 1 },
                { transform: `translate(calc(-50% + ${Math.cos(ang) * d * 0.7}px), calc(-50% + ${Math.sin(ang) * d * 0.7}px)) scale(1.2) rotate(90deg)`, opacity: 1, offset: 0.55 },
                { transform: `translate(calc(-50% + ${Math.cos(ang) * d}px), calc(-50% + ${Math.sin(ang) * d}px)) scale(0) rotate(180deg)`, opacity: 0 }], rnd(650, 900), rnd(0, 80));
        }
    },
    confetti(x, y) {
        const colors = [getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1db954", "#f5c542", "#ff4d6d", "#4dabff", "#a66bff", "#2ee6a6"];
        for (let i = 0; i < 40; i++) {
            const dx = rnd(-150, 150), up = rnd(-170, -70), fall = rnd(160, 300), spin = rnd(-900, 900);
            const el = rateFxBit(x, y, "rfx-confetti", "", `background:${colors[i % colors.length]};width:${rnd(5, 9)}px;height:${rnd(8, 14)}px`);
            rateFxRun(el, [{ transform: "translate(-50%,-50%) rotate(0deg)", opacity: 1 },
                { transform: `translate(${dx * 0.6}px, ${up}px) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.35 },
                { transform: `translate(${dx}px, ${up + fall}px) rotate(${spin}deg)`, opacity: 0 }], rnd(1100, 1600), rnd(0, 60), "cubic-bezier(0.15, 0.55, 0.45, 1)");
        }
    },
    glow(x, y) {
        for (let i = 0; i < 3; i++) {
            const el = rateFxBit(x, y, "rfx-ring");
            rateFxRun(el, [{ transform: "translate(-50%,-50%) scale(0.2)", opacity: 0.95 }, { transform: "translate(-50%,-50%) scale(3.4)", opacity: 0 }], 900, i * 170, "ease-out");
        }
        const big = rateFxBit(x, y, "rfx-star rfx-bigstar", STAR);
        rateFxRun(big, [{ transform: "translate(-50%,-50%) scale(0.3)", opacity: 0 }, { transform: "translate(-50%,-60%) scale(1.6)", opacity: 1, offset: 0.4 },
            { transform: "translate(-50%,-90%) scale(1.2)", opacity: 0 }], 1100);
    },
    hearts(x, y) {
        for (let i = 0; i < 12; i++) {
            const dx = rnd(-70, 70), rise = rnd(90, 170), sway = rnd(-24, 24);
            const el = rateFxBit(x, y, "rfx-heart", ICONS.heartFill, `width:${rnd(14, 24)}px;height:${rnd(14, 24)}px`);
            rateFxRun(el, [{ transform: "translate(-50%,-50%) scale(0.3)", opacity: 0 }, { transform: `translate(calc(-50% + ${dx * 0.4 + sway}px), calc(-50% - ${rise * 0.4}px)) scale(1)`, opacity: 1, offset: 0.3 },
                { transform: `translate(calc(-50% + ${dx}px), calc(-50% - ${rise}px)) scale(0.9)`, opacity: 0 }], rnd(1000, 1500), rnd(0, 250), "ease-out");
        }
    },
    rain(x, y) {
        const cloud = rateFxBit(x, y - 34, "rfx-cloud", '<svg viewBox="0 0 64 40"><path d="M18 38a14 14 0 0 1-1.5-27.9A17 17 0 0 1 49 12a13 13 0 0 1-1 26H18Z"/></svg>');
        rateFxRun(cloud, [{ transform: "translate(-50%,-50%) scale(0.6)", opacity: 0 }, { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.15 },
            { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.8 }, { transform: "translate(-50%,-50%) scale(0.95)", opacity: 0 }], 1700, 0, "ease-out");
        for (let i = 0; i < 16; i++) {
            const dx = rnd(-20, 20);
            const el = rateFxBit(x + dx, y - 24, "rfx-drop");
            rateFxRun(el, [{ transform: "translate(-50%,0)", opacity: 0 }, { transform: "translate(-50%,6px)", opacity: 0.9, offset: 0.2 }, { transform: "translate(-50%,70px)", opacity: 0 }], rnd(500, 700), 200 + i * 70, "ease-in");
        }
    },
    shake(x, y) {
        haptic(40);
        const el = rateFxBit(x, y, "rfx-star rfx-sadstar", STAR);
        const k = [0, -10, 10, -8, 8, -5, 5, 0];
        rateFxRun(el, k.map((dx, i) => ({ transform: `translate(calc(-50% + ${dx}px), -50%) scale(1.5)`, opacity: i === k.length - 1 ? 0 : 1 })), 700, 0, "linear");
        document.querySelectorAll("#player-rating, #np-rating, .now-playing-screen.open .np-rating").forEach((r) => r.animate([0, -6, 6, -4, 4, 0].map((dx) => ({ transform: `translateX(${dx}px)` })), { duration: 420 }));
    },
    crumble(x, y) {
        for (let i = 0; i < 10; i++) {
            const dx = rnd(-40, 40), fall = rnd(60, 130), spin = rnd(-360, 360);
            const el = rateFxBit(x + rnd(-6, 6), y + rnd(-6, 6), "rfx-chip", "", `width:${rnd(3, 7)}px;height:${rnd(3, 7)}px`);
            rateFxRun(el, [{ transform: "translate(-50%,-50%)", opacity: 1 }, { transform: `translate(${dx}px, ${fall}px) rotate(${spin}deg)`, opacity: 0 }], rnd(700, 1000), rnd(80, 200), "cubic-bezier(0.5, 0, 0.9, 0.6)");
        }
        const star = rateFxBit(x, y, "rfx-star rfx-sadstar", STAR);
        rateFxRun(star, [{ transform: "translate(-50%,-50%) scale(1.4)", opacity: 1 }, { transform: "translate(-50%,-50%) scale(1.4) rotate(-12deg)", opacity: 1, offset: 0.25 },
            { transform: "translate(-50%,-50%) scale(0.4) rotate(20deg)", opacity: 0 }], 600);
    },
    sink(x, y) {
        const el = rateFxBit(x, y, "rfx-star rfx-sadstar", STAR);
        rateFxRun(el, [{ transform: "translate(-50%,-50%) scale(1.5)", opacity: 1 }, { transform: "translate(-50%,-50%) scale(1.5) rotate(-8deg)", opacity: 1, offset: 0.2 },
            { transform: "translate(-50%, 90px) scale(0.7) rotate(25deg)", opacity: 0 }], 1100, 0, "cubic-bezier(0.55, 0, 0.85, 0.4)");
    }
};
// n: the rating just given; origin: the star that was pressed. choice: preview this effect.
function playRatingEffect(n, origin, choice) {
    if (appearance.reduceMotion || (n !== 5 && n !== 1) || typeof Element.prototype.animate !== "function") return;
    const kind = choice || appearance["rateFx" + n] || RATE_FX_DEFAULTS[n];
    const run = RATE_FX[kind]; if (!run || !origin) return;
    const r = origin.getBoundingClientRect();
    run(clamp(r.left + r.width / 2, 20, window.innerWidth - 20), clamp(r.top + r.height / 2, 50, window.innerHeight - 20));
}
// A shared Intl.Collator: localeCompare() with options builds a new collator per call,
// which made sorting a big playlist noticeably slow.
function cmpText(a, b) { return textCollator.compare(String(a || ""), String(b || "")); }
// New playlists open sorted by artist; "#" in the header still switches to added order.
const DEFAULT_SORT = { key: "artist", dir: 1 };
function defaultSort() { return { ...DEFAULT_SORT }; }
function sortSongs(songs, sort) {
    const cmp = sort?.key && SORT_COMPARATORS[sort.key];
    if (!cmp) return songs;
    const dir = sort.dir === -1 ? -1 : 1;
    return [...songs].sort((a, b) => cmp(a, b) * dir);
}

// ── VIEWS ──
// Besides real playlists, two virtual sources can be opened and played like one:
// "liked:" (Liked Songs) and "artist:<name>" (see ARTIST PAGE).
const LIKED_SOURCE = "liked:";
function isLikedSource(name) { return name === LIKED_SOURCE; }
function isVirtualSource(name) { return isLikedSource(name) || isArtistSource(name); }
function viewExists(name) { return !!name && (isLikedSource(name) || !!playlists[name]); }
function sourceExists(name) { return !!name && (viewExists(name) || isArtistSource(name)); }
let likedSort = null; // Liked Songs view sort; null = most recently liked first
function getViewSort(name) { return isLikedSource(name) ? likedSort : (playlists[name]?.sort || null); }

// Sorted lists are cached per playlist until the library changes (saveLibrary bumps
// libraryVersion), because playback asks for them on every track change and render.
const sortedCache = new Map();
function getPlaylistSongsSorted(name) {
    if (isArtistSource(name)) return getArtistSongs(artistFromSource(name)).map((e) => e.song);
    if (isLikedSource(name)) return getLikedSongs();
    const pl = name && playlists[name];
    if (!pl) return [];
    const songs = pl.songs || [], sort = pl.sort || null, sig = sort ? sort.key + ":" + sort.dir : "";
    const hit = sortedCache.get(name);
    if (hit && hit.version === libraryVersion && hit.sig === sig && hit.src === songs && hit.len === songs.length) return hit.list;
    const list = sortSongs(songs, sort);
    sortedCache.set(name, { version: libraryVersion, sig, src: songs, len: songs.length, list });
    return list;
}

// ── PLAYLIST ORDER / PINNING ──
// Pinned playlists sit first (gold outline + star); within each group the user's
// manual order applies, falling back to creation order for playlists never moved.
function getOrderedPlaylistNames() {
    const names = Object.keys(playlists);
    const base = new Map(names.map((n, i) => [n, i]));
    const ord = (n) => { const o = playlists[n].order; return Number.isFinite(o) ? o : base.get(n) + 1e6; };
    return names.sort((a, b) => ((playlists[b].pinned ? 1 : 0) - (playlists[a].pinned ? 1 : 0)) || (ord(a) - ord(b)) || (base.get(a) - base.get(b)));
}
function normalizePlaylistOrder() { getOrderedPlaylistNames().forEach((n, i) => { playlists[n].order = i; }); }
// How Home and the sidebar list playlists (pinned still first). "custom" is your own
// order; the others are views only, so switching back restores it untouched.
const PLAYLIST_SORTS = { custom: "Your order", name: "Name (A–Z)", recent: "Recently added to", played: "Most played" };
function getDisplayPlaylistNames() {
    const names = getOrderedPlaylistNames(), mode = prefs.playlistSort;
    if (!PLAYLIST_SORTS[mode] || mode === "custom") return names;
    const pin = (n) => (playlists[n].pinned ? 0 : 1);
    const val = new Map(names.map((n) => {
        const songs = playlists[n].songs || [];
        if (mode === "recent") return [n, songs.reduce((m, s) => Math.max(m, s.timestamp || 0), 0)];
        if (mode === "played") return [n, songs.reduce((t, s) => t + playsOf(s), 0)];
        return [n, 0];
    }));
    return [...names].sort((a, b) => pin(a) - pin(b) || (mode === "name" ? cmpText(a, b) : val.get(b) - val.get(a) || cmpText(a, b)));
}
function openPlaylistSortMenu(x, y) {
    closeContextMenu();
    const menu = document.createElement("div"); menu.id = "active-context-menu"; menu.className = "context-menu";
    menu.innerHTML = '<div class="context-menu-title">Sort playlists</div>' + Object.entries(PLAYLIST_SORTS).map(([k, label]) =>
        `<button class="context-menu-item${prefs.playlistSort === k ? " checked" : ""}" data-sort="${k}"><span>${label}</span></button>`).join("");
    positionMenu(menu, x, y);
    menu.addEventListener("click", (e) => {
        const b = e.target.closest("[data-sort]"); if (!b) return;
        setPref("playlistSort", b.dataset.sort); renderPlaylists(); menu.remove();
    });
}
function syncPlaylistSortButton() {
    const btn = $("playlist-sort-btn"); if (!btn) return;
    btn.hidden = !!homeQuery || !playlistsHeading || playlistsHeading.hidden || Object.keys(playlists).length < 2;
    const label = btn.querySelector("span"); if (label) label.textContent = PLAYLIST_SORTS[prefs.playlistSort] || PLAYLIST_SORTS.custom;
}
if ($("playlist-sort-btn")) $("playlist-sort-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    openPlaylistSortMenu(r.right, r.bottom + 4);
});
async function setPlaylistPinned(name, pinned) {
    const pl = playlists[name]; if (!pl) return;
    pl.pinned = !!pinned;
    normalizePlaylistOrder();
    await saveLibrary(); renderPlaylists();
    showToast(pinned ? `Pinned "${name}"` : `Unpinned "${name}"`);
}
// Move a playlist to the slot of another (or by ±1 within its pinned/unpinned group).
async function movePlaylist(name, delta) {
    const names = getOrderedPlaylistNames();
    const from = names.indexOf(name); if (from === -1) return;
    const to = from + delta;
    if (to < 0 || to >= names.length || !!playlists[names[to]].pinned !== !!playlists[name].pinned) return;
    names.splice(from, 1); names.splice(to, 0, name);
    names.forEach((n, i) => { playlists[n].order = i; });
    await saveLibrary(); renderPlaylists();
}
async function movePlaylistTo(name, targetName) {
    if (name === targetName || !playlists[name] || !playlists[targetName]) return;
    const names = getOrderedPlaylistNames();
    const from = names.indexOf(name), to = names.indexOf(targetName);
    names.splice(from, 1); names.splice(to, 0, name);
    playlists[name].pinned = !!playlists[targetName].pinned; // dropping into the pinned group pins it, and vice versa
    names.forEach((n, i) => { playlists[n].order = i; });
    // Dragging only means something in your own order, so it switches back to it.
    if (prefs.playlistSort && prefs.playlistSort !== "custom") { setPref("playlistSort", "custom"); showToast("Switched to your own playlist order"); }
    await saveLibrary(); renderPlaylists();
}

// Click cycle per column: ascending, then descending, then off. "#" always resets to added order.
function setPlaylistSort(name, key) {
    const current = getViewSort(name);
    let next;
    if (!key) next = null;
    else if (!current || current.key !== key) next = { key, dir: 1 };
    else if (current.dir === 1) next = { key, dir: -1 };
    else next = null;
    if (isLikedSource(name)) {
        likedSort = next; likedVersion++;
        try { localStorage.setItem("spootify-liked-sort", JSON.stringify(next)); } catch {}
    } else if (playlists[name]) { playlists[name].sort = next; saveLibrary(); }
    else return;
    if (contextSource === name) customOrder = null; // a hand-made "Next up" order follows the new sort
    renderSongs(); renderQueue();
}
function updateSortHeader() {
    const header = $("song-list-header"); if (!header) return;
    const sort = getViewSort(currentPlaylist);
    header.querySelectorAll(".sort-btn").forEach((btn) => {
        const key = btn.dataset.sort || "";
        const active = sort ? sort.key === key : key === "";
        btn.classList.toggle("active", active);
        btn.classList.toggle("desc", active && sort?.dir === -1);
    });
}
const songListHeader = $("song-list-header");
if (songListHeader) songListHeader.addEventListener("click", (e) => { const btn = e.target.closest(".sort-btn"); if (btn && currentPlaylist) setPlaylistSort(currentPlaylist, btn.dataset.sort || ""); });

function getCurrentPlaylistSongs() {
    return getPlaylistSongsSorted(currentPlaylist);
}

function getPlaybackSourceSongs() {
    return sourceExists(contextSource) ? getPlaylistSongsSorted(contextSource) : getCurrentPlaylistSongs();
}

// ── CONFIRMATION / PROMPT ──
// config.input = { value, placeholder } turns it into a text prompt that resolves to
// the typed string (or null when cancelled).
function showPrompt(config) {
    return new Promise((resolve) => {
        if (!confirmOverlay) { resolve(config.input ? null : confirm(config.message)); return; }
        confirmTitle.textContent = config.title;
        confirmMessage.textContent = config.message || "";
        confirmMessage.style.display = config.message ? "" : "none";
        confirmDeleteBtn.textContent = config.confirmText || "OK";
        confirmCancelBtn.textContent = config.cancelText || "Cancel";
        confirmCancelBtn.style.display = config.showCancel !== false ? "" : "none";
        confirmDeleteBtn.classList.toggle("danger-action", !!config.danger);
        let input = null;
        if (config.input) {
            input = document.createElement("input");
            input.type = "text"; input.className = "prompt-input"; input.autocomplete = "off";
            input.value = config.input.value || ""; input.placeholder = config.input.placeholder || "";
            input.maxLength = config.input.maxLength || 60;
            confirmMessage.after(input);
        }
        confirmOverlay.style.display = "flex";
        const cleanup = () => {
            confirmOverlay.style.display = "none";
            if (input) input.remove();
            confirmDeleteBtn.removeEventListener("click", onConfirm);
            confirmCancelBtn.removeEventListener("click", onCancel);
            confirmOverlay.removeEventListener("click", onOverlay);
            document.removeEventListener("keydown", onKey);
        };
        // config.presses: the confirm button has to be tapped that many times (resets).
        let left = Math.max(1, Math.round(config.presses || 1));
        const label = config.confirmText || "OK";
        if (left > 1) confirmDeleteBtn.textContent = `${label} (tap ${left}x)`;
        const onConfirm = () => {
            if (input && !input.value.trim()) { input.focus(); return; }
            if (--left > 0) {
                confirmDeleteBtn.textContent = `${label} (${left} more)`;
                confirmDeleteBtn.classList.remove("press-bump"); void confirmDeleteBtn.offsetWidth; confirmDeleteBtn.classList.add("press-bump");
                haptic(left <= 3 ? 18 : 8);
                return;
            }
            cleanup(); resolve(input ? input.value.trim() : true);
        };
        const onCancel = () => { cleanup(); resolve(input ? null : false); };
        const onKey = (e) => {
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
            else if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
        };
        const onOverlay = (e) => { if (e.target === confirmOverlay) onCancel(); };
        confirmDeleteBtn.addEventListener("click", onConfirm);
        confirmCancelBtn.addEventListener("click", onCancel);
        confirmOverlay.addEventListener("click", onOverlay);
        document.addEventListener("keydown", onKey);
        setTimeout(() => { if (input) { input.focus(); input.select(); } else confirmDeleteBtn.focus(); }, 30);
    });
}

function showMessage(title, message) {
    return showPrompt({ title, message, confirmText: "OK", showCancel: false });
}


// ── AUDIO PLAYBACK ──
// What reaches the speakers = the volume slider × a short fade (smooth play/pause) ×
// the sleep timer's fade-out, or nothing while muted. Crossfades scale this per
// element while they run, so every path agrees on one "full" volume.
let userVolume = 0.8, isMuted = false, fadeGain = 1, sleepGain = 1, fadeTimer = null;
function masterVolume() { return isMuted ? 0 : clamp(userVolume * fadeGain * sleepGain, 0, 1); }
function applyVolume() {
    if (crossfadeFadeId) return; // the crossfade loop sets both elements itself
    const v = masterVolume();
    audioPlayer.volume = v;
    if (!crossfadePending) standbyPlayer.volume = v;
}
// Fades use timers (not animation frames) but only run while the app is on screen:
// hidden pages get their timers throttled, and a pause must never hang half-faded.
function canFade() { return !!prefs.smoothPause && document.visibilityState === "visible"; }
function rampFade(to, ms, done) {
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    const from = fadeGain, t0 = performance.now();
    const step = () => {
        const t = Math.min(1, (performance.now() - t0) / ms);
        fadeGain = from + (to - from) * t * t * (3 - 2 * t);
        applyVolume();
        if (t < 1) fadeTimer = setTimeout(step, 16);
        else { fadeTimer = null; if (done) done(); }
    };
    step();
}
function isAudiblyPlaying() { return !audioPlayer.paused && isPlaybackIntentActive; }

function safePlay(opts = {}) {
    if (window.SpootifyDJ) window.SpootifyDJ.stopAll(); // one thing at a time: the decks go quiet
    isPlaybackIntentActive = true;
    nativeDismissed = false;
    ensureAudioGraph();
    const smooth = opts.fade !== false && canFade();
    const resuming = audioPlayer.paused && audioPlayer.currentTime > 0.05;
    if (smooth && (resuming || fadeTimer)) {
        if (resuming) { fadeGain = 0; applyVolume(); }
        rampFade(1, 240);
    } else {
        if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
        if (fadeGain !== 1) { fadeGain = 1; applyVolume(); }
    }
    const p = audioPlayer.play();
    if (p && typeof p.catch === "function") {
        p.catch(() => { updatePlayPauseIcon(); stopProgressLoop(); updateMediaSessionMetadata(); });
    }
    startProgressLoop();
    updateMediaSessionMetadata();
    updatePlayPauseIcon();
}

function pausePlayback() {
    if (crossfadeTriggered) cancelCrossfade(); // pausing mid-fade: drop the pre-roll, the fade restarts on resume
    isPlaybackIntentActive = false;
    const finish = () => {
        if (!isPlaybackIntentActive) audioPlayer.pause(); // a play() during the fade-out wins
        fadeGain = 1; applyVolume();
        stopProgressLoop();
        saveNowPlaying(true);
        updatePlayPauseIcon(); updateMediaSessionMetadata();
    };
    if (canFade() && !audioPlayer.paused) rampFade(0, 180, finish);
    else { if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; } finish(); }
    updatePlayPauseIcon();
}

function togglePlayPause() {
    if (!currentTrack) { startSomething(); return; }
    if (isAudiblyPlaying()) pausePlayback(); else safePlay();
    updatePlayPauseIcon(); updateMediaSessionMetadata();
}
// Play with nothing loaded: the queue first, otherwise the open playlist.
async function startSomething() {
    if (queue.length) { await playNext(); return; }
    const songs = getCurrentPlaylistSongs();
    if (songs.length) await playSong(pickStartSong(songs), currentPlaylist);
}

// ── NATIVE BACKGROUND AUDIO (Android) ──
// The Android WebView has no foreground service and no wake lock of its own, so
// with the screen off the OS freezes the process the moment the current track's
// audio buffer drains — the "ended" → next-track hand-off never runs. The
// BackgroundAudio Capacitor plugin (android/.../PlaybackService.java) runs a
// mediaPlayback foreground service that holds a partial wake lock while playing
// and owns a MediaSession for lock-screen / headset / notification controls.
// It also forwards the hardware Back button so it can close the player and
// overlays first, and backgrounds the app (music keeps going) instead of quitting.
// Everything here is a no-op outside the Android app (browser, Electron).
const nativeAudio = (() => {
    const cap = window.Capacitor;
    const available = !!(cap && typeof cap.nativePromise === "function" && typeof cap.getPlatform === "function" && cap.getPlatform() === "android");
    const call = (method, data) => available
        ? cap.nativePromise("BackgroundAudio", method, data || {}).catch((e) => console.warn("BackgroundAudio." + method + " failed", e))
        : Promise.resolve();
    const listen = (event, handler) => { if (available && typeof cap.addListener === "function") cap.addListener("BackgroundAudio", event, handler); };
    return {
        available,
        update: (data) => call("update", data),
        setPosition: (data) => call("setPosition", data),
        stop: () => call("stop"),
        minimize: () => call("minimize"),
        setBackground: (color) => call("setBackground", { color }),
        takeRestartNotice: () => call("takeRestartNotice"),
        onAction: (handler) => listen("mediaAction", handler),
        onBack: (handler) => listen("backButton", handler),
        // Unlike the calls above, errors reach the caller (saving has to report failure).
        raw: (method, data) => (available ? cap.nativePromise("BackgroundAudio", method, data || {}) : Promise.reject(new Error("Not available here")))
    };
})();

let nativeDismissed = false;      // user closed the notification: don't resurrect it until the next play()
let lastNativePositionSync = 0;
const artThumbCache = new Map();

// Album art lives as a blob URL inside the WebView; the notification needs raw
// bytes, so downscale once per track to a small JPEG and cache the base64.
function getArtThumb(track) {
    if (!track?.art || track.art === DEFAULT_ART) return Promise.resolve(null);
    const key = track.artId || track.art;
    if (artThumbCache.has(key)) return artThumbCache.get(key);
    const promise = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                // 384 px: sharp on a lock screen without making the notification's bitmap too big to send.
                const size = 384, canvas = document.createElement("canvas");
                canvas.width = size; canvas.height = size;
                const m = Math.min(img.naturalWidth, img.naturalHeight);
                canvas.getContext("2d").drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, size, size);
                resolve(canvas.toDataURL("image/jpeg", 0.82).split(",")[1] || null);
            } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = track.art;
    });
    artThumbCache.set(key, promise);
    if (artThumbCache.size > 24) artThumbCache.delete(artThumbCache.keys().next().value); // one per song played: keep it from growing all session
    return promise;
}

async function syncNativePlayback() {
    if (!nativeAudio.available) return;
    if (!currentTrack) { nativeAudio.stop(); return; }
    if (nativeDismissed && audioPlayer.paused) return;
    const track = currentTrack;
    const art = await getArtThumb(track);
    if (currentTrack !== track) return; // track changed while the thumbnail was encoding
    lastNativePositionSync = Date.now();
    nativeAudio.update({
        title: track.title || "Unknown", artist: track.artist || "Unknown Artist",
        isPlaying: !audioPlayer.paused, position: audioPlayer.currentTime || 0,
        duration: audioPlayer.duration || track.duration || 0, rate: audioPlayer.playbackRate || 1, art,
        queue: carQueue(),
        // Lock screen: "playing from" line, and the heart / shuffle buttons next to the controls.
        album: sourceLabel(contextSource || currentTrackSource), liked: isLiked(track), shuffle: !!shuffleEnabled
    });
}

// ── ANDROID AUTO ──
// The car browses a snapshot of the library (playlists, Liked Songs, Recently played)
// kept by the native side, so it works even before the app is open; picking something
// there, asking by voice, or tapping the queue lands here. Songs are "song|<source>|<id>",
// "shuffle|<source>" shuffles one.
let libraryReadyResolve;
const libraryReady = new Promise((r) => { libraryReadyResolve = r; });
let lastCarQueue = [], carLibraryTimer = null, lastCarLibrary = "";
// The playing song, then your queue, then what plays next (as the car's queue screen shows it).
function carQueue() {
    if (!currentTrack) return [];
    const upNext = queue.map((item) => ({ song: item.song, source: item.playlistName, fromQueue: true }))
        .concat(getUpNext(25).map((e) => ({ song: e.song, source: contextSource || currentTrackSource, fromQueue: false }))).slice(0, 30);
    lastCarQueue = upNext;
    return [currentTrack].concat(upNext.map((e) => e.song)).map((s) => ({ title: s.title || "Unknown", artist: s.artist || "" }));
}
function scheduleCarLibrary(delay = 4000) {
    if (!nativeAudio.available) return;
    clearTimeout(carLibraryTimer);
    carLibraryTimer = setTimeout(pushCarLibrary, delay);
}
function pushCarLibrary() {
    carLibraryTimer = null;
    if (!libraryLoadedOk) return;
    const row = (s, home) => { const r = [String(s.id), s.title || "Unknown", s.artist || "", Math.round(s.duration || 0)]; if (home !== undefined) r.push(home); return r; };
    const snapshot = {
        v: 1,
        playlists: getDisplayPlaylistNames().map((name) => ({ name, pinned: !!playlists[name].pinned, songs: getPlaylistSongsSorted(name).slice(0, 500).map((s) => row(s)) })),
        liked: getLikedSongs().slice(0, 300).map((s) => row(s, homePlaylistOf(s) || "")),
        recent: Object.entries(listenStats).filter(([, e]) => e.lastPlayed > 0).sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)
            .map(([key]) => findSongByStatsKey(key)).filter(Boolean).slice(0, 40).map(({ song, playlistName }) => row(song, playlistName))
    };
    const json = JSON.stringify(snapshot);
    if (json === lastCarLibrary) return;
    lastCarLibrary = json;
    nativeAudio.raw("setLibrary", { json }).catch((e) => console.warn("Car library not sent", e));
}
async function playFromCar(id) {
    const parts = id.split("|");
    if (parts[0] === "shuffle") {
        const source = parts.slice(1).join("|");
        if (!sourceExists(source)) return;
        if (!shuffleEnabled) { shuffleEnabled = true; customOrder = null; generateShuffleOrder(); setActiveButton(shuffleBtn, true); updateNpControls(); saveNowPlaying(true); }
        playCollection(source);
        return;
    }
    if (parts[0] !== "song" || parts.length < 3) return;
    const songId = Number(parts[parts.length - 1]), source = parts.slice(1, -1).join("|");
    if (isLikedSource(source)) { const s = getLikedSongs().find((x) => x.id === songId); if (s) await playSong(s, LIKED_SOURCE, false, { restart: true }); return; }
    const inPl = playlists[source] && (playlists[source].songs || []).find((x) => x.id === songId);
    if (inPl) { await playSong(inPl, source, false, { restart: true }); return; }
    const found = findSongById(songId); // "recent:", a search hit, or a playlist that was renamed since
    if (found) await playSong(found.song, found.playlistName, false, { restart: true });
}
// "Hey Google, play … on Prism": a playlist by name, else an artist, else the best matching song.
async function playFromVoice(query) {
    const q = normalizeText(query).trim();
    if (!q) { if (currentTrack) safePlay(); else startSomething(); return; }
    const plName = getOrderedPlaylistNames().find((n) => normalizeText(n) === q) || getOrderedPlaylistNames().find((n) => normalizeText(n).includes(q));
    if (plName) { playCollection(plName); return; }
    const { songs, artists } = searchLibrary(q);
    if (artists.length && normalizeText(artists[0].name) === q) { const rows = getArtistSongs(artists[0].name); if (rows.length) { await playSong(pickStartSong(rows.map((r) => r.song)), ARTIST_SOURCE_PREFIX + artists[0].name, false, { restart: true }); return; } }
    if (songs.length) { await playSong(songs[0].song, songs[0].playlistName, false, { restart: true }); return; }
    if (artists.length) { const rows = getArtistSongs(artists[0].name); if (rows.length) await playSong(rows[0].song, ARTIST_SOURCE_PREFIX + artists[0].name, false, { restart: true }); }
}
async function skipToCarQueueItem(n) {
    if (!Number.isFinite(n) || n < 1) return; // 0 is the song that's playing
    const pick = lastCarQueue[n - 1]; if (!pick) return;
    if (pick.fromQueue) {
        const i = queue.findIndex((item) => item.song === pick.song);
        if (i !== -1) { queue.splice(i, 1); saveLibrary(); renderQueue(); }
        await playSong(pick.song, pick.source, true, { restart: true });
    } else await playSong(pick.song, pick.source, false, { restart: true });
}

function syncNativePosition(force = false) {
    if (!nativeAudio.available || !currentTrack || (nativeDismissed && audioPlayer.paused)) return;
    const now = Date.now();
    if (!force && now - lastNativePositionSync < 10000) return;
    lastNativePositionSync = now;
    nativeAudio.setPosition({ isPlaying: !audioPlayer.paused, position: audioPlayer.currentTime || 0, rate: audioPlayer.playbackRate || 1 });
}

nativeAudio.onAction((data) => {
    const action = data?.action;
    // From a car (Android Auto): these can arrive while the app is still starting, so they wait for the library.
    if (action === "playFromMediaId") { libraryReady.then(() => playFromCar(String(data.arg || ""))); return; }
    if (action === "playFromSearch") { libraryReady.then(() => playFromVoice(String(data.arg || ""))); return; }
    if (action === "skipToQueueItem") { libraryReady.then(() => skipToCarQueueItem(Number(data.arg))); return; }
    if (action === "play") { if (currentTrack) safePlay(); else { libraryReady.then(() => { if (!currentTrack) startSomething(); }); return; } }
    else if (action === "pause") pausePlayback();
    else if (action === "stop") { nativeDismissed = true; pausePlayback(); }
    else if (action === "like") { if (currentTrack && isLiked(currentTrack) !== (data.arg === "1")) setLiked(currentTrack, data.arg === "1"); return; }
    else if (action === "shuffle") { if (shuffleEnabled !== (data.arg === "1")) toggleShuffle(); return; }
    else if (action === "next") { playNext(); return; }
    else if (action === "previous") { playPrevious(); return; }
    else if (action === "seek" && audioPlayer.duration && typeof data.position === "number") {
        audioPlayer.currentTime = Math.max(0, Math.min(audioPlayer.duration, data.position));
        lastMediaSessionPositionUpdate = 0; updateProgressUi(); syncNativePosition(true); saveNowPlaying();
        return;
    }
    updatePlayPauseIcon(); updateMediaSessionMetadata();
});

// ── NOW-PLAYING PERSISTENCE ──
// The queue is already saved by saveLibrary(); this remembers the current track,
// position and shuffle/loop mode so a process kill (or reboot) doesn't lose your
// place. Position writes are coalesced; structural changes are written at once.
const NOW_PLAYING_KEY = "spootify-now-playing";
let nowPlayingSaveTimer = null;
function saveNowPlaying(immediate = false) {
    const write = () => {
        nowPlayingSaveTimer = null;
        try {
            if (!currentTrack) { localStorage.setItem(NOW_PLAYING_KEY, JSON.stringify({ trackId: null, shuffleEnabled, loopMode })); return; }
            localStorage.setItem(NOW_PLAYING_KEY, JSON.stringify({
                trackId: currentTrack.id, source: currentTrackSource,
                contextTrackId: contextTrack ? contextTrack.id : null, contextSource,
                position: audioPlayer.currentTime || 0, shuffleEnabled, loopMode
            }));
        } catch {}
    };
    if (immediate) { if (nowPlayingSaveTimer) clearTimeout(nowPlayingSaveTimer); write(); return; }
    if (!nowPlayingSaveTimer) nowPlayingSaveTimer = setTimeout(write, 5000);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveNowPlaying(true); });
window.addEventListener("pagehide", () => saveNowPlaying(true));

async function restoreNowPlaying() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(NOW_PLAYING_KEY) || "null"); } catch {}
    if (!saved) return;
    shuffleEnabled = !!saved.shuffleEnabled;
    loopMode = ["off", "all", "one"].includes(saved.loopMode) ? saved.loopMode : "off";
    setActiveButton(shuffleBtn, shuffleEnabled); updateLoopButton(); updateNpControls();
    const found = findSongById(saved.trackId);
    if (!found) return;
    const song = found.song;
    if (!song.fileSrc && song.mediaId) song.fileSrc = await getBlobUrl(song.mediaId);
    if (!song.fileSrc) return;
    if (!song.art && song.artId) song.art = await getBlobUrl(song.artId);
    if (!song.art) song.art = DEFAULT_ART;
    const ctx = saved.contextTrackId != null ? findSongById(saved.contextTrackId) : null;
    currentTrack = song; currentTrackSource = found.playlistName;
    contextTrack = ctx ? ctx.song : song; contextSource = ctx ? ctx.playlistName : found.playlistName;
    if (shuffleEnabled) generateShuffleOrder();
    const position = Number(saved.position) || 0;
    loadTrackInto(audioPlayer, song);
    if (position > 0) {
        audioPlayer.addEventListener("loadedmetadata", () => {
            if (audioPlayer.duration && position < audioPlayer.duration - 1) audioPlayer.currentTime = position;
            updateProgressUi();
        }, { once: true });
    }
    showTrackInfo(song, found.playlistName);
    updatePlayPauseIcon(); renderQueue();
    if (typeof renderNpQueue === "function") renderNpQueue();
}

// ── BACKGROUND PLAYBACK RECOVERY ──
// Mobile OSes (screen off / app backgrounded) can throttle timers and reject
// play() calls made without a fresh user gesture, so the "ended" handler that
// would normally advance to the next track can silently fail to do so. When
// the app becomes visible/foregrounded again, check whether we missed an
// end-of-track advance or a blocked play() and recover.
function attemptPlaybackRecovery() {
    if (!currentTrack) return;
    if (audioPlayer.ended || (audioPlayer.duration && audioPlayer.currentTime >= audioPlayer.duration - 0.25)) {
        playNext();
    } else if (isPlaybackIntentActive && audioPlayer.paused) {
        safePlay();
    }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") attemptPlaybackRecovery(); });
window.addEventListener("pageshow", attemptPlaybackRecovery);
window.addEventListener("focus", attemptPlaybackRecovery);


// ── LISTENING STATS ──
// Play counts and total listening time per song, keyed by the audio blob
// (mediaId) so a song copied into several playlists is one entry. Time is
// wall-clock while the audio is actually advancing: ticked from "timeupdate"
// (a media event, so it keeps firing with the screen off) rather than a timer
// the OS can throttle. A play is counted once a single listening session of a
// track reaches STATS_PLAY_THRESHOLD seconds; looping a song starts a new
// session. Kept in localStorage because its writes are synchronous — the
// pagehide flush lands even while the process is being torn down.
const STATS_KEY = "spootify-listen-stats";
const STATS_PLAY_THRESHOLD = 10;
// While music plays, the stats, history and clock are written every 20 seconds (they're
// also written straight away on pause, when a play counts and when the app goes to the
// background). They grow with your library, and rewriting them every 5 seconds was steady
// work that made long sessions feel heavier.
const STATS_SAVE_MS = 20000;
const STATS_MAX_TICK = 30; // a bigger gap means the process was frozen, not listening
let listenStats = {};       // key → { plays, seconds, title, artist, artId, firstPlayed, lastPlayed }
let statsSession = null;    // { key, seconds, counted } for the track currently loaded
let statsLastTick = null;   // performance.now() of the last accounted moment; null while not advancing
let statsSaveTimer = null;
let statsSort = "plays";    // plays | time
let statsView = "songs";    // songs | artists
const statsCard = $("stats-card"), statsCardSubtitle = $("stats-card-subtitle"), statsCardArts = $("stats-card-arts");
const statsOverlay = $("stats-overlay"), statsList = $("stats-list"), statsCloseBtn = $("stats-close-btn"), statsClearBtn = $("stats-clear-btn");

function statsKeyFor(song) { return song ? (song.mediaId || "id:" + song.id) : null; }
// Settings → General → Stats: seconds of listening before a play counts, and how early
// pressing Next has to be to count as a skip (0 = before the halfway point).
function listenThreshold() { return clamp(Math.round(Number(prefs.listenAfter) || STATS_PLAY_THRESHOLD), 1, 600); }
function skipThreshold() { return clamp(Math.round(Number(prefs.skipBefore) || 0), 0, 600); }

function loadListenStats() {
    try { const s = JSON.parse(localStorage.getItem(STATS_KEY) || "null"); listenStats = s && typeof s === "object" ? s : {}; }
    catch { listenStats = {}; }
}
function saveListenStats(immediate = false) {
    const write = () => { statsSaveTimer = null; try { localStorage.setItem(STATS_KEY, JSON.stringify(listenStats)); } catch {} };
    if (immediate) { if (statsSaveTimer) clearTimeout(statsSaveTimer); write(); return; }
    if (!statsSaveTimer) statsSaveTimer = setTimeout(write, STATS_SAVE_MS);
}
// Snapshot title/artist/art so a song removed from the library keeps its name in the list.
function statsEntryFor(song) {
    const key = statsKeyFor(song); if (!key) return null;
    const entry = listenStats[key] || (listenStats[key] = { plays: 0, seconds: 0, firstPlayed: Date.now(), lastPlayed: 0 });
    entry.title = song.title; entry.artist = song.artist; entry.artId = song.artId || null;
    return entry;
}
function statsStartSession() {
    statsEndSession();
    if (!currentTrack) return;
    statsSession = { key: statsKeyFor(currentTrack), seconds: 0, counted: false };
    statsEntryFor(currentTrack);
}
function statsTick() {
    if (!statsSession || statsLastTick === null) return;
    const now = performance.now();
    const delta = (now - statsLastTick) / 1000;
    statsLastTick = now;
    if (delta <= 0 || delta > STATS_MAX_TICK) return;
    const entry = listenStats[statsSession.key]; if (!entry) return;
    statsSession.seconds += delta; entry.seconds += delta; entry.lastPlayed = Date.now();
    logListen(statsSession.key, delta, false);
    clockAdd(delta);
    if (!statsSession.counted && statsSession.seconds >= listenThreshold()) {
        statsSession.counted = true; entry.plays += 1;
        logListen(statsSession.key, 0, true);
        saveListenStats(true); saveListenLog(true); refreshStatsUi();
        checkMilestonesSoon();
    } else { saveListenStats(); saveListenLog(); }
}
function statsResume() { statsLastTick = performance.now(); }
function statsPause() { statsTick(); statsLastTick = null; saveListenStats(true); saveListenLog(true); }
function statsEndSession() { statsPause(); statsSession = null; }
onPlayer("play", () => { if (!statsSession || statsSession.key !== statsKeyFor(currentTrack)) statsStartSession(); });
onPlayer("playing", statsResume);
onPlayer("waiting", statsPause);
onPlayer("pause", statsPause);
onPlayer("ended", statsEndSession);   // before the playback "ended" handler: a loop-one restart is a fresh session
onPlayer("emptied", statsEndSession); // src swapped to the next track
onPlayer("timeupdate", () => { if (!audioPlayer.paused) statsTick(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { statsTick(); saveListenStats(true); saveListenLog(true); saveClock(true); } });
window.addEventListener("pagehide", () => { statsTick(); saveListenStats(true); saveListenLog(true); saveClock(true); });

// ── LISTENING CLOCK ──
// Seconds listened per weekday x hour (Monday = row 0), for the "When you listen"
// heatmap on the stats page. The day-by-day history has no times of day, so this
// counts from the day it first ran ("since").
const CLOCK_KEY = "spootify-clock";
let clockData = null, clockSaveTimer = null;
function loadClock() {
    if (clockData) return clockData;
    try { const c = JSON.parse(localStorage.getItem(CLOCK_KEY) || "null"); if (c && Array.isArray(c.g) && c.g.length === 168) clockData = c; } catch {}
    if (!clockData) clockData = { since: Date.now(), g: new Array(168).fill(0) };
    return clockData;
}
function clockAdd(seconds) {
    const c = loadClock(), now = new Date();
    c.g[((now.getDay() + 6) % 7) * 24 + now.getHours()] += seconds;
    saveClock();
}
function saveClock(immediate = false) {
    const write = () => { clockSaveTimer = null; if (!clockData) return; try { localStorage.setItem(CLOCK_KEY, JSON.stringify({ since: clockData.since, g: clockData.g.map((v) => Math.round(v)) })); } catch {} };
    if (immediate) { if (clockSaveTimer) clearTimeout(clockSaveTimer); write(); return; }
    if (!clockSaveTimer) clockSaveTimer = setTimeout(write, STATS_SAVE_MS);
}
function clearClock() { clockData = { since: Date.now(), g: new Array(168).fill(0) }; saveClock(true); }
const CLOCK_DAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
function hourLabel(h) { return h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h}am` : `${h - 12}pm`; }
function renderClock() {
    const grid = $("clock-grid"); if (!grid) return;
    const c = loadClock(), max = Math.max(...c.g), total = c.g.reduce((a, v) => a + v, 0);
    const empty = total < 60;
    $("clock-empty").hidden = !empty;
    grid.hidden = empty; $("clock-hours").hidden = empty;
    const since = new Date(c.since);
    setText($("clock-since"), `since ${since.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`);
    if (empty) { setText($("clock-summary"), ""); return; }
    const dayShort = ["M", "T", "W", "T", "F", "S", "S"];
    let html = "";
    for (let d = 0; d < 7; d++) {
        html += `<span class="clock-day">${dayShort[d]}</span>`;
        for (let h = 0; h < 24; h++) {
            const v = c.g[d * 24 + h], a = v > 0 ? 0.12 + 0.88 * Math.sqrt(v / max) : 0;
            html += `<i${a ? ` style="--a:${a.toFixed(2)}"` : ""} title="${CLOCK_DAYS[d].slice(0, 3)} ${hourLabel(h)} · ${formatListenTime(v)}"></i>`;
        }
    }
    grid.innerHTML = html;
    // The busiest weekday and the busiest hour of the day, plus how much is late at night.
    const days = CLOCK_DAYS.map((_, d) => c.g.slice(d * 24, d * 24 + 24).reduce((a, v) => a + v, 0));
    const hours = Array.from({ length: 24 }, (_, h) => days.reduce((a, _, d) => a + c.g[d * 24 + h], 0));
    const topDay = days.indexOf(Math.max(...days)), topHour = hours.indexOf(Math.max(...hours));
    const night = [22, 23, 0, 1, 2, 3].reduce((a, h) => a + hours[h], 0) / total, morning = [5, 6, 7, 8].reduce((a, h) => a + hours[h], 0) / total;
    const tag = night >= 0.3 ? ` · night owl (${Math.round(night * 100)}% after 10pm)` : morning >= 0.25 ? ` · early bird (${Math.round(morning * 100)}% before 9am)` : "";
    setText($("clock-summary"), `Most often on ${CLOCK_DAYS[topDay]}, around ${hourLabel(topHour)}${tag}`);
}

function formatListenTime(seconds) {
    const s = Math.floor(seconds || 0);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}
function getRankedStats(sort = statsSort) {
    const rows = Object.entries(listenStats).map(([key, e]) => ({ key, ...e })).filter((r) => r.plays > 0);
    rows.sort(sort === "time" ? (a, b) => b.seconds - a.seconds || b.plays - a.plays : (a, b) => b.plays - a.plays || b.seconds - a.seconds);
    return rows;
}
// stats key → the live song (first playlist that has it); rebuilt when the library changes.
let statsIndex = null, statsIndexVersion = -1;
function findSongByStatsKey(key) {
    if (!statsIndex || statsIndexVersion !== libraryVersion) {
        statsIndex = new Map();
        for (const [playlistName, pl] of Object.entries(playlists)) {
            for (const s of pl.songs || []) { const k = statsKeyFor(s); if (!statsIndex.has(k)) statsIndex.set(k, { song: s, playlistName }); }
        }
        statsIndexVersion = libraryVersion;
    }
    return statsIndex.get(key) || null;
}
function statsArtFor(row, found) { return (found && found.song.art) || DEFAULT_ART; }

// ── LISTENING HISTORY ──
// Seconds and counted plays per song per day, for the chart. One localStorage entry
// per month ("spootify-log-2026-09" → { "30": { <song key>: [seconds, plays] } }), so
// only the current month is ever rewritten while music plays; synchronous for the
// same reason as the stats above.
const LOG_PREFIX = "spootify-log-";
const logCache = new Map(); // "YYYY-MM" → month object
const logDirty = new Set();
let logSaveTimer = null;
function ymOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function loadLogMonth(ym) {
    let m = logCache.get(ym);
    if (m) return m;
    try { m = JSON.parse(localStorage.getItem(LOG_PREFIX + ym) || "null"); } catch { m = null; }
    if (!m || typeof m !== "object") m = {};
    logCache.set(ym, m);
    return m;
}
function logListen(key, seconds, countPlay) {
    if (!key) return;
    const now = new Date(), ym = ymOf(now);
    const month = loadLogMonth(ym), day = month[now.getDate()] || (month[now.getDate()] = {});
    const e = day[key] || (day[key] = [0, 0]);
    if (seconds > 0) e[0] += seconds;
    if (countPlay) e[1] += 1;
    logDirty.add(ym);
}
const roundLogNumbers = (k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v);
function saveListenLog(immediate = false) {
    const write = () => {
        logSaveTimer = null;
        for (const ym of logDirty) {
            try { localStorage.setItem(LOG_PREFIX + ym, JSON.stringify(logCache.get(ym) || {}, roundLogNumbers)); }
            catch (e) { console.warn("Listening history not saved", e); }
        }
        logDirty.clear();
    };
    if (immediate) { if (logSaveTimer) clearTimeout(logSaveTimer); write(); return; }
    if (!logSaveTimer) logSaveTimer = setTimeout(write, STATS_SAVE_MS);
}
function logMonthKeys() {
    const set = new Set();
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(LOG_PREFIX)) set.add(k.slice(LOG_PREFIX.length)); } } catch {}
    for (const [ym, m] of logCache) if (Object.keys(m).length) set.add(ym);
    return [...set].filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
}
function clearListenLog() {
    for (const ym of logMonthKeys()) { try { localStorage.removeItem(LOG_PREFIX + ym); } catch {} }
    logCache.clear(); logDirty.clear();
}

// ── LISTENING CHART ──
// Week (7 days), Month (each day), Year (each month) or All time. Press and hold (or
// hover) a bar to see its time above it; a quick tap narrows the list below to it.
const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_LETTERS = "JFMAMJJASOND";
let chartPeriod = "week", chartOffset = 0, chartSelected = -1, chartBars = [], chartTipIndex = -1, chartTipTimer = null;
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
// Seconds listened on one day; with acc, also adds each song's totals into it.
function daySeconds(d, acc) {
    const day = loadLogMonth(ymOf(d))[d.getDate()];
    if (!day) return 0;
    let total = 0;
    for (const k in day) {
        const e = day[k]; total += e[0];
        if (acc) { const a = acc.get(k); if (a) { a.seconds += e[0]; a.plays += e[1]; } else acc.set(k, { seconds: e[0], plays: e[1] }); }
    }
    return total;
}
function rangeSeconds(start, end, acc) { let t = 0; for (let d = new Date(start); d < end; d = addDays(d, 1)) t += daySeconds(d, acc); return t; }
function firstLogDay() {
    const first = logMonthKeys()[0]; if (!first) return null;
    const [y, m] = first.split("-").map(Number);
    const days = Object.keys(loadLogMonth(first)).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    return new Date(y, m - 1, days[0] || 1);
}
function periodRange(kind, offset) {
    const today = startOfDay(new Date());
    if (kind === "week") { const start = addDays(today, -((today.getDay() + 6) % 7) + offset * 7); return { start, end: addDays(start, 7), unit: "day" }; }
    if (kind === "month") { const start = new Date(today.getFullYear(), today.getMonth() + offset, 1); return { start, end: addMonths(start, 1), unit: "day" }; }
    if (kind === "year") { const start = new Date(today.getFullYear() + offset, 0, 1); return { start, end: new Date(start.getFullYear() + 1, 0, 1), unit: "month" }; }
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1), first = firstLogDay();
    let start = first ? new Date(first.getFullYear(), first.getMonth(), 1) : thisMonth;
    const months = (thisMonth.getFullYear() - start.getFullYear()) * 12 + thisMonth.getMonth() - start.getMonth() + 1;
    if (months > 36) return { start: new Date(start.getFullYear(), 0, 1), end: new Date(today.getFullYear() + 1, 0, 1), unit: "year" };
    if (months < 6) start = addMonths(thisMonth, -5);
    return { start, end: addMonths(thisMonth, 1), unit: "month" };
}
function buildChartBars(range) {
    const bars = [], today = startOfDay(new Date());
    if (range.unit === "day") {
        let i = 0;
        for (let d = new Date(range.start); d < range.end; d = addDays(d, 1), i++) {
            bars.push({ start: d, end: addDays(d, 1), seconds: daySeconds(d), future: d > today, today: +d === +today,
                short: chartPeriod === "week" ? DAY_LETTERS[i] : String(d.getDate()),
                long: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) });
        }
    } else if (range.unit === "month") {
        for (let d = new Date(range.start); d < range.end; d = addMonths(d, 1)) {
            const end = addMonths(d, 1), future = d > today;
            bars.push({ start: d, end, seconds: future ? 0 : rangeSeconds(d, end), future,
                today: d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth(),
                short: MONTH_LETTERS[d.getMonth()], long: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) });
        }
    } else {
        for (let y = range.start.getFullYear(); y < range.end.getFullYear(); y++) {
            const s = new Date(y, 0, 1), e = new Date(y + 1, 0, 1), future = s > today;
            bars.push({ start: s, end: e, seconds: future ? 0 : rangeSeconds(s, e > today ? addDays(today, 1) : e), future,
                today: y === today.getFullYear(), short: "'" + String(y).slice(2), long: String(y) });
        }
    }
    return bars;
}
function chartRangeLabel(range) {
    const fmt = (d, o) => d.toLocaleDateString(undefined, o);
    if (chartPeriod === "week") {
        if (chartOffset === 0) return "This week";
        if (chartOffset === -1) return "Last week";
        const last = addDays(range.end, -1), yr = range.start.getFullYear() !== new Date().getFullYear();
        return `${fmt(range.start, { day: "numeric", month: "short" })} – ${fmt(last, yr ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" })}`;
    }
    if (chartPeriod === "month") return chartOffset === 0 ? "This month" : fmt(range.start, { month: "long", year: "numeric" });
    if (chartPeriod === "year") return chartOffset === 0 ? "This year" : String(range.start.getFullYear());
    return "All time";
}
// "+23% vs last week". While a period is still running it's compared with the same
// number of days of the one before, so a Monday doesn't read as a huge drop.
function chartComparison(range) {
    if (chartPeriod === "all") return null;
    const prev = periodRange(chartPeriod, chartOffset - 1);
    let curEnd = range.end, prevEnd = prev.end;
    if (chartOffset === 0) {
        const tomorrow = addDays(startOfDay(new Date()), 1);
        curEnd = tomorrow;
        prevEnd = addDays(prev.start, Math.round((tomorrow - range.start) / 86400000));
        if (prevEnd > prev.end) prevEnd = prev.end;
    }
    const cur = rangeSeconds(range.start, curEnd), before = rangeSeconds(prev.start, prevEnd);
    const word = chartPeriod, label = chartOffset === 0 ? `last ${word}` : `the ${word} before`;
    if (before < 60) return cur >= 60 ? { dir: "up", text: `Up from nothing ${label}` } : null;
    const pct = Math.round(((cur - before) / before) * 100);
    return { dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat", text: `${pct > 0 ? "+" : ""}${pct}% vs ${label}` };
}
// Days in a row with at least a counted play's worth of listening, ending today
// (or yesterday, so the streak doesn't look broken before you've pressed play).
function listeningStreak() {
    let d = startOfDay(new Date()), streak = 0;
    if (daySeconds(d) < STATS_PLAY_THRESHOLD) d = addDays(d, -1);
    while (streak < 3660 && daySeconds(d) >= STATS_PLAY_THRESHOLD) { streak++; d = addDays(d, -1); }
    return streak;
}
function renderChart() {
    const barsEl = $("chart-bars"); if (!barsEl) return;
    const range = periodRange(chartPeriod, chartOffset);
    chartBars = buildChartBars(range);
    if (chartSelected >= chartBars.length) chartSelected = -1;
    const total = chartBars.reduce((a, b) => a + b.seconds, 0);
    const max = Math.max(60, ...chartBars.map((b) => b.seconds));
    barsEl.style.setProperty("--n", chartBars.length);
    barsEl.innerHTML = chartBars.map((b, i) => {
        const h = b.seconds > 0 ? Math.max(3, (b.seconds / max) * 100) : 0;
        const cls = ["chart-bar", b.future ? "future" : "", b.today ? "today" : "", i === chartSelected ? "selected" : "", !h && !b.future ? "empty" : ""].filter(Boolean).join(" ");
        return `<div class="${cls}"><i style="height:${h.toFixed(2)}%"></i></div>`;
    }).join("");
    barsEl.classList.toggle("has-selection", chartSelected >= 0);
    const step = chartBars.length > 16 ? Math.ceil(chartBars.length / (chartPeriod === "month" ? 7 : 9)) : 1;
    const labelsEl = $("chart-labels");
    labelsEl.style.setProperty("--n", chartBars.length);
    labelsEl.innerHTML = chartBars.map((b, i) => `<span${b.today ? ' class="today"' : ""}>${i % step === 0 ? escapeHtml(b.short) : ""}</span>`).join("");
    // A dashed average line across the days (or months) that have already happened.
    const past = chartBars.filter((b) => !b.future);
    const avg = past.length ? past.reduce((a, b) => a + b.seconds, 0) / past.length : 0;
    const avgEl = $("chart-avg");
    avgEl.hidden = avg < 30 || chartBars.length < 3;
    if (!avgEl.hidden) { avgEl.style.bottom = ((avg / max) * 100).toFixed(2) + "%"; avgEl.firstElementChild.textContent = "avg " + formatListenTime(avg); }
    setText($("chart-total"), formatListenTime(total));
    setText($("chart-range"), chartRangeLabel(range));
    const cmp = chartComparison(range), cmpEl = $("chart-compare");
    cmpEl.hidden = !cmp;
    if (cmp) { cmpEl.className = "chart-compare " + cmp.dir; cmpEl.textContent = cmp.text; }
    const streak = listeningStreak(), streakEl = $("chart-streak");
    streakEl.hidden = streak < 1;
    if (streak) streakEl.innerHTML = `${ICONS.flame}<span>${streak}-day streak</span>`;
    const first = firstLogDay(), all = chartPeriod === "all";
    const prevBtn = $("chart-prev"), nextBtn = $("chart-next");
    prevBtn.hidden = nextBtn.hidden = all;
    prevBtn.disabled = !first || range.start <= first;
    nextBtn.disabled = chartOffset >= 0;
    document.querySelectorAll("#chart-periods button").forEach((b) => b.classList.toggle("active", b.dataset.value === chartPeriod));
    // The day-by-day log is newer than the all-time totals for anyone who listened before it existed.
    const note = $("chart-note");
    const oldest = Object.values(listenStats).reduce((m, e) => Math.min(m, e.firstPlayed || Infinity), Infinity);
    note.hidden = !all || !(oldest < (first ? +first : Date.now()) - 86400000);
    if (!note.hidden) note.textContent = `Day-by-day history started ${(first || new Date()).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}. The totals below include everything before that.`;
}
function showChartTip(i) {
    const tip = $("chart-tip"), barsEl = $("chart-bars"), area = $("chart-area"), b = chartBars[i];
    if (!tip || !b || b.future) { hideChartTip(); return; }
    clearTimeout(chartTipTimer);
    tip.innerHTML = `<strong>${formatListenTime(b.seconds)}</strong><span>${escapeHtml(b.long)}</span>`;
    const barEl = barsEl.children[i]; if (!barEl) return;
    barsEl.querySelectorAll(".chart-bar.hover").forEach((el) => el.classList.remove("hover"));
    barEl.classList.add("hover");
    tip.classList.add("show");
    const ar = area.getBoundingClientRect(), br = barEl.getBoundingClientRect(), top = barEl.firstElementChild.getBoundingClientRect().top;
    tip.style.left = clamp(br.left + br.width / 2 - ar.left, tip.offsetWidth / 2, ar.width - tip.offsetWidth / 2) + "px";
    tip.style.top = Math.max(-6, top - ar.top - tip.offsetHeight - 8) + "px";
    if (i !== chartTipIndex) { chartTipIndex = i; haptic(5); }
}
function hideChartTip(delay = 0) {
    clearTimeout(chartTipTimer);
    const hide = () => { $("chart-tip")?.classList.remove("show"); $("chart-bars")?.querySelectorAll(".chart-bar.hover").forEach((el) => el.classList.remove("hover")); chartTipIndex = -1; };
    if (delay) chartTipTimer = setTimeout(hide, delay); else hide();
}
function selectChartBar(i) {
    chartSelected = i;
    renderStatsPage();
}
(() => {
    const area = $("chart-area"); if (!area) return;
    let pressing = false, pressT = 0, pressX = 0, pressId = null;
    const indexAt = (x) => {
        const r = $("chart-bars").getBoundingClientRect(), n = chartBars.length;
        return !n || r.width <= 0 ? -1 : clamp(Math.floor(((x - r.left) / r.width) * n), 0, n - 1);
    };
    area.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        pressing = true; pressT = performance.now(); pressX = e.clientX; pressId = e.pointerId;
        try { area.setPointerCapture(e.pointerId); } catch {}
        showChartTip(indexAt(e.clientX));
    });
    area.addEventListener("pointermove", (e) => {
        if (pressing ? e.pointerId === pressId : e.pointerType === "mouse") showChartTip(indexAt(e.clientX));
    });
    const end = (e, cancelled) => {
        if (!pressing || e.pointerId !== pressId) return;
        pressing = false;
        const quick = performance.now() - pressT < 300 && Math.abs(e.clientX - pressX) < 10;
        if (quick && !cancelled) { const i = indexAt(e.clientX); if (chartBars[i] && !chartBars[i].future) { selectChartBar(chartSelected === i ? -1 : i); if (chartSelected >= 0) showChartTip(i); } }
        if (e.pointerType !== "mouse") hideChartTip(quick ? 1500 : 0);
    };
    area.addEventListener("pointerup", (e) => end(e, false));
    area.addEventListener("pointercancel", (e) => end(e, true));
    area.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !pressing) hideChartTip(); });
})();
document.querySelectorAll("#chart-periods button").forEach((btn) => btn.addEventListener("click", () => {
    chartPeriod = btn.dataset.value || "week"; chartOffset = 0; chartSelected = -1; hideChartTip(); renderStatsPage();
}));
if ($("chart-prev")) $("chart-prev").addEventListener("click", () => { chartOffset--; chartSelected = -1; hideChartTip(); renderStatsPage(); });
if ($("chart-next")) $("chart-next").addEventListener("click", () => { if (chartOffset < 0) { chartOffset++; chartSelected = -1; hideChartTip(); renderStatsPage(); } });

// A tiny last-7-days chart on the Home card.
function renderMiniChart() {
    const el = $("stats-card-chart"); if (!el || !statsCard) return;
    const today = startOfDay(new Date()), days = [];
    for (let i = 6; i >= 0; i--) days.push(daySeconds(addDays(today, -i)));
    const max = Math.max(...days);
    el.hidden = appearance.miniChart === false || max < 1;
    statsCard.classList.toggle("with-chart", !el.hidden);
    if (el.hidden) return;
    el.innerHTML = days.map((s, i) => `<i class="${i === 6 ? "today" : ""}" style="height:${Math.max(10, Math.round((s / max) * 100))}%"></i>`).join("");
}
function renderStatsCard() {
    if (!statsCard) return;
    statsCard.hidden = !appearance.showStats || !!homeQuery;
    renderMiniChart();
    const ranked = getRankedStats("plays");
    if (!ranked.length) { statsCardSubtitle.textContent = "Play something to start tracking"; statsCardArts.innerHTML = ""; return; }
    const totalPlays = ranked.reduce((a, r) => a + r.plays, 0);
    const totalSeconds = Object.values(listenStats).reduce((a, e) => a + (e.seconds || 0), 0);
    statsCardSubtitle.textContent = `${totalPlays} ${totalPlays === 1 ? "play" : "plays"} · ${formatListenTime(totalSeconds)} · #1 ${ranked[0].title}`;
    statsCardArts.innerHTML = ranked.slice(0, 3).map((r) => `<img src="${escapeHtml(statsArtFor(r, findSongByStatsKey(r.key)))}" alt="">`).join("");
}

// ── STATS PAGE (chart + ranked songs / artists) ──
function statsRowsForView() {
    const bar = chartSelected >= 0 ? chartBars[chartSelected] : null;
    if (chartPeriod === "all" && !bar) {
        // All-time totals are complete (they predate the day-by-day history).
        return Object.entries(listenStats).map(([key, e]) => ({ key, plays: e.plays || 0, seconds: e.seconds || 0 }));
    }
    const range = bar || periodRange(chartPeriod, chartOffset), acc = new Map();
    rangeSeconds(range.start, range.end, acc);
    return [...acc].map(([key, v]) => ({ key, plays: v.plays, seconds: v.seconds }));
}
function renderStatsPage() {
    if (!statsList) return;
    renderChart();
    const all = statsRowsForView();
    const rows = all.filter((r) => r.plays > 0 || r.seconds >= STATS_PLAY_THRESHOLD);
    const bar = chartSelected >= 0 ? chartBars[chartSelected] : null;
    setText($("stats-total-plays"), String(all.reduce((a, r) => a + r.plays, 0)));
    setText($("stats-total-time"), formatListenTime(all.reduce((a, r) => a + r.seconds, 0)));
    document.querySelectorAll("#stats-overlay .stats-sort-btn").forEach((b) => b.classList.toggle("active", b.dataset.sort === statsSort));
    document.querySelectorAll("#stats-view button").forEach((b) => b.classList.toggle("active", b.dataset.value === statsView));
    const filter = $("stats-filter");
    if (filter) { filter.hidden = !bar; if (bar) setText($("stats-filter-label"), bar.long); }
    const when = bar ? `on ${bar.long}` : chartRangeLabel(periodRange(chartPeriod, chartOffset)).toLowerCase();
    const empty = `<div class="stats-empty">Nothing ${chartPeriod === "all" && !bar ? "yet" : when} — songs show up here after you've listened for ${listenThreshold()} seconds.</div>`;
    statsList.innerHTML = "";
    const skipped = statsView === "skipped";
    document.querySelectorAll("#stats-overlay .stats-sort-btn").forEach((b) => { b.hidden = skipped; });
    renderMilestones(); renderClock();
    if (skipped) renderStatsSkippedRows();
    else if (statsView === "artists") renderStatsArtistRows(rows, empty); else renderStatsSongRows(rows, empty);
}
// ── MOST SKIPPED ──
// All-time, from the skip counts noteSkip() records. Each row has a menu so a song you
// keep skipping can be removed or moved to another playlist.
function renderStatsSkippedRows() {
    const rows = Object.entries(listenStats).filter(([, e]) => (e.skips || 0) > 0)
        .map(([key, e]) => ({ key, skips: e.skips, plays: e.plays || 0, last: e.lastSkipped || 0 }))
        .sort((a, b) => b.skips - a.skips || a.plays - b.plays || b.last - a.last);
    setText($("stats-count-label"), "Skipped"); setText($("stats-total-songs"), String(rows.length));
    const note = '<div class="stats-note">All time · counted when you press Next before a song is halfway through.</div>';
    if (!rows.length) { statsList.innerHTML = note + '<div class="stats-empty">No skips yet — songs you skip early show up here.</div>'; return; }
    const activeKey = statsKeyFor(currentTrack), frag = document.createDocumentFragment();
    const head = document.createElement("div"); head.innerHTML = note; frag.appendChild(head.firstElementChild);
    rows.slice(0, 200).forEach((r, i) => {
        const found = findSongByStatsKey(r.key), snap = listenStats[r.key] || {};
        const title = found ? found.song.title : snap.title, artist = found ? found.song.artist : snap.artist;
        const row = document.createElement("div");
        row.className = `stats-row skip-row${r.key === activeKey ? " playing" : ""}${found ? "" : " removed"}`;
        row.dataset.key = r.key;
        row.innerHTML = `<div class="stats-rank">${i + 1}</div><img src="${escapeHtml(statsArtFor(r, found))}" alt="" loading="lazy">
            <div class="stats-row-info"><strong>${escapeHtml(title || "Unknown")}</strong><span>${escapeHtml(artist || "Unknown Artist")}${found ? " · " + escapeHtml(found.playlistName) : " · removed"}</span></div>
            <div class="stats-row-nums"><strong>${r.skips} ${r.skips === 1 ? "skip" : "skips"}</strong><span>${r.plays} ${r.plays === 1 ? "play" : "plays"}</span></div>
            ${found ? `<button type="button" class="dots-trigger-btn" aria-label="More options">${ICONS.dots}</button>` : ""}`;
        if (found) {
            row.addEventListener("click", (e) => {
                if (e.target.closest(".dots-trigger-btn")) { e.stopPropagation(); openSongMenu(found.song, found.playlistName, e.clientX, e.clientY); return; }
                playSong(found.song, found.playlistName);
            });
            row.addEventListener("contextmenu", (e) => { e.preventDefault(); openSongMenu(found.song, found.playlistName, e.clientX, e.clientY); });
        } else {
            row.title = "Rename (or merge into another song)";
            row.addEventListener("click", () => renameRemovedStats(r.key));
        }
        frag.appendChild(row);
    });
    statsList.appendChild(frag);
}
function renderStatsSongRows(rows, empty) {
    setText($("stats-count-label"), "Songs"); setText($("stats-total-songs"), String(rows.length));
    if (!rows.length) { statsList.innerHTML = empty; return; }
    rows.sort(statsSort === "time" ? (a, b) => b.seconds - a.seconds || b.plays - a.plays : (a, b) => b.plays - a.plays || b.seconds - a.seconds);
    const activeKey = statsKeyFor(currentTrack), frag = document.createDocumentFragment();
    rows.slice(0, 300).forEach((r, i) => {
        const found = findSongByStatsKey(r.key), snap = listenStats[r.key] || {};
        const title = found ? found.song.title : snap.title, artist = found ? found.song.artist : snap.artist;
        const row = document.createElement("div");
        row.className = `stats-row${r.key === activeKey ? " playing" : ""}${found ? "" : " removed"}`;
        row.dataset.key = r.key;
        row.innerHTML = `<div class="stats-rank">${i + 1}</div><img src="${escapeHtml(statsArtFor(r, found))}" alt="" loading="lazy">
            <div class="stats-row-info"><strong>${escapeHtml(title || "Unknown")}</strong><span>${escapeHtml(artist || "Unknown Artist")}${found ? "" : " · removed · tap to rename"}</span></div>
            <div class="stats-row-nums"><strong>${r.plays} ${r.plays === 1 ? "play" : "plays"}</strong><span>${formatListenTime(r.seconds)}</span></div>`;
        if (found) {
            row.addEventListener("click", () => playSong(found.song, found.playlistName));
            row.addEventListener("contextmenu", (e) => { e.preventDefault(); openSongMenu(found.song, found.playlistName, e.clientX, e.clientY); });
        } else if (listenStats[r.key]) {
            row.title = "Rename (or merge into another song)";
            row.addEventListener("click", () => renameRemovedStats(r.key));
        }
        frag.appendChild(row);
    });
    statsList.appendChild(frag);
}
function renderStatsArtistRows(rows, empty) {
    const byArtist = new Map();
    for (const r of rows) {
        const found = findSongByStatsKey(r.key), snap = listenStats[r.key] || {};
        const name = (found ? found.song.artist : snap.artist) || "Unknown Artist", k = artistKey(name);
        let a = byArtist.get(k);
        if (!a) byArtist.set(k, a = { name, plays: 0, seconds: 0, songs: 0, art: null, best: -1 });
        a.plays += r.plays; a.seconds += r.seconds; a.songs++;
        const art = found && found.song.art;
        if (art && art !== DEFAULT_ART && r.seconds > a.best) { a.art = art; a.best = r.seconds; }
    }
    const list = [...byArtist.values()];
    setText($("stats-count-label"), "Artists"); setText($("stats-total-songs"), String(list.length));
    if (!list.length) { statsList.innerHTML = empty; return; }
    list.sort(statsSort === "time" ? (a, b) => b.seconds - a.seconds || b.plays - a.plays : (a, b) => b.plays - a.plays || b.seconds - a.seconds);
    const frag = document.createDocumentFragment();
    list.slice(0, 200).forEach((a, i) => {
        const row = document.createElement("div");
        row.className = "stats-row artist-row";
        row.innerHTML = `<div class="stats-rank">${i + 1}</div><img src="${escapeHtml(a.art || DEFAULT_ART)}" alt="" loading="lazy">
            <div class="stats-row-info"><strong>${escapeHtml(a.name)}</strong><span>${a.songs} ${a.songs === 1 ? "song" : "songs"}</span></div>
            <div class="stats-row-nums"><strong>${a.plays} ${a.plays === 1 ? "play" : "plays"}</strong><span>${formatListenTime(a.seconds)}</span></div>`;
        row.addEventListener("click", () => openArtistPage(a.name));
        frag.appendChild(row);
    });
    statsList.appendChild(frag);
}
function refreshStatsUi() {
    renderStatsCard();
    if (statsOverlay && statsOverlay.style.display !== "none") renderStatsPage();
    if (artistCurrent !== null) renderArtistPage();
    scheduleShelves();
}
function openStats() {
    if (!statsOverlay) return;
    chartSelected = -1; hideChartTip();
    renderStatsPage();
    statsOverlay.style.display = "flex";
    const panel = statsOverlay.querySelector(".stats-panel"); if (panel) panel.scrollTop = 0;
}
function closeStats() { if (statsOverlay) statsOverlay.style.display = "none"; hideChartTip(); }
if (statsCard) statsCard.addEventListener("click", openStats);
if (statsCloseBtn) statsCloseBtn.addEventListener("click", closeStats);
if (statsOverlay) statsOverlay.addEventListener("click", (e) => { if (e.target === statsOverlay) closeStats(); });
document.querySelectorAll("#stats-overlay .stats-sort-btn").forEach((btn) => btn.addEventListener("click", () => { statsSort = btn.dataset.sort === "time" ? "time" : "plays"; renderStatsPage(); }));
document.querySelectorAll("#stats-view button").forEach((btn) => btn.addEventListener("click", () => { statsView = ["artists", "skipped"].includes(btn.dataset.value) ? btn.dataset.value : "songs"; renderStatsPage(); }));
if ($("stats-filter-clear")) $("stats-filter-clear").addEventListener("click", () => selectChartBar(-1));
// ── MILESTONES ──
// Tiers per category, worked out from the stats and history already recorded. The
// highest tier reached in each is remembered so reaching a new one can pop a toast
// (Settings → General); the first time this runs it records what's already earned
// quietly instead of announcing a pile of old achievements.
const MILESTONES_KEY = "spootify-milestones";
const MILESTONE_ICONS = {
    hours: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.4 3.6 2.1-1 1.7L11 13.5V6h2v6.4Z"/></svg>',
    plays: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM10 16.5v-9l6 4.5-6 4.5Z"/></svg>',
    songs: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13a3 3 0 1 1-2-2.8V7.4l-8 1.4v9.2A3 3 0 1 1 9 18Z"/></svg>',
    artists: ICONS.user,
    streak: ICONS.flame,
    liked: ICONS.heartFill,
    playlists: '<svg viewBox="0 0 24 24"><path d="M3 5h12v2H3V5Zm0 4h12v2H3V9Zm0 4h8v2H3v-2Zm14-8h4v2h-2v9a3 3 0 1 1-2-2.8V5Z"/></svg>',
    library: '<svg viewBox="0 0 24 24"><path d="M4 4h3v16H4V4Zm5 0h3v16H9V4Zm4.6 1.2 2.9-.8 4.2 15.4-2.9.8-4.2-15.4Z"/></svg>',
    rated: ICONS.star,
    bigday: '<svg viewBox="0 0 24 24"><path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-1-6h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1Zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1ZM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4ZM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4Z"/></svg>'
};
const MILESTONES = [
    { id: "hours", label: "Listening time", tiers: [1, 5, 10, 24, 50, 75, 100, 150, 250, 365, 500, 750, 1000, 1500, 2000, 3000, 5000], fmt: (n) => `${n.toLocaleString()} ${n === 1 ? "hour" : "hours"}` },
    { id: "plays", label: "Plays", tiers: [10, 50, 100, 250, 500, 1000, 1500, 2500, 5000, 7500, 10000, 15000, 25000, 50000, 100000], fmt: (n) => `${n.toLocaleString()} plays` },
    { id: "songs", label: "Different songs", tiers: [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2500, 5000], fmt: (n) => `${n.toLocaleString()} songs` },
    { id: "artists", label: "Artists", tiers: [5, 10, 25, 50, 75, 100, 150, 250, 400, 600, 1000], fmt: (n) => `${n.toLocaleString()} artists` },
    { id: "streak", label: "Best streak", tiers: [3, 5, 7, 10, 14, 21, 30, 50, 75, 100, 150, 200, 365, 500, 730], fmt: (n) => `${n}-day streak` },
    { id: "liked", label: "Liked songs", tiers: [1, 5, 10, 25, 50, 100, 150, 250, 400, 600, 1000], fmt: (n) => (n === 1 ? "First like" : `${n.toLocaleString()} liked`) },
    { id: "bigday", label: "Biggest day", tiers: [1, 2, 3, 4, 5, 6, 8, 10, 12, 16], fmt: (n) => `${n} ${n === 1 ? "hour" : "hours"} in a day` },
    { id: "playlists", label: "Playlists made", tiers: [1, 3, 5, 10, 15, 25, 40, 60, 100], fmt: (n) => (n === 1 ? "First playlist" : `${n} playlists`) },
    { id: "library", label: "Library size", tiers: [10, 25, 50, 100, 250, 500, 750, 1000, 2000, 3500, 5000, 10000], fmt: (n) => `${n.toLocaleString()} songs saved` },
    { id: "rated", label: "Songs rated", tiers: [1, 5, 10, 25, 50, 100, 250, 500, 1000], fmt: (n) => (n === 1 ? "First rating" : `${n.toLocaleString()} rated`) }
];
// Bumped whenever tiers are added, so already-earned new tiers are recorded quietly
// instead of popping a pile of "milestone unlocked" toasts.
const MILESTONES_VERSION = 2;
// Most listening on a single day, in hours, from the day-by-day history.
function biggestDay() {
    const first = firstLogDay(); if (!first) return 0;
    const last = addDays(startOfDay(new Date()), 1);
    let best = 0;
    for (let d = startOfDay(first); d < last; d = addDays(d, 1)) best = Math.max(best, daySeconds(d));
    return best / 3600;
}
function librarySongCount() {
    const seen = new Set();
    for (const pl of Object.values(playlists)) for (const s of pl.songs || []) seen.add(statsKeyFor(s));
    return seen.size;
}
// Longest run of days with at least a play's worth of listening, from the day-by-day history.
function bestStreak(start, end) {
    const first = start || firstLogDay(); if (!first) return 0;
    const last = end || addDays(startOfDay(new Date()), 1);
    let best = 0, run = 0;
    for (let d = startOfDay(first); d < last; d = addDays(d, 1)) {
        if (daySeconds(d) >= STATS_PLAY_THRESHOLD) { run++; if (run > best) best = run; } else run = 0;
    }
    return best;
}
function milestoneValues() {
    let seconds = 0, plays = 0, songs = 0; const artists = new Set();
    for (const e of Object.values(listenStats)) {
        seconds += e.seconds || 0; plays += e.plays || 0;
        if (e.plays > 0) { songs++; artists.add(artistKey(e.artist)); }
    }
    return { hours: seconds / 3600, plays, songs, artists: artists.size, streak: bestStreak(), liked: likedSongs.size,
        bigday: biggestDay(), playlists: Object.keys(playlists).length, library: librarySongCount(), rated: Object.keys(ratings).length };
}
function milestoneLevels(values = milestoneValues()) {
    const out = {};
    for (const m of MILESTONES) out[m.id] = m.tiers.filter((t) => values[m.id] >= t).length;
    return out;
}
function seedMilestones() { try { localStorage.setItem(MILESTONES_KEY, JSON.stringify({ ...milestoneLevels(), _v: MILESTONES_VERSION })); } catch {} }
let milestoneCheckTimer = null;
function checkMilestonesSoon() {
    clearTimeout(milestoneCheckTimer);
    milestoneCheckTimer = setTimeout(checkMilestones, 1200);
}
function checkMilestones() {
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem(MILESTONES_KEY) || "null"); } catch {}
    if (!seen || typeof seen !== "object" || seen._v !== MILESTONES_VERSION) { seedMilestones(); return; }
    const levels = milestoneLevels(), fresh = [];
    for (const m of MILESTONES) if ((levels[m.id] || 0) > (seen[m.id] || 0)) fresh.push(m.fmt(m.tiers[levels[m.id] - 1]));
    if (!fresh.length) {
        // Levels can drop (stats cleared); follow them down so they can be earned again.
        if (MILESTONES.some((m) => (levels[m.id] || 0) !== (seen[m.id] || 0))) seedMilestones();
        return;
    }
    if (toastHasAction()) { checkMilestonesSoon(); return; } // don't push an Undo off screen
    try { localStorage.setItem(MILESTONES_KEY, JSON.stringify(levels)); } catch {}
    if (isShown(statsOverlay)) renderMilestones();
    if (!prefs.milestoneToasts) return;
    haptic(25);
    showToast(fresh.length === 1 ? `Milestone unlocked · ${fresh[0]}` : `${fresh.length} milestones unlocked · ${fresh[fresh.length - 1]}`, { duration: 4000 });
}
function renderMilestones() {
    const row = $("milestone-row"); if (!row) return;
    const values = milestoneValues(), levels = milestoneLevels(values);
    let earned = 0, total = 0;
    row.innerHTML = MILESTONES.map((m) => {
        const lvl = levels[m.id], v = values[m.id], next = m.tiers[lvl], prev = lvl ? m.tiers[lvl - 1] : 0;
        earned += lvl; total += m.tiers.length;
        const pct = next ? clamp((v - prev) / (next - prev), 0, 1) * 100 : 100;
        const tier = !lvl ? 0 : lvl === m.tiers.length ? 5 : Math.min(4, Math.ceil((lvl / m.tiers.length) * 4));
        const nextText = next ? `Next: ${m.fmt(next)}` : "All done!";
        return `<div class="milestone tier-${tier}" title="${escapeHtml(m.label)} · ${escapeHtml(nextText)}">
            <div class="milestone-medal">${MILESTONE_ICONS[m.id]}<em class="milestone-lvl">${lvl}/${m.tiers.length}</em></div>
            <strong>${lvl ? escapeHtml(m.fmt(prev)) : "Locked"}</strong><span>${escapeHtml(m.label)}</span>
            <div class="milestone-bar"><i style="width:${pct.toFixed(1)}%"></i></div><small>${escapeHtml(nextText)}</small></div>`;
    }).join("");
    setText($("milestones-count"), `${earned} of ${total}`);
}

// ── SPOOTIFY WRAPPED ──
// A story-style recap of a year, a month or all time: tap the right side (or wait) for
// the next card, the left side to go back, hold to pause. The last card sums it all
// up and can be saved as an image.
const wrappedOverlay = $("wrapped-overlay");
const WRAPPED_CARD_MS = 6500;
let wrapped = null; // { periods, period, data, cards, index, elapsed, last, holding, raf }
function wrappedPeriods() {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), months = new Set(logMonthKeys());
    const monthName = (d) => d.toLocaleDateString(undefined, { month: "long" });
    const list = [{ id: "year", label: String(y), title: String(y), start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) }];
    if ([...months].some((k) => k.startsWith(y - 1 + "-"))) list.push({ id: "lastyear", label: String(y - 1), title: String(y - 1), start: new Date(y - 1, 0, 1), end: new Date(y, 0, 1) });
    list.push({ id: "month", label: monthName(now), title: `${monthName(now)} ${y}`, start: new Date(y, m, 1), end: new Date(y, m + 1, 1) });
    const lm = new Date(y, m - 1, 1);
    if (months.has(ymOf(lm))) list.push({ id: "lastmonth", label: monthName(lm), title: `${monthName(lm)} ${lm.getFullYear()}`, start: lm, end: new Date(y, m, 1) });
    list.push({ id: "all", label: "All time", title: "All-time", start: null, end: null });
    return list;
}
function wrappedSongInfo(key) {
    const found = findSongByStatsKey(key), snap = listenStats[key] || {};
    return { title: (found ? found.song.title : snap.title) || "Unknown", artist: (found ? found.song.artist : snap.artist) || "Unknown Artist", art: (found && found.song.art) || DEFAULT_ART, found };
}
function wrappedData(p) {
    const tomorrow = addDays(startOfDay(new Date()), 1);
    let rows;
    if (p.id === "all") rows = Object.entries(listenStats).map(([key, e]) => ({ key, seconds: e.seconds || 0, plays: e.plays || 0 }));
    else { const acc = new Map(); rangeSeconds(p.start, p.end < tomorrow ? p.end : tomorrow, acc); rows = [...acc].map(([key, v]) => ({ key, seconds: v.seconds, plays: v.plays })); }
    rows = rows.filter((r) => r.plays > 0 || r.seconds >= STATS_PLAY_THRESHOLD);
    const seconds = rows.reduce((t, r) => t + r.seconds, 0), plays = rows.reduce((t, r) => t + r.plays, 0);
    const songs = rows.map((r) => ({ ...r, ...wrappedSongInfo(r.key) })).sort((a, b) => b.plays - a.plays || b.seconds - a.seconds);
    const byArtist = new Map();
    for (const s of songs) {
        const k = artistKey(s.artist);
        let a = byArtist.get(k); if (!a) byArtist.set(k, a = { name: s.artist, seconds: 0, plays: 0, songs: 0, art: null, best: -1 });
        a.seconds += s.seconds; a.plays += s.plays; a.songs++;
        if (s.art !== DEFAULT_ART && s.seconds > a.best) { a.art = s.art; a.best = s.seconds; }
    }
    const artists = [...byArtist.values()].sort((a, b) => b.seconds - a.seconds || b.plays - a.plays);
    const from = p.start || firstLogDay(), to = p.end && p.end < tomorrow ? p.end : tomorrow;
    let daysListened = 0, totalDays = 0, topDay = null;
    if (from) for (let d = startOfDay(from); d < to; d = addDays(d, 1)) {
        totalDays++;
        const sec = daySeconds(d);
        if (sec >= STATS_PLAY_THRESHOLD) daysListened++;
        if (!topDay || sec > topDay.seconds) topDay = { date: d, seconds: sec };
    }
    const inRange = (t) => !p.start || (t >= +p.start && t < +p.end);
    const added = new Set();
    for (const pl of Object.values(playlists)) for (const s of pl.songs || []) if (inRange(s.timestamp || 0)) added.add(statsKeyFor(s));
    let liked = 0; for (const t of likedSongs.values()) if (inRange(t)) liked++;
    return { seconds, plays, songs, artists, daysListened, totalDays, topDay: topDay && topDay.seconds > 0 ? topDay : null,
        streak: from ? bestStreak(from, to) : 0, added: added.size, liked };
}
function wrappedCards(p, d) {
    const t = p.title, mins = Math.round(d.seconds / 60), cards = [];
    if (!d.songs.length) return [{ cls: "w-empty", html: `<div class="w-kicker">${escapeHtml(t)} Wrapped</div><h2 class="w-title">Nothing to wrap yet</h2><p class="w-fact">Listen to some music and come back — every song you play for 10 seconds counts.</p>` }];
    const hours = d.seconds / 3600;
    const fact = hours >= 48 ? `That's ${(hours / 24).toFixed(1)} whole days of music.` : hours >= 2 ? `That's ${Math.round(hours)} hours of music.` : "Every minute counts.";
    cards.push({ cls: "w-intro", html: `<div class="w-kicker">Your ${escapeHtml(t)} Wrapped</div><div class="w-sub">You listened for</div><h2 class="w-big">${mins.toLocaleString()}</h2><div class="w-sub">minutes</div><p class="w-fact">${fact}<br>${d.plays.toLocaleString()} plays across ${d.songs.length.toLocaleString()} ${d.songs.length === 1 ? "song" : "songs"}.</p>` });
    const top = d.songs[0];
    cards.push({ cls: "w-top-song", html: `<div class="w-kicker">Your top song</div><img class="w-art" src="${escapeHtml(top.art)}" alt=""><h2 class="w-title">${escapeHtml(top.title)}</h2><div class="w-sub">${escapeHtml(top.artist)}</div><p class="w-fact">${top.plays} ${top.plays === 1 ? "play" : "plays"} · ${formatListenTime(top.seconds)}</p>` });
    if (d.songs.length > 1) cards.push({ cls: "w-list", html: `<div class="w-kicker">Your top songs</div><ol class="w-rank">${d.songs.slice(0, 5).map((s, i) => `<li style="--i:${i}"><b>${i + 1}</b><img src="${escapeHtml(s.art)}" alt=""><div><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.artist)}</span></div><em>${s.plays}</em></li>`).join("")}</ol>` });
    const ta = d.artists[0];
    cards.push({ cls: "w-top-artist", html: `<div class="w-kicker">Your top artist</div><img class="w-art round" src="${escapeHtml(ta.art || DEFAULT_ART)}" alt=""><h2 class="w-title">${escapeHtml(ta.name)}</h2><p class="w-fact">${Math.round(ta.seconds / 60).toLocaleString()} minutes · ${ta.songs} ${ta.songs === 1 ? "song" : "songs"} played</p>` });
    if (d.artists.length > 1) cards.push({ cls: "w-list", html: `<div class="w-kicker">Your top artists</div><ol class="w-rank">${d.artists.slice(0, 5).map((a, i) => `<li style="--i:${i}"><b>${i + 1}</b><img class="round" src="${escapeHtml(a.art || DEFAULT_ART)}" alt=""><div><strong>${escapeHtml(a.name)}</strong><span>${Math.round(a.seconds / 60).toLocaleString()} min</span></div></li>`).join("")}</ol>` });
    const tiles = [];
    if (d.totalDays) tiles.push([`${d.daysListened}`, `day${d.daysListened === 1 ? "" : "s"} with music${p.id === "all" ? "" : ` out of ${d.totalDays}`}`]);
    if (d.streak > 1) tiles.push([`${d.streak}`, "days in a row, your longest streak"]);
    if (d.topDay) tiles.push([formatListenTime(d.topDay.seconds), `on ${d.topDay.date.toLocaleDateString(undefined, { day: "numeric", month: "long" })}, your biggest day`]);
    tiles.push([d.songs.length.toLocaleString(), `different ${d.songs.length === 1 ? "song" : "songs"}`]);
    if (d.added) tiles.push([d.added.toLocaleString(), `new ${d.added === 1 ? "song" : "songs"} added`]);
    if (d.liked) tiles.push([d.liked.toLocaleString(), `${d.liked === 1 ? "song" : "songs"} liked`]);
    cards.push({ cls: "w-habits", html: `<div class="w-kicker">How you listened</div><div class="w-tiles">${tiles.map(([n, l], i) => `<div class="w-tile" style="--i:${i}"><strong>${escapeHtml(n)}</strong><span>${escapeHtml(l)}</span></div>`).join("")}</div>` });
    cards.push({ cls: "w-summary", final: true, html: `<div class="w-kicker">${escapeHtml(t)} on Prism</div>
        <div class="w-sum-head"><img src="${escapeHtml(top.art)}" alt=""><div><strong>${mins.toLocaleString()}</strong><span>minutes listened</span></div></div>
        <div class="w-sum-cols"><div><h3>Top songs</h3><ol>${d.songs.slice(0, 5).map((s) => `<li>${escapeHtml(s.title)}</li>`).join("")}</ol></div>
        <div><h3>Top artists</h3><ol>${d.artists.slice(0, 5).map((a) => `<li>${escapeHtml(a.name)}</li>`).join("")}</ol></div></div>
        <div class="w-sum-actions"><button type="button" class="w-btn" data-wrapped="save">Save image</button><button type="button" class="w-btn ghost" data-wrapped="replay">Watch again</button></div>` });
    return cards;
}
function openWrapped(periodId) {
    if (!wrappedOverlay) return;
    statsTick(); // count the song that's playing up to now
    const periods = wrappedPeriods();
    const jan = new Date().getMonth() === 0;
    const period = periods.find((p) => p.id === periodId) || periods.find((p) => p.id === (jan ? "lastyear" : "year")) || periods[0];
    const data = wrappedData(period);
    if (wrapped?.raf) cancelAnimationFrame(wrapped.raf);
    wrapped = { periods, period, data, cards: wrappedCards(period, data), index: 0, elapsed: 0, last: performance.now(), holding: false, raf: null };
    $("wrapped-period").innerHTML = periods.map((p) => `<button type="button" data-value="${p.id}" class="${p.id === period.id ? "active" : ""}">${escapeHtml(p.label)}</button>`).join("");
    $("wrapped-progress").innerHTML = wrapped.cards.map(() => "<span><i></i></span>").join("");
    wrappedOverlay.hidden = false;
    document.body.classList.add("wrapped-open");
    showWrappedCard(0);
    wrapped.raf = requestAnimationFrame(wrappedTick);
}
function closeWrapped() {
    if (!wrappedOverlay || wrappedOverlay.hidden) return;
    if (wrapped?.raf) cancelAnimationFrame(wrapped.raf);
    wrapped = null; wrappedOverlay.hidden = true;
    document.body.classList.remove("wrapped-open");
}
function showWrappedCard(i) {
    if (!wrapped) return;
    wrapped.index = clamp(i, 0, wrapped.cards.length - 1); wrapped.elapsed = 0;
    const c = wrapped.cards[wrapped.index], el = $("wrapped-card");
    el.className = `wrapped-card ${c.cls} w-bg-${wrapped.index % 6}`;
    el.innerHTML = c.html;
    void el.offsetWidth; el.classList.add("enter");
    $("wrapped-progress").querySelectorAll("span").forEach((s, j) => s.firstElementChild.style.width = j < wrapped.index ? "100%" : "0%");
}
function wrappedTick(now) {
    if (!wrapped) return;
    const dt = now - wrapped.last; wrapped.last = now;
    const c = wrapped.cards[wrapped.index];
    if (!wrapped.holding && !c.final && document.visibilityState === "visible") {
        wrapped.elapsed += dt;
        if (wrapped.elapsed >= WRAPPED_CARD_MS) showWrappedCard(wrapped.index + 1);
    }
    const bar = $("wrapped-progress").children[wrapped.index];
    if (bar) bar.firstElementChild.style.width = (c.final ? 100 : Math.min(100, (wrapped.elapsed / WRAPPED_CARD_MS) * 100)) + "%";
    wrapped.raf = requestAnimationFrame(wrappedTick);
}
// The share image: a 1080×1350 card drawn on a canvas (cover art is a same-origin blob).
function loadImage(src) {
    return new Promise((resolve) => {
        if (!src || src === DEFAULT_ART) { resolve(null); return; }
        const img = new Image(); const done = (v) => { clearTimeout(timer); resolve(v); };
        const timer = setTimeout(() => done(null), 4000);
        img.onload = () => done(img); img.onerror = () => done(null); img.src = src;
    });
}
async function saveWrappedImage() {
    if (!wrapped) return;
    const { period: p, data: d } = wrapped, W = 1080, H = 1350;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), cs = getComputedStyle(document.documentElement);
    const accent = cs.getPropertyValue("--accent").trim() || "#1DB954", accent2 = cs.getPropertyValue("--accent-2").trim() || accent;
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, accent); bg.addColorStop(0.55, "#121222"); bg.addColorStop(1, "#06060c");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.18; g.fillStyle = accent2; g.beginPath(); g.arc(W * 0.9, H * 0.12, 300, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    const font = (w, s) => `${w} ${s}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    const fit = (text, max) => { let t = String(text); if (g.measureText(t).width <= max) return t; while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; };
    g.fillStyle = "#fff"; g.textBaseline = "alphabetic";
    g.font = font(800, 44); g.fillText(fit(`My ${p.title} on Prism`, 640), 80, 140);
    const topArt = await loadImage(d.songs[0]?.art);
    if (topArt) {
        g.save(); g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 40;
        const s = 300, x = W - 80 - s, y = 80, m = Math.min(topArt.naturalWidth, topArt.naturalHeight);
        g.drawImage(topArt, (topArt.naturalWidth - m) / 2, (topArt.naturalHeight - m) / 2, m, m, x, y, s, s); g.restore();
    }
    g.font = font(900, 150); g.fillText(Math.round(d.seconds / 60).toLocaleString(), 72, 330);
    g.font = font(600, 40); g.globalAlpha = 0.8; g.fillText("minutes listened", 80, 390); g.globalAlpha = 1;
    const col = (title, items, x) => {
        g.font = font(800, 34); g.globalAlpha = 0.7; g.fillText(title.toUpperCase(), x, 520); g.globalAlpha = 1;
        items.slice(0, 5).forEach((it, i) => {
            const y = 600 + i * 118;
            g.font = font(900, 46); g.fillStyle = accent; g.fillText(String(i + 1), x, y); g.fillStyle = "#fff";
            g.font = font(700, 38); g.fillText(fit(it.a, 400), x + 54, y - 6);
            if (it.b) { g.font = font(500, 28); g.globalAlpha = 0.65; g.fillText(fit(it.b, 400), x + 54, y + 34); g.globalAlpha = 1; }
        });
    };
    col("Top songs", d.songs.map((s) => ({ a: s.title, b: s.artist })), 80);
    col("Top artists", d.artists.map((a) => ({ a: a.name, b: `${Math.round(a.seconds / 60).toLocaleString()} min` })), 580);
    g.font = font(700, 30); g.globalAlpha = 0.75;
    g.fillText(`${d.plays.toLocaleString()} plays · ${d.songs.length.toLocaleString()} songs${d.streak > 1 ? ` · ${d.streak}-day streak` : ""}`, 80, H - 90);
    g.textAlign = "right"; g.fillText("Prism", W - 80, H - 90); g.globalAlpha = 1;
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    if (!blob) { showToast("Couldn't make the image"); return; }
    await saveBlobAsFile(blob, `spootify-wrapped-${p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`, "Wrapped image");
}
(() => {
    if (!wrappedOverlay) return;
    const stage = $("wrapped-stage");
    let downAt = 0, holdTimer = null;
    stage.addEventListener("pointerdown", (e) => {
        if (!wrapped || e.target.closest("button, .segmented")) return;
        downAt = performance.now();
        holdTimer = setTimeout(() => { if (wrapped) wrapped.holding = true; }, 220);
    });
    const release = (e, cancelled) => {
        clearTimeout(holdTimer);
        if (!wrapped || !downAt) return;
        const held = wrapped.holding; wrapped.holding = false; downAt = 0;
        if (held || cancelled || e.target.closest("button, .segmented")) return;
        const r = stage.getBoundingClientRect();
        if (e.clientX - r.left < r.width * 0.3) showWrappedCard(wrapped.index - 1);
        else if (wrapped.index < wrapped.cards.length - 1) showWrappedCard(wrapped.index + 1);
    };
    stage.addEventListener("pointerup", (e) => release(e, false));
    stage.addEventListener("pointercancel", (e) => release(e, true));
    stage.addEventListener("click", (e) => {
        const act = e.target.closest("[data-wrapped]")?.dataset.wrapped;
        if (act === "save") saveWrappedImage();
        else if (act === "replay") showWrappedCard(0);
    });
    $("wrapped-period").addEventListener("click", (e) => { const b = e.target.closest("button[data-value]"); if (b) openWrapped(b.dataset.value); });
    $("wrapped-close-btn").addEventListener("click", closeWrapped);
    if ($("wrapped-open-btn")) $("wrapped-open-btn").addEventListener("click", () => openWrapped());
})();


const MINI_PLAY_SVG = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M8 5v14l11-7-11-7Z" fill="currentColor"/></svg>';
const MINI_PAUSE_SVG = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" fill="currentColor"/></svg>';
const NP_PLAY_SVG = '<svg viewBox="0 0 24 24" width="32" height="32"><path d="M8 5v14l11-7-11-7Z" fill="currentColor"/></svg>';
const NP_PAUSE_SVG = '<svg viewBox="0 0 24 24" width="32" height="32"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" fill="currentColor"/></svg>';
let shownPlayState = null;
// Buttons follow what the user asked for (a fading-out pause already shows "Play").
function updatePlayPauseIcon() {
    const playing = isAudiblyPlaying();
    if (playing !== shownPlayState) {
        shownPlayState = playing;
        if (playPauseBtn) setIcon(playPauseBtn, playing ? ICONS.pause : ICONS.play, playing ? "Pause" : "Play");
        if (miniPlayBtn) { miniPlayBtn.innerHTML = playing ? MINI_PAUSE_SVG : MINI_PLAY_SVG; miniPlayBtn.setAttribute("aria-label", playing ? "Pause" : "Play"); }
        if (npPlayBtn) { npPlayBtn.innerHTML = playing ? NP_PAUSE_SVG : NP_PLAY_SVG; npPlayBtn.setAttribute("aria-label", playing ? "Pause" : "Play"); }
        document.body.classList.toggle("is-playing", playing);
    }
    updateDocumentTitle();
    updatePlayingIndicators();
    kickVisualizer();
    renderQuiet();
}
function updateDocumentTitle() {
    const t = currentTrack && isAudiblyPlaying() ? `${currentTrack.title || "Unknown"} · ${currentTrack.artist || "Unknown Artist"}` : "Prism";
    if (document.title !== t) document.title = t;
}
onPlayer("play", updatePlayPauseIcon);
onPlayer("pause", updatePlayPauseIcon); // also catches pauses from outside (headphones unplugged, audio focus)

// Range fills are drawn by CSS from --p (see style.css) so they follow the theme's accent.
function updateSliderFill(slider) {
    if (!slider) return;
    const min = Number(slider.min) || 0, max = Number(slider.max) || 100;
    slider.style.setProperty("--p", ((Number(slider.value) - min) / (max - min || 1)) * 100 + "%");
}

// Sliders whose neutral point is the middle (bass, balance…) fill from the centre out.
function updateBipolarFill(slider) {
    if (!slider) return;
    const min = Number(slider.min) || 0, max = Number(slider.max) || 100;
    const pct = ((Number(slider.value) - min) / (max - min || 1)) * 100;
    slider.classList.add("bipolar");
    slider.style.setProperty("--a", Math.min(50, pct) + "%");
    slider.style.setProperty("--b", Math.max(50, pct) + "%");
}
function setRangeValue(slider, pct) {
    if (!slider || Math.abs((slider._pct ?? -1) - pct) < 0.02) return;
    slider._pct = pct; slider.value = pct;
    slider.style.setProperty("--p", pct + "%");
}

// ── PROGRESS ──
// renderProgress() only touches the DOM, and only for what changed (the clock text
// once a second), so the 60 fps loop stays cheap. onTimeTick() is the logic that must
// keep running with the screen off (driven by "timeupdate"): lock-screen position,
// crossfade, the sleep timer and the up-next reminder.
let lastProgressSecond = -1, lastProgressDuration = -1, lastRemainingMode = null;
function renderProgress(force = false) {
    if (document.visibilityState !== "visible" && !force) return;
    const d = audioPlayer.duration, t = audioPlayer.currentTime || 0;
    const hasD = Number.isFinite(d) && d > 0, pct = hasD ? Math.min(100, (t / d) * 100) : 0;
    const npOpen = isNowPlayingOpen(), sec = Math.floor(t), rem = !!prefs.remainingTime;
    if (force || sec !== lastProgressSecond || d !== lastProgressDuration || rem !== lastRemainingMode) {
        lastProgressSecond = sec; lastProgressDuration = d; lastRemainingMode = rem;
        const totalText = hasD ? (rem ? "-" + formatTime(Math.max(0, d - t)) : formatTime(d)) : "0:00";
        if (!isScrubbing) { setText(currentTimeLabel, formatTime(t)); if (npOpen) setText(npCurrentTime, formatTime(t)); }
        setText(totalTimeLabel, totalText);
        if (npOpen) setText(npTotalTime, totalText);
    }
    if (!isScrubbing) { setRangeValue(progressBar, pct); if (npOpen) setRangeValue(npProgressBar, pct); }
    if (miniProgressFill) miniProgressFill.style.transform = `scaleX(${pct / 100})`;
}
function onTimeTick() {
    updateMediaSessionPosition();
    maybeStartCrossfade();
    checkSleepTimer();
    maybeRemindUpNext();
}
function updateProgressUi(force = false) { renderProgress(force); onTimeTick(); }

// ── CROSSFADE ──
// Two flavours, chosen by the "start next song during fade" switch:
//   fade-out only  — the last N seconds of the track ramp down; the next song then
//                    starts normally at full volume (the original behaviour).
//   overlap        — the next song is pre-rolled on the standby element and ramps
//                    up while the current one ramps down; when the current track
//                    ends the two elements swap roles, so playback is seamless.
// Timing is in real seconds, so it still lands at 1.5x or 0.8x speed.
function maybeStartCrossfade() {
    if (!(crossfadeDuration > 0) || !audioPlayer.duration || audioPlayer.paused || !isPlaybackIntentActive) return;
    const timeRemaining = (audioPlayer.duration - audioPlayer.currentTime) / (audioPlayer.playbackRate || 1);
    // Seeked back out of the fade window (or the fade is stale): start over cleanly.
    if (crossfadeTriggered) { if (timeRemaining > crossfadeDuration + 1) cancelCrossfade(); return; }
    if (timeRemaining > crossfadeDuration || timeRemaining <= 0.5) return;
    crossfadeTriggered = true;
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; fadeGain = 1; }
    const overlapNext = crossfadeOverlap && loopMode !== "one" && !sleepAtTrackEnd ? peekNextSong() : null;
    if (overlapNext) startOverlap(overlapNext);
    const steps = Math.max(15, Math.round(timeRemaining * 10));
    const interval = (timeRemaining * 1000) / steps;
    let step = 0;
    crossfadeFadeId = setInterval(() => {
        step++;
        const t = Math.min(1, step / steps), base = masterVolume();
        // Equal-power curves keep the combined loudness steady through the overlap.
        audioPlayer.volume = Math.max(0, base * Math.cos(t * Math.PI / 2));
        if (crossfadePending) standbyPlayer.volume = Math.min(1, base * Math.sin(t * Math.PI / 2));
        // Done: stay faded out until the track ends (the next track restores the volume).
        if (step >= steps) { clearInterval(crossfadeFadeId); crossfadeFadeId = null; }
    }, interval);
}
async function startOverlap(next) {
    const song = next.song;
    if (!song.fileSrc && song.mediaId) song.fileSrc = await getBlobUrl(song.mediaId);
    if (!song.fileSrc || !crossfadeTriggered || crossfadePending) return;
    crossfadePending = next;
    standbyPlayer.volume = 0;
    loadTrackInto(standbyPlayer, song);
    const p = standbyPlayer.play();
    if (p && p.catch) p.catch(() => { crossfadePending = null; }); // blocked in the background: fall back to a plain fade-out
}
// The current track ended while the next was already playing on the standby: make
// the standby the active player and let the old one go idle.
function commitCrossfade() {
    const next = crossfadePending; crossfadePending = null;
    if (crossfadeFadeId) { clearInterval(crossfadeFadeId); crossfadeFadeId = null; }
    crossfadeTriggered = false;
    if (next.fromQueue) { const idx = queue.findIndex((i) => i?.song === next.song); if (idx !== -1) queue.splice(idx, 1); saveLibrary(); }
    statsEndSession();
    const old = audioPlayer;
    audioPlayer = standbyPlayer; standbyPlayer = old;
    old.pause(); old.removeAttribute("src"); old.load();
    applyVolume();
    activateTrack(next.song, next.source, next.fromQueue);
    statsStartSession(); if (!audioPlayer.paused) statsResume();
    isPlaybackIntentActive = true;
    afterTrackChange();
    startProgressLoop();
    renderProgress(true);
    prepareLeveller(peekNextSong()?.song);
}
// Stops an in-flight fade (and any pre-rolled next song) and restores the volume,
// so a track change or the user pressing Next mid-fade never starts quietly.
function cancelCrossfade() {
    if (crossfadeFadeId) { clearInterval(crossfadeFadeId); crossfadeFadeId = null; }
    if (crossfadePending) { crossfadePending = null; standbyPlayer.pause(); standbyPlayer.removeAttribute("src"); standbyPlayer.load(); }
    crossfadeTriggered = false;
    applyVolume();
}

function startProgressLoop() {
    if (progressFrameId || (isQuietOpen() && !appearance.quietSmooth)) return;
    const tick = () => {
        if (isQuietOpen()) renderQuiet(); else renderProgress();
        maybeStartCrossfade();
        if (!audioPlayer.paused && !audioPlayer.ended) {
            progressFrameId = requestAnimationFrame(tick);
        } else { progressFrameId = null; }
    };
    progressFrameId = requestAnimationFrame(tick);
}

function stopProgressLoop() {
    if (!progressFrameId) return;
    cancelAnimationFrame(progressFrameId);
    progressFrameId = null;
}

function setActiveButton(button, active) {
    if (button) button.classList.toggle("is-active", active);
}

function updateLoopButton() {
    if (!loopBtn) return;
    const labels = { off: "Loop off", all: "Loop playlist", one: "Loop current song" };
    setIcon(loopBtn, loopMode === "one" ? ICONS.loopOne : ICONS.loop, labels[loopMode]);
    setActiveButton(loopBtn, loopMode !== "off");
}

// ── MEDIA SESSION ──
function updateMediaSessionMetadata() {
    syncNativePlayback();
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title, artist: currentTrack.artist,
        album: sourceLabel(currentTrackSource),
        artwork: [{ src: currentTrack.art || DEFAULT_ART, sizes: "256x256", type: "image/png" }]
    });
    navigator.mediaSession.playbackState = audioPlayer.paused ? "paused" : "playing";
}

function updateMediaSessionPosition() {
    syncNativePosition();
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !audioPlayer.duration) return;
    const now = Date.now();
    if (now - lastMediaSessionPositionUpdate < 1000) return;
    lastMediaSessionPositionUpdate = now;
    navigator.mediaSession.setPositionState({ duration: audioPlayer.duration, playbackRate: audioPlayer.playbackRate, position: audioPlayer.currentTime });
}

function setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const s = (action, handler) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch {} };
    s("play", () => { if (currentTrack) safePlay(); updatePlayPauseIcon(); updateMediaSessionMetadata(); });
    s("pause", () => { pausePlayback(); updatePlayPauseIcon(); updateMediaSessionMetadata(); });
    s("previoustrack", playPrevious);
    s("nexttrack", playNext);
    s("seekto", (d) => {
        if (!audioPlayer.duration || d.seekTime === undefined) return;
        audioPlayer.currentTime = d.seekTime;
        updateProgressUi();
        lastMediaSessionPositionUpdate = 0;
        updateMediaSessionPosition(); syncNativePosition(true); saveNowPlaying();
    });
}


// ── PLAY ORDER ──
// What plays when the queue is empty. Shuffle has its own shuffled order; otherwise
// it's the view's order, until the user drags songs around in "Next up", which
// freezes a custom order for that source. Songs dragged out of "Next up" into the
// queue are skipped for the rest of this pass so they don't play twice. Both orders
// are reconciled against the source on every read, so songs added to or removed
// from the playlist mid-play are picked up (a removed song used to still come up
// in shuffle and fail to play).
let customOrder = null, customOrderSource = null;
let orderSkipped = new Set();
function resetPlayOrder() { customOrder = null; customOrderSource = null; orderSkipped = new Set(); }
function reconcileOrder(order, songs, randomInsert) {
    const live = new Set(songs);
    const out = order.filter((s) => live.has(s));
    const have = new Set(out);
    const missing = songs.filter((s) => !have.has(s) && !orderSkipped.has(s));
    if (missing.length) {
        const after = contextTrack ? out.findIndex((s) => s.id === contextTrack.id) + 1 : 0;
        for (const s of missing) {
            if (randomInsert) out.splice(after + Math.floor(Math.random() * (out.length - after + 1)), 0, s);
            else out.push(s);
        }
    }
    return out;
}
function getPlayOrder() {
    const songs = getPlaybackSourceSongs();
    if (shuffleEnabled) {
        if (!shuffledOrder.length && songs.length) generateShuffleOrder();
        shuffledOrder = reconcileOrder(shuffledOrder, songs, true);
        return shuffledOrder;
    }
    if (customOrder && customOrderSource === contextSource) { customOrder = reconcileOrder(customOrder, songs, false); return customOrder; }
    customOrder = null;
    return orderSkipped.size ? songs.filter((s) => !orderSkipped.has(s)) : songs;
}
// A mutable order to drag songs around in.
function materializeOrder() {
    if (!shuffleEnabled && !(customOrder && customOrderSource === contextSource)) {
        customOrder = getPlaybackSourceSongs().filter((s) => !orderSkipped.has(s));
        customOrderSource = contextSource;
    }
    return getPlayOrder();
}
function upNextStart(order) { return contextTrack ? order.findIndex((s) => s.id === contextTrack.id) + 1 : 0; }

// ── SHUFFLE ORDER ──
function fisherYates(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
}
// Smart shuffle: each artist's songs are spread evenly through the order (random
// offset, small jitter), songs heard in the last few days drift towards the end,
// and a final pass breaks up any remaining same-artist neighbours.
function smartShuffle(songs) {
    const groups = new Map();
    for (const s of songs) { const k = artistKey(s.artist); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    const now = Date.now(), DAY = 86400000, placed = [];
    for (const group of groups.values()) {
        fisherYates(group);
        const n = group.length, offset = Math.random() / n;
        group.forEach((s, i) => {
            let pos = offset + i / n + ((Math.random() - 0.5) * 0.3) / n;
            const last = listenStats[statsKeyFor(s)]?.lastPlayed;
            if (last) { const age = (now - last) / DAY; if (age < 3) pos += 0.6 * (1 - age / 3); }
            placed.push({ s, pos });
        });
    }
    placed.sort((a, b) => a.pos - b.pos);
    const out = placed.map((p) => p.s);
    for (let i = 1; i < out.length; i++) {
        if (artistKey(out[i].artist) !== artistKey(out[i - 1].artist)) continue;
        for (let j = i + 1; j < out.length; j++) {
            const a = artistKey(out[j].artist);
            if (a !== artistKey(out[i - 1].artist) && (i + 1 >= out.length || a !== artistKey(out[i + 1].artist))) { [out[i], out[j]] = [out[j], out[i]]; break; }
        }
    }
    return out;
}
function generateShuffleOrder() {
    const songs = getPlaybackSourceSongs().filter((s) => !orderSkipped.has(s));
    if (!songs.length) { shuffledOrder = []; return; }
    shuffledOrder = prefs.smartShuffle ? smartShuffle(songs) : fisherYates([...songs]);
    if (contextTrack) {
        const idx = shuffledOrder.findIndex(s => s.id === contextTrack.id);
        if (idx > 0) { const [c] = shuffledOrder.splice(idx, 1); shuffledOrder.unshift(c); }
    }
}

// ── QUEUE ──
// Up to `limit` songs after the current one; with loop-all the list wraps (those
// wrapped entries are shown but can't be dragged).
function getUpNext(limit = 10) {
    const order = getPlayOrder();
    if (!order.length) return [];
    const start = upNextStart(order), out = [];
    for (let i = start; i < order.length && out.length < limit; i++) out.push({ song: order[i], wrapped: false });
    if (loopMode === "all") for (let i = 0; i < start - 1 && out.length < limit; i++) out.push({ song: order[i], wrapped: true });
    return out;
}
function getNextPreviewSongs(limit = 8) { return getUpNext(limit).map((e) => e.song); }
function upNextLimit() { const n = Number(prefs.nextUpCount); return n > 0 ? n : Infinity; }

// Rendering is batched to one per frame; many actions ask for it at once.
let queueRenderPending = false;
function renderQueue() {
    if (queueRenderPending) return;
    queueRenderPending = true;
    requestAnimationFrame(() => { queueRenderPending = false; renderQueueNow(); });
}
function renderNpQueue() { renderQueue(); }
function renderQueueNow() {
    queue = queue.filter(item => item?.song?.mediaId || item?.song?.fileSrc);
    const desktop = !isMobile(), npOpen = isNowPlayingOpen();
    if (!(desktop && queueList && !document.body.classList.contains("queue-hidden")) && !npOpen) return;
    const next = getUpNext(upNextLimit());
    const src = contextSource || currentPlaylist;
    const label = next.length ? `Next from ${src ? sourceLabel(src) : "playlist"}` : (currentTrack && loopMode === "off" ? "End of the playlist" : "Next up");
    if (desktop && queueList) { fillQueueList(queueList, nextList, next, "No queued songs"); setText(nextHeading, label); if (nextHeading) nextHeading.hidden = !next.length && !currentTrack; }
    if (npOpen && npQueueList) { fillQueueList(npQueueList, npNextList, next, "Nothing queued — drag a song up here"); setText(npNextLabel, label); }
}
function fillQueueList(qEl, nEl, next, emptyText) {
    qEl.innerHTML = ""; nEl.innerHTML = "";
    if (!queue.length) qEl.innerHTML = `<div class="queue-empty">${escapeHtml(emptyText)}</div>`;
    const qf = document.createDocumentFragment(), nf = document.createDocumentFragment();
    queue.forEach((item, i) => qf.appendChild(createMiniSongRow(item.song, "queue", i)));
    next.forEach((entry, i) => nf.appendChild(createMiniSongRow(entry.song, "next", i, entry.wrapped)));
    qEl.appendChild(qf); nEl.appendChild(nf);
}
function createMiniSongRow(song, kind, index, wrapped = false) {
    const row = document.createElement("div");
    row.className = `mini-song-row ${kind === "queue" ? "queue-item" : "next-item"}${wrapped ? " no-drag" : ""}`;
    row.dataset.kind = kind; row.dataset.index = index;
    row.innerHTML = `<img src="${escapeHtml(song.art || DEFAULT_ART)}" alt="" loading="lazy"><div class="mini-info"><strong>${escapeHtml(song.title || "Unknown")}</strong><span>${escapeHtml(song.artist || "Unknown")}</span></div>`
        + (kind === "queue" ? `<button type="button" class="mini-remove" aria-label="Remove from queue" title="Remove from queue">${ICONS.close}</button>` : "")
        + `<span class="drag-handle" aria-hidden="true">${ICONS.handle}</span>`;
    return row;
}
// One set of listeners per list: click plays, × removes, right-click / long-press opens the menu.
let suppressQueueClickUntil = 0;
function queueRowFromEvent(e) {
    const row = e.target.closest(".mini-song-row"); if (!row) return null;
    const kind = row.dataset.kind, index = Number(row.dataset.index);
    if (kind === "queue") { const item = queue[index]; return item ? { row, kind, index, song: item.song, playlistName: item.playlistName } : null; }
    const entry = getUpNext(upNextLimit())[index];
    return entry ? { row, kind, index, song: entry.song, playlistName: contextSource || currentPlaylist } : null;
}
function wireQueueList(el) {
    if (!el) return;
    el.addEventListener("click", async (e) => {
        if (performance.now() < suppressQueueClickUntil) return;
        const hit = queueRowFromEvent(e); if (!hit) return;
        if (e.target.closest(".mini-remove")) { e.stopPropagation(); removeFromQueue(hit.index); return; }
        if (e.target.closest(".drag-handle")) return;
        if (hit.kind === "queue") { queue.splice(hit.index, 1); await saveLibrary(); await playSong(hit.song, hit.playlistName, true, { restart: true }); }
        else await playSong(hit.song, hit.playlistName);
        renderQueue();
    });
    el.addEventListener("contextmenu", (e) => {
        if (e.target.closest(".drag-handle")) { e.preventDefault(); return; }
        const hit = queueRowFromEvent(e); if (!hit) return;
        e.preventDefault();
        openSongMenu(hit.song, hit.playlistName, e.clientX, e.clientY, hit.kind === "queue" ? { queueIndex: hit.index } : {});
    });
}
[queueList, nextList, npQueueList, npNextList].forEach(wireQueueList);

// ── QUEUE DRAG & DROP ──
// Drag songs within the queue, within "Next up", or between them. Mouse: drag the
// row. Touch: drag by the handle (the rest of the row still scrolls / swipes).
// A floating copy follows the pointer and a line shows where it will land.
function moveQueueEntry(fromKind, fromIndex, toKind, toIndex) {
    if (fromKind === "queue" && toKind === "queue") {
        const [item] = queue.splice(fromIndex, 1); if (!item) return false;
        queue.splice(Math.min(toIndex, queue.length), 0, item);
    } else if (fromKind === "next" && toKind === "queue") {
        const order = materializeOrder(), pos = upNextStart(order) + fromIndex;
        if (pos >= order.length) return false;
        const [song] = order.splice(pos, 1);
        orderSkipped.add(song);
        queue.splice(Math.min(toIndex, queue.length), 0, { song, playlistName: contextSource || currentTrackSource || currentPlaylist });
    } else if (fromKind === "queue" && toKind === "next") {
        const item = queue[fromIndex]; if (!item) return false;
        const live = getPlaybackSourceSongs().find((s) => s.id === item.song.id);
        if (!live || (contextTrack && live.id === contextTrack.id)) return false; // not part of what's playing
        const order = materializeOrder(), existing = order.indexOf(live);
        if (existing !== -1) order.splice(existing, 1);
        orderSkipped.delete(live);
        order.splice(Math.min(upNextStart(order) + toIndex, order.length), 0, live);
        queue.splice(fromIndex, 1);
    } else if (fromKind === "next" && toKind === "next") {
        const order = materializeOrder(), start = upNextStart(order), from = start + fromIndex;
        if (from >= order.length) return false;
        const [song] = order.splice(from, 1);
        order.splice(Math.min(start + toIndex, order.length), 0, song);
    } else return false;
    return true;
}
(() => {
    let st = null;
    const panelOf = (row) => row.closest(".queue-panel, .np-queue-section");
    function onDown(e) {
        const row = e.target.closest(".mini-song-row");
        if (!row || row.classList.contains("no-drag") || (e.button !== undefined && e.button !== 0)) return;
        if (e.target.closest("button")) return;
        const onHandle = !!e.target.closest(".drag-handle");
        if (e.pointerType !== "mouse" && !onHandle) return;
        st = { row, kind: row.dataset.kind, index: Number(row.dataset.index), startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, started: false, target: null };
        if (e.pointerType !== "mouse") { e.preventDefault(); begin(e); }
        window.addEventListener("pointermove", onMove, { passive: false });
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
    }
    function begin(e) {
        st.started = true;
        st.lists = [...panelOf(st.row).querySelectorAll(".drag-list")];
        const r = st.row.getBoundingClientRect();
        st.offsetX = e.clientX - r.left; st.offsetY = e.clientY - r.top;
        st.ghost = st.row.cloneNode(true);
        st.ghost.classList.add("drag-ghost");
        Object.assign(st.ghost.style, { width: r.width + "px", left: r.left + "px", top: r.top + "px" });
        document.body.appendChild(st.ghost);
        st.indicator = document.createElement("div"); st.indicator.className = "drop-indicator"; st.indicator.hidden = true;
        document.body.appendChild(st.indicator);
        st.row.classList.add("drag-source");
        document.body.classList.add("is-dragging");
        st.scroller = st.row.closest(".queue-panel, .now-playing-screen");
        st.lastX = e.clientX; st.lastY = e.clientY;
        haptic(12);
        autoScroll();
    }
    function onMove(e) {
        if (!st || e.pointerId !== st.pointerId) return;
        if (!st.started) { if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 5) return; begin(e); }
        e.preventDefault();
        st.lastX = e.clientX; st.lastY = e.clientY;
        st.ghost.style.left = (e.clientX - st.offsetX) + "px";
        st.ghost.style.top = (e.clientY - st.offsetY) + "px";
        findTarget();
    }
    // The list under the pointer (or the nearest one), and the slot between its rows.
    function findTarget() {
        const y = st.lastY;
        let best = null, bestDist = Infinity;
        for (const list of st.lists) {
            const r = list.getBoundingClientRect(), dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
            if (dist < bestDist) { bestDist = dist; best = list; }
        }
        st.target = null; st.indicator.hidden = true;
        st.lists.forEach((l) => l.classList.remove("drop-empty"));
        if (!best || bestDist > 60) return;
        const kind = best.dataset.list;
        if (st.kind === "queue" && kind === "next") {
            const item = queue[st.index];
            if (!item || !getPlaybackSourceSongs().some((s) => s.id === item.song.id) || (contextTrack && item.song.id === contextTrack.id)) return;
        }
        const rows = [...best.querySelectorAll(".mini-song-row:not(.drag-source)")].filter((r) => !r.classList.contains("no-drag"));
        let index = rows.length;
        for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { index = i; break; } }
        st.target = { kind, index };
        const lr = best.getBoundingClientRect();
        let lineY;
        if (!rows.length) { best.classList.add("drop-empty"); lineY = lr.top + 4; }
        else if (index < rows.length) lineY = rows[index].getBoundingClientRect().top - 1;
        else lineY = rows[rows.length - 1].getBoundingClientRect().bottom + 1;
        Object.assign(st.indicator.style, { left: (lr.left + 6) + "px", width: Math.max(20, lr.width - 12) + "px", top: lineY + "px" });
        st.indicator.hidden = false;
    }
    function autoScroll() {
        if (!st || !st.started) return;
        const sc = st.scroller;
        if (sc) {
            const r = sc.getBoundingClientRect(), edge = 48;
            let dy = 0;
            if (st.lastY < r.top + edge) dy = -Math.ceil((r.top + edge - st.lastY) / 5);
            else if (st.lastY > r.bottom - edge) dy = Math.ceil((st.lastY - (r.bottom - edge)) / 5);
            if (dy) { sc.scrollTop += dy; findTarget(); }
        }
        requestAnimationFrame(autoScroll);
    }
    function cleanup() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (st && st.started) {
            st.ghost.remove(); st.indicator.remove();
            st.row.classList.remove("drag-source");
            st.lists.forEach((l) => l.classList.remove("drop-empty"));
            document.body.classList.remove("is-dragging");
            suppressQueueClickUntil = performance.now() + 350;
        }
    }
    function onUp(e) {
        if (!st || e.pointerId !== st.pointerId) return;
        const s = st; cleanup(); st = null;
        if (!s.started || !s.target) return;
        const { kind, index } = s.target;
        if (kind === s.kind && (index === s.index)) return;
        if (moveQueueEntry(s.kind, s.index, kind, index)) { haptic(8); saveLibrary(); renderQueue(); prepareLeveller(peekNextSong()?.song); }
    }
    function onCancel() { cleanup(); st = null; }
    for (const panel of [$("queue-panel"), document.querySelector(".np-queue-section")]) if (panel) panel.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && st) { onCancel(); } });
})();

// ── SWIPE GESTURES ──
// Direction-locked swipe. A gesture only becomes a swipe if its first clear movement
// is unmistakably horizontal; anything else is left to the browser as a scroll and
// can never commit. Commit needs ~42% of the row width (or a fast flick past half of
// that), with a rubber-band past the threshold, a revealed label, and a haptic tick
// when it arms. One set of listeners per list (rows come and go on every render).
function attachSwipe(container, rowSelector, optsFor) {
    if (!container) return;
    const DEAD_ZONE = 14, LOCK_RATIO = 1.8, FLICK_VELOCITY = 0.6;
    let row = null, opts = null, dir = 1, startX = 0, startY = 0, lastX = 0, lastT = 0, state = "idle", armed = false;
    const threshold = () => Math.max(100, row.offsetWidth * 0.42);
    const ensureReveal = () => {
        if (row._swipeReveal && row._swipeReveal.isConnected) return;
        const reveal = document.createElement("div");
        reveal.className = `swipe-reveal ${dir > 0 ? "swipe-reveal-left" : "swipe-reveal-right"} ${opts.className || ""}`;
        reveal.innerHTML = `${opts.icon || ""}<span>${escapeHtml(opts.label)}</span>`;
        row.appendChild(reveal); row._swipeReveal = reveal;
    };
    const reset = (animate) => {
        if (!row) return;
        row.style.transition = animate ? "transform 0.25s cubic-bezier(.2,.8,.2,1)" : "none";
        row.style.transform = "";
        row.classList.remove("swiping", "swipe-armed");
        armed = false; state = "idle";
    };
    container.addEventListener("touchstart", (e) => {
        if (state === "committing") return;
        if (!isMobile() || e.touches.length !== 1 || e.target.closest(".drag-handle")) { state = "cancelled"; return; }
        const r = e.target.closest(rowSelector), o = r && container.contains(r) ? optsFor(r) : null;
        if (!o) { state = "cancelled"; return; }
        row = r; opts = o; dir = o.direction;
        const t = e.touches[0];
        startX = lastX = t.clientX; startY = t.clientY; lastT = e.timeStamp; state = "pending"; armed = false;
    }, { passive: true });
    container.addEventListener("touchmove", (e) => {
        if (state === "idle" || state === "cancelled" || state === "committing") return;
        const t = e.touches[0];
        const dx = t.clientX - startX, dy = t.clientY - startY;
        if (state === "pending") {
            if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
            if (dx * dir > 0 && Math.abs(dx) > Math.abs(dy) * LOCK_RATIO) {
                state = "swiping"; ensureReveal(); row.classList.add("swiping"); row.style.transition = "none";
            } else { state = "cancelled"; return; } // it's a scroll — stay out of the way until the next touch
        }
        if (e.cancelable) e.preventDefault(); // we own this gesture; the page must not scroll underneath it
        const th = threshold();
        let travel = Math.max(0, dx * dir);
        if (travel > th) travel = th + (travel - th) * 0.3;
        row.style.transform = `translateX(${travel * dir}px)`;
        const nowArmed = dx * dir >= th;
        if (nowArmed !== armed) {
            armed = nowArmed; row.classList.toggle("swipe-armed", armed);
            if (armed) haptic(12);
        }
        lastX = t.clientX; lastT = e.timeStamp;
    }, { passive: false });
    container.addEventListener("touchend", (e) => {
        if (state !== "swiping") { if (state !== "committing") state = "idle"; return; }
        const t = e.changedTouches[0];
        const dx = (t.clientX - startX) * dir;
        const velocity = ((t.clientX - lastX) * dir) / Math.max(1, e.timeStamp - lastT); // px/ms over the last move
        const th = threshold();
        if (dx >= th || (dx >= th * 0.5 && velocity > FLICK_VELOCITY)) {
            row.style.transition = "transform 0.2s ease-out";
            row.style.transform = `translateX(${row.offsetWidth * dir}px)`;
            row.classList.add("swipe-armed");
            state = "committing";
            const r = row, o = opts;
            setTimeout(() => { if (row === r) reset(false); state = "idle"; o.onCommit(r); }, 200);
        } else reset(true);
    }, { passive: true });
    container.addEventListener("touchcancel", () => { if (state === "swiping") reset(true); else if (state !== "committing") state = "idle"; }, { passive: true });
}

const ICON_INFO = '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1 6h2v7h-2v-7Zm0-3h2v2h-2V7Z"/></svg>';
const ICON_SELECT = '<svg viewBox="0 0 24 24"><path d="M5 3h10a2 2 0 0 1 2 2v1h-2V5H5v10h1v2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm0 2v10h10V9H9Zm1.6 4.6 1.4-1.4 1.6 1.6 3.4-3.4 1.4 1.4-4.8 4.8-3-3Z"/></svg>';
const ICON_PLAYLISTS = '<svg viewBox="0 0 24 24"><path d="M3 5h13v2H3V5Zm0 4h13v2H3V9Zm0 4h8v2H3v-2Zm15-4v7.2a2.5 2.5 0 1 0 2 2.45V11h2V9h-4Z"/></svg>';
const ICON_CROP = '<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
const SWIPE_ICON_QUEUE = '<svg viewBox="0 0 24 24"><path d="M3 6h12v2H3V6Zm0 4h12v2H3v-2Zm0 4h8v2H3v-2Zm14-2h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3Z"/></svg>';
const SWIPE_ICON_REMOVE = '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7Zm3-3h6l1 2H8l1-2Zm-4 2h14v2H5V6Z"/></svg>';

attachSwipe(songList, ".song-row", () => selection ? null : ({
    direction: 1, label: "Add to queue", icon: SWIPE_ICON_QUEUE, className: "swipe-reveal-queue",
    onCommit: (row) => { const song = songForRow(row); if (song) addSongToQueue(song); }
}));
attachSwipe(npQueueList, ".mini-song-row", () => ({
    direction: -1, label: "Remove", icon: SWIPE_ICON_REMOVE, className: "swipe-reveal-remove",
    onCommit: (row) => removeFromQueue(Number(row.dataset.index))
}));

// ── TOAST ──
// Optional action button (e.g. Undo). A toast that gets replaced before its action
// is used simply expires (onExpire runs) — only the latest one can be acted on.
let toastTimer = null, toastAction = null, toastExpire = null;
function showToast(text, opts = {}) {
    let el = $("toast");
    if (!el) {
        el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status");
        el.innerHTML = '<span class="toast-text"></span><button type="button" class="toast-action" hidden></button>';
        document.body.appendChild(el);
        el.querySelector(".toast-action").addEventListener("click", () => {
            const action = toastAction; toastAction = null; toastExpire = null;
            clearTimeout(toastTimer); el.classList.remove("show");
            if (action) action();
        });
    }
    if (toastExpire) { const expire = toastExpire; toastExpire = null; expire(); }
    el.querySelector(".toast-text").textContent = text;
    const btn = el.querySelector(".toast-action");
    btn.textContent = opts.action || ""; btn.hidden = !opts.action;
    toastAction = opts.onAction || null; toastExpire = opts.onExpire || null;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove("show"); toastAction = null;
        if (toastExpire) { const expire = toastExpire; toastExpire = null; expire(); }
    }, opts.duration || (opts.action ? 6000 : 1800));
}
function toastHasAction() { return !!toastAction; }

// ── UNDO ──
// Removing a song, deleting a playlist or clearing the queue can be undone for a few
// seconds. The media involved is protected from clean-up until the offer expires.
function offerUndo(message, restore, protectIds = []) {
    const ids = protectIds.filter(Boolean);
    ids.forEach((id) => undoProtectedIds.add(id));
    const release = () => ids.forEach((id) => undoProtectedIds.delete(id));
    showToast(message, {
        action: "Undo",
        onAction: async () => { release(); await restore(); showToast("Restored"); },
        onExpire: () => { release(); gcUnreferencedBlobs(); }
    });
}
async function removeFromQueue(index) {
    const [item] = queue.splice(index, 1); if (!item) return;
    await saveLibrary(); renderQueue();
    offerUndo(`Removed from queue · ${item.song.title}`, async () => {
        queue.splice(Math.min(index, queue.length), 0, item);
        await saveLibrary(); renderQueue();
    }, [item.song.mediaId, item.song.artId]);
}
async function clearQueue() {
    if (!queue.length) return;
    const saved = queue.slice();
    queue = []; await saveLibrary(); renderQueue();
    offerUndo(`Cleared ${saved.length} ${saved.length === 1 ? "song" : "songs"} from the queue`, async () => {
        queue = saved.concat(queue); await saveLibrary(); renderQueue();
    }, saved.flatMap((i) => [i.song?.mediaId, i.song?.artId]));
}

// ── SIDEBAR / QUEUE PANEL TOGGLES ──
function setSidebarCollapsed(collapsed) {
    if (!sidebar) return;
    sidebar.classList.toggle("collapsed", collapsed);
    setIcon(toggleSidebarBtn, collapsed ? ICONS.panelRight : ICONS.panelLeft, collapsed ? "Expand sidebar" : "Collapse sidebar");
    try { localStorage.setItem("spootify-sidebar-collapsed", collapsed ? "1" : "0"); } catch {}
    setTimeout(() => { if (selection) placeSelectBar(); }, 350); // after the panel's slide
}
if (toggleSidebarBtn) toggleSidebarBtn.addEventListener("click", () => setSidebarCollapsed(!sidebar.classList.contains("collapsed")));
function setQueueHidden(hidden) {
    document.body.classList.toggle("queue-hidden", hidden);
    if (queueToggleBtn) { setIcon(queueToggleBtn, ICONS.queue, hidden ? "Show queue" : "Hide queue"); queueToggleBtn.classList.toggle("is-active", !hidden); }
    try { localStorage.setItem("spootify-queue-hidden", hidden ? "1" : "0"); } catch {}
    setTimeout(() => { if (selection) placeSelectBar(); }, 350); // after the panel's slide
    if (!hidden) renderQueue();
}
if (queueToggleBtn) queueToggleBtn.addEventListener("click", () => setQueueHidden(!document.body.classList.contains("queue-hidden")));

// ── NAVIGATION ──
// One scroll area serves both views, so Home's scroll position is remembered and a
// playlist always opens at its top.
let homeScrollTop = 0;
function showView(view) {
    const target = view === playlistView ? playlistView : homeDashboard;
    setTimeout(updateTopNav, 0);
    if (target !== playlistView) endSelection();
    const other = target === playlistView ? homeDashboard : playlistView;
    const wasHidden = target && target.style.display === "none";
    if (other && other.style.display !== "none" && other === homeDashboard && mainContent) homeScrollTop = mainContent.scrollTop;
    if (other) other.style.display = "none";
    if (target) {
        target.style.display = "block";
        if (wasHidden) {
            target.classList.remove("view-enter"); void target.offsetWidth; target.classList.add("view-enter");
            // The class also staggers the cards and rows in (Extra animations); dropped
            // afterwards so later re-renders don't replay it.
            clearTimeout(target._enterTimer); target._enterTimer = setTimeout(() => target.classList.remove("view-enter"), 700);
        }
    }
    if (mainContent && wasHidden) mainContent.scrollTop = target === homeDashboard ? homeScrollTop : 0;
    setBottomNavActive(target === homeDashboard ? "home" : null);
}
function showHome() {
    showView(homeDashboard);
    if (homeBtn) homeBtn.classList.add("active");
    updateSidebarActive(null);
    applyViewTint();
    updateJumpButton();
}
function setBottomNavActive(tab) {
    if (mobileBottomNav) mobileBottomNav.querySelectorAll(".bottom-nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
}
if (homeBtn) homeBtn.addEventListener("click", showHome);
if (backToHomeBtn) backToHomeBtn.addEventListener("click", showHome);


// ── MODAL ──
let editSongRef = null, modalBusy = false, pendingTags = null;
function setModalBusy(busy) {
    modalBusy = busy;
    if (modalSubmitBtn) modalSubmitBtn.disabled = busy;
    if (modalCancelBtn) modalCancelBtn.disabled = busy;
}
function setModalProgress(fraction, text) {
    const box = $("modal-progress"); if (!box) return;
    box.style.display = fraction === null ? "none" : "flex";
    if (fraction !== null) { $("modal-progress-fill").style.width = Math.round(clamp(fraction, 0, 1) * 100) + "%"; setText($("modal-progress-text"), text || ""); }
}
function openModal(mode, trackId = null, opts = {}) {
    if (!modalOverlay || !modalForm) return;
    modalMode = mode; modalOverlay.style.display = "flex"; modalForm.reset();
    editSongRef = null; pendingTags = null; setModalBusy(false); setModalProgress(null);
    $("group-1").style.display = "flex"; input1.required = mode !== "song";
    if (modalSubmitBtn) modalSubmitBtn.textContent = "Save";
    if (mode === "playlist") {
        modalTitle.textContent = "Create Playlist"; $("label-1").textContent = "Playlist Name:";
        group2.style.display = "none"; fileGroup1.style.display = "none"; fileGroup2.style.display = "block"; fileInputSong.required = false;
    } else if (mode === "editPlaylist") {
        activePlaylistName = opts.name || currentPlaylist; modalTitle.textContent = "Edit Playlist"; $("label-1").textContent = "Playlist Name:";
        group2.style.display = "none"; fileGroup1.style.display = "none"; fileGroup2.style.display = "block"; fileInputSong.required = false; input1.value = activePlaylistName || "";
    } else if (mode === "song") {
        modalTitle.textContent = "Add Songs"; $("label-1").textContent = "Song Title:"; $("label-2").textContent = "Artist/Author:";
        group2.style.display = "flex"; fileGroup1.style.display = "block"; fileGroup2.style.display = "block"; fileInputSong.required = true;
        setText($("file-hint"), "Pick one or more files. Title, artist and cover art are read from each file's tags.");
        if (modalSubmitBtn) modalSubmitBtn.textContent = "Add";
    } else if (mode === "edit") {
        const found = findSongById(trackId);
        editSongRef = found ? found.song : null; activeTrackId = trackId;
        modalTitle.textContent = "Edit Track Details"; $("label-1").textContent = "Update Title:"; $("label-2").textContent = "Update Artist:";
        group2.style.display = "flex"; fileGroup1.style.display = "none"; fileGroup2.style.display = "block"; fileInputSong.required = false;
        if (editSongRef) { input1.value = editSongRef.title; input2.value = editSongRef.artist; }
    }
    const artLabel = fileGroup2 ? fileGroup2.querySelector("label") : null;
    if (artLabel) artLabel.textContent = mode === "edit" ? "New Cover Image (optional):" : mode === "song" ? "Cover Image (optional, overrides the file's):" : "Cover Image:";
    setTimeout(() => (mode === "song" ? modalSubmitBtn : input1)?.focus(), 50);
}
function closeModal() { if (modalOverlay) modalOverlay.style.display = "none"; setModalBusy(false); setModalProgress(null); }
if (createPlaylistBtn) createPlaylistBtn.addEventListener("click", () => openModal("playlist"));
if (addSongBtn) addSongBtn.addEventListener("click", () => openModal("song"));
if (modalCancelBtn) modalCancelBtn.addEventListener("click", () => { if (!modalBusy) closeModal(); });
if (modalOverlay) modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay && !modalBusy) closeModal(); });

function isAudioFile(f) { return !!f && (/^audio\//.test(f.type || "") || /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|wave|webm|weba|mp4|aif|aiff|wma)$/i.test(f.name || "")); }
async function readTags(file) {
    if (window.SpootifyTags) { try { return await window.SpootifyTags.read(file); } catch (e) { console.warn("Tag read failed", e); } }
    return { title: String(file.name || "Untitled").replace(/\.[^.]+$/, ""), artist: "", album: "", picture: null };
}
// Picking files fills in what the tags say, so there's nothing to type for one song
// and nothing to fill in at all for many.
if (fileInputSong) fileInputSong.addEventListener("change", async () => {
    if (modalMode !== "song") return;
    const files = [...fileInputSong.files], multi = files.length > 1;
    $("group-1").style.display = multi ? "none" : "flex";
    group2.style.display = multi ? "none" : "flex";
    fileGroup2.style.display = multi ? "none" : "block";
    setText($("file-hint"), multi ? `${files.length} files selected — title, artist and cover art come from each file's tags.` : "Title, artist and cover art are read from the file's tags. Edit them below if you like.");
    if (modalSubmitBtn) modalSubmitBtn.textContent = multi ? `Add ${files.length} songs` : "Add";
    pendingTags = null;
    if (files.length === 1) {
        const tags = await readTags(files[0]);
        if (modalMode !== "song" || fileInputSong.files[0] !== files[0]) return;
        pendingTags = { file: files[0], tags };
        if (!input1.value.trim()) input1.value = tags.title || "";
        if (!input2.value.trim()) input2.value = tags.artist || "";
    }
});

// Cheap content hash so an album's shared cover is stored once, not once per track.
async function blobHash(blob) {
    const b = new Uint8Array(await blob.arrayBuffer());
    let h = 2166136261 >>> 0;
    for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619) >>> 0; }
    return blob.size + ":" + h.toString(36);
}
async function createSongFromFile(file, meta, artCache) {
    const mediaId = await storeBlob(file);
    const fileSrc = await getBlobUrl(mediaId);
    let artId = null, art = DEFAULT_ART;
    if (meta.cover) {
        if (artCache && meta.coverKey && artCache.has(meta.coverKey)) artId = artCache.get(meta.coverKey);
        else { artId = await storeBlob(await shrinkCover(meta.cover)); if (artCache && meta.coverKey) artCache.set(meta.coverKey, artId); }
        art = (await getBlobUrl(artId)) || DEFAULT_ART;
    }
    const duration = await probeDuration(fileSrc, 0);
    return { id: newSongId(), title: meta.title, artist: meta.artist, timestamp: Date.now(), duration, mediaId, artId, fileSrc, art };
}
async function addFilesToPlaylist(files, playlistName, onProgress) {
    const pl = playlists[playlistName];
    if (!pl) return { added: 0, failed: files.length };
    noteActivity(`adding ${files.length} ${files.length === 1 ? "song" : "songs"} to a playlist of ${pl.songs.length}`);
    const artCache = new Map();
    let added = 0, failed = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (onProgress) onProgress(i, files.length, file.name);
        try {
            const tags = await readTags(file);
            const coverKey = tags.picture ? await blobHash(tags.picture) : null;
            const song = await createSongFromFile(file, { title: tags.title || file.name.replace(/\.[^.]+$/, ""), artist: tags.artist || "Unknown Artist", cover: tags.picture, coverKey }, artCache);
            (playlists[playlistName] || pl).songs.push(song); added++;
            if (added % 10 === 0) { await saveLibrary(); if (currentPlaylist === playlistName) renderSongs(); }
        } catch (e) { console.warn("Could not add", file.name, e); failed++; }
    }
    if (onProgress) onProgress(files.length, files.length, "");
    await saveLibrary(); renderPlaylists(); if (currentPlaylist === playlistName) renderSongs(); renderQueue();
    setTimeout(() => noteActivity(null), 15000); // a crash in the seconds after adding still counts
    return { added, failed };
}
function uniquePlaylistName(base) {
    const root = String(base || "").trim() || "New Playlist";
    const taken = (n) => Object.keys(playlists).some((k) => k.toLowerCase() === n.toLowerCase());
    let name = root, n = 2;
    while (taken(name) || name === LIKED_SOURCE) name = `${root} (${n++})`;
    return name;
}
async function createPlaylist(name, artId = null) {
    const artUrl = artId ? await getBlobUrl(artId) : DEFAULT_ART;
    normalizePlaylistOrder();
    playlists[name] = { name, songs: [], artId, art: artUrl || DEFAULT_ART, sort: defaultSort(), pinned: false, order: Object.keys(playlists).length };
    await saveLibrary(); renderPlaylists();
    return playlists[name];
}

if (modalForm) modalForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (modalBusy) return;
    try {
        if (modalMode === "playlist") {
            const name = input1.value.trim();
            if (!name) { await showMessage("Name required", "Enter a name for your playlist."); return; }
            const existing = Object.keys(playlists).find(k => k.toLowerCase() === name.toLowerCase());
            if (existing || name === LIKED_SOURCE) { await showMessage("Name taken", `"${existing || name}" already exists.`); return; }
            setModalBusy(true);
            let artId = null;
            if (fileInputArt.files[0]) artId = await storeBlob(await shrinkCover(fileInputArt.files[0]));
            await createPlaylist(name, artId);
            closeModal(); loadPlaylistPage(name);
        } else if (modalMode === "editPlaylist") {
            const oldName = activePlaylistName, newName = input1.value.trim();
            if (!oldName || !playlists[oldName]) return;
            if (!newName) { await showMessage("Name required", "Enter a name."); return; }
            const conflict = Object.keys(playlists).find(k => k.toLowerCase() === newName.toLowerCase() && k !== oldName);
            if (conflict || newName === LIKED_SOURCE) { await showMessage("Name taken", `"${conflict || newName}" already exists.`); return; }
            setModalBusy(true);
            let artId = playlists[oldName].artId;
            if (fileInputArt.files[0]) artId = await storeBlob(await shrinkCover(fileInputArt.files[0]));
            const artUrl = artId ? await getBlobUrl(artId) : playlists[oldName].art || DEFAULT_ART;
            if (newName !== oldName) {
                normalizePlaylistOrder(); // keep its place in the list once the key changes
                const updated = { ...playlists[oldName], name: newName, artId, art: artUrl };
                delete playlists[oldName]; playlists[newName] = updated;
                // Everything that remembers the playlist by name follows the rename.
                for (const item of queue) if (item.playlistName === oldName) item.playlistName = newName;
                for (const h of playbackHistory) if (h.source === oldName) h.source = newName;
                if (contextSource === oldName) contextSource = newName;
                if (customOrderSource === oldName) customOrderSource = newName;
                if (currentTrackSource === oldName) currentTrackSource = newName;
                sortedCache.delete(oldName);
            } else Object.assign(playlists[oldName], { artId, art: artUrl });
            currentPlaylist = newName;
            await saveLibrary(); renderPlaylists(); loadPlaylistPage(newName); renderQueue(); closeModal();
            if (currentTrack) showTrackInfo(currentTrack, currentTrackSource);
            gcUnreferencedBlobs();
        } else if (modalMode === "song") {
            const files = [...fileInputSong.files].filter(isAudioFile);
            if (!files.length) { await showMessage("No audio", "Choose one or more audio files."); return; }
            const target = currentPlaylist;
            if (!playlists[target]) return;
            setModalBusy(true);
            if (files.length === 1) {
                const file = files[0];
                const tags = pendingTags && pendingTags.file === file ? pendingTags.tags : await readTags(file);
                const song = await createSongFromFile(file, {
                    title: input1.value.trim() || tags.title || file.name.replace(/\.[^.]+$/, ""),
                    artist: input2.value.trim() || tags.artist || "Unknown Artist",
                    cover: fileInputArt.files[0] || tags.picture || null
                });
                noteActivity(`adding a song to a playlist of ${playlists[target].songs.length}`);
                playlists[target].songs.push(song);
                await saveLibrary(); renderSongs(); renderPlaylists(); renderQueue(); closeModal();
                setTimeout(() => noteActivity(null), 15000);
                showToast(`Added · ${song.title}`);
            } else {
                const res = await addFilesToPlaylist(files, target, (i, n, name) => setModalProgress(i / n, i < n ? `Adding ${i + 1} of ${n} · ${name}` : "Saving…"));
                closeModal();
                showToast(res.failed ? `Added ${res.added} songs · ${res.failed} couldn't be read` : `Added ${res.added} songs`);
            }
        } else if (modalMode === "edit") {
            const song = editSongRef;
            if (song) {
                song.title = input1.value.trim() || song.title; song.artist = input2.value.trim() || "Unknown Artist";
                if (fileInputArt.files[0]) { song.artId = await storeBlob(await shrinkCover(fileInputArt.files[0])); song.art = (await getBlobUrl(song.artId)) || DEFAULT_ART; delete song.thumbId; delete song.coverCrop; }
                propagateSongEdit(song);
                // The playing track may be this song or one of its copies; refresh the player bar / lock-screen art.
                if (currentTrack && (currentTrack.id === song.id || currentTrack.mediaId === song.mediaId)) { showTrackInfo(currentTrack, currentTrackSource); updateMediaSessionMetadata(); }
            }
            await saveLibrary(); renderSongs(); renderPlaylists(); renderQueue(); closeModal();
            gcUnreferencedBlobs();
        }
    } catch (err) { console.error("Modal Submit Error", err); showToast("Something went wrong — nothing was changed"); }
    finally { setModalBusy(false); setModalProgress(null); }
});

// ── DRAG & DROP FILES ──
// Drop audio files anywhere on the window: they go into the open playlist, or you
// pick (or create) one. Internal drags (playlist cards) carry no files and are ignored.
let fileDragDepth = 0;
const dropOverlay = $("drop-overlay");
function dragHasFiles(e) { return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"); }
function openPlaylistForDrop() { return playlistView && playlistView.style.display !== "none" && playlists[currentPlaylist] ? currentPlaylist : null; }
window.addEventListener("dragenter", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault(); fileDragDepth++;
    if (!dropOverlay || isMobile()) return;
    const target = openPlaylistForDrop();
    setText($("drop-title"), target ? `Drop to add to "${target}"` : "Drop to add songs");
    dropOverlay.hidden = false;
});
window.addEventListener("dragover", (e) => { if (dragHasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
window.addEventListener("dragleave", (e) => {
    if (!dragHasFiles(e)) return;
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (!fileDragDepth && dropOverlay) dropOverlay.hidden = true;
});
window.addEventListener("drop", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault(); fileDragDepth = 0;
    if (dropOverlay) dropOverlay.hidden = true;
    handleDroppedFiles(Array.from(e.dataTransfer.files || []));
});
async function handleDroppedFiles(files) {
    const audio = files.filter(isAudioFile);
    if (!audio.length) { showToast("No audio files in what you dropped"); return; }
    const target = openPlaylistForDrop() || await pickPlaylistFor(audio);
    if (!target) return;
    showToast(`Adding ${audio.length} ${audio.length === 1 ? "song" : "songs"}…`, { duration: 600000 });
    const res = await addFilesToPlaylist(audio, target, (i, n) => { const t = document.querySelector("#toast .toast-text"); if (t && i < n) t.textContent = `Adding ${i + 1} of ${n} to ${target}…`; });
    const msg = `Added ${res.added} ${res.added === 1 ? "song" : "songs"} to ${target}${res.failed ? ` · ${res.failed} failed` : ""}`;
    if (currentPlaylist === target && playlistView.style.display !== "none") showToast(msg);
    else showToast(msg, { action: "Open", onAction: () => loadPlaylistPage(target) });
}
// Ask where dropped songs should go: an existing playlist or a new one (named after
// the album when the tags have one).
function pickPlaylistFor(files) {
    return new Promise((resolve) => {
        const overlay = $("pick-playlist-overlay"), select = $("pick-select"), nameInput = $("pick-new-name"), newGroup = $("pick-new-group");
        if (!overlay) { resolve(null); return; }
        const names = getOrderedPlaylistNames();
        select.innerHTML = `<option value="__new__">+ New playlist</option>` + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
        select.value = "__new__";
        nameInput.value = "";
        setText($("pick-title"), `Add ${files.length} ${files.length === 1 ? "song" : "songs"}`);
        const sync = () => { newGroup.style.display = select.value === "__new__" ? "flex" : "none"; };
        sync();
        readTags(files[0]).then((t) => { if (!nameInput.value && t && t.album) nameInput.placeholder = t.album; });
        nameInput.placeholder = "New Playlist";
        overlay.style.display = "flex";
        setTimeout(() => (select.value === "__new__" ? nameInput : select).focus(), 50);
        const done = (value) => {
            overlay.style.display = "none";
            select.removeEventListener("change", sync);
            $("pick-ok-btn").removeEventListener("click", onOk);
            $("pick-cancel-btn").removeEventListener("click", onCancel);
            overlay.removeEventListener("click", onOverlay);
            nameInput.removeEventListener("keydown", onKey);
            resolve(value);
        };
        const onOk = async () => {
            if (select.value !== "__new__") { done(select.value); return; }
            const name = uniquePlaylistName(nameInput.value.trim() || (nameInput.placeholder !== "New Playlist" ? nameInput.placeholder : "") || "New Playlist");
            await createPlaylist(name);
            done(name);
        };
        const onCancel = () => done(null);
        const onOverlay = (e) => { if (e.target === overlay) done(null); };
        const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); onOk(); } };
        select.addEventListener("change", sync);
        $("pick-ok-btn").addEventListener("click", onOk);
        $("pick-cancel-btn").addEventListener("click", onCancel);
        overlay.addEventListener("click", onOverlay);
        nameInput.addEventListener("keydown", onKey);
    });
}

// ── SEARCH ──
function setupSearch(input, clearBtn, filterFn) {
    if (!input || !clearBtn) return;
    let debounceTimer;
    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        clearBtn.style.display = input.value ? "flex" : "none";
        debounceTimer = setTimeout(() => filterFn(input.value.trim().toLowerCase()), 80);
    });
    clearBtn.addEventListener("click", () => { input.value = ""; clearBtn.style.display = "none"; filterFn(""); input.focus(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { e.stopPropagation(); input.value = ""; clearBtn.style.display = "none"; filterFn(""); } });
}
// Home search looks through every song and artist in the library, not just playlist
// names. Accents and case don't matter; every word typed has to match.
const searchHayCache = new WeakMap();
function songHaystack(s) {
    let c = searchHayCache.get(s);
    if (!c || c.t !== s.title || c.a !== s.artist) { c = { t: s.title, a: s.artist, title: normalizeText(s.title), artist: normalizeText(s.artist) }; searchHayCache.set(s, c); }
    return c;
}
function searchLibrary(query) {
    const terms = normalizeText(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return { songs: [], artists: [] };
    const seen = new Set(), songs = [], artists = new Map();
    for (const name of getOrderedPlaylistNames()) {
        for (const s of playlists[name].songs || []) {
            const h = songHaystack(s), both = h.title + " " + h.artist, key = statsKeyFor(s);
            if (!seen.has(key) && terms.every((t) => both.includes(t))) {
                seen.add(key);
                const score = h.title.startsWith(terms[0]) ? 4 : terms.every((t) => h.title.includes(t)) ? 3 : h.artist.startsWith(terms[0]) ? 2 : 1;
                songs.push({ song: s, playlistName: name, score });
            }
            if (terms.every((t) => h.artist.includes(t))) {
                const ak = artistKey(s.artist);
                let a = artists.get(ak);
                if (!a) artists.set(ak, a = { name: s.artist || "Unknown Artist", keys: new Set(), art: null, score: h.artist.startsWith(terms[0]) ? 2 : 1 });
                a.keys.add(key);
                if (!a.art && s.art && s.art !== DEFAULT_ART) a.art = s.art;
            }
        }
    }
    songs.sort((a, b) => b.score - a.score || cmpText(a.song.title, b.song.title));
    const artistList = [...artists.values()].sort((a, b) => b.score - a.score || b.keys.size - a.keys.size || cmpText(a.name, b.name));
    return { songs, artists: artistList };
}
let searchShowAll = false;
function filterHomePlaylists(query) { homeQuery = normalizeText(query); searchShowAll = false; renderHomeSearch(); }
function renderHomeSearch() {
    const q = homeQuery, searching = !!q, terms = q.split(/\s+/).filter(Boolean);
    let visibleCards = 0;
    if (playlistGrid) playlistGrid.querySelectorAll(".playlist-card").forEach((card) => {
        const name = normalizeText(card.querySelector(".card-title")?.textContent);
        const vis = !searching || terms.every((t) => name.includes(t));
        card.style.display = vis ? "" : "none";
        if (vis) visibleCards++;
    });
    if (playlistsHeading) { playlistsHeading.textContent = searching ? "Playlists" : "Your playlists"; playlistsHeading.hidden = !visibleCards; }
    syncPlaylistSortButton();
    if (statsCard) statsCard.hidden = searching || !appearance.showStats;
    renderSongOfDay();
    const shelves = $("home-shelves"); if (shelves) shelves.hidden = searching;
    if (!searching) { if (searchResultsEl) searchResultsEl.hidden = true; if (noSearchResults) noSearchResults.style.display = "none"; return; }
    const { songs, artists } = searchLibrary(q);
    const artistsEl = $("search-artists"), songsEl = $("search-songs");
    $("search-artists-section").hidden = !artists.length;
    artistsEl.innerHTML = artists.slice(0, 12).map((a) => `<button type="button" class="artist-chip" data-artist="${escapeHtml(a.name)}"><img src="${escapeHtml(a.art || DEFAULT_ART)}" alt="" loading="lazy"><strong>${escapeHtml(a.name)}</strong><span>${a.keys.size} ${a.keys.size === 1 ? "song" : "songs"}</span></button>`).join("");
    $("search-songs-section").hidden = !songs.length;
    const limit = searchShowAll ? 200 : (isMobile() ? 6 : 8);
    songsEl.innerHTML = songs.slice(0, limit).map(({ song, playlistName }, i) => `<div class="stats-row search-row" data-key="${escapeHtml(statsKeyFor(song))}" data-id="${song.id}" data-playlist="${escapeHtml(playlistName)}">
        <img src="${escapeHtml(song.art || DEFAULT_ART)}" alt="" loading="lazy">
        <div class="stats-row-info"><strong>${escapeHtml(song.title || "Unknown")}</strong><span>${escapeHtml(song.artist || "Unknown Artist")} · ${escapeHtml(playlistName)}</span></div>
        <div class="stats-row-nums">${formatTime(song.duration)}</div>
        <button type="button" class="dots-trigger-btn" aria-label="More options">${ICONS.dots}</button></div>`).join("");
    const more = $("search-more-btn");
    if (more) { more.hidden = songs.length <= limit; more.textContent = `Show all ${songs.length} songs`; }
    if (searchResultsEl) searchResultsEl.hidden = !(songs.length || artists.length);
    if (noSearchResults) noSearchResults.style.display = !songs.length && !artists.length && !visibleCards ? "flex" : "none";
    updatePlayingIndicators();
}
function searchHit(e) {
    const row = e.target.closest(".search-row"); if (!row) return null;
    const pl = row.dataset.playlist, id = Number(row.dataset.id);
    const song = (playlists[pl]?.songs || []).find((s) => s.id === id) || findSongById(id)?.song;
    return song ? { song, playlistName: playlists[pl] ? pl : findSongById(id)?.playlistName } : null;
}
if ($("search-songs")) {
    $("search-songs").addEventListener("click", (e) => {
        const hit = searchHit(e); if (!hit) return;
        if (e.target.closest(".dots-trigger-btn")) { e.stopPropagation(); openSongMenu(hit.song, hit.playlistName, e.clientX, e.clientY); return; }
        playSong(hit.song, hit.playlistName);
    });
    $("search-songs").addEventListener("contextmenu", (e) => { const hit = searchHit(e); if (!hit) return; e.preventDefault(); openSongMenu(hit.song, hit.playlistName, e.clientX, e.clientY); });
}
if ($("search-artists")) $("search-artists").addEventListener("click", (e) => { const chip = e.target.closest(".artist-chip"); if (chip) openArtistPage(chip.dataset.artist); });
if ($("search-more-btn")) $("search-more-btn").addEventListener("click", () => { searchShowAll = true; renderHomeSearch(); });
function filterPlaylistSongs(query) {
    if (!songList) return;
    const terms = normalizeText(query).split(/\s+/).filter(Boolean);
    songList.querySelectorAll(".song-row").forEach((row) => {
        const text = normalizeText((row.querySelector(".col-title div")?.textContent || "") + " " + (row.querySelector(".col-title span")?.textContent || ""));
        row.style.display = !terms.length || terms.every((t) => text.includes(t)) ? "" : "none";
    });
}
setupSearch(homeSearch, homeSearchClear, filterHomePlaylists);
setupSearch(playlistSearch, playlistSearchClear, filterPlaylistSongs);

// ── RENDER PLAYLISTS ──
function updateSidebarActive(name) {
    if (!playlistLinks) return;
    playlistLinks.querySelectorAll(".sidebar-playlist-item").forEach((item) => { item.classList.toggle("active", item.dataset.name === name); });
    if (homeBtn) homeBtn.classList.toggle("active", !name);
}
// A playlist without its own cover shows a 2x2 mosaic of its songs' artwork
// (or the one piece of art it has).
function autoCoverArts(pl) {
    const out = [], seen = new Set();
    for (const s of pl?.songs || []) {
        const a = s.art;
        if (!a || a === DEFAULT_ART || seen.has(s.artId || a)) continue;
        seen.add(s.artId || a); out.push(a);
        if (out.length >= 4) break;
    }
    return out;
}
function playlistCoverHtml(name) {
    if (isLikedSource(name)) return `<div class="liked-cover">${ICONS.likedTile}</div>`;
    const pl = playlists[name];
    if (pl && pl.art && pl.art !== DEFAULT_ART) return `<img src="${escapeHtml(pl.art)}" alt="" loading="lazy">`;
    const arts = autoCoverArts(pl);
    if (arts.length >= 4) return `<div class="cover-mosaic">${arts.map((a) => `<img src="${escapeHtml(a)}" alt="" loading="lazy">`).join("")}</div>`;
    return `<img src="${escapeHtml(arts[0] || DEFAULT_ART)}" alt="" loading="lazy">`;
}
function sidebarItem(key, label, count, pinned) {
    const li = document.createElement("li");
    li.className = "sidebar-playlist-item" + (pinned ? " pinned" : ""); li.dataset.name = key;
    li.title = label; // the icon rail shows only the cover
    const star = pinned ? `<span class="pin-star" title="Pinned">${ICONS.star}</span>` : "";
    li.innerHTML = `<div class="sidebar-cover">${playlistCoverHtml(key)}</div><div class="sidebar-pl-info"><span class="sidebar-pl-name">${star}${escapeHtml(label)}</span><span class="sidebar-pl-count">${count} ${count === 1 ? "song" : "songs"}</span></div><span class="now-icon" title="Playing from here">${ICONS.speaker}</span>`;
    li.addEventListener("click", () => loadPlaylistPage(key));
    if (!isLikedSource(key)) li.addEventListener("contextmenu", (e) => { e.preventDefault(); openPlaylistMenu(key, e.clientX, e.clientY); });
    return li;
}
function playlistCard(key, label, count, pinned) {
    const liked = isLikedSource(key);
    const card = document.createElement("div");
    card.className = "playlist-card" + (pinned ? " pinned" : "") + (liked ? " liked-card" : ""); card.dataset.name = key;
    const menu = liked ? "" : `<button class="playlist-card-menu dots-trigger-btn" data-playlist="${escapeHtml(key)}" aria-label="Playlist options">${ICONS.dots}</button>`;
    card.innerHTML = `${menu}<button class="playlist-card-play" data-playlist="${escapeHtml(key)}" aria-label="Play ${escapeHtml(label)}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7-11-7Z"/></svg></button>${pinned ? `<span class="card-pin-badge">${ICONS.star}</span>` : ""}<div class="card-cover">${playlistCoverHtml(key)}</div><div class="card-title">${escapeHtml(label)}</div><div class="card-subtitle">${count} ${count === 1 ? "song" : "songs"}</div>`;
    card.addEventListener("click", (e) => { if (!e.target.closest(".playlist-card-menu") && !e.target.closest(".playlist-card-play")) loadPlaylistPage(key); });
    if (liked) return card;
    card.draggable = true;
    // Desktop: drag a card onto another to reorder (mobile uses Move up/down in the menu).
    card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/spootify-playlist", key); e.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); });
    card.addEventListener("dragend", () => { card.classList.remove("dragging"); playlistGrid.querySelectorAll(".drop-target").forEach((c) => c.classList.remove("drop-target")); });
    card.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/spootify-playlist")) { e.preventDefault(); card.classList.add("drop-target"); } });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", (e) => { e.preventDefault(); card.classList.remove("drop-target"); const from = e.dataTransfer.getData("text/spootify-playlist"); if (from) movePlaylistTo(from, key); });
    card.addEventListener("contextmenu", (e) => { e.preventDefault(); openPlaylistMenu(key, e.clientX, e.clientY); });
    return card;
}
function renderPlaylists() {
    if (!playlistLinks || !playlistGrid) return;
    playlistLinks.innerHTML = ""; playlistGrid.innerHTML = "";
    const names = getDisplayPlaylistNames(), likedCount = getLikedSongs().length;
    if (noPlaylistsMsg) noPlaylistsMsg.style.display = names.length === 0 ? "flex" : "none";
    const sidebarFrag = document.createDocumentFragment(), gridFrag = document.createDocumentFragment();
    sidebarFrag.appendChild(sidebarItem(LIKED_SOURCE, "Liked Songs", likedCount, false));
    if (names.length || likedCount) gridFrag.appendChild(playlistCard(LIKED_SOURCE, "Liked Songs", likedCount, false));
    names.forEach((name) => {
        const pl = playlists[name], count = pl.songs.length;
        sidebarFrag.appendChild(sidebarItem(name, name, count, !!pl.pinned));
        gridFrag.appendChild(playlistCard(name, name, count, !!pl.pinned));
    });
    playlistLinks.appendChild(sidebarFrag); playlistGrid.appendChild(gridFrag);
    updateSidebarActive(playlistView && playlistView.style.display !== "none" ? currentPlaylist : null);
    updateNowSourceIndicators();
    if (homeQuery) renderHomeSearch(); else if (playlistsHeading) playlistsHeading.hidden = !(names.length || likedCount);
    if (playlistView && playlistView.style.display !== "none") renderPlaylistHeaderCover();
    syncPlaylistSortButton();
    scheduleShelves();
}
// The playlist that's playing gets a speaker icon in the sidebar and an accent title on its card.
function updateNowSourceIndicators() {
    const src = currentTrack ? (contextSource || currentTrackSource) : null;
    document.querySelectorAll(".sidebar-playlist-item, .playlist-card").forEach((el) => el.classList.toggle("now-source", !!src && el.dataset.name === src));
}
function playCollection(name) {
    const songs = getPlaylistSongsSorted(name);
    if (songs.length) playSong(pickStartSong(songs), name);
    else if (isLikedSource(name)) showToast("Like some songs first — tap the heart on any song");
}

function renderPlaylistHeaderCover() {
    const wrap = $("playlist-cover-wrap");
    if (wrap && viewExists(currentPlaylist)) wrap.innerHTML = playlistCoverHtml(currentPlaylist);
}
function loadPlaylistPage(name) {
    if (!viewExists(name)) return;
    const liked = isLikedSource(name);
    const changed = currentPlaylist !== name || !playlistView || playlistView.style.display === "none";
    if (changed) endSelection();
    currentPlaylist = name;
    try { localStorage.setItem("spootify-current-playlist", name); } catch {}
    showView(playlistView);
    if (currentPlaylistName) currentPlaylistName.textContent = liked ? "Liked Songs" : name;
    renderPlaylistHeaderCover();
    if (addSongBtn) addSongBtn.hidden = liked;
    if (importLinkBtn) importLinkBtn.hidden = liked || !ytBackend.available;
    if (playlistOptionsBtn) playlistOptionsBtn.hidden = liked;
    if (changed && playlistSearch) { playlistSearch.value = ""; playlistSearchClear.style.display = "none"; }
    if (changed && mainContent) mainContent.scrollTop = 0;
    updateSidebarActive(name); renderSongs(); renderQueue();
    applyViewTint();
    const songs = liked ? getLikedSongs() : playlists[name].songs || [];
    hydrateSongArt(songs).then((c) => { if (c && currentPlaylist === name) { renderSongs(); renderPlaylistHeaderCover(); applyViewTint(); } });
}

function songRowHtml(song, i, playingKeyMatch) {
    const liked = isLiked(song), playing = rowMatchesCurrent(song, playingKeyMatch);
    const key = statsKeyFor(song);
    return `<div class="song-row${playing ? " playing" : ""}" data-id="${song.id}" data-key="${escapeHtml(key)}">
            <div class="col-num"><span class="track-index">${i + 1}</span><span class="eq-bars" aria-hidden="true"><i></i><i></i><i></i></span><button class="row-play-btn" data-id="${song.id}" aria-label="Play">${playing && isAudiblyPlaying() ? ICONS.pause : ICONS.play}</button></div>
            <div class="col-img-space"><img src="${escapeHtml(song.art || DEFAULT_ART)}" alt="" loading="lazy" decoding="async"></div>
            <div class="col-title"><div title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div><span>${artistLinkHtml(song.artist)}${rowStarsHtml(song)}</span></div>
            <div class="col-date">${getRelativeTimeString(song.timestamp)}</div>
            <div class="col-like"><button class="like-btn${liked ? " liked" : ""}" data-id="${song.id}" aria-label="${liked ? "Remove from" : "Save to"} Liked Songs" title="${liked ? "Remove from" : "Save to"} Liked Songs">${liked ? ICONS.heartFill : ICONS.heart}</button></div>
            <div class="col-length">${formatTime(song.duration)}</div>
            <div class="col-dots"><button class="dots-trigger-btn" data-id="${song.id}" aria-label="More options">${ICONS.dots}</button></div>
        </div>`;
}
// Real playlists match the playing song by id; Liked Songs (one row per media) by media.
function rowMatchesCurrent(song, byKey) {
    if (!currentTrack || !song) return false;
    if (song.id === currentTrack.id) return true;
    return !!byKey && statsKeyFor(song) === statsKeyFor(currentTrack);
}
function renderSongs() {
    if (!songList) return;
    updateSortHeader();
    const songs = getCurrentPlaylistSongs();
    const totalSeconds = songs.reduce((acc, s) => acc + (s.duration || 0), 0);
    if (playlistStatsSongs) playlistStatsSongs.textContent = `${songs.length} ${songs.length === 1 ? "song" : "songs"}`;
    if (playlistStatsDuration) playlistStatsDuration.textContent = formatMusicLength(totalSeconds);
    if (songs.length === 0) {
        songList.innerHTML = isLikedSource(currentPlaylist)
            ? '<div class="empty-state"><p>Songs you like will appear here</p><span>Tap the heart on any song to save it.</span></div>'
            : '<div class="empty-state"><p>No songs yet</p><span>Add songs &mdash; or drop audio files here</span></div>';
        updateJumpButton();
        return;
    }
    const byKey = isVirtualSource(currentPlaylist);
    songList.innerHTML = songs.map((song, i) => songRowHtml(song, i, byKey)).join("");
    if (playlistSearch && playlistSearch.value.trim()) filterPlaylistSongs(playlistSearch.value.trim());
    if (selection) renderSelection();
    updateJumpButton();
}
function songForRow(row) {
    if (!row) return null;
    const id = Number(row.dataset.id);
    return getCurrentPlaylistSongs().find((s) => s.id === id) || findSongById(id)?.song || null;
}
// The real playlist a song lives in (for Liked Songs rows, the first one that has it).
function homePlaylistOf(song) {
    if (playlists[currentPlaylist] && (playlists[currentPlaylist].songs || []).includes(song)) return currentPlaylist;
    return findSongById(song.id)?.playlistName || null;
}
async function playRowSong(row, forcePlay = false) {
    const song = songForRow(row); if (!song) return;
    if (forcePlay && currentTrack && currentTrack.id === song.id) { if (!isAudiblyPlaying()) safePlay(); return; }
    await playSong(song, currentPlaylist);
}
if (songList) {
    songList.addEventListener("click", (e) => {
        const selRow = e.target.closest(".song-row");
        if (selRow && (selection || (!isMobile() && (e.ctrlKey || e.metaKey || e.shiftKey) && !e.target.closest("button")))) {
            e.stopPropagation();
            if (!selection) startSelection(null);
            toggleSelected(Number(selRow.dataset.id), e.shiftKey);
            return;
        }
        const like = e.target.closest(".like-btn");
        if (like) { e.stopPropagation(); const song = songForRow(like.closest(".song-row")); if (song) toggleLike(song, like); return; }
        const playBtn = e.target.closest(".row-play-btn");
        if (playBtn) { playRowSong(playBtn.closest(".song-row")); return; }
        const dots = e.target.closest(".dots-trigger-btn");
        if (dots) { e.stopPropagation(); const song = songForRow(dots.closest(".song-row")); if (song) openSongMenu(song, currentPlaylist, e.clientX, e.clientY); return; }
        if (e.target.closest(".artist-link")) return;
        if (isMobile()) { const row = e.target.closest(".song-row"); if (row) playRowSong(row); }
    });
    // Desktop: double-click a row to play it, right-click for its menu.
    songList.addEventListener("dblclick", (e) => {
        if (selection || isMobile() || e.target.closest("button")) return;
        const row = e.target.closest(".song-row"); if (row) playRowSong(row, true);
    });
    songList.addEventListener("contextmenu", (e) => {
        const row = e.target.closest(".song-row"); if (!row) return;
        e.preventDefault();
        if (selection) { toggleSelected(Number(row.dataset.id)); return; } // long-press while selecting ticks it
        const song = songForRow(row); if (song) openSongMenu(song, currentPlaylist, e.clientX, e.clientY);
    });
}

// ── SELECT SONGS ── pick several songs in the open playlist and act on them at once.
// Start from a song's ⋯ menu ("Select songs"), the playlist's ⋯ menu, or on a computer
// with Ctrl/⌘-click (Shift-click picks a range). While selecting, tapping a row ticks it.
let selection = null; // { ids: Set<song id>, anchor: song id } while selecting
const selectBar = $("select-bar");
function isSelecting() { return !!selection; }
function startSelection(songId) {
    if (!playlistView || playlistView.style.display === "none") return;
    selection = { ids: new Set(songId != null ? [songId] : []), anchor: songId ?? null };
    document.body.classList.add("selecting");
    haptic(12);
    renderSelection();
}
function endSelection() {
    if (!selection) return;
    selection = null;
    document.body.classList.remove("selecting");
    if (songList) songList.querySelectorAll(".song-row.selected").forEach((r) => r.classList.remove("selected"));
    if (selectBar) selectBar.hidden = true;
    updateJumpButton();
}
function selectedSongs() {
    if (!selection) return [];
    return getCurrentPlaylistSongs().filter((s) => selection.ids.has(s.id)); // in the order you see them
}
function toggleSelected(id, range) {
    if (!selection) return;
    if (range && selection.anchor != null) {
        const songs = getCurrentPlaylistSongs(), a = songs.findIndex((s) => s.id === selection.anchor), b = songs.findIndex((s) => s.id === id);
        if (a !== -1 && b !== -1) { for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selection.ids.add(songs[i].id); renderSelection(); return; }
    }
    if (selection.ids.has(id)) selection.ids.delete(id); else selection.ids.add(id);
    selection.anchor = id;
    renderSelection();
}
function renderSelection() {
    if (!selection) { if (selectBar) selectBar.hidden = true; return; }
    if (songList) songList.querySelectorAll(".song-row").forEach((r) => r.classList.toggle("selected", selection.ids.has(Number(r.dataset.id))));
    const songs = selectedSongs(), n = songs.length, liked = isLikedSource(currentPlaylist);
    if (!selectBar) return;
    selectBar.hidden = false;
    placeSelectBar();
    setText($("select-count"), `${n} selected`);
    const allLiked = n > 0 && songs.every(isLiked);
    const set = (act, icon, label, title) => { const b = selectBar.querySelector(`[data-sel="${act}"]`); if (!b) return; const html = `${icon}<span>${label}</span>`; if (b.__html !== html) { b.innerHTML = html; b.__html = html; } b.title = title || label; b.setAttribute("aria-label", title || label); b.disabled = !n; };
    set("like", allLiked ? ICONS.heartFill : ICONS.heart, allLiked ? "Unlike" : "Like", allLiked ? "Remove them from Liked Songs" : "Save them to Liked Songs");
    set("queue", SWIPE_ICON_QUEUE, "Queue", "Add them to the queue");
    set("add", ICONS.plus, "Add to", "Add them to a playlist");
    set("remove", SWIPE_ICON_REMOVE, liked ? "Unlike" : "Remove", liked ? "Remove them from Liked Songs" : "Remove them from this playlist");
    const close = selectBar.querySelector('[data-sel="done"]'); if (close && !close.innerHTML) close.innerHTML = ICONS.close;
    const all = selectBar.querySelector('[data-sel="all"]');
    if (all) setText(all, n && n === getCurrentPlaylistSongs().length ? "None" : "All");
}
// Desktop: across the bottom of the song list area (the sidebar and queue can be collapsed);
// phones: the CSS puts it above the mini player.
function placeSelectBar() {
    if (!selectBar) return;
    if (isMobile() || !mainContent) { selectBar.style.left = selectBar.style.right = ""; return; }
    const r = mainContent.getBoundingClientRect();
    selectBar.style.left = Math.round(r.left + 16) + "px";
    selectBar.style.right = Math.round(window.innerWidth - r.right + 16) + "px";
}
window.addEventListener("resize", throttle(() => { if (selection) placeSelectBar(); }, 100));
function likeSongs(songs, liked) {
    for (const s of songs) { const k = statsKeyFor(s); if (!k) continue; if (liked) { if (!likedSongs.has(k)) likedSongs.set(k, Date.now()); } else likedSongs.delete(k); }
    likedVersion++; haptic(liked ? 15 : 8);
    saveLibrary(); renderSongs(); renderPlaylists(); updateLikeButtons();
    if (contextSource === LIKED_SOURCE) renderQueue();
    if (currentTrack && songs.some((s) => statsKeyFor(s) === statsKeyFor(currentTrack))) syncNativePlayback();
}
async function addSongsToPlaylist(songs, target) {
    const pl = playlists[target]; if (!pl || !songs.length) return;
    const have = new Set(pl.songs.map(statsKeyFor));
    const fresh = songs.filter((s) => !have.has(statsKeyFor(s)));
    for (const s of fresh) pl.songs.push({ ...s, id: newSongId(), timestamp: Date.now() });
    await saveLibrary(); renderSongs(); renderPlaylists();
    const skipped = songs.length - fresh.length;
    showToast(fresh.length ? `Added ${fresh.length} to ${target}${skipped ? ` · ${skipped} already there` : ""}` : `They're all in ${target} already`);
}
async function removeSongsFromPlaylist(playlistName, songs) {
    if (blockedBySync()) return;
    const pl = playlists[playlistName]; if (!pl || !songs.length) return;
    const ids = new Set(songs.map((s) => s.id)), removed = [];
    pl.songs.forEach((s, index) => { if (ids.has(s.id)) removed.push({ song: s, index }); });
    pl.songs = pl.songs.filter((s) => !ids.has(s.id));
    const binned = removed.map(({ song, index }) => addToTrash({ type: "song", playlistName, index, song }));
    await saveLibrary(); renderSongs(); renderPlaylists(); renderQueue();
    offerUndo(`Removed ${removed.length} ${removed.length === 1 ? "song" : "songs"}`, async () => {
        const target = playlists[playlistName]; if (!target) return;
        binned.forEach(dropFromTrash);
        for (const { song, index } of removed) target.songs.splice(Math.min(index, target.songs.length), 0, song); // lowest index first, so each lands where it was
        await saveLibrary(); renderSongs(); renderPlaylists(); renderQueue();
    }, removed.flatMap(({ song }) => [song.mediaId, song.artId, song.thumbId]));
}
function openSelectionAddMenu(btn) {
    const songs = selectedSongs(); if (!songs.length) return;
    closeContextMenu();
    const menu = document.createElement("div"); menu.id = "active-context-menu"; menu.className = "context-menu";
    const names = getOrderedPlaylistNames().filter((n) => n !== currentPlaylist);
    menu.innerHTML = `<div class="context-menu-title">Add ${songs.length} to</div>` + menuItem("new", ICONS.plus, "New playlist…")
        + names.map((n) => `<button class="context-menu-item" data-playlist="${escapeHtml(n)}"><span>${escapeHtml(n)}</span></button>`).join("");
    const r = btn.getBoundingClientRect();
    positionMenu(menu, r.right, r.top);
    menu.addEventListener("click", async (e) => {
        const item = e.target.closest("[data-action], [data-playlist]"); if (!item) return;
        menu.remove();
        let target = item.dataset.playlist;
        if (item.dataset.action === "new") {
            const name = await showPrompt({ title: "New playlist", message: `With the ${songs.length} songs you picked.`, input: { placeholder: "Playlist name", value: "" }, confirmText: "Create" });
            if (!name) return;
            target = uniquePlaylistName(name);
            await createPlaylist(target);
        }
        await addSongsToPlaylist(songs, target);
        endSelection();
    });
}
if (selectBar) selectBar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sel]"); if (!b || b.disabled || !selection) return;
    const act = b.dataset.sel, songs = selectedSongs();
    if (act === "done") { endSelection(); return; }
    if (act === "all") {
        const all = getCurrentPlaylistSongs();
        selection.ids = selection.ids.size === all.length ? new Set() : new Set(all.map((s) => s.id));
        renderSelection(); return;
    }
    if (act === "like") { const on = !songs.every(isLiked); likeSongs(songs, on); showToast(`${on ? "Liked" : "Unliked"} ${songs.length} ${songs.length === 1 ? "song" : "songs"}`); endSelection(); return; }
    if (act === "queue") {
        const home = isVirtualSource(currentPlaylist) ? null : currentPlaylist;
        for (const s of songs) queue.push({ song: s, playlistName: home || homePlaylistOf(s) || currentPlaylist });
        haptic(10); saveLibrary(); renderQueue();
        showToast(`Added ${songs.length} to the queue`); endSelection(); return;
    }
    if (act === "add") { e.stopPropagation(); openSelectionAddMenu(b); return; } // or the page's click handler closes it at once
    if (act === "remove") {
        if (isLikedSource(currentPlaylist)) {
            const keys = songs.map((s) => [statsKeyFor(s), likedSongs.get(statsKeyFor(s))]);
            likeSongs(songs, false); endSelection();
            offerUndo(`Removed ${songs.length} from Liked Songs`, async () => { for (const [k, t] of keys) if (k) likedSongs.set(k, t || Date.now()); likedVersion++; saveLibrary(); renderSongs(); renderPlaylists(); updateLikeButtons(); });
            return;
        }
        if (!playlists[currentPlaylist]) return;
        removeSongsFromPlaylist(currentPlaylist, songs); endSelection();
    }
});

// Marks the playing song wherever it's listed (song list, search, stats, shelves).
function updatePlayingIndicators() {
    const playing = isAudiblyPlaying(), key = statsKeyFor(currentTrack);
    if (songList) {
        songList.querySelectorAll(".song-row.playing").forEach((r) => { r.classList.remove("playing"); const b = r.querySelector(".row-play-btn"); if (b) b.innerHTML = ICONS.play; });
        if (currentTrack) {
            const byKey = isVirtualSource(currentPlaylist);
            const sel = byKey ? `.song-row[data-key="${CSS.escape(key)}"]` : `.song-row[data-id="${currentTrack.id}"]`;
            songList.querySelectorAll(sel).forEach((r) => { r.classList.add("playing"); const b = r.querySelector(".row-play-btn"); if (b) b.innerHTML = playing ? ICONS.pause : ICONS.play; });
        }
    }
    document.querySelectorAll(".stats-row[data-key], .shelf-card[data-key], .sotd-card[data-key]").forEach((el) => el.classList.toggle("playing", !!key && el.dataset.key === key));
    updateNowSourceIndicators();
    updateJumpButton();
}

// ── JUMP TO THE PLAYING SONG ──
// A pill that appears when the playing song is in this list but scrolled out of view.
const jumpBtn = $("jump-playing-btn");
function updateJumpButton() {
    if (!jumpBtn) return;
    let dir = 0;
    if (prefs.jumpButton && currentTrack && playlistView && playlistView.style.display !== "none" && mainContent) {
        const row = songList && songList.querySelector(".song-row.playing");
        if (row && row.style.display !== "none") {
            const r = row.getBoundingClientRect(), c = mainContent.getBoundingClientRect();
            const bottom = c.bottom - (isMobile() ? 166 : 0);
            if (r.bottom < c.top + 4) dir = -1; else if (r.top > bottom - 4) dir = 1;
        }
    }
    jumpBtn.hidden = !dir;
    jumpBtn.classList.toggle("up", dir < 0);
    updateScrollEndButton();
}
if (jumpBtn) jumpBtn.addEventListener("click", () => {
    const row = songList && songList.querySelector(".song-row.playing"); if (!row) return;
    row.scrollIntoView({ block: "center", behavior: appearance.reduceMotion ? "auto" : "smooth" });
    row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
});
// ── JUMP TO THE BOTTOM / TOP ── a round button beside the pill in long playlists: ↓ goes
// straight to the last song, and once you're near the bottom it turns into ↑ (back to the top).
const scrollEndBtn = $("scroll-end-btn");
function updateScrollEndButton() {
    if (!scrollEndBtn) return;
    let show = false, up = false;
    if (prefs.scrollEndButton !== false && playlistView && playlistView.style.display !== "none" && mainContent && songList && songList.childElementCount > 12) {
        const max = mainContent.scrollHeight - mainContent.clientHeight;
        if (max > mainContent.clientHeight * 1.2) { show = true; up = mainContent.scrollTop > max - mainContent.clientHeight * 0.6; }
    }
    scrollEndBtn.hidden = !show;
    if (show && scrollEndBtn.classList.contains("up") !== up || !scrollEndBtn.innerHTML) {
        scrollEndBtn.classList.toggle("up", up);
        scrollEndBtn.innerHTML = up ? ICONS.arrowUp : ICONS.arrowDown;
        const label = up ? "Back to the top" : "Jump to the last song";
        scrollEndBtn.setAttribute("aria-label", label); scrollEndBtn.title = label;
    }
}
if (scrollEndBtn) scrollEndBtn.addEventListener("click", () => {
    if (!mainContent) return;
    haptic(8);
    if (scrollEndBtn.classList.contains("up")) { mainContent.scrollTop = 0; return; }
    // Rows off screen are only measured once drawn, so the bottom can move as they are: settle it.
    const toEnd = (n) => { mainContent.scrollTop = mainContent.scrollHeight; if (n > 0) requestAnimationFrame(() => toEnd(n - 1)); };
    toEnd(4);
});
if (mainContent) mainContent.addEventListener("scroll", throttle(() => { updateJumpButton(); updateScrollEndButton(); }, 120), { passive: true });

// ── PLAYBACK ──
// opts.restart: the same song starts over instead of toggling pause (queued copies,
// Next with a one-song playlist). opts.auto: advanced by itself, not a click.
async function playSong(song, source = currentPlaylist, fromQueue = false, opts = {}) {
    if (!song) return;
    if (!song.fileSrc && song.mediaId) song.fileSrc = await getBlobUrl(song.mediaId);
    if (!song.fileSrc) { if (!opts.auto) showToast("This song's audio is missing from the library"); return; }
    if (!song.art && song.artId) song.art = await getBlobUrl(song.artId);
    if (!song.art) song.art = DEFAULT_ART;
    if (currentTrack && currentTrack.id === song.id) {
        if (opts.restart) {
            cancelCrossfade();
            audioPlayer.currentTime = 0;
            if (!fromQueue) activateTrack(song, source, false);
            safePlay({ fade: false }); afterTrackChange(); return;
        }
        if (isAudiblyPlaying()) pausePlayback(); else safePlay();
        updatePlayPauseIcon(); updateMediaSessionMetadata(); return;
    }
    cancelCrossfade();
    activateTrack(song, source, fromQueue);
    loadTrackInto(audioPlayer, song);
    safePlay({ fade: false });
    afterTrackChange();
}

// Bookkeeping for "this song is now the current one": history, context and shuffle order.
let suppressHistoryPush = false;
function activateTrack(song, source, fromQueue) {
    if (!suppressHistoryPush && currentTrack && currentTrack.id !== song.id) {
        playbackHistory.push({ id: currentTrack.id, source: currentTrackSource });
        if (playbackHistory.length > 200) playbackHistory.shift();
    }
    currentTrack = song; currentTrackSource = source;
    if (!fromQueue) {
        const sourceChanged = contextSource !== source;
        contextTrack = song; contextSource = source;
        if (sourceChanged) resetPlayOrder();
        orderSkipped.delete(song);
        if (shuffleEnabled && (sourceChanged || !shuffledOrder.some(s => s.id === song.id))) generateShuffleOrder();
    }
}
// Point an <audio> element at a song with the current speed/pitch settings and its
// loudness-leveller gain (see AUDIO ENGINE).
function loadTrackInto(el, song) {
    el.src = song.fileSrc;
    el.playbackRate = playbackSpeed / 100;
    applyPitchModeTo(el);
    applyLevellerGain(el, song, 0);
    prepareLeveller(song);
}
function afterTrackChange() {
    showTrackInfo(currentTrack, currentTrackSource);
    updatePlayPauseIcon(); updateMediaSessionMetadata(); renderQueue();
    saveNowPlaying(true);
    scheduleShelves();
    scheduleCarLibrary(20000); // Recently played in the car
}

// What playNext() would play, without consuming the queue — used to pre-roll the
// next song for an overlapping crossfade and to level its loudness ahead of time.
function peekNextSong() {
    for (const item of queue) if (item?.song?.mediaId || item?.song?.fileSrc) return { song: item.song, source: item.playlistName, fromQueue: true };
    const song = getNextPlaylistSong();
    return song ? { song, source: contextSource || currentTrackSource || currentPlaylist, fromQueue: false } : null;
}

let currentArtShown = null;
function showTrackInfo(song, source) {
    const art = song.art || DEFAULT_ART;
    // Extra animations: the covers pop in when the song changes.
    if (document.documentElement.dataset.anim === "1" && currentArtShown !== art) {
        for (const img of [trackArt, miniTrackArt, npArt, $("quiet-art")]) if (img) { img.classList.remove("art-swap"); void img.offsetWidth; img.classList.add("art-swap"); }
    }
    currentArtShown = art;
    if (trackArt) trackArt.src = art;
    if (trackTitle) { trackTitle.textContent = song.title; trackTitle.title = song.title; }
    if (trackArtist) trackArtist.textContent = song.artist;
    if (miniTrackArt) miniTrackArt.src = art;
    if (miniTrackTitle) miniTrackTitle.textContent = song.title;
    if (miniTrackArtist) miniTrackArtist.textContent = song.artist;
    document.body.classList.add("has-track");
    if (npArt) npArt.src = art;
    if (npTitle) npTitle.textContent = song.title;
    if (npArtist) npArtist.textContent = song.artist;
    if (npSource) npSource.textContent = isArtistSource(source) ? "Playing from " + artistFromSource(source) : sourceLabel(source);
    updateLikeButtons();
    applyTrackTint();
    updateDocumentTitle();
    updateNowSourceIndicators();
    renderQuiet(true);
}

function getNextPlaylistSong() {
    const order = getPlayOrder();
    if (!order.length) return null;
    if (!contextTrack) return order[0];
    const idx = order.findIndex(s => s.id === contextTrack.id);
    const next = order[idx + 1];
    if (next) return next;
    if (loopMode !== "all") return null;
    // Next pass: everything is back in, and a fresh shuffle keeps the song that just
    // played at its head so it isn't picked again straight away.
    orderSkipped = new Set();
    if (shuffleEnabled) { generateShuffleOrder(); return shuffledOrder[shuffledOrder[0]?.id === contextTrack.id ? 1 : 0] || shuffledOrder[0] || null; }
    return getPlayOrder()[0] || null;
}

// A skip is pressing Next before the "skip before" time in Settings, or before the
// halfway point when that's left blank (the media-session handler passes its own
// details object, which is never `auto`).
function noteSkip() {
    if (!currentTrack) return;
    const d = audioPlayer.duration, t = audioPlayer.currentTime || 0, limit = skipThreshold();
    if (limit > 0 ? t >= limit : (!Number.isFinite(d) || d < 20 || t >= d / 2)) return;
    const entry = statsEntryFor(currentTrack); if (!entry) return;
    entry.skips = (entry.skips || 0) + 1; entry.lastSkipped = Date.now();
    saveListenStats();
    if (statsView === "skipped" && isShown(statsOverlay)) renderStatsPage();
}
async function playNext(opts = {}) {
    if (!opts.auto) noteSkip();
    while (queue.length) {
        const next = queue.shift();
        if (next?.song?.mediaId || next?.song?.fileSrc) {
            saveLibrary(); renderQueue(); await playSong(next.song, next.playlistName, true, { restart: true, auto: opts.auto }); return;
        }
    }
    saveLibrary(); renderQueue();
    const nextSong = getNextPlaylistSong();
    if (nextSong) await playSong(nextSong, contextSource || currentTrackSource || currentPlaylist, false, { restart: true, auto: opts.auto });
}

// Previous: more than 3 seconds in, it restarts the song (like every other player);
// otherwise back through what you actually played, then back through the order.
async function playPrevious() {
    if (currentTrack && audioPlayer.currentTime > 3) {
        audioPlayer.currentTime = 0;
        lastMediaSessionPositionUpdate = 0; renderProgress(true); syncNativePosition(true); saveNowPlaying();
        return;
    }
    const prev = playbackHistory.pop();
    if (prev) {
        const found = findSongById(prev.id);
        if (found) {
            const source = sourceExists(prev.source) ? prev.source : found.playlistName;
            suppressHistoryPush = true;
            try { await playSong(found.song, source, false, { restart: true }); } finally { suppressHistoryPush = false; }
            return;
        }
    }
    const order = getPlayOrder();
    const index = order.findIndex((s) => currentTrack && s.id === currentTrack.id);
    if (index > 0) await playSong(order[index - 1], contextSource || currentTrackSource || currentPlaylist, false, { restart: true });
    else if (currentTrack) { audioPlayer.currentTime = 0; renderProgress(true); }
}
function seekBy(delta) {
    if (!currentTrack || !Number.isFinite(audioPlayer.duration)) return;
    audioPlayer.currentTime = clamp(audioPlayer.currentTime + delta, 0, Math.max(0, audioPlayer.duration - 0.25));
    lastMediaSessionPositionUpdate = 0; renderProgress(true); syncNativePosition(true); saveNowPlaying();
}

// ── PLAYER CONTROLS ──
function pickStartSong(songs) { return shuffleEnabled ? songs[Math.floor(Math.random() * songs.length)] : songs[0]; }
function toggleShuffle() {
    shuffleEnabled = !shuffleEnabled;
    customOrder = null;
    if (shuffleEnabled) generateShuffleOrder(); else shuffledOrder = [];
    setActiveButton(shuffleBtn, shuffleEnabled); updateNpControls(); renderQueue(); saveNowPlaying(true);
    syncNativePlayback(); // the lock screen's shuffle button
    showToast(shuffleEnabled ? (prefs.smartShuffle ? "Smart shuffle on" : "Shuffle on") : "Shuffle off");
}
function cycleLoop() {
    loopMode = loopMode === "off" ? "all" : loopMode === "all" ? "one" : "off";
    updateLoopButton(); updateNpControls(); renderQueue(); saveNowPlaying(true);
}
if (playPauseBtn) playPauseBtn.addEventListener("click", togglePlayPause);
if (shuffleBtn) shuffleBtn.addEventListener("click", toggleShuffle);
if (loopBtn) loopBtn.addEventListener("click", cycleLoop);
if (nextBtn) nextBtn.addEventListener("click", () => playNext());
if (prevBtn) prevBtn.addEventListener("click", playPrevious);
if (playAllBtn) playAllBtn.addEventListener("click", () => playCollection(currentPlaylist));
for (const [id, delta] of [["skip-back-btn", -10], ["skip-fwd-btn", 10], ["np-skip-back-btn", -10], ["np-skip-fwd-btn", 10]]) {
    const b = $(id); if (b) b.addEventListener("click", () => seekBy(delta));
}
function applySkipButtons() { document.querySelectorAll(".skip-btn").forEach((b) => { b.hidden = !prefs.skipButtons; }); }

onPlayer("timeupdate", () => { onTimeTick(); if (!progressFrameId) renderProgress(); if (!audioPlayer.paused) saveNowPlaying(); });
onPlayer("loadedmetadata", () => {
    if (currentTrack && audioPlayer.duration && Math.abs((currentTrack.duration || 0) - audioPlayer.duration) > 0.5) {
        currentTrack.duration = audioPlayer.duration; saveLibrary(); renderSongs();
    }
    renderProgress(true);
});
onPlayer("ended", () => {
    if (crossfadePending) { commitCrossfade(); return; } // the next song is already playing on the standby
    cancelCrossfade(); stopProgressLoop(); updatePlayPauseIcon(); updateMediaSessionMetadata();
    if (sleepAtTrackEnd) { stopForSleep(); return; }
    if (loopMode === "one" && currentTrack) { audioPlayer.currentTime = 0; safePlay({ fade: false }); updatePlayPauseIcon(); return; }
    playNext({ auto: true });
});

// Seek bars move the audio when you let go; while dragging only the clock follows.
function bindSeekBar(bar) {
    if (!bar) return;
    const preview = () => {
        const d = audioPlayer.duration; if (!Number.isFinite(d) || !d) return;
        isScrubbing = true;
        const t = (bar.value / 100) * d;
        setText(currentTimeLabel, formatTime(t)); setText(npCurrentTime, formatTime(t));
        bar.style.setProperty("--p", bar.value + "%");
    };
    const commit = () => {
        const d = audioPlayer.duration;
        if (Number.isFinite(d) && d) { audioPlayer.currentTime = (bar.value / 100) * d; lastMediaSessionPositionUpdate = 0; syncNativePosition(true); saveNowPlaying(); }
        isScrubbing = false;
        [progressBar, npProgressBar].forEach((b) => { if (b) b._pct = -1; });
        renderProgress(true);
        if (isAudiblyPlaying()) startProgressLoop();
    };
    bar.addEventListener("pointerdown", () => { isScrubbing = true; });
    bar.addEventListener("input", preview);
    bar.addEventListener("change", commit);
    bar.addEventListener("pointerup", () => requestAnimationFrame(() => { if (isScrubbing) commit(); }));
    bar.addEventListener("pointercancel", () => { isScrubbing = false; renderProgress(true); });
}
bindSeekBar(progressBar);
bindSeekBar(npProgressBar);
// Hovering the desktop seek bar shows the time under the pointer.
if (progressBar && progressTip) {
    const wrap = progressBar.parentElement;
    wrap.addEventListener("mousemove", (e) => {
        const d = audioPlayer.duration;
        if (!Number.isFinite(d) || !d) { progressTip.classList.remove("ready"); return; }
        const r = progressBar.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1);
        progressTip.textContent = formatTime(f * d);
        progressTip.style.left = f * r.width + "px";
        progressTip.classList.add("ready");
    });
    wrap.addEventListener("mouseleave", () => progressTip.classList.remove("ready"));
}
// Tap the total time to switch it to a countdown (remembered).
for (const el of [totalTimeLabel, npTotalTime]) if (el) {
    el.classList.add("time-toggle");
    el.title = "Show remaining time";
    el.addEventListener("click", () => { setPref("remainingTime", !prefs.remainingTime); });
}

// ── VOLUME ──
function setUserVolume(v, save = true) {
    userVolume = clamp(v, 0, 1);
    if (userVolume > 0) isMuted = false;
    if (volumeBar) { volumeBar.value = Math.round(userVolume * 100); updateSliderFill(volumeBar); }
    applyVolume(); updateVolumeIcon();
    if (save) { try { localStorage.setItem("spootify-volume", String(userVolume)); } catch {} }
}
function toggleMute() {
    isMuted = !isMuted;
    if (!isMuted && userVolume < 0.02) userVolume = 0.5;
    if (volumeBar) { volumeBar.value = isMuted ? 0 : Math.round(userVolume * 100); updateSliderFill(volumeBar); }
    applyVolume(); updateVolumeIcon();
}
function updateVolumeIcon() {
    const v = isMuted ? 0 : userVolume;
    setIcon(volumeIconBtn, v === 0 ? ICONS.volumeMute : v < 0.5 ? ICONS.volumeLow : ICONS.volume, v === 0 ? "Unmute" : "Mute");
}
if (volumeBar) volumeBar.addEventListener("input", () => setUserVolume(volumeBar.value / 100));
if (volumeIconBtn) volumeIconBtn.addEventListener("click", toggleMute);
const volumeWheelTarget = volumeBar ? volumeBar.closest(".volume-container") : null;
if (volumeWheelTarget) volumeWheelTarget.addEventListener("wheel", (e) => {
    if (!e.target.closest("#volume-bar, #volume-icon-btn, .volume-slider-wrapper")) return;
    e.preventDefault();
    setUserVolume((isMuted ? 0 : userVolume) + (e.deltaY < 0 ? 0.05 : -0.05));
}, { passive: false });
if (clearQueueBtn) clearQueueBtn.addEventListener("click", clearQueue);

// ── LIBRARY MANAGEMENT ──
// Settings, themes and presets survive a reset; only the library and history go.
const KEEP_ON_RESET = ["spootify-appearance", "spootify-custom-themes", "spootify-prefs", "spootify-presets", "spootify-speed", "spootify-preserve-pitch", "spootify-crossfade", "spootify-crossfade-overlap", "spootify-fx", "spootify-leveller", "spootify-volume", "spootify-liked-sort", "spootify-settings-tab", "spootify-sidebar-collapsed", "spootify-queue-hidden", "spootify-default-sort-v1", "spootify-recent-colors", "spootify-ui"];
function resetLibrary() {
    const finish = () => {
        try { for (const k of Object.keys(localStorage)) if (k.startsWith("spootify-") && !KEEP_ON_RESET.includes(k)) localStorage.removeItem(k); } catch {}
        location.reload();
    };
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = finish; r.onerror = finish; r.onblocked = () => setTimeout(finish, 500);
}

// ── APP UPDATES ── (Settings → General, desktop only; the phone updates by installing the APK.)
// main.js checks the latest GitHub release and, on "Update now", downloads this platform's
// build, quits, copies it over the app folder and starts it again. A quiet check runs at
// most once a day on startup and only pops a toast when there's something new.
const UPDATE_KEY = "spootify-update";
// App updates (Settings → General): every published version with what changed and a button to update,
// reinstall or go back. The desktop app swaps its own folder (main.js); the Android app downloads the APK
// and opens Android's installer (AppUpdatePlugin), which can't install an older version over a newer one.
const UPDATE_REPO = "ForsakenBlank/Prism";
const updater = (() => {
    const e = window.electronAPI && window.electronAPI.updates;
    if (e && typeof e.info === "function") {
        return {
            asset: /win/i.test(navigator.platform) ? "Prism-windows-x64.zip" : "Prism-linux-x64.tar.gz",
            canDowngrade: true,
            restarts: true,
            info: () => e.info(),
            install: (rel) => e.install(rel.version),
            onProgress: (cb) => e.onProgress((p) => cb(p.stage === "download" ? `Downloading… ${p.percent}%` : "Installing…")),
        };
    }
    const cap = window.Capacitor;
    if (cap && typeof cap.nativePromise === "function" && typeof cap.getPlatform === "function" && cap.getPlatform() === "android") {
        return {
            asset: "Prism-android.apk",
            canDowngrade: false,
            downgradeNote: "Android can't install an older version over a newer one. To go back: export your library (Home → Export), uninstall Prism, install the older APK from GitHub, then import it.",
            restarts: false,
            info: () => cap.nativePromise("AppUpdate", "info", {}).then((r) => ({ current: r.current || "", cantInstall: null })),
            install: (rel) => cap.nativePromise("AppUpdate", "install", { url: rel.assets["Prism-android.apk"] || "", version: rel.version }),
            onProgress: (cb) => {
                const h = cap.addListener("AppUpdate", "updateProgress", (p) => cb(p && p.percent >= 0 ? `Downloading… ${p.percent}%` : "Downloading…"));
                return () => { try { h.remove(); } catch {} };
            },
        };
    }
    return null;
})();
const updateEls = { group: $("update-group"), version: $("update-version"), check: $("update-check-btn"), install: $("update-install-btn"), status: $("update-status"), auto: $("update-auto"), list: $("update-list") };
const updatePrefs = (() => { try { return { auto: true, lastCheck: 0, ...JSON.parse(localStorage.getItem(UPDATE_KEY) || "{}") }; } catch { return { auto: true, lastCheck: 0 }; } })();
function saveUpdatePrefs() { try { localStorage.setItem(UPDATE_KEY, JSON.stringify(updatePrefs)); } catch {} }
let updateBusy = false, updateCurrent = "", updateReleases = [], updateCantInstall = null;
const updateError = (e) => errorText(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
function cmpVersion(a, b) {
    const x = String(a || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0), y = String(b || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
}
async function fetchReleases() {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=40`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return (await res.json())
        .filter((r) => !r.draft && /^v\d+(\.\d+)*$/.test(r.tag_name || ""))
        .map((r) => ({ tag: r.tag_name, version: r.tag_name.replace(/^v/i, ""), date: String(r.published_at || "").slice(0, 10), notes: String(r.body || ""), page: r.html_url,
            assets: Object.fromEntries((r.assets || []).map((a) => [a.name, a.browser_download_url])) }))
        .sort((a, b) => cmpVersion(b.version, a.version));
}
function renderUpdateList() {
    const list = updateEls.list; if (!list) return;
    list.innerHTML = updateReleases.slice(0, 15).map((r, i) => {
        const c = cmpVersion(r.version, updateCurrent), has = !!r.assets[updater.asset];
        let action;
        if (!has) action = `<span class="settings-hint">No ${escapeHtml(updater.asset)} in this version</span>`;
        else if (updateCantInstall) action = `<a class="utility-btn" href="${escapeHtml(r.page)}" target="_blank" rel="noopener">Download page</a>`;
        else if (c > 0) action = `<button type="button" class="utility-btn accent-outline" data-install="${escapeHtml(r.version)}">Update</button>`;
        else if (c === 0) action = `<button type="button" class="utility-btn" data-install="${escapeHtml(r.version)}">Reinstall</button>`;
        else if (updater.canDowngrade) action = `<button type="button" class="utility-btn" data-install="${escapeHtml(r.version)}">Downgrade</button>`;
        else action = `<span class="settings-hint">${escapeHtml(updater.downgradeNote)}</span>`;
        const badges = (i === 0 ? '<span class="update-badge">NEWEST</span>' : "") + (c === 0 ? '<span class="update-badge">INSTALLED</span>' : "");
        return `<div class="update-release"><div class="update-release-head"><strong>${escapeHtml(r.tag)}</strong><span class="settings-hint">${escapeHtml(r.date)}</span>${badges}`
            + `<button type="button" class="utility-btn update-notes-btn" data-notes="${i}">What changed</button></div>`
            + `<div class="update-notes" hidden>${escapeHtml(r.notes.replace(/\*\*/g, "")) || "No notes."}</div><div class="update-release-action">${action}</div></div>`;
    }).join("");
}
async function checkForUpdates(quiet = false) {
    if (!updater || updateBusy) return null;
    updateBusy = true;
    if (!quiet) { updateEls.check.disabled = true; setText(updateEls.status, "Checking…"); }
    try {
        const info = await updater.info();
        updateCurrent = info.current || ""; updateCantInstall = info.cantInstall || null;
        setText(updateEls.version, `Prism ${updateCurrent}`);
        updateReleases = await fetchReleases();
        updatePrefs.lastCheck = Date.now(); saveUpdatePrefs();
        const newest = updateReleases[0];
        const newer = newest && cmpVersion(newest.version, updateCurrent) > 0;
        updateEls.install.hidden = !newer || !!updateCantInstall || !newest.assets[updater.asset];
        setText(updateEls.status, !newest ? "No versions are published yet."
            : newer ? `Version ${newest.version} is available.${updateCantInstall ? " " + updateCantInstall : updater.restarts ? " Prism restarts to install it." : " Android's installer opens to install it."}`
            : `You're up to date (${updateCurrent}). Older versions are listed below if you want to go back.`);
        renderUpdateList();
        if (quiet && newer) showToast(`Prism ${newest.version} is available · Settings → General`, { duration: 6000 });
        return newest;
    } catch (e) {
        if (!quiet) setText(updateEls.status, `Couldn't check: ${updateError(e)}`);
        return null;
    } finally { updateBusy = false; updateEls.check.disabled = false; }
}
async function installUpdate(version) {
    if (!updater || updateBusy) return;
    const rel = version ? updateReleases.find((r) => r.version === version) : updateReleases[0];
    if (!rel) return;
    const back = cmpVersion(rel.version, updateCurrent) < 0;
    const message = updater.restarts
        ? `It downloads ${rel.version}, closes, and opens again. Your library, stats and settings stay as they are.${back ? " Settings added in newer versions are ignored by the older one." : ""}`
        : `It downloads ${rel.version} and opens Android's installer: tap Install there. Your library, stats and settings stay as they are.`;
    if (!await showPrompt({ title: back ? `Go back to Prism ${rel.version}?` : `Install Prism ${rel.version}?`, message, confirmText: back ? "Go back" : "Install" })) return;
    updateBusy = true;
    updateEls.check.disabled = updateEls.install.disabled = true;
    noteActivity("updating the app");
    statsTick(); saveListenStats(true); saveListenLog(true); saveClock(true);
    const off = updater.onProgress((text) => setText(updateEls.status, text));
    try {
        await updater.install(rel);
        setText(updateEls.status, updater.restarts ? "Restarting…" : "Android's installer is open: tap Install.");
        if (!updater.restarts) { updateBusy = false; updateEls.check.disabled = updateEls.install.disabled = false; noteActivity(null); }
    } catch (e) { setText(updateEls.status, `Update failed: ${updateError(e)}`); updateBusy = false; updateEls.check.disabled = updateEls.install.disabled = false; noteActivity(null); }
    finally { off(); }
}
if (updater && updateEls.group) {
    updateEls.group.hidden = false;
    updateEls.auto.checked = updatePrefs.auto !== false;
    updateEls.check.addEventListener("click", () => checkForUpdates(false));
    updateEls.install.addEventListener("click", () => installUpdate(null));
    if (updateEls.list) updateEls.list.addEventListener("click", (e) => {
        const n = e.target.closest("[data-notes]");
        if (n) { const box = n.closest(".update-release").querySelector(".update-notes"); box.hidden = !box.hidden; n.textContent = box.hidden ? "What changed" : "Hide"; return; }
        const b = e.target.closest("[data-install]"); if (b) installUpdate(b.dataset.install);
    });
    updateEls.auto.addEventListener("change", () => { updatePrefs.auto = updateEls.auto.checked; saveUpdatePrefs(); });
    if (updatePrefs.auto !== false && Date.now() - (updatePrefs.lastCheck || 0) > 20 * 3600000) setTimeout(() => checkForUpdates(true), 8000);
}

// ── RESETS ── (Settings → General → Reset) all in one place, and each one needs 15 taps.
const RESET_PRESSES = 15;
const RESETS = {
    stats: { title: "Clear listening stats", message: "Delete every play count, the listening history, skips, the listening clock and milestones? Your songs stay.", confirm: "Clear stats", run: () => {
        listenStats = {};
        clearListenLog(); clearClock();
        if (statsSession && currentTrack) statsEntryFor(currentTrack); // keep tracking the song that's playing
        saveListenStats(true); seedMilestones(); refreshStatsUi(); showToast("Listening stats cleared");
    } },
    ratings: { title: "Clear ratings", message: "Remove the star rating from every song?", confirm: "Clear ratings", run: () => {
        ratings = {}; saveRatings(); sortedCache.clear(); renderSongs(); scheduleShelves(); updateRatingButtons(); showToast("Ratings cleared");
    } },
    appearance: { title: "Reset appearance", message: "Go back to the Prism theme, the Classic layout and the default display and Home settings? Your own themes and layouts are kept.", confirm: "Reset appearance", run: () => {
        appearance = { ...(Themes ? Themes.DEFAULT_SETTINGS : appearance) }; setUiBase("classic"); applyAppearance(); renderAppearanceUi(); showToast("Appearance reset");
    } },
    themes: { title: "Delete all my themes", message: "Delete every theme you made or pasted in, and their pictures? The built-in themes stay.", confirm: "Delete themes", run: () => {
        if (!Themes) return;
        Themes.saveCustom([]);
        if (String(appearance.theme).startsWith("custom-")) appearance.theme = "spootify";
        applyAppearance(); renderAppearanceUi(); Themes.pruneImages(); showToast("Your themes were deleted");
    } },
    settings: { title: "Reset all settings", message: "Put every setting back to how it started: playback, sound effects, appearance and General. Your library, stats and themes stay.", confirm: "Reset settings", run: () => {
        try { for (const k of KEEP_ON_RESET.concat(["spootify-dj"])) if (k !== "spootify-custom-themes") localStorage.removeItem(k); } catch {}
        location.reload();
    } },
    library: { title: "Reset library", message: "Delete all playlists, songs, listening history and ratings? Your settings and themes are kept. This can't be undone.", confirm: "Reset everything", run: resetLibrary }
};
async function askReset(id) {
    if (blockedBySync()) return;
    const r = RESETS[id]; if (!r) return;
    closeSettings();
    const ok = await showPrompt({ title: r.title, message: `${r.message}\n\nTap the red button ${RESET_PRESSES} times to be sure.`, confirmText: r.confirm, danger: true, presses: RESET_PRESSES });
    if (ok) r.run(); else openSettings("general");
}
document.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", () => askReset(b.dataset.reset)));

// Export: read blobs back to base64 for portable file
async function blobToDataUrl(blob) {
    return new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.readAsDataURL(blob);
    });
}

// Desktop and browser: an ordinary download. The Android WebView ignores those, so
// there the bytes are streamed (base64, a few MB at a time) to BackgroundAudio, which
// writes them into Downloads/Prism.
async function saveBlobAsFile(blob, name, label = "File") {
    if (!nativeAudio.available) {
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        showToast(`${label} saved`);
        return true;
    }
    let token = null;
    try {
        ({ token } = await nativeAudio.raw("saveFileStart", { name, mime: blob.type || "application/octet-stream" }));
        const CHUNK = 3 * 1024 * 1024; // a multiple of 3, so every chunk encodes to whole base64
        for (let at = 0; at < blob.size; at += CHUNK) {
            const part = await blobToDataUrl(blob.slice(at, at + CHUNK));
            await nativeAudio.raw("saveFileChunk", { token, data: String(part).split(",")[1] || "" });
            if (blob.size > CHUNK * 2) showToast(`Saving… ${Math.min(100, Math.round(((at + CHUNK) / blob.size) * 100))}%`, { duration: 600000 });
        }
        const res = await nativeAudio.raw("saveFileEnd", { token });
        showToast(`${label} saved to ${res?.path || "Downloads"}`, { duration: 4000 });
        return true;
    } catch (e) {
        console.error("Save failed", e);
        if (token) nativeAudio.raw("saveFileEnd", { token, cancel: true }).catch(() => {});
        showToast(`Couldn't save: ${errorText(e)}`, { duration: 4000 });
        return false;
    }
}

// ── EXPORT ── (Home → Export). A big library is split into several JSON files ("parts")
// of about the size you pick, each written a few MB at a time, so it never has to exist
// as one giant string (a 2 GB library made the old single-file export fail). Format 4:
//   line 1   {"spootify":"library","version":4,"exportId":…,"part":1,"parts":N,…,
//   line 2   "library":{ playlists, queue, liked, listenLog, … }        (part 1 only)
//   then     "assets":{  and one  "a12":{"type":"audio","data":"data:…"}  per line,  then }}
// Every part is valid JSON on its own; the line layout lets Import read them back one
// song at a time instead of parsing hundreds of MB at once.
const EXPORT_FORMAT = "spootify-library";
const exportEls = {
    overlay: $("export-overlay"), options: $("export-options"), size: $("export-size"), sizeRow: $("export-size-row"),
    songs: $("export-songs"), covers: $("export-covers"), stats: $("export-stats"), settings: $("export-settings"), themes: $("export-themes"),
    summary: $("export-summary"), progress: $("export-progress"), fill: $("export-progress-fill"), text: $("export-progress-text"),
    go: $("export-go-btn"), cancel: $("export-cancel-btn")
};
let exportJob = null; // { cancelled } while writing
const EXPORT_PICKS = ["songs", "covers", "stats", "settings", "themes"]; // the "what to export" switches
const exportPrefs = (() => {
    const d = { size: 150, songs: true, covers: true, stats: true, settings: true, themes: true };
    try { return { ...d, ...JSON.parse(localStorage.getItem("spootify-export") || "{}") }; } catch { return d; }
})();
function saveExportPrefs() { try { localStorage.setItem("spootify-export", JSON.stringify(exportPrefs)); } catch {} }
function formatBytes(n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? Math.round(n / 1e6) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB"; }
function setExportStatus(msg, kind = "") { if (exportEls.summary) { exportEls.summary.textContent = msg || ""; exportEls.summary.className = "export-summary" + (kind ? " " + kind : ""); } }
function setExportProgress(fraction, text) {
    if (!exportEls.progress) return;
    exportEls.progress.style.display = fraction === null ? "none" : "flex";
    if (fraction !== null) { exportEls.fill.style.width = Math.round(clamp(fraction, 0, 1) * 100) + "%"; setText(exportEls.text, text || ""); }
}

// Listening time by title and artist rather than by this device's media ids, so it can be
// imported on its own and added onto whichever song has the same name (removed songs too).
function exportListenTimes() {
    const logs = new Map(); // stats key → { "YYYY-MM": { day: [seconds, plays] } }
    for (const ym of logMonthKeys()) {
        const month = loadLogMonth(ym);
        for (const day in month) for (const k in month[day]) {
            const l = logs.get(k) || (logs.set(k, {}), logs.get(k));
            (l[ym] || (l[ym] = {}))[day] = month[day][k];
        }
    }
    const out = [];
    for (const [key, e] of Object.entries(listenStats)) {
        const found = findSongByStatsKey(key);
        const title = found ? found.song.title : e.title, artist = found ? found.song.artist : e.artist;
        if (!title || !(e.plays > 0 || e.seconds > 0 || e.skips > 0)) continue;
        out.push({ title, artist: artist || "", plays: e.plays || 0, seconds: Math.round(e.seconds || 0), skips: e.skips || undefined, lastSkipped: e.lastSkipped || undefined,
            firstPlayed: e.firstPlayed || undefined, lastPlayed: e.lastPlayed || undefined, rating: ratings[key] || undefined, log: logs.get(key) });
    }
    return { listenTimes: out, clock: { since: loadClock().since, g: loadClock().g.map((v) => Math.round(v)) } };
}

// Everything the export will contain, with media sizes, but no media read yet.
// opts: songs (playlists + audio), covers, stats, settings, themes.
async function planExport(opts) {
    const stats = opts.stats ? exportListenTimes() : null;
    if (!opts.songs) return { library: null, stats, assets: [], total: 0 };
    const assets = new Map(); // media id -> { ref, type, size }
    let n = 0;
    const reg = (mid, type) => {
        if (!mid || (type === "image" && !opts.covers)) return null;
        if (!assets.has(mid)) assets.set(mid, { ref: `a${++n}`, type, size: 0, mid });
        return { assetRef: assets.get(mid).ref };
    };
    // Plays and history travel in `stats` (by name); only the rating stays with the song.
    const songOut = (s, withStats) => ({
        id: s.id, title: s.title, artist: s.artist, timestamp: s.timestamp, duration: s.duration, loudness: s.loudness, src: s.src,
        art: reg(s.artId, "image"), fileSrc: reg(s.mediaId, "audio"),
        rating: withStats && opts.stats ? ratingOf(s) || undefined : undefined
    });
    const outPlaylists = {};
    for (const [name, pl] of Object.entries(playlists)) {
        outPlaylists[name] = { name: pl.name, art: reg(pl.artId, "image"), sort: pl.sort || null, pinned: !!pl.pinned, order: pl.order, songs: (pl.songs || []).map((s) => songOut(s, true)) };
    }
    const outQueue = queue.filter((i) => i?.song).map((i) => ({ playlistName: i.playlistName, song: songOut(i.song, false) }));
    const refByMid = (k) => assets.get(k)?.ref || (String(k).startsWith("id:") ? k : null);
    const liked = [...likedSongs].map(([k, t]) => [refByMid(k), t]).filter(([k]) => k);
    const library = { playlists: outPlaylists, currentPlaylist: playlists[currentPlaylist] ? currentPlaylist : null, queue: outQueue, liked };
    // Sizes come from the stored blobs' metadata; nothing is loaded into memory here.
    let total = 0;
    for (const a of assets.values()) { const b = await getBlob(a.mid); a.size = b ? b.size : 0; a.mime = b ? b.type : ""; total += a.size; }
    return { library, stats, assets: [...assets.values()].filter((a) => a.size > 0), total };
}
// How long an asset's line will be: base64 of the bytes plus the wrapper.
function assetLineLength(a) { return Math.ceil(a.size / 3) * 4 + (a.mime || "").length + 64; }
// The media files: songs and covers only (the library itself goes in the data file).
function splitParts(plan, limitBytes) {
    if (!plan.assets.length) return [];
    const parts = [[]];
    let used = 0;
    for (const a of plan.assets) {
        const len = assetLineLength(a);
        if (limitBytes && used + len > limitBytes && parts[parts.length - 1].length) { parts.push([]); used = 0; }
        parts[parts.length - 1].push(a); used += len;
    }
    return parts;
}

// The data file's settings: every spootify-* key except what belongs to this device's
// library (keyed by its media ids) or is just bookkeeping. Custom themes' pictures ride along.
const NOT_EXPORTED_KEYS = () => [STATS_KEY, RATINGS_KEY, CLOCK_KEY, NOW_PLAYING_KEY, PROBLEMS_KEY, ACTIVITY_KEY, DUP_IGNORE_KEY, SOTD_KEY, IMPORT_KEY,
    "spootify-current-playlist", "spootify-covers-shrunk-v1", "spootify-dj-cues", "spootify-dj-bpm", "spootify-device-id", "spootify-sync-addr", "spootify-update"];
async function collectSettings(opts) {
    const skip = NOT_EXPORTED_KEYS(), storage = {}, THEMES_KEY = "spootify-custom-themes";
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith("spootify-") || k.startsWith(LOG_PREFIX) || skip.includes(k)) continue;
            if (k === THEMES_KEY ? opts.themes : opts.settings) storage[k] = localStorage.getItem(k);
        }
    } catch {}
    const themeImages = {};
    for (const t of Themes && opts.themes ? Themes.loadCustom() : []) {
        const id = t.image && t.image.id; if (!id || themeImages[id]) continue;
        try { const url = await Themes.getImageUrl(id); if (url) { const data = await blobToDataUrl(await (await fetch(url)).blob()); if (data) themeImages[id] = data; } } catch {}
    }
    return { storage, themeImages };
}
// Puts exported settings back (the app reloads afterwards). Themes are added to yours, with
// their pictures stored under new ids; a theme with the same id is replaced.
async function restoreSettings(s) {
    const storage = s && typeof s.storage === "object" ? s.storage : {}, skip = NOT_EXPORTED_KEYS();
    for (const [k, v] of Object.entries(storage)) {
        if (!k.startsWith("spootify-") || typeof v !== "string" || k === "spootify-custom-themes" || skip.includes(k) || k.startsWith(LOG_PREFIX)) continue;
        try { localStorage.setItem(k, v); } catch {}
    }
    if (!Themes) return;
    const newIds = new Map();
    for (const [id, data] of Object.entries(s.themeImages || {})) {
        try { newIds.set(id, await Themes.putImage(await (await fetch(data)).blob())); } catch {}
    }
    let incoming = [];
    try { incoming = JSON.parse(storage["spootify-custom-themes"] || "[]"); } catch {}
    if (!Array.isArray(incoming) || !incoming.length) return;
    const byId = new Map(Themes.loadCustom().map((t) => [t.id, t]));
    for (const t of incoming) {
        if (!t || !t.id || !t.name) continue;
        if (t.image && t.image.id) t.image = newIds.has(t.image.id) ? { ...t.image, id: newIds.get(t.image.id) } : null;
        byId.set(t.id, t);
    }
    Themes.saveCustom([...byId.values()]);
}

// Where the files go: Android → Downloads/Prism (native, text chunks), desktop app →
// a folder you pick, a plain browser → ordinary downloads.
async function openExportSink() {
    const el = window.electronAPI && window.electronAPI.exportFiles;
    if (el) {
        const dir = await el.pickFolder(); if (!dir) return null;
        return {
            where: dir,
            open: async (name) => (await el.open(dir, name)).id,
            write: (h, text) => el.write(h, text),
            close: (h) => el.close(h, false),
            discard: (h) => el.close(h, true)
        };
    }
    if (nativeAudio.available) {
        return {
            where: "Downloads/Prism",
            open: async (name) => (await nativeAudio.raw("saveFileStart", { name, mime: "application/json" })).token,
            write: (h, text) => nativeAudio.raw("saveFileChunk", { token: h, text }),
            close: async (h) => (await nativeAudio.raw("saveFileEnd", { token: h }))?.path || "Downloads",
            discard: (h) => nativeAudio.raw("saveFileEnd", { token: h, cancel: true }).catch(() => {})
        };
    }
    const files = new Map(); let seq = 0;
    return {
        where: "your downloads",
        open: async (name) => { files.set(++seq, { name, pieces: [] }); return seq; },
        write: async (h, text) => { files.get(h).pieces.push(text); },
        close: async (h) => {
            const f = files.get(h); files.delete(h);
            const url = URL.createObjectURL(new Blob(f.pieces, { type: "application/json" })), a = document.createElement("a");
            a.href = url; a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
            return f.name;
        },
        discard: async (h) => { files.delete(h); }
    };
}
// Writes through the sink in pieces of a few MB (the Android bridge and IPC both prefer that).
function exportWriter(sink, handle) {
    const LIMIT = 2 * 1024 * 1024;
    let buf = [], size = 0;
    const flush = async () => { if (!size) return; const text = buf.join(""); buf = []; size = 0; await sink.write(handle, text); };
    return {
        async write(text) {
            for (let i = 0; i < text.length; i += LIMIT) {
                const piece = text.length <= LIMIT ? text : text.slice(i, i + LIMIT);
                buf.push(piece); size += piece.length;
                if (size >= LIMIT) await flush();
            }
        },
        flush
    };
}

async function openExportDialog() {
    if (!exportEls.overlay) return;
    exportEls.overlay.style.display = "flex";
    exportEls.options.hidden = false; exportEls.go.hidden = false; exportEls.go.disabled = true;
    setText(exportEls.cancel, "Cancel");
    segSet("export-size", String(exportPrefs.size));
    for (const k of EXPORT_PICKS) exportEls[k].checked = exportPrefs[k] !== false;
    setExportProgress(null);
    setExportStatus("Measuring your library…");
    await refreshExportSummary();
}
const exportOpts = () => Object.fromEntries(EXPORT_PICKS.map((k) => [k, !!exportEls[k].checked]));
// What the data file holds, for its name and so Import knows what to ask.
const exportContents = (o) => ["library", "stats", "settings", "themes"].filter((k) => (k === "library" ? o.songs : o[k]));
function dataFileName(o, stamp) {
    const c = exportContents(o);
    if (c.length === 1 && c[0] === "stats") return `prism-listening-${stamp}.json`;
    if (!o.songs && !o.stats) return `prism-settings-${stamp}.json`;
    return `prism-data-${stamp}.json`;
}
let exportPlanCache = null;
async function refreshExportSummary() {
    const opts = exportOpts();
    exportEls.covers.disabled = !opts.songs;
    if (exportEls.sizeRow) exportEls.sizeRow.hidden = !opts.songs;
    if (!exportContents(opts).length) { setExportStatus("Pick at least one thing to export.", "error"); exportEls.go.disabled = true; return; }
    const plan = await planExport(opts);
    exportPlanCache = { opts, plan };
    const sink = window.electronAPI?.exportFiles ? "a folder you choose" : nativeAudio.available ? "Downloads/Prism" : "your downloads";
    if (!opts.songs) {
        const n = plan.stats ? plan.stats.listenTimes.length : 0;
        setExportStatus(`1 small file${opts.stats ? ` · listening time for ${n} ${n === 1 ? "song" : "songs"}` : ""}, saved to ${sink}.`);
        exportEls.go.disabled = false;
        return;
    }
    const songs = Object.values(playlists).reduce((n, pl) => n + (pl.songs || []).length, 0);
    const bytes = plan.assets.reduce((t, a) => t + assetLineLength(a), 0) + 200000;
    const limit = Number(exportPrefs.size) * 1e6;
    const parts = splitParts(plan, limit).length;
    setExportStatus(`${songs} ${songs === 1 ? "song" : "songs"} · about ${formatBytes(bytes)} → 1 data file + ${parts} media ${parts === 1 ? "file" : "files"}, saved to ${sink}.`
        + (!limit && bytes > 400e6 ? " One big file may be too large to save or import — splitting is safer." : ""));
    exportEls.go.disabled = false;
}
function closeExportDialog() {
    if (exportJob) { exportJob.cancelled = true; return; }
    if (exportEls.overlay) exportEls.overlay.style.display = "none";
}
async function runExport() {
    if (exportJob) return;
    const opts = exportOpts();
    if (!exportContents(opts).length) return;
    let sink;
    try { sink = await openExportSink(); } catch (e) { setExportStatus(`Couldn't start saving: ${errorText(e)}`, "error"); return; }
    if (!sink) return; // folder picker cancelled
    const job = exportJob = { cancelled: false };
    noteActivity("exporting the library");
    exportEls.options.hidden = true; exportEls.go.hidden = true; setText(exportEls.cancel, "Stop");
    setExportStatus("");
    const stamp = new Date().toISOString().slice(0, 10), exportId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let handle = null, written = [], done = 0;
    try {
        setExportProgress(0, "Getting ready…");
        const plan = exportPlanCache && JSON.stringify(exportPlanCache.opts) === JSON.stringify(opts) ? exportPlanCache.plan : await planExport(opts);
        const parts = splitParts(plan, Number(exportPrefs.size) * 1e6);
        const N = parts.length, totalBytes = plan.assets.reduce((t, a) => t + a.size, 0) || 1;
        const exportedAt = new Date().toISOString();
        // The data file first: whichever of library, listening time and settings were picked,
        // one per line, no media.
        const contents = exportContents(opts), lines = [];
        if (plan.library) lines.push(`"library":${JSON.stringify(plan.library)}`);
        if (plan.stats) lines.push(`"stats":${JSON.stringify(plan.stats)}`);
        if (opts.settings || opts.themes) lines.push(`"settings":${JSON.stringify(await collectSettings(opts))}`);
        handle = await sink.open(dataFileName(opts, stamp));
        const dw = exportWriter(sink, handle);
        await dw.write(JSON.stringify({ spootify: EXPORT_FORMAT, version: 5, kind: "data", exportId, parts: N, contents, exportedAt }).slice(0, -1) + ",\n");
        await dw.write(lines.join(",\n") + "\n}\n");
        await dw.flush();
        written.push(await sink.close(handle)); handle = null;
        for (let p = 0; p < N; p++) {
            if (job.cancelled) break;
            const name = N === 1 ? `prism-media-${stamp}.json` : `prism-media-${stamp}-part${String(p + 1).padStart(2, "0")}-of${String(N).padStart(2, "0")}.json`;
            handle = await sink.open(name);
            const w = exportWriter(sink, handle);
            const header = JSON.stringify({ spootify: EXPORT_FORMAT, version: 5, kind: "media", exportId, part: p + 1, parts: N, exportedAt });
            await w.write(header.slice(0, -1) + ",\n");
            await w.write(`"assets":{\n`);
            let first = true;
            for (const a of parts[p]) {
                if (job.cancelled) break;
                const blob = await getBlob(a.mid);
                const data = blob ? await blobToDataUrl(blob) : null;
                if (data) { await w.write(`${first ? "" : ","}${JSON.stringify(a.ref)}:{"type":"${a.type}","data":"`); await w.write(data); await w.write(`"}\n`); first = false; }
                done += a.size;
                setExportProgress(done / totalBytes, N > 1 ? `File ${p + 1} of ${N} · ${formatBytes(done)} of ${formatBytes(totalBytes)}` : `${formatBytes(done)} of ${formatBytes(totalBytes)}`);
            }
            if (job.cancelled) break;
            await w.write("}}\n"); await w.flush();
            written.push(await sink.close(handle)); handle = null;
        }
        if (job.cancelled) {
            if (handle) await sink.discard(handle);
            setExportProgress(null);
            setExportStatus(written.length ? `Stopped. ${written.length} finished ${written.length === 1 ? "file was" : "files were"} kept in ${sink.where} — they're not a full export on their own.` : "Stopped. Nothing was saved.", "error");
        } else {
            setExportProgress(1, "Done");
            setExportStatus(N ? `Saved 1 data file and ${N} media ${N === 1 ? "file" : "files"} to ${sink.where}. Keep them together: Import needs the data file and every media file (pick them all at once).`
                : `Saved to ${sink.where}. Import it on its own${opts.stats ? ": listening time is added onto songs with the same title and artist" : ""}.`, "success");
            showToast(`Exported · ${written.length} ${written.length === 1 ? "file" : "files"}`);
        }
    } catch (e) {
        console.error("Export failed", e);
        if (handle) { try { await sink.discard(handle); } catch {} }
        setExportProgress(null);
        setExportStatus(`Export failed: ${errorText(e)}${written.length ? ` (${written.length} ${written.length === 1 ? "file" : "files"} saved before that)` : ""}`, "error");
    } finally {
        exportJob = null; noteActivity(null);
        setText(exportEls.cancel, "Close");
    }
}
if (exportLibraryBtn) exportLibraryBtn.addEventListener("click", openExportDialog);
if (exportEls.go) exportEls.go.addEventListener("click", runExport);
if (exportEls.cancel) exportEls.cancel.addEventListener("click", closeExportDialog);
if (exportEls.overlay) exportEls.overlay.addEventListener("click", (e) => { if (e.target === exportEls.overlay && !exportJob) closeExportDialog(); });
if (exportEls.size) exportEls.size.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-value]"); if (!b || exportJob) return;
    exportPrefs.size = Number(b.dataset.value); saveExportPrefs(); segSet("export-size", b.dataset.value); refreshExportSummary();
});
for (const key of EXPORT_PICKS) {
    const el = exportEls[key];
    if (el) el.addEventListener("change", () => { exportPrefs[key] = el.checked; saveExportPrefs(); refreshExportSummary(); });
}

function showImportChoice() {
    return new Promise((resolve) => {
        const overlay = $("import-choice-overlay");
        if (!overlay) { resolve(null); return; }
        overlay.style.display = "flex";
        const cleanup = () => {
            overlay.style.display = "none";
            $("import-cancel-btn").removeEventListener("click", onCancel);
            $("import-append-btn").removeEventListener("click", onAppend);
            $("import-replace-btn").removeEventListener("click", onReplace);
            overlay.removeEventListener("click", onOverlay);
            document.removeEventListener("keydown", onKey);
        };
        const onCancel = () => { cleanup(); resolve(null); };
        const onAppend = () => { cleanup(); resolve("append"); };
        const onReplace = () => { cleanup(); resolve("replace"); };
        const onKey = (e) => { if (e.key === "Escape") onCancel(); };
        const onOverlay = (e) => { if (e.target === overlay) onCancel(); };
        $("import-cancel-btn").addEventListener("click", onCancel);
        $("import-append-btn").addEventListener("click", onAppend);
        $("import-replace-btn").addEventListener("click", onReplace);
        overlay.addEventListener("click", onOverlay);
        document.addEventListener("keydown", onKey);
    });
}

// ── IMPORT ── Pick one file (an older export) or every part of a split export at once.
// Split exports are read line by line, one song's audio at a time, so even a few GB
// import without loading whole files into memory.
async function* fileLines(file) {
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    let pieces = [];
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        let start = 0, nl;
        while ((nl = value.indexOf("\n", start)) !== -1) { pieces.push(value.slice(start, nl)); yield pieces.join(""); pieces = []; start = nl + 1; }
        if (start < value.length) pieces.push(value.slice(start));
    }
    if (pieces.length) yield pieces.join("");
}
async function readExportHeader(file) {
    try {
        const head = await file.slice(0, 4096).text();
        if (!head.startsWith(`{"spootify":"${EXPORT_FORMAT}"`)) return null;
        const line = head.split("\n")[0];
        return JSON.parse(line.replace(/,\s*$/, "") + "}");
    } catch { return null; }
}
const refOf = (v) => (v && typeof v === "object" && v.assetRef ? v.assetRef : null);
async function dataUrlToStoredBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:") || dataUrl === DEFAULT_ART || dataUrl === LEGACY_DEFAULT_ART) return null;
    let blob = null;
    try { blob = await (await fetch(dataUrl)).blob(); } catch { blob = dataUrlToBlob(dataUrl); }
    return blob ? storeBlob(blob) : null;
}
// The asset refs an import will actually use (Merge skips songs a same-named playlist already has).
function neededRefs(lib, mode) {
    const need = new Set(), add = (v) => { const r = refOf(v); if (r) need.add(r); };
    for (const [name, ipl] of Object.entries(lib.playlists || {})) {
        if (name === LIKED_SOURCE) continue;
        const existing = mode === "append" && playlists[name] ? new Set(playlists[name].songs.map((s) => s.id)) : null;
        if (!existing) add(ipl.art);
        for (const s of ipl.songs || []) if (!existing || !existing.has(s.id)) { add(s.fileSrc); add(s.art); }
    }
    return need;
}

// Puts an imported library in place. mediaFor(value) → stored media id (or null) for a
// song's / playlist's art or audio. Returns how many songs were left out (audio missing).
async function applyImportedLibrary(imp, mode, mediaFor) {
    const refToMedia = new Map(); // asset ref → media id, so liked songs and history follow
    const resolve = async (v) => { const id = await mediaFor(v); const r = refOf(v); if (r && id) refToMedia.set(r, id); return id; };
    const seededAssets = new Set();
    const seedStats = (s, mediaId) => {
        const st = s.stats, ref = refOf(s.fileSrc);
        if (!st || !(st.plays > 0 || st.seconds > 0 || st.skips > 0) || (ref && seededAssets.has(ref))) return;
        if (ref) seededAssets.add(ref);
        const entry = statsEntryFor({ id: s.id, mediaId, title: s.title, artist: s.artist });
        entry.plays += Number(st.plays) || 0; entry.seconds += Number(st.seconds) || 0;
        if (Number(st.skips) > 0) entry.skips = (entry.skips || 0) + Number(st.skips);
    };
    let skipped = 0;
    const importSong = async (s) => {
        const mediaId = await resolve(s.fileSrc);
        if (!mediaId && s.fileSrc) { skipped++; return null; } // its audio is in a part that wasn't picked
        const artId = await resolve(s.art);
        const fileSrc = mediaId ? await getBlobUrl(mediaId) : null;
        const artUrl = artId ? await getBlobUrl(artId) : DEFAULT_ART;
        seedStats(s, mediaId);
        const rKey = mediaId || "id:" + s.id;
        if (s.rating >= 1 && s.rating <= 5 && !ratings[rKey]) { ratings[rKey] = Math.round(s.rating); saveRatings(); }
        return { id: Number.isFinite(s.id) ? s.id : newSongId(), title: s.title, artist: s.artist, timestamp: s.timestamp, duration: s.duration, loudness: s.loudness, src: typeof s.src === "string" ? s.src.slice(0, 200) : undefined, mediaId, artId, fileSrc, art: artUrl };
    };
    if (mode === "replace") {
        playlists = {}; libraryVersion++;
        queue = [];
        likedSongs = new Map(); likedVersion++;
        resetPlayOrder();
    }
    const incoming = imp.playlists || {};
    for (const name of Object.keys(incoming)) {
        if (name === LIKED_SOURCE) continue;
        const ipl = incoming[name];
        if (playlists[name]) {
            const existingIds = new Set(playlists[name].songs.map((s) => s.id));
            for (const s of ipl.songs || []) {
                if (existingIds.has(s.id)) continue;
                const song = await importSong(s); if (song) playlists[name].songs.push(song);
            }
        } else {
            const songs = [];
            for (const s of ipl.songs || []) { const song = await importSong(s); if (song) songs.push(song); }
            const plArtId = await resolve(ipl.art);
            const plArtUrl = plArtId ? await getBlobUrl(plArtId) : DEFAULT_ART;
            playlists[name] = { name, artId: plArtId, art: plArtUrl, sort: ipl.sort || defaultSort(), pinned: !!ipl.pinned, order: Number.isFinite(ipl.order) ? ipl.order : undefined, songs };
        }
    }
    if (imp.clock && Array.isArray(imp.clock.g) && imp.clock.g.length === 168) {
        const c = loadClock();
        if (mode === "replace") { c.since = Number(imp.clock.since) || c.since; c.g = imp.clock.g.map((v) => Number(v) || 0); }
        else { c.since = Math.min(c.since, Number(imp.clock.since) || c.since); imp.clock.g.forEach((v, i) => { c.g[i] += Number(v) || 0; }); }
        saveClock(true);
    }
    const keyFor = (ref) => refToMedia.get(ref) || (String(ref).startsWith("id:") ? ref : null);
    for (const [ref, t] of Array.isArray(imp.liked) ? imp.liked : []) { const k = keyFor(ref); if (k && !likedSongs.has(k)) likedSongs.set(k, Number(t) || Date.now()); }
    likedVersion++;
    for (const [ym, month] of Object.entries(imp.listenLog || {})) {
        if (!/^\d{4}-\d{2}$/.test(ym) || !month || typeof month !== "object") continue;
        const cur = loadLogMonth(ym);
        for (const day in month) for (const ref in month[day]) {
            const k = keyFor(ref), v = month[day][ref]; if (!k || !Array.isArray(v)) continue;
            const d = cur[day] || (cur[day] = {}), e = d[k] || (d[k] = [0, 0]);
            e[0] += Number(v[0]) || 0; e[1] += Number(v[1]) || 0;
        }
        logDirty.add(ym);
    }
    dedupeSongIds();
    currentPlaylist = imp.currentPlaylist && playlists[imp.currentPlaylist] ? imp.currentPlaylist : Object.keys(playlists)[0] || null;
    saveListenStats(true); saveListenLog(true); refreshStatsUi();
    await saveLibrary(); renderPlaylists(); renderQueue();
    if (currentPlaylist) loadPlaylistPage(currentPlaylist); else showHome();
    gcUnreferencedBlobs(); // a "Replace" import leaves the old library's media behind
    return skipped;
}

async function importSplitExport(files) {
    const headers = [];
    for (const f of files) { const h = await readExportHeader(f); if (h) headers.push({ file: f, h }); }
    // Version 5: a data file (kind "data") plus media parts 1…N. Version 4: the library sits in part 1.
    const first = headers.find((x) => x.h.kind === "data") || headers.find((x) => !x.h.kind && x.h.part === 1);
    if (!first) { await showMessage("Data file is missing", "Pick the data file (prism-data-…, or spootify-data-… from older exports) together with the media files from the same export."); return; }
    const set = headers.filter((x) => x.h.exportId === first.h.exportId)
        .sort((a, b) => (a.h.kind === "data" ? -1 : b.h.kind === "data" ? 1 : a.h.part - b.h.part));
    const media = set.filter((x) => x.h.kind !== "data");
    // Older files don't list their contents: they always have a library (and maybe settings).
    const contents = Array.isArray(first.h.contents) ? first.h.contents : ["library", "settings"];
    const hasLibrary = contents.includes("library");
    let mode = "append";
    if (hasLibrary) {
        const have = new Set(media.map((x) => x.h.part)), total = Number.isFinite(Number(first.h.parts)) ? Number(first.h.parts) : media.length;
        const missing = []; for (let i = 1; i <= total; i++) if (!have.has(i)) missing.push(i);
        if (missing.length) {
            const ok = await showPrompt({ title: `${missing.length} of ${total} media ${total === 1 ? "file" : "files"} missing`, message: `Part${missing.length === 1 ? "" : "s"} ${missing.join(", ")} ${missing.length === 1 ? "wasn't" : "weren't"} picked. Songs stored in ${missing.length === 1 ? "it" : "them"} will be left out. Import the rest anyway?`, confirmText: "Import anyway" });
            if (!ok) return;
        }
        mode = await showImportChoice(); if (!mode) return;
    } else {
        const what = { stats: "listening time", settings: "settings", themes: "custom themes" };
        const list = contents.map((k) => what[k]).filter(Boolean);
        const ok = await showPrompt({ title: "Import this file?", message: `It has your ${list.join(", ").replace(/, ([^,]*)$/, " and $1")}.`
            + (contents.includes("stats") ? " Listening time is added onto yours: songs with the same title and artist are merged, and songs you don't have show up as removed in Stats (tap one to rename and merge it)." : "")
            + (contents.includes("settings") || contents.includes("themes") ? " The app restarts afterwards." : ""), confirmText: "Import" });
        if (!ok) return;
    }
    const refToMedia = new Map();
    let lib = null, need = null, settings = null, stats = null;
    const progress = (i, n) => showToast(`Importing… file ${i} of ${n}`, { duration: 600000 });
    for (let i = 0; i < set.length; i++) {
        progress(i + 1, set.length);
        for await (const raw of fileLines(set[i].file)) {
            let line = raw.trim();
            if (!line || line === "}}" || line === "}" || line === '"assets":{' || line.startsWith('{"spootify"')) continue;
            if (line.startsWith('"library":')) { lib = JSON.parse(line.slice(10).replace(/,\s*$/, "")); need = neededRefs(lib, mode); continue; }
            if (line.startsWith('"settings":')) { try { settings = JSON.parse(line.slice(11).replace(/,\s*$/, "")); } catch {} continue; }
            if (line.startsWith('"stats":')) { stats = JSON.parse(line.slice(8).replace(/,\s*$/, "")); continue; }
            if (line.startsWith(",")) line = line.slice(1);
            const m = /^"([^"]+)":/.exec(line); if (!m) continue;
            if (need && !need.has(m[1])) continue;
            const asset = JSON.parse(line.slice(m[0].length));
            const id = await dataUrlToStoredBlob(asset && asset.data);
            if (id) refToMedia.set(m[1], id);
        }
    }
    if (hasLibrary && !lib) throw new Error("No library found in the data file");
    const notes = [];
    if (lib) {
        showToast("Importing… putting it together", { duration: 600000 });
        const skipped = await applyImportedLibrary(lib, mode, async (v) => refToMedia.get(refOf(v)) || null);
        notes.push(skipped ? `Library imported · ${skipped} ${skipped === 1 ? "song" : "songs"} left out (missing parts)` : "Library imported");
    }
    // After the library, so its songs are there to match by name.
    if (stats) {
        const r = mergeListenTimes(stats);
        notes.push(`Listening time added · ${r.matched} matched${r.added ? `, ${r.added} as removed songs` : ""}`);
    }
    if (notes.length) showToast(notes.join(" · "), { duration: 6000 });
    if (settings && (!lib || await showPrompt({ title: "Restore settings and themes?", message: "This export also has settings and/or custom themes. Use its settings in place of yours and add its themes? The app restarts to apply them.", confirmText: "Restore" }))) {
        showToast("Restoring settings…", { duration: 600000 });
        await restoreSettings(settings);
        location.reload();
    }
}

if (importLibraryInput) importLibraryInput.addEventListener("change", async () => {
    const files = [...importLibraryInput.files]; if (!files.length) return;
    if (blockedBySync()) { importLibraryInput.value = ""; return; }
    noteActivity(`importing a library (${files.length} ${files.length === 1 ? "file" : "files"})`);
    try {
        if ((await Promise.all(files.map(readExportHeader))).some(Boolean)) { await importSplitExport(files); return; }
        if (files.length > 1) { await showMessage("One file at a time", "Older exports are a single file — pick just that one."); return; }
        // An older single-file export (format 3 and before): the media are data URLs inside it.
        const mode = await showImportChoice(); if (!mode) return;
        showToast("Importing…", { duration: 600000 });
        const imp = JSON.parse(await files[0].text());
        const assets = imp.assets || {};
        const stored = new Map(); // copies of one song share an asset: store it once
        await applyImportedLibrary(imp, mode, async (v) => {
            const ref = refOf(v);
            if (ref && stored.has(ref)) return stored.get(ref);
            const id = await dataUrlToStoredBlob(ref ? assets[ref]?.data : v);
            if (ref && id) stored.set(ref, id);
            return id;
        });
        showToast("Library imported");
    } catch (e) {
        console.error("Import failed", e);
        showToast("Import failed", { duration: 1500 });
        await showMessage("Import Failed", `The file could not be imported${e && e.message ? ` (${e.message})` : ""}.`);
    } finally { importLibraryInput.value = ""; noteActivity(null); }
});
if ($("problem-copy-btn")) $("problem-copy-btn").addEventListener("click", async () => {
    const text = loadProblems().map((p) => `${new Date(p.at).toLocaleString()}${p.n > 1 ? ` (${p.n}x)` : ""}: ${p.text}`).join("\n") || "No problems logged.";
    try { await navigator.clipboard.writeText(text); showToast("Copied"); } catch { showToast("Couldn't copy"); }
});
if ($("problem-clear-btn")) $("problem-clear-btn").addEventListener("click", () => { try { localStorage.removeItem(PROBLEMS_KEY); } catch {} renderProblems(); });
// Libraries saved before ids were made unique can contain two songs with one id;
// give later duplicates fresh ids so removing or editing one never hits the other.
function dedupeSongIds() {
    const seen = new Set(); let changed = false;
    for (const s of Object.values(playlists).flatMap((pl) => pl.songs || [])) {
        if (Number.isFinite(s.id) && s.id > lastSongId) lastSongId = s.id;
    }
    for (const pl of Object.values(playlists)) for (const s of pl.songs || []) {
        if (seen.has(s.id) || s.id == null) { s.id = newSongId(); changed = true; }
        seen.add(s.id);
    }
    return changed;
}

// ── LIKED SONGS ──
// Liked by media (like stats), so copies of a song in several playlists share one heart.
function isLiked(song) { return !!song && likedSongs.has(statsKeyFor(song)); }
function getLikedSongs() {
    const sig = libraryVersion + ":" + likedVersion + ":" + (likedSort ? likedSort.key + likedSort.dir : "");
    if (getLikedSongs.cache && getLikedSongs.cache.sig === sig) return getLikedSongs.cache.list;
    const seen = new Set(), rows = [];
    for (const name of getOrderedPlaylistNames()) for (const s of playlists[name].songs || []) {
        const k = statsKeyFor(s);
        if (!likedSongs.has(k) || seen.has(k)) continue;
        seen.add(k); rows.push(s);
    }
    const list = likedSort && SORT_COMPARATORS[likedSort.key] ? sortSongs(rows, likedSort)
        : rows.sort((a, b) => (likedSongs.get(statsKeyFor(b)) || 0) - (likedSongs.get(statsKeyFor(a)) || 0));
    getLikedSongs.cache = { sig, list };
    return list;
}
function setLiked(song, liked, sourceBtn) {
    const key = statsKeyFor(song); if (!key) return;
    if (liked) likedSongs.set(key, Date.now()); else likedSongs.delete(key);
    likedVersion++;
    haptic(liked ? 15 : 8);
    saveLibrary();
    document.querySelectorAll(`.song-row[data-key="${CSS.escape(key)}"] .like-btn`).forEach((b) => {
        b.classList.toggle("liked", liked); b.innerHTML = liked ? ICONS.heartFill : ICONS.heart;
        const label = `${liked ? "Remove from" : "Save to"} Liked Songs`; b.setAttribute("aria-label", label); b.title = label;
    });
    updateLikeButtons();
    if (sourceBtn) { sourceBtn.classList.remove("pop"); void sourceBtn.offsetWidth; sourceBtn.classList.add("pop"); }
    if (isLikedSource(currentPlaylist) && playlistView.style.display !== "none") renderSongs();
    renderPlaylists();
    if (contextSource === LIKED_SOURCE) renderQueue();
    showToast(liked ? "Added to Liked Songs" : "Removed from Liked Songs");
    if (liked) checkMilestonesSoon();
    if (currentTrack && statsKeyFor(currentTrack) === key) syncNativePlayback(); // the lock screen's heart
}
function toggleLike(song, btn) { if (song) setLiked(song, !isLiked(song), btn); }
function updateLikeButtons() {
    updateRatingButtons();
    if (typeof scheduleMiniState === "function") scheduleMiniState();
    const liked = isLiked(currentTrack), label = `${liked ? "Remove from" : "Save to"} Liked Songs`;
    for (const b of [playerLikeBtn, miniLikeBtn, npLikeBtn]) {
        if (!b) continue;
        b.hidden = !currentTrack;
        b.classList.toggle("liked", liked);
        b.innerHTML = liked ? ICONS.heartFill : ICONS.heart;
        b.setAttribute("aria-label", label); b.title = label;
    }
}
for (const b of [playerLikeBtn, miniLikeBtn, npLikeBtn]) if (b) b.addEventListener("click", (e) => { e.stopPropagation(); toggleLike(currentTrack, b); });

// ── QUEUE / CONTEXT MENUS ──
function addSongToQueue(songOrId, playlistName) {
    const found = typeof songOrId === "object" ? { song: songOrId, playlistName: playlistName || homePlaylistOf(songOrId) || currentPlaylist } : findSongById(songOrId);
    if (!found || !found.song) return;
    queue.push({ song: found.song, playlistName: found.playlistName });
    haptic(10); saveLibrary(); renderQueue();
    showToast(`Added to queue · ${found.song.title}`);
}
function copySongToPlaylist(song, target) {
    if (!song || !playlists[target]) return;
    playlists[target].songs.push({ ...song, id: newSongId(), timestamp: Date.now() });
    saveLibrary(); renderSongs(); renderPlaylists();
    showToast(`Added to ${target}`);
}
async function removeSongFromPlaylist(playlistName, songId) {
    if (blockedBySync()) return;
    const pl = playlists[playlistName]; if (!pl) return;
    const index = pl.songs.findIndex((s) => s.id === songId); if (index === -1) return;
    const [song] = pl.songs.splice(index, 1);
    const binned = addToTrash({ type: "song", playlistName, index, song });
    await saveLibrary(); renderSongs(); renderPlaylists(); renderQueue();
    offerUndo(`Removed · ${song.title}`, async () => {
        const target = playlists[playlistName]; if (!target) return;
        dropFromTrash(binned);
        target.songs.splice(Math.min(index, target.songs.length), 0, song);
        await saveLibrary(); renderSongs(); renderPlaylists(); renderQueue();
    }, [song.mediaId, song.artId]);
}

async function deletePlaylist(name) {
    if (blockedBySync()) return;
    const pl = playlists[name]; if (!pl) return;
    const confirmed = await showPrompt({ title: "Delete Playlist", message: `Delete "${name}" and all its songs?`, confirmText: "Delete", danger: true });
    if (!confirmed || playlists[name] !== pl) return;
    const removedQueue = queue.map((item, i) => ({ item, i })).filter((x) => x.item.playlistName === name);
    const wasOpen = currentPlaylist === name;
    delete playlists[name]; queue = queue.filter(i => i.playlistName !== name);
    if (contextSource === name) resetPlayOrder();
    if (wasOpen) currentPlaylist = null;
    const binned = addToTrash({ type: "playlist", name, playlist: pl });
    await saveLibrary(); renderPlaylists(); renderQueue();
    if (wasOpen) showHome();
    offerUndo(`Deleted "${name}"`, async () => {
        if (playlists[name]) return;
        dropFromTrash(binned);
        playlists[name] = pl;
        for (const { item, i } of removedQueue) queue.splice(Math.min(i, queue.length), 0, item);
        await saveLibrary(); renderPlaylists(); renderQueue();
        if (wasOpen) loadPlaylistPage(name);
    }, [pl.artId, ...(pl.songs || []).flatMap((s) => [s.mediaId, s.artId])]);
}

// ── RECENTLY DELETED ──
// Removed songs and deleted playlists wait here for TRASH_DAYS before they (and any
// media nothing else uses) are gone for good. Restoring puts a song back where it was,
// recreating its playlist if that was deleted too.
const TRASH_DAYS = 30;
const binOverlay = $("bin-overlay"), binList = $("bin-list");
function addToTrash(item) {
    const entry = { id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), deletedAt: Date.now(), ...item };
    trash.unshift(entry);
    if (trash.length > 1000) trash.length = 1000;
    updateBinButton();
    return entry;
}
function dropFromTrash(entry) {
    const i = trash.indexOf(entry);
    if (i !== -1) { trash.splice(i, 1); updateBinButton(); if (isShown(binOverlay)) renderBin(); }
}
function purgeOldTrash() {
    const cutoff = Date.now() - TRASH_DAYS * 86400000, before = trash.length;
    trash = trash.filter((t) => (t.deletedAt || 0) > cutoff);
    return trash.length !== before;
}
function trashSongs() { return trash.flatMap((t) => (t.song ? [t.song] : t.playlist?.songs || [])); }
function updateBinButton() {
    const label = $("bin-count"); if (label) label.textContent = trash.length ? String(trash.length) : "";
}
function daysLeftText(t) {
    const left = Math.ceil((t.deletedAt + TRASH_DAYS * 86400000 - Date.now()) / 86400000);
    return left <= 1 ? "Deleted for good tomorrow" : `${left} days left`;
}
async function openBin() {
    if (!binOverlay) return;
    purgeOldTrash();
    binOverlay.style.display = "flex";
    renderBin();
    if (await hydrateSongArt(trashSongs())) renderBin();
}
function closeBin() { if (binOverlay) binOverlay.style.display = "none"; }
function renderBin() {
    if (!binList) return;
    const empty = $("bin-empty-btn"); if (empty) empty.hidden = !trash.length;
    if (!trash.length) { binList.innerHTML = '<div class="stats-empty">Nothing here. Songs you remove and playlists you delete stay here for 30 days.</div>'; return; }
    binList.innerHTML = trash.map((t) => {
        const pl = t.playlist, isPl = t.type === "playlist";
        const art = isPl ? ((pl.songs || []).find((s) => s.art && s.art !== DEFAULT_ART)?.art || DEFAULT_ART) : (t.song.art || DEFAULT_ART);
        const title = isPl ? t.name : t.song.title, n = isPl ? (pl.songs || []).length : 0;
        const sub = isPl ? `Playlist · ${n} ${n === 1 ? "song" : "songs"}` : `${t.song.artist || "Unknown Artist"} · from ${t.playlistName}`;
        return `<div class="stats-row bin-row${isPl ? " bin-playlist" : ""}" data-id="${escapeHtml(t.id)}"><img src="${escapeHtml(art)}" alt="" loading="lazy">
            <div class="stats-row-info"><strong>${escapeHtml(title || "Unknown")}</strong><span>${escapeHtml(sub)}</span></div>
            <div class="stats-row-nums bin-when"><span>${escapeHtml(getRelativeTimeString(t.deletedAt))}</span><span>${daysLeftText(t)}</span></div>
            <button type="button" class="utility-btn" data-act="restore">Restore</button>
            <button type="button" class="bin-delete" data-act="delete" aria-label="Delete for good" title="Delete for good">${ICONS.close}</button></div>`;
    }).join("");
}
async function restoreTrashItem(id) {
    const t = trash.find((x) => x.id === id); if (!t) return;
    let where;
    if (t.type === "song") {
        if (!playlists[t.playlistName]) await createPlaylist(t.playlistName);
        const song = t.song;
        if (findSongById(song.id)) song.id = newSongId();
        await hydrateSongArt([song]);
        const songs = playlists[t.playlistName].songs;
        songs.splice(Math.min(Number.isFinite(t.index) ? t.index : songs.length, songs.length), 0, song);
        where = t.playlistName;
    } else {
        const name = playlists[t.name] ? uniquePlaylistName(t.name) : t.name, pl = t.playlist;
        for (const s of pl.songs || []) if (findSongById(s.id)) s.id = newSongId();
        await hydrateSongArt(pl.songs || []);
        pl.art = (pl.artId && await getBlobUrl(pl.artId)) || DEFAULT_ART;
        normalizePlaylistOrder();
        pl.name = name; pl.order = Object.keys(playlists).length;
        playlists[name] = pl;
        where = name;
    }
    dropFromTrash(t);
    await saveLibrary(); renderPlaylists(); renderSongs(); renderQueue(); renderBin();
    showToast(t.type === "song" ? `Restored to ${where}` : `Restored "${where}"`, { action: "Open", onAction: () => { closeBin(); closeSettings(); loadPlaylistPage(where); } });
}
async function deleteTrashItem(id) {
    if (blockedBySync()) return;
    const t = trash.find((x) => x.id === id); if (!t) return;
    const what = t.type === "song" ? `"${t.song.title}"` : `the playlist "${t.name}"`;
    if (!await showPrompt({ title: "Delete for good?", message: `${what} will be gone for good.`, confirmText: "Delete", danger: true })) return;
    dropFromTrash(t);
    await saveLibrary(); renderBin(); gcUnreferencedBlobs();
}
async function emptyBin() {
    if (blockedBySync()) return;
    if (!trash.length) return;
    if (!await showPrompt({ title: "Empty Recently deleted?", message: `${trash.length} ${trash.length === 1 ? "item" : "items"} will be gone for good. This can't be undone.`, confirmText: "Empty", danger: true })) return;
    trash = []; updateBinButton();
    await saveLibrary(); renderBin(); gcUnreferencedBlobs();
    showToast("Recently deleted emptied");
}
if (binList) binList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]"), row = e.target.closest(".bin-row"); if (!btn || !row) return;
    if (btn.dataset.act === "restore") restoreTrashItem(row.dataset.id); else deleteTrashItem(row.dataset.id);
});
if ($("bin-empty-btn")) $("bin-empty-btn").addEventListener("click", emptyBin);
if ($("bin-close-btn")) $("bin-close-btn").addEventListener("click", closeBin);
if (binOverlay) binOverlay.addEventListener("click", (e) => { if (e.target === binOverlay) closeBin(); });
if ($("open-bin-btn")) $("open-bin-btn").addEventListener("click", openBin);

// ── DUPLICATE FINDER ──
// Two kinds of duplicate: the same song more than once in one playlist, and the same
// song stored as separate audio files (added twice from disk or a link). A song is
// "the same" when it shares the audio file, or has the same title and artist and a
// length within a few seconds. Fixing a group keeps one file for all of them (plays,
// likes and history are merged onto it) and moves extra copies in a playlist to
// Recently deleted. "Not duplicates" hides a group for good.
const DUP_IGNORE_KEY = "spootify-dup-ignore";
const dupOverlay = $("dup-overlay"), dupList = $("dup-list");
let dupGroups = [];
function loadDupIgnore() { try { const a = JSON.parse(localStorage.getItem(DUP_IGNORE_KEY) || "[]"); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); } }
function songIdentity(s) { return normalizeText(s.title).replace(/\s+/g, " ").trim() + "|" + artistKey(s.artist); }
function findDuplicateGroups() {
    const entries = [];
    for (const [playlistName, pl] of Object.entries(playlists)) for (const s of pl.songs || []) entries.push({ song: s, playlistName });
    const parent = entries.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
    const byMedia = new Map(), byIdent = new Map();
    entries.forEach((e, i) => {
        if (e.song.mediaId) { if (byMedia.has(e.song.mediaId)) join(byMedia.get(e.song.mediaId), i); else byMedia.set(e.song.mediaId, i); }
        const k = songIdentity(e.song); if (!byIdent.has(k)) byIdent.set(k, []); byIdent.get(k).push(i);
    });
    // Same name: only the same song if the lengths agree (a live version or remix with a
    // copied title usually doesn't). Unknown lengths match anything.
    for (const list of byIdent.values()) {
        if (list.length < 2) continue;
        const sorted = [...list].sort((a, b) => (entries[a].song.duration || 0) - (entries[b].song.duration || 0));
        for (let j = 1; j < sorted.length; j++) {
            const d1 = entries[sorted[j - 1]].song.duration || 0, d2 = entries[sorted[j]].song.duration || 0;
            if (!d1 || !d2 || d2 - d1 <= 3) join(sorted[j - 1], sorted[j]);
        }
    }
    const comps = new Map();
    entries.forEach((e, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(e); });
    const ignore = loadDupIgnore(), groups = [];
    for (const list of comps.values()) {
        if (list.length < 2) continue;
        const media = [...new Set(list.map((e) => e.song.mediaId).filter(Boolean))].sort();
        const perPlaylist = new Map();
        for (const e of list) perPlaylist.set(e.playlistName, (perPlaylist.get(e.playlistName) || 0) + 1);
        const extraCopies = [...perPlaylist.values()].reduce((t, n) => t + n - 1, 0);
        if (media.length < 2 && !extraCopies) continue; // one file shared by several playlists: that's normal
        const sig = songIdentity(list[0].song) + "#" + media.join(",") + "#" + [...perPlaylist].map(([n, c]) => n + ":" + c).sort().join(",");
        if (ignore.has(sig)) continue;
        groups.push({ entries: list, media, perPlaylist, extraCopies, sig });
    }
    groups.sort((a, b) => cmpText(a.entries[0].song.title, b.entries[0].song.title));
    return groups;
}
async function openDuplicates() {
    if (!dupOverlay) return;
    dupOverlay.style.display = "flex";
    refreshDuplicates();
}
function refreshDuplicates() {
    dupGroups = findDuplicateGroups();
    renderDuplicates();
    hydrateSongArt(dupGroups.flatMap((g) => g.entries.map((e) => e.song))).then((c) => { if (c && isShown(dupOverlay)) renderDuplicates(); });
}
function closeDuplicates() { if (dupOverlay) dupOverlay.style.display = "none"; }
function renderDuplicates() {
    if (!dupList) return;
    const fixAll = $("dup-fix-all"); if (fixAll) fixAll.hidden = dupGroups.length < 2;
    setText($("dup-summary"), dupGroups.length ? `${dupGroups.length} ${dupGroups.length === 1 ? "song has" : "songs have"} duplicates` : "");
    if (!dupGroups.length) { dupList.innerHTML = '<div class="stats-empty">No duplicates found — every song in your library is there once.</div>'; return; }
    dupList.innerHTML = dupGroups.map((g, gi) => {
        const s = g.entries.find((e) => e.song.art && e.song.art !== DEFAULT_ART)?.song || g.entries[0].song;
        const where = [...g.perPlaylist].map(([n, c]) => `<span class="dup-chip${c > 1 ? " warn" : ""}">${c > 1 ? c + "× in " : ""}${escapeHtml(n)}</span>`).join("");
        const notes = [];
        if (g.extraCopies) notes.push(`${g.extraCopies} extra ${g.extraCopies === 1 ? "copy" : "copies"} in the same playlist`);
        if (g.media.length > 1) notes.push(`saved as ${g.media.length} separate files`);
        return `<div class="dup-group" data-index="${gi}"><img src="${escapeHtml(s.art || DEFAULT_ART)}" alt="" loading="lazy">
            <div class="dup-info"><strong>${escapeHtml(s.title || "Unknown")}</strong><span>${escapeHtml(s.artist || "Unknown Artist")}</span>
            <div class="dup-where">${where}</div><em>${escapeHtml(notes.join(" · "))}</em></div>
            <div class="dup-actions"><button type="button" class="utility-btn accent-outline" data-act="fix">Fix</button><button type="button" class="utility-btn" data-act="ignore">Not duplicates</button></div></div>`;
    }).join("");
}
// Move every song using `fromId` onto `toId`, merging what was recorded against it.
function mergeMediaInto(fromId, toId, url, duration) {
    const stamp = (s) => { if (s && s.mediaId === fromId) { s.mediaId = toId; s.fileSrc = url; if (duration) s.duration = duration; } };
    for (const pl of Object.values(playlists)) for (const s of pl.songs || []) stamp(s);
    for (const item of queue) stamp(item?.song);
    for (const s of trashSongs()) stamp(s);
    stamp(contextTrack);
    moveMediaRecords(fromId, toId);
}
// Plays, likes, the star rating and the day-by-day history recorded against one audio
// file, moved onto (or added to) another: when duplicates are merged, and when a trim
// gives a song new audio (which used to lose its rating, its like and its history).
function moveMediaRecords(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const a = listenStats[fromId];
    if (a) {
        const b = listenStats[toId];
        if (!b) listenStats[toId] = a;
        else {
            b.plays += a.plays || 0; b.seconds += a.seconds || 0; b.skips = (b.skips || 0) + (a.skips || 0);
            b.firstPlayed = Math.min(b.firstPlayed || Infinity, a.firstPlayed || Infinity); b.lastPlayed = Math.max(b.lastPlayed || 0, a.lastPlayed || 0);
        }
        delete listenStats[fromId];
    }
    if (likedSongs.has(fromId)) { if (!likedSongs.has(toId)) likedSongs.set(toId, likedSongs.get(fromId)); likedSongs.delete(fromId); likedVersion++; }
    if (ratings[fromId]) { ratings[toId] = Math.max(ratings[toId] || 0, ratings[fromId]); delete ratings[fromId]; saveRatings(); sortedCache.clear(); }
    for (const ym of logMonthKeys()) {
        const month = loadLogMonth(ym); let touched = false;
        for (const day in month) {
            const d = month[day], e = d[fromId]; if (!e) continue;
            const t = d[toId] || (d[toId] = [0, 0]); t[0] += e[0]; t[1] += e[1]; delete d[fromId]; touched = true;
        }
        if (touched) logDirty.add(ym);
    }
}
// ── MERGING LISTENING TIME BY NAME ──
// Imported listening time and renamed removed songs are matched by title + artist,
// ignoring case and extra spaces.
function songNameKey(title, artist) {
    const n = (v) => String(v || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
    return n(title) + "\n" + (n(artist) || "unknown artist");
}
// name → stats key: songs in the library first, then removed songs' snapshots.
function statsNameIndex(exceptKey) {
    const index = new Map();
    for (const pl of Object.values(playlists)) for (const s of pl.songs || []) {
        const k = statsKeyFor(s), n = songNameKey(s.title, s.artist);
        if (k !== exceptKey && !index.has(n)) index.set(n, k);
    }
    for (const [k, e] of Object.entries(listenStats)) {
        const n = songNameKey(e.title, e.artist);
        if (k !== exceptKey && e.title && !index.has(n)) index.set(n, k);
    }
    return index;
}
// Adds an exported `stats` block (see exportListenTimes) onto this device's numbers.
// A song with no match here is kept as a removed song, so renaming it later can merge it.
function mergeListenTimes(data) {
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const index = statsNameIndex();
    let matched = 0, added = 0;
    for (const t of Array.isArray(data && data.listenTimes) ? data.listenTimes : []) {
        if (!t || typeof t.title !== "string" || !t.title.trim()) continue;
        const name = songNameKey(t.title, t.artist);
        let key = index.get(name);
        if (key) matched++; else { key = "name:" + name; index.set(name, key); added++; }
        const found = findSongByStatsKey(key);
        const e = listenStats[key] || (listenStats[key] = { plays: 0, seconds: 0, firstPlayed: Date.now(), lastPlayed: 0, title: t.title, artist: t.artist || "", artId: null });
        if (found) { e.title = found.song.title; e.artist = found.song.artist; e.artId = found.song.artId || null; }
        e.plays += num(t.plays); e.seconds += num(t.seconds);
        if (num(t.skips) > 0) { e.skips = (e.skips || 0) + num(t.skips); e.lastSkipped = Math.max(e.lastSkipped || 0, num(t.lastSkipped)); }
        if (num(t.firstPlayed) > 0) e.firstPlayed = Math.min(e.firstPlayed || Infinity, num(t.firstPlayed));
        e.lastPlayed = Math.max(e.lastPlayed || 0, num(t.lastPlayed));
        if (t.rating >= 1 && t.rating <= 5 && !ratings[key]) { ratings[key] = Math.round(t.rating); saveRatings(); }
        for (const [ym, month] of Object.entries(t.log && typeof t.log === "object" ? t.log : {})) {
            if (!/^\d{4}-\d{2}$/.test(ym) || !month || typeof month !== "object") continue;
            const cur = loadLogMonth(ym);
            for (const day in month) {
                const v = month[day]; if (!Array.isArray(v)) continue;
                const d = cur[day] || (cur[day] = {}), x = d[key] || (d[key] = [0, 0]);
                x[0] += num(v[0]); x[1] += num(v[1]);
            }
            logDirty.add(ym);
        }
    }
    const clock = data && data.clock;
    if (clock && Array.isArray(clock.g) && clock.g.length === 168) {
        const c = loadClock();
        c.since = Math.min(c.since, num(clock.since) || c.since);
        clock.g.forEach((v, i) => { c.g[i] += num(v); });
        saveClock(true);
    }
    saveListenStats(true); saveListenLog(true); refreshStatsUi();
    return { matched, added };
}
// Stats → a removed song → rename it. If the new title + artist match another song (in the
// library or also removed), everything recorded against it is added onto that one.
async function renameRemovedStats(key) {
    const e = listenStats[key]; if (!e || findSongByStatsKey(key)) return;
    const title = await showPrompt({ title: "Rename removed song", message: "Give it the same title and artist as another song to add their listening time together.", confirmText: "Next", input: { value: e.title || "", placeholder: "Title", maxLength: 200 } });
    if (title === null) return;
    const artist = await showPrompt({ title: "Artist", message: `For "${title}".`, confirmText: "Save", input: { value: e.artist || "", placeholder: "Artist", maxLength: 200 } });
    if (artist === null) return;
    const target = statsNameIndex(key).get(songNameKey(title, artist));
    if (!target) {
        e.title = title; e.artist = artist;
        saveListenStats(true); refreshStatsUi(); showToast("Renamed");
        return;
    }
    const found = findSongByStatsKey(target), other = listenStats[target];
    const name = found ? found.song.title : (other && other.title) || title;
    if (!await showPrompt({ title: "Merge listening time?", message: `"${name}" already has ${other ? `${other.plays || 0} plays (${formatListenTime(other.seconds || 0)})` : "no plays yet"}. Add this song's ${e.plays || 0} plays (${formatListenTime(e.seconds || 0)}) and history onto it?`, confirmText: "Merge" })) return;
    moveMediaRecords(key, target);
    const merged = listenStats[target];
    if (merged) { merged.title = found ? found.song.title : name; merged.artist = found ? found.song.artist : (other ? other.artist : artist); if (found) merged.artId = found.song.artId || null; }
    saveListenStats(true); saveListenLog(true); saveLibrary(); refreshStatsUi();
    showToast(`Merged into "${name}"`);
}

async function fixDuplicateGroup(g) {
    const playingKey = statsKeyFor(currentTrack);
    // Keep the file that's playing (swapping it mid-song would cut out), else the most played.
    const keep = g.media.includes(playingKey) ? playingKey
        : [...g.media].sort((a, b) => (listenStats[b]?.plays || 0) - (listenStats[a]?.plays || 0))[0];
    let removed = 0;
    if (keep) {
        const url = await getBlobUrl(keep), keeper = g.entries.find((e) => e.song.mediaId === keep).song;
        for (const m of g.media) if (m !== keep) mergeMediaInto(m, keep, url, keeper.duration);
    }
    // In each playlist keep the copy that's playing, else the one added first.
    const byPl = new Map();
    for (const e of g.entries) { if (!byPl.has(e.playlistName)) byPl.set(e.playlistName, []); byPl.get(e.playlistName).push(e.song); }
    for (const [name, songs] of byPl) {
        if (songs.length < 2 || !playlists[name]) continue;
        songs.sort((a, b) => (b.id === currentTrack?.id) - (a.id === currentTrack?.id) || (a.timestamp || 0) - (b.timestamp || 0));
        for (const s of songs.slice(1)) {
            const list = playlists[name].songs, i = list.indexOf(s); if (i === -1) continue;
            list.splice(i, 1); addToTrash({ type: "song", playlistName: name, index: i, song: s }); removed++;
        }
    }
    return removed;
}
async function fixDuplicates(groups) {
    if (blockedBySync()) return;
    let removed = 0;
    for (const g of groups) removed += await fixDuplicateGroup(g);
    statsIndex = null;
    saveListenStats(true); saveListenLog(true);
    await saveLibrary();
    renderPlaylists(); renderSongs(); renderQueue(); refreshStatsUi();
    gcUnreferencedBlobs();
    refreshDuplicates();
    showToast(groups.length === 1 ? `Fixed${removed ? ` · ${removed} moved to Recently deleted` : ""}` : `Fixed ${groups.length} songs${removed ? ` · ${removed} copies moved to Recently deleted` : ""}`);
}
if (dupList) dupList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]"), card = e.target.closest(".dup-group"); if (!btn || !card) return;
    const g = dupGroups[Number(card.dataset.index)]; if (!g) return;
    if (btn.dataset.act === "fix") fixDuplicates([g]);
    else {
        const ignore = loadDupIgnore(); ignore.add(g.sig);
        try { localStorage.setItem(DUP_IGNORE_KEY, JSON.stringify([...ignore])); } catch {}
        refreshDuplicates();
    }
});
if ($("dup-fix-all")) $("dup-fix-all").addEventListener("click", async () => {
    if (!dupGroups.length) return;
    if (!await showPrompt({ title: "Fix all duplicates?", message: `${dupGroups.length} songs: each keeps one audio file, and extra copies inside a playlist move to Recently deleted.`, confirmText: "Fix all" })) return;
    fixDuplicates(dupGroups.slice());
});
if ($("dup-close-btn")) $("dup-close-btn").addEventListener("click", closeDuplicates);
if (dupOverlay) dupOverlay.addEventListener("click", (e) => { if (e.target === dupOverlay) closeDuplicates(); });
if ($("open-dup-btn")) $("open-dup-btn").addEventListener("click", openDuplicates);

// Menus open next to the pointer but always inside the window (flipping up near the
// bottom); the "Add to playlist" submenu opens towards whichever side has room.
// A menu taller than the window scrolls inside it (its submenus then open inline), and it's
// fitted again whenever a submenu opens inline and makes it taller.
function positionMenu(menu, x, y) {
    document.body.appendChild(menu);
    menu._anchor = { x, y };
    fitMenu(menu);
    menu.querySelectorAll(".context-menu-group").forEach((g) => g.addEventListener("mouseenter", () => fitSubmenu(g)));
}
function fitMenu(menu) {
    const { x, y } = menu._anchor || { x: 0, y: 0 }, vw = window.innerWidth, vh = window.innerHeight, pad = 8;
    menu.classList.remove("scrolls"); menu.style.maxHeight = "";
    // Layout sizes, not getBoundingClientRect(): the opening animation starts scaled down,
    // which made a menu look shorter than it is and run off the bottom.
    const size = () => ({ width: menu.offsetWidth, height: menu.offsetHeight });
    let r = size();
    if (r.height > vh - pad * 2) { menu.classList.add("scrolls"); menu.style.maxHeight = (vh - pad * 2) + "px"; r = size(); }
    let left = x - r.width + 12;
    if (left < pad) left = Math.min(x, vw - r.width - pad);
    let top = y;
    if (top + r.height > vh - pad) top = y - r.height;
    menu.style.left = clamp(left, pad, Math.max(pad, vw - r.width - pad)) + "px";
    menu.style.top = clamp(top, pad, Math.max(pad, vh - r.height - pad)) + "px";
    menu.classList.toggle("submenu-right", left < 230);
}
// Desktop: a submenu that opens to the side is lifted so its bottom stays on screen.
function fitSubmenu(group) {
    const sub = group.querySelector(".context-submenu"); if (!sub) return;
    sub.style.top = "";
    if (getComputedStyle(sub).position !== "absolute") return;
    const top = sub.getBoundingClientRect().top, over = top + sub.offsetHeight - (window.innerHeight - 8);
    if (over > 0) sub.style.top = -Math.min(over, top - 8) + "px";
}
function toggleSubmenu(group) {
    const menu = group.closest(".context-menu");
    const open = !group.classList.contains("open");
    menu.querySelectorAll(".context-menu-group.open").forEach((g) => { if (g !== group) g.classList.remove("open"); });
    group.classList.toggle("open", open);
    fitMenu(menu); fitSubmenu(group);
    if (open && menu.classList.contains("scrolls")) group.scrollIntoView({ block: "nearest" });
}
// Every real playlist holding this song (copies share their audio, so they count too).
function playlistsWithSong(song) {
    const key = statsKeyFor(song); if (!key) return [];
    return getOrderedPlaylistNames().filter((n) => (playlists[n].songs || []).some((s) => statsKeyFor(s) === key));
}
// Opens a playlist and brings the song into view with a flash.
function revealSongInPlaylist(name, song) {
    if (!playlists[name]) return;
    loadPlaylistPage(name);
    if (playlistSearch && playlistSearch.value) { playlistSearch.value = ""; playlistSearchClear.style.display = "none"; filterPlaylistSongs(""); }
    requestAnimationFrame(() => {
        const row = songList && songList.querySelector(`.song-row[data-key="${CSS.escape(statsKeyFor(song))}"]`); if (!row) return;
        row.scrollIntoView({ block: "center", behavior: appearance.reduceMotion ? "auto" : "smooth" });
        row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
    });
}
function closeContextMenu() { const el = document.getElementById("active-context-menu"); if (el) el.remove(); }
function menuItem(action, icon, label, extra = "") { return `<button class="context-menu-item${extra}" data-action="${action}">${icon || ""}<span>${label}</span></button>`; }
// One menu for a song wherever it's shown. opts.queueIndex: it's a queue entry.
function openSongMenu(song, playlistName, x, y, opts = {}) {
    if (!song) return;
    closeContextMenu();
    const home = playlists[playlistName] && (playlists[playlistName].songs || []).some((s) => s.id === song.id) ? playlistName : homePlaylistOf(song);
    const liked = isLiked(song), inQueue = opts.queueIndex !== undefined;
    const targets = getOrderedPlaylistNames().filter((n) => n !== home);
    const inLists = playlistsWithSong(song), has = new Set(inLists);
    const menu = document.createElement("div"); menu.id = "active-context-menu"; menu.className = "context-menu";
    menu.innerHTML = menuItem("like", liked ? ICONS.heartFill : ICONS.heart, liked ? "Remove from Liked Songs" : "Save to Liked Songs")
        + (inQueue ? "" : menuItem("queue", SWIPE_ICON_QUEUE, "Add to queue"))
        + `<div class="context-menu-group"><button class="context-menu-item" data-action="submenu">${ICONS.plus}<span>Add to playlist</span><span class="menu-chevron">&rsaquo;</span></button><div class="context-submenu">${targets.map((n) => `<button class="context-menu-item${has.has(n) ? " checked" : ""}" data-playlist="${escapeHtml(n)}"${has.has(n) ? ' title="Already in this playlist"' : ""}><span>${escapeHtml(n)}</span></button>`).join("") || '<div class="context-menu-empty">No other playlists</div>'}</div></div>`
        + (inLists.length ? `<div class="context-menu-group"><button class="context-menu-item" data-action="submenu">${ICON_PLAYLISTS}<span>In ${inLists.length} ${inLists.length === 1 ? "playlist" : "playlists"}</span><span class="menu-chevron">&rsaquo;</span></button><div class="context-submenu">${inLists.map((n) => `<button class="context-menu-item" data-reveal="${escapeHtml(n)}"><span>${escapeHtml(n)}</span>${n === playlistName ? '<em class="menu-note">here</em>' : ""}</button>`).join("")}</div></div>` : "")
        + `<div class="menu-rating" role="group" aria-label="Rate this song"><span>Rate</span><span class="menu-rating-stars">${ratingButtonsHtml(ratingOf(song))}</span></div>`
        + '<div class="context-menu-sep"></div>'
        + menuItem("info", ICON_INFO, "Song info")
        + (!inQueue && playlistName === currentPlaylist && playlistView && playlistView.style.display !== "none" ? menuItem("select", ICON_SELECT, "Select songs") : "")
        + (home ? menuItem("edit", ICONS.pencil, "Edit details") : "")
        + (home && (song.artId || song.thumbId) ? menuItem("cover", ICON_CROP, "Edit cover…") : "")
        + menuItem("artist", ICONS.user, "Go to artist")
        + (song.mediaId ? menuItem("trim", ICONS.scissors, "Trim audio…") : "")
        + (inQueue ? menuItem("unqueue", SWIPE_ICON_REMOVE, "Remove from queue", " danger")
            : home && !isVirtualSource(playlistName) ? menuItem("remove", SWIPE_ICON_REMOVE, "Remove from playlist", " danger") : "");
    positionMenu(menu, x, y);
    menu.addEventListener("click", (ev) => {
        const rate = ev.target.closest("[data-rate]");
        if (rate) { const n = Number(rate.dataset.rate), next = ratingOf(song) === n ? 0 : n; setRating(song, next); if (next) playRatingEffect(next, rate); menu.remove(); return; }
        const reveal = ev.target.closest("[data-reveal]");
        if (reveal) { menu.remove(); revealSongInPlaylist(reveal.dataset.reveal, song); return; }
        const target = ev.target.closest("[data-action], [data-playlist]"); if (!target) return;
        const action = target.dataset.action, pl = target.dataset.playlist;
        if (action === "submenu") { ev.stopPropagation(); toggleSubmenu(target.closest(".context-menu-group")); return; }
        if (pl && has.has(pl)) {
            menu.remove();
            showToast(`Already in ${pl}`, { action: "Add again", onAction: () => copySongToPlaylist(song, pl) });
            return;
        }
        if (action === "like") toggleLike(song);
        else if (action === "queue") addSongToQueue(song, home);
        else if (action === "edit") openModal("edit", song.id);
        else if (action === "info") openSongInfo(song);
        else if (action === "select") startSelection(song.id);
        else if (action === "cover") editSongCover(song);
        else if (action === "artist") openArtistPage(song.artist);
        else if (action === "trim") openTrimmer(song.id);
        else if (action === "unqueue") removeFromQueue(opts.queueIndex);
        else if (action === "remove") removeSongFromPlaylist(home, song.id);
        else if (pl) copySongToPlaylist(song, pl);
        menu.remove();
    });
}

function openPlaylistMenu(name, x, y) {
    closeContextMenu();
    if (!playlists[name]) return;
    const menu = document.createElement("div"); menu.id = "active-context-menu"; menu.className = "context-menu";
    const pinned = !!playlists[name].pinned;
    const ordered = getOrderedPlaylistNames(), pos = ordered.indexOf(name);
    const custom = !prefs.playlistSort || prefs.playlistSort === "custom";
    const sameGroup = (i) => custom && i >= 0 && i < ordered.length && !!playlists[ordered[i]].pinned === pinned;
    menu.innerHTML = menuItem("play", ICONS.play, "Play")
        + menuItem("open", "", "Open")
        + menuItem("edit", ICONS.pencil, "Edit")
        + menuItem("pin", ICONS.star, pinned ? "Unpin" : "Pin to top", " pin-item")
        + (sameGroup(pos - 1) ? menuItem("up", "", "Move up") : "")
        + (sameGroup(pos + 1) ? menuItem("down", "", "Move down") : "")
        + menuItem("add-from", ICONS.plus, "Add songs from…")
        + (playlists[name].songs.length ? menuItem("select", ICON_SELECT, "Select songs") : "")
        + menuItem("fix-durations", "", "Fix Song Lengths")
        + '<div class="context-menu-sep"></div>'
        + menuItem("delete", SWIPE_ICON_REMOVE, "Delete", " danger");
    positionMenu(menu, x, y);
    menu.addEventListener("click", (e) => {
        const action = e.target.closest("[data-action]")?.dataset.action; if (!action) return;
        if (action === "play") playCollection(name);
        else if (action === "open") loadPlaylistPage(name);
        else if (action === "edit") openModal("editPlaylist", null, { name });
        else if (action === "pin") setPlaylistPinned(name, !pinned);
        else if (action === "up") movePlaylist(name, -1);
        else if (action === "down") movePlaylist(name, 1);
        else if (action === "add-from") openAddFrom(name);
        else if (action === "select") { loadPlaylistPage(name); startSelection(null); }
        else if (action === "fix-durations") recalcPlaylistDurations(name);
        else if (action === "delete") deletePlaylist(name);
        menu.remove();
    });
}

document.addEventListener("click", (e) => {
    if (!e.target.closest(".context-menu")) closeContextMenu();
    const cardPlay = e.target.closest(".playlist-card-play");
    if (cardPlay) { e.stopPropagation(); playCollection(cardPlay.dataset.playlist); return; }
    const cardMenu = e.target.closest(".playlist-card-menu");
    if (cardMenu) { e.stopPropagation(); openPlaylistMenu(cardMenu.getAttribute("data-playlist"), e.clientX, e.clientY); return; }
    if (e.target.closest("#playlist-options-btn") && playlists[currentPlaylist]) { e.stopPropagation(); openPlaylistMenu(currentPlaylist, e.clientX, e.clientY); }
});
window.addEventListener("blur", closeContextMenu);

// ══════════════════════════════════════════════
// ── SONG INFO ── everything about one song on one page (song menu → Song info):
// the file, how you've listened to it, and every playlist it's in.
// ══════════════════════════════════════════════
const infoOverlay = $("info-overlay"), infoBody = $("info-body");
let infoSong = null;
const AUDIO_TYPES = { "audio/mpeg": "MP3", "audio/mp3": "MP3", "audio/mp4": "M4A", "audio/x-m4a": "M4A", "audio/aac": "AAC", "audio/webm": "WebM", "audio/ogg": "OGG", "audio/opus": "Opus", "audio/flac": "FLAC", "audio/x-flac": "FLAC", "audio/wav": "WAV", "audio/x-wav": "WAV", "audio/wave": "WAV", "audio/aiff": "AIFF", "audio/x-aiff": "AIFF" };
function audioTypeName(mime) { return AUDIO_TYPES[(mime || "").toLowerCase()] || (mime ? mime.replace(/^audio\//, "").toUpperCase() : "Unknown"); }
function longDate(t) { return t ? new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"; }
async function openSongInfo(song) {
    if (!song || !infoOverlay) return;
    infoSong = song;
    infoOverlay.style.display = "flex";
    await renderSongInfo();
}
function closeSongInfo() { if (infoOverlay) infoOverlay.style.display = "none"; infoSong = null; }
async function renderSongInfo() {
    const song = infoSong; if (!song || !infoBody) return;
    const key = statsKeyFor(song), st = listenStats[key] || {}, lists = playlistsWithSong(song);
    const [audio, art, thumb] = await Promise.all([getBlob(song.mediaId), getBlob(song.artId), getBlob(song.thumbId)]);
    if (infoSong !== song) return;
    const dur = Number(song.duration) || 0, size = audio ? audio.size : 0;
    const kbps = size && dur ? Math.round((size * 8) / dur / 1000) : 0;
    const yt = typeof song.src === "string" && song.src.startsWith("yt:") ? song.src.slice(3) : null;
    const row = (label, value) => `<div class="info-row"><dt>${label}</dt><dd>${value}</dd></div>`;
    const likedAt = likedSongs.get(key);
    infoBody.innerHTML = `
        <div class="info-hero">
            <img src="${escapeHtml(song.art || DEFAULT_ART)}" alt="">
            <div class="info-hero-text">
                <strong>${escapeHtml(song.title || "Unknown")}</strong>
                ${artistLinkHtml(song.artist)}
                <div class="info-actions">
                    <button type="button" class="utility-btn accent-outline" data-info="play">${ICONS.play}Play</button>
                    <button type="button" class="utility-btn" data-info="like">${isLiked(song) ? ICONS.heartFill + "Liked" : ICONS.heart + "Like"}</button>
                    <button type="button" class="utility-btn" data-info="queue">${SWIPE_ICON_QUEUE}Queue</button>
                </div>
            </div>
        </div>
        <div class="info-rating"><span>Your rating</span><span class="menu-rating-stars">${ratingButtonsHtml(ratingOf(song))}</span></div>
        <h3 class="info-heading">Listening</h3>
        <dl class="info-grid">
            ${row("Plays", String(st.plays || 0))}
            ${row("Time listened", st.seconds ? formatListenTime(st.seconds) : "—")}
            ${row("Skipped", String(st.skips || 0))}
            ${row("Last played", st.lastPlayed ? `${longDate(st.lastPlayed)} <small>${escapeHtml(getRelativeTimeString(st.lastPlayed))}</small>` : "Not yet")}
            ${row("Liked", likedAt ? longDate(likedAt) : "No")}
        </dl>
        <h3 class="info-heading">File</h3>
        <dl class="info-grid">
            ${row("Length", dur ? formatTime(dur) : "—")}
            ${row("Type", audio ? `${audioTypeName(audio.type)}${kbps ? ` · about ${kbps} kbps` : ""}` : "Audio missing")}
            ${row("Size", size ? formatBytes(size) : "—")}
            ${row("Cover", art ? formatBytes(art.size) + (thumb ? ` <small>+ ${formatBytes(thumb.size)} original picture</small>` : "") : "None")}
            ${row("Added", `${longDate(song.timestamp)} <small>${escapeHtml(getRelativeTimeString(song.timestamp))}</small>`)}
            ${Number.isFinite(song.loudness) ? row("Loudness", `${song.loudness.toFixed(1)} dB <small>volume leveller</small>`) : ""}
            ${yt ? row("From", `YouTube <button type="button" class="info-link" data-info="copy-yt">Copy link</button>`) : ""}
        </dl>
        <h3 class="info-heading">In ${lists.length} ${lists.length === 1 ? "playlist" : "playlists"}</h3>
        <div class="info-playlists">${lists.map((n) => `<button type="button" class="info-pl" data-pl="${escapeHtml(n)}"><span class="info-pl-cover">${playlistCoverHtml(n)}</span><span>${escapeHtml(n)}</span><em>${(playlists[n].songs || []).length} songs</em></button>`).join("") || '<span class="info-none">Only in your Liked Songs or the queue.</span>'}</div>`;
}
if (infoBody) infoBody.addEventListener("click", (e) => {
    const song = infoSong; if (!song) return;
    const artist = e.target.closest(".artist-link");
    if (artist) { closeSongInfo(); openArtistPage(artist.dataset.artist); return; }
    const rate = e.target.closest("[data-rate]");
    if (rate) { const n = Number(rate.dataset.rate), next = ratingOf(song) === n ? 0 : n; setRating(song, next); if (next) playRatingEffect(next, rate); renderSongInfo(); return; }
    const pl = e.target.closest("[data-pl]");
    if (pl) { closeSongInfo(); closeStorage(); closeSettings(); revealSongInPlaylist(pl.dataset.pl, song); return; }
    const act = e.target.closest("[data-info]")?.dataset.info;
    if (act === "play") { const home = homePlaylistOf(song); playSong(song, home || currentPlaylist, false, { restart: true }); closeSongInfo(); }
    else if (act === "like") { toggleLike(song); renderSongInfo(); }
    else if (act === "queue") addSongToQueue(song);
    else if (act === "copy-yt") {
        const url = `https://www.youtube.com/watch?v=${song.src.slice(3)}`;
        navigator.clipboard.writeText(url).then(() => showToast("Link copied"), () => showToast(url, { duration: 6000 }));
    }
});
if ($("info-close-btn")) $("info-close-btn").addEventListener("click", closeSongInfo);
if (infoOverlay) infoOverlay.addEventListener("click", (e) => { if (e.target === infoOverlay) closeSongInfo(); });

// ══════════════════════════════════════════════
// ── STORAGE ── what the library takes up and what can go (Settings → General → Library).
// Sizes come from the stored files' metadata, read in one pass; nothing is loaded.
// ══════════════════════════════════════════════
const storageOverlay = $("storage-overlay"), storageBody = $("storage-body");
async function mediaSizes() {
    const db = await openDb(), sizes = new Map();
    await new Promise((resolve) => {
        const req = db.transaction(DB_MEDIA, "readonly").objectStore(DB_MEDIA).openCursor();
        req.onsuccess = () => { const c = req.result; if (!c) { resolve(); return; } const v = c.value; sizes.set(c.key, v && typeof v.size === "number" ? v.size : 0); c.continue(); };
        req.onerror = () => resolve();
    });
    return sizes;
}
async function openStorage() {
    if (!storageOverlay) return;
    storageOverlay.style.display = "flex";
    storageBody.innerHTML = '<div class="stats-empty">Adding it all up…</div>';
    await renderStorage();
}
function closeStorage() { if (storageOverlay) storageOverlay.style.display = "none"; }
async function renderStorage() {
    const sizes = await mediaSizes();
    const size = (id) => sizes.get(id) || 0;
    // What each stored file is for. A file counts once, under the first thing that uses it.
    const kind = new Map(), mark = (id, k) => { if (id && sizes.has(id) && !kind.has(id)) kind.set(id, k); };
    const songsByMedia = new Map();
    for (const [name, pl] of Object.entries(playlists)) {
        mark(pl.artId, "covers");
        for (const s of pl.songs || []) {
            mark(s.mediaId, "audio"); mark(s.artId, "covers"); mark(s.thumbId, "originals");
            if (s.mediaId && !songsByMedia.has(s.mediaId)) songsByMedia.set(s.mediaId, { song: s, playlistName: name });
        }
    }
    for (const item of queue) { mark(item?.song?.mediaId, "audio"); mark(item?.song?.artId, "covers"); }
    for (const t of trash) for (const s of t.song ? [t.song] : t.playlist?.songs || []) { mark(s.mediaId, "bin"); mark(s.artId, "bin"); mark(s.thumbId, "bin"); }
    const referenced = collectReferencedBlobIds();
    for (const id of sizes.keys()) if (!kind.has(id)) kind.set(id, referenced.has(id) ? "other" : "unused");
    const totals = { audio: 0, covers: 0, originals: 0, bin: 0, other: 0, unused: 0 };
    for (const [id, k] of kind) totals[k] += size(id);
    const total = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
    let quota = null;
    try { if (navigator.storage && navigator.storage.estimate) quota = await navigator.storage.estimate(); } catch {}
    const PARTS = [["audio", "Songs", "var(--accent)"], ["covers", "Covers", "#4dabff"], ["originals", "Original pictures", "#a66bff"], ["bin", "Recently deleted", "#ff9f43"], ["other", "Other", "#8a8f99"], ["unused", "Unused", "#ff4d6d"]];
    const biggest = [...songsByMedia.entries()].map(([id, e]) => ({ ...e, size: size(id) })).sort((a, b) => b.size - a.size).slice(0, 25);
    const dupGroups = (() => { try { return findDuplicateGroups().length; } catch { return 0; } })();
    const card = (k, title, text, btn, disabled) => `<div class="storage-tool"><span><strong>${title}</strong><small>${text}</small></span>${btn ? `<button type="button" class="utility-btn${k === "unused" || k === "originals" ? " danger" : ""}" data-store="${k}"${disabled ? " disabled" : ""}>${btn}</button>` : ""}</div>`;
    storageBody.innerHTML = `
        <div class="storage-total"><strong>${formatBytes(total)}</strong><span>${songsByMedia.size} song ${songsByMedia.size === 1 ? "file" : "files"}${quota && quota.quota ? ` · ${formatBytes(quota.usage || 0)} used of ${formatBytes(quota.quota)} this app may use` : ""}</span></div>
        <div class="storage-bar">${PARTS.map(([k, , c]) => totals[k] ? `<i style="flex:${totals[k] / total};background:${c}"></i>` : "").join("")}</div>
        <div class="storage-legend">${PARTS.filter(([k]) => totals[k]).map(([k, label, c]) => `<span><i style="background:${c}"></i>${label} <b>${formatBytes(totals[k])}</b></span>`).join("")}</div>
        <h3 class="info-heading">Clean up</h3>
        <div class="storage-tools">
            ${card("unused", "Unused files", totals.unused ? `${formatBytes(totals.unused)} of files nothing uses any more (left over from deletions or crashes).` : "Nothing left over.", "Clean up", !totals.unused)}
            ${card("originals", "Original pictures", totals.originals ? `${formatBytes(totals.originals)}: the full pictures kept so covers can be re-cropped. Your covers stay; you'd crop from the cover itself afterwards.` : "None kept.", "Remove", !totals.originals)}
            ${card("bin", "Recently deleted", totals.bin ? `${formatBytes(totals.bin)} waiting in the bin (gone for good after 30 days).` : "The bin is empty.", "Open", !trash.length)}
            ${card("dups", "Duplicates", dupGroups ? `${dupGroups} ${dupGroups === 1 ? "song seems" : "songs seem"} to be in your library twice.` : "No duplicates found.", "Find", !dupGroups)}
        </div>
        <h3 class="info-heading">Biggest songs</h3>
        <div class="stats-list storage-biggest">${biggest.map((e) => `<div class="stats-row" data-mid="${escapeHtml(e.song.mediaId)}"><img src="${escapeHtml(e.song.art || DEFAULT_ART)}" alt="" loading="lazy"><div class="stats-row-info"><strong>${escapeHtml(e.song.title || "Unknown")}</strong><span>${escapeHtml(e.song.artist || "Unknown Artist")}</span></div><div class="stats-row-nums"><strong>${formatBytes(e.size)}</strong><span>${formatTime(e.song.duration)}</span></div></div>`).join("") || '<div class="stats-empty">No songs yet.</div>'}</div>`;
}
if (storageBody) storageBody.addEventListener("click", async (e) => {
    const row = e.target.closest(".stats-row[data-mid]");
    if (row) { const hit = Object.values(playlists).flatMap((pl) => pl.songs || []).find((s) => s.mediaId === row.dataset.mid); if (hit) openSongInfo(hit); return; }
    const b = e.target.closest("[data-store]"); if (!b || b.disabled) return;
    const k = b.dataset.store;
    if (k === "unused") { b.disabled = true; await gcUnreferencedBlobs(); showToast("Cleaned up"); renderStorage(); }
    else if (k === "originals") {
        const ok = await showPrompt({ title: "Remove original pictures?", message: "Your covers stay as they are. You just won't be able to re-crop a cover from the full original picture.", confirmText: "Remove", danger: true });
        if (!ok) return;
        const strip = (s) => { if (s && s.thumbId) { delete s.thumbId; delete s.coverCrop; } };
        for (const pl of Object.values(playlists)) (pl.songs || []).forEach(strip);
        queue.forEach((i) => strip(i?.song)); strip(currentTrack);
        await saveLibrary(); await gcUnreferencedBlobs(); showToast("Original pictures removed"); renderStorage();
    }
    else if (k === "bin") openBin();
    else if (k === "dups") openDuplicates();
});
if ($("open-storage-btn")) $("open-storage-btn").addEventListener("click", openStorage);
if ($("storage-close-btn")) $("storage-close-btn").addEventListener("click", closeStorage);
if (storageOverlay) storageOverlay.addEventListener("click", (e) => { if (e.target === storageOverlay) closeStorage(); });

// ── HOME SHELVES ──
// "Recently played" (from listening stats) and "Recently added" rows on Home.
let shelvesPending = false;
function scheduleShelves() {
    if (shelvesPending) return;
    shelvesPending = true;
    setTimeout(() => { shelvesPending = false; renderShelves(); }, 60);
}
function renderShelves() {
    const recentSec = $("shelf-recent"), addedSec = $("shelf-added"), ratedSec = $("shelf-rated");
    if (!recentSec || !addedSec) return;
    const show = !homeQuery;
    let recent = [];
    if (show && appearance.showRecent !== false) {
        recent = Object.entries(listenStats).filter(([, e]) => e.lastPlayed > 0)
            .sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)
            .map(([key]) => findSongByStatsKey(key)).filter(Boolean).slice(0, 16);
    }
    let added = [];
    if (show && appearance.showAdded !== false) {
        const all = [];
        for (const [name, pl] of Object.entries(playlists)) for (const s of pl.songs || []) all.push({ song: s, playlistName: name });
        all.sort((a, b) => (b.song.timestamp || 0) - (a.song.timestamp || 0));
        const seen = new Set();
        for (const e of all) { const k = statsKeyFor(e.song); if (seen.has(k)) continue; seen.add(k); added.push(e); if (added.length >= 16) break; }
    }
    if (ratedSec) {
        const rated = show && appearance.showRated !== false ? Object.entries(ratings).filter(([, r]) => r >= 4)
            .map(([key, r]) => ({ hit: findSongByStatsKey(key), r, plays: listenStats[key]?.plays || 0 })).filter((x) => x.hit)
            .sort((a, b) => b.r - a.r || b.plays - a.plays).slice(0, 16).map((x) => x.hit) : [];
        fillShelf($("shelf-rated-row"), rated); ratedSec.hidden = !rated.length;
    }
    fillShelf($("shelf-recent-row"), recent); recentSec.hidden = !recent.length;
    fillShelf($("shelf-added-row"), added); addedSec.hidden = !added.length;
    renderSongOfDay();
    updatePlayingIndicators();
}

// ── SONG OF THE DAY ──
// One song a day from your own library that you haven't played for a while, leaning
// towards old favourites. The pick is stored for the day so it doesn't change every
// time Home redraws; ↻ picks another.
const SOTD_KEY = "spootify-sotd";
const sotdCard = $("sotd-card");
function todayStamp() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function seededRandom(seed) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h / 4294967296; };
}
function sotdReason(st) {
    if (!st || !st.plays) return "You haven't played this one yet";
    const days = Math.floor((Date.now() - (st.lastPlayed || 0)) / 86400000);
    const ago = days >= 60 ? `${Math.round(days / 30)} months` : days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} days`;
    return `${st.plays} ${st.plays === 1 ? "play" : "plays"} · last one ${ago} ago`;
}
function pickSongOfTheDay(reroll = false) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SOTD_KEY) || "null"); } catch {}
    const today = todayStamp();
    if (!reroll && saved && saved.date === today) {
        const found = findSongByStatsKey(saved.key);
        if (found) return { ...found, key: saved.key, reason: saved.reason };
    }
    const now = Date.now(), seen = new Set(), all = [], cands = [];
    for (const [playlistName, pl] of Object.entries(playlists)) for (const s of pl.songs || []) {
        const key = statsKeyFor(s); if (seen.has(key) || !s.mediaId) continue;
        seen.add(key); all.push({ song: s, playlistName, key });
    }
    if (all.length < 3) return null;
    const avoid = new Set([statsKeyFor(currentTrack), saved && saved.key]);
    for (const e of all) {
        if (avoid.has(e.key)) continue;
        const st = listenStats[e.key];
        if (st && now - (st.lastPlayed || 0) < 14 * 86400000) continue; // heard in the last two weeks
        cands.push({ ...e, w: st && st.plays ? 1 + Math.log2(1 + st.plays) * 1.5 : 1 });
    }
    const pool = cands.length ? cands : all.filter((e) => !avoid.has(e.key)).map((e) => ({ ...e, w: 1 }));
    if (!pool.length) return null;
    const rand = reroll ? Math.random : seededRandom(today + ":" + all.length);
    let r = rand() * pool.reduce((t, e) => t + e.w, 0), pick = pool[pool.length - 1];
    for (const e of pool) { r -= e.w; if (r <= 0) { pick = e; break; } }
    const reason = sotdReason(listenStats[pick.key]);
    try { localStorage.setItem(SOTD_KEY, JSON.stringify({ date: today, key: pick.key, reason })); } catch {}
    return { song: pick.song, playlistName: pick.playlistName, key: pick.key, reason };
}
let sotdPick = null;
function renderSongOfDay(reroll = false) {
    if (!sotdCard) return;
    const show = appearance.showSongOfDay !== false && !homeQuery;
    sotdPick = show ? pickSongOfTheDay(reroll) : null;
    sotdCard.hidden = !sotdPick;
    if (!sotdPick) return;
    const s = sotdPick.song;
    sotdCard.dataset.key = sotdPick.key;
    const art = $("sotd-art"); if (art && art.getAttribute("src") !== (s.art || DEFAULT_ART)) art.src = s.art || DEFAULT_ART;
    setText($("sotd-title"), s.title || "Unknown");
    setText($("sotd-artist"), s.artist || "Unknown Artist");
    setText($("sotd-reason"), sotdPick.reason || "");
    sotdCard.classList.toggle("playing", !!currentTrack && statsKeyFor(currentTrack) === sotdPick.key);
}
if (sotdCard) {
    sotdCard.addEventListener("click", (e) => {
        if (!sotdPick) return;
        if (e.target.closest("#sotd-reroll")) { e.stopPropagation(); renderSongOfDay(true); haptic(8); return; }
        if (e.target.closest(".artist-link")) return;
        playSong(sotdPick.song, sotdPick.playlistName);
    });
    sotdCard.addEventListener("contextmenu", (e) => { if (!sotdPick) return; e.preventDefault(); openSongMenu(sotdPick.song, sotdPick.playlistName, e.clientX, e.clientY); });
}
// Shelves redraw after every song; their cards are only rebuilt when what they show changed.
function fillShelf(row, entries) {
    if (!row) return;
    const sig = entries.map(({ song, playlistName }) => `${song.id}\u0001${song.art || ""}\u0001${song.title}\u0001${song.artist}\u0001${playlistName}`).join("\u0002");
    if (row.__sig === sig) return;
    row.__sig = sig;
    row.innerHTML = entries.map(({ song, playlistName }) => `<button type="button" class="shelf-card" data-key="${escapeHtml(statsKeyFor(song))}" data-id="${song.id}" data-playlist="${escapeHtml(playlistName)}" title="${escapeHtml(song.title)} · ${escapeHtml(song.artist || "")}"><div class="shelf-art"><img src="${escapeHtml(song.art || DEFAULT_ART)}" alt="" loading="lazy"><span class="shelf-play">${ICONS.play}</span></div><div class="shelf-title">${escapeHtml(song.title)}</div><div class="shelf-sub">${escapeHtml(song.artist || "Unknown Artist")}</div></button>`).join("");
}
function shelfHit(e) {
    const card = e.target.closest(".shelf-card"); if (!card) return null;
    const id = Number(card.dataset.id), pl = card.dataset.playlist;
    const song = (playlists[pl]?.songs || []).find((s) => s.id === id);
    return song ? { song, playlistName: pl } : null;
}
for (const id of ["shelf-recent-row", "shelf-added-row", "shelf-rated-row"]) {
    const row = $(id); if (!row) continue;
    row.addEventListener("click", (e) => { const hit = shelfHit(e); if (hit) playSong(hit.song, hit.playlistName); });
    row.addEventListener("contextmenu", (e) => { const hit = shelfHit(e); if (!hit) return; e.preventDefault(); openSongMenu(hit.song, hit.playlistName, e.clientX, e.clientY); });
    // A mouse wheel scrolls the shelf sideways.
    row.addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && row.scrollWidth > row.clientWidth && !e.shiftKey) { const before = row.scrollLeft; row.scrollLeft += e.deltaY; if (row.scrollLeft !== before) e.preventDefault(); } }, { passive: false });
}

// ── FIX DURATIONS ──
function fixSongDuration(song) {
    return new Promise((resolve) => {
        if (!song?.fileSrc) { resolve(false); return; }
        const temp = new Audio(); temp.preload = "metadata";
        temp.addEventListener("loadedmetadata", () => {
            let changed = false;
            if (temp.duration && Math.abs((song.duration || 0) - temp.duration) > 0.5) { song.duration = temp.duration; changed = true; }
            temp.src = ""; resolve(changed);
        });
        temp.addEventListener("error", () => { temp.src = ""; resolve(false); });
        temp.src = song.fileSrc;
    });
}
async function recalcPlaylistDurations(name) {
    const pl = playlists[name]; if (!pl?.songs.length) return;
    let fixed = 0;
    for (const song of pl.songs) {
        if (!song.fileSrc && song.mediaId) song.fileSrc = await getBlobUrl(song.mediaId);
        if (await fixSongDuration(song)) fixed++;
    }
    if (fixed > 0) { await saveLibrary(); if (currentPlaylist === name) renderSongs(); }
    await showMessage("Durations Updated", `Fixed ${fixed} of ${pl.songs.length} songs.`);
}


// ── MOBILE: Mini player & now-playing screen ──
function openNowPlaying() {
    if (!isMobile() || !nowPlayingScreen || !currentTrack) return;
    nowPlayingScreen.classList.remove("closing");
    nowPlayingScreen.classList.add("open");
    updateNpControls(); renderQueue(); renderProgress(true); applyTrackTint(); kickVisualizer();
    setTimeout(() => { if (isNowPlayingOpen()) setThemeBgCovered(true); }, 320); // once it has slid all the way up
}
function closeNowPlaying() {
    if (!nowPlayingScreen || !nowPlayingScreen.classList.contains("open")) return;
    setThemeBgCovered(false);
    const done = () => { nowPlayingScreen.classList.remove("open", "closing"); kickVisualizer(); };
    if (appearance.reduceMotion || !isMobile()) { done(); return; }
    nowPlayingScreen.classList.add("closing");
    setTimeout(done, 220);
}
function updateNpControls() {
    if (npShuffleBtn) npShuffleBtn.classList.toggle("is-active", shuffleEnabled);
    if (npLoopBtn) { npLoopBtn.classList.toggle("is-active", loopMode !== "off"); npLoopBtn.innerHTML = loopMode === "one" ? ICONS.loopOne : ICONS.loop; }
}

if (mobileMiniPlayer) mobileMiniPlayer.addEventListener("click", (e) => { if (e.target.closest("button")) return; openNowPlaying(); });
if (miniPlayBtn) miniPlayBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePlayPause(); });
if (miniNextBtn) miniNextBtn.addEventListener("click", (e) => { e.stopPropagation(); playNext(); });
if (npCollapseBtn) npCollapseBtn.addEventListener("click", closeNowPlaying);
if (npPlayBtn) npPlayBtn.addEventListener("click", togglePlayPause);
if (npPrevBtn) npPrevBtn.addEventListener("click", () => playPrevious());
if (npNextBtn) npNextBtn.addEventListener("click", () => playNext());
if (npShuffleBtn) npShuffleBtn.addEventListener("click", toggleShuffle);
if (npLoopBtn) npLoopBtn.addEventListener("click", cycleLoop);
if (npOptionsBtn) npOptionsBtn.addEventListener("click", (e) => {
    e.stopPropagation(); if (!currentTrack) return;
    const f = findSongById(currentTrack.id);
    openSongMenu(currentTrack, f ? f.playlistName : currentTrackSource, e.clientX, e.clientY);
});
if (npQueueClear) npQueueClear.addEventListener("click", clearQueue);

// Create / Import / Settings are actions, not places: only Home stays highlighted.
if (mobileBottomNav) mobileBottomNav.addEventListener("click", (e) => {
    const btn = e.target.closest(".bottom-nav-item"); if (!btn) return;
    const tab = btn.dataset.tab;
    if (tab === "home") { closeNowPlaying(); showHome(); }
    else if (tab === "create") openModal("playlist");
    else if (tab === "import") openYtModal();
    else if (tab === "settings") openSettings();
});

// ── SETTINGS ──
const settingsOverlay = $("settings-overlay");
let settingsTab = (() => { try { return localStorage.getItem("spootify-settings-tab") || "playback"; } catch { return "playback"; } })();
function selectSettingsTab(name) {
    if (!document.querySelector(`.settings-tab[data-tab="${name}"]`)) name = "playback";
    settingsTab = name;
    document.querySelectorAll(".settings-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".settings-tab-panel").forEach((p) => { p.style.display = p.dataset.tab === name ? "" : "none"; });
    try { localStorage.setItem("spootify-settings-tab", name); } catch {}
    if (name === "appearance") renderAppearanceUi();
    if (name === "audio") renderPresetChips();
    if (name === "general" || name === "playback") syncPrefsUi();
}
function openSettings(tab) {
    if (!settingsOverlay) return;
    selectSettingsTab(tab || settingsTab);
    settingsOverlay.style.display = "flex";
}
function closeSettings() { if (settingsOverlay) settingsOverlay.style.display = "none"; }
const settingsBtn = $("settings-btn"), settingsCloseBtn = $("settings-close-btn");
if (settingsBtn) settingsBtn.addEventListener("click", () => openSettings());
if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", closeSettings);
if (settingsOverlay) settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) closeSettings(); });
document.querySelectorAll(".settings-tab").forEach((tab) => tab.addEventListener("click", () => selectSettingsTab(tab.dataset.tab)));

// Speed is stored as an integer percentage (50–200) so every value is exact.
const SPEED_MIN = 50, SPEED_MAX = 200;
function setPlaybackSpeed(speed) {
    const n = Number(speed);
    playbackSpeed = Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, Number.isFinite(n) ? n : 100)));
    audioPlayer.playbackRate = playbackSpeed / 100; standbyPlayer.playbackRate = playbackSpeed / 100;
    const slider = $("speed-slider");
    const input = $("speed-input");
    if (slider) { slider.value = playbackSpeed; updateSliderFill(slider); }
    if (input && document.activeElement !== input) input.value = (playbackSpeed / 100).toFixed(2);
    document.querySelectorAll(".speed-preset-btn").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.speed) === playbackSpeed);
    });
    localStorage.setItem("spootify-speed", playbackSpeed);
    schedulePresetRefresh();
    lastMediaSessionPositionUpdate = 0;
    updateMediaSessionPosition(); syncNativePosition(true);
}

// ── PITCH MODE ──
// preservesPitch=true makes the browser time-stretch the audio (WSOLA — built
// for speech), which sounds grainy/warbly on music, especially below 1×. With
// it off the engine just resamples, so speed changes pitch like a record but
// stays completely clean. Off is the default; the toggle brings stretching back.
const PITCH_HINT_FOLLOW = "Off: pitch follows speed — the classic slowed / sped-up sound, no artifacts.";
const PITCH_HINT_KEEP = "On: pitch stays the same, but the time-stretching can sound grainy at extreme speeds.";
function applyPitchModeTo(el) {
    const keep = preservePitch;
    if ("preservesPitch" in el) el.preservesPitch = keep;
    if ("mozPreservesPitch" in el) el.mozPreservesPitch = keep;
    if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = keep;
}
function applyPitchMode() { applyPitchModeTo(playerA); applyPitchModeTo(playerB); }
function setPreservePitch(enabled) {
    preservePitch = !!enabled;
    applyPitchMode();
    const toggle = $("preserve-pitch-toggle");
    const hint = $("pitch-hint");
    if (toggle) toggle.checked = preservePitch;
    if (hint) hint.textContent = preservePitch ? PITCH_HINT_KEEP : PITCH_HINT_FOLLOW;
    localStorage.setItem("spootify-preserve-pitch", preservePitch ? "1" : "0");
    schedulePresetRefresh();
}

// Tap = ±1%, press-and-hold repeats so reaching e.g. 0.85× doesn't take 15 taps.
function bindSpeedNudge(btn, delta) {
    if (!btn) return;
    let holdTimer = null, repeatTimer = null;
    const stop = () => { clearTimeout(holdTimer); clearInterval(repeatTimer); holdTimer = repeatTimer = null; };
    btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        setPlaybackSpeed(playbackSpeed + delta);
        holdTimer = setTimeout(() => { repeatTimer = setInterval(() => setPlaybackSpeed(playbackSpeed + delta), 70); }, 400);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener("click", (e) => { if (e.detail === 0) setPlaybackSpeed(playbackSpeed + delta); }); // keyboard activation
}


// ── SLEEP TIMER ──
// Minutes, or "End of current song" (-1). The last 10 seconds fade out, and the time
// is also checked from the playback tick so a timer the OS delayed still lands.
const sleepTimerSelect = $("sleep-timer-select");
function startSleepTimer(minutes) {
    clearSleepTimer();
    if (minutes === -1) { sleepAtTrackEnd = true; updateSleepTimerDisplay(); return; }
    if (!minutes) return;
    sleepTimerEnd = Date.now() + minutes * 60 * 1000;
    sleepTimerId = setTimeout(stopForSleep, minutes * 60 * 1000);
    updateSleepTimerDisplay();
    sleepTimerDisplayId = setInterval(updateSleepTimerDisplay, 1000);
}

function clearSleepTimer() {
    if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; }
    if (sleepTimerDisplayId) { clearInterval(sleepTimerDisplayId); sleepTimerDisplayId = null; }
    sleepTimerEnd = null; sleepAtTrackEnd = false;
    if (sleepGain !== 1) { sleepGain = 1; applyVolume(); }
    const remaining = $("sleep-timer-remaining");
    if (remaining) remaining.style.display = "none";
}
function stopForSleep() {
    const atTrackEnd = sleepAtTrackEnd;
    clearSleepTimer();
    if (sleepTimerSelect) sleepTimerSelect.value = "0";
    if (isAudiblyPlaying()) pausePlayback();
    updatePlayPauseIcon(); updateMediaSessionMetadata();
    showMessage("Sleep Timer", atTrackEnd ? "Playback stopped at the end of the song." : "Playback stopped by sleep timer.");
}
function checkSleepTimer() {
    if (!sleepTimerEnd) return;
    const left = sleepTimerEnd - Date.now();
    if (left <= 0) { stopForSleep(); return; }
    const gain = left < 10000 ? left / 10000 : 1;
    if (Math.abs(gain - sleepGain) > 0.01) { sleepGain = gain; applyVolume(); }
}

function updateSleepTimerDisplay() {
    const remaining = $("sleep-timer-remaining");
    if (!remaining) return;
    if (sleepAtTrackEnd) { remaining.textContent = "Stops when this song ends"; remaining.style.display = "inline"; return; }
    if (!sleepTimerEnd) return;
    const left = Math.max(0, sleepTimerEnd - Date.now());
    if (left <= 0) { remaining.style.display = "none"; return; }
    const mins = Math.floor(left / 60000);
    const secs = Math.floor((left % 60000) / 1000);
    remaining.textContent = `${mins}:${secs < 10 ? "0" : ""}${secs} remaining`;
    remaining.style.display = "inline";
}

function setCrossfade(seconds) {
    crossfadeDuration = seconds;
    const display = $("crossfade-display");
    if (display) display.textContent = seconds === 0 ? "Off" : seconds + "s";
    const slider = $("crossfade-slider");
    if (slider) updateSliderFill(slider);
    localStorage.setItem("spootify-crossfade", seconds);
}
function setCrossfadeOverlap(enabled) {
    crossfadeOverlap = !!enabled;
    const toggle = $("crossfade-overlap-toggle");
    if (toggle) toggle.checked = crossfadeOverlap;
    const hint = $("crossfade-hint");
    if (hint) hint.textContent = crossfadeOverlap ? "The next song fades in while the current one fades out." : "Fade out the end of each track; the next song then starts normally.";
    if (!crossfadeOverlap && crossfadePending) cancelCrossfade();
    localStorage.setItem("spootify-crossfade-overlap", crossfadeOverlap ? "1" : "0");
}

const speedSlider = $("speed-slider");
if (speedSlider) speedSlider.addEventListener("input", () => { setPlaybackSpeed(parseInt(speedSlider.value)); });
document.querySelectorAll(".speed-preset-btn").forEach(btn => {
    btn.addEventListener("click", () => { setPlaybackSpeed(parseInt(btn.dataset.speed)); });
});
bindSpeedNudge($("speed-minus"), -1);
bindSpeedNudge($("speed-plus"), 1);
const speedInput = $("speed-input");
if (speedInput) {
    // Apply while typing only once the value is in range; snap on blur/Enter so a half-typed "0." never sticks.
    speedInput.addEventListener("input", () => { const v = parseFloat(speedInput.value); if (Number.isFinite(v) && v * 100 >= SPEED_MIN && v * 100 <= SPEED_MAX) setPlaybackSpeed(v * 100); });
    speedInput.addEventListener("change", () => { setPlaybackSpeed(parseFloat(speedInput.value) * 100); speedInput.value = (playbackSpeed / 100).toFixed(2); });
    speedInput.addEventListener("keydown", (e) => { if (e.key === "Enter") speedInput.blur(); });
}
const preservePitchToggle = $("preserve-pitch-toggle");
if (preservePitchToggle) preservePitchToggle.addEventListener("change", () => { setPreservePitch(preservePitchToggle.checked); });


if (sleepTimerSelect) sleepTimerSelect.addEventListener("change", () => { startSleepTimer(parseInt(sleepTimerSelect.value, 10) || 0); });

const crossfadeSlider = $("crossfade-slider");
if (crossfadeSlider) crossfadeSlider.addEventListener("input", () => { setCrossfade(parseInt(crossfadeSlider.value)); });
const crossfadeOverlapToggle = $("crossfade-overlap-toggle");
if (crossfadeOverlapToggle) crossfadeOverlapToggle.addEventListener("change", () => setCrossfadeOverlap(crossfadeOverlapToggle.checked));


// ── SOUND PRESETS ──
// One tap sets speed, pitch mode and the effects together. "Save current" stores
// your own (right-click or long-press one of yours to delete it).
const PRESETS_KEY = "spootify-presets";
const BUILTIN_PRESETS = [
    { id: "normal", name: "Normal", speed: 100, fx: { bass: 0, mid: 0, treble: 0, reverb: 0, pan: 0 } },
    { id: "slowed", name: "Slowed + Reverb", speed: 85, pitch: false, fx: { bass: 3, mid: 0, treble: -2, reverb: 45, pan: 0 } },
    { id: "sped", name: "Sped Up", speed: 120, pitch: false, fx: { bass: 1, mid: 0, treble: 1, reverb: 0, pan: 0 } },
    { id: "nightcore", name: "Nightcore", speed: 130, pitch: false, fx: { bass: 2, mid: 0, treble: 3, reverb: 10, pan: 0 } },
    { id: "bass", name: "Bass Boost", speed: 100, fx: { bass: 8, mid: -1, treble: 1, reverb: 0, pan: 0 } },
    { id: "vocal", name: "Vocal Boost", speed: 100, fx: { bass: -3, mid: 4, treble: 2, reverb: 0, pan: 0 } },
    { id: "hall", name: "Concert Hall", speed: 100, fx: { bass: 1, mid: 0, treble: 1, reverb: 65, pan: 0 } },
    { id: "lofi", name: "Lo-fi", speed: 92, pitch: false, fx: { bass: 3, mid: -2, treble: -9, reverb: 20, pan: 0 } },
    { id: "daycore", name: "Daycore", speed: 80, pitch: false, fx: { bass: 2, mid: 0, treble: -3, reverb: 30, pan: 0 } },
    { id: "vapor", name: "Vaporwave", speed: 75, pitch: false, fx: { bass: 3, mid: -1, treble: -5, reverb: 50, pan: 0 } },
    { id: "chipmunk", name: "Chipmunk", speed: 150, pitch: false, fx: { bass: -2, mid: 1, treble: 3, reverb: 0, pan: 0 } },
    { id: "chill", name: "Chill & Slow", speed: 90, pitch: true, fx: { bass: 2, mid: 0, treble: -2, reverb: 25, pan: 0 } },
    { id: "car", name: "Car Speakers", speed: 100, fx: { bass: 6, mid: 2, treble: -1, reverb: 0, pan: 0 } },
    { id: "warm", name: "Warm", speed: 100, fx: { bass: 4, mid: 1, treble: -4, reverb: 5, pan: 0 } },
    { id: "bright", name: "Bright", speed: 100, fx: { bass: -1, mid: 1, treble: 6, reverb: 0, pan: 0 } },
    { id: "spoken", name: "Spoken Word", speed: 100, fx: { bass: -5, mid: 6, treble: 3, reverb: 0, pan: 0 } },
    { id: "underwater", name: "Underwater", speed: 95, pitch: true, fx: { bass: 6, mid: -4, treble: -12, reverb: 40, pan: 0 } },
    { id: "cathedral", name: "Cathedral", speed: 100, fx: { bass: 2, mid: -1, treble: 0, reverb: 95, pan: 0 } }
];
function loadCustomPresets() {
    try { const list = JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]"); return Array.isArray(list) ? list.filter((p) => p && p.id && p.name && p.fx) : []; }
    catch { return []; }
}
function saveCustomPresets(list) { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch {} }
function findPreset(id) { return BUILTIN_PRESETS.concat(loadCustomPresets()).find((p) => p.id === id); }
function presetMatches(p) {
    if (Math.round(p.speed) !== playbackSpeed) return false;
    if (p.speed !== 100 && p.pitch !== undefined && !!p.pitch !== preservePitch) return false;
    return Object.keys(FX_DEFAULTS).every((k) => (p.fx[k] ?? FX_DEFAULTS[k]) === fxSettings[k]);
}
function applyPreset(p) {
    setPlaybackSpeed(p.speed);
    if (p.pitch !== undefined) setPreservePitch(!!p.pitch);
    for (const k of Object.keys(FX_DEFAULTS)) setFx(k, p.fx[k] ?? FX_DEFAULTS[k], false);
    try { localStorage.setItem(FX_KEY, JSON.stringify(fxSettings)); } catch {}
    renderPresetChips();
    showToast(`Preset · ${p.name}`);
}
function renderPresetChips() {
    const box = $("preset-chips"); if (!box) return;
    box.innerHTML = BUILTIN_PRESETS.concat(loadCustomPresets()).map((p) => `<button type="button" class="preset-chip${p.custom ? " custom" : ""}${presetMatches(p) ? " active" : ""}" data-id="${escapeHtml(p.id)}"${p.custom ? ' title="Right-click or long-press to delete"' : ""}>${escapeHtml(p.name)}</button>`).join("");
}
let presetRefreshPending = false;
function schedulePresetRefresh() {
    if (presetRefreshPending) return;
    presetRefreshPending = true;
    requestAnimationFrame(() => { presetRefreshPending = false; renderPresetChips(); });
}
(() => {
    const box = $("preset-chips"); if (!box) return;
    box.addEventListener("click", (e) => { const chip = e.target.closest(".preset-chip"), p = chip && findPreset(chip.dataset.id); if (p) applyPreset(p); });
    box.addEventListener("contextmenu", async (e) => {
        const chip = e.target.closest(".preset-chip.custom"); if (!chip) return;
        e.preventDefault();
        const p = findPreset(chip.dataset.id); if (!p) return;
        if (await showPrompt({ title: "Delete preset", message: `Delete "${p.name}"?`, confirmText: "Delete", danger: true })) {
            saveCustomPresets(loadCustomPresets().filter((x) => x.id !== p.id)); renderPresetChips();
        }
    });
})();
if ($("preset-save-btn")) $("preset-save-btn").addEventListener("click", async () => {
    const name = await showPrompt({ title: "Save preset", message: "Saves the current speed, pitch setting and effects as a preset.", confirmText: "Save", input: { placeholder: "Preset name", maxLength: 24 } });
    if (!name) return;
    const list = loadCustomPresets();
    list.push({ id: "custom-" + Date.now().toString(36), name, custom: true, speed: playbackSpeed, pitch: preservePitch, fx: { ...fxSettings } });
    saveCustomPresets(list); renderPresetChips(); showToast(`Preset saved · ${name}`);
});

// ── GENERAL SETTINGS ──
function setPref(key, value) {
    prefs[key] = value; savePrefs();
    if (key === "name") updateGreeting();
    else if (key === "remainingTime") renderProgress(true);
    else if (key === "skipButtons") applySkipButtons();
    else if (key === "jumpButton") updateJumpButton();
    else if (key === "scrollEndButton") updateScrollEndButton();
    else if (key === "nextUpCount") renderQueue();
    else if (key === "smartShuffle" && shuffleEnabled) { generateShuffleOrder(); renderQueue(); }
    syncPrefsUi();
}
const PREF_TOGGLES = {
    "pref-open-home": "openOnHome", "pref-smooth-pause": "smoothPause", "pref-upnext": "upNextReminder", "pref-vibration": "vibration",
    "pref-remaining": "remainingTime", "pref-skip": "skipButtons", "pref-jump": "jumpButton", "pref-scroll-end": "scrollEndButton", "smart-shuffle-toggle": "smartShuffle",
    "pref-milestones": "milestoneToasts"
};
function syncPrefsUi() {
    for (const [id, key] of Object.entries(PREF_TOGGLES)) { const el = $(id); if (el && el.checked !== !!prefs[key]) el.checked = !!prefs[key]; }
    const name = $("pref-name"); if (name && document.activeElement !== name) name.value = prefs.name || "";
    const n = Math.max(0, Number(prefs.nextUpCount) || 0), input = $("pref-nextup");
    if (input && document.activeElement !== input) input.value = n > 0 ? String(n) : "";
    document.querySelectorAll("#nextup-choice button").forEach((b) => b.classList.toggle("active", Number(b.dataset.value) === n));
    for (const el of [totalTimeLabel, npTotalTime]) if (el) el.title = prefs.remainingTime ? "Show total time" : "Show remaining time";
    const la = $("pref-listen-after"), sb = $("pref-skip-before"), listen = listenThreshold(), skip = skipThreshold();
    if (la && document.activeElement !== la) la.value = String(listen);
    if (sb && document.activeElement !== sb) sb.value = skip > 0 ? String(skip) : "";
    const s = (n) => `${n} second${n === 1 ? "" : "s"}`;
    setText($("pref-count-hint"), `A play counts once you've listened for ${s(listen)}. Pressing Next ${skip > 0 ? `in the first ${s(skip)}` : "before the halfway point"} counts as a skip${skip > 0 ? "" : " (leave the box empty for that)"}.`);
    setText($("stats-hint"), `A play is counted after ${s(listen)} of listening. Stats are saved on this device.`);
}
for (const [id, key] of Object.entries(PREF_TOGGLES)) { const el = $(id); if (el) el.addEventListener("change", () => setPref(key, el.checked)); }
for (const el of [$("np-rating"), $("player-rating")]) if (el) el.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-rate]"); if (!b || !currentTrack) return;
    const n = Number(b.dataset.rate), next = ratingOf(currentTrack) === n ? 0 : n;
    setRating(currentTrack, next);
    if (next) playRatingEffect(next, b);
});
if ($("pref-name")) $("pref-name").addEventListener("input", (e) => setPref("name", e.target.value.slice(0, 40)));
// "Next up" length: type a number, nudge it, or pick a quick value ("All" = 0).
function setNextUpCount(n) { setPref("nextUpCount", clamp(Math.round(Number(n) || 0), 0, 500)); }
if ($("pref-nextup")) {
    const input = $("pref-nextup");
    input.addEventListener("change", () => setNextUpCount(input.value.trim() === "" ? 0 : input.value));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
}
if ($("nextup-minus")) $("nextup-minus").addEventListener("click", () => { const n = Number(prefs.nextUpCount) || 0; setNextUpCount(n <= 0 ? 50 : Math.max(1, n - 1)); });
if ($("nextup-plus")) $("nextup-plus").addEventListener("click", () => { const n = Number(prefs.nextUpCount) || 0; if (n > 0) setNextUpCount(n + 1); });
document.querySelectorAll("#nextup-choice button").forEach((b) => b.addEventListener("click", () => setNextUpCount(b.dataset.value)));
// Listen / skip thresholds (seconds). An empty skip box means "before halfway".
function setCountPref(key, v) { setPref(key, key === "listenAfter" ? clamp(Math.round(Number(v) || STATS_PLAY_THRESHOLD), 1, 600) : clamp(Math.round(Number(v) || 0), 0, 600)); }
for (const [id, key] of [["pref-listen-after", "listenAfter"], ["pref-skip-before", "skipBefore"]]) {
    const input = $(id); if (!input) continue;
    input.addEventListener("change", () => setCountPref(key, input.value.trim() === "" ? 0 : input.value));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
}
document.querySelectorAll("button[data-step]").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.step, cur = key === "listenAfter" ? listenThreshold() : skipThreshold();
    setCountPref(key, Math.max(key === "listenAfter" ? 1 : 0, cur + Number(b.dataset.delta)));
}));

// ── UP-NEXT REMINDER ──
// A few seconds before a song ends, a small toast says what's coming.
let remindedTrackId = null;
function maybeRemindUpNext() {
    if (!prefs.upNextReminder || !currentTrack || !isAudiblyPlaying() || remindedTrackId === currentTrack.id) return;
    const d = audioPlayer.duration;
    if (!Number.isFinite(d) || d < 30) return;
    const left = (d - audioPlayer.currentTime) / (audioPlayer.playbackRate || 1);
    if (left > Math.max(8, crossfadeDuration + 4) || left < 1) return;
    remindedTrackId = currentTrack.id;
    if (loopMode === "one" || sleepAtTrackEnd || document.visibilityState !== "visible" || toastHasAction()) return;
    const next = peekNextSong();
    if (next && next.song.id !== currentTrack.id) showToast(`Up next · ${next.song.title}${next.song.artist ? " — " + next.song.artist : ""}`, { duration: 3500 });
}

// ── MINI PLAYER (desktop) ──
// The player-bar button opens a small always-on-top window (mini.html, see main.js).
// It has no audio: this side sends it the track, play state, position, theme colours
// and the cover tint, and carries out the buttons pressed in it.
const miniApi = window.electronAPI && window.electronAPI.mini;
var miniOpen = false, miniPushTimer = null; // var: the like-button and theme hooks can run before this line
const miniArtCache = new Map(); // art URL → small data URL (blob URLs don't cross windows)
function miniArtData(url) {
    if (miniArtCache.has(url)) return miniArtCache.get(url);
    const p = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                // The middle square, like everywhere else (a wide cover used to come out squashed).
                const c = document.createElement("canvas"), m = Math.min(img.naturalWidth, img.naturalHeight); c.width = c.height = 160;
                c.getContext("2d").drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, 160, 160);
                resolve(c.toDataURL("image/jpeg", 0.85));
            } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
    miniArtCache.set(url, p);
    if (miniArtCache.size > 40) miniArtCache.delete(miniArtCache.keys().next().value);
    return p;
}
async function pushMiniState() {
    if (!miniApi || !miniOpen) return;
    const t = currentTrack, cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
    const art = t && t.art && t.art !== DEFAULT_ART ? await miniArtData(t.art) : null;
    miniApi.sendState({
        title: t ? t.title || "Unknown" : "", artist: t ? t.artist || "" : "", art,
        playing: !!t && isAudiblyPlaying(), position: audioPlayer.currentTime || 0, duration: audioPlayer.duration || (t && t.duration) || 0,
        rate: audioPlayer.playbackRate || 1, liked: !!t && isLiked(t),
        tint: (nowPlayingScreen && nowPlayingScreen.style.getPropertyValue("--np-tint")) || "",
        colors: { bg: v("--bg"), "text-1": v("--text-1"), "text-3": v("--text-3"), accent: v("--accent"), "accent-grad": v("--accent-grad"), "on-accent": v("--on-accent"), "fg-rgb": v("--fg-rgb"), font: v("--font") }
    });
}
function scheduleMiniState() { if (!miniOpen || miniPushTimer) return; miniPushTimer = setTimeout(() => { miniPushTimer = null; pushMiniState(); }, 60); }
function setMiniOpen(open) { miniOpen = open; $("mini-player-btn")?.classList.toggle("active", open); if (open) scheduleMiniState(); }
if (miniApi) {
    const btn = $("mini-player-btn");
    if (btn) { btn.hidden = false; btn.addEventListener("click", () => miniApi.toggle()); }
    miniApi.on("mini:opened", () => setMiniOpen(true));
    miniApi.on("mini:closed", () => setMiniOpen(false));
    miniApi.on("mini:command", (cmd) => {
        if (!cmd) return;
        if (cmd.type === "hello") setMiniOpen(true);
        else if (cmd.type === "play-pause") togglePlayPause();
        else if (cmd.type === "next") playNext();
        else if (cmd.type === "prev") playPrevious();
        else if (cmd.type === "like" && currentTrack) toggleLike(currentTrack);
        else if (cmd.type === "seek" && Number.isFinite(audioPlayer.duration)) audioPlayer.currentTime = clamp(Number(cmd.fraction) || 0, 0, 1) * audioPlayer.duration;
        scheduleMiniState();
    });
    for (const ev of ["play", "pause", "playing", "seeked", "loadedmetadata", "ratechange", "ended"]) onPlayer(ev, scheduleMiniState);
    setInterval(() => { if (miniOpen) pushMiniState(); }, 5000); // keeps the position honest
}

// ── TRAY ── (desktop) The button by the logo (or under the sidebar arrow) hides the window
// to the tray, where the music keeps playing; the tray menu shows the song that's on.
const trayApi = window.electronAPI && window.electronAPI.tray;
if (trayApi) {
    for (const id of ["tray-hide-btn", "tray-hide-float", "tray-hide-top"]) { const b = $(id); if (b) { b.hidden = false; b.addEventListener("click", () => trayApi.hide()); } }
    let trayTimer = null;
    const pushTray = () => {
        trayTimer = null;
        trayApi.setState({ title: currentTrack ? currentTrack.title || "Unknown" : "", artist: currentTrack ? currentTrack.artist || "" : "", playing: !!currentTrack && isAudiblyPlaying() });
    };
    const scheduleTray = () => { if (!trayTimer) trayTimer = setTimeout(pushTray, 150); };
    for (const ev of ["play", "pause", "playing", "loadedmetadata", "ended", "emptied"]) onPlayer(ev, scheduleTray);
    scheduleTray();
}

// ── UI BASES ── (Settings → Appearance → Layout)
// A layout ("base") is the shape of the app, separate from the theme's colours: where the
// navigation sits, how the player looks, whether the queue is docked, how panels and
// headings are drawn, how playlists show on Home, spacing and corner rounding. Classic and
// Modern are built in; your own are saved by name. They're applied as data-ui-* attributes
// on <html> and style.css does the rest. Where the window is too narrow for what a layout
// asks for, it adapts: a sidebar becomes an icon rail, a docked queue slides over instead.
const UI_KEY = "spootify-ui";
const UI_KNOBS = [
    ["nav", "Navigation", [["side", "Sidebar"], ["rail", "Icon rail"], ["top", "Top bar"]]],
    ["player", "Player", [["bar", "Full-width bar"], ["float", "Floating"]]],
    ["queue", "Queue", [["side", "Docked"], ["drawer", "Slide-over"]]],
    ["panels", "Panels", [["flat", "Flat"], ["cards", "Boxed"], ["open", "Open"]]],
    ["headings", "Headings", [["bold", "Bold"], ["mono", "Mono caps"]]],
    ["library", "Playlists on Home", [["grid", "Grid"], ["list", "List"]]],
    ["density", "Spacing", [["comfy", "Comfy"], ["compact", "Compact"]]]
];
const UI_BUILTIN = [
    { id: "classic", name: "Classic", nav: "side", player: "bar", queue: "side", panels: "flat", headings: "bold", library: "grid", density: "comfy", radius: 10 },
    { id: "modern", name: "Modern", nav: "top", player: "float", queue: "drawer", panels: "cards", headings: "mono", library: "grid", density: "compact", radius: 12 }
];
function sanitizeUiBase(b, id) {
    const out = { id, name: String(b?.name || "").trim().slice(0, 28) || "My layout" };
    for (const [k, , opts] of UI_KNOBS) out[k] = opts.some(([v]) => v === b?.[k]) ? b[k] : UI_BUILTIN[0][k];
    out.radius = clamp(Math.round(Number(b?.radius ?? 10)) || 0, 0, 24);
    return out;
}
let uiState = (() => {
    try {
        const s = JSON.parse(localStorage.getItem(UI_KEY) || "null");
        const custom = Array.isArray(s?.custom) ? s.custom.filter((b) => b && /^ui-[\w-]{1,40}$/.test(b.id)).map((b) => sanitizeUiBase(b, b.id)) : [];
        return { base: typeof s?.base === "string" ? s.base : "classic", custom };
    } catch { return { base: "classic", custom: [] }; }
})();
function saveUiState() { try { localStorage.setItem(UI_KEY, JSON.stringify(uiState)); } catch {} }
function allUiBases() { return UI_BUILTIN.concat(uiState.custom); }
function findUiBase(id) { return allUiBases().find((b) => b.id === id) || UI_BUILTIN[0]; }
let uiPreview = null; // the layout being edited, shown live while its editor is open
function activeUiBase() { return uiPreview || findUiBase(uiState.base); }

let queueAutoClosed = false; // the queue was open when the layout turned it into a slide-over
let uiFirstFit = true;
function fitLayout() {
    const b = activeUiBase(), root = document.documentElement, w = window.innerWidth;
    let nav = b.nav, queue = b.queue;
    if (w > 768) {
        if (nav === "side" && w < 1000) nav = "rail";
        if (queue === "side" && w < 1180) queue = "drawer";
    }
    const was = root.dataset.uiQueue;
    if (root.dataset.uiNav !== nav) root.dataset.uiNav = nav;
    if (was !== queue) root.dataset.uiQueue = queue;
    // A slide-over starts closed, so it never lands on top of what you're doing; going back
    // to a docked queue brings it back if it was open before.
    const hidden = document.body.classList.contains("queue-hidden");
    if (queue === "drawer" && (was !== "drawer" || uiFirstFit) && !hidden) { queueAutoClosed = true; setQueueHidden(true); }
    else if (queue === "side" && was === "drawer" && hidden && queueAutoClosed) { queueAutoClosed = false; setQueueHidden(false); }
    uiFirstFit = false;
    const top = $("top-nav"); if (top) top.hidden = nav !== "top";
    if (nav !== "top") closeLibraryMenu();
    updateTopNav();
}
function applyUiBase() {
    const b = activeUiBase(), root = document.documentElement;
    for (const [k] of UI_KNOBS) if (k !== "nav" && k !== "queue") root.dataset["ui" + k[0].toUpperCase() + k.slice(1)] = b[k];
    root.style.setProperty("--ui-r", b.radius + "px");
    fitLayout();
    if (selection) setTimeout(placeSelectBar, 60);
}
window.addEventListener("resize", fitLayout);
// The middle panel's own width (not the window's), so the grids and headers fit whatever
// room the sidebar and queue leave: main[data-w] = xs / s / m / l / xl.
if (mainContent && "ResizeObserver" in window) new ResizeObserver(([e]) => {
    const w = e.contentRect.width, size = w < 420 ? "xs" : w < 620 ? "s" : w < 900 ? "m" : w < 1250 ? "l" : "xl";
    if (mainContent.dataset.w !== size) mainContent.dataset.w = size;
}).observe(mainContent);

// ── Top bar (layouts with nav = top). "Library" drops the sidebar down as a menu.
function closeLibraryMenu() {
    if (sidebar) sidebar.classList.remove("nav-open");
    const t = document.querySelector('#top-nav [data-top="library"]'); if (t) t.classList.remove("open");
}
function updateTopNav() {
    const nav = $("top-nav"); if (!nav || nav.hidden) return;
    const inPlaylist = playlistView && playlistView.style.display !== "none";
    const tab = !inPlaylist ? "home" : isLikedSource(currentPlaylist) ? "liked" : "library";
    nav.querySelectorAll(".top-tab").forEach((b) => b.classList.toggle("active", b.dataset.top === tab));
}
if ($("top-nav")) $("top-nav").addEventListener("click", (e) => {
    const b = e.target.closest(".top-tab"); if (!b) return;
    const t = b.dataset.top;
    if (t === "library") { const open = !sidebar.classList.contains("nav-open"); sidebar.classList.toggle("nav-open", open); b.classList.toggle("open", open); return; }
    closeLibraryMenu();
    if (t === "home") showHome(); else if (t === "liked") loadPlaylistPage(LIKED_SOURCE); else if (t === "stats") openStats(); else if (t === "settings") openSettings();
    updateTopNav();
});
document.addEventListener("click", (e) => { if (sidebar && sidebar.classList.contains("nav-open") && !e.target.closest('#sidebar, [data-top="library"]')) closeLibraryMenu(); });
if (sidebar) sidebar.addEventListener("click", (e) => { if (document.documentElement.dataset.uiNav === "top" && e.target.closest(".sidebar-playlist-item, .nav-btn")) setTimeout(closeLibraryMenu, 0); });
// A slide-over queue closes when you tap anywhere else.
document.addEventListener("pointerdown", (e) => {
    if (document.documentElement.dataset.uiQueue !== "drawer" || document.body.classList.contains("queue-hidden")) return;
    if (!e.target.closest("#queue-panel, #queue-toggle-btn, .context-menu, .modal-overlay, .settings-overlay, .drag-ghost")) setQueueHidden(true);
});

// ── The Layout section and its editor
// A tiny drawing of each layout: where the nav, main panel, queue and player go.
function uiSchemHtml(b) {
    return `<div class="ui-schem" data-nav="${b.nav}" data-player="${b.player}" data-queue="${b.queue}" data-panels="${b.panels}" data-library="${b.library}" style="--sr:${Math.round(b.radius / 3)}px"><i class="s-nav"></i><i class="s-main"><b></b><b></b><b></b><b></b><b></b><b></b></i><i class="s-queue"></i><i class="s-player"></i></div>`;
}
function renderUiBaseGrid() {
    const grid = $("ui-base-grid"); if (!grid) return;
    grid.innerHTML = allUiBases().map((b) => {
        const mine = !UI_BUILTIN.includes(b);
        return `<div class="ui-base-card${b.id === uiState.base ? " active" : ""}" data-id="${escapeHtml(b.id)}" role="button" tabindex="0" aria-label="${escapeHtml(b.name)} layout">${uiSchemHtml(b)}<div class="theme-name"><span>${escapeHtml(b.name)}</span><button type="button" class="theme-edit-btn" data-edit="${escapeHtml(b.id)}" title="${mine ? "Edit" : "Make your own version"}" aria-label="${mine ? "Edit" : "Customise"} ${escapeHtml(b.name)}">${ICONS.pencil}</button></div></div>`;
    }).join("");
}
function setUiBase(id) { uiState.base = findUiBase(id).id; saveUiState(); applyUiBase(); renderUiBaseGrid(); }
const uiEd = { overlay: $("ui-base-editor"), title: $("ui-base-editor-title"), name: $("ui-base-name"), knobs: $("ui-base-knobs"), del: $("ui-base-delete") };
let uiEditing = null; // { id: the custom layout being edited (null = a new one), draft }
function openUiBaseEditor(fromId, editId) {
    if (!uiEd.overlay) return;
    const src = findUiBase(editId || fromId || uiState.base);
    uiEditing = { id: editId || null, draft: { ...src } };
    setText(uiEd.title, editId ? "Edit layout" : "New layout");
    uiEd.name.value = editId ? src.name : `My ${src.name.toLowerCase()}`;
    uiEd.del.hidden = !editId;
    renderUiKnobs();
    uiPreview = uiEditing.draft; applyUiBase();
    document.body.classList.add("ui-editing"); // the settings panel steps aside so the change shows on the app itself
    uiEd.overlay.style.display = "flex";
}
function renderUiKnobs() {
    const d = uiEditing.draft;
    uiEd.knobs.innerHTML = `<div class="ui-base-preview">${uiSchemHtml(d)}</div>`
        + UI_KNOBS.map(([k, label, opts]) => `<div class="settings-choice-row stacked"><span>${label}</span><div class="segmented" data-knob="${k}">${opts.map(([v, t]) => `<button type="button" data-value="${v}" class="${d[k] === v ? "active" : ""}">${t}</button>`).join("")}</div></div>`).join("")
        + `<div class="settings-choice-row stacked"><span>Corner rounding · <em id="ui-radius-val">${d.radius}px</em></span><input type="range" class="settings-slider" id="ui-radius" min="0" max="24" step="1" value="${d.radius}" style="--p:${(d.radius / 24) * 100}%" aria-label="Corner rounding"></div>`;
}
function closeUiBaseEditor() {
    if (!uiEd.overlay) return;
    uiEd.overlay.style.display = "none";
    document.body.classList.remove("ui-editing");
    uiEditing = null; uiPreview = null; applyUiBase();
}
if (uiEd.knobs) {
    uiEd.knobs.addEventListener("click", (e) => {
        const b = e.target.closest("[data-knob] button"); if (!b || !uiEditing) return;
        uiEditing.draft[b.parentElement.dataset.knob] = b.dataset.value;
        b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        uiEd.knobs.querySelector(".ui-base-preview").innerHTML = uiSchemHtml(uiEditing.draft);
        applyUiBase();
    });
    uiEd.knobs.addEventListener("input", (e) => {
        if (e.target.id !== "ui-radius" || !uiEditing) return;
        const v = Number(e.target.value); uiEditing.draft.radius = v;
        e.target.style.setProperty("--p", (v / 24) * 100 + "%"); setText($("ui-radius-val"), v + "px");
        applyUiBase();
    });
}
if ($("ui-base-cancel")) $("ui-base-cancel").addEventListener("click", closeUiBaseEditor);
if ($("ui-base-save")) $("ui-base-save").addEventListener("click", () => {
    if (!uiEditing) return;
    const name = uiEd.name.value.trim(); if (!name) { uiEd.name.focus(); return; }
    const id = uiEditing.id || "ui-" + Date.now().toString(36);
    const saved = sanitizeUiBase({ ...uiEditing.draft, name }, id), i = uiState.custom.findIndex((b) => b.id === id);
    if (i >= 0) uiState.custom[i] = saved; else uiState.custom.push(saved);
    uiState.base = id; saveUiState();
    closeUiBaseEditor(); renderUiBaseGrid();
    showToast(`Layout "${saved.name}" saved`);
});
if ($("ui-base-delete")) $("ui-base-delete").addEventListener("click", async () => {
    if (!uiEditing || !uiEditing.id) return;
    const b = findUiBase(uiEditing.id);
    if (!await showPrompt({ title: "Delete this layout?", message: `"${b.name}" will be gone. The app goes back to Classic if you were using it.`, confirmText: "Delete", danger: true })) return;
    uiState.custom = uiState.custom.filter((x) => x.id !== b.id);
    if (uiState.base === b.id) uiState.base = "classic";
    saveUiState(); closeUiBaseEditor(); renderUiBaseGrid();
});
if ($("ui-base-new")) $("ui-base-new").addEventListener("click", () => openUiBaseEditor(uiState.base));
if ($("ui-base-grid")) {
    $("ui-base-grid").addEventListener("click", (e) => {
        const ed = e.target.closest("[data-edit]");
        if (ed) { e.stopPropagation(); const b = findUiBase(ed.dataset.edit); if (UI_BUILTIN.includes(b)) openUiBaseEditor(b.id); else openUiBaseEditor(null, b.id); return; }
        const card = e.target.closest(".ui-base-card"); if (card) setUiBase(card.dataset.id);
    });
    $("ui-base-grid").addEventListener("keydown", (e) => { const card = e.target.closest(".ui-base-card"); if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setUiBase(card.dataset.id); } });
}
applyUiBase();

// ── QUIET MODE ──
// Home's moon button: the theme background, a back button and a small card with the
// cover, progress and transport, sitting between the middle and the top. It doubles as
// a battery saver: the app underneath is skipped by the renderer (content-visibility),
// the 60 fps progress loop, the visualizer and the background drift all stop, and the
// bar only moves on "timeupdate" (a few times a second).
const quietEls = {
    overlay: $("quiet-overlay"), art: $("quiet-art"), title: $("quiet-title"), artist: $("quiet-artist"),
    bar: $("quiet-progress"), fill: $("quiet-progress-fill"), time: $("quiet-time"), total: $("quiet-total"), play: $("quiet-play-btn")
};
// Read from the root flag (not a let) so the progress loop and visualizer can ask early in boot.
function isQuietOpen() { return document.documentElement.dataset.quiet === "1"; }
function openQuiet() {
    if (!quietEls.overlay || isQuietOpen()) return;
    closeContextMenu();
    document.documentElement.dataset.quiet = "1";
    quietEls.overlay.hidden = false;
    stopProgressLoop(); clearVisualizers();
    if (appearance.quietSmooth && !audioPlayer.paused) startProgressLoop();
    renderQuiet(true);
}
function closeQuiet() {
    if (!isQuietOpen()) return;
    document.documentElement.dataset.quiet = "0";
    quietEls.overlay.hidden = true;
    if (Themes && Themes.resumeDrift) Themes.resumeDrift();
    renderProgress(true);
    if (!audioPlayer.paused) startProgressLoop();
    kickVisualizer();
}
let quietSecond = -1, quietPlaying = null;
function renderQuiet(force = false) {
    if (!isQuietOpen() || (!force && document.visibilityState !== "visible")) return;
    if (force) {
        const song = currentTrack, art = song ? (song.art || DEFAULT_ART) : DEFAULT_ART;
        if (quietEls.art.getAttribute("src") !== art) quietEls.art.src = art;
        setText(quietEls.title, song ? song.title : "Nothing playing");
        setText(quietEls.artist, song ? (song.artist || "") : "Press play to start something");
    }
    const playing = isAudiblyPlaying();
    if (force || playing !== quietPlaying) {
        quietPlaying = playing;
        quietEls.play.innerHTML = playing ? NP_PAUSE_SVG : NP_PLAY_SVG;
        quietEls.play.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
    const d = audioPlayer.duration, t = audioPlayer.currentTime || 0, hasD = Number.isFinite(d) && d > 0;
    quietEls.fill.style.transform = `scaleX(${hasD ? Math.min(1, t / d) : 0})`;
    const sec = Math.floor(t);
    if (force || sec !== quietSecond) {
        quietSecond = sec;
        setText(quietEls.time, formatTime(t));
        setText(quietEls.total, hasD ? formatTime(d) : "0:00");
    }
}
for (const ev of ["timeupdate", "seeked", "loadedmetadata", "durationchange"]) onPlayer(ev, () => renderQuiet());
document.addEventListener("visibilitychange", () => renderQuiet(true));
if ($("quiet-open-btn")) $("quiet-open-btn").addEventListener("click", openQuiet);
if ($("quiet-back-btn")) $("quiet-back-btn").addEventListener("click", closeQuiet);
if (quietEls.play) quietEls.play.addEventListener("click", () => { togglePlayPause(); renderQuiet(); });
if ($("quiet-prev-btn")) $("quiet-prev-btn").addEventListener("click", () => playPrevious());
if ($("quiet-next-btn")) $("quiet-next-btn").addEventListener("click", () => playNext());
if (quietEls.bar) {
    const seekAt = (e) => {
        const d = audioPlayer.duration; if (!currentTrack || !Number.isFinite(d) || d <= 0) return;
        const r = quietEls.bar.getBoundingClientRect(), pct = clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
        seekBy(pct * d - (audioPlayer.currentTime || 0)); renderQuiet(true);
    };
    quietEls.bar.addEventListener("pointerdown", (e) => { quietEls.bar.setPointerCapture(e.pointerId); seekAt(e); });
    quietEls.bar.addEventListener("pointermove", (e) => { if (quietEls.bar.hasPointerCapture(e.pointerId)) seekAt(e); });
    quietEls.bar.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); seekBy(e.key === "ArrowLeft" ? -5 : 5); renderQuiet(true); }
    });
}

// ── ADD SONGS FROM ANOTHER PLAYLIST ──
// Playlist ⋯ → "Add songs from…": pick a playlist, then tap songs in it to tick them;
// they're copied into the target in one go. Songs the target already has (same audio)
// are marked "Added" and can't be picked twice.
const addFromEls = {
    overlay: $("addfrom-overlay"), list: $("addfrom-list"), title: $("addfrom-title"), intro: $("addfrom-intro"),
    back: $("addfrom-back-btn"), all: $("addfrom-all-btn"), search: $("addfrom-search"), searchWrap: $("addfrom-search-wrap"),
    foot: $("addfrom-foot"), count: $("addfrom-count"), add: $("addfrom-add-btn")
};
let addFrom = null; // { target, source, picked: Set<song id>, query }
const ICON_TICK = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
function openAddFrom(target) {
    if (!addFromEls.overlay || !playlists[target]) return;
    closeContextMenu();
    addFrom = { target, source: null, picked: new Set(), query: "" };
    addFromEls.overlay.style.display = "flex";
    renderAddFromPlaylists();
}
function closeAddFrom() { if (addFromEls.overlay) addFromEls.overlay.style.display = "none"; addFrom = null; }
function addFromHave() { return new Set((playlists[addFrom.target]?.songs || []).map(statsKeyFor)); }
function addFromSourceSongs() {
    if (!addFrom || !addFrom.source) return [];
    return isLikedSource(addFrom.source) ? getLikedSongs() : (playlists[addFrom.source]?.songs || []);
}
function renderAddFromPlaylists() {
    if (!addFrom) return;
    addFrom.source = null; addFrom.picked.clear(); addFrom.query = "";
    if (addFromEls.search) addFromEls.search.value = "";
    addFromEls.back.hidden = true; addFromEls.all.hidden = true; addFromEls.searchWrap.hidden = true; addFromEls.foot.hidden = true;
    setText(addFromEls.title, "Add songs");
    setText(addFromEls.intro, `Pick a playlist to add songs from. They're copied into "${addFrom.target}".`);
    const have = addFromHave();
    const sources = [...(getLikedSongs().length ? [LIKED_SOURCE] : []), ...getOrderedPlaylistNames().filter((n) => n !== addFrom.target)];
    if (!sources.length) { addFromEls.list.innerHTML = '<div class="stats-empty">No other playlists yet.</div>'; return; }
    addFromEls.list.innerHTML = sources.map((n, i) => {
        const songs = isLikedSource(n) ? getLikedSongs() : playlists[n].songs || [];
        const fresh = songs.filter((s) => !have.has(statsKeyFor(s))).length;
        const sub = `${songs.length} ${songs.length === 1 ? "song" : "songs"}` + (songs.length ? (fresh ? ` · ${fresh} not in this one` : " · all already in this one") : "");
        return `<div class="stats-row addfrom-pl" data-name="${escapeHtml(n)}" style="--i:${Math.min(i, 12)}"><div class="addfrom-cover">${playlistCoverHtml(n)}</div>
            <div class="stats-row-info"><strong>${escapeHtml(isLikedSource(n) ? "Liked Songs" : n)}</strong><span>${sub}</span></div><span class="addfrom-chev">${ICONS.chevronRight}</span></div>`;
    }).join("");
}
async function openAddFromSource(name) {
    if (!addFrom) return;
    addFrom.source = name; addFrom.picked.clear(); addFrom.query = "";
    addFromEls.back.hidden = false; addFromEls.all.hidden = false; addFromEls.searchWrap.hidden = false; addFromEls.foot.hidden = false;
    setText(addFromEls.title, isLikedSource(name) ? "Liked Songs" : name);
    setText(addFromEls.intro, `Tap songs to add them to "${addFrom.target}".`);
    renderAddFromSongs();
    addFromEls.list.scrollTop = 0;
    if (await hydrateSongArt(addFromSourceSongs()) && addFrom && addFrom.source === name) renderAddFromSongs();
}
function addFromVisibleSongs() {
    const q = addFrom.query;
    const songs = addFromSourceSongs();
    return q ? songs.filter((s) => `${s.title || ""} ${s.artist || ""}`.toLowerCase().includes(q)) : songs;
}
function renderAddFromSongs() {
    if (!addFrom || !addFrom.source) return;
    const have = addFromHave(), songs = addFromVisibleSongs();
    addFromEls.list.innerHTML = songs.length ? songs.map((s, i) => {
        const owned = have.has(statsKeyFor(s)), on = addFrom.picked.has(s.id);
        return `<div class="stats-row addfrom-song${on ? " picked" : ""}${owned ? " owned" : ""}" data-id="${escapeHtml(String(s.id))}" style="--i:${Math.min(i, 12)}" role="checkbox" aria-checked="${on}">
            <img src="${escapeHtml(s.art || DEFAULT_ART)}" alt="" loading="lazy">
            <div class="stats-row-info"><strong>${escapeHtml(s.title || "Unknown")}</strong><span>${escapeHtml(s.artist || "Unknown Artist")}</span></div>
            ${owned ? '<span class="addfrom-owned">Added</span>' : `<span class="addfrom-check">${ICON_TICK}</span>`}</div>`;
    }).join("") : `<div class="stats-empty">${addFrom.query ? "No songs match." : "This playlist is empty."}</div>`;
    syncAddFromFoot();
}
function syncAddFromFoot() {
    if (!addFrom) return;
    const n = addFrom.picked.size, have = addFromHave();
    const free = addFromVisibleSongs().filter((s) => !have.has(statsKeyFor(s)));
    setText(addFromEls.count, n ? `${n} selected` : "Nothing selected");
    addFromEls.add.disabled = !n;
    setText(addFromEls.add, n ? `Add ${n}` : "Add");
    addFromEls.all.hidden = !free.length;
    setText(addFromEls.all, free.length && free.every((s) => addFrom.picked.has(s.id)) ? "Select none" : "Select all");
}
async function commitAddFrom() {
    if (!addFrom || !addFrom.picked.size) return;
    const { target, picked } = addFrom, pl = playlists[target];
    if (!pl) { closeAddFrom(); return; }
    const have = addFromHave(), now = Date.now();
    const copies = addFromSourceSongs().filter((s) => picked.has(s.id) && !have.has(statsKeyFor(s))).map((s) => ({ ...s, id: newSongId(), timestamp: now }));
    closeAddFrom();
    if (!copies.length) return;
    pl.songs.push(...copies);
    haptic(10);
    await saveLibrary(); renderSongs(); renderPlaylists();
    const ids = new Set(copies.map((c) => c.id));
    offerUndo(`Added ${copies.length} ${copies.length === 1 ? "song" : "songs"} to ${target}`, async () => {
        const p = playlists[target]; if (!p) return;
        p.songs = p.songs.filter((s) => !ids.has(s.id));
        await saveLibrary(); renderSongs(); renderPlaylists(); renderQueue();
    });
}
if (addFromEls.overlay) {
    addFromEls.overlay.addEventListener("click", (e) => { if (e.target === addFromEls.overlay) closeAddFrom(); });
    $("addfrom-close-btn").addEventListener("click", closeAddFrom);
    addFromEls.back.addEventListener("click", renderAddFromPlaylists);
    addFromEls.add.addEventListener("click", commitAddFrom);
    addFromEls.list.addEventListener("click", (e) => {
        if (!addFrom) return;
        const pl = e.target.closest(".addfrom-pl");
        if (pl) { openAddFromSource(pl.dataset.name); return; }
        const row = e.target.closest(".addfrom-song");
        if (!row || row.classList.contains("owned")) return;
        const song = addFromSourceSongs().find((s) => String(s.id) === row.dataset.id); if (!song) return;
        const on = !addFrom.picked.has(song.id);
        if (on) addFrom.picked.add(song.id); else addFrom.picked.delete(song.id);
        row.classList.toggle("picked", on); row.setAttribute("aria-checked", String(on));
        if (on) haptic(5);
        syncAddFromFoot();
    });
    addFromEls.all.addEventListener("click", () => {
        if (!addFrom) return;
        const have = addFromHave(), free = addFromVisibleSongs().filter((s) => !have.has(statsKeyFor(s)));
        const all = free.every((s) => addFrom.picked.has(s.id));
        for (const s of free) { if (all) addFrom.picked.delete(s.id); else addFrom.picked.add(s.id); }
        addFromEls.list.querySelectorAll(".addfrom-song:not(.owned)").forEach((row) => {
            const on = addFrom.picked.has(Number(row.dataset.id)) || addFrom.picked.has(row.dataset.id);
            row.classList.toggle("picked", on); row.setAttribute("aria-checked", String(on));
        });
        syncAddFromFoot();
    });
    let t;
    addFromEls.search.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => { if (!addFrom) return; addFrom.query = addFromEls.search.value.trim().toLowerCase(); renderAddFromSongs(); }, 80);
    });
}

// ── OVERLAYS ──
// html[data-overlay="1"] while a pop-up covers the app. The drifting theme dots stop
// drawing then (nobody can see them under the scrim), which keeps opening and closing
// pop-ups smooth. Watched rather than set by each open/close function, so none is missed.
const OVERLAY_IDS = ["crop-overlay", "settings-overlay", "stats-overlay", "artist-overlay", "trim-overlay", "bin-overlay", "dup-overlay", "wrapped-overlay", "dj-overlay", "modal-overlay", "yt-overlay", "confirm-overlay", "import-choice-overlay", "pick-playlist-overlay", "addfrom-overlay", "export-overlay", "sync-overlay", "info-overlay", "storage-overlay"];
function syncOverlayFlag() {
    const open = OVERLAY_IDS.some((id) => isShown($(id))) ? "1" : "0";
    if (document.documentElement.dataset.overlay !== open) document.documentElement.dataset.overlay = open;
}
(() => {
    const watch = new MutationObserver(syncOverlayFlag);
    for (const id of OVERLAY_IDS) { const el = $(id); if (el) watch.observe(el, { attributes: true, attributeFilter: ["style", "hidden"] }); }
    syncOverlayFlag();
})();
// The full-screen player (phones) hides the app's own background completely.
function setThemeBgCovered(covered) { const bg = $("theme-bg"); if (bg) bg.dataset.covered = covered ? "1" : ""; }

// ── OVERLAYS: Escape / Android Back ──
// Closes the topmost thing that's open. Returns false when nothing was.
function closeTopOverlay(fromBack) {
    if (isQuietOpen()) { closeQuiet(); return true; }
    if (isShown($("ui-base-editor"))) { closeUiBaseEditor(); return true; }
    if (colorState) { closeColorPicker(false); return true; }
    if (isShown(cropEls.overlay)) { closeCropper(); return true; }
    if (document.getElementById("active-context-menu")) { closeContextMenu(); return true; }
    if (isShown(confirmOverlay)) { if (fromBack) (confirmCancelBtn.style.display !== "none" ? confirmCancelBtn : confirmDeleteBtn).click(); return true; }
    const importChoice = $("import-choice-overlay");
    if (isShown(importChoice)) { if (fromBack) $("import-cancel-btn").click(); return true; }
    if (isShown($("pick-playlist-overlay"))) { $("pick-cancel-btn").click(); return true; }
    if (isShown(exportEls.overlay)) { if (!exportJob) closeExportDialog(); return true; } // Stop is a button, not Back
    if (isShown($("sync-overlay"))) { closeSyncDialog(); return true; } // sync.js; while songs move this only hides it
    const editor = $("theme-editor");
    if (editor && !editor.hidden) { closeThemeEditor(false); return true; }
    if (wrappedOverlay && !wrappedOverlay.hidden) { closeWrapped(); return true; }
    if (window.SpootifyDJ && window.SpootifyDJ.isOpen()) { window.SpootifyDJ.back(); return true; }
    if (isShown(trimEls.overlay)) { if (!trimBusy) closeTrimmer(); return true; }
    if (isShown(ytEls.overlay)) { closeYtModal(); return true; } // imports carry on in the background
    if (isShown(modalOverlay)) { if (!modalBusy) closeModal(); return true; }
    if (isShown(addFromEls.overlay)) { if (fromBack && addFrom && addFrom.source) renderAddFromPlaylists(); else closeAddFrom(); return true; }
    if (isShown(infoOverlay)) { closeSongInfo(); return true; }
    if (isShown(dupOverlay)) { closeDuplicates(); return true; }
    if (isShown(binOverlay)) { closeBin(); return true; }
    if (isShown(storageOverlay)) { closeStorage(); return true; }
    if (isShown(artistOverlay)) { closeArtistPage(); return true; }
    if (isShown(statsOverlay)) { closeStats(); return true; }
    if (isShown(settingsOverlay)) { closeSettings(); return true; }
    if (isNowPlayingOpen()) { closeNowPlaying(); return true; }
    if (isSelecting()) { endSelection(); return true; }
    return false;
}
// Capture phase, ahead of the per-overlay handlers, so one Escape closes one thing.
// Prompts handle their own keys (Escape = cancel, Enter = OK).
window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || isShown(confirmOverlay) || isShown($("import-choice-overlay"))) return;
    if (closeTopOverlay(false)) { e.preventDefault(); e.stopPropagation(); }
}, true);
nativeAudio.onBack(() => {
    if (closeTopOverlay(true)) return;
    if (playlistView && playlistView.style.display !== "none") { showHome(); return; }
    nativeAudio.minimize(); // keep playing in the background rather than quitting
});

// Crossing the phone/desktop width changes which player and queue are on screen.
let lastLayoutMobile = isMobile();
window.addEventListener("resize", throttle(() => {
    const m = isMobile();
    if (m !== lastLayoutMobile) { lastLayoutMobile = m; if (!m) closeNowPlaying(); renderQueue(); kickVisualizer(); }
    updateJumpButton();
}, 150));
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { updateGreeting(); renderProgress(true); kickVisualizer(); updatePlayPauseIcon(); }
});


// ══════════════════════════════════════════════
// ── IMPORT (search YouTube, or paste a link) via yt-dlp ──
// Desktop: main.js runs yt-dlp (fetched on first use) and returns the bytes over IPC.
// Android: the YtDlp Capacitor plugin runs youtubedl-android and returns temp file paths,
// which we read back through Capacitor's local file server. Both are normalised here to
//   status() / setup() / info(url) / playlist(url) -> { title, entries[] } /
//   download(url, id) -> { audio:{ext,data}, image } / cancel(id) / update()
// playlist() also runs searches: "ytsearch15:<words>" lists the top results the same way
// a playlist is listed (fast, nothing downloaded).
// ══════════════════════════════════════════════
const ytBackend = (() => {
    const el = window.electronAPI && window.electronAPI.ytdlp;
    if (el) {
        return {
            available: true, platform: "electron",
            status: () => el.status(), setup: () => el.setup(), info: (url) => el.info(url),
            playlist: typeof el.playlist === "function" ? (url) => el.playlist(url) : null,
            download: (url, id) => el.download(url, id), update: () => el.update(),
            cancel: () => (typeof el.cancel === "function" ? el.cancel() : Promise.resolve(false)),
            onProgress: (cb) => el.onProgress(cb)
        };
    }
    const cap = window.Capacitor;
    if (cap && typeof cap.nativePromise === "function" && typeof cap.getPlatform === "function" && cap.getPlatform() === "android") {
        const call = (method, data) => cap.nativePromise("YtDlp", method, data || {});
        const readFile = async (path) => {
            const res = await fetch(cap.convertFileSrc(path));
            if (!res.ok) throw new Error("Could not read the downloaded file (" + res.status + ")");
            return new Uint8Array(await res.arrayBuffer());
        };
        return {
            available: true, platform: "android",
            status: () => call("status"), setup: () => call("setup"),
            info: (url) => call("info", { url }).then((r) => r.info),
            playlist: (url) => call("playlist", { url }),
            download: async (url, id) => {
                const r = await call("download", { url, id });
                try {
                    const audio = { ext: r.audioExt, data: await readFile(r.audioPath) };
                    const image = r.imagePath ? { ext: r.imageExt, data: await readFile(r.imagePath) } : null;
                    return { audio, image };
                } finally {
                    call("cleanup", { paths: [r.audioPath, r.imagePath].filter(Boolean) }).catch(() => {});
                }
            },
            cancel: (id) => call("cancel", { id: id || "" }).catch(() => false),
            update: () => call("update").then((r) => ({ message: r.status === "ALREADY_UP_TO_DATE" ? "yt-dlp is already up to date" : "yt-dlp updated" + (r.version ? " to " + r.version : "") })),
            onProgress: (cb) => { const h = cap.addListener("YtDlp", "ytProgress", cb); return () => { try { h.remove(); } catch {} }; }
        };
    }
    return { available: false, platform: null };
})();

const MIME_BY_EXT = { m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", webm: "audio/webm", opus: "audio/ogg", ogg: "audio/ogg", mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
function mimeFor(ext) { return MIME_BY_EXT[(ext || "").toLowerCase()] || "application/octet-stream"; }
function errorText(e) { return (e && (e.message || (e.error && e.error.message))) || String(e || "Unknown error"); }
function probeDuration(src, fallback) {
    return new Promise((resolve) => {
        const temp = new Audio(); temp.preload = "metadata";
        // removeAttribute + load() lets the probe's player go; src = "" made it try to load the page as audio.
        const done = (v) => { temp.removeAttribute("src"); try { temp.load(); } catch {} resolve(v); };
        const timer = setTimeout(() => done(fallback), 8000);
        temp.addEventListener("loadedmetadata", () => { clearTimeout(timer); done(temp.duration && isFinite(temp.duration) ? temp.duration : fallback); });
        temp.addEventListener("error", () => { clearTimeout(timer); done(fallback); });
        temp.src = src;
    });
}

// The Import screen has two ways in: search YouTube (yt-dlp's "ytsearchN:" lists results
// without downloading anything) and paste a link (one video, or ticked songs from a
// playlist). Either way songs land in the import list ("About to import"), which you can
// edit, and which downloads one song at a time into the playlist you choose, carrying on
// in the background if you close the screen (a small pill shows progress and reopens it).
// The list is saved, so nothing waiting is lost if the app closes.
const ytEls = {
    overlay: $("yt-overlay"), tabs: $("yt-tabs"), searchPane: $("yt-search-pane"), linkPane: $("yt-link-pane"),
    searchForm: $("yt-search-form"), q: $("yt-q"), qClear: $("yt-q-clear"), searchBtn: $("yt-search-btn"), results: $("yt-results"),
    url: $("yt-url"), fetchBtn: $("yt-fetch-btn"), status: $("yt-status"), cancelBtn: $("yt-cancel-btn"), closeX: $("yt-close-x"),
    setup: $("yt-setup"), setupText: $("yt-setup-text"), setupBtn: $("yt-setup-btn"), updateBtn: $("yt-update-btn"),
    modeRow: $("yt-mode-row"), mode: $("yt-mode"), plPreview: $("yt-pl-preview"), plTitle: $("yt-pl-title"), plCount: $("yt-pl-count"),
    plAll: $("yt-pl-all"), plList: $("yt-pl-list"), plAdd: $("yt-pl-add"),
    queue: $("yt-queue"), queueToggle: $("yt-queue-toggle"), queueCount: $("yt-queue-count"), queueList: $("yt-queue-list"), queueClear: $("yt-queue-clear"),
    tidy: $("yt-tidy"), square: $("yt-square"), dest: $("yt-dest"), destName: $("yt-dest-name"), importBtn: $("yt-import-btn"),
    pill: $("import-pill"), pillArc: $("import-pill-arc"), pillTitle: $("import-pill-title"), pillSub: $("import-pill-sub")
};
let ytReady = false, ytBusy = false, ytStatusPoll = null; // ytBusy: a link lookup, setup or update is running
let ytMode = "single", ytPlaylist = null;
let ytTab = (() => { try { return localStorage.getItem("spootify-import-tab") === "link" ? "link" : "search"; } catch { return "search"; } })();

function ytSetStatus(msg, kind = "") { if (!ytEls.status) return; ytEls.status.textContent = msg || ""; ytEls.status.className = "yt-status" + (kind ? " " + kind : ""); }
function ytSetBusy(busy) {
    ytBusy = busy;
    [ytEls.fetchBtn, ytEls.updateBtn, ytEls.setupBtn, ytEls.plAll, ytEls.plAdd].forEach((b) => { if (b) b.disabled = busy; });
    if (ytEls.mode) ytEls.mode.querySelectorAll("button").forEach((b) => { b.disabled = busy; });
    if (ytEls.plList) ytEls.plList.querySelectorAll("input").forEach((i) => { i.disabled = busy; });
    if (ytEls.url) ytEls.url.disabled = busy;
}
function selectYtTab(tab) {
    ytTab = tab === "link" ? "link" : "search";
    try { localStorage.setItem("spootify-import-tab", ytTab); } catch {}
    if (ytEls.tabs) ytEls.tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === ytTab));
    if (ytEls.searchPane) ytEls.searchPane.hidden = ytTab !== "search";
    if (ytEls.linkPane) ytEls.linkPane.hidden = ytTab !== "link";
}

function openYtModal(preselectPlaylist) {
    if (!ytEls.overlay) return;
    if (!ytBackend.available) { showMessage("Not available here", "Importing from YouTube works in the desktop app (Windows/Linux) and the Android app."); return; }
    // Opened from a playlist: that's where songs go, unless a list is already waiting for somewhere else.
    if (preselectPlaylist && playlists[preselectPlaylist] && !importer.running && !importList.items.some((i) => i.status === "queued")) importList.dest = preselectPlaylist;
    ytSetStatus("");
    ytEls.overlay.style.display = "flex";
    selectYtTab(ytTab);
    fillImportDest(); renderImportList(); renderYtResults(); syncImportUi();
    ytSetBusy(ytBusy);
    refreshYtStatus();
    if (!isMobile()) setTimeout(() => { const f = ytTab === "search" ? ytEls.q : ytEls.url; if (f && isShown(ytEls.overlay)) f.focus(); }, 60);
}
function closeYtModal() {
    if (ytEls.overlay) ytEls.overlay.style.display = "none";
    if (ytStatusPoll) { clearTimeout(ytStatusPoll); ytStatusPoll = null; }
    syncImportUi(); // the progress pill takes over if songs are still downloading
}

async function refreshYtStatus() {
    if (ytStatusPoll) { clearTimeout(ytStatusPoll); ytStatusPoll = null; }
    try {
        const st = await ytBackend.status();
        ytReady = !!st.ready;
        if (ytEls.setup) ytEls.setup.style.display = ytReady ? "none" : "flex";
        if (!ytReady) {
            if (ytBackend.platform === "android") {
                ytEls.setupText.textContent = st.error ? "The downloader failed to initialise: " + st.error : "Preparing the downloader… (the first run unpacks Python, this takes a few seconds)";
                ytEls.setupBtn.style.display = "none";
                if (!st.error && isShown(ytEls.overlay)) ytStatusPoll = setTimeout(refreshYtStatus, 1500);
            } else {
                const parts = [];
                if (!st.ytdlp) parts.push("yt-dlp");
                if (!st.runtime) parts.push("a JavaScript runtime (Deno) that YouTube now requires");
                ytEls.setupText.textContent = `The downloader needs ${parts.join(" and ")}. It's fetched once (~${st.runtime ? "20" : "60"} MB) into the app's data folder.`;
                ytEls.setupBtn.style.display = "";
            }
        }
    } catch (e) { ytSetStatus(errorText(e), "error"); }
    ytSetBusy(ytBusy); syncImportUi();
}
async function ytSetup() {
    ytSetBusy(true); ytSetStatus("Downloading yt-dlp…");
    const stop = ytBackend.onProgress((p) => { if (p && p.stage && p.stage !== "download") ytSetStatus(`Downloading ${p.stage}… ${Math.round(p.percent || 0)}%`); });
    try { await ytBackend.setup(); ytSetStatus("Downloader ready.", "success"); }
    catch (e) { ytSetStatus("Setup failed: " + errorText(e), "error"); }
    finally { stop(); ytSetBusy(false); refreshYtStatus(); }
}
async function ytUpdate() {
    if (ytBusy) return;
    if (importer.running) { ytSetStatus("Wait for the imports to finish (or stop them) before updating.", "error"); return; }
    ytSetBusy(true); ytSetStatus("Updating yt-dlp… (this can take a minute)");
    try { const r = await ytBackend.update(); ytSetStatus(r && r.message ? r.message : "Updated.", "success"); }
    catch (e) { ytSetStatus("Update failed: " + errorText(e), "error"); }
    finally { ytSetBusy(false); refreshYtStatus(); }
}
function ytNotReadyMessage() { return ytBackend.platform === "android" ? "The downloader is still getting ready — try again in a moment." : "Set up the downloader first (the button above)."; }

// ── Titles ──
function normalizeArtist(name) { return (name || "").replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim(); }
// "Tidy titles": drop what's about the video rather than the song, like (Official Video),
// [Lyrics], 【MV】 or "| Official Audio", but keep versions (Remix, Live, Acoustic, feat. …).
const TITLE_JUNK = /\b(official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|8k|mv|m\/v|explicit|clean|oficial|officiel|letra|clip|full song|full audio|color coded)\b/i;
const TITLE_KEEP = /\b(remix|live|acoustic|version|edit|mix|cover|remaster(ed)?|feat\.?|ft\.?|featuring|with|prod\.?|instrumental|slowed|reverb|sped|nightcore|demo|session)\b/i;
function tidyTitle(t) {
    let s = String(t || "");
    s = s.replace(/\s*[\(\[【]([^\)\]】]*)[\)\]】]/g, (m, inner) => (TITLE_JUNK.test(inner) && !TITLE_KEEP.test(inner) ? "" : m));
    s = s.replace(/\s+(?:\||\/\/|-|–|—)\s*(?:official|lyrics?|audio|visuali[sz]er|hd|4k|music video)\b.*$/i, "");
    s = s.replace(/\s+(?:HD|HQ|4K)$/i, "");
    return s.replace(/\s{2,}/g, " ").trim();
}
// "A - B" is usually "Artist - Song", but edits (sped up, slowed, nightcore…) are often
// "song - artist". The artist is the side that matches the channel or an artist already in
// your library; when neither says, the other results decide (swapHint, see markSwaps), and
// failing that it's "Artist - Song". Brackets after a right-hand artist belong to the song
// ("after dark - Mr.Kitty (sped up)"), and a "Nightcore - " style prefix becomes a tag.
const NOT_AN_ARTIST = /^(nightcore|daycore|sped ?up|speed ?up|slowed(?: ?(?:\+|and|&|n) ?reverb)?|reverb|8d(?: audio)?|bass ?boost(?:ed)?|lyrics?|tik ?tok|phonk|lo-?fi|karaoke|instrumental)$/i;
const SIDE_TAIL = /(?:\s*[\(\[【][^\)\]】]*[\)\]】])+$/;
const BRACKET_FEAT = /[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]/i;
function sideKey(s) { return normalizeText(s).replace(/[^a-z0-9]+/g, ""); }
function splitDash(t) {
    const m = String(t || "").match(/^(.{1,60}?)\s+[-–—]\s+(.+)$/); if (!m) return null;
    const left = m[1].trim(), right = m[2].trim(), tail = (right.match(SIDE_TAIL) || [""])[0];
    return { left, right, tail, rightName: right.slice(0, right.length - tail.length).trim() };
}
let knownArtistSet = null, knownArtistVersion = -1;
function knownArtists() {
    if (knownArtistSet && knownArtistVersion === libraryVersion) return knownArtistSet;
    const set = new Set();
    for (const pl of Object.values(playlists)) for (const s of pl.songs || []) {
        const a = String(s.artist || ""); if (!a || /^unknown artist$/i.test(a)) continue;
        set.add(sideKey(a));
        for (const part of a.split(/\s*(?:,|&|\bx\b|\/|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)) { const k = sideKey(part); if (k.length >= 3) set.add(k); }
    }
    knownArtistSet = set; knownArtistVersion = libraryVersion;
    return set;
}
function looksLikeArtist(side, channel) {
    const k = sideKey(side); if (k.length < 2) return false;
    if (/\b(?:feat\.?|ft\.?|featuring)\s/i.test(String(side).replace(/[\(\[【][^\)\]】]*[\)\]】]/g, ""))) return true; // "Calvin Harris ft. Rihanna"
    const c = sideKey(normalizeArtist(channel || "").replace(/\b(official|music|tv|channel|records?)\b/gi, ""));
    if (c.length >= 3 && (k === c || (k.length >= 4 && c.length >= 4 && (c.startsWith(k) || k.startsWith(c))))) return true;
    const known = knownArtists();
    if (known.has(k)) return true;
    const first = sideKey(String(side).split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0]);
    return first.length >= 3 && first !== k && known.has(first);
}
// Within one set of results (a search, a playlist) the same two names usually come in the
// same order: a title that has them the other way round from the rest gets flagged.
function markSwaps(entries) {
    const first = new Map(), second = new Map();
    const sides = entries.map((e) => {
        const d = splitDash(tidyTitle(String(e.title || ""))); if (!d) return null;
        const L = sideKey(d.left), R = sideKey(d.rightName || d.right);
        first.set(L, (first.get(L) || 0) + 1); second.set(R, (second.get(R) || 0) + 1);
        return [L, R];
    });
    entries.forEach((e, i) => {
        const s = sides[i]; if (!s) { e.__swap = false; return; }
        const [L, R] = s;
        e.__swap = (first.get(R) || 0) + (second.get(L) || 0) > (first.get(L) || 0) - 1 + (second.get(R) || 0) - 1;
    });
}
// Title and artist for a video. exact: the site said what the track and artist are.
// order: "as-is" (artist on the left), "swapped", or "" (no "A - B" to read). sure: the
// channel or your library said which side the artist is, rather than a guess.
function songMetaFrom(raw, channel, tidy, exact, swapHint) {
    const topic = /\s-\s*Topic$/i.test(channel || "");
    let title = String(raw || "Untitled").trim(), artist = normalizeArtist(channel || ""), order = "", sure = false;
    if (exact || !tidy) return { title, artist: artist || "Unknown Artist", order, sure };
    title = tidyTitle(title);
    const d = !topic && splitDash(title);
    if (d) {
        if (NOT_AN_ARTIST.test(d.left)) {
            const by = d.right.match(/^(.+?)\s+(?:\||by|\/\/)\s+(.+)$/i);
            title = `${(by ? by[1] : d.right).trim()} (${d.left})`;
            if (by) artist = by[2].trim();
        } else {
            // A bracketed "(feat. …)" belongs to a song title, so the other side is the artist.
            const fl = BRACKET_FEAT.test(d.left), fr = BRACKET_FEAT.test(d.right);
            const l = looksLikeArtist(d.left, channel) || (fr && !fl), r = d.rightName && (looksLikeArtist(d.rightName, channel) || (fl && !fr));
            sure = l !== !!r;
            const swap = d.rightName && (r && !l ? true : l && !r ? false : !!swapHint);
            if (swap) { artist = d.rightName; title = d.left + d.tail; order = "swapped"; }
            else { artist = d.left; title = d.right; order = "as-is"; }
        }
    }
    title = tidyTitle(title);
    return { title: title || String(raw || "Untitled"), artist: artist || "Unknown Artist", order, sure };
}
// A channel you've swapped a song from: its "A - B" titles are read that way from then on.
function channelOrder(channel) { const k = sideKey(channel); return k && importList.channelOrder ? importList.channelOrder[k] : undefined; }
function hintFor(item) { const c = channelOrder(item.channel); return c ? c === "swapped" : item.swapHint; }
function ytEntryThumb(e) { return /^[\w-]{11}$/.test(e.id || "") ? `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg` : (e.thumbnail || DEFAULT_ART); }
function ytEntryUrl(e) { return e.webpage_url || (typeof e.url === "string" && /^https?:/i.test(e.url) ? e.url : `https://www.youtube.com/watch?v=${e.id}`); }
function formatViews(n) {
    n = Number(n) || 0;
    const f = (v, u) => `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}${u} views`;
    return n >= 1e9 ? f(n / 1e9, "B") : n >= 1e6 ? f(n / 1e6, "M") : n >= 1e3 ? f(n / 1e3, "K") : `${n} ${n === 1 ? "view" : "views"}`;
}

// ── In your library ── a song imported from YouTube remembers the video it came from;
// older ones (and files you added yourself) are matched by title and artist or length.
let libIndex = null, libIndexVersion = -1;
// Brackets that are only about the video go; versions (a remix, a live take, a radio
// edit) stay, so they don't count as the song you already have.
const TITLE_VERSION = /\b(remix|live|acoustic|edit|mix|instrumental|slowed|reverb|sped|nightcore|cover|demo|session|unplugged|extended|karaoke)\b/;
function normSongTitle(s) { return normalizeText(s).replace(/[\(\[【]([^\)\]】]*)[\)\]】]/g, (m, inner) => (TITLE_VERSION.test(inner) ? ` ${inner} ` : " ")).replace(/\b(feat|ft|featuring)\b.*$/, " ").replace(/[^a-z0-9]+/g, " ").trim(); }
function normArtistName(s) { return normalizeText(s).replace(/\s*-\s*topic$/, "").replace(/vevo$/, "").replace(/[^a-z0-9]+/g, " ").trim(); }
function libraryIndex() {
    if (libIndex && libIndexVersion === libraryVersion) return libIndex;
    const ids = new Set(), titles = new Map();
    for (const pl of Object.values(playlists)) for (const s of pl.songs || []) {
        if (typeof s.src === "string" && s.src.startsWith("yt:")) ids.add(s.src.slice(3));
        const t = normSongTitle(s.title); if (!t) continue;
        if (!titles.has(t)) titles.set(t, []);
        titles.get(t).push({ a: normArtistName(s.artist), d: s.duration || 0 });
    }
    libIndex = { ids, titles }; libIndexVersion = libraryVersion;
    return libIndex;
}
function inLibrary(id, raw, channel, duration) {
    const ix = libraryIndex();
    if (id && ix.ids.has(String(id))) return true;
    // Either order of "A - B" (and the whole title with the channel as the artist).
    const t = tidyTitle(String(raw || "")), d = splitDash(t);
    const pairs = d ? [[d.right, d.left], [d.left + d.tail, d.rightName]] : [[t, normalizeArtist(channel || "")]];
    return pairs.some(([title, artist]) => {
        const list = ix.titles.get(normSongTitle(title)); if (!list) return false;
        const a = normArtistName(artist);
        return list.some((x) => (a && x.a && (x.a === a || x.a.includes(a) || a.includes(x.a))) || (duration > 0 && x.d > 0 && Math.abs(x.d - duration) <= 3));
    });
}

// ── The import list ──
const IMPORT_KEY = "spootify-import-list";
function loadImportList() {
    try {
        const s = JSON.parse(localStorage.getItem(IMPORT_KEY) || "null");
        if (s && Array.isArray(s.items)) {
            const items = s.items.filter((i) => i && i.id && i.url).slice(-500);
            for (const i of items) if (i.status === "downloading") i.status = "queued";
            return { items, dest: s.dest || "", destName: s.destName || "", tidy: s.tidy !== false, square: s.square !== false, open: s.open !== false, channelOrder: s.channelOrder && typeof s.channelOrder === "object" ? s.channelOrder : {} };
        }
    } catch {}
    return { items: [], dest: "", destName: "", tidy: true, square: true, open: true, channelOrder: {} };
}
let importList = loadImportList(), importSaveTimer = null;
function saveImportList(soon) {
    const write = () => { importSaveTimer = null; try { localStorage.setItem(IMPORT_KEY, JSON.stringify(importList, (k, v) => (k === "pct" ? undefined : v))); } catch {} };
    if (soon) { if (!importSaveTimer) importSaveTimer = setTimeout(write, 400); return; }
    clearTimeout(importSaveTimer); write();
}
const importer = { running: false, stop: false, item: null, pct: 0, dest: null, added: 0, failed: 0 };
let importEditing = null; // key of the item whose title / artist is being edited
function importWaiting() { return importList.items.filter((i) => i.status === "queued"); }
function itemForEntry(e) {
    const exact = !!(e.track && e.artist);
    const item = { key: "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), id: String(e.id), url: ytEntryUrl(e),
        raw: (exact ? e.track : e.title) || "Untitled", channel: (exact ? e.artist : e.channel || e.uploader || e.playlist_uploader) || "", exact,
        swapHint: !!e.__swap, duration: Number(e.duration) || 0, thumb: ytEntryThumb(e), status: "queued", edited: false };
    retidy(item);
    return item;
}
// Title and artist the other way round. Read from the video's title again where it can be,
// so a "(sped up)" after a name moves with the song, not the artist.
function swapItemOrder(item) {
    const d = !item.typed && !item.exact && importList.tidy ? splitDash(tidyTitle(item.raw)) : null;
    if (d && d.rightName && item.order === "as-is") { item.artist = d.rightName; item.title = tidyTitle(d.left + d.tail); item.order = "swapped"; }
    else if (d && item.order === "swapped") { item.artist = d.left; item.title = tidyTitle(d.right); item.order = "as-is"; }
    else { [item.title, item.artist] = [item.artist, item.title]; item.order = item.order === "as-is" ? "swapped" : item.order === "swapped" ? "as-is" : ""; }
}
function retidy(item) { if (item.edited) return; const m = songMetaFrom(item.raw, item.channel, importList.tidy, item.exact, hintFor(item)); item.title = m.title; item.artist = m.artist; item.order = m.order; item.sure = m.sure; }
// Adds videos to the list (skipping ones already waiting there). Returns how many were added.
function addToImportList(entries) {
    let added = 0;
    for (const e of entries) {
        if (!e || !e.id) continue;
        if (importList.items.some((i) => i.id === String(e.id) && i.status !== "done")) continue;
        importList.items.push(itemForEntry(e)); added++;
    }
    if (added) { importList.open = true; saveImportList(); renderImportList(); syncImportUi(); }
    return added;
}
function removeImportItem(key) {
    const i = importList.items.findIndex((x) => x.key === key); if (i === -1) return;
    const [item] = importList.items.splice(i, 1);
    if (importEditing === key) importEditing = null;
    saveImportList(); renderImportList(); syncImportUi(); updateYtResultRow(item.id);
}
function fillImportDest() {
    if (!ytEls.dest) return;
    const names = getOrderedPlaylistNames();
    let want = importList.dest;
    if (want !== "__new__" && !playlists[want]) want = currentPlaylist && playlists[currentPlaylist] ? currentPlaylist : names[0] || "__new__";
    setHtmlIfChanged(ytEls.dest, `<option value="__new__">+ New playlist</option>` + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join(""));
    ytEls.dest.value = want; importList.dest = want;
    if (ytEls.destName && document.activeElement !== ytEls.destName) ytEls.destName.value = importList.destName || "";
    syncImportDestName();
}
function syncImportDestName() { if (ytEls.destName) ytEls.destName.hidden = !ytEls.dest || ytEls.dest.value !== "__new__" || importer.running; }

const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
const ICON_SWAP = '<svg viewBox="0 0 24 24"><path d="M4 8h14m0 0-3.5-3.5M18 8l-3.5 3.5M20 16H6m0 0 3.5-3.5M6 16l3.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
function importItemHtml(item) {
    const st = item.status, dur = item.duration ? " · " + formatTime(item.duration) : "";
    const have = st !== "done" && inLibrary(item.id, item.raw, item.channel, item.duration);
    const state = st === "downloading" ? `Downloading… <b class="yt-pct">${Math.round(importer.pct)}%</b>`
        : st === "done" ? "Added" : st === "failed" ? `Failed: ${escapeHtml(item.error || "unknown error")}` : have ? "Already in your library" : "Waiting";
    const editing = importEditing === item.key && st !== "downloading" && st !== "done";
    const acts = st === "downloading" ? "" : (st === "failed" ? '<button type="button" class="yt-item-btn retry" data-act="retry">Retry</button>' : "")
        + (st !== "done" ? `<button type="button" class="yt-item-btn icon" data-act="swap" aria-label="Swap the title and the artist" title="Swap title and artist">${ICON_SWAP}</button><button type="button" class="yt-item-btn icon" data-act="edit" aria-label="Edit title and artist" title="Edit">${ICONS.pencil}</button>` : "")
        + `<button type="button" class="yt-item-btn icon" data-act="remove" aria-label="Remove from the list" title="Remove">${ICONS.close}</button>`;
    return `<div class="yt-item ${st}${have ? " have" : ""}" data-key="${escapeHtml(item.key)}" style="--p:${st === "downloading" ? importer.pct : 0}%">
        <button type="button" class="yt-item-thumb" data-act="cover" aria-label="Choose the cover" title="Choose the cover"${st === "queued" || st === "failed" ? "" : " disabled"}>${item.crop
            ? `<span class="yt-item-cover" style="${escapeHtml(coverPreviewStyle(item.crop))}"></span>`
            : `<img src="${escapeHtml(item.thumb || DEFAULT_ART)}" alt="" loading="lazy">`}</button>
        <div class="yt-item-info">${editing
            ? `<input type="text" class="yt-edit" data-f="title" value="${escapeHtml(item.title)}" aria-label="Title" maxlength="200"><input type="text" class="yt-edit" data-f="artist" value="${escapeHtml(item.artist)}" aria-label="Artist" maxlength="120">`
            : `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.artist)}${dur}</span>`}
            <em class="yt-item-state">${st === "done" ? ICON_CHECK : ""}${state}</em>
        </div>
        <div class="yt-item-acts">${editing ? '<button type="button" class="yt-item-btn retry" data-act="done">Done</button>' : acts}</div>
    </div>`;
}
function renderImportList() {
    if (!ytEls.queue || !isShown(ytEls.overlay)) return;
    const items = importList.items;
    ytEls.queue.hidden = !items.length;
    if (!items.length) return;
    const waiting = items.filter((i) => i.status !== "done").length, done = items.length - waiting;
    setText(ytEls.queueCount, waiting ? String(waiting) : "");
    ytEls.queue.classList.toggle("collapsed", !importList.open);
    ytEls.queueToggle.setAttribute("aria-expanded", importList.open ? "true" : "false");
    if (ytEls.tidy) ytEls.tidy.checked = !!importList.tidy;
    if (ytEls.square) ytEls.square.checked = importList.square !== false;
    setText(ytEls.queueClear, done && done < items.length ? "Clear added" : "Clear");
    ytEls.queueClear.hidden = importer.running && !done;
    if (importList.open) {
        const focused = document.activeElement && document.activeElement.classList.contains("yt-edit") ? document.activeElement.dataset.f : null;
        ytEls.queueList.innerHTML = items.map(importItemHtml).join("");
        if (focused) { const el = ytEls.queueList.querySelector(`.yt-edit[data-f="${focused}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
    }
}
// Just the moving parts while a song downloads: its percentage and bar, and the pill.
function syncImportProgress() {
    const item = importer.item;
    if (item && isShown(ytEls.overlay) && ytEls.queueList) {
        const row = ytEls.queueList.querySelector(`.yt-item[data-key="${CSS.escape(item.key)}"]`);
        if (row) { row.style.setProperty("--p", importer.pct + "%"); const p = row.querySelector(".yt-pct"); if (p) p.textContent = Math.round(importer.pct) + "%"; }
    }
    syncImportPill();
}
function syncImportPill() {
    const pill = ytEls.pill; if (!pill) return;
    const show = importer.running && !isShown(ytEls.overlay);
    pill.hidden = !show;
    if (!show) return;
    const left = importWaiting().length, finished = importer.added + importer.failed, total = finished + left + (importer.item ? 1 : 0);
    setText(ytEls.pillTitle, `Importing ${Math.min(total, finished + 1)} of ${total}`);
    setText(ytEls.pillSub, importer.item ? `${importer.item.title} · ${Math.round(importer.pct)}%` : "Starting…");
    if (ytEls.pillArc) { const c = 2 * Math.PI * 15; ytEls.pillArc.style.strokeDasharray = `${c}`; ytEls.pillArc.style.strokeDashoffset = `${c * (1 - ((finished + importer.pct / 100) / Math.max(1, total)))}`; }
}
function syncImportUi() {
    syncImportPill();
    if (!ytEls.importBtn) return;
    const waiting = importWaiting().length;
    ytEls.importBtn.textContent = importer.running ? (importer.stop ? "Stopping…" : "Stop") : waiting ? `Import ${waiting} ${waiting === 1 ? "song" : "songs"}` : "Import";
    ytEls.importBtn.classList.toggle("stop", importer.running);
    ytEls.importBtn.disabled = importer.running ? importer.stop : (!waiting || !ytReady);
    if (ytEls.dest) ytEls.dest.disabled = importer.running;
    syncImportDestName();
}

async function startImport() {
    if (importer.running) return;
    if (!ytReady) { ytSetStatus(ytNotReadyMessage(), "error"); return; }
    if (!importWaiting().length) return;
    let dest = ytEls.dest ? ytEls.dest.value : importList.dest;
    if (dest === "__new__") {
        const name = uniquePlaylistName((ytEls.destName && ytEls.destName.value.trim()) || importList.destName || "Imported");
        await createPlaylist(name);
        dest = name; importList.destName = "";
    }
    if (!playlists[dest]) { ytSetStatus("Choose a playlist to add them to.", "error"); return; }
    Object.assign(importer, { running: true, stop: false, item: null, pct: 0, dest, added: 0, failed: 0 });
    importList.dest = dest; saveImportList(); fillImportDest();
    ytSetStatus("");
    const off = ytBackend.onProgress((p) => { if (p && p.stage === "download" && importer.item) { importer.pct = clamp(Number(p.percent) || 0, 0, 100); syncImportProgress(); } });
    let lostDest = false;
    syncImportUi();
    try {
        let item;
        while (!importer.stop && (item = importList.items.find((i) => i.status === "queued"))) {
            if (!playlists[dest]) { lostDest = true; break; }
            if (importEditing === item.key) importEditing = null;
            item.status = "downloading"; item.error = ""; importer.item = item; importer.pct = 0;
            noteActivity(`importing "${item.title || item.url}" from YouTube`);
            renderImportList(); syncImportUi();
            try {
                const { audio, image } = await ytBackend.download(item.url, item.id);
                if (!playlists[dest]) throw new Error(`The playlist "${dest}" was deleted`);
                const song = await ytStoreDownload(audio, image, item.title || "Untitled", item.artist || "Unknown Artist", item.duration, /youtu/i.test(item.url) ? item.id : null, importList.square !== false, item.crop || null);
                playlists[dest].songs.push(song);
                item.status = "done"; item.songId = song.id; importer.added++;
                await saveLibrary(); renderPlaylists(); if (currentPlaylist === dest) renderSongs();
                updateYtResultRow(item.id);
            } catch (e) {
                if (importer.stop) { item.status = "queued"; break; }
                item.status = "failed"; item.error = errorText(e); importer.failed++;
                console.warn("Import failed", item.url, e);
            }
            importer.item = null; saveImportList(); renderImportList(); syncImportUi();
        }
    } finally {
        off();
        setTimeout(() => noteActivity(null), 15000);
        const { added, failed } = importer, stopped = importer.stop;
        Object.assign(importer, { running: false, stop: false, item: null, pct: 0 });
        saveImportList(); renderImportList(); syncImportUi(); renderQueue();
        const msg = `${added ? `Added ${added} ${added === 1 ? "song" : "songs"} to ${dest}` : "Nothing added"}${failed ? ` · ${failed} failed` : ""}${stopped ? " · stopped" : ""}${lostDest ? ` · "${dest}" was deleted, so the rest are waiting: pick another playlist and press Import` : ""}`;
        if (isShown(ytEls.overlay)) ytSetStatus(msg + (failed ? " (tap Retry to try those again)" : "."), (failed || lostDest) && !added ? "error" : added ? "success" : "");
        else if (added || failed) showToast(msg, failed ? { action: "Show", onAction: () => openYtModal() } : { action: "Open", onAction: () => loadPlaylistPage(dest) });
    }
}
function stopImport() {
    if (!importer.running || importer.stop) return;
    importer.stop = true; syncImportUi();
    Promise.resolve(ytBackend.cancel(importer.item && importer.item.id)).catch(() => {});
}

// "Square covers": a video thumbnail is wide, and some have bars built in (older videos
// only have a 4:3 one with black bars above and below; art tracks put the album cover
// between two flat side bars). Flat bars along the edges are found on a small copy and
// dropped, then the middle square is kept, at up to 640 px. Already square and bar-free:
// left as it is.
async function squareCover(blob) {
    if (typeof createImageBitmap !== "function") return blob;
    let bmp = null;
    try {
        bmp = await createImageBitmap(blob);
        const W = bmp.width, H = bmp.height;
        if (!W || !H) return blob;
        const sw = 160, sh = Math.max(8, Math.round(H * sw / W));
        const probe = document.createElement("canvas"); probe.width = sw; probe.height = sh;
        const g = probe.getContext("2d", { willReadFrequently: true });
        g.drawImage(bmp, 0, 0, sw, sh);
        const d = g.getImageData(0, 0, sw, sh).data;
        const at = (x, y) => (y * sw + x) * 4;
        const near = (i, r, gg, b) => Math.abs(d[i] - r) + Math.abs(d[i + 1] - gg) + Math.abs(d[i + 2] - b) <= 42;
        // How many rows (or columns) in from an edge are one flat colour, the edge's own.
        const flatLines = (count, len, pos) => {
            const c0 = pos(0, 0), r = d[c0], gg = d[c0 + 1], b = d[c0 + 2];
            let n = 0;
            for (; n < count * 0.3; n++) { for (let k = 0; k < len; k += 2) if (!near(pos(n, k), r, gg, b)) return n; }
            return n;
        };
        const top = flatLines(sh, sw, (n, k) => at(k, n)), bottom = flatLines(sh, sw, (n, k) => at(k, sh - 1 - n));
        const left = flatLines(sw, sh, (n, k) => at(n, k)), right = flatLines(sw, sh, (n, k) => at(sw - 1 - n, k));
        const fx = W / sw, fy = H / sh;
        const cx0 = left * fx, cy0 = top * fy, cw = W - (left + right) * fx, ch = H - (top + bottom) * fy;
        if (cw < W * 0.3 || ch < H * 0.3) return blob; // mostly one colour: leave it alone
        const side = Math.min(cw, ch);
        if (Math.abs(W - H) <= 2 && !top && !bottom && !left && !right) return blob;
        const sx = cx0 + (cw - side) / 2, sy = cy0 + (ch - side) / 2, out = Math.max(64, Math.min(640, Math.round(side)));
        const c = document.createElement("canvas"); c.width = c.height = out;
        const cg = c.getContext("2d"); cg.imageSmoothingQuality = "high";
        cg.drawImage(bmp, sx, sy, side, side, 0, 0, out, out);
        const result = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
        return result || blob;
    } catch (e) { console.warn("Couldn't square the cover", e); return blob; }
    finally { if (bmp && typeof bmp.close === "function") bmp.close(); }
}

// Saves a finished download (audio + thumbnail bytes) as a library song. sourceId: the
// YouTube video it came from (for "already in your library"). square: crop the cover.
async function ytStoreDownload(audio, image, title, artist, fallbackDuration, sourceId, square, crop) {
    const mediaId = await storeBlob(new Blob([audio.data], { type: mimeFor(audio.ext) }));
    const fileSrc = await getBlobUrl(mediaId);
    let artId = null, artUrl = DEFAULT_ART, thumbId = null;
    const original = image && image.data && image.data.length ? new Blob([image.data], { type: mimeFor(image.ext) }) : null;
    let cover = original;
    if (crop) { try { cover = (await cropToBlob(crop.src, crop)) || original; } catch (e) { console.warn("Chosen cover failed, using the thumbnail", e); cover = original && square ? await squareCover(original) : original; } }
    else if (original && square) cover = await squareCover(original);
    if (cover) {
        const stored = await shrinkCover(cover);
        artId = await storeBlob(stored); artUrl = (await getBlobUrl(artId)) || DEFAULT_ART;
        if (original && stored !== original) thumbId = await storeBlob(original); // the whole thumbnail, to choose the cover again later
    }
    const duration = await probeDuration(fileSrc, Number(fallbackDuration) || 0);
    return { id: newSongId(), title, artist, timestamp: Date.now(), duration, mediaId, artId, thumbId: thumbId || undefined, fileSrc, art: artUrl, src: sourceId ? "yt:" + sourceId : undefined };
}

// ── Search ──
const YT_PAGE = 15;
let ytSearch = { q: "", n: 0, entries: [], loading: false, error: "", end: false, token: 0 };
async function ytRunSearch(query, more = false) {
    const q = String(query || "").trim();
    if (!q) return;
    if (!ytReady) { ytSetStatus(ytNotReadyMessage(), "error"); return; }
    if (!ytBackend.playlist) { ytSetStatus("Searching needs a newer version of the app.", "error"); return; }
    if (!more && q === ytSearch.q && ytSearch.loading) return;
    const n = more ? ytSearch.n + YT_PAGE : YT_PAGE, token = ++ytSearch.token;
    if (!more) { ytSearch.entries = []; ytSearch.end = false; }
    Object.assign(ytSearch, { q, loading: true, error: "" });
    ytSetStatus("");
    renderYtResults();
    try {
        const res = await ytBackend.playlist(`ytsearch${n}:${q}`);
        if (token !== ytSearch.token) return;
        const list = res && Array.isArray(res.entries) ? res.entries : [], seen = new Set(ytSearch.entries.map((e) => e.id));
        ytSearch.entries = ytSearch.entries.concat(list.filter((e) => e && e.id && !seen.has(e.id) && e.live_status !== "is_live" && e.live_status !== "is_upcoming"));
        markSwaps(ytSearch.entries);
        ytSearch.n = n; ytSearch.end = list.length < n;
    } catch (e) {
        if (token !== ytSearch.token) return;
        ytSearch.error = /no videos found/i.test(errorText(e)) ? "" : errorText(e);
        ytSearch.end = true;
    } finally {
        if (token === ytSearch.token) { ytSearch.loading = false; renderYtResults(); }
    }
}
function ytResultHtml(e) {
    const ch = e.channel || e.uploader, co = channelOrder(ch), m = songMetaFrom(e.title, ch, importList.tidy, false, co ? co === "swapped" : e.__swap);
    const queued = importList.items.some((i) => i.id === String(e.id) && i.status !== "done");
    const added = !queued && importList.items.some((i) => i.id === String(e.id) && i.status === "done");
    const have = !queued && (added || inLibrary(e.id, e.title, e.channel || e.uploader, e.duration));
    const views = e.view_count ? " · " + formatViews(e.view_count) : "";
    return `<div class="yt-result${queued ? " queued" : ""}" data-id="${escapeHtml(e.id)}">
        <div class="yt-thumb"><img src="${escapeHtml(ytEntryThumb(e))}" alt="" loading="lazy">${e.duration ? `<span class="yt-dur">${formatTime(e.duration)}</span>` : ""}</div>
        <div class="yt-result-info"><strong title="${escapeHtml(e.title || "")}">${escapeHtml(m.title)}</strong><span>${escapeHtml(m.artist)}${views}</span>${have ? `<em class="yt-have">${ICON_CHECK}In your library</em>` : ""}</div>
        <button type="button" class="yt-add${queued ? " on" : ""}" data-act="toggle" aria-label="${queued ? "Take off the import list" : "Add to the import list"}">${queued ? ICON_CHECK : ICONS.plus}</button>
    </div>`;
}
function renderYtResults() {
    const el = ytEls.results; if (!el || !isShown(ytEls.overlay)) return;
    const s = ytSearch;
    if (!s.q) { el.innerHTML = '<div class="yt-empty"><strong>Search YouTube</strong><span>Find a song, an artist or an album, tap + on what you want, then Import. You can keep searching while the list downloads.</span></div>'; return; }
    let html = s.entries.map(ytResultHtml).join("");
    if (s.loading) html += Array.from({ length: s.entries.length ? 2 : 5 }, () => '<div class="yt-result skeleton"><div class="yt-thumb"></div><div class="yt-result-info"><i></i><i></i></div></div>').join("");
    else if (s.error) html += `<div class="yt-empty error"><span>${escapeHtml(s.error)}</span><button type="button" class="utility-btn" data-act="retry">Try again</button></div>`;
    else if (!s.entries.length) html = `<div class="yt-empty"><span>Nothing found for "${escapeHtml(s.q)}".</span></div>`;
    else if (!s.end) html += '<button type="button" class="utility-btn yt-more" data-act="more">More results</button>';
    el.innerHTML = html;
}
function updateYtResultRow(id) {
    const row = ytEls.results && ytEls.results.querySelector(`.yt-result[data-id="${CSS.escape(String(id))}"]`), e = ytSearch.entries.find((x) => x.id === id);
    if (!row || !e) return;
    const tmp = document.createElement("div"); tmp.innerHTML = ytResultHtml(e);
    row.replaceWith(tmp.firstElementChild);
}
function toggleSearchResult(id) {
    const e = ytSearch.entries.find((x) => x.id === id); if (!e) return;
    const waiting = importList.items.find((i) => i.id === String(id) && (i.status === "queued" || i.status === "failed"));
    if (waiting) removeImportItem(waiting.key);
    else if (!importList.items.some((i) => i.id === String(id) && i.status === "downloading")) { addToImportList([e]); haptic(8); }
    updateYtResultRow(id);
}

// ── Links ──
// "single": a plain video link. "playlist": a playlist page. "both": a video opened
// from a playlist (?v=…&list=…), and you choose which you meant.
function ytLinkKind(raw) {
    try {
        const u = new URL(raw);
        if (!u.searchParams.get("list")) return "single";
        return u.searchParams.has("v") || /(^|\.)youtu\.be$/i.test(u.hostname) ? "both" : "playlist";
    } catch { return "single"; }
}
function syncYtModeButtons() { if (ytEls.mode) ytEls.mode.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === ytMode)); }
async function ytFetch() {
    const url = ytEls.url.value.trim();
    if (!url || ytBusy) return;
    if (!ytReady) { ytSetStatus(ytNotReadyMessage(), "error"); return; }
    const kind = ytLinkKind(url), canList = !!ytBackend.playlist;
    if (ytEls.modeRow) ytEls.modeRow.style.display = kind === "both" && canList ? "flex" : "none";
    if (kind === "playlist" && canList) ytMode = "playlist";
    else if (kind === "single" || !canList) ytMode = "single";
    syncYtModeButtons();
    if (ytMode === "playlist") { await ytFetchPlaylist(url); return; }
    ytPlaylist = null; ytSetBusy(true); ytSetStatus("Looking it up…");
    if (ytEls.plPreview) ytEls.plPreview.style.display = "none";
    try {
        const info = await ytBackend.info(url);
        if (!info || !info.id) throw new Error("No media found at that link.");
        const entry = { ...info, webpage_url: info.webpage_url || url };
        if (addToImportList([entry])) {
            const item = importList.items[importList.items.length - 1];
            ytSetStatus(`Added "${item.title}" to the import list${info.duration ? ` (${formatTime(info.duration)})` : ""}.`, "success");
            ytEls.url.value = ""; if (ytEls.modeRow) ytEls.modeRow.style.display = "none";
            settleOrderFromSearch(item);
        } else ytSetStatus("That one is already on the import list.");
    } catch (e) { ytSetStatus(errorText(e), "error"); }
    finally { ytSetBusy(false); syncImportUi(); }
}
// One link on its own has nothing to compare its "A - B" with, so search for the song
// (both names) and let the other uploads say which name is the artist.
async function settleOrderFromSearch(item) {
    if (!item || item.exact || item.edited || item.sure || !item.order || !ytBackend.playlist || channelOrder(item.channel)) return;
    const d = splitDash(tidyTitle(item.raw)); if (!d) return;
    try {
        const res = await ytBackend.playlist(`ytsearch10:${d.left} ${d.rightName || d.right}`);
        const entries = (res && Array.isArray(res.entries) ? res.entries : []).filter((e) => e && e.id && e.id !== item.id);
        if (entries.length < 3 || item.edited || item.status !== "queued") return;
        const self = { id: item.id, title: item.raw };
        markSwaps(entries.concat(self));
        if (self.__swap === item.swapHint) return;
        item.swapHint = self.__swap; retidy(item);
        saveImportList(); renderImportList();
    } catch {}
}
async function ytFetchPlaylist(url) {
    ytPlaylist = null; ytSetBusy(true); ytSetStatus("Reading the playlist…");
    ytEls.plPreview.style.display = "none";
    try {
        const res = await ytBackend.playlist(url);
        const entries = (res && Array.isArray(res.entries) ? res.entries : []).filter((e) => e && e.id && !/^\[(private|deleted)( video)?\]$/i.test(String(e.title || "").trim()));
        if (!entries.length) throw new Error("That playlist looks empty (or it's private).");
        const title = (res.title && res.title !== "null" ? res.title : "") || entries[0].playlist_title || "Imported playlist";
        markSwaps(entries);
        ytPlaylist = { title, entries, selected: new Set(entries.map((_, i) => i)) };
        renderYtPlaylist();
        ytSetStatus(`Found ${entries.length} ${entries.length === 1 ? "video" : "videos"}. Untick any you don't want.`);
    } catch (e) { ytSetStatus(errorText(e), "error"); }
    finally { ytSetBusy(false); }
}
function renderYtPlaylist() {
    const pl = ytPlaylist; if (!pl) return;
    ytEls.plTitle.textContent = pl.title;
    ytEls.plList.innerHTML = pl.entries.map((e, i) => {
        const ch = e.channel || e.uploader || e.playlist_uploader, co = channelOrder(ch), m = songMetaFrom(e.title, ch, importList.tidy, false, co ? co === "swapped" : e.__swap);
        const have = inLibrary(e.id, e.title, e.channel || e.uploader, e.duration);
        return `<label class="yt-pl-item" data-i="${i}"><input type="checkbox"${pl.selected.has(i) ? " checked" : ""}><img src="${escapeHtml(ytEntryThumb(e))}" alt="" loading="lazy"><div class="yt-pl-info"><strong>${escapeHtml(m.title)}</strong><span>${escapeHtml(m.artist)}${e.duration ? " · " + formatTime(e.duration) : ""}</span></div><span class="yt-pl-state">${have ? "In library" : ""}</span></label>`;
    }).join("");
    ytEls.plPreview.style.display = "block";
    updateYtPlaylistCount();
}
function updateYtPlaylistCount() {
    const pl = ytPlaylist, n = pl ? pl.selected.size : 0, total = pl ? pl.entries.length : 0;
    if (ytEls.plCount) ytEls.plCount.textContent = `${total} ${total === 1 ? "video" : "videos"} · ${n} ticked`;
    if (ytEls.plAll) { ytEls.plAll.checked = !!pl && n === total; ytEls.plAll.indeterminate = n > 0 && n < total; }
    if (ytEls.plAdd) { ytEls.plAdd.textContent = n ? `Add ${n} to the import list` : "Tick some songs to add"; ytEls.plAdd.disabled = !n || ytBusy; }
}
function addPlaylistToImportList() {
    const pl = ytPlaylist; if (!pl || !pl.selected.size) return;
    // An empty list takes the YouTube playlist's name as where these go.
    if (!importWaiting().length && !importer.running) {
        const same = getOrderedPlaylistNames().find((n) => n.toLowerCase() === pl.title.toLowerCase());
        importList.dest = same || "__new__"; importList.destName = same ? "" : pl.title;
        fillImportDest();
    }
    const added = addToImportList([...pl.selected].sort((a, b) => a - b).map((i) => pl.entries[i]));
    ytSetStatus(added ? `Added ${added} ${added === 1 ? "song" : "songs"} to the import list.` : "Those are already on the import list.", added ? "success" : "");
    ytPlaylist = null; ytEls.plPreview.style.display = "none"; ytEls.url.value = ""; if (ytEls.modeRow) ytEls.modeRow.style.display = "none";
}

if (ytEls.overlay) {
    const importLinkHomeBtn = $("import-link-home-btn");
    if (importLinkBtn) importLinkBtn.addEventListener("click", () => openYtModal(currentPlaylist));
    if (importLinkHomeBtn) importLinkHomeBtn.addEventListener("click", () => openYtModal());
    ytEls.tabs.addEventListener("click", (e) => { const b = e.target.closest("button[data-value]"); if (b) { selectYtTab(b.dataset.value); if (!isMobile()) (ytTab === "search" ? ytEls.q : ytEls.url).focus(); } });
    // Search
    ytEls.searchForm.addEventListener("submit", (e) => { e.preventDefault(); ytEls.q.blur(); ytRunSearch(ytEls.q.value); });
    ytEls.q.addEventListener("input", () => { ytEls.qClear.style.display = ytEls.q.value ? "flex" : "none"; });
    ytEls.qClear.addEventListener("click", () => { ytEls.q.value = ""; ytEls.qClear.style.display = "none"; ytEls.q.focus(); });
    ytEls.results.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "more") { ytRunSearch(ytSearch.q, true); return; }
        if (act === "retry") { ytRunSearch(ytSearch.q); return; }
        const row = e.target.closest(".yt-result:not(.skeleton)"); if (row) toggleSearchResult(row.dataset.id);
    });
    // Link
    ytEls.fetchBtn.addEventListener("click", ytFetch);
    ytEls.url.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ytFetch(); } });
    ytEls.url.addEventListener("paste", () => setTimeout(() => { if (ytEls.url.value.trim() && !ytPlaylist) ytFetch(); }, 60));
    if (ytEls.mode) ytEls.mode.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-value]"); if (!b || ytBusy || b.dataset.value === ytMode) return;
        ytMode = b.dataset.value; syncYtModeButtons(); ytPlaylist = null;
        if (ytMode === "playlist") ytFetchPlaylist(ytEls.url.value.trim()); else ytFetch();
    });
    ytEls.plList.addEventListener("change", (e) => {
        const item = e.target.closest(".yt-pl-item"); if (!item || !ytPlaylist) return;
        const i = Number(item.dataset.i);
        if (e.target.checked) ytPlaylist.selected.add(i); else ytPlaylist.selected.delete(i);
        updateYtPlaylistCount();
    });
    ytEls.plAll.addEventListener("change", () => {
        if (!ytPlaylist) return;
        ytPlaylist.selected = ytEls.plAll.checked ? new Set(ytPlaylist.entries.map((_, i) => i)) : new Set();
        ytEls.plList.querySelectorAll("input").forEach((i) => { i.checked = ytEls.plAll.checked; });
        updateYtPlaylistCount();
    });
    ytEls.plAdd.addEventListener("click", addPlaylistToImportList);
    // The import list
    ytEls.queueToggle.addEventListener("click", () => { importList.open = !importList.open; saveImportList(); renderImportList(); });
    ytEls.tidy.addEventListener("change", () => {
        importList.tidy = ytEls.tidy.checked;
        for (const i of importList.items) if (i.status !== "done") retidy(i);
        saveImportList(); renderImportList(); renderYtResults(); if (ytPlaylist) renderYtPlaylist();
    });
    if (ytEls.square) ytEls.square.addEventListener("change", () => { importList.square = ytEls.square.checked; saveImportList(); });
    ytEls.queueClear.addEventListener("click", async () => {
        const done = importList.items.filter((i) => i.status === "done").length;
        if (done && done < importList.items.length) importList.items = importList.items.filter((i) => i.status !== "done");
        else {
            const waiting = importList.items.filter((i) => i.status !== "done").length;
            if (waiting > 3 && !(await showPrompt({ title: "Clear the import list?", message: `${waiting} songs haven't been imported yet.`, confirmText: "Clear" }))) return;
            importList.items = importList.items.filter((i) => i.status === "downloading");
        }
        importEditing = null; saveImportList(); renderImportList(); renderYtResults(); syncImportUi();
    });
    ytEls.queueList.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]"), row = e.target.closest(".yt-item"); if (!btn || !row) return;
        const item = importList.items.find((i) => i.key === row.dataset.key); if (!item) return;
        const act = btn.dataset.act;
        if (act === "remove") { removeImportItem(item.key); return; }
        if (act === "cover") { if (item.status === "queued" || item.status === "failed") chooseItemCover(item); return; }
        if (act === "swap") {
            const key = sideKey(item.channel), wasGuess = key && item.order && !item.sure && !item.edited;
            swapItemOrder(item);
            // A guess that was wrong: the channel writes its titles the other way round, so its other songs flip too.
            if (wasGuess) {
                importList.channelOrder[key] = item.order;
                for (const other of importList.items) if (other !== item && other.status !== "done" && sideKey(other.channel) === key) retidy(other);
            }
            item.edited = true; saveImportList(); renderImportList(); haptic(8);
            return;
        }
        if (act === "retry") { item.status = "queued"; item.error = ""; saveImportList(); renderImportList(); syncImportUi(); if (importer.running) return; startImport(); return; }
        if (act === "edit") { importEditing = item.key; renderImportList(); const f = ytEls.queueList.querySelector('.yt-edit[data-f="title"]'); if (f) { f.focus(); f.select(); } return; }
        if (act === "done") { importEditing = null; renderImportList(); }
    });
    ytEls.queueList.addEventListener("input", (e) => {
        const f = e.target.closest(".yt-edit"), row = e.target.closest(".yt-item"); if (!f || !row) return;
        const item = importList.items.find((i) => i.key === row.dataset.key); if (!item) return;
        item[f.dataset.f === "artist" ? "artist" : "title"] = f.value; item.edited = true; item.typed = true;
        saveImportList(true);
    });
    ytEls.queueList.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.closest(".yt-edit")) { e.preventDefault(); importEditing = null; renderImportList(); } });
    ytEls.dest.addEventListener("change", () => { importList.dest = ytEls.dest.value; saveImportList(); syncImportDestName(); if (ytEls.dest.value === "__new__") ytEls.destName.focus(); });
    ytEls.destName.addEventListener("input", () => { importList.destName = ytEls.destName.value; saveImportList(true); });
    ytEls.importBtn.addEventListener("click", () => (importer.running ? stopImport() : startImport()));
    // Footer, closing
    ytEls.cancelBtn.addEventListener("click", closeYtModal);
    ytEls.closeX.addEventListener("click", closeYtModal);
    ytEls.setupBtn.addEventListener("click", ytSetup);
    ytEls.updateBtn.addEventListener("click", ytUpdate);
    ytEls.overlay.addEventListener("click", (e) => { if (e.target === ytEls.overlay) closeYtModal(); });
    if (ytEls.pill) ytEls.pill.addEventListener("click", () => openYtModal());
    if (!ytBackend.available) { [importLinkBtn, importLinkHomeBtn, $("tab-import")].forEach((b) => { if (b) b.style.display = "none"; }); }
}

// ══════════════════════════════════════════════
// ── COVER PICKER ──
// Choose the part of a picture that becomes a song's cover: a square window sits over the
// picture; drag to move the picture under it, pinch / scroll / the slider to zoom in. Opened
// from the import list (on the video's thumbnail, before it downloads) and from a song's
// menu (on the full thumbnail it was imported with, or else its current cover).
// ══════════════════════════════════════════════
const cropEls = {
    overlay: $("crop-overlay"), stage: $("crop-stage"), img: $("crop-img"), zoom: $("crop-zoom"), title: $("crop-title"),
    status: $("crop-status"), save: $("crop-save-btn"), cancel: $("crop-cancel-btn"), close: $("crop-close-btn"), reset: $("crop-reset-btn")
};
const CROP_INSET = 0.1, CROP_MAX_ZOOM = 6;
let crop = null; // { iw, ih, k (screen px per picture px), ox, oy (picture's corner inside the window), src, onSave }
function cropGeom() { const S = cropEls.stage.clientWidth; return { V: S * (1 - 2 * CROP_INSET), off: S * CROP_INSET }; }
function cropKMin() { return cropGeom().V / Math.min(crop.iw, crop.ih); } // the picture just covers the square
function renderCrop() {
    if (!crop) return;
    const { V, off } = cropGeom(), kMin = cropKMin();
    crop.k = clamp(crop.k, kMin, kMin * CROP_MAX_ZOOM);
    crop.ox = clamp(crop.ox, V - crop.iw * crop.k, 0); crop.oy = clamp(crop.oy, V - crop.ih * crop.k, 0);
    cropEls.img.style.transform = `translate(${off + crop.ox}px, ${off + crop.oy}px) scale(${crop.k})`;
    if (document.activeElement !== cropEls.zoom) { cropEls.zoom.value = String(Math.round((Math.log(crop.k / kMin) / Math.log(CROP_MAX_ZOOM)) * 100)); updateSliderFill(cropEls.zoom); }
}
// Zoom to k keeping the picture point under (px, py) — a spot in the window — where it is.
function zoomCropAt(k, px, py) {
    if (!crop) return;
    const kMin = cropKMin(), nk = clamp(k, kMin, kMin * CROP_MAX_ZOOM), ix = (px - crop.ox) / crop.k, iy = (py - crop.oy) / crop.k;
    crop.k = nk; crop.ox = px - ix * nk; crop.oy = py - iy * nk;
    renderCrop();
}
function resetCrop(rect) {
    if (!crop) return;
    const { V } = cropGeom();
    if (rect && rect.iw === crop.iw && rect.ih === crop.ih && rect.size > 0) { crop.k = V / rect.size; crop.ox = -rect.x * crop.k; crop.oy = -rect.y * crop.k; }
    else { crop.k = cropKMin(); crop.ox = (V - crop.iw * crop.k) / 2; crop.oy = (V - crop.ih * crop.k) / 2; }
    renderCrop();
}
function setCropStatus(msg, kind = "") { cropEls.status.textContent = msg || ""; cropEls.status.className = "yt-status" + (kind ? " " + kind : ""); }
// sources: picture URLs to try in order (a missing size falls through to the next).
// opts: { title, rect (a previous choice, to start from), minSide, onSave(rect) }, where
// rect = { src, x, y, size, iw, ih } in the picture's own pixels.
function openCropper(sources, opts = {}) {
    if (!cropEls.overlay) return;
    crop = null;
    setText(cropEls.title, opts.title || "Choose the cover");
    setCropStatus("Loading the picture…"); cropEls.save.disabled = true;
    const img = cropEls.img;
    img.removeAttribute("style"); img.style.visibility = "hidden";
    cropEls.overlay.style.display = "flex";
    const list = [].concat(sources).filter(Boolean);
    let at = 0;
    const next = () => {
        if (at >= list.length) { setCropStatus("Couldn't load the picture.", "error"); return; }
        const url = list[at++];
        img.onerror = next;
        img.onload = () => {
            if (!isShown(cropEls.overlay)) return;
            // YouTube answers a missing size with a small grey placeholder.
            if (opts.minSide && Math.max(img.naturalWidth, img.naturalHeight) < opts.minSide && at < list.length) { next(); return; }
            crop = { iw: img.naturalWidth, ih: img.naturalHeight, k: 1, ox: 0, oy: 0, src: url, onSave: opts.onSave };
            img.style.width = crop.iw + "px"; img.style.height = crop.ih + "px";
            resetCrop(opts.rect && opts.rect.src === url ? opts.rect : null);
            img.style.visibility = "";
            setCropStatus(""); cropEls.save.disabled = false;
        };
        img.src = url;
    };
    next();
}
function closeCropper() { if (cropEls.overlay) cropEls.overlay.style.display = "none"; crop = null; cropEls.img.removeAttribute("src"); }
function saveCrop() {
    if (!crop) return;
    const { V } = cropGeom(), fn = crop.onSave;
    const rect = { src: crop.src, x: Math.max(0, -crop.ox / crop.k), y: Math.max(0, -crop.oy / crop.k), size: V / crop.k, iw: crop.iw, ih: crop.ih };
    closeCropper();
    if (fn) fn(rect);
}
// The chosen square of a picture (a Blob or a URL), as a cover of up to 640 px. The rect
// was chosen on a copy rect.iw x rect.ih pixels; a different size of the same picture works.
async function cropToBlob(src, rect) {
    const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
    const bmp = await createImageBitmap(blob);
    try {
        const f = Math.min(bmp.width / (rect.iw || bmp.width), bmp.height / (rect.ih || bmp.height));
        const side = rect.size * f, out = Math.max(64, Math.min(640, Math.round(side)));
        const c = document.createElement("canvas"); c.width = c.height = out;
        const g = c.getContext("2d"); g.imageSmoothingQuality = "high";
        g.drawImage(bmp, rect.x * f, rect.y * f, side, side, 0, 0, out, out);
        return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
    } finally { if (typeof bmp.close === "function") bmp.close(); }
}
// A square preview of a chosen crop, as CSS for a small box.
function coverPreviewStyle(r) {
    const px = r.iw > r.size ? (r.x / (r.iw - r.size)) * 100 : 0, py = r.ih > r.size ? (r.y / (r.ih - r.size)) * 100 : 0;
    return `background-image:url('${String(r.src).replace(/['"\\\n\r]/g, "")}');background-size:${(r.iw / r.size * 100).toFixed(2)}% ${(r.ih / r.size * 100).toFixed(2)}%;background-position:${px.toFixed(2)}% ${py.toFixed(2)}%`;
}
// From the import list: crop the video's own thumbnail (the big one when it has it).
function chooseItemCover(item) {
    const yt = /^[\w-]{11}$/.test(item.id) && /youtu/i.test(item.url);
    const sources = yt ? [`https://i.ytimg.com/vi/${item.id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`, item.thumb] : [item.thumb];
    openCropper(sources, { title: "Choose the cover", rect: item.crop, minSide: 200, onSave: (rect) => { item.crop = rect; saveImportList(); renderImportList(); } });
}
// From a song's menu: crop the full thumbnail it was imported with, or its current cover.
// Cropping a cover with no original kept keeps that cover as the original, so the next
// change can still reach the whole picture.
async function editSongCover(song) {
    const srcId = song.thumbId || song.artId;
    if (!srcId) { showToast("This song has no picture yet: add one with Edit details"); return; }
    const url = await getBlobUrl(srcId);
    if (!url) { showToast("Couldn't load this song's picture"); return; }
    const prev = song.coverCrop && song.coverCrop.from === srcId ? { ...song.coverCrop, src: url } : null;
    openCropper([url], { title: "Choose the cover", rect: prev, onSave: async (rect) => {
        try {
            const blob = await getBlob(srcId); if (!blob) throw new Error("the picture is missing");
            const cover = await cropToBlob(blob, rect); if (!cover) throw new Error("couldn't make the cover");
            const artId = await storeBlob(cover);
            if (!song.thumbId) song.thumbId = song.artId;
            song.artId = artId; song.art = (await getBlobUrl(artId)) || DEFAULT_ART;
            song.coverCrop = { from: srcId, x: rect.x, y: rect.y, size: rect.size, iw: rect.iw, ih: rect.ih };
            propagateSongEdit(song);
            await saveLibrary(); renderSongs(); renderPlaylists(); renderQueue(); scheduleShelves();
            if (currentTrack && (currentTrack.id === song.id || currentTrack.mediaId === song.mediaId)) { showTrackInfo(currentTrack, currentTrackSource); updateMediaSessionMetadata(); }
            gcUnreferencedBlobs();
            showToast("Cover updated");
        } catch (e) { showToast("Couldn't change the cover: " + errorText(e)); }
    } });
}
(() => {
    if (!cropEls.overlay) return;
    const pts = new Map(); let pinch = null;
    const pos = (e) => { const r = cropEls.stage.getBoundingClientRect(), { off } = cropGeom(); return [e.clientX - r.left - off, e.clientY - r.top - off]; };
    cropEls.stage.addEventListener("pointerdown", (e) => {
        if (!crop || (e.button !== undefined && e.button !== 0)) return;
        e.preventDefault();
        try { cropEls.stage.setPointerCapture(e.pointerId); } catch {}
        pts.set(e.pointerId, pos(e)); pinch = null;
    });
    cropEls.stage.addEventListener("pointermove", (e) => {
        if (!crop || !pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId), p = pos(e);
        pts.set(e.pointerId, p);
        if (pts.size === 1) { crop.ox += p[0] - prev[0]; crop.oy += p[1] - prev[1]; renderCrop(); return; }
        const [a, b] = [...pts.values()], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) { crop.ox += mid[0] - pinch.mid[0]; crop.oy += mid[1] - pinch.mid[1]; zoomCropAt(crop.k * dist / Math.max(1, pinch.dist), mid[0], mid[1]); }
        pinch = { mid, dist };
    });
    const up = (e) => { pts.delete(e.pointerId); pinch = null; };
    cropEls.stage.addEventListener("pointerup", up);
    cropEls.stage.addEventListener("pointercancel", up);
    cropEls.stage.addEventListener("wheel", (e) => { if (!crop) return; e.preventDefault(); const [x, y] = pos(e); zoomCropAt(crop.k * Math.exp(-e.deltaY * 0.0015), x, y); }, { passive: false });
    cropEls.zoom.addEventListener("input", () => {
        if (!crop) return;
        const { V } = cropGeom();
        zoomCropAt(cropKMin() * Math.pow(CROP_MAX_ZOOM, Number(cropEls.zoom.value) / 100), V / 2, V / 2);
        updateSliderFill(cropEls.zoom);
    });
    cropEls.save.addEventListener("click", saveCrop);
    cropEls.reset.addEventListener("click", () => resetCrop(null));
    cropEls.cancel.addEventListener("click", closeCropper);
    cropEls.close.addEventListener("click", closeCropper);
    cropEls.overlay.addEventListener("click", (e) => { if (e.target === cropEls.overlay) closeCropper(); });
    window.addEventListener("resize", () => { if (crop) renderCrop(); });
})();

// ══════════════════════════════════════════════
// ── ARTIST PAGE ──
// Tapping an artist name anywhere opens a page with every song by them across all
// playlists (de-duplicated by media, so a song copied into three playlists shows
// once), the total length of that music, and per-song plays / time listened.
// "artist:<name>" is also a valid playback source, so Play all / Shuffle here keep
// advancing through the artist's songs like a playlist would.
// ══════════════════════════════════════════════
const ARTIST_SOURCE_PREFIX = "artist:";
function isArtistSource(name) { return typeof name === "string" && name.startsWith(ARTIST_SOURCE_PREFIX); }
function artistFromSource(name) { return isArtistSource(name) ? name.slice(ARTIST_SOURCE_PREFIX.length) : name; }
function sourceLabel(source) { return isArtistSource(source) ? artistFromSource(source) : isLikedSource(source) ? "Liked Songs" : (source || "Prism"); }
function artistKey(name) { return String(name || "Unknown Artist").trim().toLowerCase(); }
function artistLinkHtml(artist) { const a = artist || "Unknown Artist"; return `<button type="button" class="artist-link" data-artist="${escapeHtml(a)}">${escapeHtml(a)}</button>`; }

let artistSort = "plays"; // plays | time | title
let artistCurrent = null;
const artistOverlay = $("artist-overlay"), artistList = $("artist-list");

function getArtistSongs(name, sort = artistSort) {
    const key = artistKey(name), seen = new Map();
    for (const playlistName of getOrderedPlaylistNames()) {
        for (const song of playlists[playlistName].songs || []) {
            if (artistKey(song.artist) !== key) continue;
            const k = statsKeyFor(song);
            if (seen.has(k)) continue;
            const st = listenStats[k];
            seen.set(k, { song, playlistName, plays: st?.plays || 0, seconds: st?.seconds || 0 });
        }
    }
    const rows = [...seen.values()];
    if (sort === "time") rows.sort((a, b) => b.seconds - a.seconds || b.plays - a.plays || cmpText(a.song.title, b.song.title));
    else if (sort === "title") rows.sort((a, b) => cmpText(a.song.title, b.song.title));
    else rows.sort((a, b) => b.plays - a.plays || b.seconds - a.seconds || cmpText(a.song.title, b.song.title));
    return rows;
}

function openArtistPage(name) {
    if (!artistOverlay) return;
    artistCurrent = (name || "Unknown Artist").trim() || "Unknown Artist";
    renderArtistPage();
    artistOverlay.style.display = "flex";
    if (artistList) artistList.scrollTop = 0;
}
function closeArtistPage() { if (artistOverlay) artistOverlay.style.display = "none"; artistCurrent = null; }
function renderArtistPage() {
    if (!artistOverlay || artistCurrent === null) return;
    const rows = getArtistSongs(artistCurrent);
    const totalDur = rows.reduce((a, r) => a + (r.song.duration || 0), 0);
    const plays = rows.reduce((a, r) => a + r.plays, 0), seconds = rows.reduce((a, r) => a + r.seconds, 0);
    $("artist-name").textContent = artistCurrent;
    $("artist-meta").textContent = `${rows.length} ${rows.length === 1 ? "song" : "songs"} · ${formatMusicLength(totalDur)} of music`;
    $("artist-total-plays").textContent = plays;
    $("artist-total-time").textContent = formatListenTime(seconds);
    $("artist-total-length").textContent = formatMusicLength(totalDur);
    const hero = $("artist-hero-art");
    if (hero) { hero.src = rows.map((r) => r.song.art).find((a) => a && a !== DEFAULT_ART) || DEFAULT_ART; addImageFallback(hero); }
    document.querySelectorAll(".artist-sort-btn").forEach((b) => b.classList.toggle("active", b.dataset.sort === artistSort));
    artistList.innerHTML = "";
    if (!rows.length) { artistList.innerHTML = '<div class="stats-empty">No songs by this artist in your library.</div>'; return; }
    const activeKey = statsKeyFor(currentTrack);
    rows.forEach((r, i) => {
        const row = document.createElement("div");
        row.className = `stats-row${statsKeyFor(r.song) === activeKey ? " playing" : ""}`;
        row.innerHTML = `<div class="stats-rank">${i + 1}</div><img src="${escapeHtml(r.song.art || DEFAULT_ART)}" alt="">
            <div class="stats-row-info"><strong>${escapeHtml(r.song.title || "Unknown")}</strong><span>${formatTime(r.song.duration)} · ${escapeHtml(r.playlistName)}</span></div>
            <div class="stats-row-nums"><strong>${r.plays} ${r.plays === 1 ? "play" : "plays"}</strong><span>${formatListenTime(r.seconds)}</span></div>`;
        addImageFallback(row.querySelector("img"));
        row.addEventListener("click", () => playSong(r.song, ARTIST_SOURCE_PREFIX + artistCurrent).then(renderArtistPage));
        row.addEventListener("contextmenu", (e) => { e.preventDefault(); openSongMenu(r.song, r.playlistName, e.clientX, e.clientY); });
        artistList.appendChild(row);
    });
}
function playArtist(shuffle) {
    if (artistCurrent === null) return;
    const rows = getArtistSongs(artistCurrent); if (!rows.length) return;
    if (shuffle !== shuffleEnabled) { shuffleEnabled = shuffle; shuffledOrder = []; setActiveButton(shuffleBtn, shuffleEnabled); updateNpControls(); saveNowPlaying(true); }
    const pick = shuffle ? rows[Math.floor(Math.random() * rows.length)] : rows[0];
    playSong(pick.song, ARTIST_SOURCE_PREFIX + artistCurrent).then(renderArtistPage);
}
// Capture phase so a tap on the artist name never also plays the row (mobile rows play on tap).
document.addEventListener("click", (e) => {
    const link = e.target.closest(".artist-link, #track-artist, #np-artist");
    if (!link) return;
    const name = link.dataset.artist || link.textContent;
    if (!name || (!link.classList.contains("artist-link") && !currentTrack)) return;
    e.preventDefault(); e.stopPropagation();
    closeContextMenu();
    openArtistPage(name);
}, true);
if ($("artist-close-btn")) $("artist-close-btn").addEventListener("click", closeArtistPage);
if (artistOverlay) artistOverlay.addEventListener("click", (e) => { if (e.target === artistOverlay) closeArtistPage(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && artistOverlay && artistOverlay.style.display !== "none") closeArtistPage(); });
document.querySelectorAll(".artist-sort-btn").forEach((btn) => btn.addEventListener("click", () => { artistSort = btn.dataset.sort || "plays"; renderArtistPage(); renderQueue(); if (typeof renderNpQueue === "function") renderNpQueue(); }));
if ($("artist-play-btn")) $("artist-play-btn").addEventListener("click", () => playArtist(false));
if ($("artist-shuffle-btn")) $("artist-shuffle-btn").addEventListener("click", () => playArtist(true));

// ══════════════════════════════════════════════
// ── AUDIO ENGINE (volume leveller + effects) ──
// Both <audio> elements feed one Web Audio graph:
//   element → per-element gain (leveller) → bass / mid / treble → balance → dry + reverb → limiter → out
// createMediaElementSource is irreversible, so the graph is only built once something
// needs it (leveller on, or an effect moved off its default); after that a "default"
// setting is simply transparent. Playback works exactly as before if it never builds.
// ══════════════════════════════════════════════
const FX_DEFAULTS = { bass: 0, mid: 0, treble: 0, reverb: 0, pan: 0 };
const FX_RANGES = { bass: [-12, 12], mid: [-12, 12], treble: [-12, 12], reverb: [0, 100], pan: [-100, 100] };
const FX_KEY = "spootify-fx", LEVELLER_KEY = "spootify-leveller";
let fxSettings = { ...FX_DEFAULTS };
let levellerEnabled = false;
let audioCtx = null, fxNodes = null;
const elementGains = new Map(); // <audio> → GainNode

function fxIsDefault() { return Object.keys(FX_DEFAULTS).every((k) => fxSettings[k] === FX_DEFAULTS[k]); }
function fxNeeded() { return levellerEnabled || !fxIsDefault() || vizEnabled(); }

// Synthetic room: exponentially decaying noise, low-passed so the tail is soft rather than hissy.
function makeReverbImpulse(ctx, seconds = 2.4, decay = 3.2) {
    const rate = ctx.sampleRate, len = Math.floor(rate * seconds), buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c); let lp = 0;
        for (let i = 0; i < len; i++) { lp += 0.25 * ((Math.random() * 2 - 1) - lp); d[i] = lp * Math.pow(1 - i / len, decay); }
    }
    return buf;
}

function ensureAudioGraph() {
    if (audioCtx) { if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {}); return true; }
    if (!fxNeeded()) return false;
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return false;
    try {
        const ctx = new Ctx({ latencyHint: "playback" });
        const bass = ctx.createBiquadFilter(); bass.type = "lowshelf"; bass.frequency.value = 150;
        const mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.9;
        const treble = ctx.createBiquadFilter(); treble.type = "highshelf"; treble.frequency.value = 4000;
        const pan = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
        const dry = ctx.createGain(), wet = ctx.createGain(); wet.gain.value = 0;
        const reverb = ctx.createConvolver(); reverb.buffer = makeReverbImpulse(ctx);
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.2;
        // The analyser passes audio through untouched; the visualizer reads from it.
        const tap = ctx.createAnalyser(); tap.fftSize = 512; tap.smoothingTimeConstant = 0.8; tap.minDecibels = -88; tap.maxDecibels = -18;
        const input = ctx.createGain();
        input.connect(bass); bass.connect(mid); mid.connect(treble);
        let tail = treble; if (pan) { treble.connect(pan); tail = pan; }
        tail.connect(dry); tail.connect(reverb); reverb.connect(wet);
        dry.connect(limiter); wet.connect(limiter); limiter.connect(tap); tap.connect(ctx.destination);
        for (const el of [playerA, playerB]) { const src = ctx.createMediaElementSource(el); const g = ctx.createGain(); src.connect(g); g.connect(input); elementGains.set(el, g); }
        audioCtx = ctx; fxNodes = { bass, mid, treble, pan, dry, wet, limiter }; analyser = tap;
        applyFxSettings(); applyVizTuning();
        if (currentTrack) applyLevellerGain(audioPlayer, currentTrack, 0);
        if (crossfadePending) applyLevellerGain(standbyPlayer, crossfadePending.song, 0);
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch (e) { console.warn("Audio engine unavailable", e); return false; }
    return true;
}

function applyFxSettings() {
    if (!fxNodes || !audioCtx) return;
    const t = audioCtx.currentTime, set = (param, v, tc = 0.02) => param.setTargetAtTime(v, t, tc);
    set(fxNodes.bass.gain, fxSettings.bass); set(fxNodes.mid.gain, fxSettings.mid); set(fxNodes.treble.gain, fxSettings.treble);
    if (fxNodes.pan) set(fxNodes.pan.pan, fxSettings.pan / 100);
    const w = fxSettings.reverb / 100;
    set(fxNodes.wet.gain, w * 0.9, 0.05); set(fxNodes.dry.gain, 1 - w * 0.35, 0.05);
}
function fxDisplayValue(key, v) {
    if (key === "reverb") return v === 0 ? "Off" : v + "%";
    if (key === "pan") return v === 0 ? "Centre" : (v < 0 ? `L ${-v}` : `R ${v}`);
    return (v > 0 ? "+" : "") + v + " dB";
}
function setFx(key, value, save = true) {
    if (!(key in FX_DEFAULTS)) return;
    const [lo, hi] = FX_RANGES[key];
    const n = Number(value);
    fxSettings[key] = Math.round(Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : FX_DEFAULTS[key])));
    const slider = $(`fx-${key}`), display = $(`fx-${key}-value`);
    if (slider) { slider.value = fxSettings[key]; if (lo < 0) updateBipolarFill(slider); else updateSliderFill(slider); }
    if (display) display.textContent = fxDisplayValue(key, fxSettings[key]);
    if (fxNeeded()) ensureAudioGraph();
    applyFxSettings();
    const resetBtn = $("fx-reset-btn"); if (resetBtn) resetBtn.disabled = fxIsDefault();
    if (save) localStorage.setItem(FX_KEY, JSON.stringify(fxSettings));
    schedulePresetRefresh();
}
function resetFx() {
    for (const k of Object.keys(FX_DEFAULTS)) setFx(k, FX_DEFAULTS[k], false);
    localStorage.setItem(FX_KEY, JSON.stringify(fxSettings));
    showToast("Effects reset to defaults");
}
function loadFxSettings() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(FX_KEY) || "null"); } catch {}
    for (const k of Object.keys(FX_DEFAULTS)) setFx(k, saved && Number.isFinite(saved[k]) ? saved[k] : FX_DEFAULTS[k], false);
}

// ── Volume leveller ──
// Each song is measured once (integrated RMS-style loudness in dBFS, cached on the
// song) and played through a gain that brings it to a common target, with the
// limiter catching peaks when a quiet track is boosted. Measurement runs in the
// background the first time a song is about to play; the next song is measured
// while the current one plays so its level is ready before it starts.
const LEVELLER_TARGET_DB = -16;
const LEVELLER_MIN_DB = -14, LEVELLER_MAX_DB = 8;
const loudnessJobs = new Map(); // mediaId → Promise
function levellerGainFor(song) {
    if (!levellerEnabled || !song || !Number.isFinite(song.loudness)) return 1;
    const db = Math.max(LEVELLER_MIN_DB, Math.min(LEVELLER_MAX_DB, LEVELLER_TARGET_DB - song.loudness));
    return Math.pow(10, db / 20);
}
function applyLevellerGain(el, song, ramp = 0.3) {
    const g = elementGains.get(el); if (!g || !audioCtx) return;
    const target = levellerGainFor(song);
    if (ramp <= 0) { g.gain.cancelScheduledValues(audioCtx.currentTime); g.gain.value = target; }
    else g.gain.setTargetAtTime(target, audioCtx.currentTime, ramp / 3);
}
function prepareLeveller(song) {
    if (!levellerEnabled || !song || Number.isFinite(song.loudness)) return null;
    const key = song.mediaId; if (!key || loudnessJobs.has(key)) return loudnessJobs.get(key) || null;
    const job = (async () => {
        const blob = await getBlob(key); if (!blob) return;
        const db = await measureLoudness(blob);
        if (!Number.isFinite(db)) return;
        for (const pl of Object.values(playlists)) for (const s of pl.songs || []) if (s.mediaId === key) s.loudness = db;
        for (const item of queue) if (item?.song?.mediaId === key) item.song.loudness = db;
        if (currentTrack?.mediaId === key) { currentTrack.loudness = db; applyLevellerGain(audioPlayer, currentTrack, 0.8); }
        if (crossfadePending?.song?.mediaId === key) { crossfadePending.song.loudness = db; applyLevellerGain(standbyPlayer, crossfadePending.song, 0.8); }
        saveLibrary();
    })().catch((e) => console.warn("Loudness analysis failed", e)).finally(() => loudnessJobs.delete(key));
    loudnessJobs.set(key, job);
    return job;
}
// Decode at 8 kHz mono (cheap, and plenty for level), RMS power in 400 ms blocks,
// drop near-silent blocks and anything 10 dB under the mean (quiet intros/outros),
// then average power → dBFS. Close enough to integrated loudness for levelling.
async function decodeLowRate(blob, rate = 8000) {
    const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new Off(1, rate, rate);
    const bytes = await blob.arrayBuffer();
    return new Promise((resolve, reject) => { const p = off.decodeAudioData(bytes, resolve, reject); if (p && p.then) p.then(resolve, reject); });
}
async function measureLoudness(blob) {
    const audio = await decodeLowRate(blob);
    const data = audio.getChannelData(0), block = Math.floor(audio.sampleRate * 0.4);
    const blocks = [];
    for (let i = 0; i + block <= data.length; i += block) { let sum = 0; for (let j = i; j < i + block; j++) sum += data[j] * data[j]; blocks.push(sum / block); }
    if (!blocks.length) return NaN;
    const gate = Math.pow(10, -50 / 10);
    let kept = blocks.filter((p) => p > gate); if (!kept.length) kept = blocks;
    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    const rel = kept.filter((p) => p > mean / 10);
    const power = rel.reduce((a, b) => a + b, 0) / rel.length;
    return power > 0 ? 10 * Math.log10(power) : NaN;
}
function setLeveller(enabled, save = true) {
    levellerEnabled = !!enabled;
    const toggle = $("leveller-toggle"); if (toggle) toggle.checked = levellerEnabled;
    const hint = $("leveller-hint");
    if (hint) hint.textContent = levellerEnabled ? "Each song is measured the first time it plays and its volume matched to the others." : "Quiet songs get boosted and loud ones turned down so you don't have to touch the volume.";
    if (levellerEnabled) ensureAudioGraph();
    if (currentTrack) { applyLevellerGain(audioPlayer, currentTrack); prepareLeveller(currentTrack); }
    if (crossfadePending) applyLevellerGain(standbyPlayer, crossfadePending.song);
    if (save) localStorage.setItem(LEVELLER_KEY, levellerEnabled ? "1" : "0");
}
const levellerToggle = $("leveller-toggle");
if (levellerToggle) levellerToggle.addEventListener("change", () => setLeveller(levellerToggle.checked));
for (const key of Object.keys(FX_DEFAULTS)) {
    const slider = $(`fx-${key}`);
    if (slider) {
        slider.addEventListener("input", () => setFx(key, slider.value));
        slider.addEventListener("dblclick", () => setFx(key, FX_DEFAULTS[key]));
    }
}
if ($("fx-reset-btn")) $("fx-reset-btn").addEventListener("click", resetFx);
// Measure the upcoming song while this one plays, so the level is ready before it starts.
onPlayer("playing", () => { setTimeout(() => { if (levellerEnabled) { const n = peekNextSong(); if (n) prepareLeveller(n.song); } }, 4000); });


// ══════════════════════════════════════════════
// ── APPEARANCE ──
// Themes are expanded into CSS variables by themes.js (applied before first paint).
// This is the Appearance tab (a theme grid that shows 11 and folds the rest behind
// "+N more"), the theme editor (it docks beside the app so every change previews
// live), Prism's own colour picker, accent overrides, album-art tints and the
// visualizer.
// ══════════════════════════════════════════════
const ACCENT_SWATCHES = ["#1DB954", "#2e77d0", "#8b5cf6", "#e91e63", "#f43f5e", "#f97316", "#f5c542", "#14b8a6", "#06b6d4"];
const THEME_GRID_LIMIT = 11;
let themeGridExpanded = false;
function currentTheme() { return Themes ? Themes.findTheme(appearance.theme) : { id: "spootify", name: "Prism", mode: "dark", style: "classic", bg: "#0a0a0a" }; }
function applyAppearance(save = true) {
    const theme = currentTheme(), root = document.documentElement;
    if (Themes) Themes.apply(theme, appearance);
    root.dataset.viz = appearance.visualizer || "off";
    // Stars can be hidden in song lists and on the full-screen player (Settings → Appearance).
    root.dataset.starsLists = appearance.starsInLists === false ? "0" : "1";
    root.dataset.starsPlayer = appearance.starsOnPlayer === false ? "0" : "1";
    root.dataset.vizExtreme = appearance.vizExtreme ? "1" : "0";
    if (save && Themes) Themes.saveSettings(appearance);
    vizColors = null;
    applyViewTint(); applyTrackTint();
    renderStatsCard(); scheduleShelves();
    const djBtn = $("dj-open-btn"); if (djBtn) djBtn.hidden = appearance.showDj === false;
    if (Themes && Themes.resumeDrift) Themes.resumeDrift();
    if (isQuietOpen()) { stopProgressLoop(); if (!audioPlayer.paused) startProgressLoop(); }
    const quietBtn = $("quiet-open-btn"); if (quietBtn) quietBtn.hidden = appearance.showQuiet === false;
    setWindowBackground(theme.bg || "#0a0a0a");
    if (vizEnabled() && isPlaybackIntentActive) ensureAudioGraph();
    applyVizTuning();
    kickVisualizer();
    scheduleMiniState();
}
function setAppearance(key, value) { if (key === "theme" || key === "accent") markThemeLive(); appearance[key] = value; applyAppearance(); renderAppearanceUi(); }
// What shows behind the page wherever it isn't painted yet: the window on desktop, the
// WebView itself on Android (white by default, which flashed through on phones while
// they caught up drawing a scrolling pop-up).
let windowBackground = null;
function setWindowBackground(color) {
    if (!/^#[0-9a-f]{6}$/i.test(color) || color === windowBackground) return;
    windowBackground = color;
    if (window.electronAPI && typeof window.electronAPI.setBackground === "function") { try { window.electronAPI.setBackground(color); } catch {} }
    nativeAudio.setBackground(color);
}
function themeSwatchHtml(t) {
    const v = Themes.buildVars(t, {}), classic = !t.style || t.style === "classic";
    const main = classic ? `linear-gradient(180deg, ${v["--main-tint"]} 0%, ${v["--bg"]} 85%)` : v["--app-bg"];
    const layer = !classic && Themes.hasLayer(t) ? '<div class="theme-layer ts-layer"></div>' : "";
    return `<div class="theme-swatch" style="background:${escapeHtml(main)};background-color:${escapeHtml(v["--bg"])};font-family:${escapeHtml(v["--font"])}">${layer}<span class="ts-side" style="background:${escapeHtml(v["--sidebar-bg"])}"></span><span class="ts-line" style="top:16px;width:44%;background:${escapeHtml(v["--text-1"])}"></span><span class="ts-line" style="top:28px;width:30%;background:${escapeHtml(v["--text-3"])}"></span><span class="ts-dot" style="background:${escapeHtml(v["--accent-grad"])}"></span></div>`;
}
function segSet(id, value) { document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("active", b.dataset.value === String(value))); }
function renderThemeGrid() {
    const grid = $("theme-grid"); if (!grid || !Themes) return;
    const all = Themes.allThemes();
    const folds = all.length > THEME_GRID_LIMIT + 1; // never hide a single theme behind a button
    let shown = all;
    if (folds && !themeGridExpanded) {
        shown = all.slice(0, THEME_GRID_LIMIT);
        const active = all.findIndex((t) => t.id === appearance.theme);
        if (active >= THEME_GRID_LIMIT) shown[THEME_GRID_LIMIT - 1] = all[active]; // the theme you're using is always on show
    }
    const hidden = all.length - shown.length;
    const html = shown.map((t) => {
        const mine = String(t.id).startsWith("custom-");
        return `<div class="theme-card${t.id === appearance.theme ? " active" : ""}" data-id="${escapeHtml(t.id)}" role="button" tabindex="0" aria-label="${escapeHtml(t.name)} theme">${themeSwatchHtml(t)}<div class="theme-name"><span>${escapeHtml(t.name)}</span><button type="button" class="theme-edit-btn" data-edit="${escapeHtml(t.id)}" title="${mine ? "Edit" : "Make your own version"}" aria-label="${mine ? "Edit" : "Customise"} ${escapeHtml(t.name)}">${ICONS.pencil}</button></div></div>`;
    }).join("")
        + (hidden > 0 ? `<button type="button" class="theme-card theme-more-card" data-more="1" aria-label="Show ${hidden} more themes"><strong>+${hidden}</strong><span>more</span></button>` : "")
        + (folds && themeGridExpanded ? '<button type="button" class="theme-card theme-more-card" data-less="1"><strong>&minus;</strong><span>Show less</span></button>' : "");
    // Only rebuilt when what's on show changed. Every toggle in Appearance used to rebuild
    // all the cards (each with its own canvases), which on a phone could make the Settings
    // scrim drop out for a frame when the panel was scrolled.
    const layerSig = shown.filter((t) => Themes.hasLayer(t)).map((t) => JSON.stringify([t.id, t.mode, t.dots, t.image, t.blur, t.grain, t.vignette])).join("|");
    if (grid.__html === html && grid.__layers === layerSig) return;
    grid.innerHTML = html; grid.__html = html; grid.__layers = layerSig;
    const byId = new Map(shown.map((t) => [String(t.id), t]));
    grid.querySelectorAll(".ts-layer").forEach((el) => Themes.paintLayer(el, byId.get(el.closest(".theme-card").dataset.id), { static: true }));
}
// App icon (Settings -> Appearance): the bars design in four colours. Drawn inline, so the picker shows
// exactly the icon you get; picking one tells Electron (window, tray) or Android (launcher alias).
const APP_ICONS = [
    { id: "dark", name: "Dark", bg: "#111114", bars: ["#F5A3B3", "#F7C28F", "#9EE0BB", "#94C6F2", "#B8A6F2"], alpha: [1, 1, 1, 1, 1] },
    { id: "light", name: "Light", bg: "#F6F5F2", bars: ["#E8899C", "#EDAA6E", "#7FC9A0", "#74AEE0", "#9C88E0"], alpha: [1, 1, 1, 1, 1] },
    { id: "mono", name: "Mono", bg: "#26262A", bars: Array(5).fill("#FFFFFF"), alpha: [1, 0.82, 0.52, 0.42, 0.34] },
    { id: "spectrum", name: "Spectrum", bg: "url(#appicon-spectrum)", bars: Array(5).fill("#FFFFFF"), alpha: [1, 0.9, 0.7, 0.6, 0.5] },
];
function appIconSvg(icon) {
    const bars = [[260, 402, 220], [368, 322, 380], [476, 262, 500], [584, 352, 320], [692, 422, 180]];
    const grad = icon.id === "spectrum" ? '<defs><linearGradient id="appicon-spectrum" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F0A6B8"/><stop offset="0.5" stop-color="#C9B4EC"/><stop offset="1" stop-color="#A9C8F0"/></linearGradient></defs>' : "";
    return `<svg viewBox="0 0 1024 1024" aria-hidden="true">${grad}<rect width="1024" height="1024" rx="230" fill="${icon.bg}"/>`
        + bars.map(([x, y, h], i) => `<rect x="${x}" y="${y}" width="72" height="${h}" rx="36" fill="${icon.bars[i]}" fill-opacity="${icon.alpha[i]}"/>`).join("") + "</svg>";
}
function applyAppIcon(id) {
    if (!APP_ICONS.some((i) => i.id === id)) return;
    if (window.electronAPI && typeof window.electronAPI.setAppIcon === "function") { try { window.electronAPI.setAppIcon(id); } catch {} }
    const cap = window.Capacitor;
    if (cap && typeof cap.nativePromise === "function" && typeof cap.getPlatform === "function" && cap.getPlatform() === "android") {
        cap.nativePromise("AppIcon", "set", { name: id }).catch((e) => console.warn("AppIcon.set failed", e));
    }
}
function renderAppIconGrid() {
    const grid = $("app-icon-grid"); if (!grid) return;
    const cur = appearance.appIcon || "dark";
    grid.innerHTML = APP_ICONS.map((i) => `<button type="button" class="app-icon-choice${i.id === cur ? " active" : ""}" data-icon="${i.id}" aria-pressed="${i.id === cur}">${appIconSvg(i)}<span>${i.name}</span></button>`).join("");
}
if ($("app-icon-grid")) {
    $("app-icon-grid").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-icon]"); if (!b) return;
        applyAppIcon(b.dataset.icon);
        setAppearance("appIcon", b.dataset.icon);
    });
}
function renderAppearanceUi() {
    renderThemeGrid(); renderUiBaseGrid(); renderAppIconGrid();
    const sw = $("accent-swatches");
    if (sw) {
        const auto = Themes ? Themes.buildVars(currentTheme(), {})["--accent-grad"] : "#1DB954";
        const cur = String(appearance.accent || "").toLowerCase(), preset = ACCENT_SWATCHES.some((c) => c.toLowerCase() === cur);
        const pickerStart = appearance.accent && /^#[0-9a-f]{6}$/i.test(appearance.accent) ? appearance.accent : hex6(currentTheme().accent || "#1db954");
        sw.innerHTML = `<button type="button" class="accent-swatch auto${!appearance.accent ? " active" : ""}" data-accent="" style="background:${escapeHtml(auto)}" title="The theme's own colours">AUTO</button>`
            + ACCENT_SWATCHES.map((c) => `<button type="button" class="accent-swatch${cur === c.toLowerCase() ? " active" : ""}" data-accent="${c}" style="background:${c}" aria-label="Accent ${c}"></button>`).join("")
            + `<label class="accent-swatch custom${appearance.accent && !preset ? " active" : ""}" title="Pick any colour"><input type="color" id="accent-custom-input" value="${escapeHtml(pickerStart.toLowerCase())}" aria-label="Custom accent colour"></label>`;
    }
    const check = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    check("art-colors-toggle", appearance.artColors); check("compact-toggle", appearance.compact); check("reduce-motion-toggle", appearance.reduceMotion);
    check("native-picker-toggle", appearance.nativeColorPicker);
    check("show-stats-toggle", appearance.showStats !== false); check("show-mini-chart-toggle", appearance.miniChart !== false);
    check("show-recent-toggle", appearance.showRecent !== false); check("show-added-toggle", appearance.showAdded !== false);
    check("show-sotd-toggle", appearance.showSongOfDay !== false); check("show-dj-toggle", appearance.showDj !== false);
    check("show-rated-toggle", appearance.showRated !== false);
    check("animations-toggle", appearance.animations !== false); check("show-quiet-toggle", appearance.showQuiet !== false);
    for (const k of ["Art", "Text", "Progress", "Buttons"]) check(`quiet-${k.toLowerCase()}-toggle`, appearance["quiet" + k] !== false);
    check("quiet-drift-toggle", appearance.quietDrift); check("quiet-smooth-toggle", appearance.quietSmooth);
    check("stars-lists-toggle", appearance.starsInLists !== false); check("stars-player-toggle", appearance.starsOnPlayer !== false);
    check("viz-extreme-toggle", appearance.vizExtreme);
    for (const id of ["viz-extreme-row", "viz-extreme-hint"]) { const el = $(id); if (el) el.hidden = !vizEnabled(); }
    segSet("visualizer-choice", appearance.visualizer || "off");
    segSet("card-size-choice", appearance.cardSize || "m");
    segSet("rate-fx5-choice", appearance.rateFx5 || RATE_FX_DEFAULTS[5]);
    segSet("rate-fx1-choice", appearance.rateFx1 || RATE_FX_DEFAULTS[1]);
}
if ($("theme-grid")) {
    const grid = $("theme-grid");
    grid.addEventListener("click", (e) => {
        const edit = e.target.closest(".theme-edit-btn");
        if (edit) { e.stopPropagation(); openThemeEditor(edit.dataset.edit); return; }
        const more = e.target.closest(".theme-more-card");
        if (more) { themeGridExpanded = !!more.dataset.more; renderThemeGrid(); return; }
        const card = e.target.closest(".theme-card"); if (card) setAppearance("theme", card.dataset.id);
    });
    grid.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("theme-card") && e.target.dataset.id) { e.preventDefault(); setAppearance("theme", e.target.dataset.id); } });
}
if ($("accent-swatches")) {
    const sw = $("accent-swatches");
    sw.addEventListener("click", (e) => { const b = e.target.closest("button.accent-swatch"); if (b) setAppearance("accent", b.dataset.accent || null); });
    // Live while the colour picker is open; the swatch row redraws once it closes.
    sw.addEventListener("input", (e) => { if (e.target.id === "accent-custom-input") { markThemeLive(); appearance.accent = e.target.value; applyAppearance(); } });
    sw.addEventListener("change", (e) => { if (e.target.id === "accent-custom-input") renderAppearanceUi(); });
}
for (const [id, key] of [["art-colors-toggle", "artColors"], ["compact-toggle", "compact"], ["reduce-motion-toggle", "reduceMotion"], ["native-picker-toggle", "nativeColorPicker"], ["show-stats-toggle", "showStats"], ["show-mini-chart-toggle", "miniChart"], ["show-recent-toggle", "showRecent"], ["show-added-toggle", "showAdded"], ["show-sotd-toggle", "showSongOfDay"], ["show-dj-toggle", "showDj"], ["show-rated-toggle", "showRated"], ["stars-lists-toggle", "starsInLists"], ["stars-player-toggle", "starsOnPlayer"], ["viz-extreme-toggle", "vizExtreme"], ["animations-toggle", "animations"], ["show-quiet-toggle", "showQuiet"], ["quiet-art-toggle", "quietArt"], ["quiet-text-toggle", "quietText"], ["quiet-progress-toggle", "quietProgress"], ["quiet-buttons-toggle", "quietButtons"], ["quiet-drift-toggle", "quietDrift"], ["quiet-smooth-toggle", "quietSmooth"]]) {
    const el = $(id); if (el) el.addEventListener("change", () => setAppearance(key, el.checked));
}
for (const [id, key] of [["visualizer-choice", "visualizer"], ["card-size-choice", "cardSize"]]) {
    const el = $(id); if (el) el.addEventListener("click", (e) => { const b = e.target.closest("button[data-value]"); if (b) setAppearance(key, b.dataset.value); });
}
// Picking a rating effect shows it straight away, from the button you tapped.
for (const n of [5, 1]) {
    const el = $(`rate-fx${n}-choice`);
    if (el) el.addEventListener("click", (e) => { const b = e.target.closest("button[data-value]"); if (!b) return; setAppearance("rateFx" + n, b.dataset.value); playRatingEffect(n, b, b.dataset.value); });
}
if ($("theme-new-btn")) $("theme-new-btn").addEventListener("click", () => openThemeEditor(appearance.theme, { fresh: true }));
if ($("theme-paste-btn")) $("theme-paste-btn").addEventListener("click", async () => {
    const code = await showPrompt({ title: "Paste a theme code", message: "Codes start with SPOOTIFY-THEME. You can look it over in the editor before saving.", input: { placeholder: "SPOOTIFY-THEME:...", maxLength: 20000 }, confirmText: "Open" });
    if (!code) return;
    const t = Themes && Themes.decodeTheme(code);
    if (!t) { showToast("That doesn't look like a theme code"); return; }
    openThemeEditor(null, { theme: t });
});

// ── COLOUR PICKER ──
// Prism's own picker for every <input type="color">. It always opens on the colour
// the input already has (Android's system dialog doesn't), and has a hex box, this
// theme's colours, recent picks and an eyedropper where the browser has one. It
// writes back through the input's value + input/change events, so the code listening
// to those inputs can't tell the difference. Settings → Appearance can switch back to
// the system dialog.
const RECENT_COLORS_KEY = "spootify-recent-colors";
const BASIC_COLORS = ["#ffffff", "#9ca3af", "#111111", "#ef4444", "#f97316", "#facc15", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899"];
let colorPop = null, colorState = null, colorClosed = { input: null, at: 0 };
function hexToHsv(hex) {
    const [r, g, b] = Themes.util.hexToRgb(hex).map((v) => v / 255), max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let h = 0;
    if (d) { h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, max ? d / max : 0, max];
}
function hsvToHex(h, s, v) {
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return Themes.util.rgbToHex([f(5) * 255, f(3) * 255, f(1) * 255]);
}
function recentColors() { try { const a = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || "[]"); return Array.isArray(a) ? a.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 10) : []; } catch { return []; } }
function rememberColor(hex) { try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify([hex].concat(recentColors().filter((c) => c !== hex)).slice(0, 10))); } catch {} }
function themeColorSuggestions() {
    const t = editorState ? editorState.theme : currentTheme();
    const list = [t.accent, t.accent2, ...(t.colors || []), ...((t.dots || []).map((d) => d.c)), t.bg, t.text].filter((c) => /^#[0-9a-f]{6}$/i.test(c || "")).map((c) => c.toLowerCase());
    return [...new Set(list)].slice(0, 11);
}
function buildColorPop() {
    const el = document.createElement("div");
    el.className = "cp-pop"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Pick a colour");
    el.innerHTML = `<div class="cp-sv"><div class="cp-knob"></div></div>
        <div class="cp-hue"><div class="cp-knob"></div></div>
        <div class="cp-row">
            <button type="button" class="cp-old" title="Back to the colour you started with" aria-label="Back to the starting colour"></button><span class="cp-new"></span>
            <input type="text" class="cp-hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex colour">
            ${window.EyeDropper ? '<button type="button" class="cp-eye" title="Pick a colour from the screen" aria-label="Eyedropper"><svg viewBox="0 0 24 24"><path d="m14.5 4.5 5 5M17 2.8a2.7 2.7 0 0 1 3.9 3.9L18.5 9 15 5.5l2-2.7ZM15 5.5 5.3 15.2 4 20l4.8-1.3L18.5 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></button>' : ""}
        </div>
        <div class="cp-swatches"></div>
        <div class="cp-actions"><button type="button" class="cp-cancel">Cancel</button><button type="button" class="cp-done">Done</button></div>`;
    document.body.appendChild(el);
    const sv = el.querySelector(".cp-sv"), hue = el.querySelector(".cp-hue"), hex = el.querySelector(".cp-hex");
    const drag = (area, onMove) => {
        area.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            try { area.setPointerCapture(e.pointerId); } catch {}
            const move = (ev) => { const r = area.getBoundingClientRect(); onMove(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); };
            move(e);
            const up = () => { area.removeEventListener("pointermove", move); area.removeEventListener("pointerup", up); area.removeEventListener("pointercancel", up); };
            area.addEventListener("pointermove", move); area.addEventListener("pointerup", up); area.addEventListener("pointercancel", up);
        });
    };
    drag(sv, (x, y) => { if (!colorState) return; colorState.s = x; colorState.v = 1 - y; setPickerColor(null); });
    drag(hue, (x) => { if (!colorState) return; colorState.h = x * 360; setPickerColor(null); });
    hex.addEventListener("input", () => { const v = hex.value.trim().replace(/^#?/, "#"); if (/^#[0-9a-f]{6}$/i.test(v)) setPickerColor(v.toLowerCase(), true); });
    hex.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); closeColorPicker(true); } });
    el.addEventListener("click", (e) => {
        const sw = e.target.closest("[data-color]");
        if (sw) { setPickerColor(sw.dataset.color); return; }
        if (e.target.closest(".cp-old")) { setPickerColor(colorState.start); return; }
        if (e.target.closest(".cp-done")) { closeColorPicker(true); return; }
        if (e.target.closest(".cp-cancel")) { closeColorPicker(false); return; }
        if (e.target.closest(".cp-eye") && window.EyeDropper) new window.EyeDropper().open().then((r) => { if (colorState && r && r.sRGBHex) setPickerColor(r.sRGBHex.toLowerCase()); }).catch(() => {});
    });
    return el;
}
// hex = null: redraw from the h/s/v in colorState (dragging). keepHex: don't rewrite the box being typed in.
function setPickerColor(hex, keepHex) {
    const st = colorState; if (!st) return;
    if (hex) { const [h, s, v] = hexToHsv(hex); if (s > 0 && v > 0) st.h = h; st.s = s; st.v = v; }
    const value = hex || hsvToHex(st.h, st.s, st.v);
    const pop = colorPop;
    pop.querySelector(".cp-sv").style.background = `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${hsvToHex(st.h, 1, 1)})`;
    const knob = pop.querySelector(".cp-sv .cp-knob");
    knob.style.left = `${st.s * 100}%`; knob.style.top = `${(1 - st.v) * 100}%`; knob.style.background = value;
    const hk = pop.querySelector(".cp-hue .cp-knob");
    hk.style.left = `${(st.h / 360) * 100}%`; hk.style.background = hsvToHex(st.h, 1, 1);
    pop.querySelector(".cp-new").style.background = value;
    if (!keepHex) pop.querySelector(".cp-hex").value = value;
    pop.querySelectorAll("[data-color]").forEach((b) => b.classList.toggle("active", b.dataset.color === value));
    if (st.value !== value) {
        st.value = value; st.input.value = value;
        st.input.dispatchEvent(new Event("input", { bubbles: true }));
    }
}
function openColorPicker(input) {
    if (!Themes) return;
    if (!colorPop) colorPop = buildColorPop();
    if (colorState) closeColorPicker(true);
    const start = /^#[0-9a-f]{6}$/i.test(input.value) ? input.value.toLowerCase() : "#000000";
    colorState = { input, start, value: start, h: 0, s: 0, v: 0 };
    const row = (label, colors) => colors.length ? `<div class="cp-sw-row"><span>${label}</span><div>${colors.map((c) => `<button type="button" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div></div>` : "";
    colorPop.querySelector(".cp-swatches").innerHTML = row("Recent", recentColors()) + row("This theme", themeColorSuggestions()) + row("Basics", BASIC_COLORS);
    colorPop.querySelector(".cp-old").style.background = start;
    colorPop.hidden = false;
    setPickerColor(start);
    const mobile = isMobile();
    colorPop.classList.toggle("sheet", mobile);
    if (mobile) { colorPop.style.left = colorPop.style.top = ""; }
    else {
        const r = input.getBoundingClientRect(), w = colorPop.offsetWidth, h = colorPop.offsetHeight;
        colorPop.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
        colorPop.style.top = `${clamp(r.bottom + 8 + h > innerHeight - 8 ? r.top - h - 8 : r.bottom + 8, 8, Math.max(8, innerHeight - h - 8))}px`;
    }
    document.addEventListener("pointerdown", colorOutside, true);
}
function colorOutside(e) { if (colorPop && !colorPop.contains(e.target)) closeColorPicker(true); }
function closeColorPicker(keep) {
    const st = colorState; if (!st) return;
    colorState = null;
    document.removeEventListener("pointerdown", colorOutside, true);
    colorPop.hidden = true;
    colorClosed = { input: st.input, at: performance.now() };
    if (!keep && st.input.value !== st.start) { st.input.value = st.start; st.input.dispatchEvent(new Event("input", { bubbles: true })); }
    if (keep && st.value !== st.start) rememberColor(st.value);
    st.input.dispatchEvent(new Event("change", { bubbles: true }));
}
// Capture phase: catches label clicks too (they arrive as a click on the input).
document.addEventListener("click", (e) => {
    const input = e.target instanceof Element ? e.target.closest('input[type="color"]') : null;
    if (!input || input.disabled || appearance.nativeColorPicker || !Themes) return;
    e.preventDefault();
    if (colorState && colorState.input === input) return;
    if (colorClosed.input === input && performance.now() - colorClosed.at < 350) return; // the tap that closed it
    openColorPicker(input);
}, true);
window.addEventListener("resize", () => { if (colorState && !isMobile()) closeColorPicker(true); });

// ── THEME EDITOR ──
const themeEditor = $("theme-editor");
// { theme (working copy), prevTheme, prevAccent, editing, undo[], redo[], lastKey, lastAt, dot (selected), images[] (added this session) }
let editorState = null;
function hex6(c) { return Themes.util.rgbToHex(Themes.util.hexToRgb(c || "#000000")); }
const EDITOR_COPY_KEYS = ["mode", "style", "bg", "surface", "angle", "gradType", "glass", "glassBlur", "panelOpacity", "accent", "accent2", "text", "font", "colors", "dots", "animate", "speed", "image", "blur", "grain", "vignette", "elements"];
function normaliseEditorTheme(t) {
    t.colors = Array.isArray(t.colors) && t.colors.length ? t.colors.slice(0, Themes.MAX_COLORS) : [t.mode === "light" ? "#e4e8f5" : "#1a1a2e"];
    if (!t.surface) t.surface = t.bg;
    t.dots = Array.isArray(t.dots) ? t.dots : [];
    return t;
}
// opts.fresh: "+ New theme" always makes a new theme (starting from the one in use),
// even when that's one of yours; the pencil on your own theme edits it.
function openThemeEditor(baseId, opts = {}) {
    if (!Themes || !themeEditor) return;
    const base = opts.theme || Themes.findTheme(baseId || appearance.theme);
    const mine = String(base.id).startsWith("custom-");
    const editing = !opts.theme && !opts.fresh && mine;
    const t = normaliseEditorTheme(JSON.parse(JSON.stringify(base)));
    delete t.accentHi; delete t.accentInk; delete t.onAccent; delete t.onAccentIcon;
    if (!editing && !opts.theme) { t.id = "custom-" + Date.now().toString(36); t.name = (mine ? `${base.name} copy` : `${base.name} (mine)`).slice(0, 32); }
    editorState = { theme: t, prevTheme: appearance.theme, prevAccent: appearance.accent, editing, undo: [], redo: [], lastKey: null, lastAt: 0, dot: -1, spot: -1, images: [] };
    closeSettings();
    setText($("theme-editor-title"), editing ? "Edit theme" : opts.theme ? "Shared theme" : "New theme");
    $("te-delete-btn").hidden = !editing; $("te-dup-btn").hidden = !editing;
    $("te-base-row").hidden = editing || !!opts.theme;
    $("te-base").innerHTML = Themes.allThemes().map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join("");
    $("te-base").value = base.id;
    $("te-name").value = t.name;
    $("te-font").innerHTML = Object.entries(Themes.FONTS).map(([k, f]) => `<option value="${k}" style="font-family:${escapeHtml(f.stack)}">${escapeHtml(f.name)}</option>`).join("");
    for (const id of ["te-stage", "te-img-stage"]) { const st = $(id); if (st) st.style.aspectRatio = `${Math.max(0.6, innerWidth / Math.max(1, innerHeight)).toFixed(3)}`; }
    themeEditor.hidden = false;
    fillThemeEditor(); previewThemeEditor();
}

// Sliders, by section: [id, label, min, max, step, get(t), set(t, v), format, default]
const curDot = (t) => (editorState && t.dots[editorState.dot]) || null;
const curSpot = (t) => (editorState && t.image && t.image.spots && t.image.spots[editorState.spot]) || null;
const pct = (v) => `${Math.round(v)}%`;
const TE_SLIDERS = {
    dot: [
        ["te-dot-size", "Size", 5, 80, 1, (t) => curDot(t)?.r, (t, v) => { const d = curDot(t); if (d) d.r = v; }, (v) => String(v), 26],
        ["te-dot-soft", "Blur", 0, 100, 1, (t) => curDot(t)?.s, (t, v) => { const d = curDot(t); if (d) d.s = v; }, pct, 75],
        ["te-dot-opacity", "Strength", 5, 100, 1, (t) => curDot(t)?.o, (t, v) => { const d = curDot(t); if (d) d.o = v; }, pct, 85]
    ],
    anim: [
        ["te-speed", "Speed", 0.25, 3, 0.25, (t) => t.speed, (t, v) => { t.speed = v; }, (v) => `${v}x`, 1],
        ["te-wander", "Wander", 10, 100, 5, (t) => t.wander, (t, v) => { t.wander = v; }, (v) => (v >= 100 ? "Everywhere" : pct(v)), 100]
    ],
    image: [
        ["te-img-zoom", "Zoom", 30, 300, 5, (t) => t.image?.zoom, (t, v) => { if (t.image) t.image.zoom = v; }, pct, 100],
        ["te-img-x", "Left / right", 0, 100, 1, (t) => t.image?.x, (t, v) => { if (t.image) t.image.x = v; }, pct, 50],
        ["te-img-y", "Up / down", 0, 100, 1, (t) => t.image?.y, (t, v) => { if (t.image) t.image.y = v; }, pct, 50],
        ["te-img-opacity", "Opacity", 0, 100, 1, (t) => t.image?.opacity, (t, v) => { if (t.image) t.image.opacity = v; }, pct, 100],
        ["te-img-bright", "Brightness", 10, 200, 1, (t) => t.image?.bright, (t, v) => { if (t.image) t.image.bright = v; }, pct, 100],
        ["te-img-sat", "Colour", 0, 250, 1, (t) => t.image?.sat, (t, v) => { if (t.image) t.image.sat = v; }, pct, 100]
    ],
    spot: [
        ["te-spot-size", "Size", 4, 70, 1, (t) => curSpot(t)?.r, (t, v) => { const s = curSpot(t); if (s) s.r = v; }, (v) => String(v), 20],
        ["te-spot-blur", "Blur", 1, 60, 1, (t) => curSpot(t)?.b, (t, v) => { const s = curSpot(t); if (s) s.b = v; }, (v) => String(v), 12],
        ["te-spot-soft", "Soft edge", 0, 100, 1, (t) => curSpot(t)?.s, (t, v) => { const s = curSpot(t); if (s) s.s = v; }, pct, 60]
    ],
    fx: [
        ["te-blur", "Background blur", 0, 50, 1, (t) => t.blur, (t, v) => { t.blur = v; }, (v) => (v ? String(v) : "Off"), 0],
        ["te-grain", "Grain", 0, 100, 1, (t) => t.grain, (t, v) => { t.grain = v; }, (v) => (v ? pct(v) : "Off"), 0],
        ["te-vignette", "Dark edges", 0, 100, 1, (t) => t.vignette, (t, v) => { t.vignette = v; }, (v) => (v ? pct(v) : "Off"), 0]
    ],
    panels: [
        ["te-glass-blur", "Glass blur", 0, 40, 1, (t) => t.glassBlur, (t, v) => { t.glassBlur = v; }, (v) => (v ? `${v}px` : "Off"), 20],
        ["te-panel-opacity", "Panel opacity", 0, 100, 1, (t) => t.panelOpacity, (t, v) => { t.panelOpacity = v; }, pct, 50]
    ]
};
const TE_SLIDER_INDEX = new Map();
for (const [sec, list] of Object.entries(TE_SLIDERS)) {
    const box = document.querySelector(`#theme-editor [data-sliders="${sec}"]`); if (!box) continue;
    box.innerHTML = list.map(([id, label, min, max, step]) => `<div class="te-row te-slider-row"><label for="${id}">${label}</label><span class="te-slider"><input type="range" id="${id}" class="settings-slider" min="${min}" max="${max}" step="${step}"><output id="${id}-v"></output></span></div>`).join("");
    for (const spec of list) TE_SLIDER_INDEX.set(spec[0], spec);
}
function fillEditorSliders(t) {
    for (const [id, spec] of TE_SLIDER_INDEX) {
        const el = $(id); if (!el) continue;
        const v = spec[5](t), value = Number.isFinite(v) ? v : spec[8];
        if (document.activeElement !== el || Number(el.value) !== value) el.value = value;
        updateSliderFill(el);
        setText($(`${id}-v`), spec[7](value));
    }
}
// Only rebuild the colour chips when their number changes, so an open colour picker keeps its input.
function renderEditorColors(t, classic) {
    const box = $("te-colors"), list = classic ? t.colors.slice(0, 1) : t.colors;
    const key = `${list.length}|${classic}`;
    if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = list.map((c, i) => `<span class="te-chip"><input type="color" data-i="${i}" aria-label="Colour ${i + 1}">${list.length > 1 ? `<button type="button" class="te-chip-x" data-x="${i}" aria-label="Remove colour ${i + 1}">&times;</button>` : ""}</span>`).join("")
            + (!classic && list.length < Themes.MAX_COLORS ? '<button type="button" class="te-chip-add" title="Add a colour" aria-label="Add a colour">+</button>' : "");
    }
    box.querySelectorAll("input[data-i]").forEach((el) => { const v = hex6(list[Number(el.dataset.i)]); if (el.value !== v) el.value = v; });
}
function setColorInput(id, c) { const el = $(id); if (el) { const v = hex6(c); if (el.value !== v) el.value = v; } }
function setHtmlIfChanged(el, html) { if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; } }
function renderDotHandles() {
    const st = editorState, box = $("te-handles"); if (!box) return;
    setHtmlIfChanged(box, st.theme.dots.map((d, i) => `<button type="button" class="te-handle${i === st.dot ? " sel" : ""}" data-i="${i}" style="left:${d.x}%;top:${d.y}%;--c:${hex6(d.c)}" aria-label="Colour dot ${i + 1}"></button>`).join(""));
}
function fillThemeEditor() {
    const st = editorState, t = st.theme, classic = !t.style || t.style === "classic";
    segSet("te-mode", t.mode === "light" ? "light" : "dark");
    segSet("te-style", t.style || "classic");
    renderEditorColors(t, classic);
    $("te-grad-row").hidden = t.style !== "linear";
    segSet("te-grad", t.gradType || "linear");
    const angle = $("te-angle"); angle.value = Number.isFinite(t.angle) ? t.angle : 160; updateSliderFill(angle);
    $("te-angle-row").hidden = t.style !== "linear" || t.gradType === "radial";
    setColorInput("te-bg", t.bg);
    // Dots
    if (st.dot >= t.dots.length) st.dot = -1;
    setText($("te-dots-count"), t.dots.length ? String(t.dots.length) : "");
    renderDotHandles();
    const d = t.dots[st.dot];
    $("te-dot-panel").hidden = !d;
    if (d) setColorInput("te-dot-color", d.c);
    $("te-animate").checked = !!t.animate;
    document.querySelector('#theme-editor [data-sliders="anim"]').hidden = !t.animate;
    $("te-dots-clear").disabled = !t.dots.length;
    // Picture
    const im = t.image;
    $("te-image-opts").hidden = !im; $("te-image-remove").hidden = !im;
    setText($("te-image-badge"), im ? (im.src === "art" ? "song cover" : "on") : "");
    const thumbUrl = im ? (im.src === "art" ? Themes.getArtUrl() : im.thumb) : null;
    $("te-image-thumb").style.backgroundImage = thumbUrl ? `url("${String(thumbUrl).replace(/["\\]/g, "")}")` : "";
    $("te-image-thumb").classList.toggle("empty", !thumbUrl);
    segSet("te-image-fit", im?.fit || "cover");
    const spots = (im && im.spots) || [];
    if (st.spot >= spots.length) st.spot = -1;
    setHtmlIfChanged($("te-spot-handles"), spots.map((sp, i) => `<button type="button" class="te-handle te-spot${i === st.spot ? " sel" : ""}" data-i="${i}" style="left:${sp.x}%;top:${sp.y}%;--r:${sp.r}" aria-label="Blur spot ${i + 1}"></button>`).join(""));
    $("te-spot-panel").hidden = !curSpot(t);
    $("te-spot-add").disabled = spots.length >= Themes.MAX_SPOTS;
    $("te-image-colors").hidden = !im || im.src === "art";
    $("te-image-art").classList.toggle("active", im?.src === "art");
    // Panels
    $("te-glass").checked = !!t.glass && !classic; $("te-glass").disabled = classic;
    document.querySelector('#theme-editor [data-sliders="panels"]').hidden = classic || !t.glass;
    setText($("te-panels-hint"), classic ? "Classic panels are solid. Pick another style to see the background through them." : !t.glass ? "Turn on see-through panels to let the background, dots and picture show behind them." : "");
    // Accent & text
    setColorInput("te-accent", t.accent);
    const blend = !!t.accent2 && t.accent2 !== t.accent;
    $("te-accent2-on").checked = blend;
    setColorInput("te-accent2", t.accent2 || t.accent); $("te-accent2").disabled = !blend;
    const light = t.mode === "light";
    $("te-text-on").checked = !!t.text;
    setColorInput("te-text", t.text || (light ? "#15171c" : "#ffffff")); $("te-text").disabled = !t.text;
    const hard = t.text && Themes.util.contrast(t.text, t.surface || t.bg) < 3;
    $("te-text-hint").hidden = !hard; setText($("te-text-hint"), hard ? "That text colour is hard to read on this background." : "");
    $("te-font").value = t.font || "default";
    renderEditorElements(t);
    fillEditorSliders(t);
    $("te-undo-btn").disabled = !st.undo.length; $("te-redo-btn").disabled = !st.redo.length;
}
// Elements: one box per added element. Rebuilt only when the set changes, so an open
// colour picker keeps its input; otherwise the values are just refreshed.
function renderEditorElements(t) {
    const E = Themes.ELEMENTS, els = t.elements || {}, ids = Object.keys(E).filter((id) => els[id]);
    setText($("te-el-count"), ids.length ? String(ids.length) : "");
    const add = $("te-el-add"), free = Object.keys(E).filter((id) => !els[id]);
    setHtmlIfChanged(add, `<option value="">${free.length ? "+ Add an element..." : "Every element is added"}</option>` + free.map((id) => `<option value="${id}">${escapeHtml(E[id].name)}</option>`).join(""));
    if (add.value) add.value = "";
    add.disabled = !free.length;
    const list = $("te-el-list"), key = ids.join(",");
    if (list.dataset.key !== key) {
        list.dataset.key = key;
        list.innerHTML = ids.map((id) => `<div class="te-el-card" data-el="${id}"><div class="te-el-head"><strong>${escapeHtml(E[id].name)}</strong><button type="button" class="te-el-x" data-remove="${id}">Remove</button></div>`
            + E[id].fields.map(([k, type, label, , x]) => {
                const when = x && x.when ? ` data-when="${x.when}"` : "";
                if (type === "color") return `<div class="te-row"${when}><span>${label}</span><input type="color" data-f="${k}" aria-label="${escapeHtml(E[id].name)} ${label}"></div>`;
                if (type === "toggle") return `<div class="te-row"${when}><span>${label}</span><input type="checkbox" class="settings-switch" data-f="${k}"></div>`;
                if (type === "range") return `<div class="te-row te-slider-row"${when}><span>${label}</span><span class="te-slider"><input type="range" class="settings-slider" data-f="${k}" min="${x.min}" max="${x.max}" step="1"><output></output></span></div>`;
                return `<div class="te-row"${when}><span>${label}</span><div class="segmented" data-f="${k}">${x.options.map(([v, l]) => `<button type="button" data-value="${v}">${l}</button>`).join("")}</div></div>`;
            }).join("") + "</div>").join("");
    }
    for (const card of list.querySelectorAll(".te-el-card")) {
        const id = card.dataset.el, e = els[id], fields = E[id].fields;
        for (const [k, type, , , x] of fields) {
            const el = card.querySelector(`[data-f="${k}"]`); if (!el) continue;
            if (type === "color") { const v = hex6(e[k]); if (el.value !== v) el.value = v; }
            else if (type === "toggle") el.checked = !!e[k];
            else if (type === "range") { el.value = e[k]; updateSliderFill(el); setText(el.nextElementSibling, `${e[k]}${x.unit || ""}`); }
            else el.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === e[k]));
        }
        card.querySelectorAll("[data-when]").forEach((row) => { row.hidden = !e[row.dataset.when]; });
    }
}
// The editor's two preview boxes always show the dots where they are (so the handles line
// up with them); the app behind the editor shows them drifting.
function paintEditorStages(t) {
    Themes.paintLayer($("te-stage-layer"), t, { static: true });
    Themes.paintLayer($("te-img-layer"), t, { static: true });
}
// level: true or 1 = the background layer only; 2 = colours too, during a drag, at most
// about 11 times a second (a colour like the base one restyles every surface and every
// text colour in the app, which a phone can't do on every touch event); 3 = at once.
let editorApplyAt = 0, editorApplyTimer = null;
function previewThemeEditor(level) {
    if (!editorState) return;
    const t = editorState.theme, lvl = level === true ? 1 : typeof level === "number" ? level : 3;
    for (const el of [$("theme-bg"), $("np-theme-bg")]) Themes.paintLayer(el, t);
    paintEditorStages(t);
    if (lvl < 2) return;
    clearTimeout(editorApplyTimer); editorApplyTimer = null;
    const wait = lvl === 2 ? 90 - (performance.now() - editorApplyAt) : 0;
    if (wait > 0) { editorApplyTimer = setTimeout(() => { editorApplyTimer = null; applyEditorColours(); }, wait); return; }
    applyEditorColours();
}
function applyEditorColours() {
    if (!editorState) return;
    editorApplyAt = performance.now();
    markThemeLive();
    Themes.apply(editorState.theme, { ...appearance, accent: null });
    vizColors = null; applyViewTint(); applyTrackTint();
}
// While a theme changes, colour transitions are off (html.theme-live): otherwise every
// element with one starts it again on each step of a drag, all at once.
let themeLiveTimer = null;
function markThemeLive() {
    document.documentElement.classList.add("theme-live");
    clearTimeout(themeLiveTimer);
    themeLiveTimer = setTimeout(() => document.documentElement.classList.remove("theme-live"), 400);
}
// Every change goes through here: one undo step per change, except a run of the same
// control (a slider drag, a colour picker) within a moment, which is merged into one.
// The theme changes at once; the editor and the preview catch up on the next frame, once,
// however many changes came in (a drag on a phone fires far more often than it can draw).
// Through a run of the same control only the slider labels and the preview keep up, and
// the rest of the editor follows once it stops. Levels: 1 = background layer only (moving
// a dot or the picture), 2 = + colours (a slider or colour drag), 3 = everything.
let editorFrame = null, editorNeeds = 0, editorSettle = null;
function queueEditorRender(level) {
    editorNeeds = Math.max(editorNeeds, level);
    if (editorFrame) return;
    editorFrame = requestAnimationFrame(() => {
        editorFrame = null;
        const need = editorNeeds; editorNeeds = 0;
        if (!editorState) return;
        if (need >= 3) fillThemeEditor();
        else if (need === 2) { fillEditorSliders(editorState.theme); renderEditorElements(editorState.theme); syncEditorUndo(); }
        else syncEditorUndo();
        previewThemeEditor(need);
    });
}
function syncEditorUndo() { const st = editorState; if (!st) return; $("te-undo-btn").disabled = !st.undo.length; $("te-redo-btn").disabled = !st.redo.length; }
function editorUpdate(fn, opts = {}) {
    const st = editorState; if (!st) return;
    const now = performance.now();
    if (!(opts.key && opts.key === st.lastKey && now - st.lastAt < 900)) {
        st.undo.push(JSON.stringify(st.theme)); if (st.undo.length > 80) st.undo.shift();
        st.redo = [];
    }
    st.lastKey = opts.key || null; st.lastAt = now;
    fn(st.theme);
    markThemeLive();
    const level = opts.light ? 1 : opts.key ? 2 : 3;
    queueEditorRender(level);
    if (level === 2) { clearTimeout(editorSettle); editorSettle = setTimeout(() => queueEditorRender(3), 260); }
}
function editorUndo(redo) {
    const st = editorState; if (!st) return;
    const from = redo ? st.redo : st.undo, to = redo ? st.undo : st.redo;
    if (!from.length) return;
    to.push(JSON.stringify(st.theme));
    st.theme = normaliseEditorTheme(JSON.parse(from.pop()));
    st.lastKey = null;
    $("te-name").value = st.theme.name;
    fillThemeEditor(); previewThemeEditor();
}
// Dots and pictures only show through see-through panels, so adding one to a Classic theme moves it to Plain.
function ensureLayered(t) {
    if (!t.style || t.style === "classic") { t.style = "plain"; t.glass = true; }
}
function nextDotColor(t) {
    const pool = t.colors.concat(t.accent ? [t.accent] : []);
    return pool[t.dots.length % pool.length] || "#8b5cf6";
}
function scatterDots(t) {
    const pool = t.colors.concat([t.accent, t.accent2].filter(Boolean)), n = 4 + Math.floor(Math.random() * 3);
    return Array.from({ length: n }, (_, i) => ({
        x: Math.round(8 + Math.random() * 84), y: Math.round(8 + Math.random() * 84), c: pool[i % pool.length],
        r: Math.round(18 + Math.random() * 22), s: Math.round(65 + Math.random() * 30), o: Math.round(60 + Math.random() * 30)
    }));
}
// Switching dark <-> light keeps the hues but moves every colour to a sensible brightness.
function adaptThemeMode(t, mode) {
    if ((t.mode === "light" ? "light" : "dark") === mode) return;
    const U = Themes.util, light = mode === "light";
    const shift = (hex, l, sMax) => { const [h, s] = U.hexToHsl(hex); return U.hslToHex(h, Math.min(sMax, s), l); };
    t.mode = mode;
    t.bg = shift(t.bg, light ? 0.965 : 0.05, 0.45); t.surface = t.bg;
    t.colors = t.colors.map((c) => shift(c, light ? 0.86 : 0.3, 0.8));
    t.dots = t.dots.map((d) => ({ ...d, c: shift(d.c, light ? 0.78 : 0.45, 0.85) }));
    t.accent = shift(t.accent, light ? 0.45 : 0.6, 0.9);
    if (t.accent2) t.accent2 = shift(t.accent2, light ? 0.45 : 0.6, 0.9);
    delete t.text;
    if (t.image && t.image.bright != null) t.image.bright = light ? 100 : Math.min(t.image.bright, 85);
}
function randomizeTheme(t) {
    const U = Themes.util, light = t.mode === "light", h = Math.random() * 360, spread = 30 + Math.random() * 60;
    t.style = ["linear", "glow", "aurora", "plain"][Math.floor(Math.random() * 4)];
    t.gradType = Math.random() < 0.75 ? undefined : ["radial", "conic"][Math.floor(Math.random() * 2)];
    t.glass = true;
    t.angle = Math.round(Math.random() * 36) * 10;
    t.colors = light
        ? [U.hslToHex(h, 0.8, 0.86), U.hslToHex(h + spread, 0.75, 0.88), U.hslToHex(h - spread, 0.7, 0.9)]
        : [U.hslToHex(h, 0.7, 0.32), U.hslToHex(h + spread, 0.65, 0.3), U.hslToHex(h - spread, 0.7, 0.26)];
    t.bg = light ? U.hslToHex(h, 0.45, 0.965) : U.hslToHex(h, 0.45, 0.045); t.surface = t.bg;
    const ah = h + 150 + Math.random() * 60;
    t.accent = light ? U.hslToHex(ah, 0.75, 0.45) : U.hslToHex(ah, 0.85, 0.62);
    t.accent2 = Math.random() < 0.7 ? (light ? U.hslToHex(ah + 45, 0.75, 0.45) : U.hslToHex(ah + 45, 0.85, 0.62)) : null;
    t.dots = t.style === "plain" || Math.random() < 0.3 ? scatterDots(t).map((d) => ({ ...d, c: light ? U.hslToHex(U.hexToHsl(d.c)[0], 0.75, 0.75) : U.hslToHex(U.hexToHsl(d.c)[0], 0.75, 0.42) })) : [];
    t.grain = Math.random() < 0.3 ? Math.round(15 + Math.random() * 25) : 0;
    t.vignette = Math.random() < 0.3 ? Math.round(20 + Math.random() * 35) : 0;
    delete t.text;
    randomizeElements(t, h);
    if (editorState) editorState.dot = -1;
}
// The elements a theme has (Theme editor → Elements) get new settings too, picked to suit the
// new colours: text stays readable, tracks stay quiet, everything else draws from the palette.
function randomizeElements(t, hue) {
    if (!t.elements) return;
    const U = Themes.util, E = Themes.ELEMENTS, light = t.mode === "light", pick = (a) => a[Math.floor(Math.random() * a.length)];
    const vivid = () => pick([t.accent, t.accent2 || t.accent, U.hslToHex(hue + rnd(-40, 40), 0.85, light ? 0.5 : 0.62), U.hslToHex(rnd(0, 360), 0.85, light ? 0.48 : 0.64)]);
    const textTone = () => U.hslToHex(hue + rnd(-30, 30), rnd(0.1, 0.35), light ? rnd(0.22, 0.38) : rnd(0.68, 0.84));
    for (const id of Object.keys(t.elements)) {
        const def = E[id]; if (!def) continue;
        const e = { ...t.elements[id] };
        for (const [k, type, , , x] of def.fields) {
            if (type === "color") {
                if (id === "songText") e[k] = textTone();
                else if (k === "track") e[k] = U.hslToHex(hue, 0.15, light ? 0.84 : 0.24);
                else if (k === "thumb" || k === "icon") e[k] = light ? "#ffffff" : pick(["#ffffff", "#000000"]);
                else if (id === "titles" && k === "c") e[k] = light ? U.hslToHex(hue, 0.4, 0.18) : "#ffffff";
                else if (id === "cards" && k === "c") e[k] = pick(["#ffffff", t.colors[0] || t.accent, t.accent]);
                else if (id === "stars" && k === "c") e[k] = pick(["#f5c542", "#ffb347", vivid()]);
                else e[k] = vivid();
            } else if (type === "toggle") {
                e[k] = k === "all" ? e[k] : Math.random() < 0.5; // "All faded text" stays as you set it
            } else if (type === "range") {
                const top = id === "cards" && k === "alpha" ? Math.min(x.max, 22) : x.max; // cards stay see-through enough to read
                e[k] = Math.round(rnd(x.min, top));
            } else if (type === "select") e[k] = pick(x.options)[0];
        }
        t.elements[id] = e;
    }
}
// A few strong colours from a picture: hue buckets weighted by saturation and mid brightness.
function paletteFromImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement("canvas"); c.width = c.height = 40;
                const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 40, 40);
                const d = g.getImageData(0, 0, 40, 40).data, bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
                for (let i = 0; i < d.length; i += 4) {
                    const [h, s, l] = Themes.util.hexToHsl(Themes.util.rgbToHex([d[i], d[i + 1], d[i + 2]]));
                    const w = (0.05 + s * s) * Math.max(0.05, 1 - Math.abs(l - 0.5) * 1.8), bin = bins[Math.floor(h / 30) % 12];
                    bin.w += w; bin.r += d[i] * w; bin.g += d[i + 1] * w; bin.b += d[i + 2] * w;
                }
                resolve(bins.filter((b) => b.w > 0).sort((a, b) => b.w - a.w).slice(0, 3).map((b) => Themes.util.rgbToHex([b.r / b.w, b.g / b.w, b.b / b.w])));
            } catch { resolve([]); }
        };
        img.onerror = () => resolve([]);
        img.src = url;
    });
}
// Big pictures are scaled down (longest side 2400px) so they stay quick to load and small to store.
async function prepareThemeImage(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
        const fit = (max) => { const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)); return [Math.max(1, Math.round(img.naturalWidth * k)), Math.max(1, Math.round(img.naturalHeight * k))]; };
        const draw = ([w, h]) => { const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); return c; };
        const big = draw(fit(2400));
        const blob = await new Promise((resolve) => big.toBlob(resolve, "image/jpeg", 0.88));
        const thumb = draw(fit(48)).toDataURL("image/jpeg", 0.7);
        return blob ? { blob, thumb } : null;
    } catch { return null; } finally { URL.revokeObjectURL(url); }
}
function closeThemeEditor(saved) {
    if (colorState) closeColorPicker(true);
    if (themeEditor) themeEditor.hidden = true;
    if (!editorState) return;
    if (!saved) { appearance.theme = editorState.prevTheme; appearance.accent = editorState.prevAccent; }
    editorState = null;
    markThemeLive(); applyAppearance(); openSettings("appearance");
    if (Themes) Themes.pruneImages();
}
function saveThemeEditor() {
    if (!editorState) return;
    if (colorState) closeColorPicker(true);
    const t = editorState.theme;
    t.name = ($("te-name").value.trim() || "My theme").slice(0, 32);
    if (!t.dots.length) delete t.dots;
    const clean = Themes.sanitizeTheme(t);
    const list = Themes.loadCustom(), i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    if (!Themes.saveCustom(list)) { showToast("Couldn't save the theme: this device's storage is full"); normaliseEditorTheme(t); return; }
    appearance.theme = clean.id; appearance.accent = null;
    editorState = null; themeEditor.hidden = true;
    markThemeLive(); applyAppearance(); openSettings("appearance");
    Themes.pruneImages();
    showToast(`Theme saved · ${clean.name}`);
}
async function deleteEditorTheme() {
    if (!editorState) return;
    const t = editorState.theme;
    if (!(await showPrompt({ title: "Delete theme", message: `Delete "${t.name}"?`, confirmText: "Delete", danger: true }))) return;
    Themes.saveCustom(Themes.loadCustom().filter((x) => x.id !== t.id));
    if (editorState.prevTheme === t.id) editorState.prevTheme = "spootify";
    closeThemeEditor(false);
}
async function copyThemeCode() {
    if (!editorState) return;
    const t = { ...editorState.theme, name: ($("te-name").value.trim() || "My theme").slice(0, 32) };
    const code = Themes.encodeTheme(Themes.sanitizeTheme(t));
    try { await navigator.clipboard.writeText(code); showToast(t.image && t.image.src !== "art" ? "Theme code copied (the picture isn't included)" : "Theme code copied"); }
    catch { await showPrompt({ title: "Theme code", message: "Copy this and send it to someone. They add it with Paste code.", input: { value: code, maxLength: 20000 }, confirmText: "Done", showCancel: false }); }
}
if (themeEditor) {
    const seg = (id, fn) => $(id).addEventListener("click", (e) => { const b = e.target.closest("button[data-value]"); if (b) fn(b.dataset.value); });
    $("te-name").addEventListener("input", (e) => { if (editorState) editorState.theme.name = e.target.value; });
    $("te-base").addEventListener("change", (e) => editorUpdate((t) => {
        const b = JSON.parse(JSON.stringify(Themes.findTheme(e.target.value)));
        for (const k of EDITOR_COPY_KEYS) { if (b[k] === undefined) delete t[k]; else t[k] = b[k]; }
        normaliseEditorTheme(t);
        editorState.dot = -1;
    }));
    seg("te-mode", (v) => editorUpdate((t) => adaptThemeMode(t, v)));
    seg("te-style", (v) => editorUpdate((t) => {
        if ((!t.style || t.style === "classic") && v !== "classic" && t.glass === undefined) t.glass = true;
        if (v !== "classic" && (!t.style || t.style === "classic") && t.colors.length < 2) {
            const U = Themes.util, [h, s, l] = U.hexToHsl(t.colors[0]);
            t.colors.push(U.hslToHex(h + 50, s, l), U.hslToHex(h - 50, s, l));
        }
        t.style = v;
    }));
    seg("te-grad", (v) => editorUpdate((t) => { if (v === "linear") delete t.gradType; else t.gradType = v; }));
    const colors = $("te-colors");
    colors.addEventListener("input", (e) => { const i = Number(e.target.dataset.i); if (e.target.matches("input[data-i]")) editorUpdate((t) => { t.colors[i] = e.target.value; }, { key: "c" + i }); });
    colors.addEventListener("click", (e) => {
        const x = e.target.closest(".te-chip-x");
        if (x) { editorUpdate((t) => { if (t.colors.length > 1) t.colors.splice(Number(x.dataset.x), 1); }); return; }
        if (e.target.closest(".te-chip-add")) editorUpdate((t) => {
            const U = Themes.util, last = t.colors[t.colors.length - 1], [h, s, l] = U.hexToHsl(last);
            t.colors.push(U.hslToHex(h + 40, Math.max(0.35, s), l));
        });
    });
    $("te-angle").addEventListener("input", (e) => editorUpdate((t) => { t.angle = Number(e.target.value); }, { key: "angle" }));
    $("te-bg").addEventListener("input", (e) => editorUpdate((t) => { t.bg = e.target.value; t.surface = e.target.value; }, { key: "bg" }));
    $("te-glass").addEventListener("change", (e) => editorUpdate((t) => { t.glass = e.target.checked; }));
    $("te-accent").addEventListener("input", (e) => editorUpdate((t) => { const blend = t.accent2 && t.accent2 !== t.accent; t.accent = e.target.value; if (!blend) t.accent2 = null; }, { key: "accent" }));
    $("te-accent2-on").addEventListener("change", (e) => editorUpdate((t) => { t.accent2 = e.target.checked ? ($("te-accent2").value !== hex6(t.accent) ? $("te-accent2").value : Themes.util.hslToHex(Themes.util.hexToHsl(t.accent)[0] + 45, 0.8, t.mode === "light" ? 0.45 : 0.62)) : null; }));
    $("te-accent2").addEventListener("input", (e) => editorUpdate((t) => { t.accent2 = e.target.value; }, { key: "accent2" }));
    $("te-text-on").addEventListener("change", (e) => editorUpdate((t) => { if (e.target.checked) t.text = $("te-text").value; else delete t.text; }));
    $("te-text").addEventListener("input", (e) => editorUpdate((t) => { t.text = e.target.value; }, { key: "text" }));
    $("te-font").addEventListener("change", (e) => editorUpdate((t) => { if (e.target.value === "default") delete t.font; else t.font = e.target.value; }));
    // Sliders (double-click / double-tap puts one back to its default)
    for (const [id, spec] of TE_SLIDER_INDEX) {
        const el = $(id);
        el.addEventListener("input", () => editorUpdate((t) => spec[6](t, Number(el.value)), { key: id }));
        el.addEventListener("dblclick", () => editorUpdate((t) => spec[6](t, spec[8])));
    }
    // Dots: tap the stage to add one, drag one to move it, tap one to select it.
    const stage = $("te-stage");
    let dotDrag = null;
    const stagePos = (e) => { const r = stage.getBoundingClientRect(); return [Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * 1000) / 10, Math.round(clamp((e.clientY - r.top) / r.height, 0, 1) * 1000) / 10]; };
    stage.addEventListener("pointerdown", (e) => {
        if (!editorState || (e.button !== undefined && e.button !== 0)) return;
        e.preventDefault();
        const st = editorState, handle = e.target.closest(".te-handle");
        let i;
        if (handle) {
            i = Number(handle.dataset.i);
            if (st.dot !== i) { st.dot = i; fillThemeEditor(); }
        } else {
            if (st.theme.dots.length >= Themes.MAX_DOTS) { showToast(`That's the most dots a theme can have (${Themes.MAX_DOTS})`); return; }
            const [x, y] = stagePos(e);
            editorUpdate((t) => { ensureLayered(t); t.dots.push({ x, y, c: nextDotColor(t), r: 26, s: 75, o: 85 }); st.dot = t.dots.length - 1; });
            i = st.dot; haptic(8);
        }
        dotDrag = { i, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, key: "drag" + Date.now() };
        try { stage.setPointerCapture(e.pointerId); } catch {}
    });
    stage.addEventListener("pointermove", (e) => {
        if (!dotDrag || e.pointerId !== dotDrag.id || !editorState) return;
        if (!dotDrag.moved && Math.hypot(e.clientX - dotDrag.x0, e.clientY - dotDrag.y0) < 4) return;
        dotDrag.moved = true;
        const [x, y] = stagePos(e), i = dotDrag.i;
        editorUpdate((t) => { const d = t.dots[i]; if (d) { d.x = x; d.y = y; } }, { key: dotDrag.key, light: true });
        const h = $("te-handles").querySelector(`.te-handle[data-i="${i}"]`); if (h) { h.style.left = x + "%"; h.style.top = y + "%"; }
    });
    const endDrag = () => { if (dotDrag && dotDrag.moved && editorState) { editorState.lastKey = null; fillThemeEditor(); previewThemeEditor(true); } dotDrag = null; };
    stage.addEventListener("pointerup", endDrag); stage.addEventListener("pointercancel", endDrag);
    $("te-handles").addEventListener("keydown", (e) => {
        const h = e.target.closest(".te-handle"); if (!h || !editorState) return;
        const i = Number(h.dataset.i), step = e.shiftKey ? 5 : 1;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); editorUpdate((t) => { t.dots.splice(i, 1); editorState.dot = -1; }); }
        else if (moves[e.key]) {
            e.preventDefault();
            editorUpdate((t) => { const d = t.dots[i]; d.x = clamp(d.x + moves[e.key][0], 0, 100); d.y = clamp(d.y + moves[e.key][1], 0, 100); }, { key: "key" + i });
            $("te-handles").querySelector(`.te-handle[data-i="${i}"]`)?.focus();
        }
    });
    $("te-dot-color").addEventListener("input", (e) => editorUpdate((t) => { const d = curDot(t); if (d) d.c = e.target.value; }, { key: "dotc" + editorState?.dot }));
    $("te-dot-delete").addEventListener("click", () => editorUpdate((t) => { if (editorState.dot >= 0) t.dots.splice(editorState.dot, 1); editorState.dot = -1; }));
    $("te-dots-scatter").addEventListener("click", () => editorUpdate((t) => { ensureLayered(t); t.dots = scatterDots(t); editorState.dot = -1; }));
    $("te-dots-clear").addEventListener("click", () => editorUpdate((t) => { t.dots = []; editorState.dot = -1; }));
    $("te-animate").addEventListener("change", (e) => editorUpdate((t) => { t.animate = e.target.checked; if (t.animate && !t.dots.length) { ensureLayered(t); t.dots = scatterDots(t); } }));
    // Picture
    $("te-image-choose").addEventListener("click", () => $("te-image-file").click());
    $("te-image-file").addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0]; e.target.value = "";
        if (!file || !editorState) return;
        const prepared = await prepareThemeImage(file);
        if (!prepared) { showToast("Couldn't open that picture"); return; }
        let id;
        try { id = await Themes.putImage(prepared.blob); } catch { showToast("Couldn't store that picture"); return; }
        if (!editorState) return;
        editorState.images.push(id);
        editorUpdate((t) => {
            const keep = t.image && t.image.src !== "art" ? t.image : null;
            t.image = { src: "file", id, thumb: prepared.thumb, fit: keep?.fit || "cover", x: 50, y: 50, zoom: 100, opacity: keep?.opacity ?? 100, bright: keep?.bright ?? (t.mode === "light" ? 100 : 70), sat: keep?.sat ?? 100 };
            ensureLayered(t); t.glass = true;
        });
        const sec = document.querySelector('#theme-editor .te-section[data-sec="image"]'); if (sec) sec.open = true;
    });
    $("te-image-art").addEventListener("click", () => {
        editorUpdate((t) => {
            t.image = { src: "art", fit: "cover", x: 50, y: 50, zoom: 115, opacity: 100, bright: t.mode === "light" ? 100 : 65, sat: 120 };
            if (!t.blur) t.blur = 30;
            ensureLayered(t); t.glass = true;
        });
        if (!Themes.getArtUrl()) showToast("The background will follow the cover of whatever's playing");
    });
    $("te-image-remove").addEventListener("click", () => editorUpdate((t) => { delete t.image; }));
    // Picture stage: drag the picture to move it, drag a ring to move that blur spot.
    const imgStage = $("te-img-stage");
    let imgDrag = null;
    imgStage.addEventListener("pointerdown", (e) => {
        const st = editorState; if (!st || !st.theme.image || (e.button !== undefined && e.button !== 0)) return;
        e.preventDefault();
        const h = e.target.closest(".te-spot"), im = st.theme.image;
        if (h) { const i = Number(h.dataset.i); if (st.spot !== i) { st.spot = i; fillThemeEditor(); } }
        imgDrag = { spot: h ? Number(h.dataset.i) : -1, id: e.pointerId, x0: e.clientX, y0: e.clientY, px: im.x ?? 50, py: im.y ?? 50, key: "img" + Date.now() };
        try { imgStage.setPointerCapture(e.pointerId); } catch {}
    });
    imgStage.addEventListener("pointermove", (e) => {
        if (!imgDrag || e.pointerId !== imgDrag.id || !editorState) return;
        const r = imgStage.getBoundingClientRect(), d = imgDrag;
        if (d.spot >= 0) {
            const x = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * 1000) / 10, y = Math.round(clamp((e.clientY - r.top) / r.height, 0, 1) * 1000) / 10;
            editorUpdate((t) => { const sp = t.image?.spots?.[d.spot]; if (sp) { sp.x = x; sp.y = y; } }, { key: d.key, light: true });
            const h = $("te-spot-handles").querySelector(`[data-i="${d.spot}"]`); if (h) { h.style.left = x + "%"; h.style.top = y + "%"; }
        } else {
            // Dragging right shows more of the left of the picture, so the position goes down.
            const x = clamp(d.px - ((e.clientX - d.x0) / r.width) * 100, 0, 100), y = clamp(d.py - ((e.clientY - d.y0) / r.height) * 100, 0, 100);
            editorUpdate((t) => { if (t.image) { t.image.x = Math.round(x); t.image.y = Math.round(y); } }, { key: d.key, light: true });
        }
    });
    const endImgDrag = () => { if (imgDrag && editorState) { editorState.lastKey = null; fillThemeEditor(); previewThemeEditor(true); } imgDrag = null; };
    imgStage.addEventListener("pointerup", endImgDrag); imgStage.addEventListener("pointercancel", endImgDrag);
    $("te-spot-add").addEventListener("click", () => editorUpdate((t) => {
        if (!t.image) return;
        const spots = t.image.spots || (t.image.spots = []);
        if (spots.length >= Themes.MAX_SPOTS) return;
        spots.push({ x: 50, y: 50, r: 20, b: 12, s: 60 }); editorState.spot = spots.length - 1;
    }));
    $("te-spot-delete").addEventListener("click", () => editorUpdate((t) => { if (t.image?.spots && editorState.spot >= 0) { t.image.spots.splice(editorState.spot, 1); if (!t.image.spots.length) delete t.image.spots; } editorState.spot = -1; }));
    $("te-img-center").addEventListener("click", () => editorUpdate((t) => { if (t.image) { t.image.x = 50; t.image.y = 50; t.image.zoom = 100; } }));
    seg("te-image-fit", (v) => editorUpdate((t) => { if (t.image) t.image.fit = v; }));
    $("te-image-colors").addEventListener("click", async () => {
        const im = editorState?.theme.image; if (!im || !im.thumb) return;
        const pal = await paletteFromImage(im.thumb);
        if (!pal.length || !editorState) { showToast("Couldn't find colours in that picture"); return; }
        editorUpdate((t) => {
            const U = Themes.util, light = t.mode === "light", [h0] = U.hexToHsl(pal[0]);
            t.accent = light ? U.hslToHex(h0, 0.75, 0.42) : U.hslToHex(h0, 0.85, 0.62);
            t.accent2 = pal[1] ? (light ? U.hslToHex(U.hexToHsl(pal[1])[0], 0.75, 0.42) : U.hslToHex(U.hexToHsl(pal[1])[0], 0.85, 0.62)) : null;
            t.colors = pal.map((c) => U.hslToHex(U.hexToHsl(c)[0], 0.7, light ? 0.85 : 0.3));
            t.bg = light ? U.hslToHex(h0, 0.4, 0.965) : U.hslToHex(h0, 0.45, 0.05); t.surface = t.bg;
            delete t.text;
        });
        showToast("Colours matched to the picture");
    });
    // Elements
    $("te-el-add").addEventListener("change", (e) => {
        const id = e.target.value; if (!id) return;
        editorUpdate((t) => { t.elements = { ...(t.elements || {}), [id]: Themes.elementDefaults(id, t) }; });
        $("te-el-list").querySelector(`[data-el="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    const elList = $("te-el-list");
    const setField = (target, value, key) => {
        const card = target.closest(".te-el-card"); if (!card) return;
        const id = card.dataset.el, f = target.closest("[data-f]").dataset.f;
        editorUpdate((t) => { if (t.elements && t.elements[id]) t.elements[id][f] = value; }, key ? { key: `el-${id}-${f}` } : {});
    };
    elList.addEventListener("input", (e) => {
        const t = e.target;
        if (t.matches('input[type="color"][data-f]')) setField(t, t.value, true);
        else if (t.matches('input[type="range"][data-f]')) setField(t, Number(t.value), true);
    });
    elList.addEventListener("change", (e) => { if (e.target.matches('input[type="checkbox"][data-f]')) setField(e.target, e.target.checked); });
    elList.addEventListener("click", (e) => {
        const rm = e.target.closest("[data-remove]");
        if (rm) { editorUpdate((t) => { const els = { ...(t.elements || {}) }; delete els[rm.dataset.remove]; if (Object.keys(els).length) t.elements = els; else delete t.elements; }); return; }
        const b = e.target.closest(".segmented[data-f] button"); if (b) setField(b, b.dataset.value);
    });
    // Tools
    $("te-undo-btn").addEventListener("click", () => editorUndo(false));
    $("te-redo-btn").addEventListener("click", () => editorUndo(true));
    themeEditor.addEventListener("keydown", (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.target.matches("input[type=text], select")) return;
        if (e.key.toLowerCase() === "z") { e.preventDefault(); editorUndo(e.shiftKey); }
        else if (e.key.toLowerCase() === "y") { e.preventDefault(); editorUndo(true); }
    });
    $("te-random-btn").addEventListener("click", () => editorUpdate(randomizeTheme));
    $("te-code-btn").addEventListener("click", copyThemeCode);
    $("te-dup-btn").addEventListener("click", () => {
        const st = editorState; if (!st) return;
        st.editing = false;
        st.theme.id = "custom-" + Date.now().toString(36);
        st.theme.name = `${($("te-name").value.trim() || st.theme.name)} copy`.slice(0, 32);
        $("te-name").value = st.theme.name;
        setText($("theme-editor-title"), "New theme");
        $("te-delete-btn").hidden = true; $("te-dup-btn").hidden = true;
        showToast("Editing a copy. The original stays as it was.");
    });
    $("te-save-btn").addEventListener("click", saveThemeEditor);
    $("te-cancel-btn").addEventListener("click", () => closeThemeEditor(false));
    $("te-close-btn").addEventListener("click", () => closeThemeEditor(false));
    $("te-delete-btn").addEventListener("click", deleteEditorTheme);
}

// ── ALBUM-ART COLOURS ──
// The cover's dominant colour (saturated, mid-bright pixels weigh most) tints the
// playlist header, the full-screen player and the mini player.
const artColorCache = new Map();
function getArtColor(url) {
    if (!url || url === DEFAULT_ART) return Promise.resolve(null);
    if (url === "liked") return Promise.resolve([74, 31, 214]);
    if (artColorCache.has(url)) return artColorCache.get(url);
    const p = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement("canvas"); c.width = c.height = 24;
                const g = c.getContext("2d", { willReadFrequently: true });
                g.drawImage(img, 0, 0, 24, 24);
                const d = g.getImageData(0, 0, 24, 24).data;
                let r = 0, gg = 0, b = 0, w = 0;
                for (let i = 0; i < d.length; i += 4) {
                    const R = d[i], G = d[i + 1], B = d[i + 2], max = Math.max(R, G, B), min = Math.min(R, G, B);
                    const l = (max + min) / 510, s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
                    const wt = (0.08 + s * s) * Math.max(0.05, 1 - Math.abs(l - 0.5) * 1.7) * (d[i + 3] / 255);
                    r += R * wt; gg += G * wt; b += B * wt; w += wt;
                }
                resolve(w > 0 ? [r / w, gg / w, b / w] : null);
            } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
    artColorCache.set(url, p);
    return p;
}
function tintFromRgb(rgb, light) {
    const U = Themes.util, [h, s, l] = U.hexToHsl(U.rgbToHex(rgb));
    return light ? U.hslToHex(h, Math.min(0.8, s * 0.9 + 0.12), 0.85) : U.hslToHex(h, Math.min(0.72, s), clamp(l * 0.75, 0.2, 0.33));
}
function viewCoverUrl() {
    if (isLikedSource(currentPlaylist)) return "liked";
    const pl = playlists[currentPlaylist]; if (!pl) return null;
    if (pl.art && pl.art !== DEFAULT_ART) return pl.art;
    return autoCoverArts(pl)[0] || null;
}
let viewTintToken = 0, trackTintToken = 0;
function applyViewTint() {
    if (!mainContent || !Themes) return;
    const token = ++viewTintToken;
    const url = appearance.artColors && playlistView && playlistView.style.display !== "none" ? viewCoverUrl() : null;
    if (!url) { mainContent.style.removeProperty("--view-tint"); return; }
    getArtColor(url).then((rgb) => {
        if (token !== viewTintToken) return;
        if (!rgb) { mainContent.style.removeProperty("--view-tint"); return; }
        const light = document.documentElement.dataset.mode === "light", classic = document.documentElement.dataset.style === "classic";
        const tint = tintFromRgb(rgb, light);
        mainContent.style.setProperty("--view-tint", classic ? tint : Themes.util.rgba(tint, light ? 0.8 : 0.62));
    });
}
function applyTrackTint() {
    if (!Themes) return;
    Themes.setArtUrl(currentTrack && currentTrack.art && currentTrack.art !== DEFAULT_ART ? currentTrack.art : null);
    const token = ++trackTintToken;
    const url = appearance.artColors && currentTrack ? currentTrack.art : null;
    const clear = () => { nowPlayingScreen?.style.removeProperty("--np-tint"); mobileMiniPlayer?.style.removeProperty("--mini-tint"); };
    if (!url || url === DEFAULT_ART) { clear(); return; }
    getArtColor(url).then((rgb) => {
        if (token !== trackTintToken) return;
        if (!rgb) { clear(); return; }
        const light = document.documentElement.dataset.mode === "light", tint = tintFromRgb(rgb, light);
        nowPlayingScreen?.style.setProperty("--np-tint", tint);
        scheduleMiniState();
        mobileMiniPlayer?.style.setProperty("--mini-tint", Themes.util.rgba(tint, light ? 0.6 : 0.55));
    });
}

// ── VISUALIZER ──
// Bars or a flowing wave drawn from the audio graph's analyser: behind the desktop
// player bar, and under the cover in the full-screen player. It only draws while
// music plays and the canvas is on screen.
let vizFrame = null, vizColors = null, vizData = null;
function vizEnabled() { return !!appearance.visualizer && appearance.visualizer !== "off"; }
function vizTargets() {
    if (document.visibilityState !== "visible" || isQuietOpen()) return [];
    const el = isMobile() ? (isNowPlayingOpen() ? $("np-visualizer") : null) : $("bar-visualizer");
    return el ? [el] : [];
}
function clearVisualizers() {
    for (const id of ["np-visualizer", "bar-visualizer"]) { const c = $(id); if (c && c.width) c.getContext("2d").clearRect(0, 0, c.width, c.height); }
}
// "Extreme" (Settings → Appearance): the same visualizer, bigger. Every band is scaled up
// and its movement exaggerated around where it's been sitting (so what moves moves further
// and what's steady stays steady), a little snappier, and taller on the full-screen player.
function applyVizTuning() {
    if (!analyser) return;
    analyser.smoothingTimeConstant = appearance.vizExtreme ? 0.68 : 0.8;
}
function kickVisualizer() {
    if (vizFrame) return;
    if (!vizEnabled() || !analyser || !isAudiblyPlaying() || !vizTargets().length) { clearVisualizers(); return; }
    vizFrame = requestAnimationFrame(drawVisualizer);
}
function drawVisualizer() {
    vizFrame = null;
    const targets = vizTargets();
    if (!vizEnabled() || !analyser || !isAudiblyPlaying() || !targets.length) { clearVisualizers(); return; }
    if (!vizData || vizData.length !== analyser.frequencyBinCount) vizData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(vizData);
    if (!vizColors) {
        const cs = getComputedStyle(document.documentElement);
        vizColors = [cs.getPropertyValue("--accent").trim() || "#1DB954", cs.getPropertyValue("--accent-2").trim() || "#1DB954"];
    }
    for (const c of targets) drawVizCanvas(c);
    vizFrame = requestAnimationFrame(drawVisualizer);
}
// Log-spaced bands so bass, mids and highs each get a fair share of the width.
// avg (extreme only): each band's recent level, kept per canvas.
function vizBands(count, avg) {
    const bins = vizData.length, lo = 1, hi = Math.floor(bins * 0.72), out = new Array(count);
    for (let i = 0; i < count; i++) {
        const a = Math.floor(lo * Math.pow(hi / lo, i / count)), b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (i + 1) / count)));
        let v = 0;
        for (let j = a; j < b && j < bins; j++) if (vizData[j] > v) v = vizData[j];
        const n = Math.pow(v / 255, 1.4);
        if (avg) { avg[i] += (n - avg[i]) * 0.06; out[i] = clamp(n * 1.15 + (n - avg[i]) * 1.5, 0, 1); }
        else out[i] = n;
    }
    return out;
}
function drawVizCanvas(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const bar = canvas.id === "bar-visualizer", extreme = !!appearance.vizExtreme;
    const count = bar ? clamp(Math.floor(w / 9), 24, 140) : clamp(Math.floor(w / 7), 24, 72);
    let avg = null;
    if (extreme) { avg = canvas.__avg; if (!avg || avg.length !== count) avg = canvas.__avg = new Float32Array(count).fill(0.2); }
    const values = vizBands(count, avg);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, vizColors[0]); grad.addColorStop(1, vizColors[1]);
    ctx.fillStyle = grad;
    if (appearance.visualizer === "wave") drawVizWave(ctx, values, w, h, !bar, extreme);
    else drawVizBars(ctx, values, w, h, !bar, extreme);
}
function drawVizBars(ctx, values, w, h, centred, extreme) {
    // Behind the player bar the bars stay in the lower part, clear of the song title
    // (extreme lets them reach almost to the top).
    const n = values.length, slot = w / n, bw = Math.max(1, slot * 0.62), r = Math.min(bw / 2, 3);
    const reach = centred ? (extreme ? 1 : 0.96) : (extreme ? 0.95 : 0.72);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const bh = Math.max(2, values[i] * h * reach), x = i * slot + (slot - bw) / 2, y = centred ? (h - bh) / 2 : h - bh;
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, r); else ctx.rect(x, y, bw, bh);
    }
    ctx.fill();
}
function drawVizWave(ctx, values, w, h, centred, extreme) {
    const n = values.length, step = w / (n - 1), mid = h / 2, reach = extreme ? 0.95 : 0.72;
    const pts = values.map((v, i) => [i * step, centred ? mid - v * mid * 0.95 : h - v * h * reach]);
    const curve = (list) => {
        for (let i = 1; i < list.length - 1; i++) {
            const xc = (list[i][0] + list[i + 1][0]) / 2, yc = (list[i][1] + list[i + 1][1]) / 2;
            ctx.quadraticCurveTo(list[i][0], list[i][1], xc, yc);
        }
        const last = list[list.length - 1]; ctx.lineTo(last[0], last[1]);
    };
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    curve(pts);
    if (centred) {
        const bottom = pts.map(([x, y]) => [x, h - y]).reverse();
        ctx.lineTo(bottom[0][0], bottom[0][1]);
        curve(bottom);
    } else { ctx.lineTo(w, h); ctx.lineTo(0, h); }
    ctx.closePath();
    ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
}

// ══════════════════════════════════════════════
// ── AUDIO TRIMMER ──
// Shows the whole song as a waveform with a selection window over it; drag the left
// and right edges inward to cut the parts outside, drag the middle to slide the
// window. Saving decodes the audio, cuts it to the selection and re-encodes it to
// MP3 (lamejs in a worker), then either replaces the song's media everywhere it
// appears (stats follow it) or adds the cut as a separate song.
// ══════════════════════════════════════════════
const trimEls = {
    overlay: $("trim-overlay"), title: $("trim-title"), artist: $("trim-artist"), wrap: $("trim-wave-wrap"), canvas: $("trim-canvas"),
    win: $("trim-window"), left: $("trim-handle-left"), right: $("trim-handle-right"), playhead: $("trim-playhead"),
    start: $("trim-start"), end: $("trim-end"), length: $("trim-length"), status: $("trim-status"), progress: $("trim-progress"), fill: $("trim-progress-fill"),
    preview: $("trim-preview-btn"), save: $("trim-save-btn"), cancel: $("trim-cancel-btn"), close: $("trim-close-btn"), keep: $("trim-keep-original"), reset: $("trim-reset-btn")
};
const TRIM_MIN_LENGTH = 1; // seconds
let trim = null;         // { song, playlistName, blob, duration, peaks, start, end }
let trimBusy = false;
const previewPlayer = new Audio();
let previewFrame = null;

function fmtTrimTime(s) { s = Math.max(0, s || 0); const m = Math.floor(s / 60), sec = s - m * 60; return `${m}:${sec < 10 ? "0" : ""}${sec.toFixed(1)}`; }
function trimSetStatus(msg, kind = "") { if (trimEls.status) { trimEls.status.textContent = msg || ""; trimEls.status.className = "yt-status" + (kind ? " " + kind : ""); } }
function trimSetProgress(fraction, show = true) {
    if (!trimEls.progress) return;
    trimEls.progress.style.display = show ? "flex" : "none";
    if (trimEls.fill) trimEls.fill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + "%";
}
function trimSetBusy(busy) {
    trimBusy = busy;
    [trimEls.save, trimEls.preview, trimEls.reset, trimEls.keep].forEach((b) => { if (b) b.disabled = busy || !trim?.peaks; });
    if (trimEls.wrap) trimEls.wrap.classList.toggle("busy", busy);
}

async function openTrimmer(songId) {
    if (!trimEls.overlay) return;
    const found = findSongById(songId);
    if (!found || !found.song.mediaId) { showMessage("Can't trim this song", "The audio for this song isn't stored in the library."); return; }
    stopTrimPreview();
    trim = { song: found.song, playlistName: found.playlistName, blob: null, duration: found.song.duration || 0, peaks: null, start: 0, end: found.song.duration || 0 };
    trimEls.title.textContent = found.song.title || "Unknown";
    trimEls.artist.textContent = found.song.artist || "Unknown Artist";
    if (trimEls.keep) trimEls.keep.checked = false;
    trimSetStatus("Loading waveform…"); trimSetProgress(0, false);
    trimEls.overlay.style.display = "flex";
    trimSetBusy(true);
    drawTrimWave(); updateTrimUi();
    try {
        const blob = await getBlob(found.song.mediaId);
        if (!blob) throw new Error("Audio not found");
        const { peaks, duration } = await computePeaks(blob, 1400);
        if (trim?.song !== found.song) return; // closed / reopened meanwhile
        trim.blob = blob; trim.peaks = peaks; trim.duration = duration; trim.start = 0; trim.end = duration;
        trimSetStatus("Drag the edges of the green window to choose what to keep.");
        trimSetBusy(false);
        drawTrimWave(); updateTrimUi();
    } catch (e) {
        console.error("Trim load failed", e);
        trimSetStatus("Couldn't decode this audio file.", "error");
        trimSetBusy(false); if (trimEls.save) trimEls.save.disabled = true;
    }
}
function closeTrimmer() {
    stopTrimPreview();
    if (trimEls.overlay) trimEls.overlay.style.display = "none";
    trim = null;
}
async function computePeaks(blob, buckets) { return peaksFromAudio(await decodeLowRate(blob), buckets); }
function peaksFromAudio(audio, buckets) {
    const data = audio.getChannelData(0), per = data.length / buckets, peaks = new Float32Array(buckets);
    let max = 0;
    for (let b = 0; b < buckets; b++) {
        const s = Math.floor(b * per), e = Math.min(data.length, Math.floor((b + 1) * per));
        let m = 0; for (let i = s; i < e; i++) { const v = data[i] < 0 ? -data[i] : data[i]; if (v > m) m = v; }
        peaks[b] = m; if (m > max) max = m;
    }
    if (max > 0) for (let b = 0; b < buckets; b++) peaks[b] /= max;
    return { peaks, duration: audio.duration };
}
function drawTrimWave() {
    const c = trimEls.canvas, wrap = trimEls.wrap; if (!c || !wrap || !trim) return;
    const dpr = window.devicePixelRatio || 1, w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    const peaks = trim.peaks, cs = getComputedStyle(document.documentElement);
    const accentRgb = cs.getPropertyValue("--accent-rgb").trim() || "30, 215, 96", fgRgb = cs.getPropertyValue("--fg-rgb").trim() || "255, 255, 255";
    if (!peaks) { ctx.fillStyle = `rgba(${fgRgb}, 0.08)`; ctx.fillRect(0, h / 2 - 1, w, 2); return; }
    const selL = (trim.start / trim.duration) * w, selR = (trim.end / trim.duration) * w;
    const mid = h / 2, bars = peaks.length, step = w / bars;
    for (let i = 0; i < bars; i++) {
        const x = i * step, inSel = x + step / 2 >= selL && x + step / 2 <= selR;
        const amp = Math.max(1, peaks[i] * (h * 0.46));
        ctx.fillStyle = inSel ? `rgba(${accentRgb}, 0.85)` : `rgba(${fgRgb}, 0.22)`;
        ctx.fillRect(x, mid - amp, Math.max(1, step - 0.6), amp * 2);
    }
}
function updateTrimUi() {
    if (!trim) return;
    const d = trim.duration || 1;
    if (trimEls.win) { trimEls.win.style.left = (trim.start / d * 100) + "%"; trimEls.win.style.width = ((trim.end - trim.start) / d * 100) + "%"; }
    if (trimEls.start) trimEls.start.textContent = fmtTrimTime(trim.start);
    if (trimEls.end) trimEls.end.textContent = fmtTrimTime(trim.end);
    if (trimEls.length) trimEls.length.textContent = fmtTrimTime(trim.end - trim.start);
    const cut = (trim.start > 0.05 || trim.end < trim.duration - 0.05);
    if (trimEls.save) trimEls.save.disabled = trimBusy || !trim.peaks || !cut;
    if (trimEls.reset) trimEls.reset.disabled = trimBusy || !cut;
}
function setTrimRange(start, end) {
    if (!trim) return;
    const d = trim.duration;
    start = Math.max(0, Math.min(start, d - TRIM_MIN_LENGTH)); end = Math.max(start + TRIM_MIN_LENGTH, Math.min(end, d));
    trim.start = start; trim.end = end;
    updateTrimUi(); drawTrimWave();
}
// Dragging: the handles move one edge, the window body slides both together.
function attachTrimDrag(el, mode) {
    if (!el) return;
    let startX = 0, s0 = 0, e0 = 0, active = false;
    el.addEventListener("pointerdown", (e) => {
        if (!trim?.peaks || trimBusy) return;
        if (mode === "body" && e.target !== el) return;
        active = true; startX = e.clientX; s0 = trim.start; e0 = trim.end;
        el.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
        stopTrimPreview();
    });
    el.addEventListener("pointermove", (e) => {
        if (!active || !trim) return;
        const rect = trimEls.wrap.getBoundingClientRect();
        const dt = (e.clientX - startX) / rect.width * trim.duration;
        if (mode === "left") setTrimRange(Math.min(s0 + dt, e0 - TRIM_MIN_LENGTH), e0);
        else if (mode === "right") setTrimRange(s0, Math.max(e0 + dt, s0 + TRIM_MIN_LENGTH));
        else { const len = e0 - s0; let ns = s0 + dt; ns = Math.max(0, Math.min(ns, trim.duration - len)); setTrimRange(ns, ns + len); }
    });
    const stop = (e) => { if (active) { active = false; try { el.releasePointerCapture(e.pointerId); } catch {} } };
    el.addEventListener("pointerup", stop); el.addEventListener("pointercancel", stop);
}
attachTrimDrag(trimEls.left, "left"); attachTrimDrag(trimEls.right, "right"); attachTrimDrag(trimEls.win, "body");
// Tap on the waveform outside the window: move the nearest edge there.
if (trimEls.wrap) trimEls.wrap.addEventListener("pointerdown", (e) => {
    if (!trim?.peaks || trimBusy || e.target !== trimEls.canvas) return;
    const rect = trimEls.wrap.getBoundingClientRect();
    const t = (e.clientX - rect.left) / rect.width * trim.duration;
    if (Math.abs(t - trim.start) < Math.abs(t - trim.end)) setTrimRange(t, trim.end); else setTrimRange(trim.start, t);
});
document.querySelectorAll(".trim-nudge").forEach((btn) => btn.addEventListener("click", () => {
    if (!trim) return;
    const edge = btn.dataset.edge, delta = parseFloat(btn.dataset.delta) || 0;
    if (edge === "start") setTrimRange(trim.start + delta, trim.end); else setTrimRange(trim.start, trim.end + delta);
}));
window.addEventListener("resize", () => { if (trim && trimEls.overlay.style.display !== "none") drawTrimWave(); });

// Preview plays just the selection through a separate element (not the effects graph).
async function toggleTrimPreview() {
    if (!trim?.peaks) return;
    if (!previewPlayer.paused) { stopTrimPreview(); return; }
    if (!trim.song.fileSrc && trim.song.mediaId) trim.song.fileSrc = await getBlobUrl(trim.song.mediaId);
    if (!trim.song.fileSrc) return;
    if (!audioPlayer.paused) { pausePlayback(); updatePlayPauseIcon(); updateMediaSessionMetadata(); }
    if (previewPlayer.src !== trim.song.fileSrc) previewPlayer.src = trim.song.fileSrc;
    const begin = () => {
        previewPlayer.currentTime = trim.start;
        previewPlayer.play().then(() => {
            trimEls.preview.textContent = "Stop"; trimEls.playhead.style.display = "block";
            const tick = () => {
                if (!trim || previewPlayer.paused) return;
                if (previewPlayer.currentTime >= trim.end) { stopTrimPreview(); return; }
                trimEls.playhead.style.left = (previewPlayer.currentTime / trim.duration * 100) + "%";
                previewFrame = requestAnimationFrame(tick);
            };
            tick();
        }).catch(() => stopTrimPreview());
    };
    if (previewPlayer.readyState >= 1) begin(); else previewPlayer.addEventListener("loadedmetadata", begin, { once: true });
}
function stopTrimPreview() {
    if (previewFrame) { cancelAnimationFrame(previewFrame); previewFrame = null; }
    if (!previewPlayer.paused) previewPlayer.pause();
    if (trimEls.preview) trimEls.preview.textContent = "Preview";
    if (trimEls.playhead) trimEls.playhead.style.display = "none";
}
previewPlayer.addEventListener("ended", stopTrimPreview);

// MP3 encoding in a worker so the UI (and playback) stay smooth; falls back to the
// main thread if workers can't be created here.
let lameLoaded = null;
function loadLameOnMainThread() {
    if (window.lamejs) return Promise.resolve();
    if (lameLoaded) return lameLoaded;
    lameLoaded = new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = "lame.min.js"; s.onload = resolve; s.onerror = () => reject(new Error("Encoder failed to load")); document.head.appendChild(s); });
    return lameLoaded;
}
function encodeMp3({ left, right, sampleRate, kbps }, onProgress) {
    return new Promise((resolve, reject) => {
        let worker = null;
        try { worker = new Worker("trim-worker.js"); } catch { worker = null; }
        if (!worker) { encodeMp3MainThread({ left, right, sampleRate, kbps }, onProgress).then(resolve, reject); return; }
        let settled = false;
        worker.onmessage = (e) => {
            const m = e.data;
            if (m.progress !== undefined) { onProgress(m.progress); return; }
            if (m.error) { settled = true; worker.terminate(); reject(new Error(m.error)); return; }
            if (m.done) { settled = true; worker.terminate(); resolve(m.parts); }
        };
        worker.onerror = (err) => {
            worker.terminate();
            if (settled) return; settled = true;
            console.warn("Trim worker failed, encoding on the main thread", err);
            encodeMp3MainThread({ left, right, sampleRate, kbps }, onProgress).then(resolve, reject);
        };
        const l = left.slice(0), r = right ? right.slice(0) : null; // keep our copies; the worker gets its own
        worker.postMessage({ left: l, right: r, sampleRate, kbps }, r ? [l.buffer, r.buffer] : [l.buffer]);
    });
}
async function encodeMp3MainThread({ left, right, sampleRate, kbps }, onProgress) {
    await loadLameOnMainThread();
    const channels = right ? 2 : 1;
    const enc = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
    const toInt16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = f[i] * 32767; o[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v; } return o; };
    const l = toInt16(left), r = right ? toInt16(right) : null;
    const block = 1152 * 20, parts = [];
    for (let i = 0; i < l.length; i += block) {
        const buf = channels === 2 ? enc.encodeBuffer(l.subarray(i, i + block), r.subarray(i, i + block)) : enc.encodeBuffer(l.subarray(i, i + block));
        if (buf.length) parts.push(new Uint8Array(buf));
        if ((i / block) % 8 === 0) { onProgress(i / l.length); await new Promise((r2) => setTimeout(r2, 0)); }
    }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
    return parts;
}

// Swap one media blob for another everywhere it's referenced; listening stats follow.
function replaceMediaEverywhere(oldId, newId, url, duration) {
    const stamp = (s) => { if (s && s.mediaId === oldId) { s.mediaId = newId; s.fileSrc = url; s.duration = duration; } };
    for (const pl of Object.values(playlists)) for (const s of pl.songs || []) stamp(s);
    for (const item of queue) stamp(item?.song);
    stamp(currentTrack); stamp(contextTrack);
    moveMediaRecords(oldId, newId);
    saveListenStats(true); saveListenLog(true);
    if (statsSession && statsSession.key === oldId) statsSession.key = newId;
    for (const [mid, u] of [...blobUrlCache]) if (mid === oldId) { try { URL.revokeObjectURL(u); } catch {} blobUrlCache.delete(mid); }
}
async function saveTrim() {
    if (!trim?.peaks || !trim.blob || trimBusy) return;
    stopTrimPreview();
    const { song, blob, start, end, playlistName } = trim, keepOriginal = !!trimEls.keep?.checked;
    trimSetBusy(true); trimSetProgress(0); trimSetStatus("Decoding audio…");
    try {
        const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const off = new Off(2, 44100, 44100);
        const bytes = await blob.arrayBuffer();
        const audio = await new Promise((resolve, reject) => { const p = off.decodeAudioData(bytes, resolve, reject); if (p && p.then) p.then(resolve, reject); });
        const rate = audio.sampleRate, s = Math.max(0, Math.floor(start * rate)), e = Math.min(audio.length, Math.floor(end * rate));
        if (e - s < rate * 0.5) throw new Error("Selection too short");
        const left = audio.getChannelData(0).slice(s, e);
        const right = audio.numberOfChannels > 1 ? audio.getChannelData(1).slice(s, e) : null;
        const newDuration = (e - s) / rate;
        trimSetStatus("Encoding MP3…");
        const parts = await encodeMp3({ left, right, sampleRate: rate, kbps: right ? 192 : 128 }, (p) => { trimSetProgress(p); trimSetStatus(`Encoding MP3… ${Math.round(p * 100)}%`); });
        trimSetProgress(1); trimSetStatus("Saving…");
        const newBlob = new Blob(parts, { type: "audio/mpeg" });
        const newId = await storeBlob(newBlob);
        const newUrl = await getBlobUrl(newId);
        if (keepOriginal) {
            const target = playlists[playlistName] || playlists[currentPlaylist];
            if (target) target.songs.push({ ...song, id: newSongId(), timestamp: Date.now(), title: `${song.title} (trimmed)`, mediaId: newId, fileSrc: newUrl, duration: newDuration });
        } else {
            const oldId = song.mediaId;
            const isPlaying = currentTrack && currentTrack.mediaId === oldId;
            const wasPlaying = isPlaying && !audioPlayer.paused;
            const pos = isPlaying ? Math.max(0, Math.min(newDuration - 0.5, audioPlayer.currentTime - start)) : 0;
            replaceMediaEverywhere(oldId, newId, newUrl, newDuration);
            if (isPlaying) {
                cancelCrossfade();
                loadTrackInto(audioPlayer, currentTrack);
                audioPlayer.addEventListener("loadedmetadata", () => { audioPlayer.currentTime = pos; updateProgressUi(); }, { once: true });
                if (wasPlaying) safePlay();
                afterTrackChange();
            }
        }
        await saveLibrary();
        renderSongs(); renderPlaylists(); renderQueue(); if (typeof renderNpQueue === "function") renderNpQueue();
        refreshStatsUi(); if (artistCurrent !== null) renderArtistPage();
        gcUnreferencedBlobs();
        showToast(keepOriginal ? "Trimmed copy added" : `Trimmed · ${song.title}`);
        closeTrimmer();
    } catch (err) {
        console.error("Trim failed", err);
        trimSetStatus("Trim failed: " + errorText(err), "error");
        trimSetProgress(0, false);
    } finally { trimSetBusy(false); if (trim) updateTrimUi(); }
}
if (trimEls.overlay) {
    trimEls.save.addEventListener("click", saveTrim);
    trimEls.preview.addEventListener("click", toggleTrimPreview);
    trimEls.reset.addEventListener("click", () => { if (trim) setTrimRange(0, trim.duration); });
    trimEls.cancel.addEventListener("click", () => { if (!trimBusy) closeTrimmer(); });
    trimEls.close.addEventListener("click", () => { if (!trimBusy) closeTrimmer(); });
    trimEls.overlay.addEventListener("click", (e) => { if (e.target === trimEls.overlay && !trimBusy) closeTrimmer(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && trimEls.overlay.style.display !== "none" && !trimBusy) closeTrimmer(); });
}


// ── BOOT ──
async function boot() {
    try {
        console.log("Booting Prism...");
        applyIcons(); updateGreeting(); setupMediaSession();
        applyAppearance(false);
        try { setSidebarCollapsed(localStorage.getItem("spootify-sidebar-collapsed") === "1"); } catch {}
        try { setQueueHidden(localStorage.getItem("spootify-queue-hidden") === "1"); } catch {}
        const savedVolume = parseFloat(localStorage.getItem("spootify-volume"));
        setUserVolume(Number.isFinite(savedVolume) ? savedVolume : (volumeBar ? volumeBar.value / 100 : 0.8), false);
        try { likedSort = JSON.parse(localStorage.getItem("spootify-liked-sort") || "null"); } catch { likedSort = null; }
        applySkipButtons(); syncPrefsUi();
        renderProgress(true);
        if (trackArt) trackArt.src = DEFAULT_ART;

        setBootProgress(0.05);
        const saved = await loadLibrary();
        if (saved) {
            const didMigrate = await migrateOldData(saved);
            if (didMigrate) {
                console.log("Migrated old data to blob storage");
            }
            playlists = saved.playlists || {};
            for (const pl of Object.values(playlists)) if (!Array.isArray(pl.songs)) pl.songs = [];
            currentPlaylist = localStorage.getItem("spootify-current-playlist") || saved.currentPlaylist || null;
            queue = saved.queue || [];
            likedSongs = new Map(Array.isArray(saved.liked) ? saved.liked.filter((e) => Array.isArray(e) && e[0]) : []);
            // The Home shelves can run before the library has loaded (60 ms after start, and
            // a phone's storage is often slower than that). The caches they fill are keyed by
            // these versions, so without a bump they'd keep that empty library: Most Listened
            // showed every song as "removed", and Top rated and Recently played stayed hidden.
            libraryVersion++; likedVersion++; statsIndex = null;
            trash = Array.isArray(saved.trash) ? saved.trash.filter((t) => t && (t.type === "song" ? t.song : t.playlist)) : [];
            libraryLoadedOk = !!saved.playlists;
            const purged = purgeOldTrash();
            if (dedupeSongIds() || didMigrate || purged) await saveLibrary();
        } else {
            libraryLoadedOk = true; // brand-new install: nothing to protect
        }
        loadListenStats();

        // Show the shell as early as possible: covers first, then the open playlist,
        // then everything else in the background with the progress bar.
        await hydratePlaylistCovers();
        setBootProgress(0.2);
        renderPlaylists();
        if (!prefs.openOnHome && viewExists(currentPlaylist)) {
            await hydrateSongArt(isLikedSource(currentPlaylist) ? getLikedSongs() : playlists[currentPlaylist].songs || []);
            loadPlaylistPage(currentPlaylist);
        } else showHome();
        await hydrateSongArt(queue.map((i) => i?.song).filter(Boolean));
        renderQueue();
        setBootProgress(0.35);
        libraryReadyResolve(); // requests from a car that came in while starting can go ahead now

        renderStatsCard();
        setPreservePitch(localStorage.getItem("spootify-preserve-pitch") === "1");
        setPlaybackSpeed(parseInt(localStorage.getItem("spootify-speed")) || 100);
        const savedCrossfade = parseInt(localStorage.getItem("spootify-crossfade")) || 0;
        if (savedCrossfade) { setCrossfade(savedCrossfade); if (crossfadeSlider) crossfadeSlider.value = savedCrossfade; }
        setCrossfadeOverlap(localStorage.getItem("spootify-crossfade-overlap") === "1");
        loadFxSettings();
        setLeveller(localStorage.getItem(LEVELLER_KEY) === "1", false);
        // One-time switch to the artist-sorted default for playlists that were never given a sort.
        if (!localStorage.getItem("spootify-default-sort-v1")) {
            for (const pl of Object.values(playlists)) if (!pl.sort) pl.sort = defaultSort();
            localStorage.setItem("spootify-default-sort-v1", "1");
            if (Object.keys(playlists).length) await saveLibrary();
            if (currentPlaylist && playlists[currentPlaylist]) renderSongs();
        }
        if (speedSlider) updateSliderFill(speedSlider);
        if (crossfadeSlider) updateSliderFill(crossfadeSlider);
        renderPresetChips();

        nativeAudio.stop();
        await restoreNowPlaying();
        setActiveButton(shuffleBtn, shuffleEnabled); updateLoopButton(); updateNpControls();

        const names = Object.keys(playlists);
        for (let i = 0; i < names.length; i++) {
            await hydrateSongArt(playlists[names[i]].songs || []);
            setBootProgress(0.35 + 0.65 * ((i + 1) / names.length));
        }
        setBootProgress(1);
        renderPlaylists(); // auto covers need every playlist's art
        if (playlistView && playlistView.style.display !== "none") { renderSongs(); applyViewTint(); }
        renderStatsCard(); renderShelves();
        updateBinButton(); checkMilestones();
        gcUnreferencedBlobs();
        scheduleCarLibrary(2000);
        setTimeout(() => { shrinkStoredCovers(); }, 4000);
        // Android brings the page back after its renderer dies; the desktop app reloads it.
        const lastJob = takeLastActivity();
        const restart = nativeAudio.available ? nativeAudio.takeRestartNotice() : Promise.resolve(window.electronAPI?.takeCrash ? window.electronAPI.takeCrash() : null);
        restart.then((r) => {
            if (r && r.reason) {
                const songs = Object.values(playlists).reduce((n, pl) => n + (pl.songs || []).length, 0);
                logProblem(`${r.reason === "memory" ? "Ran out of memory" : "The page crashed (" + r.reason + ")"} and restarted${lastJob ? ` while ${lastJob}` : ""}. Library: ${songs} songs.`);
                showToast(r.reason === "memory"
                    ? "Prism ran out of memory and had to restart"
                    : "Prism's page crashed and was restarted", { duration: 6000 });
            } else if (lastJob) logProblem(`Prism closed while ${lastJob}.`);
        }).catch(() => {});
        renderProblems();

        console.log("Prism Boot Complete.");
    } catch (err) {
        console.error("BOOT CRASH:", err);
    }
}

boot();
