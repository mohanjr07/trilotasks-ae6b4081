// ─────────────────────────────────────────────────────────────────────────────
//  electron/preload.cjs
//  Runs before the renderer (React app) loads, in an isolated context.
//
//  Exposes:
//    • window.IS_ELECTRON            — boolean flag App.tsx uses to decide
//                                      between BrowserRouter (web) and
//                                      HashRouter (Electron file:// origin).
//    • window.taskflowDesktop.*      — IPC bridge used by the renderer:
//
//        focusWindow()               — bring the window to the front.
//
//        showNotification({          — fire a Teams-style native desktop
//          title, body, route          notification via the main process.
//        })                            Clicking it focuses the window and
//                                      navigates to `route`.
//
//        onNotificationClicked(cb)   — register a callback that fires when
//                                      the user clicks a native toast. cb
//                                      receives { route }.  Returns an
//                                      unsubscribe function.
// ─────────────────────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("IS_ELECTRON", true);

contextBridge.exposeInMainWorld("taskflowDesktop", {
  // Bring the app window to the front.
  focusWindow: () => ipcRenderer.send("taskflow:focus-window"),

  // Ask the main process to show a native OS notification (Teams-style).
  showNotification: ({ title, body, route }) =>
    ipcRenderer.send("notify:show", { title, body, route }),

  // Subscribe to notification-click events sent back from main.
  // Returns an unsubscribe function so React can clean up on unmount.
  onNotificationClicked: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("notify:clicked", handler);
    return () => ipcRenderer.removeListener("notify:clicked", handler);
  },
});
