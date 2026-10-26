package com.yourname.spootify;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * JS-facing bridge for {@link PlaybackService}.
 *
 * Called from app.v2.js via window.Capacitor.nativePromise("BackgroundAudio", ...):
 *  - update({ title, artist, isPlaying, position, duration, rate, art, queue, album, liked, shuffle })  full state push
 *    (queue: [{ title, artist }] for a car's queue screen, the playing song first)
 *  - setPosition({ isPlaying, position, rate })                            cheap position sync
 *  - stop()                                                                 tear the service down
 *  - minimize()                                                             send the app to the background
 *  - setLibrary({ json })                                                   playlists / liked / recent for Android Auto
 *  - setBackground({ color })                                               "#rrggbb" behind the page (the theme's base)
 *  - saveFileStart({ name, mime }) -> { token }, saveFileChunk({ token, data | text }),
 *    saveFileEnd({ token, cancel }) -> { path }                             write a file into Downloads/Prism
 *    (the WebView ignores <a download>, so exports and images are streamed here in base64 chunks)
 *  - httpPost({ url, body, timeout }) -> { status, text }                  Wi-Fi sync requests to the PC app
 *
 * Emits "mediaAction" events { action, position, arg } when the user presses a
 * notification / lock-screen / headset / car control (action: play|pause|next|previous|
 * stop|seek|like|shuffle, or from a car: playFromMediaId|playFromSearch|skipToQueueItem with arg),
 * and "backButton" when the hardware Back button is pressed.
 */
@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin implements PlaybackService.Listener {
    private static final String TAG = "BackgroundAudio";
    private static final String EVENT_BACK = "backButton";

    private static class SaveTarget { OutputStream out; Uri uri; File file; String display; }
    private final Map<String, SaveTarget> saves = new ConcurrentHashMap<>();

    @Override
    public void load() {
        PlaybackService.setListener(this);
        // Back goes to the web app first so it can close the full-screen player or an
        // overlay. When nothing is listening it backgrounds the app: finishing the
        // activity (the default on older Android) would take the WebView, and with it
        // the music, down.
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (hasListeners(EVENT_BACK)) notifyListeners(EVENT_BACK, new JSObject());
                else getActivity().moveTaskToBack(true);
            }
        });
    }

    @PluginMethod
    public void minimize(PluginCall call) {
        getActivity().runOnUiThread(() -> getActivity().moveTaskToBack(true));
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "Prism");
        String artist = call.getString("artist", "");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("isPlaying", false));
        long positionMs = secondsToMs(call.getDouble("position", 0.0));
        long durationMs = secondsToMs(call.getDouble("duration", 0.0));
        float rate = (float) (double) call.getDouble("rate", 1.0);
        String art = call.getString("art", null);
        JSArray queue = call.getArray("queue", null);
        String album = call.getString("album", "");
        boolean liked = Boolean.TRUE.equals(call.getBoolean("liked", false));
        boolean shuffle = Boolean.TRUE.equals(call.getBoolean("shuffle", false));

        PlaybackService svc = PlaybackService.getInstance();
        if (svc != null) {
            svc.update(title, artist, playing, positionMs, durationMs, rate, art, album, liked, shuffle);
            if (queue != null) svc.setQueue(queue);
            call.resolve();
            return;
        }

        Context ctx = getContext();
        Intent intent = new Intent(ctx, PlaybackService.class)
                .setAction(PlaybackService.ACTION_UPDATE)
                .putExtra(PlaybackService.EXTRA_TITLE, title)
                .putExtra(PlaybackService.EXTRA_ARTIST, artist)
                .putExtra(PlaybackService.EXTRA_PLAYING, playing)
                .putExtra(PlaybackService.EXTRA_POSITION_MS, positionMs)
                .putExtra(PlaybackService.EXTRA_DURATION_MS, durationMs)
                .putExtra(PlaybackService.EXTRA_RATE, rate)
                .putExtra(PlaybackService.EXTRA_ART_BASE64, art)
                .putExtra(PlaybackService.EXTRA_ALBUM, album)
                .putExtra(PlaybackService.EXTRA_LIKED, liked)
                .putExtra(PlaybackService.EXTRA_SHUFFLE, shuffle);
        if (queue != null) intent.putExtra(PlaybackService.EXTRA_QUEUE_JSON, queue.toString());
        try {
            PlaybackService.startPending = true;
            ContextCompat.startForegroundService(ctx, intent);
            call.resolve();
        } catch (Exception e) {
            PlaybackService.startPending = false;
            // Android 12+ refuses foreground-service starts from the background; the web
            // side keeps working, it just will not have wake-lock protection this time.
            Log.w(TAG, "startForegroundService failed", e);
            call.reject("Could not start playback service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setPosition(PluginCall call) {
        PlaybackService svc = PlaybackService.getInstance();
        if (svc != null) {
            boolean playing = Boolean.TRUE.equals(call.getBoolean("isPlaying", false));
            long positionMs = secondsToMs(call.getDouble("position", 0.0));
            float rate = (float) (double) call.getDouble("rate", 1.0);
            svc.setPosition(playing, positionMs, rate);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopService();
        call.resolve();
    }

    /** A snapshot of the library for Android Auto's browse screens (see PlaybackService). */
    @PluginMethod
    public void setLibrary(PluginCall call) {
        String json = call.getString("json", null);
        if (json == null || json.isEmpty()) { call.reject("Missing json"); return; }
        PlaybackService.setLibrary(getContext(), json);
        call.resolve();
    }

    static final String PREFS = "spootify";
    static final String PREF_BACKGROUND = "background";
    static final String PREF_RESTART_NOTICE = "restartNotice";

    /** Why the page was restarted ("memory" | "crash"), once, or nothing (see MainActivity). */
    @PluginMethod
    public void takeRestartNotice(PluginCall call) {
        SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String reason = p.getString(PREF_RESTART_NOTICE, null);
        if (reason != null) p.edit().remove(PREF_RESTART_NOTICE).apply();
        JSObject res = new JSObject();
        res.put("reason", reason);
        call.resolve(res);
    }

    /** Paint the WebView and window in the theme's base colour, so a frame the page hasn't drawn yet isn't white. */
    @PluginMethod
    public void setBackground(PluginCall call) {
        String value = call.getString("color", "");
        int color;
        try { color = Color.parseColor(value); } catch (Exception e) { call.reject("Bad colour: " + value); return; }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(PREF_BACKGROUND, color).apply();
        getActivity().runOnUiThread(() -> applyBackground(getActivity(), getBridge().getWebView(), color));
        call.resolve();
    }

    static void applyBackground(android.app.Activity activity, android.webkit.WebView webView, int color) {
        try {
            if (webView != null) webView.setBackgroundColor(color);
            if (activity != null) activity.getWindow().setBackgroundDrawable(new ColorDrawable(color));
        } catch (Exception e) {
            Log.w(TAG, "setBackground failed", e);
        }
    }

    static int savedBackground(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return p.getInt(PREF_BACKGROUND, Color.parseColor("#0a0a0a"));
    }

    @PluginMethod
    public void saveFileStart(PluginCall call) {
        String name = call.getString("name", "spootify-file");
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (name.isEmpty()) name = "spootify-file";
        String mime = call.getString("mime", "application/octet-stream");
        SaveTarget t = new SaveTarget();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Prism");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                ContentResolver resolver = getContext().getContentResolver();
                t.uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (t.uri == null) throw new IOException("Could not create the file");
                t.out = resolver.openOutputStream(t.uri);
                if (t.out == null) throw new IOException("Could not open the file");
                t.display = "Downloads/Prism/" + name;
            } else {
                // Before Android 10 public Downloads needs a storage permission; the app's own
                // folder doesn't (Android/data/<app>/files/Download).
                File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) throw new IOException("No storage available");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Could not create " + dir);
                t.file = new File(dir, name);
                t.out = new FileOutputStream(t.file);
                t.display = t.file.getAbsolutePath();
            }
            String token = UUID.randomUUID().toString();
            saves.put(token, t);
            JSObject res = new JSObject();
            res.put("token", token);
            call.resolve(res);
        } catch (Exception e) {
            discard(t);
            call.reject("Could not save: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveFileChunk(PluginCall call) {
        String token = call.getString("token", "");
        SaveTarget t = saves.get(token);
        if (t == null) { call.reject("Unknown save"); return; }
        try {
            // "text": plain text written as UTF-8 (library exports, which are JSON already);
            // "data": base64 bytes (pictures).
            String text = call.getString("text", null);
            if (text != null) t.out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            else t.out.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            saves.remove(token);
            discard(t);
            call.reject("Could not write: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveFileEnd(PluginCall call) {
        SaveTarget t = saves.remove(call.getString("token", ""));
        if (t == null) { call.reject("Unknown save"); return; }
        if (Boolean.TRUE.equals(call.getBoolean("cancel", false))) { discard(t); call.resolve(); return; }
        try {
            t.out.close();
            if (t.uri != null && Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContext().getContentResolver().update(t.uri, v, null, null);
            }
            JSObject res = new JSObject();
            res.put("path", t.display);
            call.resolve(res);
        } catch (Exception e) {
            discard(t);
            call.reject("Could not finish saving: " + e.getMessage());
        }
    }

    // Keeps the screen on while a Wi-Fi sync runs, so the phone doesn't sleep and cut it off.
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // Wi-Fi sync with the PC app: one JSON POST, answered as text. Done here rather than with
    // fetch() because the WebView won't talk plain http to another machine on the network.
    @PluginMethod
    public void httpPost(PluginCall call) {
        final String url = call.getString("url", "");
        final String body = call.getString("body", "");
        final int timeout = call.getInt("timeout", 120000);
        new Thread(() -> {
            java.net.HttpURLConnection c = null;
            try {
                c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                c.setConnectTimeout(Math.min(timeout, 8000));
                c.setReadTimeout(timeout);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
                byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream o = c.getOutputStream()) { o.write(bytes); }
                int status = c.getResponseCode();
                java.io.InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
                if (in != null) {
                    byte[] b = new byte[65536]; int n;
                    while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                    in.close();
                }
                JSObject res = new JSObject();
                res.put("status", status);
                res.put("text", buf.toString("UTF-8"));
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Couldn't reach the other device: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    private void discard(SaveTarget t) {
        try { if (t.out != null) t.out.close(); } catch (Exception ignored) {}
        try {
            if (t.uri != null) getContext().getContentResolver().delete(t.uri, null, null);
            else if (t.file != null) //noinspection ResultOfMethodCallIgnored
                t.file.delete();
        } catch (Exception ignored) {}
    }

    @Override
    public void onMediaAction(String action, long positionMs, String arg) {
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("position", positionMs / 1000.0);
        if (arg != null) data.put("arg", arg);
        // Kept until the page is listening: a car's request can arrive while the app is still starting up.
        notifyListeners("mediaAction", data, true);
    }

    @Override
    protected void handleOnDestroy() {
        // The WebView is going away with the activity; nothing can play any more.
        PlaybackService.setListener(null);
        stopService();
        super.handleOnDestroy();
    }

    private void stopService() {
        PlaybackService svc = PlaybackService.getInstance();
        if (svc != null) {
            svc.shutdown();
        } else if (PlaybackService.startPending) {
            // A start is on its way: stopping the service before it reaches startForeground()
            // makes Android kill the whole app, so it shuts itself down once it has.
            PlaybackService.stopWhenStarted = true;
        } else {
            try { getContext().stopService(new Intent(getContext(), PlaybackService.class)); } catch (Exception ignored) {}
        }
    }

    private static long secondsToMs(Double seconds) {
        if (seconds == null || seconds.isNaN() || seconds.isInfinite()) return 0;
        return Math.max(0L, Math.round(seconds * 1000.0));
    }
}
