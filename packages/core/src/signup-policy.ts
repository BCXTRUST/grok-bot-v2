export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function emailAllowed(email: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split("@")[1];
  return allowlist.some((entry) => {
    if (entry.startsWith("@")) return domain === entry.slice(1);
    return normalized === entry;
  });
}

export function signupsOpen(enabled: string | undefined): boolean {
  if (enabled === undefined) return true;
  return enabled !== "false" && enabled !== "0";
}

export function resolveSignupPolicy(input: {
  envEnabled?: string;
  envAllowlist?: string;
  stored?: { signupsEnabled: boolean; signupAllowlist: string } | null;
}): { open: boolean; allowlist: string[] } {
  if (input.stored) {
    return {
      open: input.stored.signupsEnabled,
      allowlist: parseAllowlist(input.stored.signupAllowlist),
    };
  }
  return {
    open: signupsOpen(input.envEnabled),
    allowlist: parseAllowlist(input.envAllowlist),
  };
}
