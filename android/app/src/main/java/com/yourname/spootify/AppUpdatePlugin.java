package com.yourname.spootify;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Settings -> General -> App updates on the phone. The page lists the releases itself; this downloads
 * the chosen Prism-android.apk and hands it to Android's installer, which asks you to confirm. Every
 * release is signed with the same key, so it installs over this one and keeps the library.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PackageInfo p = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            ret.put("current", p.versionName);
        } catch (Exception e) {
            ret.put("current", "");
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version", "new");
        if (url == null || !url.startsWith("https://")) {
            call.reject("No download for this version");
            return;
        }
        // Android 8 and up asks once whether Prism may install apps
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(allow);
            call.reject("Allow Prism to install apps on the screen that just opened, then press the button again");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                deleteAll(dir);
                dir.mkdirs();
                File apk = new File(dir, "prism-" + version.replaceAll("[^0-9A-Za-z.]", "") + ".apk");
                download(url, apk);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent open = new Intent(Intent.ACTION_VIEW);
                open.setDataAndType(uri, "application/vnd.android.package-archive");
                open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(open);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not get the update: " + e.getMessage(), e);
            }
        }, "prism-update").start();
    }

    private void download(String url, File to) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestProperty("User-Agent", "Prism");
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("the download answered " + c.getResponseCode());
            long total = c.getContentLengthLong(), got = 0;
            int shown = -1;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[256 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    got += n;
                    int pct = total > 0 ? (int) (got * 100 / total) : -1;
                    if (pct / 5 != shown / 5) {
                        shown = pct;
                        JSObject p = new JSObject();
                        p.put("percent", pct);
                        notifyListeners("updateProgress", p);
                    }
                }
            }
        } finally {
            c.disconnect();
        }
    }

    private static void deleteAll(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteAll(k);
        f.delete();
    }
}
