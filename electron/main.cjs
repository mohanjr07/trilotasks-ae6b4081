// ─────────────────────────────────────────────────────────────────────────────
//  electron/main.cjs
//  TaskFlow desktop entry point.
//
//  • In dev mode (npm run electron:dev):
//      Loads http://localhost:8080 (the Vite dev server) so HMR works.
//  • In production (the .exe built by electron-builder):
//      Loads the compiled dist/index.html via file://. Because the React
//      app uses HashRouter when window.IS_ELECTRON is true, deep links and
//      reloads work correctly even from a file:// origin.
//
//  Background-app behavior (Teams / Discord / WhatsApp style):
//    • A system-tray icon stays visible after the window is closed.
//    • Clicking the X on the window hides it instead of quitting.
//    • Tray icon click  →  show window.
//    • Tray right-click →  Open / Quit menu.
//    • App only truly exits via the tray "Quit" menu OR system shutdown.
//    • This keeps the renderer alive so Supabase realtime keeps firing
//      desktop notifications even when the window is closed.
//
//  Desktop notifications (Teams-style):
//    • Uses Electron's native Notification module (not the Web API) so the
//      app icon appears in the toast, sound plays, and it groups correctly
//      in Windows Action Center / macOS Notification Center.
//    • Renderer sends "notify:show" IPC → main fires the native toast.
//    • Clicking the toast sends "notify:clicked" back → renderer navigates.
//
//  Single-instance lock: launching TaskFlow a second time just brings
//  the existing window to the front instead of starting a duplicate.
// ─────────────────────────────────────────────────────────────────────────────

const {
  app,
  BrowserWindow,
  shell,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  Notification,
} = require("electron");
const path = require("path");
const {
  initAutoUpdater,
  checkForUpdatesManually,
  startPeriodicUpdateChecks,
} = require("./updater.cjs");

const isDev = !app.isPackaged;

// Set the Application User Model ID. Required on Windows 10/11 so that
// native toast notifications show "TaskFlow" as the source (not "Electron")
// and group correctly in the Action Center. Must match `build.appId`.
app.setAppUserModelId("com.trilo.taskflow");

// ─── Single-instance lock ─────────────────────────────────────────────────
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
}

let mainWindow = null;
let tray = null;
let isQuittingForReal = false;

// Used by the updater module so it can attach modal dialogs to the
// main window (or fall back to a free dialog if the window is hidden/closed).
function getMainWindow() {
  return mainWindow;
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "TaskFlow",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Hide the default File/Edit/View menu bar — TaskFlow has its own UI.
  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL("http://localhost:8080");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
      hash: "/",
    });
  }

  // Any link with target="_blank" or window.open(...) opens in the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Override window close: hide to tray instead of quitting.
  mainWindow.on("close", (event) => {
    if (!isQuittingForReal) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = isDev
    ? path.join(__dirname, "..", "public", "favicon.png")
    : path.join(__dirname, "..", "dist", "favicon.png");

  let trayIcon = nativeImage.createFromPath(iconPath);
  if (trayIcon.isEmpty()) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("TaskFlow");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Open TaskFlow", click: showMainWindow },
    { type: "separator" },
    {
      label: "Check for Updates…",
      click: () => checkForUpdatesManually(getMainWindow),
    },
    { type: "separator" },
    {
      label: `TaskFlow v${app.getVersion()}`,
      enabled: false,
    },
    {
      label: "Quit TaskFlow",
      click: () => {
        isQuittingForReal = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

// ─── IPC: focus window (legacy path kept for compatibility) ───────────────
ipcMain.on("taskflow:focus-window", () => {
  showMainWindow();
});

// ─── IPC: Teams-style native desktop notification ────────────────────────
//
//  Renderer sends:  ipcRenderer.send("notify:show", { title, body, route })
//  Main fires a native Electron Notification with the app icon.
//  Clicking the toast:
//    1. Brings the window to the front.
//    2. Sends "notify:clicked" back to the renderer with { route } so React
//       can navigate to the right page (e.g. "/notifications").
//
ipcMain.on("notify:show", (event, { title, body, route }) => {
  if (!Notification.isSupported()) return;

  // Resolve the app icon for the notification badge.
  const iconPath = isDev
    ? path.join(__dirname, "..", "public", "favicon.png")
    : path.join(__dirname, "..", "dist", "favicon.png");

  const icon = nativeImage.createFromPath(iconPath);

  const notification = new Notification({
    title: title ?? "TaskFlow",
    body: body ?? "",
    icon: icon.isEmpty() ? undefined : icon,
    // urgency only applies on Linux but is harmless on other platforms.
    urgency: "normal",
    // timeoutType "default" lets the OS decide how long to show the toast
    // (5 s on Windows, slide-in on macOS). "never" keeps it until dismissed.
    timeoutType: "default",
    // toastXml is Windows-only — we omit it so the default Teams-style
    // layout (icon + title + body) is used automatically.
  });

  notification.on("click", () => {
    showMainWindow();
    // Tell the renderer to navigate to the relevant page.
    if (mainWindow) {
      mainWindow.webContents.send("notify:clicked", { route: route ?? "/notifications" });
    }
  });

  notification.show();
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Auto-update: initial check ~5s after launch + every 4 hours thereafter.
  // No-ops in dev. Mac without code-signing falls back to a notify-and-open
  // -browser flow handled inside updater.cjs.
  initAutoUpdater(getMainWindow);
  startPeriodicUpdateChecks(getMainWindow, 4 * 60 * 60 * 1000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on("window-all-closed", () => {
  // intentionally empty — stay alive in the tray.
});

app.on("before-quit", () => {
  isQuittingForReal = true;
});
