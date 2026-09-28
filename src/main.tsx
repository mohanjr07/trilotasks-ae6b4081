import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

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
