// ─────────────────────────────────────────────────────────────────────────────
//  electron/preload.cjs
//  Runs before the renderer (React app) loads, in an isolated context.
//
//  Exposes:
//    • window.IS_ELECTRON         — boolean flag App.tsx uses to decide
//                                   between BrowserRouter (web) and
//                                   HashRouter (Electron file:// origin).
//    • window.taskflowDesktop.*   — small bridge for renderer → main IPC,
//                                   used to bring the window to the front
//                                   when a native desktop notification is
//                                   clicked while the window is hidden.
// ─────────────────────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("IS_ELECTRON", true);

contextBridge.exposeInMainWorld("taskflowDesktop", {
  focusWindow: () => ipcRenderer.send("taskflow:focus-window"),
});
