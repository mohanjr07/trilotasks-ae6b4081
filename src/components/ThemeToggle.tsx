import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { onThemeChange, setThemePref } from "@/lib/theme";

/** Quick light/dark switch in the header. The choice is saved (see Settings → Appearance). */
export default function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true);
  useEffect(() => onThemeChange((d) => setDark(d)), []);

  return (
    <button
      onClick={() => setThemePref(dark ? "light" : "dark")}
      className="flex h-10 w-10 items-center justify-center rounded-full text-ink-secondary hover:text-ink-primary hover:bg-muted transition-colors"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
