// 1. DATA STORES
let playlists = {};
let currentPlaylist = null;
let modalMode = "";
let activeTrackId = null;
let activePlaylistName = null;
let audioPlayer = new Audio();
let currentTrack = null;
let currentTrackSource = null;
let queue = [];
let playbackHistory = [];
let shuffleEnabled = false;
let loopMode = "off";
let progressFrameId = null;
let isScrubbing = false;
let lastMediaSessionPositionUpdate = 0;

// High-Performance Asset Cache
const ASSET_CACHE = new Map();

const DB_NAME = "spootify-db";
const DB_STORE = "state";
const ASSET_STORE = "assets"; // Separate store for binary data
const DB_KEY = "library";
const DEFAULT_ART = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23282828'/><circle cx='50' cy='50' r='25' fill='%23121212'/></svg>";

const ICONS = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-6H9v6H3.5a.5.5 0 0 1-.5-.5v-9.7Z"/></svg>',
    panelLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>',
    panelRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7-11-7Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6V5Zm3 7 10 7V5L9 12Z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2V5ZM5 19l10-7L5 5v14Z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3h4v4h-2V6h-2.4l-3.2 4.1-1.3-1.6L15.6 4H19V3h-2ZM4 7h3.4l10.2 13H19v-1h2v4h-4v-2h-1.4L5.4 9H4V7Zm0 10h1.4l3.2-4.1 1.3 1.6L6.4 19H4v-2Z"/></svg>',
    loop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h9.6L15 5.4 16.4 4 20.4 8l-4 4L15 10.6 16.6 9H7a3 3 0 0 0-3 3H2a5 5 0 0 1 5-5Zm10 10H7.4L9 18.6 7.6 20l-4-4 4-4L9 13.4 7.4 15H17a3 3 0 0 0 3-3h2a5 5 0 0 1-5 5Z"/></svg>',
    loopOne: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h9.6L15 5.4 16.4 4 20.4 8l-4 4L15 10.6 16.6 9H7a3 3 0 0 0-3 3H2a5 5 0 0 1 5-5Zm10 10H7.4L9 18.6 7.6 20l-4-4 4-4L9 13.4 7.4 15H17a3 3 0 0 0 3-3h2a5 5 0 0 1-5 5Z"/><text x="12" y="15.4" text-anchor="middle" font-size="8" font-family="Segoe UI, Arial, sans-serif" font-weight="800" fill="currentColor">1</text></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Zm12.2-1.6-1.4 1.4a4.5 4.5 0 0 1 0 6.4l1.4 1.4a6.5 6.5 0 0 0 0-9.2Z"/></svg>',
    dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a2 2 0 1 0 0 .01V12Zm7 0a2 2 0 1 0 0 .01V12Zm7 0a2 2 0 1 0 0 .01V12Z"/></svg>'
};

// 2. DOM ELEMENT LINKS
const sidebar = document.getElementById("sidebar");
const toggleSidebarBtn = document.getElementById("toggle-sidebar-btn");
const homeBtn = document.getElementById("home-btn");
const createPlaylistBtn = document.getElementById("create-playlist-btn");
const addSongBtn = document.getElementById("add-song-btn");
const playlistLinks = document.getElementById("playlist-links");
const homeDashboard = document.getElementById("home-dashboard");
const playlistView = document.getElementById("playlist-view");
const playlistGrid = document.getElementById("playlist-grid");
const currentPlaylistName = document.getElementById("current-playlist-name");
const playlistViewArt = document.getElementById("playlist-view-art");
const playlistStatsSongs = document.getElementById("playlist-stats-songs");
const playlistStatsDuration = document.getElementById("playlist-stats-duration");
const songList = document.getElementById("song-list");
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalForm = document.getElementById("modal-form");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const input1 = document.getElementById("input-1");
const input2 = document.getElementById("input-2");
const group2 = document.getElementById("group-2");
const fileGroup1 = document.getElementById("file-group-1");
const fileGroup2 = document.getElementById("file-group-2");
const fileInputSong = document.getElementById("file-input-song");
const fileInputArt = document.getElementById("file-input-art");
const trackArt = document.getElementById("track-art");
const trackTitle = document.getElementById("track-title");
const trackArtist = document.getElementById("track-artist");
const playPauseBtn = document.getElementById("play-pause-btn");
const shuffleBtn = document.getElementById("shuffle-btn");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const loopBtn = document.getElementById("loop-btn");
const volumeIconBtn = document.getElementById("volume-icon-btn");
const currentTimeLabel = document.getElementById("current-time");
const totalTimeLabel = document.getElementById("total-time");
const progressBar = document.getElementById("progress-bar");
const volumeBar = document.getElementById("volume-bar");
const playlistOptionsBtn = document.getElementById("playlist-options-btn");
const queueList = document.getElementById("queue-list");
const fsQueueList = document.getElementById("fs-queue-list");
const nextList = document.getElementById("next-list");
const clearQueueBtn = document.getElementById("clear-queue-btn");
const exportLibraryBtn = document.getElementById("export-library-btn");
const importLibraryInput = document.getElementById("import-library-input");
const confirmOverlay = document.getElementById("confirm-overlay");
const confirmTitle = document.getElementById("confirm-title");
const confirmMessage = document.getElementById("confirm-message");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
const confirmDeleteBtn = document.getElementById("confirm-delete-btn");

// Mobile Elements
const miniPlayer = document.getElementById("mini-player");
const fsPlayer = document.getElementById("fs-player");
const fsCloseBtn = document.getElementById("fs-close");
const fsPlayPauseBtn = document.getElementById("fs-play-pause-btn");
const fsPrevBtn = document.getElementById("fs-prev-btn");
const fsNextBtn = document.getElementById("fs-next-btn");
const fsShuffleBtn = document.getElementById("fs-shuffle-btn");
const fsLoopBtn = document.getElementById("fs-loop-btn");
const fsProgressBar = document.getElementById("fs-progress-bar");
const fsCurrentTimeLabel = document.getElementById("fs-current-time");
const fsTotalTimeLabel = document.getElementById("fs-total-time");
const fsTrackArt = document.getElementById("fs-track-art");
const fsTrackTitle = document.getElementById("fs-track-title");
const fsTrackArtist = document.getElementById("fs-track-artist");
const navHome = document.getElementById("nav-home");
const navCreate = document.getElementById("nav-create");
const mobileBackBtn = document.getElementById("mobile-back-btn");

function setIcon(button, icon, label) {
    if (!button) return;
    button.innerHTML = icon;
    button.setAttribute("aria-label", label);
    button.title = label;
}

function applyIcons() {
    homeBtn.innerHTML = `${ICONS.home}<span>Home / All Playlists</span>`;
    setIcon(toggleSidebarBtn, ICONS.panelLeft, "Collapse sidebar");
    setIcon(shuffleBtn, ICONS.shuffle, "Shuffle");
    setIcon(prevBtn, ICONS.prev, "Previous");
    setIcon(playPauseBtn, ICONS.play, "Play");
    setIcon(nextBtn, ICONS.next, "Next");

    // FS Icons
    setIcon(fsShuffleBtn, ICONS.shuffle, "Shuffle");
    setIcon(fsPrevBtn, ICONS.prev, "Previous");
    setIcon(fsPlayPauseBtn, ICONS.play, "Play");
    setIcon(fsNextBtn, ICONS.next, "Next");

    updateLoopButton();
    setIcon(volumeIconBtn, ICONS.volume, "Volume");
    setIcon(playlistOptionsBtn, ICONS.dots, "Playlist options");
}

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2); // Version 2 for new Asset store
        request.onupgradeneeded = (e) => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
            if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getStoredAsset(id) {
    if (!id) return null;
    if (typeof id === 'object' && id.assetRef) id = id.assetRef;
    if (ASSET_CACHE.has(id)) return ASSET_CACHE.get(id);

    const db = await openDb();
    return new Promise((resolve) => {
        const tx = db.transaction(ASSET_STORE, "readonly");
        const req = tx.objectStore(ASSET_STORE).get(id);
        req.onsuccess = () => {
            if (req.result) {
                const url = URL.createObjectURL(req.result);
                ASSET_CACHE.set(id, url);
                resolve(url);
            } else {
                resolve(null);
            }
        };
        req.onerror = () => resolve(null);
    });
}

function saveLibrary() {
    return new Promise(async (resolve, reject) => {
        try {
            const db = await openDb();
            const tx = db.transaction(DB_STORE, "readwrite");
            const store = tx.objectStore(DB_STORE);
            const request = store.put({ playlists, currentPlaylist, queue }, DB_KEY);

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
            tx.oncomplete = () => resolve();
        } catch (err) {
            reject(err);
        }
    });
}          const tx = db.transaction(DB_STORE, "readwrite");
            const store = tx.objectStore(DB_STORE);
            const request = store.put({ playlists, currentPlaylist, queue }, DB_KEY);

            request.onsuccess = () => resolve();
            request.onerror = (e) => {
                console.error("IndexedDB Put Error:", e);
                reject(e);
            };
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => {
                console.error("IndexedDB Transaction Error:", e);
                reject(e);
            };
        } catch (err) {
            console.error("SaveLibrary Critical Error:", err);
            reject(err);
        }
    });
}

async function loadLibrary() {
    const db = await openDb();
    return new Promise((resolve) => {
        const tx = db.transaction(DB_STORE, "readonly");
        const request = tx.objectStore(DB_STORE).get(DB_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
    });
}

function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function formatPlaylistTotalDuration(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hr ${mins % 60} min`;
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function addImageFallback(img) {
    if (!img) return;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => {
        img.src = DEFAULT_ART;
    });
}

function showPrompt({ title, message, confirmText = "OK", cancelText = "Cancel", danger = false, showCancel = true }) {
    return new Promise((resolve) => {
        confirmTitle.textContent = title;
        confirmMessage.textContent = message;
        confirmDeleteBtn.textContent = confirmText;
        confirmCancelBtn.textContent = cancelText;
        confirmCancelBtn.style.display = showCancel ? "" : "none";
        confirmDeleteBtn.classList.toggle("danger-action", danger);
        confirmOverlay.style.display = "flex";

        const close = (result) => {
            confirmOverlay.style.display = "none";
            confirmDeleteBtn.classList.remove("danger-action");
            confirmDeleteBtn.removeEventListener("click", onConfirm);
            confirmCancelBtn.removeEventListener("click", onCancel);
            confirmOverlay.removeEventListener("click", onOverlayClick);
            document.removeEventListener("keydown", onKeydown);
            resolve(result);
        };
        const onConfirm = () => close(true);
        const onCancel = () => close(false);
        const onOverlayClick = (e) => {
            if (e.target === confirmOverlay) close(false);
        };
        const onKeydown = (e) => {
            if (e.key === "Escape") close(false);
        };

        confirmDeleteBtn.addEventListener("click", onConfirm);
        confirmCancelBtn.addEventListener("click", onCancel);
        confirmOverlay.addEventListener("click", onOverlayClick);
        document.addEventListener("keydown", onKeydown);
    });
}

function showMessage(title, message) {
    return showPrompt({ title, message, confirmText: "OK", showCancel: false });
}

function getRelativeTimeString(timestamp) {
    if (!timestamp || isNaN(timestamp)) return "Recently";
    const diffInSeconds = Math.floor((Date.now() - timestamp) / 1000);
    if (diffInSeconds < 60) return "Just now";
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays <= 7) return `${diffInDays} days ago`;
    return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function findSongById(songId) {
    for (const playlistName of Object.keys(playlists)) {
        // Use loose comparison to handle string vs number IDs from different Format.py versions
        const song = playlists[playlistName].songs.find((item) => item.id == songId);
        if (song) return { song, playlistName };
    }
    return null;
}

function getCurrentPlaylistSongs() {
    return currentPlaylist && playlists[currentPlaylist] ? playlists[currentPlaylist].songs : [];
}

function getPlaybackSourceSongs() {
    return currentTrackSource && playlists[currentTrackSource] ? playlists[currentTrackSource].songs : getCurrentPlaylistSongs();
}

function safePlay() {
    const playPromise = audioPlayer.play();
    if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
            updatePlayPauseIcon();
            stopProgressLoop();
            updateMediaSessionMetadata();
        });
    }
    startProgressLoop();
    updateMediaSessionMetadata();
}

function updatePlayPauseIcon() {
    const icon = audioPlayer.paused ? ICONS.play : ICONS.pause;
    const label = audioPlayer.paused ? "Play" : "Pause";
    setIcon(playPauseBtn, icon, label);
    const fsPlayPauseBtn = document.getElementById("fs-play-pause-btn");
    if (fsPlayPauseBtn) setIcon(fsPlayPauseBtn, icon, label);
}

function updateProgressUi() {
    const time = formatTime(audioPlayer.currentTime);
    currentTimeLabel.textContent = time;
    const fsCurrentTimeLabel = document.getElementById("fs-current-time");
    if (fsCurrentTimeLabel) fsCurrentTimeLabel.textContent = time;

    if (audioPlayer.duration && !isScrubbing) {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressBar.value = progress;
        const fsProgressBar = document.getElementById("fs-progress-bar");
        if (fsProgressBar) fsProgressBar.value = progress;
    }
    updateMediaSessionPosition();
}

function startProgressLoop() {
    if (progressFrameId) return;

    const tick = () => {
        updateProgressUi();
        if (!audioPlayer.paused && !audioPlayer.ended) {
            progressFrameId = requestAnimationFrame(tick);
        } else {
            progressFrameId = null;
        }
    };

    progressFrameId = requestAnimationFrame(tick);
}

function stopProgressLoop() {
    if (!progressFrameId) return;
    cancelAnimationFrame(progressFrameId);
    progressFrameId = null;
}

function setActiveButton(button, active) {
    button.classList.toggle("is-active", active);
}

function updateLoopButton() {
    const labels = {
        off: "Loop off",
        all: "Loop playlist",
        one: "Loop current song"
    };
    const icon = loopMode === "one" ? ICONS.loopOne : ICONS.loop;
    const label = labels[loopMode];

    setIcon(loopBtn, icon, label);
    const fsLoopBtn = document.getElementById("fs-loop-btn");
    if (fsLoopBtn) {
        setIcon(fsLoopBtn, icon, label);
        setActiveButton(fsLoopBtn, loopMode !== "off");
    }

    setActiveButton(loopBtn, loopMode !== "off");
    loopBtn.dataset.loopMode = loopMode;
}

function updateMediaSessionMetadata() {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window) || !currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrackSource || "Spootify",
        artwork: [
            { src: currentTrack.art || DEFAULT_ART, sizes: "96x96", type: "image/png" },
            { src: currentTrack.art || DEFAULT_ART, sizes: "256x256", type: "image/png" },
            { src: currentTrack.art || DEFAULT_ART, sizes: "512x512", type: "image/png" }
        ]
    });
    navigator.mediaSession.playbackState = audioPlayer.paused ? "paused" : "playing";
}

function updateMediaSessionPosition() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !audioPlayer.duration) return;
    const now = Date.now();
    if (now - lastMediaSessionPositionUpdate < 1000) return;
    lastMediaSessionPositionUpdate = now;
    navigator.mediaSession.setPositionState({
        duration: audioPlayer.duration,
        playbackRate: audioPlayer.playbackRate,
        position: audioPlayer.currentTime
    });
}

function setupMediaSession() {
    if (!("mediaSession" in navigator)) return;

    const setHandler = (action, handler) => {
        try {
            navigator.mediaSession.setActionHandler(action, handler);
        } catch {
            // Some browsers expose Media Session but not every action.
        }
    };

    setHandler("play", () => {
        if (currentTrack) safePlay();
        updatePlayPauseIcon();
        updateMediaSessionMetadata();
    });
    setHandler("pause", () => {
        audioPlayer.pause();
        stopProgressLoop();
        updatePlayPauseIcon();
        updateMediaSessionMetadata();
    });
    setHandler("previoustrack", playPrevious);
    setHandler("nexttrack", playNext);
    setHandler("seekto", (details) => {
        if (!audioPlayer.duration || details.seekTime === undefined) return;
        audioPlayer.currentTime = details.seekTime;
        updateProgressUi();
        lastMediaSessionPositionUpdate = 0;
        updateMediaSessionPosition();
    });
}

function getNextPreviewSongs(limit = 8) {
    const songs = getPlaybackSourceSongs();
    if (!songs.length) return [];

    const startIndex = currentTrack ? songs.findIndex((song) => song.id === currentTrack.id) + 1 : 0;
    const preview = [];
    for (let offset = 0; offset < songs.length && preview.length < limit; offset += 1) {
        const index = (startIndex + offset) % songs.length;
        if (loopMode !== "all" && startIndex + offset >= songs.length) break;
        preview.push(songs[index]);
    }
    return preview;
}

function renderQueue() {
    if (queueList) queueList.innerHTML = "";
    const fsQueueList = document.getElementById("fs-queue-list");
    if (fsQueueList) fsQueueList.innerHTML = "";
    if (nextList) nextList.innerHTML = "";

    if (!queue.length) {
        if (queueList) queueList.innerHTML = '<div class="queue-empty">No queued songs</div>';
        if (fsQueueList) fsQueueList.innerHTML = '<div class="queue-empty">No queued songs</div>';
    }

    queue.forEach((item, index) => {
        if (queueList) {
            const row = createMiniSongRow(item.song, item.playlistName, "queue", index);
            queueList.appendChild(row);
        }
        if (fsQueueList) {
            const fsRow = createMiniSongRow(item.song, item.playlistName, "queue", index);
            fsQueueList.appendChild(fsRow);
        }
    });

    if (nextList) {
        getNextPreviewSongs().forEach((song) => {
            nextList.appendChild(createMiniSongRow(song, currentTrackSource || currentPlaylist, "next"));
        });
    }
}

function createMiniSongRow(song, playlistName, type, index = -1) {
    const row = document.createElement("div");
    row.className = `mini-song-row ${type === "queue" ? "queue-item" : ""}`;
    row.draggable = type === "queue";
    row.dataset.queueIndex = index;
    row.innerHTML = `
        <img src="${song.art || DEFAULT_ART}" alt="">
        <div>
            <strong>${song.title}</strong>
            <span>${song.artist}</span>
        </div>
    `;
    addImageFallback(row.querySelector("img"));

    if (type === "queue") {
        row.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/plain", String(index));
        });
        row.addEventListener("dragover", (e) => e.preventDefault());
        row.addEventListener("drop", async (e) => {
            e.preventDefault();
            const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
            const to = parseInt(row.dataset.queueIndex, 10);
            if (Number.isNaN(from) || Number.isNaN(to) || from === to) return;
            const [moved] = queue.splice(from, 1);
            queue.splice(to, 0, moved);
            await saveLibrary();
            renderQueue();
        });
    } else {
        row.addEventListener("click", () => playSong(song, playlistName));
    }

    attachQueueSwipe(row, index);
    return row;
}

function attachPlaylistSwipe(row, songId) {
    let startX = 0;
    let startY = 0;
    let isSwiping = false;

    row.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isSwiping = false;
        row.style.transition = "none";
    }, { passive: true });

    row.addEventListener("touchmove", (e) => {
        if (window.innerWidth > 768) return;
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const deltaX = currentX - startX;
        const deltaY = Math.abs(currentY - startY);

        if (deltaY > 30 && !isSwiping) return; // Vertical scroll

        if (deltaX > 0) {
            isSwiping = true;
            const opacity = Math.min(deltaX / 150, 0.4);
            row.style.transform = `translateX(${deltaX}px)`;
            row.style.backgroundColor = `rgba(29, 185, 84, ${opacity})`;
        }
    }, { passive: false });

    row.addEventListener("touchend", (e) => {
        row.style.transition = "transform 0.3s ease, background-color 0.3s ease";
        const endX = e.changedTouches[0].clientX;
        const deltaX = endX - startX;

        if (window.innerWidth <= 768 && deltaX > 100) {
            row.style.transform = "translateX(100%)";
            addSongToQueue(songId);
            setTimeout(() => {
                row.style.transform = "";
                row.style.backgroundColor = "";
            }, 300);
        } else {
            row.style.transform = "";
            row.style.backgroundColor = "";
        }
        isSwiping = false;
    }, { passive: true });
}

function attachQueueSwipe(row, queueIndex) {
    if (queueIndex < 0) return;
    let startX = 0;
    let startY = 0;
    let isSwiping = false;

    row.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isSwiping = false;
        row.style.transition = "none";
    }, { passive: true });

    row.addEventListener("touchmove", (e) => {
        if (window.innerWidth > 768) return;
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const deltaX = currentX - startX;
        const deltaY = Math.abs(currentY - startY);

        if (deltaY > 30 && !isSwiping) return;

        if (deltaX < 0) {
            isSwiping = true;
            const opacity = Math.min(Math.abs(deltaX) / 150, 0.4);
            row.style.transform = `translateX(${deltaX}px)`;
            row.style.backgroundColor = `rgba(214, 59, 59, ${opacity})`;
        }
    }, { passive: false });

    row.addEventListener("touchend", async (e) => {
        row.style.transition = "transform 0.3s ease, background-color 0.3s ease";
        const endX = e.changedTouches[0].clientX;
        const deltaX = endX - startX;

        if (window.innerWidth <= 768 && deltaX < -100) {
            row.style.transform = "translateX(-100%)";
            setTimeout(async () => {
                queue.splice(queueIndex, 1);
                await saveLibrary();
                renderQueue();
            }, 200);
        } else {
            row.style.transform = "";
            row.style.backgroundColor = "";
        }
        isSwiping = false;
    }, { passive: true });
}

// 3. UI SIDEBAR mechanics
toggleSidebarBtn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    setIcon(toggleSidebarBtn, sidebar.classList.contains("collapsed") ? ICONS.panelRight : ICONS.panelLeft, sidebar.classList.contains("collapsed") ? "Expand sidebar" : "Collapse sidebar");
});

homeBtn.addEventListener("click", () => {
    playlistView.style.display = "none";
    homeDashboard.style.display = "block";
});

// 4. MODAL MANAGER
function openModal(mode, trackId = null) {
    modalMode = mode;
    modalOverlay.style.display = "flex";
    modalForm.reset();

    if (mode === "playlist") {
        modalTitle.textContent = "Create Playlist";
        document.getElementById("label-1").textContent = "Playlist Name:";
        group2.style.display = "none";
        fileGroup1.style.display = "none";
        fileGroup2.style.display = "block";
        fileInputSong.required = false;
    } else if (mode === "editPlaylist") {
        activePlaylistName = currentPlaylist;
        modalTitle.textContent = "Edit Playlist";
        document.getElementById("label-1").textContent = "Playlist Name:";
        group2.style.display = "none";
        fileGroup1.style.display = "none";
        fileGroup2.style.display = "block";
        fileInputSong.required = false;
        input1.value = activePlaylistName || "";
    } else if (mode === "song") {
        modalTitle.textContent = "Add New Song";
        document.getElementById("label-1").textContent = "Song Title:";
        document.getElementById("label-2").textContent = "Artist/Author:";
        group2.style.display = "flex";
        fileGroup1.style.display = "block";
        fileGroup2.style.display = "block";
        fileInputSong.required = true;
    } else    if (mode === "edit") {
        activeTrackId = trackId;
        modalTitle.textContent = "Edit Track Details";
        document.getElementById("label-1").textContent = "Update Title:";
        document.getElementById("label-2").textContent = "Update Artist:";
        group2.style.display = "flex";
        fileGroup1.style.display = "none";
        fileGroup2.style.display = "none";
        fileInputSong.required = false;

        const currentSong = playlists[currentPlaylist].songs.find((song) => song.id == activeTrackId);
        if (currentSong) {
            input1.value = currentSong.title;
            input2.value = currentSong.artist;
        }
    }
}

function closeModal() {
    modalOverlay.style.display = "none";
}

createPlaylistBtn.addEventListener("click", () => openModal("playlist"));
addSongBtn.addEventListener("click", () => openModal("song"));
modalCancelBtn.addEventListener("click", closeModal);

modalForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (modalMode === "playlist") {
        const name = input1.value.trim();
        if (!name || playlists[name]) {
            await showMessage("Playlist conflict", "Choose a unique playlist name.");
            return;
        }

        const art = await readFileAsDataURL(fileInputArt.files[0]);
        playlists[name] = { name, songs: [], art: art || DEFAULT_ART };
        currentPlaylist = name;
        await saveLibrary();
        renderPlaylists();
        loadPlaylistPage(name);
        closeModal();
    } else if (modalMode === "editPlaylist") {
        const newName = input1.value.trim();
        if (!activePlaylistName || !playlists[activePlaylistName]) return;
        if (!newName) {
            await showMessage("Playlist needs a name", "Enter a name before saving.");
            return;
        }
        if (newName !== activePlaylistName && playlists[newName]) {
            await showMessage("Playlist conflict", "Choose a unique playlist name.");
            return;
        }

        const art = await readFileAsDataURL(fileInputArt.files[0]);
        const updatedPlaylist = {
            ...playlists[activePlaylistName],
            name: newName,
            art: art || playlists[activePlaylistName].art || DEFAULT_ART
        };

        delete playlists[activePlaylistName];
        playlists[newName] = updatedPlaylist;
        currentPlaylist = newName;
        await saveLibrary();
        renderPlaylists();
        loadPlaylistPage(newName);
        renderQueue();
        closeModal();
    } else if (modalMode === "song") {
        const title = input1.value.trim();
        const artist = input2.value.trim() || "Unknown Artist";
        const file = fileInputSong.files[0];
        if (!file) {
            await showMessage("Select a song file", "Choose an audio track before saving.");
            return;
        }

        const fileSrc = await readFileAsDataURL(file);
        const art = await readFileAsDataURL(fileInputArt.files[0]);
        const tempAudio = new Audio(fileSrc);

        tempAudio.addEventListener("loadedmetadata", async () => {
            playlists[currentPlaylist].songs.push({
                id: Date.now(),
                title,
                artist,
                timestamp: Date.now(),
                duration: tempAudio.duration,
                art: art || DEFAULT_ART,
                fileSrc
            });
            await saveLibrary();
            renderSongs();
            renderPlaylists();
            renderQueue();
            closeModal();
        });
    } else if (modalMode === "edit") {
        const targetSong = playlists[currentPlaylist].songs.find((song) => song.id == activeTrackId);
        if (targetSong) {
            targetSong.title = input1.value.trim();
            targetSong.artist = input2.value.trim() || "Unknown Artist";
        }
        await saveLibrary();
        renderSongs();
        renderQueue();
        closeModal();
    }
});

// 5. RENDERING
function renderPlaylists() {
    playlistLinks.innerHTML = "";
    playlistGrid.innerHTML = "";
    const sidebarFragment = document.createDocumentFragment();
    const gridFragment = document.createDocumentFragment();

    Object.keys(playlists).forEach((name) => {
        const targetArt = playlists[name].art || DEFAULT_ART;

        const li = document.createElement("li");
        li.className = "sidebar-playlist-item";
        li.innerHTML = `<img src="${targetArt}" alt=""><span>${name}</span>`;
        addImageFallback(li.querySelector("img"));
        li.addEventListener("click", () => loadPlaylistPage(name));
        sidebarFragment.appendChild(li);

        const card = document.createElement("div");
        card.className = "playlist-card";
        card.innerHTML = `
            <button class="playlist-card-menu dots-trigger-btn" data-playlist="${name}" aria-label="Playlist options">${ICONS.dots}</button>
            <img src="${targetArt}" alt="">
            <div>${name}</div>
            <span>${playlists[name].songs.length} songs</span>
        `;
        addImageFallback(card.querySelector("img"));
        card.addEventListener("click", (e) => {
            if (e.target.closest(".playlist-card-menu")) return;
            loadPlaylistPage(name);
        });
        gridFragment.appendChild(card);
    });

    playlistLinks.appendChild(sidebarFragment);
    playlistGrid.appendChild(gridFragment);
}

function loadPlaylistPage(name) {
    currentPlaylist = name;
    homeDashboard.style.display = "none";
    playlistView.style.display = "block";
    currentPlaylistName.textContent = name;
    playlistViewArt.src = playlists[name].art || DEFAULT_ART;
    addImageFallback(playlistViewArt);
    saveLibrary();
    renderSongs();
    renderQueue();
}

function renderSongs() {
    if (!songList) return;
    songList.innerHTML = "";
    const songs = getCurrentPlaylistSongs();
    const trackCount = songs.length;
    let totalSeconds = 0;
    try {
        totalSeconds = songs.reduce((acc, song) => acc + (song.duration || 0), 0);
    } catch (e) {
        console.error("Duration calc failed", e);
    }

    if (playlistStatsSongs) playlistStatsSongs.textContent = `${trackCount} ${trackCount === 1 ? "song" : "songs"}`;
    if (playlistStatsDuration) playlistStatsDuration.textContent = formatPlaylistTotalDuration(totalSeconds);

    const fragment = document.createDocumentFragment();
    songs.forEach((song, index) => {
        try {
            const row = document.createElement("div");
            row.className = "song-row";
            row.innerHTML = `
                <div class="col-num">
                    <span class="track-index">${index + 1}</span>
                    <button class="row-play-btn" data-id="${song.id}" aria-label="Play ${song.title}">${ICONS.play}</button>
                </div>
                <div class="col-img-space"><img src="${song.art || DEFAULT_ART}" loading="lazy" alt=""></div>
                <div class="col-title">
                    <div>${song.title || "Unknown Title"}</div>
                    <span>${song.artist || "Unknown Artist"}</span>
                </div>
                <div class="col-date">${getRelativeTimeString(song.timestamp)}</div>
                <div class="col-length">${formatTime(song.duration)}</div>
                <div class="col-dots">
                    <button class="dots-trigger-btn" data-id="${song.id}" aria-label="Track options">${ICONS.dots}</button>
                </div>
            `;
            const img = row.querySelector("img");
            img.addEventListener("error", () => { img.src = DEFAULT_ART; });
            attachPlaylistSwipe(row, song.id);
            fragment.appendChild(row);
        } catch (e) {
            console.error("Failed to render song row", e);
        }
    });

    // Add mobile spacer at the end of the list
    if (window.innerWidth <= 768) {
        const spacer = document.createElement("div");
        spacer.style.height = "180px";
        spacer.style.width = "100%";
        fragment.appendChild(spacer);
    }

    songList.appendChild(fragment);
}

// 6. PLAYBACK
function playSong(song, source = currentPlaylist) {
    if (!song || !song.fileSrc) return;

    if (currentTrack && currentTrack.id === song.id && !audioPlayer.paused) {
        audioPlayer.pause();
        stopProgressLoop();
        updatePlayPauseIcon();
        updateMediaSessionMetadata();
        return;
    }

    if (currentTrack && currentTrack.id !== song.id) {
        playbackHistory.push({ id: currentTrack.id, source: currentTrackSource });
    }

    currentTrack = song;
    currentTrackSource = source;
    audioPlayer.src = song.fileSrc;
    safePlay();
    trackArt.src = song.art || DEFAULT_ART;
    fsTrackArt.src = song.art || DEFAULT_ART;
    trackTitle.textContent = song.title;
    fsTrackTitle.textContent = song.title;
    trackArtist.textContent = song.artist;
    fsTrackArtist.textContent = song.artist;
    updatePlayPauseIcon();
    updateMediaSessionMetadata();
    renderQueue();
}

function getNextPlaylistSong() {
    const songs = getPlaybackSourceSongs();
    if (!songs.length) return null;
    if (!currentTrack) return songs[0];

    if (shuffleEnabled) {
        const playable = songs.filter((song) => song.id !== currentTrack.id);
        return playable[Math.floor(Math.random() * playable.length)] || currentTrack;
    }

    const index = songs.findIndex((song) => song.id === currentTrack.id);
    return songs[index + 1] || (loopMode === "all" ? songs[0] : null);
}

function playNext() {
    if (queue.length) {
        const nextQueued = queue.shift();
        saveLibrary();
        renderQueue();
        playSong(nextQueued.song, nextQueued.playlistName);
        return;
    }

    const nextSong = getNextPlaylistSong();
    if (nextSong) playSong(nextSong, currentTrackSource || currentPlaylist);
}

function playPrevious() {
    const previous = playbackHistory.pop();
    if (previous) {
        const found = findSongById(previous.id);
        if (found) playSong(found.song, found.playlistName);
        return;
    }

    const songs = getPlaybackSourceSongs();
    const index = songs.findIndex((song) => currentTrack && song.id === currentTrack.id);
    if (index > 0) playSong(songs[index - 1], currentTrackSource || currentPlaylist);
}

playPauseBtn.addEventListener("click", () => {
    if (!currentTrack) {
        const firstSong = queue[0]?.song || getCurrentPlaylistSongs()[0];
        if (firstSong) playSong(firstSong, queue[0]?.playlistName || currentPlaylist);
        return;
    }

    if (audioPlayer.paused) {
        safePlay();
    } else {
        audioPlayer.pause();
        stopProgressLoop();
    }
    updatePlayPauseIcon();
    updateMediaSessionMetadata();
});

shuffleBtn.addEventListener("click", () => {
    shuffleEnabled = !shuffleEnabled;
    setActiveButton(shuffleBtn, shuffleEnabled);
    renderQueue();
});

loopBtn.addEventListener("click", () => {
    loopMode = loopMode === "off" ? "all" : loopMode === "all" ? "one" : "off";
    updateLoopButton();
    renderQueue();
});

nextBtn.addEventListener("click", playNext);
prevBtn.addEventListener("click", playPrevious);

audioPlayer.addEventListener("timeupdate", () => {
    updateProgressUi();
});

audioPlayer.addEventListener("loadedmetadata", () => {
    const duration = formatTime(audioPlayer.duration);
    totalTimeLabel.textContent = duration;
    const fsTotalTimeLabel = document.getElementById("fs-total-time");
    if (fsTotalTimeLabel) fsTotalTimeLabel.textContent = duration;
    updateProgressUi();

    // Auto-fix duration in library if it was missing or estimated (like from Format.py)
    if (currentTrack && (!currentTrack.duration || currentTrack.duration === 180 || Math.abs(currentTrack.duration - audioPlayer.duration) > 2)) {
        const sourceSongs = getPlaybackSourceSongs();
        const songInLib = sourceSongs.find(s => s.id == currentTrack.id);
        if (songInLib) {
            songInLib.duration = audioPlayer.duration;
            currentTrack.duration = audioPlayer.duration;
            saveLibrary().catch(e => console.error("Auto-fix duration save failed", e));
            renderSongs();
        }
    }
});

audioPlayer.addEventListener("ended", () => {
    stopProgressLoop();
    updatePlayPauseIcon();
    updateMediaSessionMetadata();
    progressBar.value = 0;
    if (loopMode === "one" && currentTrack) {
        audioPlayer.currentTime = 0;
        safePlay();
        updatePlayPauseIcon();
        return;
    }
    playNext();
});

progressBar.addEventListener("input", () => {
    if (!audioPlayer.duration) return;
    audioPlayer.currentTime = (progressBar.value / 100) * audioPlayer.duration;
    updateProgressUi();
});

progressBar.addEventListener("pointerdown", () => {
    isScrubbing = true;
});

progressBar.addEventListener("pointerup", () => {
    isScrubbing = false;
    updateProgressUi();
    if (!audioPlayer.paused) startProgressLoop();
});

progressBar.addEventListener("change", () => {
    isScrubbing = false;
    updateProgressUi();
});

volumeBar.addEventListener("input", () => {
    audioPlayer.volume = volumeBar.value / 100;
});

clearQueueBtn.addEventListener("click", async () => {
    queue = [];
    await saveLibrary();
    renderQueue();
});

function createDedupedExport() {
    const assets = {};
    const assetIds = new Map();
    let assetCounter = 1;

    const registerAsset = (value, type) => {
        if (!value || value === DEFAULT_ART) return value;
        if (!assetIds.has(value)) {
            const id = `${type}-${assetCounter}`;
            assetCounter += 1;
            assetIds.set(value, id);
            assets[id] = { type, data: value };
        }
        return { assetRef: assetIds.get(value) };
    };

    const compactSong = (song) => ({
        ...song,
        art: registerAsset(song.art, "image"),
        fileSrc: registerAsset(song.fileSrc, "audio")
    });

    const compactPlaylists = {};
    Object.keys(playlists).forEach((name) => {
        compactPlaylists[name] = {
            ...playlists[name],
            art: registerAsset(playlists[name].art, "image"),
            songs: playlists[name].songs.map(compactSong)
        };
    });

    return {
        version: 2,
        playlists: compactPlaylists,
        currentPlaylist,
        queue: queue.map((item) => ({ ...item, song: compactSong(item.song) })),
        assets,
        exportedAt: new Date().toISOString()
    };
}

function hydrateImportedLibrary(imported) {
    if (!imported || !imported.assets) return imported || {};

    const resolveAsset = (value) => {
        if (value && typeof value === "object" && value.assetRef) {
            return imported.assets[value.assetRef]?.data || DEFAULT_ART;
        }
        return value;
    };

    const hydrateSong = (song) => {
        const fileSrc = resolveAsset(song.fileSrc);
        // Only return song if it actually has a source file
        if (!fileSrc || fileSrc === DEFAULT_ART) return null;

        return {
            ...song,
            art: resolveAsset(song.art),
            fileSrc: fileSrc
        };
    };

    const hydrated = { ...imported, playlists: {}, queue: [] };

    Object.keys(imported.playlists || {}).forEach((name) => {
        const originalPlaylist = imported.playlists[name];
        const hydratedSongs = (originalPlaylist.songs || [])
            .map(hydrateSong)
            .filter(song => song !== null); // Remove songs without audio

        hydrated.playlists[name] = {
            ...originalPlaylist,
            art: resolveAsset(originalPlaylist.art),
            songs: hydratedSongs
        };
    });

    hydrated.queue = (imported.queue || [])
        .map((item) => {
            const hSong = hydrateSong(item.song);
            return hSong ? { ...item, song: hSong } : null;
        })
        .filter(item => item !== null);

    return hydrated;
}

exportLibraryBtn.addEventListener("click", () => {
    const payload = JSON.stringify(createDedupedExport());
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "spootify-library.json";
    link.click();
    URL.revokeObjectURL(url);
});

importLibraryInput.addEventListener("change", async () => {
    const file = importLibraryInput.files[0];
    if (!file) return;

    // Check file size and warn if it's over 400MB
    if (file.size > 400 * 1024 * 1024) {
        const proceed = await showPrompt({
            title: "Large File Warning",
            message: "This file is very large and might crash the app. It's recommended to use files under 300MB. Do you want to try anyway?",
            confirmText: "Try Anyway",
            cancelText: "Cancel"
        });
        if (!proceed) {
            importLibraryInput.value = "";
            return;
        }
    }

    try {
        const confirmed = await showPrompt({
            title: "Import Method",
            message: "How would you like to import these playlists?",
            confirmText: "Append & Merge",
            cancelText: "Replace Library"
        });

        // Show a simple loading indicator
        confirmTitle.textContent = "Optimizing...";
        confirmMessage.textContent = "Converting to High-Performance storage. This saves massive space!";
        confirmDeleteBtn.style.display = "none";
        confirmCancelBtn.style.display = "none";

        const text = await file.text();
        const imported = JSON.parse(text);
        const db = await openDb();

        // 1. Process Assets into the Asset Store (Binary Blobs)
        const assetMap = imported.assets || {};
        const assetKeys = Object.keys(assetMap);

        for (const key of assetKeys) {
            const assetData = assetMap[key].data;
            if (assetData && assetData.startsWith("data:")) {
                const blob = await base64ToBlob(assetData);
                const tx = db.transaction(ASSET_STORE, "readwrite");
                tx.objectStore(ASSET_STORE).put(blob, key);
            }
        }

        // 2. Clear out the giant base64 data from the import to save RAM
        delete imported.assets;

        // 3. Merge Playlists
        if (confirmed) {
            Object.keys(imported.playlists || {}).forEach(name => {
                if (playlists[name]) {
                    const existingIds = new Set(playlists[name].songs.map(s => String(s.id)));
                    const newSongs = (imported.playlists[name].songs || []).filter(s => !existingIds.has(String(s.id)));
                    playlists[name].songs = [...playlists[name].songs, ...newSongs];
                } else {
                    playlists[name] = imported.playlists[name];
                }
            });
        } else {
            playlists = imported.playlists || {};
        }

        await saveLibrary();
        renderPlaylists();
        if (currentPlaylist) loadPlaylistPage(currentPlaylist);

        confirmOverlay.style.display = "none"; // Hide loading
        await showMessage("Success", "Library updated!");

    } catch (err) {
        console.error("Import failure:", err);
        confirmOverlay.style.display = "none";
        if (err.name === "QuotaExceededError" || (err.message && err.message.includes("quota"))) {
            await showMessage("Storage Full", "Your phone's browser storage limit has been reached. Try using smaller images in your source folder.");
        } else {
            await showMessage("Import failed", "The file was too large or there was a storage error.");
        }
    } finally {
        importLibraryInput.value = "";
        confirmDeleteBtn.style.display = ""; // Reset buttons
        confirmCancelBtn.style.display = "";
    }
});

// 7. CONTEXT MENU
function addSongToQueue(songId) {
    const found = findSongById(songId);
    if (!found) return;
    queue.push(found);
    saveLibrary();
    renderQueue();

    // Visual feedback
    const rows = document.querySelectorAll(`.song-row [data-id="${songId}"]`);
    rows.forEach(btn => {
        const row = btn.closest(".song-row");
        if (row) {
            row.classList.add("added-to-queue");
            setTimeout(() => row.classList.remove("added-to-queue"), 600);
        }
    });
}

function copySongToPlaylist(songId, targetPlaylistName) {
    const found = findSongById(songId);
    if (!found || !playlists[targetPlaylistName]) return;

    playlists[targetPlaylistName].songs.push({
        ...found.song,
        id: Date.now(),
        timestamp: Date.now()
    });
    saveLibrary();
    renderSongs();
    renderPlaylists();
}

async function deletePlaylist(name) {
    if (!playlists[name]) return;
    const confirmed = await showPrompt({
        title: "Delete playlist?",
        message: `Delete "${name}"? Songs copied to other playlists will stay there.`,
        confirmText: "Delete",
        danger: true
    });
    if (!confirmed) return;

    delete playlists[name];
    queue = queue.filter((item) => item.playlistName !== name);
    if (currentPlaylist === name) {
        currentPlaylist = Object.keys(playlists)[0] || null;
    }
    await saveLibrary();
    renderPlaylists();
    renderQueue();

    if (currentPlaylist) {
        loadPlaylistPage(currentPlaylist);
    } else {
        playlistView.style.display = "none";
        homeDashboard.style.display = "block";
    }
}

function openPlaylistMenu(name, x, y) {
    const existingMenu = document.getElementById("active-context-menu");
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement("div");
    menu.id = "active-context-menu";
    menu.className = "context-menu";
    menu.innerHTML = `
        <button class="context-menu-item" id="ctx-playlist-open">Open</button>
        <button class="context-menu-item" id="ctx-playlist-repair">Repair Song Lengths</button>
        <button class="context-menu-item" id="ctx-playlist-edit">Edit playlist</button>
        <button class="context-menu-item danger" id="ctx-playlist-delete">Delete playlist</button>
    `;
    menu.style.top = `${y + window.scrollY}px`;
    menu.style.left = `${Math.max(10, x - 180 + window.scrollX)}px`;
    document.body.appendChild(menu);

    document.getElementById("ctx-playlist-open").addEventListener("click", () => {
        loadPlaylistPage(name);
        menu.remove();
    });
    document.getElementById("ctx-playlist-repair").addEventListener("click", () => {
        repairPlaylistDurations(name);
        menu.remove();
    });
    document.getElementById("ctx-playlist-edit").addEventListener("click", () => {
        currentPlaylist = name;
        openModal("editPlaylist");
        menu.remove();
    });
    document.getElementById("ctx-playlist-delete").addEventListener("click", () => {
        deletePlaylist(name);
        menu.remove();
    });
}

async function repairPlaylistDurations(playlistName) {
    const p = playlists[playlistName];
    if (!p || !p.songs.length) return;

    await showMessage("Repairing...", "This will scan all songs in this playlist to fix their lengths. Please wait.");

    const tempAudio = new Audio();
    for (let song of p.songs) {
        if (!song.fileSrc) continue;
        await new Promise(resolve => {
            tempAudio.src = song.fileSrc;
            tempAudio.onloadedmetadata = () => {
                song.duration = tempAudio.duration;
                resolve();
            };
            tempAudio.onerror = () => resolve();
            // Timeout after 2 seconds per song to avoid hanging
            setTimeout(resolve, 2000);
        });
    }

    await saveLibrary();
    renderSongs();
    await showMessage("Done!", "All song lengths have been updated.");
}

document.addEventListener("click", (e) => {
    const existingMenu = document.getElementById("active-context-menu");
    if (existingMenu) existingMenu.remove();

    const playlistMenuBtn = e.target.closest(".playlist-card-menu");
    if (playlistMenuBtn) {
        e.stopPropagation();
        openPlaylistMenu(playlistMenuBtn.getAttribute("data-playlist"), e.clientX, e.clientY);
        return;
    }

    if (e.target.closest("#playlist-options-btn") && currentPlaylist) {
        e.stopPropagation();
        openPlaylistMenu(currentPlaylist, e.clientX, e.clientY);
        return;
    }

    const rowPlayBtn = e.target.closest(".row-play-btn");
    if (rowPlayBtn) {
        const clickedId = rowPlayBtn.getAttribute("data-id");
        const song = playlists[currentPlaylist].songs.find((item) => item.id == clickedId);
        playSong(song, currentPlaylist);
        return;
    }

    const dotsBtn = e.target.closest(".dots-trigger-btn");
    if (!dotsBtn) return;

    e.stopPropagation();
    const clickedId = dotsBtn.getAttribute("data-id");
    const menu = document.createElement("div");
    menu.id = "active-context-menu";
    menu.className = "context-menu";

    const playlistItems = Object.keys(playlists)
        .filter((name) => name !== currentPlaylist)
        .map((name) => `<button class="context-menu-item add-to-playlist-item" data-playlist="${name}">${name}</button>`)
        .join("");

    menu.innerHTML = `
        <button class="context-menu-item" id="ctx-queue">Add to queue</button>
        <div class="context-menu-group">
            <button class="context-menu-item" id="ctx-add-playlist">Add to playlist</button>
            <div class="context-submenu">${playlistItems || '<div class="context-menu-empty">No other playlists</div>'}</div>
        </div>
        <button class="context-menu-item" id="ctx-edit">Edit details</button>
        <button class="context-menu-item danger" id="ctx-remove">Remove track</button>
    `;
    menu.style.top = `${e.clientY + window.scrollY}px`;
    menu.style.left = `${e.clientX - 180 + window.scrollX}px`;
    document.body.appendChild(menu);

    document.getElementById("ctx-queue").addEventListener("click", () => {
        addSongToQueue(clickedId);
        menu.remove();
    });

    document.getElementById("ctx-remove").addEventListener("click", async () => {
        playlists[currentPlaylist].songs = playlists[currentPlaylist].songs.filter((song) => song.id != clickedId);
        await saveLibrary();
        renderSongs();
        renderPlaylists();
        menu.remove();
    });

    document.getElementById("ctx-edit").addEventListener("click", () => {
        openModal("edit", clickedId);
        menu.remove();
    });

    menu.querySelectorAll(".add-to-playlist-item").forEach((item) => {
        item.addEventListener("click", () => {
            copySongToPlaylist(clickedId, item.getAttribute("data-playlist"));
            menu.remove();
        });
    });
});

async function boot() {
    // Register Service Worker for background playback support
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.log("SW failed", err));
    }

    applyIcons();
    setupMediaSession();
    audioPlayer.volume = volumeBar.value / 100;
    trackArt.src = DEFAULT_ART;
    if (typeof fsTrackArt !== 'undefined') fsTrackArt.src = DEFAULT_ART;
    addImageFallback(trackArt);
    if (typeof fsTrackArt !== 'undefined') addImageFallback(fsTrackArt);

    // Mobile Listeners
    if (miniPlayer) {
        miniPlayer.addEventListener("click", (e) => {
            // Only open FS player on mobile and if not clicking a control button
            if (window.innerWidth <= 768 && !e.target.closest(".controls-container")) {
                fsPlayer.classList.add("active");
            }
        });
    }
    if (fsCloseBtn) fsCloseBtn.addEventListener("click", () => fsPlayer.classList.remove("active"));
    if (fsPlayPauseBtn) fsPlayPauseBtn.addEventListener("click", () => playPauseBtn.click());
    if (fsPrevBtn) fsPrevBtn.addEventListener("click", () => prevBtn.click());
    if (fsNextBtn) fsNextBtn.addEventListener("click", () => nextBtn.click());
    if (fsShuffleBtn) fsShuffleBtn.addEventListener("click", () => shuffleBtn.click());
    if (fsLoopBtn) fsLoopBtn.addEventListener("click", () => loopBtn.click());
    if (fsProgressBar) {
        fsProgressBar.addEventListener("input", () => {
            if (!audioPlayer.duration) return;
            audioPlayer.currentTime = (fsProgressBar.value / 100) * audioPlayer.duration;
            updateProgressUi();
        });
    }

    if (navHome) {
        navHome.addEventListener("click", () => {
            homeBtn.click();
            navHome.classList.add("active");
            navCreate.classList.remove("active");
        });
    }
    if (navCreate) {
        navCreate.addEventListener("click", () => {
            createPlaylistBtn.click();
        });
    }
    if (mobileBackBtn) mobileBackBtn.addEventListener("click", () => homeBtn.click());

    const saved = await loadLibrary();
    if (saved) {
        playlists = saved.playlists || {};
        currentPlaylist = saved.currentPlaylist || null;
        queue = saved.queue || [];
    }

    renderPlaylists();
    if (currentPlaylist && playlists[currentPlaylist]) {
        loadPlaylistPage(currentPlaylist);
    }
    renderQueue();
}

boot();
