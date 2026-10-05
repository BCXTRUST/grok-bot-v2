import type { LbMarket } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  defaultMarketForCountry,
  marketForHost,
  marketKey,
  personaLanguage,
  proxyStickyKey,
  selectMarkets,
} from "./market.js";

const de: LbMarket = {
  country: "DE",
  language: "de",
  locale: "de-DE",
  timezoneId: "Europe/Berlin",
};
const at: LbMarket = {
  country: "AT",
  language: "de",
  locale: "de-AT",
  timezoneId: "Europe/Vienna",
};
const us: LbMarket = {
  country: "US",
  language: "en",
  locale: "en-US",
  timezoneId: "America/New_York",
};
const markets = [de, at, us];

describe("market helpers", () => {
  it("keys markets by country and language", () => {
    expect(marketKey(de)).toBe("DE:de");
    expect(marketForHost(markets, { country: "US", language: "en" })).toBe(us);
    expect(marketForHost(markets, { country: "US", language: "es" })).toBeNull();
  });

  it("derives the persona language from the primary market unless set", () => {
    expect(personaLanguage({ persona: {}, markets: [us, de] })).toBe("en");
    expect(personaLanguage({ persona: { language: "de" }, markets: [us, de] })).toBe("de");
    expect(() => personaLanguage({ persona: {}, markets: [] })).toThrow(RangeError);
  });

  it("builds one sticky proxy key per persona and country", () => {
    expect(proxyStickyKey("cmabc123", "DE")).toBe("cmabc123:DE");
    expect(proxyStickyKey("cmabc123", "US")).not.toBe(proxyStickyKey("cmabc123", "DE"));
    expect(() => proxyStickyKey("cmabc123", "de")).toThrow(RangeError);
    expect(() => proxyStickyKey("bad id", "DE")).toThrow(RangeError);
    expect(() => proxyStickyKey("", "DE")).toThrow(RangeError);
  });
});

describe("selectMarkets", () => {
  it.each([
    ["primary_only", { "DE:de": 0 }, 5, ["DE"]],
    ["all_markets", { "DE:de": 50 }, 1, ["DE", "AT", "US"]],
    ["primary_first", { "DE:de": 5 }, 5, ["DE"]],
    ["primary_first", { "DE:de": 3, "AT:de": 1 }, 5, ["DE", "AT", "US"]],
    ["primary_first", { "DE:de": 3, "AT:de": 2 }, 5, ["DE", "AT"]],
    ["primary_first", {}, 0, ["DE"]],
  ] as const)("%s with supply %j and need %i", (policy, supply, need, countries) => {
    const chosen = selectMarkets({ markets, policy, supply, need });
    expect(chosen.map((market) => market.country)).toEqual(countries);
  });

  it("derives locale and time zone from a country and keeps them editable inputs", () => {
    expect(defaultMarketForCountry("us")).toEqual({
      country: "US",
      language: "en",
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    expect(defaultMarketForCountry("DE").timezoneId).toBe("Europe/Berlin");
    expect(defaultMarketForCountry("BR").language).toBe("pt-BR");
    expect(defaultMarketForCountry("JP")).toEqual({
      country: "JP",
      language: "en",
      locale: "en",
      timezoneId: "UTC",
    });
    expect(() => defaultMarketForCountry("Germany")).toThrow(RangeError);
  });

  it("rejects empty markets and invalid counts", () => {
    expect(() =>
      selectMarkets({ markets: [], policy: "primary_first", supply: {}, need: 1 }),
    ).toThrow(RangeError);
    expect(() => selectMarkets({ markets, policy: "primary_first", supply: {}, need: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      selectMarkets({ markets, policy: "primary_first", supply: { "DE:de": 1.5 }, need: 1 }),
    ).toThrow(RangeError);
  });
});
