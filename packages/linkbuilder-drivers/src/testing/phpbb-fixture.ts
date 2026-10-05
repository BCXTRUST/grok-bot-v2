import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { noisePng } from "./png.js";

/*
 * Offline phpBB 3.x board for tests: renders the stock prosilver structure from HTML fixtures,
 * keeps users, sessions, captchas and posts in memory and hands activation mail to a callback.
 * No Docker, no PHP, no network beyond loopback.
 */

export interface FixtureMail {
  to: string;
  from: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}

export type FixtureRel = "follow" | "nofollow" | "ugc";

export interface PhpbbFixtureOptions {
  boardName?: string;
  /** The answer behind every captcha image. */
  captchaAnswer?: string;
  /** How posted links are rendered. */
  rel?: FixtureRel;
  activation?: "email" | "none" | "admin";
  cookieWall?: boolean;
  /** Members below this post count may not post links; also shown as the board rule. */
  linkRuleMinPosts?: number;
  deliverMail(mail: FixtureMail): void | Promise<void>;
}

export interface RecordedRequest {
  method: string;
  path: string;
  cookie: string | null;
  userAgent: string | null;
}

export interface FixtureUser {
  id: number;
  username: string;
  email: string;
  password: string;
  active: boolean;
  postCount: number;
  activationKey: string;
}

export interface FixturePost {
  id: number;
  topicId: number;
  author: string;
  body: string;
}

export interface PhpbbFixture {
  origin: string;
  requests: RecordedRequest[];
  users: Map<string, FixtureUser>;
  posts: Map<number, FixturePost>;
  /** Adds a reply to the seeded topic, as if another member had posted it. */
  seedPost(author: string, body: string): number;
  /** Number of captcha images served, to check a resumed step did not replay a submit. */
  captchaImagesServed(): number;
  registrationSubmits(): number;
  replySubmits(): number;
  close(): Promise<void>;
}

const TEMPLATE_DIR = new URL("../../fixtures/phpbb/", import.meta.url);
const templates = new Map<string, string>();

function template(name: string): string {
  let cached = templates.get(name);
  if (cached === undefined) {
    cached = readFileSync(new URL(`${name}.html.tmpl`, TEMPLATE_DIR), "utf8");
    templates.set(name, cached);
  }
  return cached;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function render(name: string, values: Record<string, string | number>): string {
  return template(name)
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, key: string) => String(values[key] ?? ""))
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => escapeHtml(String(values[key] ?? "")));
}

function relAttribute(rel: FixtureRel): string {
  if (rel === "nofollow") return ' rel="nofollow"';
  if (rel === "ugc") return ' rel="ugc"';
  return "";
}

/** Escapes the body, then renders `[url=...]...[/url]` and `[url]...[/url]` like phpBB's BBCode. */
export function renderBbcode(body: string, rel: FixtureRel): string {
  const safeUrl = (raw: string) => {
    try {
      const url = new URL(raw);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  };
  const link = (href: string, text: string) => {
    const url = safeUrl(href);
    if (!url) return escapeHtml(text);
    return `<a href="${escapeHtml(url)}" class="postlink"${relAttribute(rel)}>${escapeHtml(text)}</a>`;
  };
  const parts: string[] = [];
  const pattern = /\[url=([^\]\s]+)\]([\s\S]*?)\[\/url\]|\[url\]([^[\s]+)\[\/url\]/gi;
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    parts.push(escapeHtml(body.slice(last, match.index)));
    parts.push(match[1] ? link(match[1], match[2] ?? "") : link(match[3]!, match[3]!));
    last = match.index + match[0].length;
  }
  parts.push(escapeHtml(body.slice(last)));
  return parts.join("").replace(/\r?\n/g, "<br />");
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 200_000) break;
    chunks.push(chunk as Buffer);
  }
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

const SESSION_COOKIE = "phpbb3_fx_sid";
const CONSENT_COOKIE = "fx_consent";
const COOKIE_BANNER = `<div id="cookie-consent">This board uses cookies. <button type="button" class="accept" onclick="document.cookie='${CONSENT_COOKIE}=1; path=/'; this.parentNode.remove();">Accept</button></div>`;

export async function startPhpbbFixture(options: PhpbbFixtureOptions): Promise<PhpbbFixture> {
  const boardName = options.boardName ?? "Vereinsforum Fixture";
  const captchaAnswer = options.captchaAnswer ?? "K7XQ2";
  const rel = options.rel ?? "ugc";
  const activation = options.activation ?? "email";
  const requests: RecordedRequest[] = [];
  const users = new Map<string, FixtureUser>();
  const sessions = new Map<string, string>();
  const captchas = new Map<string, string>();
  const posts = new Map<number, FixturePost>();
  const topics = [
    {
      id: 1,
      title: "Which software do you use for club membership lists?",
      postIds: [1],
    },
  ];
  posts.set(1, {
    id: 1,
    topicId: 1,
    author: "anna_k",
    body: "We are a small sports club and still keep members in a spreadsheet. What do you use for dues and member lists?",
  });
  let nextPostId = 2;
  let nextUserId = 2;
  let captchaServed = 0;
  let registrationSubmits = 0;
  let replySubmits = 0;
  let origin = "";

  const linkRule =
    options.linkRuleMinPosts !== undefined
      ? `New members cannot post links until they have made ${options.linkRuleMinPosts} posts.`
      : "";

  const userFor = (request: IncomingMessage) => {
    const sid = cookies(request).get(SESSION_COOKIE);
    const name = sid ? sessions.get(sid) : undefined;
    return name ? users.get(name) : undefined;
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
    const navUser = user
      ? `<a href="./ucp.php?mode=logout&amp;sid=x">Logout [ ${escapeHtml(user.username)} ]</a>`
      : `<a href="./ucp.php?mode=login">Login</a> &middot; <a href="./ucp.php?mode=register">Register</a>`;
    const consented = cookies(request).has(CONSENT_COOKIE);
    const cookieBanner = options.cookieWall && !consented ? COOKIE_BANNER : "";
    response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
    response.end(render("layout", { title, boardName, content, navUser, cookieBanner }));
  };

  const message = (
    response: ServerResponse,
    request: IncomingMessage,
    heading: string,
    text: string,
    link = "",
  ) => page(response, request, heading, render("message", { heading, text, link }));

  const newCaptcha = () => {
    const id = randomBytes(8).toString("hex");
    captchas.set(id, captchaAnswer);
    return id;
  };

  const registerForm = (
    response: ServerResponse,
    request: IncomingMessage,
    values: { username?: string; email?: string; error?: string },
  ) =>
    page(
      response,
      request,
      "Register",
      render("register", {
        boardName,
        username: values.username ?? "",
        email: values.email ?? "",
        confirmId: newCaptcha(),
        error: values.error ? `<p class="error">${escapeHtml(values.error)}</p>` : "",
      }),
    );

  const renderPosts = (topicId: number) =>
    topics
      .find((topic) => topic.id === topicId)!
      .postIds.map((id, index) => {
        const post = posts.get(id)!;
        return `<div id="p${post.id}" class="post ${index % 2 ? "bg1" : "bg2"}"><div class="postbody"><h3><a href="./viewtopic.php?p=${post.id}#p${post.id}">Re: ${escapeHtml(topics[0]!.title)}</a></h3><p class="author">by <strong>${escapeHtml(post.author)}</strong></p><div class="content">${renderBbcode(post.body, rel)}</div></div></div>`;
      })
      .join("\n");

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin);
    requests.push({
      method: request.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      cookie: request.headers.cookie ?? null,
      userAgent: request.headers["user-agent"] ?? null,
    });
    const mode = url.searchParams.get("mode");
    const path = url.pathname;
    try {
      if (path === "/" || path === "/index.php") {
        return page(
          response,
          request,
          "Board index",
          render("index", { forumTitle: "Club management" }),
        );
      }
      if (path === "/viewforum.php") {
        const rows = topics
          .map(
            (topic) =>
              `<li class="row"><dl><dt><a href="./viewtopic.php?t=${topic.id}" class="topictitle">${escapeHtml(topic.title)}</a></dt><dd class="posts">${topic.postIds.length - 1} <dfn>Replies</dfn></dd></dl></li>`,
          )
          .join("\n");
        return page(
          response,
          request,
          "Club management",
          render("viewforum", { forumTitle: "Club management", rows }),
        );
      }
      if (path === "/viewtopic.php") {
        const byPost = Number(url.searchParams.get("p"));
        const topicId = byPost ? posts.get(byPost)?.topicId : Number(url.searchParams.get("t"));
        const topic = topics.find((candidate) => candidate.id === topicId);
        if (!topic) {
          return page(
            response,
            request,
            "Information",
            render("message", {
              heading: "Information",
              text: "The requested topic does not exist.",
            }),
            404,
          );
        }
        return page(
          response,
          request,
          topic.title,
          render("viewtopic", {
            topicId: topic.id,
            topicTitle: topic.title,
            posts: renderPosts(topic.id),
          }),
        );
      }
      if (path === "/ucp.php" && mode === "confirm") {
        captchaServed += 1;
        const seed = Number.parseInt((url.searchParams.get("confirm_id") ?? "1").slice(0, 8), 16);
        response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        return response.end(noisePng(160, 48, seed));
      }
      if (path === "/ucp.php" && mode === "register") {
        if (request.method !== "POST") {
          return page(response, request, "Register", render("agreement", { boardName, linkRule }));
        }
        const form = await readForm(request);
        if (!form.has("submit")) return registerForm(response, request, {});
        registrationSubmits += 1;
        const username = (form.get("username") ?? "").trim();
        const email = (form.get("email") ?? "").trim();
        const password = form.get("new_password") ?? "";
        const expected = captchas.get(form.get("confirm_id") ?? "");
        captchas.delete(form.get("confirm_id") ?? "");
        const retry = (error: string) =>
          registerForm(response, request, { username, email, error });
        if (
          !expected ||
          (form.get("confirm_code") ?? "").trim().toUpperCase() !== expected.toUpperCase()
        ) {
          return retry("The confirmation code you entered was incorrect.");
        }
        if (username.length < 3) return retry("The username you entered is too short.");
        if (users.has(username.toLowerCase()))
          return retry("The username you entered is already in use.");
        if (!password) return retry("Entering a password is required.");
        if (password !== form.get("password_confirm"))
          return retry("The password confirmation does not match.");
        const user: FixtureUser = {
          id: nextUserId++,
          username,
          email,
          password,
          active: activation === "none",
          postCount: 0,
          activationKey: randomBytes(5).toString("hex").toUpperCase(),
        };
        users.set(username.toLowerCase(), user);
        if (activation === "admin") {
          return message(
            response,
            request,
            "Information",
            "Your account has been created. The administrator will activate your account before you can log in.",
          );
        }
        if (activation === "none") {
          return message(
            response,
            request,
            "Information",
            "Thank you for registering, your account has been created. You may now login with your username and password.",
          );
        }
        const link = `${origin}/ucp.php?mode=activate&u=${user.id}&k=${user.activationKey}`;
        await options.deliverMail({
          to: email,
          from: `noreply@${new URL(origin).hostname}`,
          subject: `Welcome to “${boardName}”`,
          textBody: `Hello ${username},\n\nPlease keep this email for your records. Your account is currently inactive. To activate it visit the following link:\n\n${link}\n\nThanks for registering.`,
          htmlBody: `<p>Hello ${escapeHtml(username)},</p><p>To activate your account visit <a href="${escapeHtml(link)}">${escapeHtml(link)}</a>.</p>`,
        });
        return message(
          response,
          request,
          "Information",
          "Your account has been created. However, this board requires account activation. An activation key has been sent to the email address you provided. Please check your email for further information.",
        );
      }
      if (path === "/ucp.php" && mode === "activate") {
        const user = [...users.values()].find(
          (candidate) => candidate.id === Number(url.searchParams.get("u")),
        );
        if (!user || user.activationKey !== url.searchParams.get("k")) {
          return message(
            response,
            request,
            "Information",
            "The activation key you supplied does not match or has expired.",
          );
        }
        user.active = true;
        return message(
          response,
          request,
          "Information",
          "Your account has now been activated. You can now login with your username and password.",
        );
      }
      if (path === "/ucp.php" && mode === "login") {
        if (request.method !== "POST") return page(response, request, "Login", render("login", {}));
        const form = await readForm(request);
        const user = users.get((form.get("username") ?? "").trim().toLowerCase());
        if (!user || user.password !== form.get("password") || !user.active) {
          const error =
            user && !user.active
              ? "Your account has not been activated."
              : "You have specified an incorrect username or password.";
          return page(
            response,
            request,
            "Login",
            render("login", { error: `<p class="error">${error}</p>` }),
          );
        }
        const sid = randomBytes(12).toString("hex");
        sessions.set(sid, user.username.toLowerCase());
        response.writeHead(302, {
          location: "./index.php",
          "set-cookie": `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax`,
        });
        return response.end();
      }
      if (path === "/posting.php" && mode === "reply") {
        const topic = topics.find(
          (candidate) => candidate.id === Number(url.searchParams.get("t")),
        );
        if (!topic)
          return message(response, request, "Information", "The requested topic does not exist.");
        const user = userFor(request);
        if (!user)
          return page(
            response,
            request,
            "Login",
            render("login", {
              error:
                '<p class="error">You need to login in order to reply to topics within this forum.</p>',
            }),
          );
        const form = request.method === "POST" ? await readForm(request) : null;
        const body = form?.get("message")?.trim() ?? "";
        const formPage = (error: string) =>
          page(
            response,
            request,
            "Post a reply",
            render("posting", {
              topicId: topic.id,
              topicTitle: topic.title,
              linkRule,
              message: body,
              error: error ? `<p class="error">${escapeHtml(error)}</p>` : "",
            }),
          );
        if (!form?.has("post")) return formPage("");
        replySubmits += 1;
        if (body.length < 10) return formPage("The message you entered is too short.");
        if (
          options.linkRuleMinPosts !== undefined &&
          user.postCount < options.linkRuleMinPosts &&
          /\[url/i.test(body)
        ) {
          return formPage(
            `You are not allowed to post links until you have made ${options.linkRuleMinPosts} posts.`,
          );
        }
        const post: FixturePost = {
          id: nextPostId++,
          topicId: topic.id,
          author: user.username,
          body,
        };
        posts.set(post.id, post);
        topic.postIds.push(post.id);
        user.postCount += 1;
        return message(
          response,
          request,
          "Information",
          "This message has been posted successfully.",
          `<p><a href="./viewtopic.php?p=${post.id}#p${post.id}">View your submitted message</a></p>`,
        );
      }
      if (path === "/widget.php") {
        if (request.method === "POST") {
          const form = await readForm(request);
          if (form.get("g-recaptcha-response")) {
            return message(response, request, "Information", "Thanks, the form was accepted.");
          }
          return page(
            response,
            request,
            "Security check",
            render("widget", {
              error: '<p class="error">You did not pass the security check.</p>',
              siteKeyAttr: 'data-sitekey="fixture-site-key"',
            }),
          );
        }
        const fixtureCase = url.searchParams.get("case") ?? "ok";
        return page(
          response,
          request,
          "Security check",
          render("widget", {
            siteKeyAttr: fixtureCase === "missing_key" ? "" : 'data-sitekey="fixture-site-key"',
            typeAttr: fixtureCase === "unsupported" ? 'data-fixture-type="unsupported"' : "",
            noTokenAttr: fixtureCase === "no_token" ? 'data-fixture-no-token="1"' : "",
          }),
        );
      }
      return message(response, request, "General Error", "The page you requested does not exist.");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : "fixture error");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    requests,
    users,
    posts,
    seedPost(author, body) {
      const post: FixturePost = { id: nextPostId++, topicId: 1, author, body };
      posts.set(post.id, post);
      topics[0]!.postIds.push(post.id);
      return post.id;
    },
    captchaImagesServed: () => captchaServed,
    registrationSubmits: () => registrationSubmits,
    replySubmits: () => replySubmits,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
