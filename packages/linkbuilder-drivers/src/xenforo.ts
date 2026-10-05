import { commonFields, defineBoard, MarkupBoardDriver } from "./markup-driver.js";

/** Canonical XenForo permalink `/threads/slug.<id>/post-<id>`. */
export function xenforoPermalink(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const match = /\/threads\/([^/]+)\.(\d+)\/post-(\d+)/.exec(parsed.pathname);
  if (!match) return null;
  return `${parsed.origin}/threads/${match[1]}.${match[2]}/post-${match[3]}`;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const xenforoBoard = defineBoard({
  platform: "xenforo",
  bodyFormat: "bbcode",
  allowEmoji: false,
  nofollowDefault: false,
  formClass: "block-body",
  challenge: "recaptcha",
  footprint: /data-xf-init|\/threads\/[^/"'\s]+\.\d+/i,
  footprintSample: '<div data-xf-init="page"></div><a href="/threads/membership.1/">thread</a>',
  paths: { register: "/register/", login: "/login/", profile: "/account/", list: "/forums/" },
  fields: commonFields(),
  routes: {
    index: "/",
    register: "/register/",
    login: "/login/",
    activate: "/activate",
    list: "/forums/",
    profile: "/account/",
    captcha: "/captcha.png",
    thread: /^\/threads\/[^/]+\.\d+\/?$/,
    reply: /^\/threads\/[^/]+\.\d+\/add-reply$/,
    permalink: /^\/threads\/[^/]+\.\d+\/post-\d+\/?$/,
  },
  threadHref: "/threads/membership.1/",
  replyHref: "/threads/membership.1/add-reply",
  permalinkHref: (postId) => `/threads/membership.1/post-${postId}`,
  permalink: xenforoPermalink,
});

export class XenforoDriver extends MarkupBoardDriver {
  constructor() {
    super(xenforoBoard);
  }
}
