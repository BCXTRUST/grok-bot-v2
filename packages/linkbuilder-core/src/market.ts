import type { LbMarket, LbMarketPolicy } from "@rakazo/contracts";
import { assertCount } from "./errors.js";

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
