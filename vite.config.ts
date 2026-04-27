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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
