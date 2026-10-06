export const REDACTED = "[redacted]";

/** Minimum length for value redaction, so short words never blank out unrelated text. */
const MIN_SECRET_LENGTH = 6;

const SECRET_PATTERNS: readonly RegExp[] = [
  /ct_live_[A-Za-z0-9_-]{8,}/g,
  /whsec_[A-Za-z0-9+/=_-]{8,}/g,
  // Proxy userinfo (`user:pass@host`) including when it sits inside a URL.
  /[^\s'"`<>:/]+:[^\s'"`<>@/]+@[^\s'"`<>/]+/g,
];

/**
 * Removes known secret values (forum passwords, proxy passwords, solver tokens) and token-shaped
 * strings from text bound for logs, events, step outcomes or the UI.
 */
export function redactSecrets(text: string, secrets: Iterable<string> = []): string {
  let out = text;
  const values = [...new Set(secrets)]
    .filter((value) => value.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const value of values) out = out.split(value).join(REDACTED);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}
