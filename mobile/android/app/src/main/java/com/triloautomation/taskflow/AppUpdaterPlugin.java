package com.triloautomation.taskflow;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app updater: downloads the new APK inside the app (with progress) and then
 * opens Android's "Update this app?" screen straight away. Android always asks the
 * user to confirm an install — apps outside the Play Store can't install silently.
 *
 * JS: Capacitor.Plugins.AppUpdater.update({ url }) ; addListener("progress", e => e.percent)
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private File downloaded;

    @PluginMethod
    public void update(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("No download link"); return; }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists()) dir.mkdirs();
                File out = new File(dir, "TaskFlow-update.apk");
                if (out.exists()) out.delete();

                HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
                con.setInstanceFollowRedirects(true);
                con.setConnectTimeout(20000);
                con.setReadTimeout(30000);
                con.connect();
                if (con.getResponseCode() >= 400) throw new Exception("Server answered " + con.getResponseCode());
                long total = con.getContentLengthLong();
                try (InputStream in = con.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0; int n; int lastPct = -1;
                    while ((n = in.read(buf)) != -1) {
                        fos.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : -1;
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject p = new JSObject();
                            p.put("percent", pct);
                            p.put("bytes", done);
                            notifyListeners("progress", p);
                        }
                    }
                } finally {
                    con.disconnect();
                }
                downloaded = out;
                getActivity().runOnUiThread(() -> installOrAskPermission(call));
            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage());
            }
        }).start();
    }

    private void installOrAskPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            // One-time: let TaskFlow install its own updates
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, i, "afterPermission");
            return;
        }
        launchInstaller(call);
    }

    @ActivityCallback
    private void afterPermission(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("Permission to install updates was not allowed");
            return;
        }
        launchInstaller(call);
    }

    private void launchInstaller(PluginCall call) {
        try {
            Uri uri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", downloaded);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the installer: " + e.getMessage());
        }
    }
}
