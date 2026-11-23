// ─────────────────────────────────────────────────────────────────────────────
//  "Get started" intro — 2 slides shown once per user (per device) after login.
//  Swipe or tap Next; "Skip" or finishing hides it for good on this device.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckSquare, FolderKanban, Wallet, CalendarDays, Bell, Menu, LayoutGrid, Hand, ArrowRight, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const APP_NAME = "Trilo TaskFlow";
const keyFor = (uid: string) => `getstarted-seen:${uid}`;

const SLIDES = [
  {
    icon: LayoutGrid,
    title: `Welcome to ${APP_NAME}`,
    text: "Everything for your work in one place — check what's due, update your tasks and raise requests from your phone or computer.",
    points: [
      { icon: CheckSquare, label: "Tasks & deadlines" },
      { icon: FolderKanban, label: "Projects & teams" },
      { icon: Wallet, label: "Payments & expenses" },
      { icon: CalendarDays, label: "Leave & attendance" },
    ],
  },
  {
    icon: Hand,
    title: "Getting around",
    text: "A few things that make it quick to use:",
    points: [
      { icon: LayoutGrid, label: "Bottom tabs take you to the main pages — slide your finger along the bar to switch" },
      { icon: Bell, label: "The bell shows updates and reminders, like tasks due tomorrow" },
      { icon: Menu, label: "The menu button opens every other page and your profile" },
      { icon: CheckSquare, label: "Keep task status up to date so your team always knows where things stand" },
    ],
  },
];

export default function GetStartedIntro() {
  const { profile } = useAuth() as any;
  const uid: string | undefined = profile?.id;
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);

  useEffect(() => {
    if (!uid) return;
    let seen = false;
    try { seen = localStorage.getItem(keyFor(uid)) === "1"; } catch { /* storage blocked: show once per session */ }
    if (!seen) { setI(0); setOpen(true); }
  }, [uid]);

  const finish = () => {
    if (uid) { try { localStorage.setItem(keyFor(uid), "1"); } catch { /* ignore */ } }
    setOpen(false);
  };
  const go = (n: number) => {
    if (n < 0 || n >= SLIDES.length) return;
    setDir(n > i ? 1 : -1); setI(n);
  };
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  const firstName = (profile?.full_name ?? "").split(" ")[0];

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div role="dialog" aria-modal="true" aria-label="Get started"
            className="relative w-full max-w-md overflow-hidden rounded-t-[28px] bg-card shadow-2xl sm:rounded-[28px]"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
            initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}>
            <button type="button" onClick={finish} aria-label="Skip"
              className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-white/25">
              Skip <X className="h-3.5 w-3.5" />
            </button>

            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div key={i} custom={dir}
                initial={{ x: dir * 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: dir * -60, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.25}
                onDragEnd={(_, info) => { if (info.offset.x < -60) (last ? finish() : go(i + 1)); else if (info.offset.x > 60) go(i - 1); }}>
                {/* glossy dark hero, same scheme as the dashboard boxes */}
                <div className="getstarted-hero px-6 pb-7 pt-10 text-white">
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,.3)]">
                    <s.icon className="h-7 w-7" />
                  </div>
                  {i === 0 && firstName && <p className="mb-1 text-sm text-white/75">Hi {firstName} 👋</p>}
                  <h2 className="font-heading text-2xl font-bold leading-tight">{s.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/80">{s.text}</p>
                </div>
                <div className={`px-6 py-5 ${i === 0 ? "grid grid-cols-2 gap-2.5" : "space-y-3"}`}>
                  {s.points.map((p) => (
                    <div key={p.label} className={i === 0
                      ? "flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 p-3"
                      : "flex items-start gap-3"}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-primary text-background">
                        <p.icon className="h-4 w-4" />
                      </span>
                      <span className={`text-sm text-ink-primary ${i === 0 ? "font-medium leading-tight" : "pt-1.5 leading-snug"}`}>{p.label}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="flex items-center gap-3 px-6 pb-6 pt-1">
              <div className="flex gap-1.5">
                {SLIDES.map((_, n) => (
                  <button key={n} type="button" onClick={() => go(n)} aria-label={`Slide ${n + 1}`}
                    className={`h-2 rounded-full transition-all ${n === i ? "w-6 bg-ink-primary" : "w-2 bg-border"}`} />
                ))}
              </div>
              <button type="button" onClick={() => (last ? finish() : go(i + 1))}
                className="ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-ink-primary px-5 text-sm font-semibold text-background shadow-md active:scale-95 transition-transform">
                {last ? "Get started" : "Next"} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
