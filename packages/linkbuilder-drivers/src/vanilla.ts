import { commonFields, defineBoard, field, MarkupBoardDriver } from "./markup-driver.js";

/** Canonical Vanilla permalink `/discussion/comment/<id>#Comment_<id>`. */
export function vanillaPermalink(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const id =
    /\/discussion\/comment\/(\d+)/.exec(parsed.pathname)?.[1] ??
    /^#Comment_(\d+)$/.exec(parsed.hash)?.[1];
  if (!id) return null;
  return `${parsed.origin}/discussion/comment/${id}#Comment_${id}`;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const vanillaBoard = defineBoard({
  platform: "vanilla",
  bodyFormat: "markdown",
  allowEmoji: false,
  nofollowDefault: false,
  formClass: "form-register",
  challenge: "recaptcha",
  footprint: /vanilla-forum|\/discussion\/\d+\/|\/entry\/register/i,
  footprintSample:
    '<meta name="generator" content="vanilla-forum"><a href="/discussion/1/membership">discussion</a><a href="/entry/register">register</a>',
  paths: {
    register: "/entry/register",
    login: "/entry/signin",
    profile: "/profile/edit",
    list: "/discussions",
  },
  fields: commonFields({
    username: field("Form_Name", "Name"),
    email: field("Form_Email", "Email"),
    password: field("Form_Password", "Password"),
    confirm: field("Form_PasswordMatch", "PasswordMatch"),
    consent: field("Form_TermsOfService", "TermsOfService"),
    captcha: field("Form_Captcha", "Captcha"),
    body: field("Form_Body", "Body"),
    bio: field("Form_About", "About"),
    signature: field("Form_Signature", "Signature"),
  }),
  routes: {
    index: "/",
    register: "/entry/register",
    login: "/entry/signin",
    activate: "/activate",
    list: "/discussions",
    profile: "/profile/edit",
    captcha: "/captcha.png",
    thread: /^\/discussion\/\d+\/[^/]+\/?$/,
    reply: /^\/post\/comment$/,
    permalink: /^\/discussion\/comment\/\d+/,
  },
  threadHref: "/discussion/1/membership",
  replyHref: "/post/comment",
  permalinkHref: (postId) => `/discussion/comment/${postId}#Comment_${postId}`,
  permalink: vanillaPermalink,
});

export class VanillaDriver extends MarkupBoardDriver {
  constructor() {
    super(vanillaBoard);
  }
}
