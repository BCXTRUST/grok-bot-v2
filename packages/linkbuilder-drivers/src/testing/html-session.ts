import type { BrowserPersona, FormFieldInfo } from "@rakazo/adapter-kit";
import { load } from "cheerio";
import { noisePng } from "./png.js";

/**
 * In-process page for fixture boards. It speaks HTTP to loopback and reads the DOM with
 * cheerio, which is enough for selector drivers. It does not screenshot pages for mapping.
 */

type Selection = ReturnType<ReturnType<typeof load>>;
type DomNode = { type?: string; name?: string };

function tagOf(node: DomNode | undefined): string {
  return node?.type === "tag" && node.name ? node.name : "input";
}

export class HtmlBrowserSession {
  readonly id: string;
  private current = "about:blank";
  private raw = "";
  private $ = load("<html><body></body></html>");
  private readonly cookies = new Map<string, Map<string, string>>();
  private closed = false;

  constructor(id = "html") {
    this.id = id;
  }

  /** Raw HTML of the current page, for footprint checks. */
  html(): string {
    return this.raw;
  }

  async goto(url: string): Promise<void> {
    this.assertOpen();
    await this.exchange(new URL(url, this.current).href, "GET");
  }

  async url(): Promise<string> {
    this.assertOpen();
    return this.current;
  }

  async fill(selector: string, text: string): Promise<void> {
    const el = this.one(selector);
    el.attr("value", text);
    if (tagOf(el[0]!) === "textarea") el.text(text);
  }

  async click(selector: string): Promise<void> {
    const el = this.one(selector);
    const tag = tagOf(el[0]!);
    if (tag === "a") {
      const href = el.attr("href");
      if (!href) return;
      await this.goto(new URL(href, this.current).href);
      return;
    }
    const type = (el.attr("type") ?? (tag === "button" ? "submit" : "")).toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if (el.attr("checked") === undefined) el.attr("checked", "checked");
      else el.removeAttr("checked");
      return;
    }
    if (type === "submit" || tag === "button") {
      const form = el.closest("form");
      if (!form.length) return;
      await this.submit(form, el);
    }
  }

  async text(selector: string): Promise<string | null> {
    this.assertOpen();
    const el = this.$(selector).first();
    if (!el.length) return null;
    return el.text().replace(/\s+/g, " ").trim();
  }

  async exists(selector: string): Promise<boolean> {
    this.assertOpen();
    return this.$(selector).length > 0;
  }

  async attribute(selector: string, name: string): Promise<string | null> {
    this.assertOpen();
    const el = this.$(selector).first();
    if (!el.length) return null;
    const value = el.attr(name) ?? el.attr(name.toLowerCase());
    return value === undefined ? null : value;
  }

  async elementScreenshotPng(): Promise<Uint8Array> {
    this.assertOpen();
    return noisePng(160, 48, 3);
  }

  async pageText(): Promise<string> {
    this.assertOpen();
    return this.$("body").text().replace(/\s+/g, " ").trim();
  }

  async waitFor(selector: string): Promise<boolean> {
    return this.exists(selector);
  }

  async screenshotPng(): Promise<Uint8Array> {
    this.assertOpen();
    return noisePng(32, 16, 1);
  }

  async injectToken(fieldName: string, token: string): Promise<void> {
    await this.fill(`[name='${fieldName}']`, token);
  }

  async formFields(selector: string): Promise<FormFieldInfo[]> {
    this.assertOpen();
    const root = this.$(selector).first();
    if (!root.length) return [];
    const form = tagOf(root[0]!) === "form" ? root : root.find("form").first();
    const scope = form.length ? form : root;
    const fields: FormFieldInfo[] = [];
    scope.find("input, textarea, select, button").each((index, node) => {
      if (node.type !== "tag") return;
      const el = this.$(node);
      const id = el.attr("id") ?? null;
      const name = el.attr("name") ?? null;
      const tag = node.name;
      let label = "";
      if (id) label = this.$(`label[for="${id}"]`).first().text().replace(/\s+/g, " ").trim();
      if (!label) {
        const parent = el.closest("label");
        if (parent.length) label = parent.text().replace(/\s+/g, " ").trim();
      }
      if (!label && (tag === "button" || el.attr("type") === "submit")) {
        label = el.text().replace(/\s+/g, " ").trim();
      }
      if (!label) label = (el.attr("aria-label") ?? "").trim();
      const control = id
        ? /^[A-Za-z_][\w-]*$/.test(id)
          ? `#${id}`
          : `[id="${id.replace(/"/g, "")}"]`
        : name
          ? `[name="${name.replace(/"/g, "")}"]`
          : `${tag}:nth-of-type(${index + 1})`;
      fields.push({
        selector: control,
        tag,
        type: el.attr("type") ?? (tag === "textarea" ? null : tag === "button" ? "submit" : null),
        name,
        id,
        autocomplete: el.attr("autocomplete") ?? null,
        label,
        role: el.attr("role") ?? (tag === "textarea" ? "textbox" : null),
        required: el.attr("required") !== undefined,
      });
    });
    return fields;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Test hook: the persona is unused; the signature matches sessions the drivers already accept. */
  bind(_persona: BrowserPersona): void {}

  private async submit(form: Selection, clicked: Selection): Promise<void> {
    const params = new URLSearchParams();
    form.find("input, textarea, select").each((_, node) => {
      if (node.type !== "tag") return;
      const el = this.$(node);
      const name = el.attr("name");
      if (!name || node.type !== "tag") return;
      const type = (el.attr("type") ?? "text").toLowerCase();
      if (type === "submit" || type === "image" || type === "button") return;
      if ((type === "checkbox" || type === "radio") && el.attr("checked") === undefined) return;
      const value = node.name === "textarea" ? el.text() : (el.attr("value") ?? "");
      params.append(name, value);
    });
    const submitName = clicked.attr("name");
    if (submitName) params.append(submitName, clicked.attr("value") ?? clicked.text().trim());
    const action = form.attr("action") || this.current;
    const method = (form.attr("method") ?? "get").toUpperCase();
    const target = new URL(action, this.current);
    if (method === "GET") {
      for (const [key, value] of params) target.searchParams.append(key, value);
      await this.exchange(target.href, "GET");
      return;
    }
    await this.exchange(target.href, "POST", params.toString());
  }

  private async exchange(url: string, method: string, body?: string): Promise<void> {
    let current = url;
    let verb = method;
    let payload = body;
    for (let hop = 0; hop < 6; hop += 1) {
      const target = new URL(current);
      const headers: Record<string, string> = {};
      const cookie = this.cookieHeader(target.origin);
      if (cookie) headers.cookie = cookie;
      if (payload) headers["content-type"] = "application/x-www-form-urlencoded";
      const response = await fetch(current, {
        method: verb,
        headers,
        body: payload,
        redirect: "manual",
      });
      this.storeCookies(target.origin, response.headers);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Redirect from ${current} has no location`);
        current = new URL(location, current).href;
        verb = "GET";
        payload = undefined;
        continue;
      }
      this.current = current;
      const raw = await response.text();
      this.raw = raw;
      this.$ = load(raw.trimStart().startsWith("<") ? raw : "<html><body></body></html>");
      return;
    }
    throw new Error(`Too many redirects for ${url}`);
  }

  private cookieHeader(origin: string): string {
    const jar = this.cookies.get(origin);
    if (!jar) return "";
    return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  private storeCookies(origin: string, headers: Headers): void {
    const lines = headers.getSetCookie?.() ?? [];
    if (lines.length === 0) return;
    const jar = this.cookies.get(origin) ?? new Map<string, string>();
    for (const line of lines) {
      const pair = line.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    this.cookies.set(origin, jar);
  }

  private one(selector: string): Selection {
    this.assertOpen();
    const el = this.$(selector).first();
    if (!el.length) throw new Error(`No element matches ${selector}`);
    return el;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Browser session is closed");
  }
}
