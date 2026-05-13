import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff, Mail, KeyRound } from "lucide-react";
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
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

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
  };

  return (
    <div className="flex min-h-screen bg-[#f0f0f0]">
      {/* Left illustration panel */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center bg-[#f0f0f0] p-12">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="relative w-full max-w-lg"
        >
          {/* Decorative blobs */}
          <div className="absolute -top-10 -left-10 w-48 h-48 rounded-full bg-pink-300 opacity-40 blur-3xl" />
          <div className="absolute bottom-0 right-0 w-40 h-40 rounded-full bg-purple-300 opacity-40 blur-3xl" />

          {/* Phone mockup illustration */}
          <div className="relative flex items-end justify-center gap-4">
            {/* Lock icon circle */}
            <div className="absolute top-8 left-8 w-20 h-20 rounded-full bg-pink-400 flex items-center justify-center shadow-lg z-10">
              <svg viewBox="0 0 24 24" fill="white" className="w-10 h-10">
                <path d="M12 1C9.24 1 7 3.24 7 6v1H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2V6c0-2.76-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3v1H9V6c0-1.66 1.34-3 3-3zm0 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
              </svg>
            </div>

            {/* Gear icon */}
            <div className="absolute top-4 right-16 w-14 h-14 rounded-full bg-gray-300 opacity-70 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="gray" className="w-8 h-8">
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.02 7.02 0 0 0-1.62-.94l-.36-2.54A.484.484 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.47.47 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.03.7 1.62.94l.36 2.54c.05.24.26.42.5.42h4c.25 0 .46-.18.49-.42l.36-2.54a6.89 6.89 0 0 0 1.61-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
              </svg>
            </div>

            {/* Phone device */}
            <div className="relative mx-auto mt-16">
              <div className="w-52 h-80 rounded-3xl shadow-2xl overflow-hidden border-4 border-gray-800 bg-amber-400 relative">
                {/* Phone notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-5 bg-gray-800 rounded-b-xl z-20" />
                {/* Phone screen content */}
                <div className="absolute top-10 left-0 right-0 bottom-0 bg-amber-400 flex flex-col items-center justify-center gap-3 px-4">
                  {/* Avatar placeholder */}
                  <div className="w-14 h-14 rounded-full bg-amber-600 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="white" className="w-8 h-8">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                    </svg>
                  </div>
                  {/* Form fields on phone */}
                  <div className="w-full h-7 bg-amber-100 bg-opacity-60 rounded-md" />
                  <div className="w-full h-7 bg-amber-100 bg-opacity-60 rounded-md" />
                  <div className="w-full h-8 bg-amber-700 rounded-md opacity-80" />
                </div>
              </div>
            </div>

            {/* Person figure */}
            <div className="absolute bottom-0 left-4 flex flex-col items-center">
              <div className="w-10 h-10 rounded-full bg-purple-400" />
              <div className="w-16 h-24 rounded-t-full bg-purple-400 mt-1" style={{ borderRadius: "50% 50% 0 0 / 30% 30% 0 0" }} />
              <div className="flex gap-2 mt-0">
                <div className="w-5 h-14 bg-purple-700 rounded-b-md" />
                <div className="w-5 h-14 bg-purple-700 rounded-b-md" />
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Right form panel */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-12 bg-white">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <div className="mb-8">
            <p className="text-gray-500 text-base mb-1">Welcome to</p>
            <h1 className="text-3xl font-extrabold text-[#5c5fef]">TaskFlow</h1>
          </div>

          {/* Social login buttons */}
          <div className="space-y-3 mb-6">
            <button
              type="button"
              className="w-full flex items-center justify-center gap-3 h-12 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 shadow-sm"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Login with Google
            </button>

            <button
              type="button"
              className="w-full flex items-center justify-center gap-3 h-12 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 shadow-sm"
            >
              <svg className="w-5 h-5" fill="#1877F2" viewBox="0 0 24 24">
                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.887v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
              </svg>
              Login with Facebook
            </button>
          </div>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs text-gray-400 uppercase">
              <span className="bg-white px-3">OR</span>
            </div>
          </div>

          {/* Email/password form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            {/* Email field */}
            <div className="relative">
              <div className="flex items-center h-14 bg-gray-100 rounded-xl px-4 gap-3 focus-within:ring-2 focus-within:ring-[#5c5fef] transition-all">
                <Mail className="w-5 h-5 text-gray-500 shrink-0" />
                <div className="flex flex-col flex-1 min-w-0">
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Email</label>
                  <input
                    {...register("email")}
                    type="email"
                    placeholder="example@gmail.com"
                    className="bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none w-full"
                  />
                </div>
              </div>
              {errors.email && <p className="mt-1 text-xs text-red-500 pl-1">{errors.email.message}</p>}
            </div>

            {/* Password field */}
            <div className="relative">
              <div className="flex items-center h-14 bg-gray-100 rounded-xl px-4 gap-3 focus-within:ring-2 focus-within:ring-[#5c5fef] transition-all">
                <KeyRound className="w-5 h-5 text-gray-500 shrink-0" />
                <div className="flex flex-col flex-1 min-w-0">
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Password</label>
                  <input
                    {...register("password")}
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••"
                    className="bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none w-full"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-gray-400 hover:text-gray-600 shrink-0"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-red-500 pl-1">{errors.password.message}</p>}
            </div>

            {/* Remember me + Forgot password */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 accent-[#5c5fef]"
                />
                <span className="text-sm text-gray-500">Remember me</span>
              </label>
              <a href="/forgot-password" className="text-sm text-[#5c5fef] hover:underline font-medium">
                Forgot Password?
              </a>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-[#5c5fef] hover:bg-[#4a4de0] disabled:opacity-60 text-white font-semibold rounded-xl transition-colors mt-2 text-sm tracking-wide"
            >
              {loading ? "Signing in..." : "Login"}
            </button>
          </form>

          {/* Register link */}
          <p className="mt-6 text-center text-sm text-gray-500">
            Don&apos;t have an account?{" "}
            <a href="/register" className="text-[#5c5fef] font-semibold hover:underline">
              Register
            </a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
