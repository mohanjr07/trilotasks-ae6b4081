import { useState } from "react";
import { Sun, Moon } from "lucide-react";

/** Dark mode is the default (set before the app loads, in index.html). This switches and remembers the choice. */
export default function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme-v2", next ? "dark" : "light"); } catch { /* ignore */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next ? "#0a0f1b" : "#ffffff");
  };

  return (
    <button
      onClick={toggle}
      className="flex h-10 w-10 items-center justify-center rounded-full text-ink-secondary hover:text-ink-primary hover:bg-muted transition-colors"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
