import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const api = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3100";
const webPort = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/rpc": { target: api, changeOrigin: true },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/rpc": { target: api, changeOrigin: true },
    },
  },
});
