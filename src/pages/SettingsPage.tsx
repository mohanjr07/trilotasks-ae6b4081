import { useState } from "react";
import { motion } from "framer-motion";
import { User, Bell, Calendar, Lock } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import AvatarUpload from "@/components/AvatarUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const sections = [
  { key: "profile", label: "Profile", icon: User },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "leave", label: "Leave Policy", icon: Calendar },
  { key: "security", label: "Security", icon: Lock },
] as const;

type Section = typeof sections[number]["key"];

const notifPrefs = [
  { key: "task_assigned", label: "New task assigned to me", desc: "Get notified when a new task is assigned to you" },
  { key: "task_deadline", label: "Task deadline reminder", desc: "Receive a reminder 24 hours before task deadline" },
  { key: "task_progress", label: "Task progress updated", desc: "When an employee updates progress on a task", adminOnly: true },
  { key: "task_completed", label: "Task completed", desc: "When an employee marks a task as complete", adminOnly: true },
  { key: "leave_submitted", label: "Leave request submitted", desc: "When an employee submits a new leave request", adminOnly: true },
  { key: "permission_submitted", label: "Permission request submitted", desc: "When an employee submits a new permission request", adminOnly: true },
  { key: "leave_reviewed", label: "My request approved/rejected", desc: "Get notified when admin responds to your request" },
  { key: "user_created", label: "New user created", desc: "When a new user account is created", adminOnly: true },
];

export default function SettingsPage() {
  const [active, setActive] = useState<Section>("profile");
  const { profile, user, isAdmin, refreshProfile } = useAuth();
  const queryClient = useQueryClient();

  return (
    <AnimatedPage>
      <h1 className="font-heading text-[28px] font-bold text-ink-primary mb-6">Settings</h1>
      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar */}
        <div className="md:w-[200px] flex md:flex-col gap-1 overflow-x-auto md:overflow-visible border-b md:border-b-0 md:border-r border-border pb-2 md:pb-0 md:pr-4">
          {sections.filter(s => s.key !== "leave" || isAdmin).map((s) => (
            <button key={s.key} onClick={() => setActive(s.key)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                active === s.key ? "bg-accent-light text-primary" : "text-ink-secondary hover:bg-muted"
              )}>
              <s.icon className="h-4 w-4" />
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 max-w-2xl">
          {active === "profile" && <ProfileSettings />}
          {active === "notifications" && <NotificationSettings />}
          {active === "leave" && isAdmin && <LeavePolicySettings />}
          {active === "security" && <SecuritySettings />}
        </div>
      </div>
    </AnimatedPage>
  );
}

function ProfileSettings() {
  const { profile, user, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const updateProfile = useMutation({
    mutationFn: async () => {
      await supabase.from("profiles").update({ full_name: fullName, phone }).eq("id", user!.id);
    },
    onSuccess: () => { toast.success("Profile updated"); refreshProfile(); },
  });

  const changePw = useMutation({
    mutationFn: async () => {
      if (newPw !== confirmPw) throw new Error("Passwords don't match");
      if (newPw.length < 8) throw new Error("Password must be at least 8 characters");
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Password updated"); setNewPw(""); setConfirmPw(""); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="rounded-card bg-card p-6 shadow-card">
        <div className="flex items-center gap-4 mb-6">
          <AvatarUpload size="xl" />
          <div>
            <h3 className="font-heading text-lg font-semibold text-ink-primary">{profile?.full_name}</h3>
            <p className="text-xs text-ink-muted capitalize">{profile?.role}</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Full Name</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-10" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Email</label>
            <Input value={profile?.email ?? ""} disabled className="h-10 bg-muted" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-primary">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-primary">Department</label>
              <Input value={profile?.department ?? ""} disabled className="h-10 bg-muted" />
            </div>
          </div>
          <Button onClick={() => updateProfile.mutate()} disabled={updateProfile.isPending}>Save Changes</Button>
        </div>
      </div>

      <div className="rounded-card bg-card p-6 shadow-card">
        <h3 className="font-heading text-lg font-semibold text-ink-primary mb-4">Change Password</h3>
        <div className="space-y-3">
          <Input type="password" placeholder="New password (min 8 chars)" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="h-10" />
          <Input type="password" placeholder="Confirm new password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className="h-10" />
          <Button onClick={() => changePw.mutate()} disabled={changePw.isPending || !newPw}>Update Password</Button>
        </div>
      </div>
    </div>
  );
}

function NotificationSettings() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const { data: prefs = [] } = useQuery({
    queryKey: ["notif-prefs", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("notification_preferences").select("*").eq("user_id", user!.id);
      return data ?? [];
    },
    enabled: !!user,
  });

  const togglePref = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const existing = prefs.find((p: any) => p.pref_key === key);
      if (existing) {
        await supabase.from("notification_preferences").update({ is_enabled: enabled, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("notification_preferences").insert({ user_id: user!.id, pref_key: key, is_enabled: enabled });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notif-prefs"] }),
  });

  const isEnabled = (key: string) => {
    const p = prefs.find((p: any) => p.pref_key === key);
    return p ? p.is_enabled : true; // default on
  };

  const visiblePrefs = notifPrefs.filter(p => !p.adminOnly || isAdmin);

  return (
    <div className="rounded-card bg-card p-6 shadow-card">
      <h3 className="font-heading text-lg font-semibold text-ink-primary mb-1">Notification Preferences</h3>
      <p className="text-sm text-ink-muted mb-6">Choose what you want to be notified about</p>
      <div className="space-y-4">
        {visiblePrefs.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink-primary">{p.label}</p>
              <p className="text-xs text-ink-muted">{p.desc}</p>
            </div>
            <Switch
              checked={isEnabled(p.key)}
              onCheckedChange={(checked) => togglePref.mutate({ key: p.key, enabled: checked })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function LeavePolicySettings() {
  const queryClient = useQueryClient();

  const { data: policies = [] } = useQuery({
    queryKey: ["leave-policy"],
    queryFn: async () => {
      const { data } = await supabase.from("leave_policy").select("*").order("leave_type");
      return data ?? [];
    },
  });

  const [values, setValues] = useState<Record<string, number>>({});

  const updatePolicy = useMutation({
    mutationFn: async () => {
      for (const policy of policies) {
        const newDays = values[policy.leave_type];
        if (newDays !== undefined && newDays !== policy.allowed_days) {
          await supabase.from("leave_policy").update({ allowed_days: newDays, updated_at: new Date().toISOString() }).eq("id", policy.id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-policy"] });
      toast.success("Leave policy updated");
    },
  });

  const labels: Record<string, string> = {
    annual: "Annual Leave",
    sick: "Sick Leave",
    emergency: "Emergency Leave",
    unpaid: "Unpaid Leave",
    permission_hours: "Permission (hours/year)",
  };

  return (
    <div className="rounded-card bg-card p-6 shadow-card">
      <h3 className="font-heading text-lg font-semibold text-ink-primary mb-1">Leave Policy</h3>
      <p className="text-sm text-ink-muted mb-6">Configure default leave allowances per year</p>
      <div className="space-y-4">
        {policies.map((p: any) => (
          <div key={p.id} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink-primary">{labels[p.leave_type] ?? p.leave_type}</p>
              <p className="text-xs text-ink-muted">{p.leave_type === "unpaid" ? "Set to 0 for unlimited" : `Default: ${p.allowed_days} days`}</p>
            </div>
            <Input
              type="number"
              className="w-20 h-9 text-center"
              defaultValue={p.allowed_days}
              onChange={(e) => setValues(v => ({ ...v, [p.leave_type]: Number(e.target.value) }))}
            />
          </div>
        ))}
        <Button onClick={() => updatePolicy.mutate()} disabled={updatePolicy.isPending}>Save Policy</Button>
      </div>
    </div>
  );
}

function SecuritySettings() {
  const { signOut } = useAuth();

  return (
    <div className="space-y-6">
      <div className="rounded-card bg-card p-6 shadow-card">
        <h3 className="font-heading text-lg font-semibold text-ink-primary mb-4">Account Actions</h3>
        <Button variant="outline" onClick={() => {
          if (confirm("Sign out from all devices?")) signOut();
        }} className="text-destructive border-destructive/30">
          Sign Out All Devices
        </Button>
      </div>
    </div>
  );
}
