import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { BrowserSession, FormFieldInfo } from "@rakazo/adapter-kit";
import {
  assertPacing,
  HUMAN_PACING,
  type PacingPolicy,
  pacedDelayMs,
  rateLimitWaitMs,
} from "@rakazo/linkbuilder-core";
import type { BrowserContext, BrowserType, Page } from "playwright";

/**
 * `patchright` (default) is the drop-in Playwright fork that hides the CDP `Runtime.enable` leak.
 * `playwright` is the plain upstream driver, selected with `LINK_BUILDER_BROWSER_ENGINE=playwright`.
 * Both drive the same Playwright-bundled Chromium binary, because branded Chrome 137+ ignores
 * `--load-extension`.
 */
export type ChromiumEngine = "playwright" | "patchright";
/** `camoufox` launches Playwright Firefox with the Camoufox executable. It cannot load the Page Helper. */
export type BrowserEngine = ChromiumEngine | "camoufox";

export class BrowserEngineUnavailable extends Error {
  readonly code = "unavailable" as const;
  readonly engine: BrowserEngine;

  constructor(engine: BrowserEngine) {
    super(`Browser engine ${engine} is unavailable`);
    this.name = "BrowserEngineUnavailable";
    this.engine = engine;
  }
}

export interface BrowserProxy {
  /** `host:port`; Chromium's `--proxy-server` takes the scheme from the URL when present. */
  server: string;
  username?: string;
  password?: string;
}

export interface PlaywrightLaunchOptions {
  profileDir: string;
  /** Unpacked MV3 extension directories, e.g. the Page Helper. */
  helperDirs?: readonly string[];
  locale: string;
  timezoneId: string;
  acceptLanguage?: string;
  proxy?: BrowserProxy;
  /** Defaults to headed when `DISPLAY` is set, so the live screen shows the real browser. */
  headless?: boolean;
  pacing?: PacingPolicy;
  random?: () => number;
  /** A system Chromium (the sandbox image ships `/usr/bin/chromium`); the bundled one otherwise. */
  executablePath?: string;
  engine?: BrowserEngine;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms));

const ENGINE_MODULES: Record<ChromiumEngine, string> = {
  playwright: "playwright",
  patchright: "patchright",
};

async function loadChromium(engine: ChromiumEngine): Promise<BrowserType> {
  const specifier = ENGINE_MODULES[engine];
  const module = (await import(specifier)) as { chromium?: BrowserType };
  if (!module.chromium) throw new Error(`Browser engine ${engine} has no chromium launcher`);
  return module.chromium;
}

export function browserEngineFromEnv(env: NodeJS.ProcessEnv = process.env): ChromiumEngine {
  return env.LINK_BUILDER_BROWSER_ENGINE === "playwright" ? "playwright" : "patchright";
}

/** Camoufox is optional. A missing executable is `unavailable`, not a failed Chromium launch. */
export function camoufoxExecutable(
  env: NodeJS.ProcessEnv = process.env,
  path?: string,
): string | null {
  const executable = path ?? env.LINK_BUILDER_CAMOUFOX_PATH;
  if (!executable || !existsSync(executable)) return null;
  return executable;
}

/** Playwright's bundled Chromium; Patchright pins its own revision, which is not installed. */
export async function bundledChromiumPath(): Promise<string> {
  return (await loadChromium("playwright")).executablePath();
}

function proxyServer(server: string): string {
  return /^[a-z0-9]+:\/\//i.test(server) ? server : `http://${server}`;
}

export class PlaywrightBrowserSession implements BrowserSession {
  readonly id = randomUUID();
  private readonly pacing: PacingPolicy;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly actions: number[] = [];
  private closed = false;
  private lastNavigation: { status: number | null; headers: Record<string, string> } | null = null;

  constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    options: Pick<PlaywrightLaunchOptions, "pacing" | "random" | "sleep" | "now"> = {},
  ) {
    this.pacing = assertPacing(options.pacing ?? HUMAN_PACING);
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  private async paceAction(): Promise<void> {
    const wait = rateLimitWaitMs(this.actions, this.now(), this.pacing.maxActionsPerMinute);
    await this.sleep(wait + pacedDelayMs(this.pacing.beforeAction, this.random));
    this.actions.push(this.now());
    const windowStart = this.now() - 60_000;
    while (this.actions.length > 0 && this.actions[0]! <= windowStart) this.actions.shift();
  }

  private first(selector: string) {
    return this.page.locator(selector).first();
  }

  async goto(url: string): Promise<void> {
    await this.paceAction();
    const response = await this.page.goto(url, { waitUntil: "domcontentloaded" });
    this.lastNavigation = response
      ? { status: response.status(), headers: response.headers() }
      : { status: null, headers: {} };
  }

  async navigationMeta(): Promise<{ status: number | null; headers: Record<string, string> }> {
    return this.lastNavigation ?? { status: null, headers: {} };
  }

  /** Locale and time zone the live page is actually using. */
  async browserFacts(): Promise<{ locale: string; timezoneId: string }> {
    return this.page.evaluate(() => {
      const root = globalThis as {
        navigator: { language: string };
        Intl: { DateTimeFormat: () => { resolvedOptions: () => { timeZone: string } } };
      };
      return {
        locale: root.navigator.language,
        timezoneId: root.Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    });
  }

  async url(): Promise<string> {
    return this.page.url();
  }

  async fill(selector: string, text: string, options: { secret?: boolean } = {}): Promise<void> {
    await this.paceAction();
    try {
      const field = this.first(selector);
      await field.click();
      await field.fill("");
      for (const char of text) {
        await this.page.keyboard.type(char);
        await this.sleep(pacedDelayMs(this.pacing.keystroke, this.random));
      }
    } catch (error) {
      if (options.secret) throw new Error(`Could not fill ${selector}`);
      throw error;
    }
  }

  async click(selector: string): Promise<void> {
    await this.paceAction();
    await this.first(selector).click();
    await this.page.waitForLoadState("domcontentloaded");
  }

  async text(selector: string): Promise<string | null> {
    const locator = this.first(selector);
    if ((await locator.count()) === 0) return null;
    return (await locator.innerText()).trim();
  }

  async exists(selector: string): Promise<boolean> {
    return (await this.page.locator(selector).count()) > 0;
  }

  async attribute(selector: string, name: string): Promise<string | null> {
    const locator = this.first(selector);
    if ((await locator.count()) === 0) return null;
    return locator.getAttribute(name);
  }

  async elementScreenshotPng(
    selector: string,
    options?: { paddingPx?: number; insetPx?: number },
  ): Promise<Uint8Array> {
    const padding = options?.paddingPx ?? 0;
    const inset = options?.insetPx ?? 0;
    const locator = this.first(selector);
    if (padding <= 0 && inset <= 0)
      return new Uint8Array(await locator.screenshot({ type: "png" }));
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Could not crop ${selector}`);
    const viewport = this.page.viewportSize() ?? { width: 1280, height: 720 };
    const x = Math.max(0, Math.floor(inset > 0 ? box.x + inset : box.x - padding));
    const y = Math.max(0, Math.floor(inset > 0 ? box.y + inset : box.y - padding));
    const right = Math.min(
      viewport.width,
      Math.ceil(inset > 0 ? box.x + box.width - inset : box.x + box.width + padding),
    );
    const bottom = Math.min(
      viewport.height,
      Math.ceil(inset > 0 ? box.y + box.height - inset : box.y + box.height + padding),
    );
    return new Uint8Array(
      await this.page.screenshot({
        type: "png",
        clip: { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) },
      }),
    );
  }

  async injectToken(fieldName: string, token: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(fieldName)) throw new Error("Unexpected captcha field");
    try {
      await this.page.evaluate(
        ({ name, value }) => {
          const root = globalThis as unknown as {
            document: {
              querySelectorAll: (selector: string) => Iterable<{ value?: string }>;
              querySelector: (
                selector: string,
              ) => { getAttribute: (attribute: string) => string | null } | null;
            };
          };
          for (const field of root.document.querySelectorAll(`[name="${name}"]`)) {
            field.value = value;
          }
          const callback = root.document
            .querySelector("[data-callback]")
            ?.getAttribute("data-callback");
          if (callback && /^[A-Za-z_$][\w$]*$/.test(callback)) {
            const fn = (globalThis as Record<string, unknown>)[callback];
            if (typeof fn === "function") (fn as (token: string) => void)(value);
          }
        },
        { name: fieldName, value: token },
      );
    } catch {
      throw new Error(`Could not place the captcha token in ${fieldName}`);
    }
  }

  async extensionVersions(): Promise<Array<{ id: string; version: string }>> {
    let workers = this.context.serviceWorkers();
    if (workers.length === 0) {
      try {
        await this.context.waitForEvent("serviceworker", { timeout: 5_000 });
      } catch {
        return [];
      }
      workers = this.context.serviceWorkers();
    }
    const found: Array<{ id: string; version: string }> = [];
    for (const worker of workers) {
      const id = /^chrome-extension:\/\/([a-p]{32})\//.exec(worker.url())?.[1];
      if (!id) continue;
      let version = "";
      try {
        version = await worker.evaluate(() => {
          const runtime = (
            globalThis as {
              chrome?: { runtime?: { getManifest?: () => { version?: string } } };
            }
          ).chrome?.runtime;
          return runtime?.getManifest?.().version ?? "";
        });
      } catch {
        version = "";
      }
      found.push({ id, version });
    }
    return found;
  }

  async pageText(): Promise<string> {
    return this.page.locator("body").innerText();
  }

  async formFields(selector: string): Promise<FormFieldInfo[]> {
    return this.page.evaluate((rootSelector) => {
      const cssEscape = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "\\$&");
      const rootDoc = globalThis as unknown as {
        document: {
          querySelector: (selector: string) => DomNode | null;
        };
      };
      interface DomNode {
        matches: (selector: string) => boolean;
        querySelector: (selector: string) => DomNode | null;
        querySelectorAll: (selector: string) => Iterable<DomNode>;
        closest: (selector: string) => DomNode | null;
        id: string;
        tagName: string;
        textContent: string | null;
        getAttribute: (name: string) => string | null;
        hasAttribute: (name: string) => boolean;
      }
      const root = rootDoc.document.querySelector(rootSelector);
      if (!root) return [];
      const form = root.matches("form") ? root : root.querySelector("form");
      const scope = form ?? root;
      return [...scope.querySelectorAll("input, textarea, select, button")].map((el, index) => {
        const id = el.id || null;
        const name = el.getAttribute("name");
        const tag = el.tagName.toLowerCase();
        const labelFor = id
          ? rootDoc.document.querySelector(`label[for="${cssEscape(id)}"]`)
          : null;
        const parent = el.closest("label");
        const own = tag === "button" || el.getAttribute("type") === "submit" ? el.textContent : "";
        const label = (
          labelFor?.textContent ||
          parent?.textContent ||
          el.getAttribute("aria-label") ||
          own ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        const control = id
          ? `#${cssEscape(id)}`
          : name
            ? `[name="${cssEscape(name)}"]`
            : `${tag}:nth-of-type(${index + 1})`;
        return {
          selector: control,
          tag,
          type: el.getAttribute("type"),
          name,
          id,
          autocomplete: el.getAttribute("autocomplete"),
          label,
          role: el.getAttribute("role") ?? (tag === "textarea" ? "textbox" : null),
          required: el.hasAttribute("required"),
        };
      });
    }, selector);
  }

  async waitFor(selector: string, options: { timeoutMs: number }): Promise<boolean> {
    try {
      await this.first(selector).waitFor({ state: "attached", timeout: options.timeoutMs });
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") return false;
      throw error;
    }
  }

  async screenshotPng(): Promise<Uint8Array> {
    return new Uint8Array(await this.page.screenshot({ type: "png" }));
  }

  async loadedExtensions(): Promise<string[]> {
    let workers = this.context.serviceWorkers();
    if (workers.length === 0) {
      try {
        await this.context.waitForEvent("serviceworker", { timeout: 5_000 });
      } catch {
        return [];
      }
      workers = this.context.serviceWorkers();
    }
    const ids = workers
      .map((worker) => /^chrome-extension:\/\/([a-p]{32})\//.exec(worker.url())?.[1])
      .filter((id): id is string => id !== undefined);
    return [...new Set(ids)];
  }

  /** Fires once when the browser goes away, including when something outside kills Chromium. */
  onClosed(listener: () => void): void {
    this.context.once("close", listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.context.close();
  }
}

/** Identity fields passed to Playwright. Geolocation is never set. */
export function identityLaunchFields(options: PlaywrightLaunchOptions): {
  locale: string;
  timezoneId: string;
  extraHTTPHeaders?: { "Accept-Language": string };
  proxy?: { server: string; username?: string; password?: string };
} {
  return {
    locale: options.locale,
    timezoneId: options.timezoneId,
    ...(options.acceptLanguage
      ? { extraHTTPHeaders: { "Accept-Language": options.acceptLanguage } }
      : {}),
    ...(options.proxy
      ? {
          proxy: {
            server: proxyServer(options.proxy.server),
            username: options.proxy.username,
            password: options.proxy.password,
          },
        }
      : {}),
  };
}

/**
 * Launches a persistent profile. Chromium loads the Page Helper. Camoufox is Firefox with
 * the executable from config; without that file the engine is unavailable and no browser starts.
 * Branded Chrome 137+ ignores `--load-extension`, so Chromium is the bundled one unless a
 * system Chromium is given.
 */
export async function launchPlaywrightSession(
  options: PlaywrightLaunchOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlaywrightBrowserSession> {
  const engine = options.engine ?? browserEngineFromEnv(env);
  const helperDirs = engine === "camoufox" ? [] : (options.helperDirs ?? []);
  const args = [
    ...(helperDirs.length > 0
      ? [
          `--disable-extensions-except=${helperDirs.join(",")}`,
          `--load-extension=${helperDirs.join(",")}`,
        ]
      : []),
    // Chromium skips the proxy for loopback unless this token removes that bypass.
    ...(options.proxy ? ["--proxy-bypass-list=<-loopback>"] : []),
  ];
  const identity = identityLaunchFields(options);
  const context =
    engine === "camoufox"
      ? await launchCamoufox(options, env, args, identity)
      : await launchChromium(options, env, engine, args, identity);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    return new PlaywrightBrowserSession(context, page, options);
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function launchChromium(
  options: PlaywrightLaunchOptions,
  env: NodeJS.ProcessEnv,
  engine: ChromiumEngine,
  args: string[],
  identity: ReturnType<typeof identityLaunchFields>,
): Promise<BrowserContext> {
  const chromium = await loadChromium(engine);
  const executablePath =
    options.executablePath ?? (engine === "patchright" ? await bundledChromiumPath() : undefined);
  return chromium.launchPersistentContext(options.profileDir, {
    ...(executablePath ? { executablePath } : { channel: "chromium" }),
    headless: options.headless ?? !env.DISPLAY,
    args,
    viewport: { width: 1280, height: 860 },
    acceptDownloads: false,
    ...identity,
  });
}

async function launchCamoufox(
  options: PlaywrightLaunchOptions,
  env: NodeJS.ProcessEnv,
  args: string[],
  identity: ReturnType<typeof identityLaunchFields>,
): Promise<BrowserContext> {
  const executablePath = camoufoxExecutable(env, options.executablePath);
  if (!executablePath) throw new BrowserEngineUnavailable("camoufox");
  const playwright = (await import("playwright")) as { firefox?: BrowserType };
  if (!playwright.firefox) throw new BrowserEngineUnavailable("camoufox");
  return playwright.firefox.launchPersistentContext(options.profileDir, {
    executablePath,
    headless: options.headless ?? !env.DISPLAY,
    args,
    viewport: { width: 1280, height: 860 },
    acceptDownloads: false,
    ...identity,
  });
}
