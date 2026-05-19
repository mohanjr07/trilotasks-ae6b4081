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
          {/* Decorative blobs - animated */}
          <motion.div
            className="absolute -top-10 -left-10 w-48 h-48 rounded-full bg-pink-300 opacity-40 blur-3xl"
            animate={{ scale: [1, 1.2, 1], x: [0, 20, 0], y: [0, 10, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute bottom-0 right-0 w-40 h-40 rounded-full bg-purple-300 opacity-40 blur-3xl"
            animate={{ scale: [1, 1.3, 1], x: [0, -15, 0], y: [0, -10, 0] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute top-1/3 right-10 w-24 h-24 rounded-full bg-blue-200 opacity-30 blur-2xl"
            animate={{ scale: [1, 1.5, 1], y: [0, 15, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Floating decorative particles */}
          <motion.div
            className="absolute top-20 left-20 w-3 h-3 rounded-full bg-pink-400 opacity-60"
            animate={{ y: [0, -30, 0], x: [0, 10, 0], opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute bottom-32 right-10 w-2 h-2 rounded-full bg-purple-400 opacity-50"
            animate={{ y: [0, -20, 0], x: [0, -8, 0], opacity: [0.2, 0.7, 0.2] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
          />
          <motion.div
            className="absolute top-40 right-32 w-4 h-4 rounded-full bg-blue-300 opacity-40"
            animate={{ y: [0, -25, 0], x: [0, -12, 0], scale: [1, 1.3, 1] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          />
          <motion.div
            className="absolute bottom-20 left-10 w-2.5 h-2.5 rounded-full bg-amber-300 opacity-50"
            animate={{ y: [0, -18, 0], x: [0, 15, 0], opacity: [0.3, 0.9, 0.3] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
          />
          <motion.div
            className="absolute top-10 right-1/3 w-3 h-3 rounded-full bg-indigo-300 opacity-40"
            animate={{ y: [0, -22, 0], x: [0, -6, 0], scale: [1, 1.2, 1] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
          />

          {/* Phone mockup illustration */}
          <div className="relative flex items-end justify-center gap-4">
            {/* Lock icon circle - floating + pulsing */}
            <motion.div
              className="absolute top-8 left-8 w-20 h-20 rounded-full bg-pink-400 flex items-center justify-center shadow-lg z-10"
              animate={{ y: [0, -12, 0], scale: [1, 1.05, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <svg viewBox="0 0 24 24" fill="white" className="w-10 h-10">
                <path d="M12 1C9.24 1 7 3.24 7 6v1H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2V6c0-2.76-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3v1H9V6c0-1.66 1.34-3 3-3zm0 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
              </svg>
            </motion.div>

            {/* Gear icon - spinning */}
            <motion.div
              className="absolute top-4 right-16 w-14 h-14 rounded-full bg-gray-300 opacity-70 flex items-center justify-center"
              animate={{ rotate: 360 }}
              transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
            >
              <svg viewBox="0 0 24 24" fill="gray" className="w-8 h-8">
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.02 7.02 0 0 0-1.62-.94l-.36-2.54A.484.484 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.47.47 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.03.7 1.62.94l.36 2.54c.05.24.26.42.5.42h4c.25 0 .46-.18.49-.42l.36-2.54a6.89 6.89 0 0 0 1.61-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
              </svg>
            </motion.div>

            {/* Phone device - gentle sway */}
            <motion.div
              className="relative mx-auto mt-16"
              animate={{ y: [0, -8, 0], rotate: [-1, 1, -1] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="w-52 h-80 rounded-3xl shadow-2xl overflow-hidden border-4 border-gray-800 bg-amber-400 relative">
                {/* Phone notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-5 bg-gray-800 rounded-b-xl z-20" />
                {/* Phone screen content */}
                <div className="absolute top-10 left-0 right-0 bottom-0 bg-amber-400 flex flex-col items-center justify-center gap-3 px-4">
                  {/* Avatar placeholder */}
                  <motion.div
                    className="w-14 h-14 rounded-full bg-amber-600 flex items-center justify-center"
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <svg viewBox="0 0 24 24" fill="white" className="w-8 h-8">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                    </svg>
                  </motion.div>
                  {/* Form fields on phone - shimmer */}
                  <motion.div
                    className="w-full h-7 bg-amber-100 bg-opacity-60 rounded-md"
                    animate={{ opacity: [0.4, 0.9, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity, delay: 0 }}
                  />
                  <motion.div
                    className="w-full h-7 bg-amber-100 bg-opacity-60 rounded-md"
                    animate={{ opacity: [0.4, 0.9, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity, delay: 0.3 }}
                  />
                  <motion.div
                    className="w-full h-8 bg-amber-700 rounded-md opacity-80"
                    animate={{ scale: [1, 1.03, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  />
                </div>
              </div>
            </motion.div>

            {/* Person figure - subtle wave */}
            <motion.div
              className="absolute bottom-0 left-4 flex flex-col items-center origin-bottom"
              animate={{ rotate: [-2, 2, -2] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="w-10 h-10 rounded-full bg-purple-400" />
              <div className="w-16 h-24 rounded-t-full bg-purple-400 mt-1" style={{ borderRadius: "50% 50% 0 0 / 30% 30% 0 0" }} />
              <div className="flex gap-2 mt-0">
                <div className="w-5 h-14 bg-purple-700 rounded-b-md" />
                <div className="w-5 h-14 bg-purple-700 rounded-b-md" />
              </div>
            </motion.div>
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
          <div className="mb-8 text-center">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Trilo Automation"
              className="h-60 object-contain mb-4 mx-auto"
            />
            <p className="text-gray-500 text-base mb-1">Welcome to</p>
            <h1 className="text-3xl font-extrabold text-[#5c5fef]">TaskFlow</h1>
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


        </motion.div>
      </div>
    </div>
  );
}
