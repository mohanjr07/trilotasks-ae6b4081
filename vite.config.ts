import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
//
// `base: "./"` is required so the production build's <script> and <link> tags
// use RELATIVE paths. Without it Vite emits absolute "/assets/..." URLs which
// resolve to "C:/assets/..." inside Electron's file:// origin and the app
// shows a blank screen. The web deploy on Lovable still works fine with
// relative paths.
export default defineConfig(({ mode }) => ({
  base: "./",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        // libraries in their own files: they rarely change, so phones keep them cached
        // between TaskFlow updates and only download the (small) app part again
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          if (/[\\/]@supabase[\\/]/.test(id)) return "vendor-supabase";
          if (/[\\/](@radix-ui|framer-motion|lucide-react|sonner|cmdk|vaul)[\\/]/.test(id)) return "vendor-ui";
          if (/[\\/](@tanstack|date-fns|zod|react-hook-form|@hookform|clsx|tailwind-merge|class-variance-authority)[\\/]/.test(id)) return "vendor-utils";
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
