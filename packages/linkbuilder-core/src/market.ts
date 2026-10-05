import { LB_DEFAULT_MARKET, type LbMarket, type LbMarketPolicy } from "@rakazo/contracts";
import { assertCount } from "./errors.js";

/**
 * Country defaults for the project wizard. Locale and time zone stay editable after they
 * are filled in; unknown countries fall back to English with no region and UTC.
 */
export const LB_COUNTRY_DEFAULTS = {
  DE: { language: "de", locale: "de-DE", timezoneId: "Europe/Berlin" },
  AT: { language: "de", locale: "de-AT", timezoneId: "Europe/Vienna" },
  CH: { language: "de", locale: "de-CH", timezoneId: "Europe/Zurich" },
  US: { language: "en", locale: "en-US", timezoneId: "America/New_York" },
  GB: { language: "en", locale: "en-GB", timezoneId: "Europe/London" },
  FR: { language: "fr", locale: "fr-FR", timezoneId: "Europe/Paris" },
  ES: { language: "es", locale: "es-ES", timezoneId: "Europe/Madrid" },
  IT: { language: "it", locale: "it-IT", timezoneId: "Europe/Rome" },
  NL: { language: "nl", locale: "nl-NL", timezoneId: "Europe/Amsterdam" },
  PL: { language: "pl", locale: "pl-PL", timezoneId: "Europe/Warsaw" },
  SE: { language: "sv", locale: "sv-SE", timezoneId: "Europe/Stockholm" },
  BR: { language: "pt-BR", locale: "pt-BR", timezoneId: "America/Sao_Paulo" },
} as const satisfies Record<string, Omit<LbMarket, "country">>;

export const LB_WIZARD_COUNTRIES = Object.keys(LB_COUNTRY_DEFAULTS);

/** Derives a market from an ISO country code. Locale and time zone remain editable. */
export function defaultMarketForCountry(country: string): LbMarket {
  const code = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new RangeError("Expected ISO 3166-1 alpha-2");
  const known = LB_COUNTRY_DEFAULTS[code as keyof typeof LB_COUNTRY_DEFAULTS];
  if (!known) return { country: code, language: "en", locale: "en", timezoneId: "UTC" };
  return { country: code, ...known };
}

export function defaultProjectMarket(): LbMarket {
  return { ...LB_DEFAULT_MARKET };
}

export type MarketRef = Pick<LbMarket, "country" | "language">;

export function marketKey(market: MarketRef): string {
  return `${market.country}:${market.language}`;
}

function primary(markets: readonly LbMarket[]): LbMarket {
  const first = markets[0];
  if (!first) throw new RangeError("A project needs at least one market");
  return first;
}

export function personaLanguage(config: {
  persona: { language?: string };
  markets: readonly LbMarket[];
}): string {
  return config.persona.language ?? primary(config.markets).language;
}

/** The market a host was discovered in; its locale and time zone drive every session there. */
export function marketForHost(markets: readonly LbMarket[], host: MarketRef): LbMarket | null {
  return markets.find((market) => marketKey(market) === marketKey(host)) ?? null;
}

/** `ProxyProvider.lease` key: one sticky exit IP per persona and country. */
export function proxyStickyKey(projectId: string, country: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(projectId)) throw new RangeError("Invalid project id");
  if (!/^[A-Z]{2}$/.test(country)) throw new RangeError("Expected ISO 3166-1 alpha-2");
  return `${projectId}:${country}`;
}

/**
 * Markets to work today, primary first. `primary_first` adds later markets only while the
 * workable host supply of the markets already chosen is below `need`.
 */
export function selectMarkets(input: {
  markets: readonly LbMarket[];
  policy: LbMarketPolicy;
  /** Workable hosts (qualified + ready) per `marketKey`. */
  supply: Readonly<Record<string, number>>;
  need: number;
}): LbMarket[] {
  const first = primary(input.markets);
  assertCount("need", input.need);
  for (const [key, value] of Object.entries(input.supply)) assertCount(key, value);
  if (input.policy === "primary_only") return [first];
  if (input.policy === "all_markets") return [...input.markets];
  const chosen: LbMarket[] = [];
  let available = 0;
  for (const market of input.markets) {
    chosen.push(market);
    available += input.supply[marketKey(market)] ?? 0;
    if (available >= input.need) break;
  }
  return chosen;
}
