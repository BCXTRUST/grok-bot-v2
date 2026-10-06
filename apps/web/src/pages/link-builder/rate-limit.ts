/** oRPC turns the API 429 into this status message and paints it on the dark shell. */
export function isLinkBuilderRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; status?: unknown; message?: unknown };
  if (value.code === "TOO_MANY_REQUESTS" || value.status === 429) return true;
  return typeof value.message === "string" && /too many requests/i.test(value.message);
}
