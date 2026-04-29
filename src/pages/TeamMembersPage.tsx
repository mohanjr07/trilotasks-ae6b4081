import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Workflow, Plus, X, UserMinus, UserPlus, Search, Crown, Shield,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Person = {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: "super_admin" | "admin" | "manager" | "employee" | "intern";
  position: string | null;
  department: string | null;
  manager_id: string | null;
  is_active: boolean;
};

const roleColor = (role: string) => {
  switch (role) {
    case "super_admin": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    case "admin":       return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
    case "manager":     return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    case "employee":    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "intern":      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    default:            return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
  }
};

export default function TeamMembersPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const isManager = profile?.role === "manager";

  const [pickerForManagerId, setPickerForManagerId] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [removeMember, setRemoveMember] = useState<{ id: string; name: string } | null>(null);

  const { data: people = [], isLoading } = useQuery({
    queryKey: ["team-people"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, role, position, department, manager_id, is_active")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Person[];
    },
  });

  const managers = useMemo(
    () => people.filter(p => p.role === "manager" && p.is_active),
    [people]
  );

  const teamsByManager = useMemo(() => {
    return managers.map(m => ({
      manager: m,
      members: people.filter(p => p.manager_id === m.id),
    }));
  }, [managers, people]);

  // Anyone (active) without a manager who is not a manager/admin themselves —
  // candidates to be added to a team.
  const unassigned = useMemo(
    () => people.filter(p =>
      p.is_active &&
      p.role !== "manager" &&
      p.role !== "admin" &&
      p.role !== "super_admin" &&
      !p.manager_id
    ),
    [people]
  );

  // For non-admin/manager: identify "my manager" + teammates.
  const myManager = useMemo(
    () => profile?.manager_id ? people.find(p => p.id === profile.manager_id) : null,
    [people, profile?.manager_id]
  );
  const myTeammates = useMemo(
    () => profile?.manager_id
      ? people.filter(p => p.manager_id === profile.manager_id && p.id !== profile.id)
      : [],
    [people, profile?.id, profile?.manager_id]
  );

  const assignMutation = useMutation({
    mutationFn: async ({ memberId, managerId }: { memberId: string; managerId: string | null }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ manager_id: managerId })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-people"] });
      toast.success("Team updated");
      setPickerForManagerId(null);
      setPickerSearch("");
      setRemoveMember(null);
    },
    onError: (e: any) => toast.error("Failed: " + (e?.message ?? "")),
  });

  const filteredPickerOptions = useMemo(() => {
    const q = pickerSearch.toLowerCase();
    return unassigned.filter(p =>
      !q || p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
    );
  }, [unassigned, pickerSearch]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-ink-primary flex items-center gap-2">
            <Workflow className="h-6 w-6 text-primary" /> Team Members
          </h2>
          <p className="text-sm text-ink-muted mt-0.5">
            {isAdmin
              ? "Each manager and the people who report to them. Add or remove members below."
              : isManager
                ? "Your team — the people who report to you."
                : "Your manager and teammates."}
          </p>
        </div>
        {isAdmin && unassigned.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-3 py-1 text-xs font-medium">
            {unassigned.length} unassigned
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card flex items-center justify-center py-16 text-ink-muted text-sm">
          Loading…
        </div>
      ) : isAdmin ? (
        <>
          {teamsByManager.length === 0 ? (
            <EmptyBox
              icon={Workflow}
              title="No managers yet"
              text="Promote someone to the manager role under Users to start building teams."
            />
          ) : (
            <div className="space-y-6">
              {teamsByManager.map(({ manager, members }) => (
                <TeamFlow
                  key={manager.id}
                  manager={manager}
                  members={members}
                  isAdmin
                  onAddMember={() => { setPickerForManagerId(manager.id); setPickerSearch(""); }}
                  onRemoveMember={(m) => setRemoveMember({ id: m.id, name: m.full_name })}
                />
              ))}
            </div>
          )}

          {/* Unassigned strip */}
          {unassigned.length > 0 && (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-ink-primary">Unassigned people</h3>
                <span className="text-xs text-ink-muted">{unassigned.length}</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {unassigned.map(p => (
                  <div key={p.id} className="rounded-lg border border-border bg-card px-3 py-2 flex items-center gap-2">
                    <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-primary truncate">{p.full_name}</p>
                      <p className="text-[11px] text-ink-muted capitalize">{p.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : isManager ? (
        // Manager view: only their own team
        (() => {
          const myTeam = teamsByManager.find(t => t.manager.id === profile?.id);
          const ownMembers = myTeam?.members ?? [];
          return (
            <TeamFlow
              manager={profile as any as Person}
              members={ownMembers}
              isAdmin={false}
            />
          );
        })()
      ) : (
        // Employee / intern view
        myManager ? (
          <TeamFlow
            manager={myManager}
            members={[profile as any as Person, ...myTeammates].filter(Boolean) as Person[]}
            isAdmin={false}
            highlightSelfId={profile?.id}
          />
        ) : (
          <EmptyBox
            icon={Workflow}
            title="No team yet"
            text="You haven't been assigned to a manager. An admin can do this from the Team Members page."
          />
        )
      )}

      {/* Add-member picker (admin) */}
      <AnimatePresence>
        {pickerForManagerId && isAdmin && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-40" onClick={() => setPickerForManagerId(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-ink-primary">Add team member</h3>
                  <button onClick={() => setPickerForManagerId(null)} className="text-ink-muted hover:text-ink-primary">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
                  <Input
                    autoFocus
                    placeholder="Search a person…"
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="flex-1 overflow-y-auto -mx-2 px-2">
                  {filteredPickerOptions.length === 0 ? (
                    <p className="text-sm text-ink-muted text-center py-8">
                      {unassigned.length === 0 ? "Everyone is already assigned to a team." : "No matches."}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {filteredPickerOptions.map(p => (
                        <li key={p.id}>
                          <button
                            onClick={() => assignMutation.mutate({ memberId: p.id, managerId: pickerForManagerId })}
                            disabled={assignMutation.isPending}
                            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted text-left transition disabled:opacity-50"
                          >
                            <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-ink-primary truncate">{p.full_name}</p>
                              <p className="text-xs text-ink-muted truncate">{p.email}</p>
                            </div>
                            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", roleColor(p.role))}>
                              {p.role}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Remove confirm (admin) */}
      <AnimatePresence>
        {removeMember && isAdmin && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-40" onClick={() => setRemoveMember(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
                <h3 className="text-lg font-semibold text-ink-primary">Remove from team?</h3>
                <p className="text-sm text-ink-muted">
                  <span className="font-medium text-ink-primary">{removeMember.name}</span> will no longer report to this manager.
                </p>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setRemoveMember(null)}>Cancel</Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => assignMutation.mutate({ memberId: removeMember.id, managerId: null })}
                    disabled={assignMutation.isPending}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// =========================================================================
// One manager + team rendered as a flowchart
// =========================================================================
function TeamFlow({
  manager, members, isAdmin, onAddMember, onRemoveMember, highlightSelfId,
}: {
  manager: Person;
  members: Person[];
  isAdmin: boolean;
  onAddMember?: () => void;
  onRemoveMember?: (m: Person) => void;
  highlightSelfId?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-xs uppercase tracking-wide text-ink-muted font-semibold">
            Manager · {members.length} member{members.length === 1 ? "" : "s"}
          </span>
        </div>
        {isAdmin && (
          <Button size="sm" variant="outline" className="gap-1" onClick={onAddMember}>
            <UserPlus className="h-3.5 w-3.5" /> Add member
          </Button>
        )}
      </div>

      {/* Flow chart */}
      <div className="flex flex-col items-center overflow-x-auto">
        {/* Manager card */}
        <PersonNode person={manager} isManager />

        {members.length > 0 && (
          <>
            {/* Vertical drop from manager */}
            <div className="w-px h-6 bg-border" />

            {/* Branches */}
            <div className="flex items-stretch">
              {members.map((m, i) => {
                const isFirst = i === 0;
                const isLast = i === members.length - 1;
                return (
                  <div key={m.id} className="flex flex-col items-center px-3">
                    {/* connector row: half-line(s) + vertical drop */}
                    <div className="flex h-6 w-full">
                      <div className={cn("flex-1", isFirst ? "" : "border-t border-border")} />
                      <div className="w-px bg-border" />
                      <div className={cn("flex-1", isLast ? "" : "border-t border-border")} />
                    </div>
                    <PersonNode
                      person={m}
                      onRemove={isAdmin && onRemoveMember ? () => onRemoveMember(m) : undefined}
                      highlight={highlightSelfId === m.id}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}

        {members.length === 0 && (
          <p className="mt-4 text-sm text-ink-muted">
            No team members yet{isAdmin ? ". Click Add member to get started." : "."}
          </p>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// Single person card in the flow
// =========================================================================
function PersonNode({
  person, isManager, onRemove, highlight,
}: {
  person: Person;
  isManager?: boolean;
  onRemove?: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card px-4 py-3 flex items-center gap-3 shadow-sm min-w-[200px] max-w-[240px]",
        isManager
          ? "border-primary/40 bg-primary/5"
          : highlight
            ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/10"
            : "border-border"
      )}
    >
      <UserAvatar name={person.full_name} avatarUrl={person.avatar_url} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {isManager && <Crown className="h-3 w-3 text-primary shrink-0" />}
          <p className="text-sm font-medium text-ink-primary truncate">{person.full_name}</p>
        </div>
        <p className="text-[11px] text-ink-muted truncate">{person.position ?? person.email}</p>
        <span className={cn("inline-flex items-center rounded-full mt-1 px-2 py-0.5 text-[10px] font-medium capitalize", roleColor(person.role))}>
          {person.role}
        </span>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-card border border-border flex items-center justify-center text-ink-muted hover:text-destructive hover:border-destructive shadow-sm"
          title="Remove from team"
        >
          <UserMinus className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function EmptyBox({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card flex flex-col items-center justify-center py-16 text-center px-4">
      <Icon className="h-10 w-10 text-ink-muted mb-3" />
      <h3 className="text-base font-semibold text-ink-primary">{title}</h3>
      <p className="text-sm text-ink-muted mt-1 max-w-md">{text}</p>
    </div>
  );
}
