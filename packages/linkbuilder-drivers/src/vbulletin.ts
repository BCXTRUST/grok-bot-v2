import { commonFields, defineBoard, field, MarkupBoardDriver } from "./markup-driver.js";

/**
 * Canonical vBulletin permalink. Classic boards use `showthread.php?p=<id>#post<id>`;
 * rewritten boards use `/threads/<id>-slug?p=<id>#post<id>`.
 */
export function vbulletinPermalink(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const post = parsed.searchParams.get("p") ?? /^#post(\d+)$/.exec(parsed.hash)?.[1];
  if (!post || !/^\d+$/.test(post)) return null;
  const pretty = /\/threads\/(\d+)-([^/?#]+)/.exec(parsed.pathname);
  if (pretty) {
    return `${parsed.origin}/threads/${pretty[1]}-${pretty[2]}?p=${post}#post${post}`;
  }
  if (!/showthread\.php$/i.test(parsed.pathname)) return null;
  const dir = parsed.pathname.replace(/[^/]*$/, "");
  return `${parsed.origin}${dir}showthread.php?p=${post}#post${post}`;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const vbulletinBoard = defineBoard({
  platform: "vbulletin",
  bodyFormat: "bbcode",
  allowEmoji: false,
  nofollowDefault: true,
  formClass: "form-register",
  challenge: "image",
  footprint: /showthread\.php\?t=\d+|\/threads\/\d+-/i,
  footprintSample: '<a href="/showthread.php?t=1">thread</a>',
  paths: {
    register: "/register.php",
    login: "/login.php",
    profile: "/profile.php?do=editprofile",
    list: "/forumdisplay.php?f=2",
  },
  fields: commonFields({
    confirm: field("passwordconfirm"),
    captcha: field("imagestamp"),
  }),
  routes: {
    index: "/",
    register: "/register.php",
    login: "/login.php",
    activate: "/activate",
    list: "/forumdisplay.php?f=2",
    profile: "/profile.php?do=editprofile",
    captcha: "/captcha.png",
    thread: /^\/showthread\.php\?t=\d+$/,
    reply: /^\/newreply\.php/,
    permalink: /^\/showthread\.php\?p=\d+/,
  },
  threadHref: "/showthread.php?t=1",
  replyHref: "/newreply.php?t=1",
  permalinkHref: (postId) => `/showthread.php?p=${postId}#post${postId}`,
  permalink: vbulletinPermalink,
});

export class VbulletinDriver extends MarkupBoardDriver {
  constructor() {
    super(vbulletinBoard);
  }
}
