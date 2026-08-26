import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(fileURLToPath(new URL("./dist", import.meta.url)));
const host = process.env.HOST ?? "0.0.0.0";
const ports = [...new Set(
  [process.env.PORT, "4321"]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0 && value < 65536),
)];

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".xml": "application/xml; charset=utf-8",
};

function insideDist(file) {
  const resolved = resolve(file);
  return resolved === dist || resolved.startsWith(dist + sep);
}

async function existingFile(file) {
  if (!insideDist(file)) return null;
  try {
    const info = await stat(file);
    return info.isFile() ? file : null;
  } catch {
    return null;
  }
}

async function resolveFile(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = [
    join(dist, relative),
    join(dist, relative, "index.html"),
    join(dist, `${relative}.html`),
  ];
  for (const candidate of candidates) {
    const file = await existingFile(candidate);
    if (file) return file;
  }
  return null;
}

async function handle(req, res) {
  const pathname = new URL(req.url ?? "/", "http://autoseo.run").pathname;
  if ((req.method === "GET" || req.method === "HEAD") && pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  const file = (await resolveFile(pathname)) ?? (await resolveFile("/404"));
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const headers = {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=86400",
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

await access(join(dist, "index.html"));
if (ports.length === 0) {
  throw new Error("No valid PORT to bind");
}
for (const port of ports) {
  createServer(handle).listen(port, host, () => {
    process.stdout.write(`AutoSEO.run listening on ${host}:${port}\n`);
  });
}
