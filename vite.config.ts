import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const apiTarget = process.env.WORLD_LENS_API_TARGET ?? "http://127.0.0.1:3001";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/collection": { target: apiTarget, changeOrigin: true },
    },
  },
});
