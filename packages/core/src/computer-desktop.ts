/** Default graphical browsers to try before falling back to xdg-open. */
export const DESKTOP_BROWSER_APPS = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "firefox",
] as const;

const FILE_MANAGER_CLASSES = [
  "Nautilus",
  "org.gnome.Nautilus",
  "Thunar",
  "Pcmanfm",
  "pcmanfm",
  "Caja",
  "Nemo",
  "dolphin",
  "Dolphin",
] as const;

const BROWSER_WINDOW_CLASSES = [
  "google-chrome",
  "Google-chrome",
  "Chromium",
  "chromium",
  "firefox",
  "Firefox",
  "Navigator",
] as const;

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function looksLikeDesktopBrowserApp(application: string): boolean {
  return /chrome|chromium|firefox|browser/i.test(application);
}

function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Open an http(s) URL in a real browser instead of xdg-open (which often raises Files). */
export function openHttpUrlCommand(display: string, url: string): string {
  const quotedUrl = posixShellQuote(url.trim());
  const apps = DESKTOP_BROWSER_APPS.map(posixShellQuote).join(" ");
  return [
    "opened=0",
    `for app in ${apps}; do`,
    '  if command -v "$app" >/dev/null 2>&1; then',
    `    nohup env DISPLAY=${display} "$app" ${quotedUrl} >/tmp/rakazo-browser.log 2>&1 &`,
    "    opened=1",
    "    break",
    "  fi",
    "done",
    `if [ "$opened" = 0 ]; then env DISPLAY=${display} xdg-open ${quotedUrl}; fi`,
  ].join("\n");
}

/** Close overlapping file-manager windows and raise a visible browser. */
export function exposeBrowserDesktopCommand(display: string): string {
  const fileManagers = FILE_MANAGER_CLASSES.map(posixShellQuote).join(" ");
  const browsers = BROWSER_WINDOW_CLASSES.map(posixShellQuote).join(" ");
  return [
    `for class in ${fileManagers}; do`,
    `  DISPLAY=${display} xdotool search --onlyvisible --class "$class" windowquit 2>/dev/null || true`,
    "done",
    `for class in ${browsers}; do`,
    `  id=$(DISPLAY=${display} xdotool search --onlyvisible --class "$class" 2>/dev/null | awk 'NR==1{print; exit}')`,
    `  if [ -n "$id" ]; then`,
    `    DISPLAY=${display} xdotool windowactivate --sync "$id" windowraise "$id" 2>/dev/null || true`,
    "    break",
    "  fi",
    "done",
  ].join("\n");
}

/** Put the URL in the visible browser, even if Chrome is already on another page. */
export function focusBrowserAndOpenUrlCommand(display: string, url: string): string {
  const quotedUrl = posixShellQuote(url.trim());
  const browsers = BROWSER_WINDOW_CLASSES.map(posixShellQuote).join(" ");
  return [
    openHttpUrlCommand(display, url),
    "sleep 0.5",
    exposeBrowserDesktopCommand(display),
    "id=",
    `for class in ${browsers}; do`,
    `  id=$(DISPLAY=${display} xdotool search --onlyvisible --class "$class" 2>/dev/null | awk 'NR==1{print; exit}')`,
    '  if [ -n "$id" ]; then break; fi',
    "done",
    'if [ -n "$id" ]; then',
    `  DISPLAY=${display} xdotool windowactivate --sync "$id"`,
    "  sleep 0.2",
    `  DISPLAY=${display} xdotool key ctrl+l`,
    "  sleep 0.15",
    `  DISPLAY=${display} xdotool type --delay 1 -- ${quotedUrl}`,
    `  DISPLAY=${display} xdotool key Return`,
    "fi",
  ].join("\n");
}

export function openPathDesktopCommand(display: string, pathOrUrl: string): string {
  if (isHttpUrl(pathOrUrl)) {
    return focusBrowserAndOpenUrlCommand(display, pathOrUrl);
  }
  return `DISPLAY=${display} xdg-open ${posixShellQuote(pathOrUrl)}`;
}

export function focusedWindowLabelCommand(display: string): string {
  return [
    `DISPLAY=${display} xdotool getactivewindow getwindowclassname 2>/dev/null || true`,
    `DISPLAY=${display} xdotool getactivewindow getwindowname 2>/dev/null || true`,
  ].join("; ");
}

export function isFileManagerLabel(label: string): boolean {
  return /nautilus|thunar|pcmanfm|nemo|caja|dolphin|\bfiles\b|file manager/i.test(label);
}

export function listVisibleWindowsCommand(display: string): string {
  return [
    `focus=$(DISPLAY=${display} xdotool getwindowfocus 2>/dev/null || true)`,
    `DISPLAY=${display} xdotool search --onlyvisible --name . 2>/dev/null | while read -r id; do`,
    `  name=$(DISPLAY=${display} xdotool getwindowname "$id" 2>/dev/null | tr '\\n' ' ')`,
    `  focused=0`,
    `  [ "$id" = "$focus" ] && focused=1`,
    `  printf '%s\\t%s\\t%s\\n' "$id" "$focused" "$name"`,
    "done",
  ].join("\n");
}

export function parseVisibleWindows(
  stdout: string,
): Array<{ id: string; title?: string; focused?: boolean }> {
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const [id, focused, ...titleParts] = line.split("\t");
      if (!id) return [];
      const title = titleParts.join("\t").trim();
      return [
        {
          id,
          ...(title ? { title } : {}),
          ...(focused === "1" ? { focused: true } : {}),
        },
      ];
    })
    .slice(0, 16);
}

export const COMPUTER_AUTONOMY_INSTRUCTION =
  "Never ask the user to close windows, click the desktop, or tell you how to proceed. Close overlapping file-manager windows yourself, raise the browser, type into the address bar, and keep working until the task is done. Only request_takeover for CAPTCHA, password entry, or payment.";
