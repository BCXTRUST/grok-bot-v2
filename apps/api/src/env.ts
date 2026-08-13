export interface AppEnv {
  databaseUrl: string;
  authSecret: string;
  authUrl: string;
  webOrigin: string;
  apiUrl: string;
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
  encryptionKey: string;
  dataDir: string;
  sandboxSupervisorUrl: string;
  sandboxProvider: string;
  agentRuntime: string;
  openRouterKey: string | undefined;
  e2bApiKey: string | undefined;
  composioApiKey: string | undefined;
  defaultProvider: string;
  defaultModel: string;
  port: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return {
    databaseUrl: required(source, "DATABASE_URL"),
    authSecret: source.BETTER_AUTH_SECRET ?? "dev-secret-change-me-please-32chars",
    authUrl: source.BETTER_AUTH_URL ?? source.WEB_ORIGIN ?? "http://127.0.0.1:5173",
    webOrigin: source.WEB_ORIGIN ?? "http://127.0.0.1:5173",
    apiUrl: source.API_URL ?? "http://127.0.0.1:3100",
    signupsEnabled: source.SIGNUPS_ENABLED,
    signupAllowlist: source.SIGNUP_ALLOWLIST,
    encryptionKey: source.ENCRYPTION_KEY ?? "dev-encryption-key",
    dataDir: source.DATA_DIR ?? "./data",
    sandboxSupervisorUrl: source.SANDBOX_SUPERVISOR_URL ?? "http://127.0.0.1:7091",
    sandboxProvider: source.SANDBOX_PROVIDER ?? "fake",
    agentRuntime: source.AGENT_RUNTIME ?? "scripted",
    openRouterKey: source.OPENROUTER_API_KEY,
    e2bApiKey: source.E2B_API_KEY,
    composioApiKey: source.COMPOSIO_API_KEY,
    defaultProvider: source.PI_DEFAULT_PROVIDER ?? "openrouter",
    defaultModel: source.PI_DEFAULT_MODEL ?? "deepseek/deepseek-v4-flash-0731",
    port: Number(source.API_PORT ?? 3100),
  };
}

function required(source: NodeJS.ProcessEnv, key: string): string {
  const value = source[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}
