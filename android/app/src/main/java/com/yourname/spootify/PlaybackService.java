package com.yourname.spootify;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.session.MediaButtonReceiver;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Foreground service backing the WebView's HTML5 audio playback, and the media browser
 * that Android Auto (and other car / watch / system media UIs) connect to.
 *
 * The WebView itself has no foreground service and no wake lock, so with the
 * screen off Android freezes the process as soon as the current track's audio
 * buffer drains and the JS "ended" -> next-track hand-off never runs. This
 * service:
 *  - runs as a mediaPlayback foreground service while a track is loaded, which
 *    keeps the process out of the cached/frozen state
 *  - holds a PARTIAL_WAKE_LOCK while playing (released a few seconds after a
 *    pause so the gap between tracks never lets the CPU suspend)
 *  - owns a MediaSession so lock screen / headset / Bluetooth / car controls reach
 *    the web app through {@link BackgroundAudioPlugin}
 *  - serves a browse tree (Playlists, Liked Songs, Recently played) built from a
 *    snapshot of the library the web app pushes (and that is kept on disk, so a car
 *    can browse before the app has started). Choosing a song, searching or picking
 *    from the queue is forwarded to the web app, which does the playing.
 *
 * All actual audio decoding still happens in the WebView.
 */
public class PlaybackService extends MediaBrowserServiceCompat {
    private static final String TAG = "SpootifyPlayback";
    static final String CHANNEL_ID = "spootify_playback";
    static final int NOTIFICATION_ID = 0x5900;

    static final String ACTION_UPDATE = "com.yourname.spootify.action.UPDATE";
    static final String ACTION_STOP = "com.yourname.spootify.action.STOP";
    static final String ACTION_LIKE = "com.yourname.spootify.action.LIKE";
    private static final String CUSTOM_ACTION_CLOSE = "com.yourname.spootify.action.CLOSE";
    private static final String CUSTOM_ACTION_LIKE = "com.yourname.spootify.action.LIKE_TOGGLE";
    private static final String CUSTOM_ACTION_SHUFFLE = "com.yourname.spootify.action.SHUFFLE_TOGGLE";

    static final String EXTRA_TITLE = "title";
    static final String EXTRA_ARTIST = "artist";
    static final String EXTRA_PLAYING = "playing";
    static final String EXTRA_POSITION_MS = "positionMs";
    static final String EXTRA_DURATION_MS = "durationMs";
    static final String EXTRA_RATE = "rate";
    static final String EXTRA_ART_BASE64 = "artBase64";
    static final String EXTRA_QUEUE_JSON = "queueJson";
    static final String EXTRA_ALBUM = "album";
    static final String EXTRA_LIKED = "liked";
    static final String EXTRA_SHUFFLE = "shuffle";

    /** How long after a pause the wake lock is kept, so a track transition never hits a sleeping CPU. */
    private static final long WAKE_LOCK_LINGER_MS = 5_000L;
    /** Safety timeout: the lock is re-armed on every playing update, so this only matters if the web side dies silently. */
    private static final long WAKE_LOCK_TIMEOUT_MS = 6L * 60L * 60L * 1000L;
    /** A car asked for something while the app wasn't running: how long to wait for it to open. */
    private static final long WAKE_APP_TIMEOUT_MS = 9_000L;

    // Browse tree ids. Songs are "song|<source>|<song id>" (source: a playlist name,
    // "liked:" or "recent:"); "shuffle|<source>" shuffles a whole source.
    private static final String ROOT_ID = "root";
    private static final String EMPTY_ROOT_ID = "empty";
    private static final String TAB_PLAYLISTS = "tab:playlists";
    private static final String TAB_LIKED = "tab:liked";
    private static final String TAB_RECENT = "tab:recent";
    private static final String PLAYLIST_PREFIX = "pl:";
    private static final String LIBRARY_FILE = "auto-library.json";
    // Content style hints (androidx.media.utils.MediaConstants) spelled out, so no extra library is needed.
    private static final String STYLE_SUPPORTED = "android.media.browse.CONTENT_STYLE_SUPPORTED";
    private static final String STYLE_BROWSABLE = "android.media.browse.CONTENT_STYLE_BROWSABLE_HINT";
    private static final String STYLE_PLAYABLE = "android.media.browse.CONTENT_STYLE_PLAYABLE_HINT";
    private static final String SEARCH_SUPPORTED = "android.media.browse.SEARCH_SUPPORTED";
    private static final int STYLE_LIST = 1;
    private static final int STYLE_GRID = 2;

    public interface Listener {
        void onMediaAction(String action, long positionMs, @Nullable String arg);
    }

    private static volatile Listener listener;
    private static volatile PlaybackService instance;
    private static volatile JSONObject library;          // last snapshot from the web app
    private static String pendingAction, pendingArg;     // a car's request waiting for the app to open
    /** startForegroundService() was called and startForeground() hasn't run yet: the service must not stop before it does. */
    static volatile boolean startPending = false;
    /** stop() arrived while a start was pending: shut down right after promoting. */
    static volatile boolean stopWhenStarted = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private MediaSessionCompat session;
    private PowerManager.WakeLock wakeLock;
    private final Runnable releaseWakeLockRunnable = this::releaseWakeLock;
    private final Runnable wakeAppTimeout = this::showOpenAppError;

    private String title = "Spootify";
    private String artist = "";
    private String album = "";       // the playlist it's playing from, shown under the artist
    private boolean liked = false;   // lock-screen heart
    private boolean shuffle = false; // lock-screen shuffle button
    private boolean playing = false;
    private long positionMs = 0;
    private long durationMs = 0;
    private float rate = 1f;
    private Bitmap art;
    private String artKey;
    private String lastNotificationKey;
    private boolean started = false;
    private boolean hasTrack = false;

    public static PlaybackService getInstance() { return instance; }

    /** The plugin (and so the WebView) came or went. A car request waiting for it is handed over. */
    public static void setListener(Listener l) {
        listener = l;
        PlaybackService svc = instance;
        if (l != null && svc != null) svc.mainHandler.post(svc::deliverPending);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();

        session = new MediaSessionCompat(this, "SpootifySession");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { dispatch("play", null); }
            @Override public void onPause() { dispatch("pause", null); }
            @Override public void onSkipToNext() { dispatch("next", null); }
            @Override public void onSkipToPrevious() { dispatch("previous", null); }
            @Override public void onStop() { stopRequested(); }
            @Override public void onSeekTo(long pos) { positionMs = pos; dispatch("seek", null); }
            @Override public void onPlayFromMediaId(String mediaId, Bundle extras) { dispatch("playFromMediaId", mediaId); }
            @Override public void onPlayFromSearch(String query, Bundle extras) { dispatch("playFromSearch", query != null ? query : ""); }
            @Override public void onSkipToQueueItem(long id) { dispatch("skipToQueueItem", String.valueOf(id)); }
            @Override public void onCustomAction(String action, Bundle extras) {
                if (CUSTOM_ACTION_CLOSE.equals(action)) stopRequested();
                else if (CUSTOM_ACTION_LIKE.equals(action)) toggleLiked();
                else if (CUSTOM_ACTION_SHUFFLE.equals(action)) {
                    // Flipped here at once so the button answers the tap; the page confirms with its next update.
                    shuffle = !shuffle;
                    session.setPlaybackState(buildPlaybackState());
                    dispatch("shuffle", shuffle ? "1" : "0");
                }
            }
        });
        session.setPlaybackState(buildPlaybackState());
        setSessionToken(session.getSessionToken());

        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Spootify:playback");
        wakeLock.setReferenceCounted(false);

        if (library == null) library = readLibraryFile(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        started = true;
        String action = intent != null ? intent.getAction() : null;
        if (stopWhenStarted) {
            ensureForeground();
            stopWhenStarted = false;
            shutdown();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(action)) {
            stopRequested();
            return START_NOT_STICKY;
        }
        if (ACTION_LIKE.equals(action)) {
            toggleLiked();
            return START_NOT_STICKY;
        }
        if (Intent.ACTION_MEDIA_BUTTON.equals(action)) {
            // Started via PendingIntent.getForegroundService(): must promote promptly.
            ensureForeground();
            MediaButtonReceiver.handleIntent(session, intent);
            return START_NOT_STICKY;
        }
        if (ACTION_UPDATE.equals(action) && intent.getExtras() != null) {
            Bundle b = intent.getExtras();
            update(b.getString(EXTRA_TITLE, title), b.getString(EXTRA_ARTIST, artist), b.getBoolean(EXTRA_PLAYING, false),
                    b.getLong(EXTRA_POSITION_MS, 0), b.getLong(EXTRA_DURATION_MS, 0), b.getFloat(EXTRA_RATE, 1f),
                    b.getString(EXTRA_ART_BASE64, null), b.getString(EXTRA_ALBUM, ""), b.getBoolean(EXTRA_LIKED, false), b.getBoolean(EXTRA_SHUFFLE, false));
            String queueJson = b.getString(EXTRA_QUEUE_JSON, null);
            if (queueJson != null) { try { setQueue(new JSONArray(queueJson)); } catch (Exception ignored) {} }
        } else {
            ensureForeground();
        }
        return START_NOT_STICKY;
    }

    /** Full state push from the web side. Safe to call from any thread. */
    public void update(String newTitle, String newArtist, boolean isPlaying, long posMs, long durMs, float playbackRate, String artBase64,
                       String newAlbum, boolean isLiked, boolean isShuffle) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(() -> update(newTitle, newArtist, isPlaying, posMs, durMs, playbackRate, artBase64, newAlbum, isLiked, isShuffle));
            return;
        }
        title = newTitle != null && !newTitle.isEmpty() ? newTitle : "Spootify";
        artist = newArtist != null ? newArtist : "";
        album = newAlbum != null ? newAlbum : "";
        liked = isLiked;
        shuffle = isShuffle;
        playing = isPlaying;
        positionMs = Math.max(0, posMs);
        durationMs = Math.max(0, durMs);
        rate = playbackRate > 0 ? playbackRate : 1f;
        hasTrack = true;
        mainHandler.removeCallbacks(wakeAppTimeout);
        decodeArt(artBase64);

        session.setMetadata(buildMetadata());
        session.setPlaybackState(buildPlaybackState());
        session.setActive(true);

        if (playing) acquireWakeLock(); else scheduleWakeLockRelease();
        if (!started) {
            // Running only because a car is connected (bound, never started): become a
            // started service so playback outlives the car disconnecting.
            try { startPending = true; ContextCompat.startForegroundService(this, new Intent(this, PlaybackService.class)); } catch (Exception e) { startPending = false; Log.w(TAG, "start failed", e); }
        }
        ensureForeground();
    }

    /** Lightweight position/rate sync; does not re-post the notification unless play state flipped. */
    public void setPosition(boolean isPlaying, long posMs, float playbackRate) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(() -> setPosition(isPlaying, posMs, playbackRate));
            return;
        }
        boolean stateChanged = playing != isPlaying;
        playing = isPlaying;
        positionMs = Math.max(0, posMs);
        rate = playbackRate > 0 ? playbackRate : 1f;
        session.setPlaybackState(buildPlaybackState());
        if (playing) acquireWakeLock(); else scheduleWakeLockRelease();
        if (stateChanged) ensureForeground();
    }

    /** What plays next, for the queue screen in a car: [{ title, artist }], the playing song first. */
    public void setQueue(@Nullable JSONArray items) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(() -> setQueue(items));
            return;
        }
        if (session == null) return;
        if (items == null || items.length() == 0) { session.setQueue(null); return; }
        List<MediaSessionCompat.QueueItem> queue = new ArrayList<>();
        for (int i = 0; i < items.length() && i < 50; i++) {
            JSONObject o = items.optJSONObject(i);
            if (o == null) continue;
            MediaDescriptionCompat d = new MediaDescriptionCompat.Builder()
                    .setMediaId("queue|" + i)
                    .setTitle(o.optString("title", "Unknown"))
                    .setSubtitle(o.optString("artist", ""))
                    .build();
            queue.add(new MediaSessionCompat.QueueItem(d, i));
        }
        session.setQueueTitle("Up next");
        session.setQueue(queue);
        session.setPlaybackState(buildPlaybackState());
    }

    /** Tear everything down: notification, session, wake lock, service. */
    public void shutdown() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(this::shutdown);
            return;
        }
        // Stopping between startForegroundService() and startForeground() kills the app.
        if (startPending) ensureForeground();
        playing = false;
        hasTrack = false;
        started = false;
        mainHandler.removeCallbacks(releaseWakeLockRunnable);
        releaseWakeLock();
        if (session != null) {
            session.setPlaybackState(new PlaybackStateCompat.Builder()
                    .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID | PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH)
                    .setState(PlaybackStateCompat.STATE_STOPPED, 0, 0f).build());
            session.setActive(false);
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        NotificationManagerCompat.from(this).cancel(NOTIFICATION_ID);
        stopSelf(); // a connected car keeps it alive (bound) for browsing
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The activity (and with it the WebView doing the actual playback) is gone.
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(releaseWakeLockRunnable);
        mainHandler.removeCallbacks(wakeAppTimeout);
        releaseWakeLock();
        if (session != null) { session.release(); session = null; }
        art = null;
        instance = null;
        super.onDestroy();
    }

    // ── media browser (Android Auto) ──

    @Nullable
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        // "Recent" roots are for resuming playback after a reboot, which needs the app open: not offered.
        if (rootHints != null && rootHints.getBoolean(BrowserRoot.EXTRA_RECENT)) return null;
        if (!isTrustedCaller(clientPackageName, clientUid)) return new BrowserRoot(EMPTY_ROOT_ID, null);
        Bundle extras = new Bundle();
        extras.putBoolean(STYLE_SUPPORTED, true);
        extras.putInt(STYLE_BROWSABLE, STYLE_LIST);
        extras.putInt(STYLE_PLAYABLE, STYLE_LIST);
        extras.putBoolean(SEARCH_SUPPORTED, true);
        return new BrowserRoot(ROOT_ID, extras);
    }

    /** Your library's names only go to the system, cars and voice assistants, not to any app that asks. */
    private boolean isTrustedCaller(String pkg, int uid) {
        if (uid == android.os.Process.myUid() || uid == android.os.Process.SYSTEM_UID) return true;
        if (pkg == null) return false;
        switch (pkg) {
            case "com.google.android.projection.gearhead":   // Android Auto
            case "com.google.android.carassistant":           // Android Automotive
            case "com.android.car.media":
            case "com.google.android.googlequicksearchbox":   // Google Assistant
            case "com.google.android.apps.googleassistant":
            case "com.google.android.wearable.app":           // Wear OS
            case "com.android.systemui":
            case "com.android.bluetooth":
                return true;
            default:
                return false;
        }
    }

    @Override
    public void onLoadChildren(@NonNull String parentId, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        JSONObject lib = library;
        try {
            if (ROOT_ID.equals(parentId)) {
                items.add(browsable(TAB_PLAYLISTS, "Playlists", null));
                items.add(browsable(TAB_LIKED, "Liked Songs", null));
                items.add(browsable(TAB_RECENT, "Recently played", null));
            } else if (lib != null && TAB_PLAYLISTS.equals(parentId)) {
                JSONArray pls = lib.optJSONArray("playlists");
                for (int i = 0; pls != null && i < pls.length(); i++) {
                    JSONObject pl = pls.optJSONObject(i); if (pl == null) continue;
                    String name = pl.optString("name", "");
                    JSONArray songs = pl.optJSONArray("songs");
                    int n = songs != null ? songs.length() : 0;
                    items.add(browsable(PLAYLIST_PREFIX + name, (pl.optBoolean("pinned") ? "★ " : "") + name, n + (n == 1 ? " song" : " songs")));
                }
            } else if (lib != null && parentId.startsWith(PLAYLIST_PREFIX)) {
                String name = parentId.substring(PLAYLIST_PREFIX.length());
                JSONArray songs = playlistSongs(lib, name);
                if (songs != null && songs.length() > 1) items.add(playable("shuffle|" + name, "Shuffle play", name));
                addSongs(items, songs, name);
            } else if (lib != null && TAB_LIKED.equals(parentId)) {
                JSONArray songs = lib.optJSONArray("liked");
                if (songs != null && songs.length() > 1) items.add(playable("shuffle|liked:", "Shuffle play", "Liked Songs"));
                addSongs(items, songs, "liked:");
            } else if (lib != null && TAB_RECENT.equals(parentId)) {
                addSongs(items, lib.optJSONArray("recent"), "recent:");
            }
        } catch (Exception e) {
            Log.w(TAG, "browse failed for " + parentId, e);
        }
        result.sendResult(items);
    }

    @Override
    public void onSearch(@NonNull String query, @Nullable Bundle extras, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        JSONObject lib = library;
        String q = query.trim().toLowerCase(Locale.ROOT);
        if (lib != null && !q.isEmpty()) {
            JSONArray pls = lib.optJSONArray("playlists");
            java.util.HashSet<String> seen = new java.util.HashSet<>();
            for (int i = 0; pls != null && i < pls.length() && items.size() < 60; i++) {
                JSONObject pl = pls.optJSONObject(i); if (pl == null) continue;
                String name = pl.optString("name", "");
                JSONArray songs = pl.optJSONArray("songs");
                for (int j = 0; songs != null && j < songs.length() && items.size() < 60; j++) {
                    JSONArray s = songs.optJSONArray(j); if (s == null) continue;
                    String t = s.optString(1, ""), a = s.optString(2, "");
                    String key = (t + "\u0001" + a).toLowerCase(Locale.ROOT);
                    if (seen.contains(key)) continue;
                    if (t.toLowerCase(Locale.ROOT).contains(q) || a.toLowerCase(Locale.ROOT).contains(q)) {
                        seen.add(key);
                        items.add(playable("song|" + name + "|" + s.optString(0, ""), t, a));
                    }
                }
            }
        }
        result.sendResult(items);
    }

    private static JSONArray playlistSongs(JSONObject lib, String name) {
        JSONArray pls = lib.optJSONArray("playlists");
        for (int i = 0; pls != null && i < pls.length(); i++) {
            JSONObject pl = pls.optJSONObject(i);
            if (pl != null && name.equals(pl.optString("name"))) return pl.optJSONArray("songs");
        }
        return null;
    }

    /** Songs are [id, title, artist, seconds(, playlist they live in)]. */
    private static void addSongs(List<MediaBrowserCompat.MediaItem> items, @Nullable JSONArray songs, String source) {
        for (int i = 0; songs != null && i < songs.length() && i < 500; i++) {
            JSONArray s = songs.optJSONArray(i); if (s == null) continue;
            items.add(playable("song|" + source + "|" + s.optString(0, ""), s.optString(1, "Unknown"), s.optString(2, "")));
        }
    }

    private static MediaBrowserCompat.MediaItem browsable(String id, String title, @Nullable String subtitle) {
        MediaDescriptionCompat d = new MediaDescriptionCompat.Builder().setMediaId(id).setTitle(title).setSubtitle(subtitle).build();
        return new MediaBrowserCompat.MediaItem(d, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private static MediaBrowserCompat.MediaItem playable(String id, String title, @Nullable String subtitle) {
        MediaDescriptionCompat d = new MediaDescriptionCompat.Builder().setMediaId(id).setTitle(title).setSubtitle(subtitle).build();
        return new MediaBrowserCompat.MediaItem(d, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    /** A new snapshot of the library from the web app: kept, written to disk, and cars told to refresh. */
    static void setLibrary(Context ctx, String json) {
        JSONObject parsed;
        try { parsed = new JSONObject(json); } catch (Exception e) { Log.w(TAG, "bad library snapshot", e); return; }
        library = parsed;
        try (FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), LIBRARY_FILE))) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.w(TAG, "could not save the library snapshot", e);
        }
        PlaybackService svc = instance;
        if (svc != null) svc.mainHandler.post(() -> {
            svc.notifyChildrenChanged(ROOT_ID);
            svc.notifyChildrenChanged(TAB_PLAYLISTS);
            svc.notifyChildrenChanged(TAB_LIKED);
            svc.notifyChildrenChanged(TAB_RECENT);
        });
    }

    @Nullable
    private static JSONObject readLibraryFile(Context ctx) {
        File f = new File(ctx.getFilesDir(), LIBRARY_FILE);
        if (!f.exists()) return null;
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int read = 0;
            while (read < buf.length) { int n = in.read(buf, read, buf.length - read); if (n < 0) break; read += n; }
            return new JSONObject(new String(buf, 0, read, StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.w(TAG, "could not read the library snapshot", e);
            return null;
        }
    }

    // ── internals ──

    /** The heart on the lock screen / notification: flipped at once, the page saves it. */
    private void toggleLiked() {
        liked = !liked;
        if (session != null) session.setPlaybackState(buildPlaybackState());
        if (hasTrack) ensureForeground();
        dispatch("like", liked ? "1" : "0");
    }

    /** User closed/swiped the notification or hit Stop: pause the web side and go away. */
    private void stopRequested() {
        dispatch("stop", null);
        shutdown();
    }

    private void dispatch(String action, @Nullable String arg) {
        Listener l = listener;
        if (l != null) {
            l.onMediaAction(action, positionMs, arg);
            return;
        }
        if ("stop".equals(action) || "pause".equals(action)) return;
        // Nothing to play with (the app isn't running, e.g. a car connected first): keep the
        // request, try to open the app, and say so in the car if it doesn't come up.
        pendingAction = action; pendingArg = arg;
        Log.w(TAG, "Media action '" + action + "' with no web app; opening it");
        try {
            Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(open);
        } catch (Exception e) {
            Log.w(TAG, "could not open the app", e);
        }
        if (session != null) session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID | PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH)
                .setState(PlaybackStateCompat.STATE_CONNECTING, 0, 0f).build());
        mainHandler.removeCallbacks(wakeAppTimeout);
        mainHandler.postDelayed(wakeAppTimeout, WAKE_APP_TIMEOUT_MS);
    }

    private void deliverPending() {
        Listener l = listener;
        if (l == null || pendingAction == null) return;
        String action = pendingAction, arg = pendingArg;
        pendingAction = null; pendingArg = null;
        mainHandler.removeCallbacks(wakeAppTimeout);
        l.onMediaAction(action, positionMs, arg);
    }

    private void showOpenAppError() {
        if (listener != null || session == null) return;
        pendingAction = null; pendingArg = null;
        if (started && !hasTrack) {
            // Woken by a headset button with the app closed: don't leave a notification
            // that can't do anything. (A connected car keeps the service, bound, for browsing.)
            stopForeground(STOP_FOREGROUND_REMOVE);
            NotificationManagerCompat.from(this).cancel(NOTIFICATION_ID);
            started = false;
            stopSelf();
        }
        session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID | PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH)
                .setErrorMessage(PlaybackStateCompat.ERROR_CODE_APP_ERROR, "Open Spootify on your phone, then try again")
                .setState(PlaybackStateCompat.STATE_ERROR, 0, 0f).build());
    }

    private void acquireWakeLock() {
        mainHandler.removeCallbacks(releaseWakeLockRunnable);
        try {
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS); // non-ref-counted: re-arms the timeout
        } catch (Exception e) {
            Log.w(TAG, "wakeLock.acquire failed", e);
        }
    }

    private void scheduleWakeLockRelease() {
        mainHandler.removeCallbacks(releaseWakeLockRunnable);
        mainHandler.postDelayed(releaseWakeLockRunnable, WAKE_LOCK_LINGER_MS);
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception e) {
            Log.w(TAG, "wakeLock.release failed", e);
        }
    }

    private void decodeArt(String base64) {
        if (base64 == null || base64.isEmpty()) {
            art = null; // not recycled: the session's metadata or a notification may still parcel it
            artKey = null;
            return;
        }
        // Cheap identity check so repeated updates for the same track do not re-decode.
        String key = base64.length() + ":" + base64.hashCode();
        if (key.equals(artKey) && art != null) return;
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            art = decoded;
            artKey = decoded != null ? key : null;
        } catch (Exception e) {
            Log.w(TAG, "art decode failed", e);
            art = null;
            artKey = null;
        }
    }

    private MediaMetadataCompat buildMetadata() {
        MediaMetadataCompat.Builder b = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album.isEmpty() ? "Spootify" : album)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION, album.isEmpty() ? "Spootify" : album);
        if (durationMs > 0) b.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
        if (art != null) {
            b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
            b.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, art);
        }
        return b.build();
    }

    private PlaybackStateCompat buildPlaybackState() {
        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_STOP | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID | PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
                | PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM;
        int state = !hasTrack ? PlaybackStateCompat.STATE_NONE : playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        return new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, positionMs, playing ? rate : 0f)
                .setActiveQueueItemId(0)
                // Android 13+ draws these two next to the playback buttons (lock screen, quick settings).
                .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(CUSTOM_ACTION_LIKE,
                        liked ? "Remove from Liked Songs" : "Save to Liked Songs", liked ? R.drawable.ic_heart_filled : R.drawable.ic_heart).build())
                .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(CUSTOM_ACTION_SHUFFLE,
                        shuffle ? "Shuffle on" : "Shuffle off", shuffle ? R.drawable.ic_shuffle_on : R.drawable.ic_shuffle).build())
                .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Now playing controls");
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }

    private PendingIntent mediaButtonIntent(long action) {
        return MediaButtonReceiver.buildMediaButtonPendingIntent(this, action);
    }

    private PendingIntent stopIntent() {
        Intent i = new Intent(this, PlaybackService.class).setAction(ACTION_STOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, 1, i, flags);
    }

    private PendingIntent likeIntent() {
        Intent i = new Intent(this, PlaybackService.class).setAction(ACTION_LIKE);
        return PendingIntent.getService(this, 2, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_spootify)
                .setContentTitle(title)
                .setContentText(artist)
                .setSubText(album.isEmpty() ? null : album)
                .setLargeIcon(art)
                .setContentIntent(contentIntent)
                .setDeleteIntent(stopIntent())
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setShowWhen(false)
                .setOngoing(playing)
                .addAction(R.drawable.ic_skip_previous, "Previous", mediaButtonIntent(PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
                .addAction(playing ? R.drawable.ic_pause : R.drawable.ic_play, playing ? "Pause" : "Play",
                        mediaButtonIntent(PlaybackStateCompat.ACTION_PLAY_PAUSE))
                .addAction(R.drawable.ic_skip_next, "Next", mediaButtonIntent(PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
                // Older Android shows these in the expanded notification (13+ uses the custom actions above).
                .addAction(liked ? R.drawable.ic_heart_filled : R.drawable.ic_heart, liked ? "Unlike" : "Like", likeIntent())
                .addAction(R.drawable.ic_close, "Close", stopIntent())
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2)
                        .setShowCancelButton(true)
                        .setCancelButtonIntent(stopIntent()));
        return b.build();
    }

    /**
     * (Re)enter the foreground with the current notification. Calling startForeground
     * again with the same id is the documented way to update an FGS notification.
     */
    private void ensureForeground() {
        String key = title + " " + artist + " " + album + " " + playing + " " + liked + " " + artKey;
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
            lastNotificationKey = key;
            startPending = false;
        } catch (Exception e) {
            // e.g. ForegroundServiceStartNotAllowedException on Android 12+ when started from the background.
            Log.w(TAG, "startForeground failed", e);
            if (!key.equals(lastNotificationKey)) {
                try { NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, n); lastNotificationKey = key; } catch (Exception ignored) {}
            }
        }
    }
}
