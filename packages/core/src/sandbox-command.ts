export const DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS = 5 * 60_000;
export const MAX_SANDBOX_COMMAND_TIMEOUT_MS = 60 * 60_000;

export function sandboxCommandTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const configured = Number(env.SANDBOX_COMMAND_TIMEOUT_MS);
  return validSandboxCommandTimeout(configured) ? configured : DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS;
}

export function boundedSandboxCommandTimeoutMs(
  requested: number | undefined,
  fallback?: number,
): number {
  if (validSandboxCommandTimeout(requested)) return requested;
  if (fallback === undefined) return sandboxCommandTimeoutMs();
  return validSandboxCommandTimeout(fallback) ? fallback : DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS;
}

function validSandboxCommandTimeout(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_SANDBOX_COMMAND_TIMEOUT_MS
  );
}

const ALREADY_BACKGROUNDED = /(?:^|\s)(?:nohup\b|&\s*$)/;
const LONG_RUNNING_SERVER =
  /\b(?:flask\s+run|http\.server|uvicorn|gunicorn|daphne)\b|\bpython3?\s+\S*(?:server|forum)\S*\.py\b/i;

/** Keep shell tools from blocking the run on HTTP servers and similar daemons. */
export function prepareSandboxShellCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (ALREADY_BACKGROUNDED.test(trimmed) || LONG_RUNNING_SERVER.test(trimmed) === false) {
    return trimmed;
  }
  return `nohup bash -lc ${posixShellQuote(trimmed)} >/tmp/rakazo-shell-bg.log 2>&1 & echo started`;
}

function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
