import { commonFields, defineBoard, field, MarkupBoardDriver } from "./markup-driver.js";

/**
 * Canonical NodeBB permalink. `/post/<pid>` when the post id is known, otherwise
 * `/topic/<id>/slug/<index>`.
 */
export function nodebbPermalink(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const post = /\/post\/(\d+)\/?$/.exec(parsed.pathname);
  if (post) return `${parsed.origin}/post/${post[1]}`;
  const topic = /\/topic\/(\d+)\/([^/]+)\/(\d+)\/?$/.exec(parsed.pathname);
  if (!topic) return null;
  return `${parsed.origin}/topic/${topic[1]}/${topic[2]}/${topic[3]}`;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const nodebbBoard = defineBoard({
  platform: "nodebb",
  bodyFormat: "markdown",
  allowEmoji: true,
  nofollowDefault: true,
  formClass: "register",
  challenge: "hcaptcha",
  footprint: /nodebb|\/topic\/\d+\//i,
  footprintSample:
    '<meta name="generator" content="NodeBB"><a href="/topic/1/membership">topic</a>',
  paths: { register: "/register", login: "/login", profile: "/user/me/edit", list: "/recent" },
  fields: commonFields({
    confirm: field("password-confirm"),
    body: field("content", "content"),
  }),
  routes: {
    index: "/",
    register: "/register",
    login: "/login",
    activate: "/activate",
    list: "/recent",
    profile: "/user/me/edit",
    captcha: "/captcha.png",
    thread: /^\/topic\/\d+\/[^/]+\/?$/,
    reply: /^\/topic\/\d+\/[^/]+\/reply$/,
    permalink: /^\/post\/\d+\/?$/,
  },
  threadHref: "/topic/1/membership",
  replyHref: "/topic/1/membership/reply",
  permalinkHref: (postId) => `/post/${postId}`,
  permalink: nodebbPermalink,
});

export class NodebbDriver extends MarkupBoardDriver {
  constructor() {
    super(nodebbBoard);
  }
}
