import { commonFields, defineBoard, field, MarkupBoardDriver } from "./markup-driver.js";

/**
 * Posts a TL0 account must make before a link. Discourse blocks links until trust level 1.
 * TL1 is a reading gate in core, not a post count, so this driver still refuses a link on the
 * first post.
 */
export const DISCOURSE_MIN_POSTS_BEFORE_LINK = 1;

/** Canonical Discourse permalink `/t/slug/<id>/<postNumber>`. */
export function discoursePermalink(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const match = /\/t\/([^/]+)\/(\d+)\/(\d+)\/?$/.exec(parsed.pathname);
  if (!match) return null;
  return `${parsed.origin}/t/${match[1]}/${match[2]}/${match[3]}`;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const discourseBoard = defineBoard({
  platform: "discourse",
  bodyFormat: "markdown",
  allowEmoji: true,
  nofollowDefault: true,
  minPostsBeforeLink: DISCOURSE_MIN_POSTS_BEFORE_LINK,
  formClass: "create-account",
  challenge: "hcaptcha",
  footprint: /data-discourse|\/t\/[^/"'\s]+\/\d+/i,
  footprintSample:
    '<meta name="generator" content="Discourse" data-discourse="1"><a href="/t/membership/1">topic</a>',
  paths: {
    register: "/signup",
    login: "/login",
    profile: "/my/preferences/profile",
    list: "/latest",
  },
  fields: commonFields({
    username: field("new-account-username", "username"),
    email: field("new-account-email", "email"),
    password: field("new-account-password", "password"),
    confirm: field("new-account-password-confirmation", "password_confirmation"),
    consent: field("terms"),
    body: field("wmd-input", "raw"),
  }),
  routes: {
    index: "/",
    register: "/signup",
    login: "/login",
    activate: "/activate",
    list: "/latest",
    profile: "/my/preferences/profile",
    captcha: "/captcha.png",
    json: "/t/membership/1.json",
    thread: /^\/t\/[^/]+\/\d+\/?$/,
    reply: /^\/t\/[^/]+\/\d+\/reply$/,
    permalink: /^\/t\/[^/]+\/\d+\/\d+\/?$/,
  },
  threadHref: "/t/membership/1",
  replyHref: "/t/membership/1/reply",
  permalinkHref: (_postId, postNumber) => `/t/membership/1/${postNumber}`,
  permalink: discoursePermalink,
});

export class DiscourseDriver extends MarkupBoardDriver {
  constructor() {
    super(discourseBoard);
  }
}
