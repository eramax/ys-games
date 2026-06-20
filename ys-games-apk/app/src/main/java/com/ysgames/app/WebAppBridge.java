package com.ysgames.app;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

public class WebAppBridge {
    private final Activity activity;
    private final WebView webView;
    private final GameDownloader downloader;

    public WebAppBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.downloader = new GameDownloader(activity);
    }

    @JavascriptInterface
    public boolean isGamesCached() {
        return downloader.isCached();
    }

    @JavascriptInterface
    public int getCachedVersion() {
        return downloader.getCachedVersion();
    }

    @JavascriptInterface
    public void updateGames() {
        if (!GameDownloader.isNetworkAvailable(activity)) {
            runJs("onGamesUpdateComplete(false,'لا يوجد اتصال بالإنترنت')");
            return;
        }
        downloader.download(
                (percent, message) -> runJs("onGamesUpdateProgress(" + percent + ",'" + escapeJs(message) + "')"),
                (ok, message) -> {
                    runJs("onGamesUpdateComplete(" + ok + ",'" + escapeJs(message) + "')");
                    if (ok) {
                        activity.runOnUiThread(() -> ((MainActivity) activity).loadPortal());
                    }
                }
        );
    }

    @JavascriptInterface
    public void retryLoad() {
        activity.runOnUiThread(() -> ((MainActivity) activity).bootstrap());
    }

    private void runJs(String js) {
        activity.runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private static String escapeJs(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ");
    }
}
