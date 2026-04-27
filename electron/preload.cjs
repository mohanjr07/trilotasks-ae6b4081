// ─────────────────────────────────────────────────────────────────────────────
//  electron/preload.cjs
//  Runs before the renderer (React app) loads, in an isolated context.
//  We expose a single read-only flag so App.tsx can decide between
//  BrowserRouter (web) and HashRouter (Electron file:// origin).
// ─────────────────────────────────────────────────────────────────────────────

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("IS_ELECTRON", true);
