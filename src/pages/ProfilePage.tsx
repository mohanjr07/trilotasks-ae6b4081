import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
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

  // payroll details (used on the payslip)
  const [pay, setPay] = useState({ code: "", position: "", joined: "", pan: "", account: "", ifsc: "" });
  const setP = (k: keyof typeof pay, v: string) => setPay((x) => ({ ...x, [k]: v }));
  const { data: payData, error: payError } = useQuery({
    queryKey: ["my-payroll", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("payroll_profile", { p_user: user!.id });
      if (error) throw error;
      return (data?.[0] ?? null) as null | { employee_code: string | null; position: string | null; joined_at: string | null; pan_number: string | null; account_number: string | null; ifsc_code: string | null };
    },
  });
  useEffect(() => {
    setPay({
      code: payData?.employee_code ?? "", position: payData?.position ?? profile?.position ?? "",
      joined: payData?.joined_at?.slice(0, 10) ?? "", pan: payData?.pan_number ?? "",
      account: payData?.account_number ?? "", ifsc: payData?.ifsc_code ?? "",
    });
  }, [payData, profile?.position]);
  const savePay = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("save_my_payroll_details", {
        p_employee_code: pay.code, p_position: pay.position, p_joined: pay.joined || null,
        p_pan: pay.pan, p_account: pay.account, p_ifsc: pay.ifsc,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Payroll details saved"); refreshProfile(); },
    onError: (e: any) => toast.error(/save_my_payroll_details/.test(e?.message ?? "") ? "Payroll details are not set up yet — ask the admin to run the payslips SQL" : e?.message ?? "Could not save"),
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
          className="rounded-card bg-card p-4 sm:p-6 shadow-card mb-6">
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
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-primary">Department</label>
              <Input value={profile?.department ?? ""} disabled className="h-10 bg-muted" />
            </div>
            <Button onClick={() => updateProfile.mutate()} disabled={updateProfile.isPending}>
              {updateProfile.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="rounded-card bg-card p-4 sm:p-6 shadow-card mb-6">
          <h3 className="font-heading text-lg font-semibold text-ink-primary">Payroll details</h3>
          <p className="text-xs text-ink-muted mb-4">Used on your payslip. Only you, Anu (accounts) and admins can see these.</p>
          {payError && <p className="mb-3 rounded-md bg-warning-light px-3 py-2 text-xs text-warning">Payroll details are not set up yet.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">Employee ID</label>
              <Input value={pay.code} onChange={(e) => setP("code", e.target.value)} placeholder="#003" className="h-10" /></div>
            <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">Date of Joining</label>
              <Input type="date" value={pay.joined} onChange={(e) => setP("joined", e.target.value)} className="h-10" /></div>
            <div className="sm:col-span-2"><label className="mb-1.5 block text-sm font-medium text-ink-primary">Position</label>
              <Input value={pay.position} onChange={(e) => setP("position", e.target.value)} className="h-10" /></div>
            <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">PAN Number</label>
              <Input value={pay.pan} onChange={(e) => setP("pan", e.target.value.toUpperCase())} maxLength={10} className="h-10" /></div>
            <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">Account Number</label>
              <Input value={pay.account} onChange={(e) => setP("account", e.target.value.replace(/\s/g, ""))} inputMode="numeric" className="h-10" /></div>
            <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">IFSC Code</label>
              <Input value={pay.ifsc} onChange={(e) => setP("ifsc", e.target.value.toUpperCase())} maxLength={11} className="h-10" /></div>
          </div>
          <Button className="mt-4" onClick={() => savePay.mutate()} disabled={savePay.isPending}>
            {savePay.isPending ? "Saving..." : "Save payroll details"}
          </Button>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-card bg-card p-4 sm:p-6 shadow-card">
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
