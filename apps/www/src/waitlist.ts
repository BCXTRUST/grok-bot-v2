import { createHash } from "node:crypto";

const MAX_EMAIL_LENGTH = 254;
const MAX_TEXT_LENGTH = 500;
const MAX_NOTE_LENGTH = 2_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAPTURE_TIMEOUT_MS = 5_000;

const ROLES = ["agency", "freelancer", "in-house", "other"] as const;
const VOLUMES = ["under-5", "5-15", "16-40", "40-plus"] as const;
const SETUPS = ["vendor", "hire", "myself", "marketplace", "mix"] as const;
const INTENTS = ["apply", "call"] as const;

export type ApplicationRole = (typeof ROLES)[number];
export type ApplicationVolume = (typeof VOLUMES)[number];
export type ApplicationSetup = (typeof SETUPS)[number];
export type ApplicationIntent = (typeof INTENTS)[number];

export type WaitlistBody = {
  email: string;
  name?: string;
  company?: string;
  website?: string;
  role?: string;
  volume?: string;
  currentSetup?: string;
  intent?: string;
  note?: string;
  contactNote?: string;
};

type CaptureEnv = {
  PUBLIC_POSTHOG_HOST?: string;
  PUBLIC_POSTHOG_KEY?: string;
};

function optionalString(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > max) return null;
  return trimmed;
}

function optionalEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined | null {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") return null;
  return allowed.includes(value) ? value : null;
}

export function parseWaitlistBody(value: unknown): WaitlistBody | null {
  if (typeof value === "string") {
    try {
      return parseWaitlistBody(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.email !== "string") return null;

  const name = optionalString(body.name, MAX_TEXT_LENGTH);
  const company = optionalString(body.company, MAX_TEXT_LENGTH);
  const website = optionalString(body.website, MAX_TEXT_LENGTH);
  const note = optionalString(body.note, MAX_NOTE_LENGTH);
  const contactNote = optionalString(body.contactNote, MAX_TEXT_LENGTH);
  const role = optionalEnum(body.role, ROLES);
  const volume = optionalEnum(body.volume, VOLUMES);
  const currentSetup = optionalEnum(body.currentSetup, SETUPS);
  const intent = optionalEnum(body.intent, INTENTS);

  if (
    name === null ||
    company === null ||
    website === null ||
    note === null ||
    contactNote === null ||
    role === null ||
    volume === null ||
    currentSetup === null ||
    intent === null
  ) {
    return null;
  }

  return {
    email: body.email,
    ...(name ? { name } : {}),
    ...(company ? { company } : {}),
    ...(website ? { website } : {}),
    ...(role ? { role } : {}),
    ...(volume ? { volume } : {}),
    ...(currentSetup ? { currentSetup } : {}),
    ...(intent ? { intent } : {}),
    ...(note ? { note } : {}),
    ...(contactNote ? { contactNote } : {}),
  };
}

export function normalizeWaitlistEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export async function captureWaitlistSignup(
  application: WaitlistBody & { email: string },
  env: CaptureEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const apiKey = env.PUBLIC_POSTHOG_KEY?.trim();
  if (!apiKey) return false;

  const host = env.PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
  const joinedAt = new Date().toISOString();
  const email = application.email;
  const distinctId = `waitlist:${createHash("sha256").update(email).digest("hex")}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(new URL("/i/v0/e/", host), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: "early_access_applied",
        distinct_id: distinctId,
        properties: {
          $process_person_profile: true,
          $set: {
            email,
            waitlist_status: "applied",
            application_name: application.name,
            application_company: application.company,
            application_website: application.website,
            application_role: application.role,
            application_volume: application.volume,
            application_setup: application.currentSetup,
            application_intent: application.intent,
          },
          $set_once: {
            waitlist_joined_at: joinedAt,
            waitlist_source: "autoseo.run",
          },
          note: application.note,
        },
        timestamp: joinedAt,
      }),
      signal: controller.signal,
    });

    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}
