import { commonFields, defineBoard, MarkupBoardDriver } from "./markup-driver.js";

/** Canonical Invision permalink `/topic/<id>-slug/#comment-<id>`. */
export function ipsPermalink(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const topic = /\/topic\/(\d+)-([^/?#]+)\/?/.exec(parsed.pathname);
  if (!topic) return null;
  const comment = parsed.searchParams.get("comment") ?? /^#comment-(\d+)$/.exec(parsed.hash)?.[1];
  if (!comment || !/^\d+$/.test(comment)) return null;
  return `${parsed.origin}/topic/${topic[1]}-${topic[2]}/#comment-${comment}`;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const ipsBoard = defineBoard({
  platform: "ips",
  bodyFormat: "bbcode",
  allowEmoji: false,
  nofollowDefault: true,
  formClass: "ipsForm",
  challenge: "ips",
  footprint: /data-ipsCaptcha-key|\/topic\/\d+-/i,
  footprintSample:
    '<div id="ipsLayout" data-ipsCaptcha-key="fixture-site-key"></div><a href="/topic/1-membership/">topic</a>',
  paths: { register: "/register/", login: "/login/", profile: "/profile/", list: "/forums/" },
  fields: commonFields(),
  routes: {
    index: "/",
    register: "/register/",
    login: "/login/",
    activate: "/activate",
    list: "/forums/",
    profile: "/profile/",
    captcha: "/captcha.png",
    thread: /^\/topic\/\d+-[a-z0-9-]+\/?$/,
    reply: /^\/topic\/\d+-[a-z0-9-]+\/\?do=reply$/,
    permalink: /comment-\d+|comment=\d+/,
  },
  threadHref: "/topic/1-membership/",
  replyHref: "/topic/1-membership/?do=reply",
  permalinkHref: (postId) => `/topic/1-membership/#comment-${postId}`,
  permalink: ipsPermalink,
});

export class IpsDriver extends MarkupBoardDriver {
  constructor() {
    super(ipsBoard);
  }
}
