import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** A board with no platform footprint, used to exercise the generic form mapper. */

export interface CustomForumFixture {
  origin: string;
  profile(): { bio: string; signature: string } | undefined;
  close(): Promise<void>;
}

const dir = new URL("../../fixtures/custom-forum/", import.meta.url);

function read(name: string): string {
  return readFileSync(new URL(`${name}.html.tmpl`, dir), "utf8");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render(name: string, values: Record<string, string>): string {
  return read(name)
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, key: string) => values[key] ?? "")
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => escapeHtml(values[key] ?? ""));
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function cookies(request: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) jar.set(key, rest.join("="));
  }
  return jar;
}

export async function startCustomForumFixture(): Promise<CustomForumFixture> {
  const sessions = new Map<string, string>();
  const users = new Map<string, { password: string }>();
  let profile: { bio: string; signature: string } | undefined;
  let origin = "";
  const userFor = (request: IncomingMessage) => {
    const sid = cookies(request).get("fx_sid");
    return sid ? sessions.get(sid) : undefined;
  };
  const page = (
    response: ServerResponse,
    request: IncomingMessage,
    title: string,
    content: string,
    status = 200,
    headers: Record<string, string> = {},
  ) => {
    const user = userFor(request);
    const navUser = user ? `<a class="logout" href="/">Logout</a>` : `<a href="/login">Login</a>`;
    response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
    response.end(render("layout", { title, content, navUser }));
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");
    try {
      if (url.pathname === "/") {
        return page(response, request, "Threads", render("threads", {}));
      }
      if (url.pathname === "/register") {
        if (url.searchParams.get("case") === "odd" || request.method !== "POST") {
          if (url.searchParams.get("case") === "odd")
            return page(response, request, "Odd", render("odd", {}));
          if (request.method !== "POST")
            return page(response, request, "Join", render("register", {}));
        }
        const form = await readForm(request);
        const username = (form.get("handle") ?? "").trim();
        const email = (form.get("mail") ?? "").trim();
        const password = form.get("secret") ?? "";
        if (
          !form.get("agree") ||
          username.length < 3 ||
          !email ||
          !password ||
          password !== form.get("secret2")
        ) {
          return page(
            response,
            request,
            "Join",
            render("register", {
              username,
              email,
              error: '<p class="error">Check the form and try again.</p>',
            }),
          );
        }
        users.set(username, { password });
        return page(
          response,
          request,
          "Joined",
          render("message", {
            heading: "Information",
            text: "Your account has been created. An activation key has been sent to your email.",
            link: "",
          }),
        );
      }
      if (url.pathname === "/login") {
        if (request.method !== "POST") return page(response, request, "Login", render("login", {}));
        const form = await readForm(request);
        const user = users.get((form.get("login") ?? "").trim());
        if (!user || user.password !== form.get("password")) {
          return page(
            response,
            request,
            "Login",
            render("login", { error: '<p class="error">Incorrect username or password.</p>' }),
          );
        }
        const sid = randomBytes(8).toString("hex");
        sessions.set(sid, form.get("login") ?? "");
        response.writeHead(302, { location: "/", "set-cookie": `fx_sid=${sid}; Path=/; HttpOnly` });
        return response.end();
      }
      if (url.pathname === "/thread/1") {
        return page(response, request, "Thread", `${render("threads", {})}${render("reply", {})}`);
      }
      if (url.pathname === "/thread/1/reply" && request.method === "POST") {
        const form = await readForm(request);
        const body = form.get("message") ?? "";
        if (body.trim().length < 10) {
          return page(
            response,
            request,
            "Reply",
            render("reply", {
              message: body,
              error: '<p class="error">The message you entered is too short.</p>',
            }),
          );
        }
        return page(
          response,
          request,
          "Posted",
          render("message", {
            heading: "Information",
            text: "This message has been posted successfully.",
            link: '<p><a class="permalink" href="/thread/1#post1">View your submitted message</a></p>',
          }),
        );
      }
      if (url.pathname === "/thread/2") {
        return page(response, request, "Odd reply", render("odd-reply", {}));
      }
      if (url.pathname === "/account") {
        if (request.method !== "POST")
          return page(
            response,
            request,
            "Profile",
            render("profile", profile ?? { bio: "", signature: "" }),
          );
        const form = await readForm(request);
        profile = { bio: form.get("bio") ?? "", signature: form.get("signature") ?? "" };
        return page(
          response,
          request,
          "Profile",
          render("message", { heading: "Profile", text: "Your profile has been saved.", link: "" }),
        );
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("missing");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : "fixture error");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    profile: () => profile,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
