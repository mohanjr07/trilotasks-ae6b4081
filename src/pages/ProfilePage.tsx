import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { motion } from "framer-motion";
import AnimatedPage from "@/components/AnimatedPage";
import AvatarUpload from "@/components/AvatarUpload";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ProfilePage() {
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
    <AnimatedPage>
      <div className="max-w-2xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-card bg-card p-6 shadow-card mb-6">
          <div className="flex items-center gap-4 mb-6">
            <AvatarUpload size="xl" />
            <div>
              <h1 className="font-heading text-2xl font-bold text-ink-primary">{profile?.full_name}</h1>
              <p className="text-sm text-ink-muted capitalize">{profile?.role} {profile?.department ? `· ${profile.department}` : ""}</p>
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
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-primary">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Department</label>
                <Input value={profile?.department ?? ""} disabled className="h-10 bg-muted" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Position</label>
                <Input value={profile?.position ?? ""} disabled className="h-10 bg-muted" />
              </div>
            </div>
            <Button onClick={() => updateProfile.mutate()} disabled={updateProfile.isPending}>
              {updateProfile.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-card bg-card p-6 shadow-card">
          <h3 className="font-heading text-lg font-semibold text-ink-primary mb-4">Change Password</h3>
          <div className="space-y-3">
            <Input type="password" placeholder="New password (min 8 chars)" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="h-10" />
            <Input type="password" placeholder="Confirm new password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className="h-10" />
            <Button onClick={() => changePw.mutate()} disabled={changePw.isPending || !newPw}>
              {changePw.isPending ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatedPage>
  );
}
