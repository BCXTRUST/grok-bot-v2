import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchPlaywrightSession, type PlaywrightBrowserSession } from "./playwright-session.js";
import { browserTestGate } from "./testing.js";

interface ProxyHit {
  method: string;
  url: string;
  authorization: string | undefined;
  acceptLanguage: string | undefined;
}

const gate = browserTestGate();

describe.skipIf(!gate.available)(`persona proxy${gate.reason ? ` (${gate.reason})` : ""}`, () => {
  let target: Server;
  let proxy: Server;
  let targetOrigin = "";
  let session: PlaywrightBrowserSession | undefined;
  const hits: ProxyHit[] = [];
  const username = "user-de-session";
  const password = "pw-example";

  beforeAll(async () => {
    target = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", () => resolve()));
    const targetPort = (target.address() as AddressInfo).port;
    targetOrigin = `http://127.0.0.1:${targetPort}`;
    proxy = createServer((req, res) => {
      const authorization =
        typeof req.headers["proxy-authorization"] === "string"
          ? req.headers["proxy-authorization"]
          : undefined;
      hits.push({
        method: req.method ?? "",
        url: req.url ?? "",
        authorization,
        acceptLanguage:
          typeof req.headers["accept-language"] === "string"
            ? req.headers["accept-language"]
            : undefined,
      });
      if (!authorization) {
        res.writeHead(407, { "proxy-authenticate": 'Basic realm="lb"' });
        res.end();
        return;
      }
      let upstreamUrl: URL;
      try {
        upstreamUrl = new URL(req.url ?? "");
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      const upstream = httpRequest(
        {
          hostname: upstreamUrl.hostname,
          port: upstreamUrl.port,
          path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
          method: req.method,
          headers: { host: upstreamUrl.host },
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502);
          upstreamRes.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    });
    proxy.on("connect", (req, clientSocket, head) => {
      hits.push({
        method: "CONNECT",
        url: req.url ?? "",
        authorization:
          typeof req.headers["proxy-authorization"] === "string"
            ? req.headers["proxy-authorization"]
            : undefined,
        acceptLanguage: undefined,
      });
      const [host = "", port = "443"] = (req.url ?? "").split(":");
      const socket = netConnect(Number(port), host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) socket.write(head);
        socket.pipe(clientSocket);
        clientSocket.pipe(socket);
      });
      socket.on("error", () => clientSocket.end());
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", () => resolve()));
  });

  afterAll(async () => {
    await session?.close();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("opens through the proxy with the session username, locale and time zone", async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;
    const root = await mkdtemp(join(tmpdir(), "lb-proxy-"));
    session = await launchPlaywrightSession({
      profileDir: join(root, "profile"),
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
      acceptLanguage: "de-DE,de;q=0.9,en;q=0.5",
      headless: true,
      engine: "playwright",
      proxy: {
        server: `127.0.0.1:${proxyPort}`,
        username,
        password,
      },
    });
    await session.goto(`${targetOrigin}/hello`);
    const facts = await session.browserFacts();
    expect(facts.timezoneId).toBe("Europe/Berlin");
    expect(facts.locale.toLowerCase()).toContain("de");
    const document = hits.find(
      (hit) => hit.url.includes("/hello") && hit.authorization?.startsWith("Basic "),
    );
    if (!document?.authorization) throw new Error(`proxy log: ${JSON.stringify(hits)}`);
    const decoded = Buffer.from(document?.authorization?.slice(6) ?? "", "base64").toString("utf8");
    expect(decoded).toBe(`${username}:${password}`);
    expect(document?.acceptLanguage?.toLowerCase()).toContain("de-de");
    await mkdir("/opt/cursor/artifacts", { recursive: true });
    await writeFile(
      "/opt/cursor/artifacts/lb-m6-proxy-log.json",
      JSON.stringify(
        hits
          .filter((hit) => hit.url.includes("/hello"))
          .map((hit) => ({
            method: hit.method,
            url: hit.url,
            proxyAuthorization: hit.authorization ? "present" : "absent",
            username: hit.authorization ? username : undefined,
            acceptLanguage: hit.acceptLanguage,
          })),
        null,
        2,
      ),
    );
  });
});

describe("persona proxy gate", () => {
  it.skipIf(gate.available || !gate.required)("has Chromium installed in CI", () => {
    throw new Error(gate.reason);
  });
});
