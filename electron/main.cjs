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
//  Single-instance lock: launching TaskFlow a second time just brings
//  the existing window to the front instead of starting a duplicate.
//
//  We open external http(s) links (Supabase auth flows, etc.) in the user's
//  default browser instead of inside the app shell.
// ─────────────────────────────────────────────────────────────────────────────

const {
  app,
  BrowserWindow,
  shell,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
} = require("electron");
const path = require("path");

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
    // Open DevTools automatically in dev for easier debugging.
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // dist/index.html is produced by `vite build`. The trailing #/ ensures
    // HashRouter starts at the root and the React app picks up RootRedirect.
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

  // Override window close: hide to tray instead of quitting. The app stays
  // alive in the background so Supabase realtime can keep firing notifications.
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
  // Use the existing favicon as the tray icon — Electron auto-resizes
  // for the OS (16×16 on Windows, 22×22 on macOS, etc.).
  const iconPath = isDev
    ? path.join(__dirname, "..", "public", "favicon.png")
    : path.join(__dirname, "..", "dist", "favicon.png");

  let trayIcon = nativeImage.createFromPath(iconPath);
  if (trayIcon.isEmpty()) {
    // Last-resort fallback: an empty 16×16 transparent image so Tray() doesn't throw.
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("TaskFlow");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Open TaskFlow", click: showMainWindow },
    { type: "separator" },
    {
      label: "Quit TaskFlow",
      click: () => {
        isQuittingForReal = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  // Left-click (Windows) or single-click (mac/Linux) → open window.
  tray.on("click", showMainWindow);
  // Double-click is the long-standing Windows convention too.
  tray.on("double-click", showMainWindow);
}

// ─── IPC: renderer asks main to bring the window to the front. ────────────
// Used when the user clicks a native desktop notification.
ipcMain.on("taskflow:focus-window", () => {
  showMainWindow();
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

// We deliberately do NOT call app.quit() in window-all-closed — that's
// what keeps the tray icon alive after the user closes the window. The
// app only exits via the tray Quit menu (or OS shutdown / Cmd+Q on macOS).
app.on("window-all-closed", () => {
  // intentionally empty — stay alive in the tray.
});

app.on("before-quit", () => {
  isQuittingForReal = true;
});
