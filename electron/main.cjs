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
//  We open external http(s) links (Supabase auth flows, etc.) in the user's
//  default browser instead of inside the app shell.
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

const isDev = !app.isPackaged;

let mainWindow = null;

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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // On macOS apps usually stay open; on Windows/Linux quit when all windows close.
  if (process.platform !== "darwin") app.quit();
});
