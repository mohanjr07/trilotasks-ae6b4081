import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, X, Users, Video, Clock, Calendar, ExternalLink, Trash2, CheckCircle2,
} from "lucide-react";
import { format, parseISO, isPast } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Meeting = {
  id: string;
  title: string;
  description: string | null;
  meeting_link: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
  created_by: string;
  status: string | null;
  created_at: string | null;
};

type Participant = {
  id: string;
  meeting_id: string;
  user_id: string;
  joined_at: string | null;
  profiles?: { full_name: string; email: string } | null;
};

type MeetingDraft = {
  title: string;
  description: string;
  link: string;
  date: string;
  time: string;
  duration: string;
  selectedUsers: string[];
};

const TEAM_CREATE_OPEN_KEY = "team-meetings:create-open";
const TEAM_CREATE_DRAFT_KEY = "team-meetings:create-draft";

const getStoredCreateOpen = () => {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(TEAM_CREATE_OPEN_KEY) === "true";
};

const getInitialMeetingDraft = (): MeetingDraft => {
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem(TEAM_CREATE_DRAFT_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<MeetingDraft>;
        return {
          title: parsed.title ?? "",
          description: parsed.description ?? "",
          link: parsed.link ?? "",
          date: parsed.date ?? "",
          time: parsed.time ?? "10:00",
          duration: parsed.duration ?? "30",
          selectedUsers: Array.isArray(parsed.selectedUsers) ? parsed.selectedUsers : [],
        };
      } catch {
        sessionStorage.removeItem(TEAM_CREATE_DRAFT_KEY);
      }
    }
  }

  return {
    title: "",
    description: "",
    link: "",
    date: "",
    time: "10:00",
    duration: "30",
    selectedUsers: [],
  };
};

const clearMeetingDraftStorage = () => {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(TEAM_CREATE_DRAFT_KEY);
};

export default function TeamsPage() {
  const { profile, user } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "manager";
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(getStoredCreateOpen);
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (showCreate) {
      sessionStorage.setItem(TEAM_CREATE_OPEN_KEY, "true");
      return;
    }
    sessionStorage.removeItem(TEAM_CREATE_OPEN_KEY);
  }, [showCreate]);

  const handleOpenCreate = () => setShowCreate(true);
  const handleCloseCreate = () => {
    clearMeetingDraftStorage();
    setShowCreate(false);
  };

  // Fetch meetings
  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ["team-meetings", isAdmin],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_meetings")
        .select("*")
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Meeting[];
    },
    enabled: !!profile,
  });

  // Fetch participants for selected meeting
  const { data: participants = [] } = useQuery({
    queryKey: ["meeting-participants", selectedMeeting],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_meeting_participants")
        .select("*")
        .eq("meeting_id", selectedMeeting!);
      
      // Fetch profile info for each participant
      const parts = data ?? [];
      if (!parts.length) return [] as Participant[];
      const userIds = parts.map((p: any) => p.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
      return parts.map((p: any) => ({
        ...p,
        profiles: profileMap[p.user_id] ?? null,
      })) as Participant[];
    },
    enabled: !!selectedMeeting,
  });

  const deleteMeeting = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("team_meetings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-meetings"] });
      setSelectedMeeting(null);
      toast.success("Meeting deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Join meeting (mark as joined)
  const joinMeeting = useMutation({
    mutationFn: async (meetingId: string) => {
      const { error } = await supabase
        .from("team_meeting_participants")
        .update({ joined_at: new Date().toISOString() })
        .eq("meeting_id", meetingId)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meeting-participants"] });
      toast.success("Joined meeting!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const upcoming = meetings.filter((m) => !isPast(parseISO(m.scheduled_at)));
  const past = meetings.filter((m) => isPast(parseISO(m.scheduled_at)));

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">Teams</h1>
        {isAdmin && (
          <Button onClick={handleOpenCreate} size="sm">
            <Plus className="h-4 w-4 mr-1.5" /> Create Meeting
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-card" />
          ))}
        </div>
      ) : !meetings.length ? (
        <div className="text-center py-16">
          <Users className="h-12 w-12 text-ink-muted mx-auto mb-3" />
          <p className="text-ink-muted text-sm">No team meetings yet</p>
          {isAdmin && (
            <Button onClick={handleOpenCreate} variant="outline" size="sm" className="mt-3">
              <Plus className="h-4 w-4 mr-1.5" /> Create your first meeting
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            {/* Upcoming */}
            {upcoming.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-ink-muted uppercase mb-3">
                  Upcoming ({upcoming.length})
                </h2>
                <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
                  {upcoming.map((m) => (
                    <MeetingCard
                      key={m.id}
                      meeting={m}
                      isAdmin={isAdmin}
                      isSelected={selectedMeeting === m.id}
                      onSelect={() => setSelectedMeeting(m.id)}
                      onDelete={() => {
                        if (confirm("Delete this meeting?")) deleteMeeting.mutate(m.id);
                      }}
                      onJoin={() => {
                        if (m.meeting_link) window.open(m.meeting_link, "_blank");
                        joinMeeting.mutate(m.id);
                      }}
                      userId={user?.id}
                    />
                  ))}
                </motion.div>
              </div>
            )}

            {/* Past */}
            {past.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-ink-muted uppercase mb-3">
                  Past ({past.length})
                </h2>
                <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
                  {past.map((m) => (
                    <MeetingCard
                      key={m.id}
                      meeting={m}
                      isAdmin={isAdmin}
                      isSelected={selectedMeeting === m.id}
                      onSelect={() => setSelectedMeeting(m.id)}
                      onDelete={() => {
                        if (confirm("Delete this meeting?")) deleteMeeting.mutate(m.id);
                      }}
                      isPast
                      userId={user?.id}
                    />
                  ))}
                </motion.div>
              </div>
            )}
          </div>

          {/* Participant detail panel */}
          <AnimatePresence>
            {selectedMeeting && (
              <motion.div
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                className="rounded-card bg-card p-5 shadow-card h-fit sticky top-20"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-heading text-base font-bold text-ink-primary">Participants</h3>
                  <button onClick={() => setSelectedMeeting(null)} className="text-ink-muted hover:text-ink-primary">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {participants.length ? (
                  <div className="space-y-2">
                    {participants.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                          {(p.profiles?.full_name ?? "U").charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink-primary truncate">
                            {p.profiles?.full_name ?? "User"}
                          </p>
                          <p className="text-xs text-ink-muted truncate">{p.profiles?.email ?? ""}</p>
                        </div>
                        {p.joined_at ? (
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        ) : (
                          <span className="text-[10px] text-ink-muted">Invited</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted text-center py-4">No participants yet</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {isAdmin && <CreateMeetingModal open={showCreate} onClose={handleCloseCreate} />}
    </AnimatedPage>
  );
}

function MeetingCard({
  meeting, isAdmin, isSelected, onSelect, onDelete, onJoin, isPast, userId,
}: {
  meeting: Meeting;
  isAdmin: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onJoin?: () => void;
  isPast?: boolean;
  userId?: string;
}) {
  return (
    <motion.div
      variants={staggerItem}
      onClick={onSelect}
      className={`flex items-center gap-4 rounded-card p-4 shadow-card cursor-pointer transition-all hover:shadow-card-hover ${
        isSelected ? "ring-1 ring-primary bg-accent-light/50" : "bg-card"
      } ${isPast ? "opacity-60" : ""}`}
    >
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg shrink-0 ${
        isPast ? "bg-muted" : "bg-primary/10"
      }`}>
        <Video className={`h-5 w-5 ${isPast ? "text-ink-muted" : "text-primary"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-primary truncate">{meeting.title}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="flex items-center gap-1 text-xs text-ink-muted">
            <Calendar className="h-3 w-3" />
            {format(parseISO(meeting.scheduled_at), "MMM d, yyyy")}
          </span>
          <span className="flex items-center gap-1 text-xs text-ink-muted">
            <Clock className="h-3 w-3" />
            {format(parseISO(meeting.scheduled_at), "h:mm a")}
          </span>
          {meeting.duration_minutes && (
            <span className="text-xs text-ink-muted">{meeting.duration_minutes}min</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!isPast && meeting.meeting_link && onJoin && (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); onJoin(); }}
            className="text-xs"
          >
            <ExternalLink className="h-3 w-3 mr-1" /> Join
          </Button>
        )}
        {isAdmin && onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-ink-muted hover:text-destructive transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function CreateMeetingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(() => getInitialMeetingDraft().title);
  const [description, setDescription] = useState(() => getInitialMeetingDraft().description);
  const [link, setLink] = useState(() => getInitialMeetingDraft().link);
  const [date, setDate] = useState(() => getInitialMeetingDraft().date);
  const [time, setTime] = useState(() => getInitialMeetingDraft().time);
  const [duration, setDuration] = useState(() => getInitialMeetingDraft().duration);
  const [selectedUsers, setSelectedUsers] = useState<string[]>(() => getInitialMeetingDraft().selectedUsers);

  useEffect(() => {
    if (!open) return;
    const draft = getInitialMeetingDraft();
    setTitle(draft.title);
    setDescription(draft.description);
    setLink(draft.link);
    setDate(draft.date);
    setTime(draft.time);
    setDuration(draft.duration);
    setSelectedUsers(draft.selectedUsers);
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    sessionStorage.setItem(
      TEAM_CREATE_DRAFT_KEY,
      JSON.stringify({
        title,
        description,
        link,
        date,
        time,
        duration,
        selectedUsers,
      } satisfies MeetingDraft),
    );
  }, [open, title, description, link, date, time, duration, selectedUsers]);

  const resetDraft = () => {
    clearMeetingDraftStorage();
    setTitle("");
    setDescription("");
    setLink("");
    setDate("");
    setTime("10:00");
    setDuration("30");
    setSelectedUsers([]);
  };

  const handleClose = () => {
    resetDraft();
    onClose();
  };

  // Fetch employees to invite
  const { data: employees = [] } = useQuery({
    queryKey: ["all-employees-for-meeting"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .eq("is_active", true)
        .order("full_name");
      return data ?? [];
    },
    enabled: open,
  });

  const toggleUser = (id: string) => {
    setSelectedUsers((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    setSelectedUsers(employees.map((e: any) => e.id));
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !date || !time) {
        toast.error("Title, date and time are required");
        throw new Error("Missing fields");
      }
      if (!selectedUsers.length) {
        toast.error("Select at least one participant");
        throw new Error("No participants");
      }

      const scheduledAt = new Date(`${date}T${time}`).toISOString();

      // Create meeting
      const { data: meeting, error } = await supabase
        .from("team_meetings")
        .insert([{
          title: title.trim(),
          description: description.trim() || null,
          meeting_link: link.trim() || null,
          scheduled_at: scheduledAt,
          duration_minutes: parseInt(duration) || 30,
          created_by: user!.id,
        }])
        .select()
        .single();
      if (error) throw error;

      // Add participants (triggers notification for each)
      const participants = selectedUsers.map((uid) => ({
        meeting_id: meeting.id,
        user_id: uid,
      }));
      const { error: pError } = await supabase
        .from("team_meeting_participants")
        .insert(participants);
      if (pError) throw pError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-meetings"] });
      toast.success("Meeting created & participants notified!");
      resetDraft();
      onClose();
    },
    onError: (e: any) => {
      if (e.message !== "Missing fields" && e.message !== "No participants") {
        toast.error(e.message);
      }
    },
  });

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-primary/30" onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-[520px] max-h-[85vh] overflow-y-auto rounded-modal bg-card p-6 shadow-modal mx-4"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-bold text-ink-primary">Create Meeting</h2>
              <button onClick={handleClose} className="text-ink-muted hover:text-ink-primary">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Title *</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sprint Planning" />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Description</label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Meeting agenda..." rows={2} />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Meeting Link</label>
                <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://teams.microsoft.com/l/meetup-join/..." />
                <p className="text-xs text-ink-muted mt-1">Paste your Microsoft Teams meeting link here</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">Date *</label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">Time *</label>
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">Duration</label>
                  <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="30" />
                </div>
              </div>

              {/* Participant selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-ink-primary">
                    Invite Participants * ({selectedUsers.length} selected)
                  </label>
                  <button onClick={selectAll} className="text-xs text-primary hover:underline">
                    Select All
                  </button>
                </div>
                <div className="max-h-[200px] overflow-y-auto rounded-lg border border-border p-2 space-y-1">
                  {employees.map((emp: any) => (
                    <label
                      key={emp.id}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                        selectedUsers.includes(emp.id) ? "bg-primary/10" : "hover:bg-muted"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(emp.id)}
                        onChange={() => toggleUser(emp.id)}
                        className="rounded border-border"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-primary truncate">{emp.full_name}</p>
                        <p className="text-xs text-ink-muted truncate">{emp.email} · {emp.role}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={() => create.mutate()} disabled={create.isPending}>
                  {create.isPending ? "Creating..." : "Create Meeting"}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
