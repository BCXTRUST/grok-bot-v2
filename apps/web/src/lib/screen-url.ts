/** Make a computer stream URL safe to iframe from the current page, including Cloudflare tunnels. */
export function embeddableScreenUrl(url: string | null, pageHref: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, pageHref);
    if (parsed.pathname.startsWith("/novnc/")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    const page = new URL(pageHref);
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const pagePort = page.port || (page.protocol === "https:" ? "443" : "80");
    if (local && parsed.port && parsed.port !== pagePort) {
      return null;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
