export const TUNNEL_AUTH_ORIGINS = [
  "https://*.trycloudflare.com",
  "http://*.trycloudflare.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
] as const;

export function isTrustedOrigin(
  origin: string,
  env: { webOrigin: string; apiUrl: string; authUrl: string },
) {
  if (!origin) return true;
  if (origin === env.webOrigin || origin === env.apiUrl || origin === env.authUrl) return true;
  if (origin.startsWith("rakazo://") || origin.startsWith("exp://")) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}
