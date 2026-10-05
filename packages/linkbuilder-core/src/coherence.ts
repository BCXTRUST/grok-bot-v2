/**
 * Locale coherence for a persona session (plan section 8). The host's country decides the
 * allowed locale, time zone and Accept-Language. Geolocation stays off. A mismatch refuses
 * the session before the browser opens.
 */

export class CoherenceRefused extends Error {
  readonly code = "coherence_refused" as const;
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`coherence_refused: ${issues.join("; ")}`);
    this.name = "CoherenceRefused";
    this.issues = issues;
  }
}

interface MarketProfile {
  locales: readonly string[];
  timezones: readonly string[];
  languages: readonly string[];
}

/** Countries the product opens first. Anything else falls back to Intl. */
export const MARKET_COHERENCE = {
  DE: {
    locales: ["de-DE"],
    timezones: ["Europe/Berlin"],
    languages: ["de"],
  },
  AT: {
    locales: ["de-AT"],
    timezones: ["Europe/Vienna"],
    languages: ["de"],
  },
  CH: {
    locales: ["de-CH", "fr-CH", "it-CH"],
    timezones: ["Europe/Zurich"],
    languages: ["de", "fr", "it"],
  },
  US: {
    locales: ["en-US"],
    timezones: [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Phoenix",
      "America/Anchorage",
      "Pacific/Honolulu",
    ],
    languages: ["en"],
  },
  GB: {
    locales: ["en-GB"],
    timezones: ["Europe/London"],
    languages: ["en"],
  },
  FR: {
    locales: ["fr-FR"],
    timezones: ["Europe/Paris"],
    languages: ["fr"],
  },
  ES: {
    locales: ["es-ES"],
    timezones: ["Europe/Madrid", "Atlantic/Canary"],
    languages: ["es"],
  },
  IT: {
    locales: ["it-IT"],
    timezones: ["Europe/Rome"],
    languages: ["it"],
  },
  NL: {
    locales: ["nl-NL"],
    timezones: ["Europe/Amsterdam"],
    languages: ["nl"],
  },
  PL: {
    locales: ["pl-PL"],
    timezones: ["Europe/Warsaw"],
    languages: ["pl"],
  },
  SE: {
    locales: ["sv-SE"],
    timezones: ["Europe/Stockholm"],
    languages: ["sv"],
  },
  BR: {
    locales: ["pt-BR"],
    timezones: [
      "America/Sao_Paulo",
      "America/Manaus",
      "America/Fortaleza",
      "America/Recife",
      "America/Belem",
      "America/Cuiaba",
      "America/Porto_Velho",
      "America/Boa_Vista",
      "America/Rio_Branco",
      "America/Noronha",
    ],
    languages: ["pt"],
  },
} as const satisfies Record<string, MarketProfile>;

export interface SessionCoherence {
  proxyCountry: string;
  locale: string;
  timezoneId: string;
  acceptLanguage: string;
  /** Must stay off. `true` is a mismatch. */
  geolocation?: boolean;
}

/** Header the browser sends. The locale comes first; English is only a low-q fallback. */
export function acceptLanguageFor(locale: string): string {
  const language = locale.split("-")[0] ?? locale;
  if (language.toLowerCase() === "en") return locale;
  if (language === locale) return `${locale},en;q=0.5`;
  return `${locale},${language};q=0.9,en;q=0.5`;
}

function localeLanguage(locale: string): string {
  return (locale.split("-")[0] ?? locale).toLowerCase();
}

function localeRegion(locale: string): string | undefined {
  try {
    return new Intl.Locale(locale).region?.toUpperCase();
  } catch {
    return undefined;
  }
}

function knownTimeZones(): Set<string> {
  return new Set(Intl.supportedValuesOf("timeZone"));
}

function intlAllows(country: string, locale: string, timezoneId: string): string[] {
  const issues: string[] = [];
  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(locale)[0];
  } catch {
    canonical = undefined;
  }
  if (canonical !== locale) issues.push(`locale ${locale} is not canonical`);
  const region = localeRegion(locale);
  if (region && region !== country) {
    issues.push(`locale ${locale} is not in ${country}`);
  }
  // `supportedValuesOf("timeZone")` omits UTC on some ICU builds. The wizard uses it.
  if (timezoneId !== "UTC" && !knownTimeZones().has(timezoneId)) {
    issues.push(`timezone ${timezoneId} is not a known zone`);
  }
  return issues;
}

function headerLanguage(acceptLanguage: string): string | undefined {
  const first = acceptLanguage.split(",")[0]?.split(";")[0]?.trim();
  if (!first) return undefined;
  return localeLanguage(first);
}

/**
 * Throws {@link CoherenceRefused} when the session would disagree with the host country.
 * Unknown countries use Intl: a locale region must be that country (a region-less tag is
 * allowed) and the time zone must be a supported IANA id.
 */
export function assertSessionCoherence(country: string, session: SessionCoherence): void {
  const code = country.trim().toUpperCase();
  const issues: string[] = [];
  if (session.geolocation) issues.push("geolocation must be off");
  if (session.proxyCountry.toUpperCase() !== code) {
    issues.push(`proxy country ${session.proxyCountry} is not ${code}`);
  }
  const profile = MARKET_COHERENCE[code as keyof typeof MARKET_COHERENCE];
  if (profile) {
    if (!(profile.locales as readonly string[]).includes(session.locale)) {
      issues.push(`locale ${session.locale} is not allowed for ${code}`);
    }
    if (!(profile.timezones as readonly string[]).includes(session.timezoneId)) {
      issues.push(`timezone ${session.timezoneId} is not allowed for ${code}`);
    }
    const language = headerLanguage(session.acceptLanguage);
    if (!language || !(profile.languages as readonly string[]).includes(language)) {
      issues.push(`accept-language ${session.acceptLanguage} is not allowed for ${code}`);
    }
    if (!session.acceptLanguage.toLowerCase().includes(session.locale.toLowerCase())) {
      issues.push(`accept-language does not include ${session.locale}`);
    }
  } else {
    issues.push(...intlAllows(code, session.locale, session.timezoneId));
    const language = headerLanguage(session.acceptLanguage);
    if (language !== localeLanguage(session.locale)) {
      issues.push(`accept-language ${session.acceptLanguage} does not match ${session.locale}`);
    }
  }
  if (issues.length > 0) throw new CoherenceRefused(issues);
}
