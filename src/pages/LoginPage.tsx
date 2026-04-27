import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const schema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { signIn, profile, session } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  // Once profile is loaded after sign-in, redirect based on role
  useEffect(() => {
    if (session && profile) {
      if (profile.role === "employee") navigate("/my-dashboard", { replace: true });
      else if (profile.role === "intern") navigate("/intern-dashboard", { replace: true });
      else navigate("/dashboard", { replace: true });
    }
  }, [session, profile, navigate]);

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    const { error } = await signIn(data.email, data.password);
    if (error) {
      setLoading(false);
      toast.error("Invalid email or password");
      return;
    }
    // Do NOT navigate here — the useEffect above will fire once
    // AuthContext finishes fetching the profile after SIGNED_IN
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-[420px] rounded-modal bg-card p-8 shadow-modal"
      >
        <div className="mb-8 text-center">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Trilo Automation" className="mx-auto mb-4 h-40 object-contain" />
          <h1 className="font-heading text-2xl font-bold text-ink-primary">TaskFlow</h1>
          <p className="mt-1 text-sm text-ink-muted">Organize work. Track everything.</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Email</label>
            <Input {...register("email")} type="email" placeholder="you@company.com" autoFocus className="h-11" />
            {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Password</label>
            <div className="relative">
              <Input {...register("password")} type={showPassword ? "text" : "password"} placeholder="••••••••" className="h-11 pr-10" />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-secondary"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <Button type="submit" disabled={loading} className="h-11 w-full font-semibold">
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <a href="/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</a>
        </div>
      </motion.div>
    </div>
  );
}
