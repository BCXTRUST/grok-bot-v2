import { builtinModels } from "@earendil-works/pi-ai/providers/all";

export type PiCatalogAuth = "api-key" | "oauth" | "both";

export type PiCatalogEntry = {
  provider: string;
  providerName: string;
  id: string;
  label: string;
  billing: string;
  auth: PiCatalogAuth;
  oauthLabel?: string;
  subscription: boolean;
};

export function listPiCatalog(): PiCatalogEntry[] {
  cachedCatalog ??= buildPiCatalog();
  return cachedCatalog;
}

let cachedCatalog: PiCatalogEntry[] | undefined;

function buildPiCatalog(): PiCatalogEntry[] {
  const models = builtinModels();
  const entries: PiCatalogEntry[] = [];
  for (const provider of models.getProviders()) {
    const apiKey = Boolean(provider.auth.apiKey);
    const oauth = Boolean(provider.auth.oauth);
    const auth: PiCatalogAuth = apiKey && oauth ? "both" : oauth ? "oauth" : "api-key";
    const oauthLabel = provider.auth.oauth?.loginLabel ?? provider.auth.oauth?.name;
    const subscription = Boolean(provider.auth.oauth?.isSubscription);
    const billing = catalogBilling(provider.name, { apiKey, oauth, oauthLabel, subscription });
    for (const model of provider.getModels()) {
      entries.push({
        provider: provider.id,
        providerName: provider.name,
        id: model.id,
        label: model.name || model.id,
        billing,
        auth,
        oauthLabel,
        subscription,
      });
    }
  }
  return entries;
}

function catalogBilling(
  name: string,
  opts: { apiKey: boolean; oauth: boolean; oauthLabel?: string; subscription: boolean },
) {
  if (opts.subscription) {
    return `Uses a ${name} subscription when you sign in. Rakazo does not pay.`;
  }
  if (opts.oauth && !opts.apiKey) {
    return `Sign in with ${opts.oauthLabel ?? name}. Rakazo does not pay.`;
  }
  if (opts.oauth && opts.apiKey) {
    return `API key or ${opts.oauthLabel ?? `${name} sign-in`}. Rakazo does not pay.`;
  }
  return `Uses your ${name} key. Rakazo does not pay for model usage.`;
}

export const scriptedCatalogEntry: PiCatalogEntry = {
  provider: "scripted",
  providerName: "Scripted",
  id: "scripted",
  label: "Scripted runtime (local verification)",
  billing: "No model charges. Deterministic fixture for tests.",
  auth: "api-key",
  subscription: false,
};
