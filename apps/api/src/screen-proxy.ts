import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const SCREEN_PROXY_TTL_MS = 60 * 60_000;
const SCREEN_PROXY_CIPHER = "aes-256-gcm";
const SCREEN_PROXY_REMOTE_PREFIX = "/novnc/remote";

export interface ScreenProxyOptions {
  /** Keep provider desktop secrets server-side and enforce the view/control policy in the proxy. */
  proxyExternal?: boolean;
}

export function proxiesExternalDesktop(kind: string | undefined) {
  return kind === "box" || kind === "e2b";
}

function screenProxyHref(proxyOrigin: string, pathAndSearch: string): string {
  try {
    const origin = new URL(proxyOrigin);
    const local =
      origin.hostname === "127.0.0.1" ||
      origin.hostname === "localhost" ||
      origin.hostname === "::1";
    if (local) return pathAndSearch;
    return `${origin.origin}${pathAndSearch}`;
  } catch {
    return pathAndSearch;
  }
}

export function addScreenProxyCapability(
  url: string,
  secret: string,
  proxyOrigin: string,
  now = Date.now(),
  options: ScreenProxyOptions = {},
): string {
  try {
    const parsed = new URL(url);
    if (options.proxyExternal && parsed.protocol === "https:" && parsed.hostname) {
      const expiresAt = now + SCREEN_PROXY_TTL_MS;
      const policy = parsed.searchParams.get("view_only") === "false" ? "control" : "view";
      const token = sealScreenTarget(parsed.toString(), secret, policy, expiresAt);
      return screenProxyHref(
        proxyOrigin,
        `${SCREEN_PROXY_REMOTE_PREFIX}/${policy}/${expiresAt}.${token}${parsed.pathname || "/"}${novncViewerSearch(parsed)}`,
      );
    }
    if (parsed.protocol !== "http:" || !parsed.hostname || !parsed.port) return url;
    const expiresAt = now + SCREEN_PROXY_TTL_MS;
    const target = Buffer.from(parsed.hostname).toString("base64url");
    const policy = parsed.searchParams.get("view_only") === "false" ? "control" : "view";
    const destination = `${parsed.pathname}${parsed.search}`;
    const signature = createHmac("sha256", secret)
      .update(`${parsed.hostname}:${parsed.port}:${policy}:${expiresAt}`)
      .digest("base64url");
    return screenProxyHref(
      proxyOrigin,
      `/novnc/${target}/${parsed.port}/${policy}/${expiresAt}.${signature}${destination}`,
    );
  } catch {
    return url;
  }
}

function sealScreenTarget(
  url: string,
  secret: string,
  policy: "view" | "control",
  expiresAt: number,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(SCREEN_PROXY_CIPHER, screenProxyKey(secret), iv);
  cipher.setAAD(Buffer.from(`${policy}:${expiresAt}`));
  const ciphertext = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

function screenProxyKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

/** Query params noVNC reads from the iframe URL. Secrets stay out of the encrypted path. */
export function novncViewerSearch(parsed: URL): string {
  const params = new URLSearchParams();
  params.set("autoconnect", parsed.searchParams.get("autoconnect") || "true");
  params.set("reconnect", parsed.searchParams.get("reconnect") || "true");
  params.set("resize", parsed.searchParams.get("resize") || "scale");
  params.set("path", parsed.searchParams.get("path") || "websockify");
  const viewOnly = parsed.searchParams.get("view_only");
  if (viewOnly) params.set("view_only", viewOnly);
  const password = parsed.searchParams.get("password") || parsed.searchParams.get("authKey");
  if (password) params.set("password", password);
  const query = params.toString();
  return query ? `?${query}` : "";
}
