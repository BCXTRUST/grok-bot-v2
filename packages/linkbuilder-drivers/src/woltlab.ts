import { commonFields, defineBoard, field, MarkupBoardDriver } from "./markup-driver.js";

/** Canonical WoltLab permalink `/forum/thread/<id>-slug/?postID=<id>#post<id>`. */
export function woltlabPermalink(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const match = /\/forum\/thread\/(\d+)-([^/?#]+)\/?/.exec(parsed.pathname);
  if (!match) return null;
  const post = parsed.searchParams.get("postID") ?? /^#post(\d+)$/.exec(parsed.hash)?.[1];
  if (!post || !/^\d+$/.test(post)) return null;
  return `${parsed.origin}/forum/thread/${match[1]}-${match[2]}/?postID=${post}#post${post}`;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const woltlabBoard = defineBoard({
  platform: "woltlab",
  bodyFormat: "bbcode",
  allowEmoji: false,
  nofollowDefault: true,
  formClass: "wbbRegister",
  challenge: "turnstile",
  footprint: /data-wsc=|\/wcf\//i,
  footprintSample:
    '<meta name="generator" content="WoltLab Suite" data-wsc="6.1"><a href="/wcf/">WoltLab</a>',
  paths: { register: "/register/", login: "/login/", profile: "/account/", list: "/forum/" },
  fields: commonFields({ confirm: field("passwordConfirm") }),
  routes: {
    index: "/",
    register: "/register/",
    login: "/login/",
    activate: "/activate",
    list: "/forum/",
    profile: "/account/",
    captcha: "/captcha.png",
    thread: /^\/forum\/thread\/\d+-[a-z0-9-]+\/?$/,
    reply: /^\/forum\/thread\/\d+-[a-z0-9-]+\/\?action=reply$/,
    permalink: /postID=\d+/,
  },
  threadHref: "/forum/thread/1-membership/",
  replyHref: "/forum/thread/1-membership/?action=reply",
  permalinkHref: (postId) => `/forum/thread/1-membership/?postID=${postId}#post${postId}`,
  permalink: woltlabPermalink,
});

export class WoltlabDriver extends MarkupBoardDriver {
  constructor() {
    super(woltlabBoard);
  }
}
