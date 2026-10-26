package com.yourname.spootify;

import android.content.Context;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        registerPlugin(YtDlpPlugin.class);
        super.onCreate(savedInstanceState);
        // The last theme's base colour behind the page from the very first frame, instead of
        // the WebView's white (the page sets it again once its theme is applied).
        if (getBridge() != null) {
            BackgroundAudioPlugin.applyBackground(this, getBridge().getWebView(), BackgroundAudioPlugin.savedBackground(this));
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    return recoverFromRendererGone(webView, detail);
                }
            });
        }
    }

    /**
     * The WebView's renderer died: Android kills it when the phone runs low on memory (or it
     * crashed). Unhandled, the system then kills the whole app, which looks like Prism just
     * closing. Instead the dead WebView is thrown away and the activity rebuilt with a fresh
     * one, and the page is told why on its next start (BackgroundAudio.takeRestartNotice).
     */
    private boolean recoverFromRendererGone(WebView webView, RenderProcessGoneDetail detail) {
        boolean crashed = detail != null && detail.didCrash();
        Log.e("Prism", "WebView renderer gone (" + (crashed ? "crashed" : "killed for memory") + "); restarting the page");
        getSharedPreferences(BackgroundAudioPlugin.PREFS, Context.MODE_PRIVATE).edit()
                .putString(BackgroundAudioPlugin.PREF_RESTART_NOTICE, crashed ? "crash" : "memory").commit();
        try {
            if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
        } catch (Exception e) {
            Log.w("Prism", "could not destroy the dead WebView", e);
        }
        runOnUiThread(this::recreate);
        return true; // handled: don't let the system kill the app
    }
}
