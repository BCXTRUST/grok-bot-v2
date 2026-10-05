import { randomUUID } from "node:crypto";
import type { BrowserSession } from "@rakazo/adapter-kit";
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
export type BrowserEngine = "playwright" | "patchright";

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

const ENGINE_MODULES: Record<BrowserEngine, string> = {
  playwright: "playwright",
  patchright: "patchright",
};

async function loadChromium(engine: BrowserEngine): Promise<BrowserType> {
  const specifier = ENGINE_MODULES[engine];
  const module = (await import(specifier)) as { chromium?: BrowserType };
  if (!module.chromium) throw new Error(`Browser engine ${engine} has no chromium launcher`);
  return module.chromium;
}

export function browserEngineFromEnv(env: NodeJS.ProcessEnv = process.env): BrowserEngine {
  return env.LINK_BUILDER_BROWSER_ENGINE === "playwright" ? "playwright" : "patchright";
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
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
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
    options?: { paddingPx?: number },
  ): Promise<Uint8Array> {
    const padding = options?.paddingPx ?? 0;
    const locator = this.first(selector);
    if (padding <= 0) return new Uint8Array(await locator.screenshot({ type: "png" }));
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Could not crop ${selector}`);
    const viewport = this.page.viewportSize() ?? { width: 1280, height: 720 };
    const x = Math.max(0, Math.floor(box.x - padding));
    const y = Math.max(0, Math.floor(box.y - padding));
    const right = Math.min(viewport.width, Math.ceil(box.x + box.width + padding));
    const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height + padding));
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

/**
 * Launches a persistent Chromium profile with the helper extensions loaded. Branded Chrome 137+
 * ignores `--load-extension`, so the bundled Chromium (`channel: "chromium"`) is required unless a
 * system Chromium is given.
 */
export async function launchPlaywrightSession(
  options: PlaywrightLaunchOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlaywrightBrowserSession> {
  const engine = options.engine ?? browserEngineFromEnv(env);
  const chromium = await loadChromium(engine);
  const executablePath =
    options.executablePath ?? (engine === "patchright" ? await bundledChromiumPath() : undefined);
  const helperDirs = options.helperDirs ?? [];
  const args =
    helperDirs.length > 0
      ? [
          `--disable-extensions-except=${helperDirs.join(",")}`,
          `--load-extension=${helperDirs.join(",")}`,
        ]
      : [];
  const context = await chromium.launchPersistentContext(options.profileDir, {
    ...(executablePath ? { executablePath } : { channel: "chromium" }),
    headless: options.headless ?? !env.DISPLAY,
    args,
    locale: options.locale,
    timezoneId: options.timezoneId,
    viewport: { width: 1280, height: 860 },
    acceptDownloads: false,
    ...(options.proxy
      ? {
          proxy: {
            server: proxyServer(options.proxy.server),
            username: options.proxy.username,
            password: options.proxy.password,
          },
        }
      : {}),
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    return new PlaywrightBrowserSession(context, page, options);
  } catch (error) {
    await context.close();
    throw error;
  }
}
