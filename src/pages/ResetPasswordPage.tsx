import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckSquare } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const schema = z.object({
  password: z.string().min(8, "Min 8 characters"),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { message: "Passwords don't match", path: ["confirm"] });

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<{ password: string; confirm: string }>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    // Check for recovery token in URL
    const hash = window.location.hash;
    if (!hash.includes("type=recovery")) {
      navigate("/login");
    }
  }, [navigate]);

  const onSubmit = async ({ password }: { password: string }) => {
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated successfully");
    navigate("/login");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[420px] rounded-modal bg-card p-8 shadow-modal">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <CheckSquare className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="font-heading text-xl font-bold text-ink-primary">Set New Password</h1>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">New Password</label>
            <Input {...register("password")} type="password" className="h-11" />
            {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Confirm Password</label>
            <Input {...register("confirm")} type="password" className="h-11" />
            {errors.confirm && <p className="mt-1 text-xs text-destructive">{errors.confirm.message}</p>}
          </div>
          <Button type="submit" disabled={loading} className="h-11 w-full font-semibold">
            {loading ? "Updating..." : "Update Password"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
