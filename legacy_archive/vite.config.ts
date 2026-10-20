import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3001" } },
  // frontend/ is a separate Next.js app with its own test runner.
  test: { exclude: [...configDefaults.exclude, "frontend/**"] },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          motion: ["framer-motion"],
          markdown: ["react-markdown"],
          calendar: ["ical.js"],
        },
      },
    },
  },
});
