package com.ysgames.app;

import android.app.Activity;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;

public class MainActivity extends Activity {
    private WebView mWebView;
    private GameDownloader downloader;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);

        downloader = new GameDownloader(this);
        mWebView = new WebView(this);
        WebSettings webSettings = mWebView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setLoadWithOverviewMode(true);
        mWebView.setKeepScreenOn(true);

        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                int ver = downloader.getCachedVersion();
                if (ver > 0) {
                    view.evaluateJavascript(
                            "if(window.YSSave){YSApp.setMeta({cachedVersion:" + ver + "});}", null);
                }
            }
        });

        mWebView.addJavascriptInterface(new WebAppBridge(this, mWebView), "AndroidBridge");
        setContentView(mWebView);
        bootstrap();
    }

    public void bootstrap() {
        if (downloader.isCached()) {
            loadPortal();
            return;
        }
        if (GameDownloader.isNetworkAvailable(this)) {
            loadUpdatingPage();
            downloader.download(
                    (percent, message) -> runJs("onGamesUpdateProgress(" + percent + ",'" + escapeJs(message) + "')"),
                    (ok, message) -> {
                        runJs("onGamesUpdateComplete(" + ok + ",'" + escapeJs(message) + "')");
                        if (ok) runOnUiThread(this::loadPortal);
                        else runOnUiThread(this::loadOfflinePage);
                    }
            );
        } else {
            loadOfflinePage();
        }
    }

    public void loadPortal() {
        File index = new File(downloader.getWwwDir(), "index.html");
        if (index.exists()) {
            mWebView.loadUrl("file://" + index.getAbsolutePath() + "?app=true");
        } else {
            loadOfflinePage();
        }
    }

    private void loadOfflinePage() {
        mWebView.loadUrl("file:///android_asset/www/apk-shell/offline.html");
    }

    private void loadUpdatingPage() {
        mWebView.loadUrl("file:///android_asset/www/apk-shell/loading.html");
    }

    private void runJs(String js) {
        runOnUiThread(() -> mWebView.evaluateJavascript(js, null));
    }

    private static String escapeJs(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ");
    }

    @Override
    public void onBackPressed() {
        if (mWebView.canGoBack()) {
            mWebView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
