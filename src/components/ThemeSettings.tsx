import { useEffect, useState } from "react";
import { Monitor, Moon, Sun, Smartphone, Check } from "lucide-react";
import { getThemePref, onThemeChange, setThemePref, type ThemePref } from "@/lib/theme";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{ key: ThemePref; label: string; desc: string; icon: typeof Sun }> = [
  { key: "auto", label: "Automatic", desc: "Dark on phones and the mobile app, light on computers", icon: Smartphone },
  { key: "light", label: "Light", desc: "Always light", icon: Sun },
  { key: "dark", label: "Dark", desc: "Always dark", icon: Moon },
];

/** Settings → Appearance: choose the theme. Saved on this device and in your account. */
export default function ThemeSettings() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  useEffect(() => onThemeChange((_, p) => setPref(p)), []);

  const choose = async (p: ThemePref) => {
    setPref(p);
    await setThemePref(p);
    toast.success("Theme saved");
  };

  return (
    <div className="rounded-card bg-card p-4 sm:p-6 shadow-card">
      <h3 className="font-heading text-lg font-semibold text-ink-primary mb-1">Theme</h3>
      <p className="mb-4 text-sm text-ink-muted">Choose how the app looks. Your choice is saved to your account.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const on = pref === o.key;
          return (
            <button key={o.key} type="button" onClick={() => choose(o.key)} aria-pressed={on}
              className={cn("relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors",
                on ? "border-ink-primary bg-muted/60 ring-1 ring-ink-primary" : "border-border hover:bg-muted/40")}>
              {on && <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-ink-primary text-background"><Check className="h-3 w-3" /></span>}
              <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg",
                o.key === "dark" ? "bg-[hsl(60_5%_10%)] text-white" : o.key === "light" ? "bg-white text-neutral-900 border border-border" : "bg-gradient-to-br from-white to-[hsl(60_5%_10%)] text-neutral-700")}>
                <o.icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-ink-primary">{o.label}</span>
              <span className="text-xs text-ink-muted leading-snug">{o.desc}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-muted"><Monitor className="h-3.5 w-3.5" /> You can also switch quickly with the sun / moon button at the top.</p>
    </div>
  );
}
