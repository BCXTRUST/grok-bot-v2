import { commonFields, defineBoard, MarkupBoardDriver } from "./markup-driver.js";

/** Canonical Flarum permalink `/d/<id>-slug/<number>`. */
export function flarumPermalink(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const match = /\/d\/(\d+)-([^/]+)\/(\d+)\/?$/.exec(parsed.pathname);
  if (!match) return null;
  return `${parsed.origin}/d/${match[1]}-${match[2]}/${match[3]}`;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const flarumBoard = defineBoard({
  platform: "flarum",
  bodyFormat: "markdown",
  allowEmoji: true,
  nofollowDefault: false,
  formClass: "Form",
  challenge: "none",
  footprint: /id=["']flarum["']|\/d\/\d+-[a-z0-9-]+/i,
  footprintSample: '<div id="flarum"></div><a href="/d/1-membership">discussion</a>',
  paths: { register: "/register", login: "/login", profile: "/settings", list: "/" },
  fields: commonFields(),
  routes: {
    index: "/all",
    register: "/register",
    login: "/login",
    activate: "/activate",
    list: "/",
    profile: "/settings",
    captcha: "/captcha.png",
    thread: /^\/d\/\d+-[a-z0-9-]+\/?$/,
    reply: /^\/d\/\d+-[a-z0-9-]+\/reply$/,
    permalink: /^\/d\/\d+-[a-z0-9-]+\/\d+\/?$/,
  },
  threadHref: "/d/1-membership",
  replyHref: "/d/1-membership/reply",
  permalinkHref: (_postId, postNumber) => `/d/1-membership/${postNumber}`,
  permalink: flarumPermalink,
});

export class FlarumDriver extends MarkupBoardDriver {
  constructor() {
    super(flarumBoard);
  }
}
