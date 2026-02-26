import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3333",
        ws: true,
        // Suppress proxy errors when server restarts
        configure: (proxy) => {
          proxy.on("error", () => {});
        },
      },
    },
  },
});
