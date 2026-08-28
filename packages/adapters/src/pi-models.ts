import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { ModelOAuthSignInMode } from "@rakazo/contracts";
import { OPENROUTER_FEATURED_MODELS, OPENROUTER_PROVIDER_ID } from "@rakazo/contracts";
import { LOCAL_PROVIDER_ID, registerLocalProvider } from "./pi-local-provider.js";
import { SUBSCRIPTION_SIGN_IN_PROVIDERS } from "./pi-oauth.js";
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  registerOpenAiCompatibleCatalog,
} from "./pi-openai-compatible-provider.js";

export type PiCatalogAuth = "api-key" | "oauth" | "both";

export type PiCatalogEntry = {
  provider: string;
  providerName: string;
  id: string;
  label: string;
  billing: string;
  auth: PiCatalogAuth;
  oauthLabel?: string;
  authHint?: string;
  subscription: boolean;
  signIn?: ModelOAuthSignInMode;
};

export function listPiCatalog(): PiCatalogEntry[] {
  cachedCatalog ??= buildPiCatalog();
  return cachedCatalog;
}

let cachedCatalog: PiCatalogEntry[] | undefined;

function buildPiCatalog(): PiCatalogEntry[] {
  const models = registerOpenAiCompatibleCatalog(registerLocalProvider(builtinModels()));
  const entries: PiCatalogEntry[] = [];
  const openRouterBilling = catalogBilling(OPENROUTER_PROVIDER_ID, "OpenRouter", {
    apiKey: true,
    oauth: false,
  });
  for (const featured of OPENROUTER_FEATURED_MODELS) {
    if (models.getModel(OPENROUTER_PROVIDER_ID, featured.id)) continue;
    entries.push({
      provider: OPENROUTER_PROVIDER_ID,
      providerName: "OpenRouter",
      id: featured.id,
      label: featured.label,
      billing: openRouterBilling,
      auth: "api-key",
      subscription: false,
    });
  }
  for (const provider of models.getProviders()) {
    const apiKey = Boolean(provider.auth.apiKey);
    const oauth = Boolean(provider.auth.oauth);
    const auth: PiCatalogAuth = apiKey && oauth ? "both" : oauth ? "oauth" : "api-key";
    const signInMeta = SUBSCRIPTION_SIGN_IN_PROVIDERS[provider.id];
    const oauthLabel =
      signInMeta?.loginLabel ?? provider.auth.oauth?.loginLabel ?? provider.auth.oauth?.name;
    const subscription = Boolean(provider.auth.oauth?.isSubscription);
    const billing = catalogBilling(provider.id, provider.name, {
      apiKey,
      oauth,
    });
    for (const model of provider.getModels()) {
      if (
        provider.id === OPENROUTER_PROVIDER_ID &&
        entries.some((entry) => entry.provider === OPENROUTER_PROVIDER_ID && entry.id === model.id)
      ) {
        continue;
      }
      const featuredLabel =
        provider.id === OPENROUTER_PROVIDER_ID
          ? OPENROUTER_FEATURED_MODELS.find((entry) => entry.id === model.id)?.label
          : undefined;
      entries.push({
        provider: provider.id,
        providerName: provider.name,
        id: model.id,
        label: featuredLabel ?? (model.name || model.id),
        billing,
        auth,
        oauthLabel,
        authHint:
          provider.id === OPENAI_COMPATIBLE_PROVIDER_ID ? "Custom server" : signInMeta?.hint,
        subscription,
        signIn: signInMeta?.mode,
      });
    }
  }

  for (const featured of [...OPENROUTER_FEATURED_MODELS].reverse()) {
    const index = entries.findIndex(
      (entry) => entry.provider === OPENROUTER_PROVIDER_ID && entry.id === featured.id,
    );
    if (index < 0) continue;
    const [item] = entries.splice(index, 1);
    entries.unshift({ ...item, label: featured.label });
  }

  const envDefaultModel = process.env.PI_DEFAULT_MODEL?.trim();
  const envDefaultProvider = process.env.PI_DEFAULT_PROVIDER?.trim() || "openrouter";
  if (
    envDefaultProvider === "openrouter" &&
    envDefaultModel &&
    !models.getModel("openrouter", envDefaultModel)
  ) {
    entries.unshift({
      provider: "openrouter",
      providerName: "OpenRouter",
      id: envDefaultModel,
      label: envDefaultModel,
      billing: `Configured via PI_DEFAULT_MODEL (${envDefaultModel}).`,
      auth: "api-key",
      subscription: false,
    });
  }

  return entries;
}

function catalogBilling(
  providerId: string,
  name: string,
  opts: { apiKey: boolean; oauth: boolean },
) {
  const signInMeta = SUBSCRIPTION_SIGN_IN_PROVIDERS[providerId];
  if (signInMeta) return signInMeta.billing;
  if (providerId === LOCAL_PROVIDER_ID) {
    return "Runs on infrastructure configured by the deployment owner. No model charges from Rakazo.";
  }
  if (providerId === OPENAI_COMPATIBLE_PROVIDER_ID) {
    return "Runs on a URL you control. Rakazo does not pay for model usage.";
  }
  if (opts.oauth && !opts.apiKey) {
    return `${name} subscription login is not in the Rakazo UI yet. Skip if this deployment already has credentials.`;
  }
  if (opts.apiKey) {
    return `Uses your ${name} API key. Rakazo does not pay for model usage.`;
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
