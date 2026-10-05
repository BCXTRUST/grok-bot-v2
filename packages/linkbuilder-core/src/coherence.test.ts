import { describe, expect, it } from "vitest";
import {
  acceptLanguageFor,
  assertSessionCoherence,
  CoherenceRefused,
  MARKET_COHERENCE,
} from "./coherence.js";

const COUNTRIES = ["DE", "AT", "CH", "US", "GB", "FR", "ES", "IT", "NL", "PL", "SE", "BR"] as const;

function sessionFor(country: (typeof COUNTRIES)[number]) {
  const profile = MARKET_COHERENCE[country];
  const locale = profile.locales[0]!;
  return {
    proxyCountry: country,
    locale,
    timezoneId: profile.timezones[0]!,
    acceptLanguage: acceptLanguageFor(locale),
    geolocation: false as const,
  };
}

describe("session coherence", () => {
  it("accepts every listed market with its default locale and time zone", () => {
    const zones = new Set(Intl.supportedValuesOf("timeZone"));
    for (const country of COUNTRIES) {
      expect(() => assertSessionCoherence(country, sessionFor(country))).not.toThrow();
      for (const zone of MARKET_COHERENCE[country].timezones) expect(zones.has(zone)).toBe(true);
    }
  });

  it("accepts Swiss French and a US west-coast zone", () => {
    expect(() =>
      assertSessionCoherence("CH", {
        proxyCountry: "CH",
        locale: "fr-CH",
        timezoneId: "Europe/Zurich",
        acceptLanguage: acceptLanguageFor("fr-CH"),
      }),
    ).not.toThrow();
    expect(() =>
      assertSessionCoherence("US", {
        proxyCountry: "US",
        locale: "en-US",
        timezoneId: "America/Los_Angeles",
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).not.toThrow();
  });

  it("refuses a locale, time zone, proxy country or Accept-Language that disagrees", () => {
    expect(() => assertSessionCoherence("DE", { ...sessionFor("DE"), locale: "de-AT" })).toThrow(
      CoherenceRefused,
    );
    expect(() =>
      assertSessionCoherence("DE", { ...sessionFor("DE"), timezoneId: "Europe/Vienna" }),
    ).toThrow(CoherenceRefused);
    expect(() => assertSessionCoherence("DE", { ...sessionFor("DE"), proxyCountry: "AT" })).toThrow(
      CoherenceRefused,
    );
    expect(() =>
      assertSessionCoherence("DE", { ...sessionFor("DE"), acceptLanguage: "en-US,en;q=0.9" }),
    ).toThrow(CoherenceRefused);
  });

  it("refuses geolocation", () => {
    expect(() => assertSessionCoherence("DE", { ...sessionFor("DE"), geolocation: true })).toThrow(
      /geolocation/,
    );
  });

  it("uses Intl for a country outside the table", () => {
    expect(() =>
      assertSessionCoherence("JP", {
        proxyCountry: "JP",
        locale: "ja-JP",
        timezoneId: "Asia/Tokyo",
        acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.5",
      }),
    ).not.toThrow();
    expect(() =>
      assertSessionCoherence("JP", {
        proxyCountry: "JP",
        locale: "en",
        timezoneId: "UTC",
        acceptLanguage: "en",
      }),
    ).not.toThrow();
    expect(() =>
      assertSessionCoherence("JP", {
        proxyCountry: "JP",
        locale: "de-DE",
        timezoneId: "Asia/Tokyo",
        acceptLanguage: acceptLanguageFor("de-DE"),
      }),
    ).toThrow(CoherenceRefused);
    expect(() =>
      assertSessionCoherence("JP", {
        proxyCountry: "JP",
        locale: "ja-JP",
        timezoneId: "Not/AZone",
        acceptLanguage: "ja-JP",
      }),
    ).toThrow(CoherenceRefused);
  });
});
