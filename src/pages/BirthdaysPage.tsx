import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Cake, Gift, Pencil, Sparkles, PartyPopper } from "lucide-react";
import { format, differenceInCalendarDays, setYear, isToday } from "date-fns";
import { toast } from "sonner";
import { motion } from "framer-motion";

type Person = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role: string | null;
  department: string | null;
  position: string | null;
  date_of_birth: string | null;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function nextBirthday(dob: string) {
  const d = new Date(dob);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let next = setYear(d, today.getFullYear());
  next.setHours(0, 0, 0, 0);
  if (next < today) next = setYear(d, today.getFullYear() + 1);
  return next;
}

function turningAge(dob: string) {
  const d = new Date(dob);
  const nb = nextBirthday(dob);
  return nb.getFullYear() - d.getFullYear();
}

export default function BirthdaysPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [editing, setEditing] = useState<Person | null>(null);
  const [dobInput, setDobInput] = useState<string>("");

  const { data: people = [], isLoading } = useQuery({
    queryKey: ["birthdays-people"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, role, department, position, date_of_birth")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data as Person[];
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, dob }: { id: string; dob: string | null }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ date_of_birth: dob })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["birthdays-people"] });
      toast.success("Birthday updated");
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update"),
  });

  const { todays, upcoming, byMonth } = useMemo(() => {
    const withDob = people.filter((p) => p.date_of_birth);
    const todays = withDob.filter((p) => {
      const d = new Date(p.date_of_birth!);
      const t = new Date();
      return d.getDate() === t.getDate() && d.getMonth() === t.getMonth();
    });
    const upcoming = [...withDob]
      .map((p) => ({ p, nb: nextBirthday(p.date_of_birth!) }))
      .sort((a, b) => a.nb.getTime() - b.nb.getTime())
      .slice(0, 8);

    const byMonth: Record<number, Person[]> = {};
    withDob.forEach((p) => {
      const m = new Date(p.date_of_birth!).getMonth();
      (byMonth[m] ||= []).push(p);
    });
    Object.values(byMonth).forEach((arr) =>
      arr.sort(
        (a, b) =>
          new Date(a.date_of_birth!).getDate() - new Date(b.date_of_birth!).getDate(),
      ),
    );
    return { todays, upcoming, byMonth };
  }, [people]);

  const openEdit = (p: Person) => {
    setEditing(p);
    setDobInput(p.date_of_birth ?? "");
  };

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-7xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-pink-400 via-rose-400 to-orange-400 flex items-center justify-center shadow-lg shadow-rose-500/20">
              <Cake className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Birthdays</h1>
              <p className="text-sm text-muted-foreground">
                Celebrate the people who make our team special.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Today's Birthdays */}
      {todays.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <PartyPopper className="h-4 w-4 text-rose-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Today
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {todays.map((p) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative overflow-hidden rounded-3xl p-8 md:p-10 bg-gradient-to-br from-rose-500/10 via-pink-500/5 to-orange-500/10 border border-rose-500/20"
              >
                <div className="absolute -top-10 -right-10 h-48 w-48 rounded-full bg-rose-500/10 blur-3xl" />
                <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-orange-500/10 blur-3xl" />
                <div className="relative flex items-center gap-6">
                  <div className="relative">
                    <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="2xl" className="ring-[6px] ring-rose-400/40" />
                    <span className="absolute -bottom-1.5 -right-1.5 h-9 w-9 rounded-full bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center shadow-lg">
                      <Cake className="h-4.5 w-4.5 text-white" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-2xl md:text-3xl font-bold truncate">{p.full_name}</p>
                    <p className="text-sm text-muted-foreground truncate mt-1">
                      {p.position || p.role} {p.department ? `• ${p.department}` : ""}
                    </p>
                    <p className="mt-3 text-base md:text-lg font-semibold bg-gradient-to-r from-rose-500 to-orange-500 bg-clip-text text-transparent">
                      🎉 Happy Birthday — turning {turningAge(p.date_of_birth!)}!
                    </p>
                  </div>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" className="h-10 w-10" onClick={() => openEdit(p)}>
                      <Pencil className="h-5 w-5" />
                    </Button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Upcoming
          </h2>
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : upcoming.length === 0 ? (
          <div className="text-sm text-muted-foreground border border-dashed rounded-2xl p-8 text-center">
            No birthdays added yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {upcoming.map(({ p, nb }) => {
              const days = differenceInCalendarDays(nb, new Date());
              const today = isToday(nb);
              return (
                <motion.div
                  key={p.id}
                  whileHover={{ y: -3 }}
                  className="group relative rounded-2xl border border-border bg-card p-5 hover:shadow-lg hover:border-rose-300/50 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{p.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.position || p.role || "—"}
                      </p>
                    </div>
                    {isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
                        onClick={() => openEdit(p)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between pt-3 border-t border-border">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Gift className="h-3.5 w-3.5 text-rose-500" />
                      <span className="font-medium">{format(nb, "MMM d")}</span>
                    </div>
                    <span
                      className={
                        "text-[11px] font-semibold px-2 py-0.5 rounded-full " +
                        (today
                          ? "bg-rose-500 text-white"
                          : days <= 7
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-muted text-muted-foreground")
                      }
                    >
                      {today ? "Today" : days === 1 ? "Tomorrow" : `in ${days}d`}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* All by month */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Cake className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            All birthdays
          </h2>
        </div>
        <div className="space-y-6">
          {MONTHS.map((m, idx) =>
            byMonth[idx]?.length ? (
              <div key={m}>
                <h3 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">
                  {m}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {byMonth[idx].map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card/50 p-3 hover:bg-card transition-colors"
                    >
                      <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{p.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(p.date_of_birth!), "MMMM d")}
                        </p>
                      </div>
                      {isAdmin && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>

        {/* Admins: people missing DOB */}
        {isAdmin && people.some((p) => !p.date_of_birth) && (
          <div className="mt-8">
            <h3 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">
              Missing birthday
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {people
                .filter((p) => !p.date_of_birth)
                .map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-xl border border-dashed border-border p-3"
                  >
                    <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{p.full_name}</p>
                      <p className="text-xs text-muted-foreground">No date set</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                      Add
                    </Button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </section>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit birthday</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <UserAvatar name={editing.full_name} avatarUrl={editing.avatar_url} size="lg" />
                <div>
                  <p className="font-medium">{editing.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {editing.position || editing.role}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Date of birth</label>
                <Input
                  type="date"
                  value={dobInput}
                  onChange={(e) => setDobInput(e.target.value)}
                  max={format(new Date(), "yyyy-MM-dd")}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {editing?.date_of_birth && (
              <Button
                variant="ghost"
                onClick={() =>
                  editing && update.mutate({ id: editing.id, dob: null })
                }
                disabled={update.isPending}
              >
                Clear
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                editing &&
                dobInput &&
                update.mutate({ id: editing.id, dob: dobInput })
              }
              disabled={!dobInput || update.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
