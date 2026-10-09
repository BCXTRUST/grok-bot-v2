import { createServer, type IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import type { FormFieldInfo } from "@rakazo/adapter-kit";
import { UnmappedFormError } from "./driver.js";
import {
  arrangeSortableCaptcha,
  GenericFormDriver,
  planRegistration,
  registrationProfile,
} from "./generic.js";
import { startCustomForumFixture } from "./testing/custom-forum-fixture.js";
import { HtmlBrowserSession } from "./testing/html-session.js";

describe("generic form driver", () => {
  it("maps a labelled form and refuses an ambiguous one", async () => {
    const fixture = await startCustomForumFixture();
    const driver = new GenericFormDriver();
    const session = new HtmlBrowserSession();
    try {
      expect(driver.detect()).toBe(false);
      expect(await driver.openRegistration(session, fixture.origin)).toBe("form");
      await driver.fillRegistration(session, {
        username: "mira_sol42",
        email: "mira@inbox.example",
        password: "Fx-Pass-Word-77",
      });
      expect((await driver.submitRegistration(session)).kind).toBe("pending_email");
      expect(
        await driver.login(session, fixture.origin, {
          username: "mira_sol42",
          password: "Fx-Pass-Word-77",
        }),
      ).toBe(true);
      expect(
        await driver.setProfile(session, fixture.origin, {
          bio: "Mira Sol",
          signature: "https://tips.example/guide",
          includeSignature: false,
        }),
      ).toBe(true);
      expect(fixture.profile()).toEqual({ bio: "Mira Sol", signature: "" });
      const threads = await driver.listThreads(session, fixture.origin);
      expect(threads[0]?.openQuestion).toBe(true);
      expect((await driver.probePageLinkRule(session)).relDefault).toBe("ugc");
      expect(driver.probeLinkRule(await session.pageText())).toMatchObject({
        hrefForNewMembers: "after_n_posts",
        minPosts: 2,
      });
      expect(await driver.openReply(session, threads[0]!)).toBe(true);
      await driver.fillReply(
        session,
        "A shared list is easier for the committee than a spreadsheet.",
      );
      const reply = await driver.submitReply(session);
      expect(reply.kind).toBe("posted");
      if (reply.kind === "posted") expect(reply.permalink).toContain("/thread/1#post1");

      await session.goto(`${fixture.origin}/register?case=odd`);
      expect(await driver.mapOpenRegistration(session)).toBe("unmapped");
      await expect(
        driver.openReply(session, { url: `${fixture.origin}/thread/2`, title: "Odd" }),
      ).rejects.toBeInstanceOf(UnmappedFormError);
    } finally {
      await fixture.close();
    }
  });

  it("maps a XenForo register form and ignores the username decoy", () => {
    const plan = planRegistration(
      [
        field({ selector: "[name='username']", name: "username", label: "Benutzername" }),
        field({
          selector: "#real-user",
          name: "hasheduser",
          label: "Benutzername",
          autocomplete: "username",
          required: true,
        }),
        field({
          selector: "#email",
          name: "hashedmail",
          type: "email",
          label: "E-Mail",
          autocomplete: "email",
          required: true,
        }),
        field({
          selector: "#password",
          name: "hashedpass",
          type: "password",
          label: "Passwort",
          autocomplete: "new-password",
          required: true,
        }),
        field({
          selector: "#accept",
          name: "accept",
          type: "checkbox",
          label: "Nutzungsbedingungen",
          value: "1",
          required: true,
        }),
        field({ selector: "[name='dob_day']", name: "dob_day", label: "" }),
        field({
          selector: "#version",
          tag: "select",
          name: "custom_fields[xf_version][]",
          label: "XF Version",
        }),
        field({ selector: "#submit", tag: "button", type: "submit", label: "Registrieren" }),
      ],
      registrationProfile({
        username: "sophie_braun95",
        email: "sophie@inbox.example",
        password: "Fx-Pass-Word-77",
      }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.actions.map((action) => action.selector)).toEqual([
      "#real-user",
      "#email",
      "#password",
      "#accept",
    ]);
  });

  it("moves decoys out of the phpBB property list before submit", async () => {
    const board = await startSortableQuestionBoard();
    const session = new HtmlBrowserSession();
    try {
      await session.goto(board.origin);
      await arrangeSortableCaptcha(session);
      const html = session.html();
      const matching = html.slice(html.indexOf('id="sortable1"'), html.indexOf('id="sortable2"'));
      const other = html.slice(html.indexOf('id="sortable2"'));
      expect(matching).toContain("Deutschsprachig");
      expect(matching).toContain("phpBB-Download");
      expect(matching).not.toContain("Dating Website");
      expect(other).toContain("Dating Website");
      expect(other).toContain("Crypto Währung");
    } finally {
      await board.close();
    }
  });

  it("clicks the header register link and only then reads the form", async () => {
    const board = await startHeaderRegisterLinkBoard();
    const driver = new GenericFormDriver();
    const session = new HtmlBrowserSession();
    try {
      expect(await driver.openRegistration(session, board.origin)).toBe("form");
      expect(await session.url()).toContain("/mitglied");
      expect(board.sawHome).toBe(true);
    } finally {
      await board.close();
    }
  });

  it("passes a German terms gate that sits behind the search form", async () => {
    const board = await startSearchThenAgreementBoard();
    const driver = new GenericFormDriver();
    const session = new HtmlBrowserSession();
    try {
      expect(await driver.openRegistration(session, board.origin)).toBe("form");
      await driver.fillRegistration(session, {
        username: "sophie_braun95",
        email: "sophie@inbox.example",
        password: "Fx-Pass-Word-77",
      });
      expect((await driver.submitRegistration(session)).kind).toBe("pending_email");
      expect(board.acceptedTerms).toBe(true);
      expect(board.registeredAs).toBe("sophie_braun95");
    } finally {
      await board.close();
    }
  });
});

function startSortableQuestionBoard(): Promise<{ origin: string; close: () => Promise<void> }> {
  const page = `<!DOCTYPE html><html><body>
<p>Welche Eigenschaften passen zu www.phpBB.de?</p>
<p>Zieh die richtigen Optionen in die korrekte Liste.</p>
<h3>Passen zu phpBB.de</h3>
<ul id="sortable1">
  <li>Deutschsprachig</li>
  <li>Dating Website</li>
  <li>Deutsche Übersetzung</li>
  <li>Supportforum</li>
  <li>phpBB-Download</li>
  <li>Crypto Währung</li>
</ul>
<h3>Passen NICHT zu phpBB.de</h3>
<ul id="sortable2"></ul>
</body></html>`;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}/`,
        close: () =>
          new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}

function startHeaderRegisterLinkBoard(): Promise<{
  origin: string;
  sawHome: boolean;
  close: () => Promise<void>;
}> {
  let sawHome = false;
  const home = `<!DOCTYPE html><html><body>
<header><nav><a href="/mitglied">Registrieren</a><a href="/login">Anmelden</a></nav></header>
<form id="search" action="/search" method="get"><input type="text" name="keywords" aria-label="Search"><input type="submit" value="Suche"></form>
</body></html>`;
  const form = `<!DOCTYPE html><html><body>
<form id="register" method="post" action="/mitglied">
<label for="username">Benutzername</label><input id="username" name="username" type="text">
<label for="email">E-Mail-Adresse</label><input id="email" name="email" type="email">
<label for="new_password">Passwort</label><input id="new_password" name="new_password" type="password">
<input type="submit" name="go" value="Registrieren">
</form>
</body></html>`;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = url.pathname === "/mitglied" ? form : home;
    if (url.pathname === "/") sawHome = true;
    response.writeHead(200, { "content-type": "text/html" });
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        get sawHome() {
          return sawHome;
        },
        close: () =>
          new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}

function field(partial: Partial<FormFieldInfo> & Pick<FormFieldInfo, "selector">): FormFieldInfo {
  return {
    tag: "input",
    type: "text",
    name: null,
    id: null,
    autocomplete: null,
    label: "",
    role: null,
    required: false,
    ...partial,
  };
}

function page(title: string, content: string): string {
  return `<!DOCTYPE html><html><body><h1>${title}</h1>${content}</body></html>`;
}

function startSearchThenAgreementBoard(): Promise<{
  origin: string;
  acceptedTerms: boolean;
  registeredAs: string | null;
  close: () => Promise<void>;
}> {
  let acceptedTerms = false;
  let registeredAs: string | null = null;
  const search = `<form id="search" action="/search" method="get"><input type="text" name="keywords" aria-label="Search"><input type="submit" value="Search"></form>`;
  const agreement = `<form id="agreement" method="post" action="/ucp.php?mode=register">
<p>Bitte lies die Bedingungen. Der Aktivierungsschlüssel wird per E-Mail geschickt.</p>
<input type="submit" name="terms_yes" value="Ich bin mit diesen Bedingungen einverstanden">
<input type="submit" name="terms_no" value="Ich bin mit diesen Bedingungen nicht einverstanden">
</form>`;
  const registration = `<form id="register" method="post" action="/ucp.php?mode=register">
<label for="username">Benutzername</label><input id="username" name="username" type="text">
<label for="email">E-Mail-Adresse</label><input id="email" name="email" type="email">
<label for="new_password">Passwort</label><input id="new_password" name="new_password" type="password">
<label for="password_confirm">Passwort bestätigen</label><input id="password_confirm" name="password_confirm" type="password">
<input type="submit" name="preview" value="Vorschau">
<input type="submit" name="go" value="Registrieren">
</form>`;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/ucp.php") {
      const body = await readBody(request);
      const form = new URLSearchParams(body);
      if (form.has("terms_yes")) acceptedTerms = true;
      if (form.get("go") === "Registrieren") {
        registeredAs = form.get("username");
        response.writeHead(200, { "content-type": "text/html" });
        response.end(
          page(
            "Information",
            `<div id="message"><p>An activation key has been sent to the email address you provided.</p></div>`,
          ),
        );
        return;
      }
    }
    const content = acceptedTerms ? `${search}${registration}` : `${search}${agreement}`;
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page("Register", content));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        get acceptedTerms() {
          return acceptedTerms;
        },
        get registeredAs() {
          return registeredAs;
        },
        close: () =>
          new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
