import { describe, expect, it, vi } from "vitest";
import waitlistFunction from "../api/waitlist";
import {
  captureWaitlistSignup,
  normalizeWaitlistEmail,
  parseWaitlistBody,
} from "./waitlist";

describe("waitlist", () => {
  it("parses JSON and normalizes email addresses", () => {
    expect(parseWaitlistBody('{"email":" Person@Example.COM "}')).toEqual({
      email: " Person@Example.COM ",
    });
    expect(normalizeWaitlistEmail(" Person@Example.COM ")).toBe("person@example.com");
  });

  it("parses a qualified early-access application", () => {
    expect(
      parseWaitlistBody({
        email: "owner@agency.test",
        name: "Sam Rivera",
        company: "Northline",
        website: "https://northline.test",
        role: "agency",
        volume: "5-15",
        currentSetup: "vendor",
        intent: "call",
        note: "Need to replace a vendor whose DR reports don't move traffic.",
      }),
    ).toEqual({
      email: "owner@agency.test",
      name: "Sam Rivera",
      company: "Northline",
      website: "https://northline.test",
      role: "agency",
      volume: "5-15",
      currentSetup: "vendor",
      intent: "call",
      note: "Need to replace a vendor whose DR reports don't move traffic.",
    });
  });

  it("rejects malformed fields and oversized email addresses", () => {
    expect(normalizeWaitlistEmail("person@example")).toBeNull();
    expect(normalizeWaitlistEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
    expect(parseWaitlistBody({ email: "person@example.com", contactNote: 42 })).toBeNull();
    expect(parseWaitlistBody({ email: "person@example.com", role: "intern" })).toBeNull();
  });

  it("captures a deduplicated person in the marketing analytics project", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      new Response(null, { status: 200 }),
    );
    await expect(
      captureWaitlistSignup(
        {
          email: "person@example.com",
          name: "Sam",
          role: "freelancer",
          intent: "apply",
        },
        { PUBLIC_POSTHOG_KEY: "public-project-token" },
        fetchImpl,
      ),
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(String(url)).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      api_key: "public-project-token",
      event: "early_access_applied",
      properties: {
        $process_person_profile: true,
        $set: {
          email: "person@example.com",
          waitlist_status: "applied",
          application_name: "Sam",
          application_role: "freelancer",
          application_intent: "apply",
        },
        $set_once: { waitlist_source: "autoseo.run" },
      },
    });
    expect(payload.distinct_id).toMatch(/^waitlist:[a-f0-9]{64}$/);
  });

  it("fails closed when the marketing project is not configured", async () => {
    const fetchImpl = vi.fn();
    await expect(
      captureWaitlistSignup({ email: "person@example.com" }, {}, fetchImpl),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized body when content-length is missing", async () => {
    const request = new Request("https://autoseo.run/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: `${"a".repeat(8_192)}@example.com` }),
      headers: { "content-type": "application/json" },
    });

    const response = await waitlistFunction.fetch(request);

    expect(response.status).toBe(400);
  });

  it("silently accepts submissions that fill the bot trap", async () => {
    const request = new Request("https://autoseo.run/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: "person@example.com", contactNote: "filled by a bot" }),
      headers: { "content-type": "application/json" },
    });

    const response = await waitlistFunction.fetch(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
