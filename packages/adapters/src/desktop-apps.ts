import { shellQuote } from "./computer-support.js";

export const DESKTOP_BROWSER_BINARIES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "firefox",
  "firefox-esr",
] as const;

const BROWSER_ALIASES = new Set([
  "browser",
  "web",
  "chrome",
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "firefox",
  "firefox-esr",
  "mozilla",
]);

const BROWSER_SHELL_COMMAND =
  /^(firefox|firefox-esr|google-chrome|google-chrome-stable|chromium|chromium-browser|chrome)(?:\s+(https?:\/\/\S+))?\s*$/i;

export function desktopApplicationCandidates(application: string): string[] {
  const name = application.trim();
  if (!name || BROWSER_ALIASES.has(name.toLowerCase())) {
    return [...DESKTOP_BROWSER_BINARIES];
  }
  const unique = new Set<string>([name, name.toLowerCase()]);
  return [...unique];
}

/** Rewrite a terminal browser launch into launch_app so PATH-less desktop apps still open. */
export function browserLaunchFromShellCommand(
  command: string,
): { application: string; uri?: string } | null {
  const match = command.trim().match(BROWSER_SHELL_COMMAND);
  if (!match) return null;
  return match[2] ? { application: "browser", uri: match[2] } : { application: "browser" };
}

export function listDesktopAppsCommand(): string {
  return [
    "set +e",
    'printf \'browser\\tChrome or Firefox (use launch_app application=browser)\\n\'',
    "for dir in /usr/share/applications /usr/local/share/applications \"$HOME/.local/share/applications\"; do",
    '  [ -d "$dir" ] || continue',
    '  for file in "$dir"/*.desktop; do',
    '    [ -f "$file" ] || continue',
    '    grep -q "^NoDisplay=true" "$file" && continue',
    '    grep -q "^Hidden=true" "$file" && continue',
    '    name=$(awk -F= \'/^Name=/ { print substr($0,6); exit }\' "$file")',
    '    id=$(basename "$file" .desktop)',
    '    [ -n "$name" ] || continue',
    '    printf \'%s\\t%s\\n\' "$name" "$id"',
    "  done",
    "done | sort -u",
  ].join("\n");
}

export function launchDesktopAppCommand(
  display: string,
  application: string,
  uri?: string,
  options?: { rawDisplay?: boolean },
): string {
  const candidates = desktopApplicationCandidates(application);
  const uriArg = uri ? ` ${shellQuote(uri)}` : "";
  const displayExport = options?.rawDisplay
    ? `export DISPLAY=${display}`
    : `export DISPLAY=${shellQuote(display)}`;
  return [
    "set +e",
    displayExport,
    `for app in ${candidates.map(shellQuote).join(" ")}; do`,
    '  if command -v "$app" >/dev/null 2>&1; then',
    `    nohup env DISPLAY="$DISPLAY" "$app"${uriArg} >/tmp/rakazo-app.log 2>&1 &`,
    "    exit 0",
    "  fi",
    "done",
    `needle=${shellQuote(application.trim().toLowerCase())}`,
    'if [ "$needle" = "browser" ] || [ "$needle" = "web" ] || [ "$needle" = "chrome" ] || [ "$needle" = "firefox" ] || [ "$needle" = "mozilla" ]; then',
    '  needle="firefox\\|chrome\\|chromium"',
    "fi",
    "for dir in /usr/share/applications /usr/local/share/applications \"$HOME/.local/share/applications\"; do",
    '  [ -d "$dir" ] || continue',
    '  for file in "$dir"/*.desktop; do',
    '    [ -f "$file" ] || continue',
    '    grep -qiE "^Name=.*($needle)" "$file" || grep -qiE "^Exec=.*($needle)" "$file" || continue',
    '    id=$(basename "$file" .desktop)',
    '    if command -v gtk-launch >/dev/null 2>&1; then',
    `      nohup env DISPLAY="$DISPLAY" gtk-launch "$id"${uriArg} >/tmp/rakazo-app.log 2>&1 &`,
    "      exit 0",
    "    fi",
    '    exec_bin=$(awk -F= \'/^Exec=/ { print substr($0,6); exit }\' "$file" | awk \'{ print $1 }\')',
    '    if [ -n "$exec_bin" ]; then',
    `      nohup env DISPLAY="$DISPLAY" "$exec_bin"${uriArg} >/tmp/rakazo-app.log 2>&1 &`,
    "      exit 0",
    "    fi",
    "  done",
    "done",
    uri
      ? `nohup env DISPLAY="$DISPLAY" xdg-open ${shellQuote(uri)} >/tmp/rakazo-app.log 2>&1 & exit 0`
      : "exit 1",
  ].join("\n");
}
