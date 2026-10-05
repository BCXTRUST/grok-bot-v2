import { commonFields, defineBoard, field, MarkupBoardDriver } from "./markup-driver.js";

/** Canonical MyBB permalink `showthread.php?tid=<id>&pid=<id>#pid<id>`. */
export function mybbPermalink(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  if (!/showthread\.php$/i.test(parsed.pathname)) return null;
  const tid = parsed.searchParams.get("tid");
  const pid = parsed.searchParams.get("pid") ?? /^#pid(\d+)$/.exec(parsed.hash)?.[1];
  if (!tid || !pid || !/^\d+$/.test(tid) || !/^\d+$/.test(pid)) return null;
  const dir = parsed.pathname.replace(/[^/]*$/, "");
  return `${parsed.origin}${dir}showthread.php?tid=${tid}&pid=${pid}#pid${pid}`;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const mybbBoard = defineBoard({
  platform: "mybb",
  bodyFormat: "bbcode",
  allowEmoji: false,
  nofollowDefault: false,
  formClass: "wrapper",
  challenge: "image",
  footprint: /showthread\.php\?tid=/i,
  footprintSample: '<a href="/showthread.php?tid=1">thread</a>',
  paths: {
    register: "/member.php?action=register",
    login: "/member.php?action=login",
    profile: "/usercp.php?action=profile",
    list: "/forumdisplay.php?fid=2",
  },
  fields: commonFields({
    confirm: field("password2"),
    captcha: field("imagestring"),
  }),
  routes: {
    index: "/",
    register: "/member.php?action=register",
    login: "/member.php?action=login",
    activate: "/activate",
    list: "/forumdisplay.php?fid=2",
    profile: "/usercp.php?action=profile",
    captcha: "/captcha.png",
    thread: /^\/showthread\.php\?tid=\d+$/,
    reply: /^\/newreply\.php/,
    permalink: /^\/showthread\.php\?.*\bpid=\d+/,
  },
  threadHref: "/showthread.php?tid=1",
  replyHref: "/newreply.php?tid=1",
  permalinkHref: (postId) => `/showthread.php?tid=1&pid=${postId}#pid${postId}`,
  permalink: mybbPermalink,
  postElementId: (postId) => `pid${postId}`,
});

export class MybbDriver extends MarkupBoardDriver {
  constructor() {
    super(mybbBoard);
  }
}
