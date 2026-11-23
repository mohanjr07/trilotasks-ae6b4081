import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

// Loading screen (from index.html) stays on top for 2 seconds every time the app opens,
// while the app starts and loads its data underneath; then it fades out.
const SPLASH_MS = 2000;
const splash = document.querySelector<HTMLElement>("#root > .trilo-loader");
if (splash) document.body.appendChild(splash);          // keep it when React takes over #root

createRoot(document.getElementById("root")!).render(<ErrorBoundary><App /></ErrorBoundary>);

if (splash) {
  const shownFor = performance.now();                   // time since the page started loading
  setTimeout(() => {
    splash.style.transition = "opacity .35s ease";
    splash.style.opacity = "0";
    setTimeout(() => splash.remove(), 400);
  }, Math.max(0, SPLASH_MS - shownFor));
}

// Register the service worker so the website can be installed as a phone app
if (
  "serviceWorker" in navigator &&
  window.location.protocol === "https:" &&
  !(window as any).IS_ELECTRON &&
  !(window as any).Capacitor?.isNativePlatform?.()
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Inside the Android app: lock pinch-zoom so the layout (and bottom bar) never drifts
if ((window as any).Capacitor?.isNativePlatform?.()) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
}
