import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckSquare, ArrowLeft } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({ email: z.string().email("Invalid email address") });

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<{ email: string }>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async ({ email }: { email: string }) => {
    setLoading(true);
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    setSent(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[420px] rounded-modal bg-card p-8 shadow-modal"
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <CheckSquare className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="font-heading text-xl font-bold text-ink-primary">Reset Password</h1>
        </div>

        {sent ? (
          <div className="text-center">
            <p className="text-sm text-ink-secondary">If that email is registered, you'll receive a reset link shortly.</p>
            <Link to="/login" className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
              <ArrowLeft className="h-4 w-4" /> Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-primary">Email</label>
              <Input {...register("email")} type="email" placeholder="you@company.com" autoFocus className="h-11" />
              {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <Button type="submit" disabled={loading} className="h-11 w-full font-semibold">
              {loading ? "Sending..." : "Send Reset Link"}
            </Button>
            <div className="text-center">
              <Link to="/login" className="text-sm text-ink-muted hover:text-primary">Back to login</Link>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
