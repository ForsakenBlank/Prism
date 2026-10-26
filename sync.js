// ── WI-FI SYNC ── (Home → Sync)
// Two devices on the same network swap what changed since they last synced each other:
// new songs (with their audio), covers, the extra listening time, likes, ratings, renames,
// settings and custom themes. The PC app hosts (main.js runs a small HTTP server while
// "Let a phone connect" is on and shows a 6-digit code); the phone connects to it, both
// sides are compared, and the phone shows every change in both directions to tick or untick.
//
// "Since they last synced" = a sync point kept per other device (IndexedDB "spootify-sync"):
// the song list, likes, ratings, names and listening totals as they were right after the
// last sync. Listening time is sent as the difference from that point, so 10 h + 10 min
// later only the 10 minutes go across, and what one side receives is part of its next sync
// point, so it never bounces back. Unticked changes are skipped for good, except new songs,
// which are offered again until the other device has them (or removed them on purpose).
// While media moves, both sides show progress (the dialog can be closed: a small bar at the
// top keeps showing it), the screen is kept on, and deleting waits until it's done.
// Shares app.v2.js's globals (classic scripts), loaded right after it.

const SYNC_PORT = 47823;
const SYNC_CHUNK = 3 * 512 * 1024; // 1.5 MB of media per request; a multiple of 3 so base64 pieces join cleanly
const SYNC_ADDR_KEY = "spootify-sync-addr", DEVICE_ID_KEY = "spootify-device-id";
// Settings that only make sense on the device they're on (besides NOT_EXPORTED_KEYS).
const SYNC_LOCAL_KEYS = ["spootify-settings-tab", "spootify-sidebar-collapsed", "spootify-queue-hidden", "spootify-export", "spootify-import-tab",
    "spootify-default-sort-v1", "spootify-milestones", "spootify-custom-themes", "spootify-activity", "spootify-problems", "spootify-update"];
const SETTING_LABELS = {
    "spootify-appearance": "Appearance (theme, layout, effects)", "spootify-prefs": "General settings", "spootify-presets": "EQ presets",
    "spootify-speed": "Playback speed", "spootify-preserve-pitch": "Keep pitch when changing speed", "spootify-crossfade": "Crossfade length",
    "spootify-crossfade-overlap": "Crossfade overlap", "spootify-fx": "Sound effects", "spootify-leveller": "Volume leveller",
    "spootify-volume": "Volume", "spootify-liked-sort": "Liked Songs sort order", "spootify-dj": "DJ settings", "spootify-recent-colors": "Recent colours"
};
const SYNC_CATS = [
    ["renames", "Renamed songs"], ["songs", "New songs"], ["covers", "Covers"], ["listen", "Listening time"], ["likes", "Likes"],
    ["ratings", "Ratings"], ["settings", "Settings"], ["themes", "Custom themes"]
];

function deviceId() {
    try {
        let id = localStorage.getItem(DEVICE_ID_KEY);
        if (!id) { id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(DEVICE_ID_KEY, id); }
        return id;
    } catch { return "unknown"; }
}
function deviceName() { return nativeAudio.available ? "Phone" : window.electronAPI ? "PC" : "Browser"; }
const pad2 = (n) => String(n).padStart(2, "0");
function syncDay(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
const entryKey = (playlist, name) => playlist + "\u0001" + name;

// ── Covers ──
// Media ids differ per device, so covers are compared by content: "size:hash" of the
// picture's bytes (a cover that was synced before has the same bytes on both sides).
const coverFps = new Map(); // media id → fingerprint
async function coverFp(id) {
    if (!id) return null;
    if (coverFps.has(id)) return coverFps.get(id);
    const blob = await getBlob(id); if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
    const fp = bytes.length + ":" + (h >>> 0).toString(36);
    coverFps.set(id, fp);
    return fp;
}
// Every cover here: "s\u0001<song name>" (the first copy of a song that has one) and
// "p\u0001<playlist>" (a playlist's own picture) → { id, fp }.
async function currentCovers() {
    const out = {};
    for (const [p, pl] of Object.entries(playlists)) {
        if (pl.artId) { const fp = await coverFp(pl.artId); if (fp) out["p\u0001" + p] = { id: pl.artId, fp }; }
        for (const s of pl.songs || []) {
            const k = "s\u0001" + songNameKey(s.title, s.artist);
            if (!s.artId || out[k]) continue;
            const fp = await coverFp(s.artId); if (fp) out[k] = { id: s.artId, fp };
        }
    }
    return out;
}

// ── Sync points ──
let syncDbP = null;
function syncDb() {
    if (!syncDbP) {
        syncDbP = new Promise((resolve, reject) => {
            const r = indexedDB.open("spootify-sync", 1);
            r.onupgradeneeded = () => r.result.createObjectStore("baselines");
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
        syncDbP.catch(() => { syncDbP = null; });
    }
    return syncDbP;
}
async function loadSyncPoint(peerId) {
    try {
        const db = await syncDb();
        return await new Promise((resolve) => { const r = db.transaction("baselines").objectStore("baselines").get(peerId); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
    } catch { return null; }
}
async function saveSyncPoint(peerId) {
    const today = syncDay(), [ym, day] = [today.slice(0, 7), String(Number(today.slice(8)))];
    const point = { at: Date.now(), day: today, entries: [], ids: {}, liked: [], ratings: {}, stats: {}, log: {}, clock: loadClock().g.slice(), covers: {} };
    for (const [k, c] of Object.entries(await currentCovers())) point.covers[k] = c.fp;
    for (const [p, pl] of Object.entries(playlists)) for (const s of pl.songs || []) {
        point.entries.push(entryKey(p, songNameKey(s.title, s.artist)));
        point.ids[s.id] = [s.title, s.artist];
    }
    const names = currentNameMaps();
    point.liked = [...names.liked.keys()];
    for (const [n, r] of names.ratings) point.ratings[n] = r.rating;
    for (const [k, e] of Object.entries(listenStats)) point.stats[k] = [e.plays || 0, e.seconds || 0, e.skips || 0];
    const todays = loadLogMonth(ym)[day] || {};
    for (const k in todays) point.log[k] = todays[k].slice();
    const db = await syncDb();
    await new Promise((resolve, reject) => { const tx = db.transaction("baselines", "readwrite"); tx.objectStore("baselines").put(point, peerId); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}

// stats key → { title, artist } of the live song, else the stats snapshot.
function nameForKey(key) {
    const found = findSongByStatsKey(key);
    if (found) return { title: found.song.title, artist: found.song.artist };
    const e = listenStats[key];
    return e && e.title ? { title: e.title, artist: e.artist || "" } : null;
}
// Liked songs and ratings by name (title + artist), as other devices see them.
function currentNameMaps() {
    const liked = new Map(), ratingsByName = new Map();
    for (const k of likedSongs.keys()) { const n = nameForKey(k); if (n) liked.set(songNameKey(n.title, n.artist), n); }
    for (const [k, r] of Object.entries(ratings)) {
        if (!(r >= 1 && r <= 5)) continue;
        const n = nameForKey(k); if (n) ratingsByName.set(songNameKey(n.title, n.artist), { ...n, rating: r });
    }
    return { liked, ratings: ratingsByName };
}
// The first library song with this name (and audio, when there is one).
function librarySongByName(name) {
    let fallback = null;
    for (const pl of Object.values(playlists)) for (const s of pl.songs || []) {
        if (songNameKey(s.title, s.artist) !== name) continue;
        if (s.mediaId) return s;
        fallback = fallback || s;
    }
    return fallback;
}

// Listening time gained since the sync point (everything, the first time).
function listenSince(point) {
    const baseDay = point ? point.day : null, logs = new Map();
    for (const ym of logMonthKeys()) {
        if (baseDay && ym < baseDay.slice(0, 7)) continue;
        const month = loadLogMonth(ym);
        for (const day in month) {
            const ymd = `${ym}-${pad2(day)}`;
            if (baseDay && ymd < baseDay) continue;
            for (const k in month[day]) {
                let [s, p] = month[day][k];
                if (baseDay && ymd === baseDay && point.log[k]) { s -= point.log[k][0]; p -= point.log[k][1]; }
                if (s < 1 && p < 1) continue;
                const l = logs.get(k) || (logs.set(k, {}), logs.get(k));
                (l[ym] || (l[ym] = {}))[day] = [Math.max(0, Math.round(s)), Math.max(0, p)];
            }
        }
    }
    const out = [];
    for (const [key, e] of Object.entries(listenStats)) {
        const b = point && point.stats[key];
        const plays = Math.max(0, (e.plays || 0) - (b ? b[0] : 0)), seconds = Math.max(0, Math.round((e.seconds || 0) - (b ? b[1] : 0))), skips = Math.max(0, (e.skips || 0) - (b ? b[2] : 0));
        if (plays < 1 && seconds < 1 && skips < 1) continue;
        const n = nameForKey(key); if (!n) continue;
        out.push({ title: n.title, artist: n.artist, plays, seconds, skips: skips || undefined, lastSkipped: skips ? e.lastSkipped : undefined,
            firstPlayed: e.firstPlayed || undefined, lastPlayed: e.lastPlayed || undefined, log: logs.get(key) });
    }
    const g = loadClock().g.map((v, i) => Math.max(0, Math.round(v - (point && point.clock ? point.clock[i] || 0 : 0))));
    return { listen: out, clock: g.some((v) => v > 0) ? { since: loadClock().since, g } : null };
}

// What this device tells the other one: its song list and current likes/ratings/settings/
// themes (so the other side can tell what it's missing), plus what changed here since the
// sync point with that device.
async function buildSyncOffer(peerId) {
    const point = await loadSyncPoint(peerId);
    const songs = [], entries = new Set();
    for (const [p, pl] of Object.entries(playlists)) for (const s of pl.songs || []) {
        entries.add(entryKey(p, songNameKey(s.title, s.artist)));
        songs.push({ p, id: s.id, title: s.title, artist: s.artist, duration: s.duration, loudness: s.loudness, src: s.src, timestamp: s.timestamp, m: s.mediaId || null, c: s.artId || null });
    }
    const removed = point ? point.entries.filter((e) => !entries.has(e)) : [];
    const names = currentNameMaps();
    const likes = [], rated = [], renames = [];
    if (point) {
        const was = new Set(point.liked);
        for (const [n, v] of names.liked) if (!was.has(n)) likes.push({ ...v, liked: true });
        for (const n of was) if (!names.liked.has(n)) { const s = librarySongByName(n); if (s) likes.push({ title: s.title, artist: s.artist, liked: false }); }
        for (const [n, v] of names.ratings) if (point.ratings[n] !== v.rating) rated.push(v);
        for (const n of Object.keys(point.ratings)) if (!names.ratings.has(n)) { const s = librarySongByName(n); if (s) rated.push({ title: s.title, artist: s.artist, rating: 0 }); }
        const seen = new Set();
        for (const pl of Object.values(playlists)) for (const s of pl.songs || []) {
            const old = point.ids[s.id]; if (!old) continue;
            const from = songNameKey(old[0], old[1]), to = songNameKey(s.title, s.artist);
            if (from === to || seen.has(from)) continue;
            seen.add(from);
            renames.push({ from: { title: old[0], artist: old[1] }, to: { title: s.title, artist: s.artist } });
        }
    } else {
        for (const v of names.liked.values()) likes.push({ ...v, liked: true });
        for (const v of names.ratings.values()) rated.push(v);
    }
    const { listen, clock } = listenSince(point);
    // Covers changed here since the sync point (unknown before sync points kept covers).
    const covers = await currentCovers();
    const changedCovers = point && point.covers ? Object.keys(covers).filter((k) => point.covers[k] !== covers[k].fp) : [];
    const all = await collectSettings({ settings: true, themes: true });
    const settings = {}, skip = SYNC_LOCAL_KEYS;
    for (const [k, v] of Object.entries(all.storage)) if (!skip.includes(k)) settings[k] = v;
    let themes = [];
    try { themes = JSON.parse(all.storage["spootify-custom-themes"] || "[]"); } catch {}
    return {
        deviceId: deviceId(), name: deviceName(), firstSync: !point, songs, removed, playlists: Object.keys(playlists), covers,
        liked: [...names.liked.keys()], ratings: Object.fromEntries([...names.ratings].map(([n, v]) => [n, v.rating])),
        changes: { likes, ratings: rated, renames, listen, clock, covers: changedCovers }, settings, themes: Array.isArray(themes) ? themes : [], themeImages: all.themeImages
    };
}

// The changes `from` has that `to` doesn't, as tickable items { cat, label, sub, data, checked }.
function syncItems(from, to) {
    const items = [];
    const toEntries = new Set(to.songs.map((s) => entryKey(s.p, songNameKey(s.title, s.artist))));
    const toNames = new Set(to.songs.map((s) => songNameKey(s.title, s.artist)));
    const toRemoved = new Set(to.removed);
    // Renames first: a renamed song must not also show up as a "new" song.
    const renamedTo = new Set();
    for (const r of from.changes.renames) {
        const fromName = songNameKey(r.from.title, r.from.artist), toName = songNameKey(r.to.title, r.to.artist);
        if (!toNames.has(fromName) || toNames.has(toName)) continue;
        renamedTo.add(toName);
        items.push({ cat: "renames", label: `${r.from.title} → ${r.to.title}`, sub: r.from.artist === r.to.artist ? r.to.artist : `${r.from.artist} → ${r.to.artist}`, data: r });
    }
    // One item per song, listing every playlist it goes into (data.p stays the first, for older devices).
    const adding = new Map(), addingTo = new Set();
    for (const s of from.songs) {
        const name = songNameKey(s.title, s.artist), key = entryKey(s.p, name);
        if (toEntries.has(key) || toRemoved.has(key) || renamedTo.has(name)) continue;
        let it = adding.get(name);
        if (!it) { it = { cat: "songs", label: s.title, data: { ...s, ps: [] } }; adding.set(name, it); items.push(it); }
        if (!it.data.ps.includes(s.p)) { it.data.ps.push(s.p); addingTo.add(s.p); }
    }
    for (const [name, it] of adding) {
        it.sub = `${it.data.artist || "Unknown Artist"} · into ${it.data.ps.map((p) => `"${p}"`).join(", ")}${toNames.has(name) ? " · already there, no download" : ""}`;
    }
    // Covers: offered when the other side has none, or when this side changed it since the last sync.
    const toCovers = to.covers || {}, changed = new Set(from.changes.covers || []), toPlaylists = new Set(to.playlists || to.songs.map((s) => s.p));
    const songByName = new Map(from.songs.map((s) => [songNameKey(s.title, s.artist), s]));
    for (const [k, c] of Object.entries(from.covers || {})) {
        const theirs = toCovers[k];
        if (theirs && (theirs.fp === c.fp || !changed.has(k))) continue;
        const [kind, name] = k.split("\u0001");
        if (kind === "s" ? !toNames.has(name) : !(toPlaylists.has(name) || addingTo.has(name))) continue;
        const song = kind === "s" ? songByName.get(name) : null;
        items.push({ cat: "covers", label: song ? song.title : name,
            sub: `${song ? `${song.artist || "Unknown Artist"} · song cover` : "playlist cover"}${theirs ? " · changed" : " · none there yet"}`, data: { key: k, kind, name, id: c.id } });
    }
    const exists = (t, a) => { const n = songNameKey(t, a); return toNames.has(n) || adding.has(n) || renamedTo.has(n); };
    for (const l of from.changes.listen) {
        items.push({ cat: "listen", label: l.title, sub: `${l.artist || "Unknown Artist"} · +${formatListenTime(l.seconds)}${l.plays ? ` · +${l.plays} ${l.plays === 1 ? "play" : "plays"}` : ""}${exists(l.title, l.artist) ? "" : " · shows as removed"}`, data: l });
    }
    if (from.changes.clock) {
        const total = from.changes.clock.g.reduce((a, b) => a + b, 0);
        items.push({ cat: "listen", label: "Time-of-day chart", sub: `+${formatListenTime(total)} on the "When you listen" chart`, data: { clock: from.changes.clock } });
    }
    const toLiked = new Set(to.liked);
    for (const l of from.changes.likes) {
        if (!exists(l.title, l.artist) || toLiked.has(songNameKey(l.title, l.artist)) === l.liked) continue;
        items.push({ cat: "likes", label: l.title, sub: `${l.artist || "Unknown Artist"} · ${l.liked ? "like" : "unlike"}`, data: l });
    }
    for (const r of from.changes.ratings) {
        if (!exists(r.title, r.artist) || (to.ratings[songNameKey(r.title, r.artist)] || 0) === r.rating) continue;
        items.push({ cat: "ratings", label: r.title, sub: `${r.artist || "Unknown Artist"} · ${r.rating ? "★".repeat(r.rating) : "no rating"}`, data: r });
    }
    for (const [k, v] of Object.entries(from.settings)) {
        if (to.settings[k] === v) continue;
        const theirs = to.settings[k], short = String(v).length <= 24 && String(theirs).length <= 24;
        items.push({ cat: "settings", label: SETTING_LABELS[k] || k.replace(/^spootify-/, "").replace(/-/g, " "),
            sub: theirs === undefined ? "not set there yet" : short ? `${v} (now ${theirs})` : "different", data: { key: k, value: v }, checked: false });
    }
    const bare = (t) => JSON.stringify({ ...t, image: t.image ? { ...t.image, id: null } : null });
    for (const t of from.themes) {
        if (!t || !t.id) continue;
        const theirs = to.themes.find((x) => x && x.id === t.id);
        if (theirs && bare(theirs) === bare(t)) continue;
        const image = t.image && t.image.id ? from.themeImages[t.image.id] || null : null;
        items.push({ cat: "themes", label: t.name || "Theme", sub: theirs ? "updated" : "new theme", data: { theme: t, image } });
    }
    for (const it of items) if (it.checked === undefined) it.checked = true;
    return items;
}

// Puts ticked items in place on this device. Songs' data.localM / data.localC are this
// device's media ids for audio/cover when they were just transferred; otherwise a song
// already here with the same name lends its audio. Returns { reload } when settings or
// themes changed (they're applied by restarting the page).
async function applySyncItems(items) {
    const by = (cat) => items.filter((i) => i && i.cat === cat).map((i) => i.data);
    let changedLibrary = false, reload = false;
    for (const r of by("renames")) {
        const fromName = songNameKey(r.from.title, r.from.artist);
        for (const pl of Object.values(playlists)) for (const s of pl.songs || []) {
            if (songNameKey(s.title, s.artist) !== fromName) continue;
            s.title = r.to.title; s.artist = r.to.artist; changedLibrary = true;
            const e = listenStats[statsKeyFor(s)]; if (e) { e.title = s.title; e.artist = s.artist; }
        }
    }
    for (const s of by("songs")) {
        const name = songNameKey(s.title, s.artist), here = librarySongByName(name);
        const mediaId = s.localM || (here && here.mediaId) || null;
        if (s.m && !mediaId) continue; // its audio didn't come across
        const artId = s.localC || (here && here.artId) || null;
        const fileSrc = mediaId ? await getBlobUrl(mediaId) : null, art = artId ? await getBlobUrl(artId) : DEFAULT_ART;
        for (const p of Array.isArray(s.ps) && s.ps.length ? s.ps : [s.p]) {
            const pl = playlists[p] || (playlists[p] = { name: p, artId: null, art: DEFAULT_ART, sort: defaultSort(), pinned: false, songs: [] });
            // Already there (e.g. the same request arriving twice): never add a second copy.
            if (pl.songs.some((x) => songNameKey(x.title, x.artist) === name)) continue;
            pl.songs.push({ id: newSongId(), title: s.title, artist: s.artist, timestamp: s.timestamp || Date.now(), duration: s.duration, loudness: s.loudness,
                src: typeof s.src === "string" ? s.src.slice(0, 200) : undefined, mediaId, artId, fileSrc, art });
            changedLibrary = true;
        }
    }
    let coverOfPlaying = false;
    for (const c of by("covers")) {
        if (!c.localC) continue; // the picture didn't come across
        const url = (await getBlobUrl(c.localC)) || DEFAULT_ART;
        if (c.kind === "p") { const pl = playlists[c.name]; if (pl) { pl.artId = c.localC; pl.art = url; changedLibrary = true; } continue; }
        const fix = (s) => {
            if (!s || songNameKey(s.title, s.artist) !== c.name) return;
            s.artId = c.localC; s.art = url; delete s.thumbId; delete s.coverCrop; changedLibrary = true;
            if (s === currentTrack) coverOfPlaying = true;
        };
        for (const pl of Object.values(playlists)) (pl.songs || []).forEach(fix);
        for (const item of queue) fix(item?.song);
        fix(currentTrack);
    }
    if (coverOfPlaying) showTrackInfo(currentTrack, currentTrackSource);
    const keyByName = (t, a) => { const s = librarySongByName(songNameKey(t, a)); return s ? statsKeyFor(s) : null; };
    for (const l of by("likes")) {
        const k = keyByName(l.title, l.artist); if (!k) continue;
        if (l.liked) { if (!likedSongs.has(k)) likedSongs.set(k, Date.now()); } else likedSongs.delete(k);
        likedVersion++; changedLibrary = true;
    }
    let rated = false;
    for (const r of by("ratings")) {
        const k = keyByName(r.title, r.artist); if (!k) continue;
        if (r.rating >= 1 && r.rating <= 5) ratings[k] = Math.round(r.rating); else delete ratings[k];
        rated = true;
    }
    if (rated) { saveRatings(); sortedCache.clear(); }
    const listen = by("listen");
    if (listen.length) mergeListenTimes({ listenTimes: listen.filter((l) => !l.clock), clock: (listen.find((l) => l.clock) || {}).clock || null });
    for (const s of by("settings")) { try { localStorage.setItem(s.key, s.value); reload = true; } catch {} }
    const themes = by("themes");
    if (themes.length) {
        const themeImages = {};
        for (const t of themes) if (t.image && t.theme.image && t.theme.image.id) themeImages[t.theme.image.id] = t.image;
        await restoreSettings({ storage: { "spootify-custom-themes": JSON.stringify(themes.map((t) => t.theme)) }, themeImages });
        reload = true;
    }
    if (changedLibrary) {
        await saveLibrary(); renderPlaylists(); renderSongs(); renderQueue(); refreshStatsUi();
    }
    return { reload };
}

// ── Moving media ──
function bytesFromBase64(b64) { const bin = atob(b64), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function base64FromBlob(blob) { const d = await blobToDataUrl(blob); return d ? String(d).split(",")[1] || "" : ""; }
async function mediaChunk(id, offset, length) {
    const blob = await getBlob(id);
    if (!blob) return { size: 0, type: "", length: 0, data: "" };
    const part = blob.slice(offset, offset + length);
    return { size: blob.size, type: blob.type, length: part.size, data: await base64FromBlob(part) };
}
// token → { parts: Map(offset → bytes), type } while the other device sends us a file. Parts are
// keyed by offset, so a chunk that arrives twice (a retried request) can't be stored twice.
const uploads = new Map();

// ── Talking to the other device ──
function syncUrl(addr) {
    const a = String(addr || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return `http://${/:\d+$/.test(a) ? a : a + ":" + SYNC_PORT}/sync`;
}
// Every request carries the code and, during a sync, where it's up to (the PC shows that too).
async function syncCall(conn, action, data = {}) {
    const url = syncUrl(conn.addr), body = JSON.stringify({ ...data, code: conn.code, action, progress: conn.progress || undefined });
    let status, text;
    if (nativeAudio.available) ({ status, text } = await nativeAudio.raw("httpPost", { url, body, timeout: 300000 }));
    else {
        let r;
        try { r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body }); }
        catch { throw new Error("Couldn't reach the other device. Check the address and that both are on the same Wi-Fi."); }
        status = r.status; text = await r.text();
    }
    let json = null; try { json = JSON.parse(text); } catch {}
    if (status !== 200 || !json || json.error) throw new Error((json && json.error) || `The other device answered ${status}`);
    return json;
}
const SYNC_STOPPED = "Stopped";
function checkStop() { if (syncState.stop) throw new Error(SYNC_STOPPED); }
// onFrac(0…1) as the file arrives; every piece stored is noted in `kept` so a stopped or
// failed sync can delete it again.
async function pullMedia(conn, id, onFrac, kept) {
    if (!id) return null;
    const parts = []; let offset = 0, size = 1, type = "";
    while (offset < size) {
        checkStop();
        const r = await syncCall(conn, "media", { id, offset, length: SYNC_CHUNK });
        size = r.size; type = r.type;
        if (!r.length) break;
        parts.push(bytesFromBase64(r.data)); offset += r.length; onFrac(size ? offset / size : 1);
    }
    if (!parts.length) return null;
    const mid = await storeBlob(new Blob(parts, { type }));
    kept.push(mid);
    return mid;
}
async function pushMedia(conn, id, onFrac) {
    const blob = id ? await getBlob(id) : null; if (!blob) return null;
    checkStop();
    const { token } = await syncCall(conn, "upload-start", { type: blob.type });
    for (let at = 0; at < blob.size; at += SYNC_CHUNK) {
        checkStop();
        const part = blob.slice(at, at + SYNC_CHUNK);
        await syncCall(conn, "upload-chunk", { token, at, data: await base64FromBlob(part) });
        onFrac(Math.min(1, (at + part.size) / blob.size));
    }
    return (await syncCall(conn, "upload-end", { token })).id;
}

// ── While a sync runs: lock, screen on, progress everywhere ──
// syncActive (app.v2.js) pauses deleting and media clean-up. The phone's screen is kept on
// (natively in newer APKs, else the Wake Lock API, which the page re-takes when it comes back).
let wakeLock = null, awakeWanted = false;
async function keepAwake(on) {
    awakeWanted = on;
    if (nativeAudio.available) { try { await nativeAudio.raw("keepAwake", { on }); return; } catch {} }
    try {
        if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
        else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
    } catch {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && awakeWanted && !wakeLock) keepAwake(true); });
function setSyncActive(on) {
    syncActive = on;
    keepAwake(on || !!hostInfo || !!(syncState.conn && syncEls.overlay && isShown(syncEls.overlay)));
    if (!on) showSyncProgress(null);
}
// The bar in the dialog and the small one at the top of the app (shown while the dialog is closed).
function showSyncProgress(fraction, text) {
    if (syncEls.progress) {
        syncEls.progress.style.display = fraction === null ? "none" : "flex";
        if (fraction !== null) { syncEls.fill.style.width = Math.round(clamp(fraction, 0, 1) * 100) + "%"; setText(syncEls.text, text || ""); }
    }
    const float = $("sync-float");
    if (!float) return;
    float.hidden = fraction === null || isShown(syncEls.overlay);
    if (fraction !== null) { $("sync-float-fill").style.width = Math.round(clamp(fraction, 0, 1) * 100) + "%"; setText($("sync-float-text"), text || "Syncing…"); }
    float._last = fraction === null ? null : { fraction, text };
}
function refreshSyncFloat() { const f = $("sync-float"); if (f && f._last) showSyncProgress(f._last.fraction, f._last.text); else if (f) f.hidden = true; }

// ── The PC side: answering requests (main.js forwards them here) ──
// A "session" runs from the first media request to "apply" (or "abort"). If the other device
// goes quiet for 2 minutes mid-sync, whatever it uploaded is deleted and the lock is released.
let hostInfo = null, hostSession = null, stopHostingWhenDone = false, hostPeerName = "other device";
const appliedSyncIds = new Set(); // "apply" requests already done, so a repeated one changes nothing
function hostStatus(text) { const el = $("sync-host-status"); if (el) setText(el, text); }
function startHostSession(req) {
    if (!hostSession) { hostSession = { name: req.name || hostPeerName, stored: [], timer: null }; setSyncActive(true); noteActivity("syncing with another device"); }
    clearTimeout(hostSession.timer); hostSession.timer = null;
}
function idleHostSession() {
    if (!hostSession) return;
    clearTimeout(hostSession.timer);
    hostSession.timer = setTimeout(() => endHostSession(true), 120000);
}
async function endHostSession(abandoned) {
    const s = hostSession; if (!s) return;
    hostSession = null; clearTimeout(s.timer); uploads.clear();
    if (abandoned) {
        if (s.stored.length) await deleteBlobs(s.stored);
        hostStatus(`The ${s.name} stopped before finishing. Nothing was changed here.`);
    }
    setSyncActive(false); noteActivity(null);
    if (stopHostingWhenDone) { stopHostingWhenDone = false; if (syncEls.hostToggle) syncEls.hostToggle.checked = false; await setHosting(false); }
}
// The phone's progress, told from this side.
function hostProgress(req) {
    const p = req.progress; if (!p || !hostSession) return;
    const who = req.name || hostPeerName;
    const text = p.phase === "down" ? `Sending to the ${who} · ${p.done} of ${p.total}` : p.phase === "up" ? `Receiving from the ${who} · ${p.done} of ${p.total}` : "Saving…";
    showSyncProgress(Number(p.frac) || 0, text);
    hostStatus(text);
}
async function answerSyncRequest(req) {
    switch (req.action) {
        case "hello": hostPeerName = req.name || "other device"; hostStatus(`The ${hostPeerName} connected`); return { deviceId: deviceId(), name: deviceName() };
        case "offer": hostPeerName = req.name || hostPeerName; hostStatus(`Comparing with the ${hostPeerName}…`); return await buildSyncOffer(String(req.peerId));
        case "media": startHostSession(req); hostProgress(req); return await mediaChunk(String(req.id), Number(req.offset) || 0, Math.min(Number(req.length) || SYNC_CHUNK, 4 * SYNC_CHUNK));
        case "upload-start": {
            startHostSession(req); hostProgress(req);
            const token = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            uploads.set(token, { parts: new Map(), type: String(req.type || "") });
            return { token };
        }
        case "upload-chunk": {
            startHostSession(req); hostProgress(req);
            const u = uploads.get(req.token); if (!u) throw new Error("Unknown upload");
            u.parts.set(Number.isFinite(Number(req.at)) ? Number(req.at) : u.parts.size * SYNC_CHUNK, bytesFromBase64(String(req.data || "")));
            return { ok: true };
        }
        case "upload-end": {
            startHostSession(req);
            const u = uploads.get(req.token); uploads.delete(req.token); if (!u) throw new Error("Unknown upload");
            const id = await storeBlob(new Blob([...u.parts].sort((a, b) => a[0] - b[0]).map((e) => e[1]), { type: u.type }));
            hostSession.stored.push(id);
            return { id };
        }
        case "apply": {
            const syncId = String(req.syncId || "");
            if (syncId && appliedSyncIds.has(syncId)) return { ok: true };
            startHostSession(req); hostProgress(req);
            const items = Array.isArray(req.items) ? req.items : [];
            const { reload } = await applySyncItems(items);
            await saveSyncPoint(String(req.peerId));
            if (syncId) appliedSyncIds.add(syncId);
            await endHostSession(false);
            hostStatus(`Synced with the ${req.name || hostPeerName}${items.length ? ` · ${items.length} ${items.length === 1 ? "change" : "changes"} received` : ""}${reload ? " · restarting to apply settings…" : ""}`);
            if (items.length) showToast(`Synced with the ${req.name || hostPeerName}`);
            if (reload) setTimeout(() => location.reload(), 1500);
            return { ok: true };
        }
        case "abort": await endHostSession(true); return { ok: true };
        default: throw new Error("Unknown request");
    }
}
if (window.electronAPI && window.electronAPI.sync) {
    window.electronAPI.sync.onRequest(async (id, req) => {
        let answer;
        try { answer = await answerSyncRequest(req || {}); } catch (e) { console.error("Sync request failed", e); answer = { error: errorText(e) }; }
        finally { idleHostSession(); }
        window.electronAPI.sync.reply(id, answer);
    });
}

// ── The dialog ──
const syncEls = {
    overlay: $("sync-overlay"), host: $("sync-host"), hostToggle: $("sync-host-toggle"), hostInfo: $("sync-host-info"),
    connect: $("sync-connect"), addr: $("sync-addr"), code: $("sync-code"), review: $("sync-review"), summary: $("sync-summary"),
    progress: $("sync-progress"), fill: $("sync-progress-fill"), text: $("sync-progress-text"), go: $("sync-go-btn"), cancel: $("sync-cancel-btn")
};
// conn: { addr, code, peer, progress }; review: { incoming, outgoing } while showing changes;
// busy while connecting; running while media moves (stop asks it to finish early).
let syncState = { conn: null, review: null, busy: false, running: false, stop: false };
function setSyncStatus(msg, kind = "") { if (syncEls.summary) { syncEls.summary.textContent = msg || ""; syncEls.summary.className = "export-summary" + (kind ? " " + kind : ""); } }
function openSyncDialog() {
    if (!syncEls.overlay) return;
    syncEls.overlay.style.display = "flex";
    refreshSyncFloat();
    if (syncState.running || syncState.busy || hostSession || (syncEls.hostToggle && syncEls.hostToggle.checked)) return; // carry on where it was
    syncState = { conn: null, review: null, busy: false, running: false, stop: false };
    syncEls.host.hidden = !(window.electronAPI && window.electronAPI.sync);
    syncEls.connect.hidden = false; syncEls.review.hidden = true; syncEls.review.innerHTML = "";
    try { syncEls.addr.value = localStorage.getItem(SYNC_ADDR_KEY) || ""; } catch {}
    syncEls.code.value = "";
    syncEls.go.hidden = false; setText(syncEls.go, "Connect"); syncEls.go.disabled = false;
    setText(syncEls.cancel, "Close");
    showSyncProgress(null);
    setSyncStatus(nativeAudio.available ? "On the PC, open Sync and turn on \"Let a phone connect\", then type the address and code it shows." : "");
}
// Closing while songs move only hides the dialog: the sync carries on with a small bar at the top.
async function closeSyncDialog() {
    if (syncState.running || syncState.busy || hostSession) {
        if (hostSession) stopHostingWhenDone = true;
        if (syncEls.overlay) syncEls.overlay.style.display = "none";
        refreshSyncFloat();
        return;
    }
    if (syncState.conn && syncState.review) syncCall(syncState.conn, "abort").catch(() => {}); // looked, didn't sync
    syncState.conn = null; keepAwake(false);
    if (syncEls.hostToggle && syncEls.hostToggle.checked) { syncEls.hostToggle.checked = false; await setHosting(false); }
    if (syncEls.overlay) syncEls.overlay.style.display = "none";
}
async function setHosting(on) {
    try {
        hostInfo = await window.electronAPI.sync.host(on);
        keepAwake(!!hostInfo);
        syncEls.hostInfo.hidden = !hostInfo;
        if (hostInfo) {
            const addrs = hostInfo.addresses.length ? hostInfo.addresses.map(escapeHtml).join(" or ") : "(no network found)";
            syncEls.hostInfo.innerHTML = `<div class="sync-host-row"><span>Address</span><strong>${addrs}</strong></div><div class="sync-host-row"><span>Code</span><strong class="sync-code">${escapeHtml(hostInfo.code)}</strong></div><p id="sync-host-status" class="sync-host-status">Waiting for a device… you can close this and keep using Prism while it syncs.</p>`;
        }
    } catch (e) {
        syncEls.hostToggle.checked = false; syncEls.hostInfo.hidden = true;
        setSyncStatus(`Couldn't start: ${errorText(e)}${/EADDRINUSE/.test(errorText(e)) ? " (another copy of Prism may be hosting)" : ""}`, "error");
    }
}

async function connectAndCompare() {
    const addr = syncEls.addr.value.trim(), code = syncEls.code.value.trim();
    if (!addr) { syncEls.addr.focus(); return; }
    if (!/^\d{6}$/.test(code)) { syncEls.code.focus(); setSyncStatus("The code is the 6 digits shown on the PC.", "error"); return; }
    try { localStorage.setItem(SYNC_ADDR_KEY, addr); } catch {}
    const conn = { addr, code };
    syncState.busy = true; syncEls.go.disabled = true;
    keepAwake(true);
    try {
        setSyncStatus("Connecting…");
        const hello = await syncCall(conn, "hello", { name: deviceName() });
        conn.peer = hello;
        setSyncStatus(`Comparing with the ${hello.name}…`);
        const theirs = await syncCall(conn, "offer", { peerId: deviceId(), name: deviceName() });
        const mine = await buildSyncOffer(hello.deviceId);
        syncState.conn = conn;
        syncState.review = { incoming: syncItems(theirs, mine), outgoing: syncItems(mine, theirs), first: theirs.firstSync || mine.firstSync,
            theirNames: theirs.songs.map((s) => songNameKey(s.title, s.artist)) };
        renderSyncReview();
    } catch (e) {
        console.error("Sync connect failed", e);
        setSyncStatus(errorText(e), "error");
        keepAwake(false);
    } finally { syncState.busy = false; syncEls.go.disabled = false; }
}

function renderSyncReview() {
    const { incoming, outgoing, first } = syncState.review, peer = syncState.conn.peer.name, me = deviceName() === "PC" ? "PC" : deviceName().toLowerCase();
    // A setting, theme or cover that differs shows up both ways: ticking one side unticks the other.
    const pairKey = (x) => x.cat === "settings" ? x.data.key : x.cat === "themes" ? x.data.theme.id : x.data.key;
    for (const it of incoming) {
        if (it.cat !== "settings" && it.cat !== "themes" && it.cat !== "covers") continue;
        const o = outgoing.find((x) => x.cat === it.cat && pairKey(x) === pairKey(it));
        if (o) { it.pair = o; o.pair = it; if (it.checked && o.checked) o.checked = false; }
    }
    syncEls.connect.hidden = true; syncEls.review.hidden = false;
    const total = incoming.length + outgoing.length;
    syncEls.review.innerHTML = "";
    if (first && total) {
        const note = document.createElement("p"); note.className = "sync-note";
        note.textContent = "First sync between these two: listening time is everything each side has. Untick it if you've already merged it with an export.";
        syncEls.review.appendChild(note);
    }
    for (const [items, title] of [[incoming, `From the ${peer} to this ${me}`], [outgoing, `From this ${me} to the ${peer}`]]) {
        const sec = document.createElement("section"); sec.className = "sync-dir";
        sec.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
        if (!items.length) sec.insertAdjacentHTML("beforeend", '<p class="sync-empty">Nothing new.</p>');
        for (const [cat, label] of SYNC_CATS) {
            const list = items.filter((i) => i.cat === cat); if (!list.length) continue;
            sec.appendChild(syncCategory(label, list));
        }
        syncEls.review.appendChild(sec);
    }
    setText(syncEls.go, total ? "Sync" : "Done");
    setSyncStatus(total ? "Tick what you want. Unticked changes are skipped (new songs will be offered again next time)." : "Already in sync.");
}
function syncCategory(label, list) {
    const box = document.createElement("div"); box.className = "sync-cat";
    box.innerHTML = `<div class="sync-cat-head"><label><input type="checkbox"><span>${escapeHtml(label)}</span><em></em></label><button type="button" class="sync-more">Show</button></div><div class="sync-items" hidden></div>`;
    const all = box.querySelector("input"), count = box.querySelector("em"), more = box.querySelector(".sync-more"), itemsEl = box.querySelector(".sync-items");
    const refresh = () => {
        const n = list.filter((i) => i.checked).length;
        all.checked = n === list.length; all.indeterminate = n > 0 && n < list.length;
        count.textContent = n === list.length ? String(list.length) : `${n} of ${list.length}`;
        for (const i of list) if (i.el) i.el.checked = i.checked;
    };
    const set = (it, on) => {
        it.checked = on;
        if (on && it.pair && it.pair.checked) { it.pair.checked = false; if (it.pair.refresh) it.pair.refresh(); }
    };
    for (const it of list) it.refresh = refresh;
    all.addEventListener("change", () => { for (const i of list) set(i, all.checked); refresh(); });
    more.addEventListener("click", () => {
        if (!itemsEl.childElementCount) {
            const frag = document.createDocumentFragment();
            for (const it of list) {
                const row = document.createElement("label"); row.className = "sync-item";
                row.innerHTML = `<input type="checkbox"${it.checked ? " checked" : ""}><span><strong>${escapeHtml(it.label)}</strong><small>${escapeHtml(it.sub || "")}</small></span>`;
                it.el = row.querySelector("input");
                it.el.addEventListener("change", (e) => { set(it, e.target.checked); refresh(); });
                frag.appendChild(row);
            }
            itemsEl.appendChild(frag);
        }
        itemsEl.hidden = !itemsEl.hidden; setText(more, itemsEl.hidden ? "Show" : "Hide");
    });
    refresh();
    return box;
}

async function runSync() {
    const { conn } = syncState, picked = (list) => list.filter((i) => i.checked).map((i) => ({ cat: i.cat, data: { ...i.data } }));
    const incoming = picked(syncState.review.incoming), outgoing = picked(syncState.review.outgoing);
    const syncId = deviceId() + "-" + Date.now().toString(36);
    const kept = []; // media stored here during this sync, deleted again if it doesn't finish
    let applied = false;
    syncState.running = true; syncState.stop = false;
    syncEls.review.hidden = true;
    setText(syncEls.go, "Hide"); syncEls.go.hidden = false;
    setText(syncEls.cancel, "Stop"); syncEls.cancel.disabled = false;
    setSyncStatus("You can hide this and keep listening. Deleting waits until the sync is done.");
    setSyncActive(true);
    noteActivity("syncing with another device");
    try {
        // Audio and covers that have to travel: songs the receiving side has no copy of by name.
        const needDown = incoming.filter((i) => i.cat === "songs" && !librarySongByName(songNameKey(i.data.title, i.data.artist)));
        const theirNames = new Set(syncState.review.theirNames || []);
        const needUp = outgoing.filter((i) => i.cat === "songs" && !theirNames.has(songNameKey(i.data.title, i.data.artist)));
        const coversDown = incoming.filter((i) => i.cat === "covers"), coversUp = outgoing.filter((i) => i.cat === "covers");
        const downTotal = needDown.length + coversDown.length, upTotal = needUp.length + coversUp.length, steps = downTotal + upTotal;
        let step = 0;
        // Shown here, and sent along with every request so the PC shows it too.
        const report = (phase, done, total, label, part = 0) => {
            const frac = steps ? (step + part) / steps : 1;
            conn.progress = { phase, done, total, frac };
            showSyncProgress(frac, `${label} · ${done} of ${total}`);
        };
        let n = 0;
        for (const it of needDown) {
            const label = `Getting songs from the ${conn.peer.name}`; n++;
            report("down", n, downTotal, label);
            it.data.localM = await pullMedia(conn, it.data.m, (f) => report("down", n, downTotal, label, f * 0.95), kept);
            it.data.localC = await pullMedia(conn, it.data.c, () => {}, kept);
            step++;
        }
        for (const it of coversDown) {
            n++; report("down", n, downTotal, `Getting covers from the ${conn.peer.name}`);
            it.data.localC = await pullMedia(conn, it.data.id, () => {}, kept);
            step++;
        }
        n = 0;
        for (const it of needUp) {
            const label = `Sending songs to the ${conn.peer.name}`; n++;
            report("up", n, upTotal, label);
            it.data.localM = await pushMedia(conn, it.data.m, (f) => report("up", n, upTotal, label, f * 0.95));
            it.data.localC = await pushMedia(conn, it.data.c, () => {});
            step++;
        }
        for (const it of coversUp) {
            n++; report("up", n, upTotal, `Sending covers to the ${conn.peer.name}`);
            it.data.localC = await pushMedia(conn, it.data.id, () => {});
            step++;
        }
        checkStop();
        // From here on it can't be stopped: both sides put the changes in place.
        setText(syncEls.cancel, "Close"); syncEls.cancel.disabled = true;
        conn.progress = { phase: "save", done: 1, total: 1, frac: 1 };
        showSyncProgress(1, "Saving…");
        await syncCall(conn, "apply", { peerId: deviceId(), name: deviceName(), items: outgoing, syncId });
        applied = true;
        const { reload } = await applySyncItems(incoming);
        await saveSyncPoint(conn.peer.deviceId);
        const n2 = incoming.length + outgoing.length;
        setSyncStatus(`Synced${n2 ? ` · ${incoming.length} received, ${outgoing.length} sent` : ""}.${reload ? " Restarting to apply settings…" : ""}`, "success");
        showToast(`Synced with the ${conn.peer.name}`);
        if (reload) setTimeout(() => location.reload(), 1500);
    } catch (e) {
        const stopped = errorText(e) === SYNC_STOPPED;
        if (!stopped) console.error("Sync failed", e);
        // Nothing was put in place: drop the media that came across, and tell the PC to drop its part.
        if (!applied) {
            if (kept.length) await deleteBlobs(kept);
            syncCall(conn, "abort").catch(() => {});
        }
        setSyncStatus(stopped ? "Stopped. Nothing was changed on either device." : `Sync failed: ${errorText(e)}. ${applied ? "The other device got your changes; sync again to get its changes here." : "Nothing was changed."} Close this and sync again.`, "error");
        if (!stopped) showToast("Sync failed");
    } finally {
        conn.progress = null;
        syncState.running = false; syncState.stop = false; syncState.review = null;
        syncEls.go.hidden = true; syncEls.cancel.disabled = false; setText(syncEls.cancel, "Close");
        setSyncActive(false);
        noteActivity(null);
        refreshSyncFloat();
    }
}
async function askStopSync() {
    if (!syncState.running || syncState.stop) return;
    if (!await showPrompt({ title: "Stop syncing?", message: "Nothing will be changed on either device, and anything already sent is cleaned up.", confirmText: "Stop", cancelText: "Keep going", danger: true })) return;
    syncState.stop = true;
    setSyncStatus("Stopping…");
}

if ($("sync-open-btn")) $("sync-open-btn").addEventListener("click", openSyncDialog);
if ($("sync-float")) $("sync-float").addEventListener("click", openSyncDialog);
if (syncEls.cancel) syncEls.cancel.addEventListener("click", () => { if (syncState.running) askStopSync(); else closeSyncDialog(); });
if (syncEls.overlay) syncEls.overlay.addEventListener("click", (e) => { if (e.target === syncEls.overlay) closeSyncDialog(); });
if (syncEls.hostToggle) syncEls.hostToggle.addEventListener("change", () => setHosting(syncEls.hostToggle.checked));
if (syncEls.go) syncEls.go.addEventListener("click", async () => {
    if (syncState.running) { closeSyncDialog(); return; } // "Hide"
    if (syncState.busy) return;
    if (!syncState.review) { await connectAndCompare(); return; }
    const { incoming, outgoing } = syncState.review;
    if (!incoming.length && !outgoing.length) {
        // Nothing to swap: still record the sync point on both sides.
        syncState.busy = true;
        let ok = false;
        try {
            await syncCall(syncState.conn, "apply", { peerId: deviceId(), name: deviceName(), items: [], syncId: deviceId() + "-" + Date.now().toString(36) });
            await saveSyncPoint(syncState.conn.peer.deviceId); ok = true;
        } catch (e) { setSyncStatus(errorText(e), "error"); }
        finally { syncState.busy = false; }
        if (ok) { syncState.review = null; closeSyncDialog(); }
        return;
    }
    await runSync();
});
for (const el of [syncEls.addr, syncEls.code]) if (el) el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); syncEls.go.click(); } });
