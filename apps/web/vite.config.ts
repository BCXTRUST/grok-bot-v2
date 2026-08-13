import http from "node:http";
import net from "node:net";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type PreviewServer, type ViteDevServer } from "vite";

const api = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3100";
const webPort = Number(process.env.WEB_PORT ?? 5173);

function attachNovncProxy(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((req, res, next) => {
    const match = req.url?.match(/^\/novnc\/(\d+)(\/.*)?$/);
    if (!match) {
      next();
      return;
    }
    const port = match[1]!;
    const rest = match[2] && match[2].length > 0 ? match[2] : "/";
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    const upstream = http.request(
      { hostname: "127.0.0.1", port: Number(port), path: rest, method: req.method, headers },
      (incoming) => {
        res.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.statusCode = 502;
      res.end(error.message);
    });
    req.pipe(upstream);
  });

  server.httpServer?.on("upgrade", (req, socket, head) => {
    const match = req.url?.match(/^\/novnc\/(\d+)(\/.*)?$/);
    if (!match) return;
    const port = match[1]!;
    const rest = match[2] && match[2].length > 0 ? match[2] : "/";
    const upstream = net.connect(Number(port), "127.0.0.1", () => {
      const headerLines = [`${req.method ?? "GET"} ${rest} HTTP/1.1`, `Host: 127.0.0.1:${port}`];
      for (const [key, value] of Object.entries(req.headers)) {
        if (key.toLowerCase() === "host" || value == null) continue;
        headerLines.push(`${key}: ${Array.isArray(value) ? value.join(",") : value}`);
      }
      upstream.write(`${headerLines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "rakazo-novnc-proxy",
      configureServer: attachNovncProxy,
      configurePreviewServer: attachNovncProxy,
    },
  ],
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
