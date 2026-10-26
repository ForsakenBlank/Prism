package com.yourname.spootify;

import android.content.Context;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLException;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;

import java.io.File;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import kotlin.Unit;

/**
 * yt-dlp on Android via youtubedl-android (bundled Python + yt-dlp + QuickJS for
 * YouTube's JS challenge). Mirrors the desktop bridge in main.js so app.v2.js
 * drives both with one code path:
 *  - status()               -> { ready, version, ... }
 *  - setup()                -> resolves once the runtime is initialised (nothing to download here)
 *  - info({ url })          -> { info: { id, title, uploader, channel, artist, track, duration, thumbnail } }
 *  - download({ url, id })  -> { audioPath, audioExt, imagePath, imageExt }; the web side fetches the
 *                              files through Capacitor's local server and then calls cleanup()
 *  - cleanup({ paths })     -> deletes downloaded temp files
 *  - playlist({ url })      -> { title, entries: [{ id, title, channel, duration, url, ... }] }
 *                              (also searches: url "ytsearch15:<words>" lists the top results)
 *  - cancel({ id })         -> { cancelled }; stops the download started for that id
 *  - update()               -> { status: "DONE" | "ALREADY_UP_TO_DATE" }
 * Emits "ytProgress" { stage: "download", percent, eta } while downloading.
 *
 * yt-dlp calls block, so they run on private executors rather than Capacitor's shared
 * plugin thread (which BackgroundAudio also needs): downloads and updates on one,
 * look-ups and searches on another so they stay quick while a download runs.
 */
@CapacitorPlugin(name = "YtDlp")
public class YtDlpPlugin extends Plugin {
    private static final String TAG = "YtDlp";
    private static final String INFO_TEMPLATE = "%(.{id,title,uploader,channel,artist,track,duration,thumbnail,webpage_url,extractor})j";
    /** One line per entry with --flat-playlist: lists a playlist without downloading anything. */
    private static final String PLAYLIST_TEMPLATE = "%(.{id,title,uploader,channel,duration,url,webpage_url,playlist_title,playlist_uploader,view_count,live_status})j";
    private static final String AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best";
    private static final String[] IMAGE_EXTS = { "webp", "jpg", "jpeg", "png" };
    private static final String[] AUDIO_EXTS = { "m4a", "webm", "mp3", "opus", "ogg", "mp4", "aac", "flac", "wav" };

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    /** Searches and link look-ups run here, so they don't wait behind a download on the main executor. */
    private final ExecutorService lookups = Executors.newSingleThreadExecutor();
    private volatile boolean ready = false;
    private volatile String initError = null;

    @Override
    public void load() {
        Context app = getContext().getApplicationContext();
        executor.execute(() -> {
            try {
                YoutubeDL.getInstance().init(app);
                ready = true;
            } catch (YoutubeDLException e) {
                initError = e.getMessage();
                Log.e(TAG, "youtubedl-android init failed", e);
            }
        });
    }

    private JSObject statusObject() {
        JSObject r = new JSObject();
        r.put("platform", "android");
        r.put("ytdlp", ready);
        r.put("runtime", ready ? "quickjs" : null);
        r.put("ready", ready);
        if (initError != null) r.put("error", initError);
        String version = null;
        try { if (ready) version = YoutubeDL.getInstance().version(getContext()); } catch (Exception ignored) {}
        r.put("version", version);
        return r;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    /** Nothing to download on Android; just waits for init (the executor is FIFO, so this runs after it). */
    @PluginMethod
    public void setup(PluginCall call) {
        executor.execute(() -> call.resolve(statusObject()));
    }

    @PluginMethod
    public void info(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) { call.reject("Missing url"); return; }
        lookups.execute(() -> {
            try {
                if (!ready) throw new YoutubeDLException(initError != null ? initError : "Downloader is still initialising");
                YoutubeDLRequest req = new YoutubeDLRequest(url);
                req.addOption("--no-playlist");
                req.addOption("--no-warnings");
                req.addOption("--print", INFO_TEMPLATE);
                YoutubeDLResponse res = YoutubeDL.getInstance().execute(req, null, false, null);
                String line = lastNonEmptyLine(res.getOut());
                if (line == null) throw new YoutubeDLException("yt-dlp returned no information");
                JSObject r = new JSObject();
                r.put("info", new JSObject(line));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(friendlyError(e));
            }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        String id = call.getString("id", "");
        if (url.isEmpty() || id.isEmpty()) { call.reject("Missing url or id"); return; }
        executor.execute(() -> {
            try {
                if (!ready) throw new YoutubeDLException(initError != null ? initError : "Downloader is still initialising");
                File dir = downloadDir();
                File[] stale = dir.listFiles();
                if (stale != null) for (File f : stale) if (f.getName().startsWith(id + ".")) f.delete();

                YoutubeDLRequest req = new YoutubeDLRequest(url);
                req.addOption("--no-playlist");
                req.addOption("--no-warnings");
                req.addOption("-f", AUDIO_FORMAT);
                req.addOption("-o", new File(dir, "%(id)s.%(ext)s").getAbsolutePath());
                req.addOption("--write-thumbnail");
                req.addOption("--newline");
                YoutubeDL.getInstance().execute(req, "spootify-" + id, false, (progress, eta, line) -> {
                    JSObject p = new JSObject();
                    p.put("stage", "download");
                    p.put("percent", progress);
                    p.put("eta", eta);
                    notifyListeners("ytProgress", p);
                    return Unit.INSTANCE;
                });

                File audio = null, image = null;
                File[] files = dir.listFiles();
                if (files != null) {
                    for (File f : files) {
                        if (!f.getName().startsWith(id + ".")) continue;
                        String ext = extOf(f);
                        if (contains(IMAGE_EXTS, ext)) image = f;
                        else if (contains(AUDIO_EXTS, ext)) audio = f;
                    }
                }
                if (audio == null) throw new YoutubeDLException("Download finished but no audio file was produced");
                JSObject r = new JSObject();
                r.put("audioPath", audio.getAbsolutePath());
                r.put("audioExt", extOf(audio));
                r.put("imagePath", image != null ? image.getAbsolutePath() : null);
                r.put("imageExt", image != null ? extOf(image) : null);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(friendlyError(e));
            }
        });
    }

    @PluginMethod
    public void playlist(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) { call.reject("Missing url"); return; }
        lookups.execute(() -> {
            try {
                if (!ready) throw new YoutubeDLException(initError != null ? initError : "Downloader is still initialising");
                YoutubeDLRequest req = new YoutubeDLRequest(url);
                req.addOption("--yes-playlist");
                req.addOption("--flat-playlist");
                req.addOption("--no-warnings");
                req.addOption("--print", PLAYLIST_TEMPLATE);
                YoutubeDLResponse res = YoutubeDL.getInstance().execute(req, null, false, null);
                JSArray entries = new JSArray();
                String title = null;
                String out = res.getOut();
                if (out != null) {
                    for (String line : out.split("\\r?\\n")) {
                        String t = line.trim();
                        if (!t.startsWith("{")) continue;
                        try {
                            JSObject o = new JSObject(t);
                            if (!o.has("id") || o.isNull("id")) continue;
                            entries.put(o);
                            if (title == null && o.has("playlist_title") && !o.isNull("playlist_title")) title = o.getString("playlist_title");
                        } catch (Exception ignored) {}
                    }
                }
                if (entries.length() == 0) throw new YoutubeDLException("No videos found at that link");
                JSObject r = new JSObject();
                r.put("title", title != null ? title : "Playlist");
                r.put("entries", entries);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(friendlyError(e));
            }
        });
    }

    /** Runs on the plugin thread, not the executor, which is busy with the download itself. */
    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id", "");
        boolean stopped = false;
        try {
            if (!id.isEmpty()) stopped = YoutubeDL.getInstance().destroyProcessById("spootify-" + id);
        } catch (Exception e) {
            Log.w(TAG, "cancel failed", e);
        }
        JSObject r = new JSObject();
        r.put("cancelled", stopped);
        call.resolve(r);
    }

    @PluginMethod
    public void cleanup(PluginCall call) {
        File dir = downloadDir();
        try {
            com.getcapacitor.JSArray paths = call.getArray("paths", new com.getcapacitor.JSArray());
            for (int i = 0; i < paths.length(); i++) {
                File f = new File(paths.optString(i, ""));
                // Only ever delete inside our own download cache.
                if (f.getCanonicalPath().startsWith(dir.getCanonicalPath())) f.delete();
            }
        } catch (Exception e) {
            Log.w(TAG, "cleanup failed", e);
        }
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        executor.execute(() -> {
            try {
                if (!ready) throw new YoutubeDLException(initError != null ? initError : "Downloader is still initialising");
                YoutubeDL.UpdateStatus status = YoutubeDL.getInstance().updateYoutubeDL(getContext(), YoutubeDL.UpdateChannel._STABLE);
                JSObject r = new JSObject();
                r.put("status", status != null ? status.name() : "DONE");
                r.put("version", YoutubeDL.getInstance().version(getContext()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(friendlyError(e));
            }
        });
    }

    // ── helpers ──

    private File downloadDir() {
        File dir = new File(getContext().getCacheDir(), "ytdl");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static String extOf(File f) {
        String name = f.getName();
        int dot = name.lastIndexOf('.');
        return dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
    }

    private static boolean contains(String[] arr, String value) {
        for (String s : arr) if (s.equals(value)) return true;
        return false;
    }

    private static String lastNonEmptyLine(String text) {
        if (text == null) return null;
        String[] lines = text.split("\\r?\\n");
        for (int i = lines.length - 1; i >= 0; i--) {
            String l = lines[i].trim();
            if (!l.isEmpty()) return l;
        }
        return null;
    }

    /** yt-dlp's stderr is verbose; surface just the last ERROR line to the UI. */
    private static String friendlyError(Exception e) {
        String msg = e.getMessage();
        if (msg == null || msg.isEmpty()) return e.getClass().getSimpleName();
        String last = null;
        for (String l : msg.split("\\r?\\n")) {
            String t = l.trim();
            if (t.regionMatches(true, 0, "ERROR:", 0, 6)) last = t.substring(6).trim();
        }
        return last != null ? last : msg.trim();
    }
}
