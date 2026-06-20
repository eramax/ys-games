package com.ysgames.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class GameDownloader {
    private static final String TAG = "GameDownloader";
    static final String REMOTE_VERSION_URL = "https://ys-games.vercel.app/version.json";

    public interface ProgressListener {
        void onProgress(int percent, String message);
    }

    public interface CompleteListener {
        void onComplete(boolean success, String message);
    }

    private final Context context;

    public GameDownloader(Context context) {
        this.context = context.getApplicationContext();
    }

    public File getWwwDir() {
        return new File(context.getFilesDir(), "www");
    }

    public boolean isCached() {
        return new File(getWwwDir(), "index.html").exists();
    }

    public int getCachedVersion() {
        return context.getSharedPreferences("ys_games", Context.MODE_PRIVATE)
                .getInt("cached_version", 0);
    }

    private void setCachedVersion(int version) {
        context.getSharedPreferences("ys_games", Context.MODE_PRIVATE)
                .edit().putInt("cached_version", version).apply();
    }

    public static boolean isNetworkAvailable(Context context) {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        android.net.Network network = cm.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    public void download(ProgressListener progress, CompleteListener complete) {
        new Thread(() -> {
            try {
                notifyProgress(progress, 0, "جاري التحقق من التحديث...");
                String json = httpGet(REMOTE_VERSION_URL);
                JSONObject manifest = new JSONObject(json);
                int version = manifest.getInt("version");
                String baseUrl = manifest.getString("baseUrl");
                JSONArray files = manifest.getJSONArray("files");
                List<String> fileList = new ArrayList<>();
                for (int i = 0; i < files.length(); i++) {
                    fileList.add(files.getString(i));
                }

                File wwwDir = getWwwDir();
                if (!wwwDir.exists() && !wwwDir.mkdirs()) {
                    throw new Exception("تعذر إنشاء مجلد التخزين");
                }

                int total = fileList.size();
                for (int i = 0; i < total; i++) {
                    String rel = fileList.get(i);
                    int pct = (int) ((i / (float) total) * 100);
                    notifyProgress(progress, pct, "تحميل: " + rel);
                    downloadFile(baseUrl + rel, new File(wwwDir, rel));
                }

                setCachedVersion(version);
                notifyProgress(progress, 100, "اكتمل التحميل");
                if (complete != null) complete.onComplete(true, "تم تحميل الألعاب بنجاح");
            } catch (Exception e) {
                Log.e(TAG, "download failed", e);
                if (complete != null) complete.onComplete(false, e.getMessage() != null ? e.getMessage() : "فشل التحميل");
            }
        }).start();
    }

    private void notifyProgress(ProgressListener progress, int percent, String message) {
        if (progress != null) progress.onProgress(percent, message);
    }

    private static String httpGet(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("Cache-Control", "no-cache");
        try (InputStream in = conn.getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } finally {
            conn.disconnect();
        }
    }

    private static void downloadFile(String urlStr, File dest) throws Exception {
        File parent = dest.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        conn.setRequestProperty("Cache-Control", "no-cache");
        try (InputStream in = new BufferedInputStream(conn.getInputStream());
             FileOutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        } finally {
            conn.disconnect();
        }
    }
}
