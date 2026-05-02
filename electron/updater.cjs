// ─────────────────────────────────────────────────────────────────────────────
//  electron/updater.cjs
//  TaskFlow auto-update logic.
//
//  Strategy:
//    • Windows  → full silent auto-update via electron-updater + GitHub
//                 Releases. App downloads the new NSIS installer in the
//                 background, then prompts "Restart & Install".
//    • macOS    → because we don't have an Apple Developer ID to sign /
//                 notarize the app, electron-updater can't apply updates
//                 silently. Instead we hit the GitHub Releases API directly,
//                 compare versions, and on accept open the public Releases
//                 page in the user's default browser. They download the
//                 new .dmg and drag it into Applications (replacing old).
//
//  Public API (called from main.cjs):
//    initAutoUpdater(getMainWindow)
//        Wire event handlers and run an initial check ~5 s after launch.
//    checkForUpdatesManually(getMainWindow)
//        Triggered from the tray "Check for Updates…" menu item. Always
//        shows feedback (even when already up to date).
//    startPeriodicUpdateChecks(getMainWindow, intervalMs)
//        Re-check every N ms (default 4 h). Safe to call once at startup.
//
//  Notes:
//    • All checks no-op in dev (`!app.isPackaged`) — electron-updater
//      refuses to run in dev anyway, and the manual GitHub flow would
//      compare against package.json which always reads "current".
//    • The `repository` field in package.json + the `publish` block in
//      build config tell electron-updater where to look. No URL hardcoded
//      here, so renaming the repo only requires editing package.json.
// ─────────────────────────────────────────────────────────────────────────────

const { app, dialog, shell, Notification } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
const https = require("https");

// ─── Logging ──────────────────────────────────────────────────────────────
// electron-log writes to:
//   • Windows: %USERPROFILE%\AppData\Roaming\TaskFlow\logs\main.log
//   • macOS:   ~/Library/Logs/TaskFlow/main.log
// Tail this file when debugging update issues.
log.transports.file.level = "info";
autoUpdater.logger = log;

// We show our own dialogs, so disable the built-in ones.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// ─── Read repo coordinates from package.json ──────────────────────────────
function getRepoCoords() {
  try {
    // eslint-disable-next-line global-require
    const pkg = require("../package.json");
    const publish = Array.isArray(pkg.build?.publish)
      ? pkg.build.publish[0]
      : pkg.build?.publish;
    if (publish?.owner && publish?.repo) {
      return { owner: publish.owner, repo: publish.repo };
    }
  } catch (err) {
    log.warn("Could not read repo coords from package.json:", err.message);
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function compareVersions(a, b) {
  // Strip leading "v" if present, then compare numeric segments.
  const parse = (v) =>
    String(v)
      .replace(/^v/, "")
      .split(/[.\-+]/)
      .map((n) => (Number.isFinite(Number(n)) ? Number(n) : 0));
  const aa = parse(a);
  const bb = parse(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function showUpdateNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

let updateInProgress = false;
let lastNotifiedVersion = null;

// ─── Windows: electron-updater wiring ─────────────────────────────────────
function wireWindowsUpdater(getMainWindow) {
  autoUpdater.on("error", (err) => {
    log.error("autoUpdater error:", err?.message || err);
    updateInProgress = false;
  });

  autoUpdater.on("update-available", async (info) => {
    log.info("Update available:", info.version);
    if (lastNotifiedVersion === info.version) return;
    lastNotifiedVersion = info.version;

    const win = getMainWindow();
    const result = await dialog.showMessageBox(win || undefined, {
      type: "info",
      buttons: ["Download now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update available",
      message: `TaskFlow ${info.version} is available.`,
      detail:
        "A new version is ready to download. The download happens in the background — you can keep working.",
    });
    if (result.response === 0) {
      updateInProgress = true;
      autoUpdater.downloadUpdate().catch((err) => {
        log.error("downloadUpdate failed:", err);
        updateInProgress = false;
      });
      showUpdateNotification(
        "Downloading TaskFlow update",
        `Version ${info.version} is downloading in the background.`
      );
    }
  });

  autoUpdater.on("update-not-available", () => {
    log.info("No update available.");
  });

  autoUpdater.on("download-progress", (progress) => {
    log.info(
      `Download progress: ${Math.round(progress.percent)}% ` +
        `(${Math.round(progress.bytesPerSecond / 1024)} KB/s)`
    );
  });

  autoUpdater.on("update-downloaded", async (info) => {
    log.info("Update downloaded:", info.version);
    updateInProgress = false;
    const win = getMainWindow();
    const result = await dialog.showMessageBox(win || undefined, {
      type: "info",
      buttons: ["Restart & install", "Install later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `TaskFlow ${info.version} is ready to install.`,
      detail:
        "Click \"Restart & install\" to apply the update now. Otherwise it will install automatically the next time you quit TaskFlow.",
    });
    if (result.response === 0) {
      // Force quit (bypass the tray-hide-on-close behavior) and run installer.
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }
  });
}

// ─── macOS: lightweight GitHub Releases API check ─────────────────────────
function checkLatestReleaseFromGitHub(coords) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: `/repos/${coords.owner}/${coords.repo}/releases/latest`,
      method: "GET",
      headers: {
        "User-Agent": "TaskFlow-Updater",
        Accept: "application/vnd.github+json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
        }
        try {
          const json = JSON.parse(data);
          resolve({
            version: String(json.tag_name || "").replace(/^v/, ""),
            htmlUrl: json.html_url,
            name: json.name,
            body: json.body,
          });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("GitHub API timeout")));
    req.end();
  });
}

async function checkMacUpdate(getMainWindow, { silent } = { silent: true }) {
  const coords = getRepoCoords();
  if (!coords) {
    log.warn("No repo coords — skipping mac update check.");
    if (!silent) {
      dialog.showMessageBox({
        type: "warning",
        message: "Updater not configured.",
        detail: "Repository information is missing from package.json.",
      });
    }
    return;
  }

  try {
    const latest = await checkLatestReleaseFromGitHub(coords);
    const current = app.getVersion();
    log.info(`mac update check: current=${current} latest=${latest.version}`);

    if (!latest.version) {
      if (!silent) {
        dialog.showMessageBox({
          type: "info",
          message: "No releases yet.",
          detail: "Couldn't find a published release on GitHub.",
        });
      }
      return;
    }

    if (compareVersions(latest.version, current) <= 0) {
      if (!silent) {
        dialog.showMessageBox({
          type: "info",
          message: "You're up to date.",
          detail: `TaskFlow ${current} is the latest version.`,
        });
      }
      return;
    }

    // New version found.
    if (lastNotifiedVersion === latest.version && silent) return;
    lastNotifiedVersion = latest.version;

    const win = getMainWindow();
    const result = await dialog.showMessageBox(win || undefined, {
      type: "info",
      buttons: ["Download update", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update available",
      message: `TaskFlow ${latest.version} is available.`,
      detail:
        "Clicking \"Download update\" opens the GitHub Releases page in your browser. " +
        "Download the new .dmg, open it, and drag TaskFlow into Applications " +
        "(replace the existing copy).",
    });
    if (result.response === 0 && latest.htmlUrl) {
      shell.openExternal(latest.htmlUrl);
    }
  } catch (err) {
    log.error("mac update check failed:", err.message);
    if (!silent) {
      dialog.showMessageBox({
        type: "error",
        message: "Couldn't check for updates.",
        detail: err.message,
      });
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────
function initAutoUpdater(getMainWindow) {
  if (!app.isPackaged) {
    log.info("Dev mode — auto-updater disabled.");
    return;
  }

  if (process.platform === "win32") {
    wireWindowsUpdater(getMainWindow);
    // Initial check shortly after launch (don't block startup).
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        log.error("Initial checkForUpdates failed:", err.message);
      });
    }, 5000);
  } else if (process.platform === "darwin") {
    setTimeout(() => {
      checkMacUpdate(getMainWindow, { silent: true });
    }, 5000);
  } else {
    log.info(`Platform ${process.platform} — no updater configured.`);
  }
}

function checkForUpdatesManually(getMainWindow) {
  if (!app.isPackaged) {
    dialog.showMessageBox({
      type: "info",
      message: "Updates are disabled in development mode.",
    });
    return;
  }

  if (process.platform === "win32") {
    if (updateInProgress) {
      dialog.showMessageBox({
        type: "info",
        message: "An update is already downloading.",
      });
      return;
    }
    autoUpdater
      .checkForUpdates()
      .then((result) => {
        // If electron-updater says no update, show a friendly dialog.
        // (The "update-available" handler covers the positive case.)
        if (!result || !result.updateInfo) return;
        const latest = result.updateInfo.version;
        if (compareVersions(latest, app.getVersion()) <= 0) {
          dialog.showMessageBox({
            type: "info",
            message: "You're up to date.",
            detail: `TaskFlow ${app.getVersion()} is the latest version.`,
          });
        }
      })
      .catch((err) => {
        log.error("Manual checkForUpdates failed:", err.message);
        dialog.showMessageBox({
          type: "error",
          message: "Couldn't check for updates.",
          detail: err.message,
        });
      });
  } else if (process.platform === "darwin") {
    checkMacUpdate(getMainWindow, { silent: false });
  }
}

function startPeriodicUpdateChecks(
  getMainWindow,
  intervalMs = 4 * 60 * 60 * 1000 // 4 hours
) {
  if (!app.isPackaged) return;
  setInterval(() => {
    log.info("Periodic update check tick.");
    if (process.platform === "win32") {
      if (updateInProgress) return;
      autoUpdater.checkForUpdates().catch((err) => {
        log.error("Periodic checkForUpdates failed:", err.message);
      });
    } else if (process.platform === "darwin") {
      checkMacUpdate(getMainWindow, { silent: true });
    }
  }, intervalMs);
}

module.exports = {
  initAutoUpdater,
  checkForUpdatesManually,
  startPeriodicUpdateChecks,
};
