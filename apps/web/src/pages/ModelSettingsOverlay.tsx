import type { Me } from "@rakazo/contracts";
import {
  mergeModelOptions,
  OPENAI_COMPATIBLE_BASE_URL_HINT,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
  openAiCompatibleConnectReady,
  openAiCompatibleProbeSuccessMessage,
  preferredModelId,
  providerAllowsCustomModelId,
  sortModelProviderGroups,
} from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ModelPicker } from "../components/ModelPicker";
import { type ModelCatalogEntry, type ModelCredential, providerHint } from "../lib/model-auth";
import { rpc } from "../lib/rpc";
import { useModelOAuthSignIn } from "../lib/use-model-oauth-signin";

export function ModelSettingsOverlay({ onClose }: { onClose: () => void }) {
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [credentials, setCredentials] = useState<ModelCredential[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [provider, setProvider] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [probeModels, setProbeModels] = useState<string[]>([]);
  const [openRouterModels, setOpenRouterModels] = useState<Array<{ id: string; name: string }>>([]);
  const [probedBaseUrl, setProbedBaseUrl] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"connect" | "default" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const refreshRevisionRef = useRef(0);
  const selectionRevisionRef = useRef(0);
  const probeRequestIdRef = useRef(0);
  const selectedLabelRef = useRef<string | undefined>(undefined);

  const {
    oauth,
    pasteCode,
    setPasteCode,
    oauthPending,
    cancelOAuthAttempt,
    startSubscriptionSignIn,
    submitOAuthCode,
  } = useModelOAuthSignIn({
    onClearError: () => setError(null),
    onError: setError,
    onFinished: async (controller) => {
      await refresh();
      if (controller.signal.aborted) return;
      setNotice(`Connected and using ${selectedLabelRef.current ?? "this model"}.`);
    },
  });

  async function refresh() {
    const refreshRevision = ++refreshRevisionRef.current;
    const selectionRevision = selectionRevisionRef.current;
    const [nextCatalog, nextCredentials, nextMe] = await Promise.all([
      rpc.models.list(),
      rpc.models.credentials(),
      rpc.me(),
    ]);
    if (refreshRevision !== refreshRevisionRef.current) return;
    const nextProvider =
      provider && nextCatalog.some((entry) => entry.provider === provider)
        ? provider
        : (nextMe.defaultProvider ?? nextCatalog[0]?.provider ?? "");
    const nextCredential = nextCredentials.find((entry) => entry.provider === nextProvider);
    const catalogIds = nextCatalog
      .filter((entry) => entry.provider === nextProvider)
      .map((entry) => entry.id);
    const nextModel = preferredModelId({
      provider: nextProvider,
      catalogIds,
      requested: modelId,
      stored: nextCredential?.modelId,
      workspaceDefaultProvider: nextMe.defaultProvider,
      workspaceDefaultModel: nextMe.defaultModel,
      allowCustom:
        nextProvider === OPENAI_COMPATIBLE_PROVIDER_ID || providerAllowsCustomModelId(nextProvider),
    });
    setCatalog(nextCatalog);
    setCredentials(nextCredentials);
    setMe(nextMe);
    if (selectionRevision === selectionRevisionRef.current) {
      resetOpenAiCompatibleProbe();
      setProvider(nextProvider);
      setModelId(nextModel);
      if (nextProvider === OPENAI_COMPATIBLE_PROVIDER_ID) {
        setBaseUrl(nextCredential?.baseUrl ?? "");
      }
    }
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load model settings"),
      )
      .finally(() => setLoading(false));
    return () => {
      refreshRevisionRef.current += 1;
      probeRequestIdRef.current += 1;
    };
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, ModelCatalogEntry[]>();
    for (const entry of catalog) {
      const entries = grouped.get(entry.provider) ?? [];
      entries.push(entry);
      grouped.set(entry.provider, entries);
    }
    return sortModelProviderGroups(
      [...grouped].map(([id, entries]) => ({
        id,
        name: entries[0]?.providerName ?? id,
        entries,
      })),
    );
  }, [catalog]);
  const filteredGroups = useMemo(() => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((group) =>
      [group.id, group.name, ...group.entries.flatMap((entry) => [entry.id, entry.label])]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [groups, providerQuery]);
  const modelsForProvider = catalog.filter((entry) => entry.provider === provider);
  const isOpenAiCompatible = provider === OPENAI_COMPATIBLE_PROVIDER_ID;
  const isOpenRouter = provider === OPENROUTER_PROVIDER_ID;
  const allowCustomModel = isOpenAiCompatible || providerAllowsCustomModelId(provider);
  const pickerOptions = useMemo(() => {
    const template = modelsForProvider[0];
    if (!template) return modelsForProvider;
    const remote = isOpenRouter
      ? openRouterModels.map((entry) => ({
          ...template,
          id: entry.id,
          label: entry.name && entry.name !== entry.id ? entry.name : entry.id,
        }))
      : [];
    const merged = mergeModelOptions(modelsForProvider, remote);
    const trimmed = modelId.trim();
    if (allowCustomModel && trimmed && !merged.some((entry) => entry.id === trimmed)) {
      return [{ ...template, id: trimmed, label: trimmed }, ...merged];
    }
    return merged;
  }, [allowCustomModel, isOpenRouter, modelId, modelsForProvider, openRouterModels]);
  const selected = pickerOptions.find((entry) => entry.id === modelId) ?? pickerOptions[0];
  selectedLabelRef.current = selected?.label;
  const credential = credentials.find((entry) => entry.provider === provider);
  const currentEntry =
    catalog.find(
      (entry) => entry.provider === me?.defaultProvider && entry.id === me?.defaultModel,
    ) ??
    (me?.defaultProvider === provider && me.defaultModel
      ? pickerOptions.find((entry) => entry.id === me.defaultModel)
      : undefined);
  const activeModelId = (allowCustomModel ? modelId.trim() : selected?.id) ?? "";
  const isActive = me?.defaultProvider === provider && me?.defaultModel === activeModelId;
  const acceptsKey = selected?.auth !== "oauth";
  const subscriptionSignIn = selected?.signIn !== undefined;
  const busy = pending !== null || oauthPending;
  const effectiveBaseUrl = baseUrl.trim();
  const openAiCompatibleReady = openAiCompatibleConnectReady({
    baseUrl: effectiveBaseUrl,
    modelId,
    probedBaseUrl,
    storedBaseUrl: credential?.baseUrl,
  });

  function resetOpenAiCompatibleProbe() {
    probeRequestIdRef.current += 1;
    setProbeModels([]);
    setProbedBaseUrl(null);
    setProbing(false);
  }

  function updateBaseUrl(nextBaseUrl: string) {
    setBaseUrl(nextBaseUrl);
    resetOpenAiCompatibleProbe();
    setError(null);
    setNotice(null);
  }

  function updateApiKey(nextApiKey: string) {
    setApiKey(nextApiKey);
    resetOpenAiCompatibleProbe();
  }

  function chooseProvider(nextProvider: string) {
    cancelOAuthAttempt();
    selectionRevisionRef.current += 1;
    setProvider(nextProvider);
    setModelId(
      preferredModelId({
        provider: nextProvider,
        catalogIds: catalog
          .filter((entry) => entry.provider === nextProvider)
          .map((entry) => entry.id),
        stored: credentials.find((entry) => entry.provider === nextProvider)?.modelId,
        allowCustom:
          nextProvider === OPENAI_COMPATIBLE_PROVIDER_ID ||
          providerAllowsCustomModelId(nextProvider),
      }),
    );
    setBaseUrl(
      nextProvider === OPENAI_COMPATIBLE_PROVIDER_ID
        ? (credentials.find((entry) => entry.provider === nextProvider)?.baseUrl ?? "")
        : "",
    );
    detailScrollRef.current?.scrollTo({ top: 0 });
    setApiKey("");
    setOpenRouterModels([]);
    resetOpenAiCompatibleProbe();
    setError(null);
    setNotice(null);
  }

  async function probeServerModels() {
    const trimmedBaseUrl = effectiveBaseUrl;
    if (!trimmedBaseUrl) return;
    resetOpenAiCompatibleProbe();
    const requestId = probeRequestIdRef.current;
    setProbing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await rpc.models.probeOpenAiCompatible({
        baseUrl: trimmedBaseUrl,
        apiKey: apiKey.trim() || undefined,
      });
      if (requestId !== probeRequestIdRef.current) return;
      setProbeModels(result.models);
      setProbedBaseUrl(trimmedBaseUrl);
      setModelId((current) => current.trim() || result.models[0] || "");
      setNotice(openAiCompatibleProbeSuccessMessage(result.models.length));
    } catch (err) {
      if (requestId !== probeRequestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Could not reach this model server");
    } finally {
      if (requestId === probeRequestIdRef.current) setProbing(false);
    }
  }

  async function probeOpenRouterCatalog() {
    const requestId = ++probeRequestIdRef.current;
    setProbing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await rpc.models.probeOpenRouter({
        apiKey: apiKey.trim() || undefined,
      });
      if (requestId !== probeRequestIdRef.current) return;
      setOpenRouterModels(result.models);
      setModelId((current) => current.trim() || result.models[0]?.id || "");
      setNotice(openAiCompatibleProbeSuccessMessage(result.models.length));
    } catch (err) {
      if (requestId !== probeRequestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Could not list OpenRouter models");
    } finally {
      if (requestId === probeRequestIdRef.current) setProbing(false);
    }
  }

  async function setModelDefault() {
    if (!selected || !credential) return;
    if (!activeModelId) return;
    setError(null);
    setNotice(null);
    setPending("default");
    try {
      await rpc.models.setDefault({ provider: selected.provider, modelId: activeModelId });
      await refresh();
      setNotice(isOpenAiCompatible ? "Model updated." : `Now using ${selected.label}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the default model");
    } finally {
      setPending(null);
    }
  }

  async function connectKey() {
    if (!selected) return;
    if (isOpenAiCompatible) {
      if (!effectiveBaseUrl || !modelId.trim()) return;
    } else if (!apiKey.trim()) {
      return;
    }
    setError(null);
    setNotice(null);
    setPending("connect");
    try {
      await rpc.models.connect(
        isOpenAiCompatible
          ? {
              provider: selected.provider,
              baseUrl: effectiveBaseUrl,
              modelId: modelId.trim(),
              apiKey: apiKey.trim() || undefined,
              label: selected.providerName ?? selected.provider,
            }
          : {
              provider: selected.provider,
              apiKey: apiKey.trim(),
              modelId: activeModelId,
              label: selected.providerName ?? selected.provider,
            },
      );
      setApiKey("");
      await refresh();
      detailScrollRef.current?.scrollTo({ top: 0 });
      setNotice(isOpenAiCompatible ? "Saved." : `Connected and using ${selected.label}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect this provider");
    } finally {
      setPending(null);
    }
  }

  function handleClose() {
    cancelOAuthAttempt(false);
    onClose();
  }

  function beginSelectedSubscriptionSignIn() {
    if (!selected) return;
    setNotice(null);
    void startSubscriptionSignIn({
      provider: selected.provider,
      modelId: selected.id,
      label: selected.providerName ?? selected.provider,
    });
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(4,4,5,.62)] p-4 sm:p-10">
      <div className="flex h-[min(760px,100%)] w-[1080px] max-w-full flex-col overflow-hidden rounded-[26px] border border-[#232326] bg-[#141416] shadow-[0_40px_90px_rgba(0,0,0,.55)]">
        <div className="flex items-start justify-between px-6 pt-6 sm:px-8 sm:pt-7">
          <div>
            <div className="text-2xl font-medium text-[#F1F1F2]">Models</div>
            <p className="mt-1 text-[13.5px] text-[#7A7A80]">
              {loading
                ? "Loading model catalog…"
                : "Paste an OpenAI key, sign in with ChatGPT Plus/Pro, or pick any OpenRouter model."}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close model settings"
            onClick={handleClose}
            className="text-[#85858A]"
          >
            ✕
          </button>
        </div>

        <div className="mx-6 mt-5 rounded-[14px] border border-[#26262A] bg-[#101012] px-4 py-3 sm:mx-8">
          <div className="text-[12.5px] uppercase tracking-[0.08em] text-[#6C6C70]">
            Active model
          </div>
          <div className="mt-1 text-[16px] text-[#F1F1F2]">
            {currentEntry?.label ?? me?.defaultModel ?? "Deployment default"}
          </div>
          <div className="mt-1 text-[13px] text-[#85858A]">
            {currentEntry?.providerName ?? me?.defaultProvider ?? "Configured by deployment"}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-6 py-6 sm:px-8 md:flex-row">
          <div className="flex min-h-0 shrink-0 flex-col md:w-[310px]">
            <div className="mb-3 text-[13.5px] text-[#85858A]">Providers</div>
            <label className="sr-only" htmlFor="model-provider-search">
              Search providers
            </label>
            <input
              id="model-provider-search"
              value={providerQuery}
              onChange={(event) => setProviderQuery(event.target.value)}
              placeholder="Search providers"
              className="w-full rounded-[11px] border border-[#26262A] bg-[#101012] px-3.5 py-2.5 text-[14px] text-[#ECECEE] outline-none placeholder:text-[#6C6C70] focus:border-[#4A4A50]"
            />
            <div className="rk-scroll mt-3 max-h-[240px] overflow-y-auto rounded-[13px] border border-[#26262A] md:min-h-0 md:max-h-none md:flex-1">
              {filteredGroups.length ? (
                filteredGroups.map((group) => {
                  const connected = credentials.some((entry) => entry.provider === group.id);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => chooseProvider(group.id)}
                      className={`flex w-full items-center gap-3 border-b border-[#202023] px-3.5 py-3 text-start last:border-0 ${
                        group.id === provider ? "bg-[#1A1A1D]" : "hover:bg-[#161618]"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] text-[#ECECEE]">
                          {group.name}
                        </span>
                        <span className="mt-0.5 block text-[12px] text-[#6C6C70]">
                          {group.entries.length} model{group.entries.length === 1 ? "" : "s"} ·{" "}
                          {providerHint(group.entries[0]!)}
                        </span>
                      </span>
                      {connected ? (
                        <span className="text-[12px] text-[#4ECB71]">Connected</span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <p className="px-3.5 py-4 text-[13px] text-[#85858A]">No providers found.</p>
              )}
            </div>
          </div>

          <div ref={detailScrollRef} className="rk-scroll min-h-0 min-w-0 flex-1 overflow-y-auto">
            {error ? <p className="mb-4 text-sm text-[#C94244]">{error}</p> : null}
            {notice ? <p className="mb-4 text-sm text-[#4ECB71]">{notice}</p> : null}
            {selected ? (
              <>
                <div className="block text-[13.5px] text-[#85858A]">
                  {isOpenAiCompatible ? (
                    <>
                      <label className="block">
                        Server URL
                        <input
                          value={baseUrl}
                          onChange={(event) => updateBaseUrl(event.target.value)}
                          aria-label="OpenAI-compatible server URL"
                          placeholder="http://127.0.0.1:8000/v1"
                          autoComplete="off"
                          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-[#101012] px-3.5 py-3 text-[#ECECEE] outline-none"
                        />
                      </label>
                      <details className="mt-2 text-[13px] leading-[1.5] text-[#85858A]">
                        <summary className="w-fit cursor-pointer select-none">Setup help</summary>
                        <p className="mt-1">{OPENAI_COMPATIBLE_BASE_URL_HINT}</p>
                      </details>
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || probing || !effectiveBaseUrl}
                          onClick={() => void probeServerModels()}
                        >
                          {probing ? "Finding…" : "Find models"}
                        </Button>
                      </div>
                      <div className="mt-4 block">
                        <span>Model</span>
                        {probeModels.length && probeModels.includes(modelId) ? (
                          <div className="relative mt-2">
                            <select
                              value={modelId}
                              onChange={(event) => {
                                cancelOAuthAttempt();
                                selectionRevisionRef.current += 1;
                                setModelId(event.target.value);
                                setError(null);
                                setNotice(null);
                              }}
                              aria-label="Models from server"
                              className="w-full appearance-none rounded-[11px] border border-[#26262A] bg-[#101012] py-3 pl-3.5 pr-11 text-sm text-[#ECECEE]"
                            >
                              {probeModels.map((id) => (
                                <option key={id} value={id}>
                                  {id}
                                </option>
                              ))}
                              <option value="">Other model…</option>
                            </select>
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#85858A]"
                            >
                              <ChevronDown size={16} strokeWidth={1.8} />
                            </span>
                          </div>
                        ) : (
                          <input
                            value={modelId}
                            onChange={(event) => {
                              cancelOAuthAttempt();
                              selectionRevisionRef.current += 1;
                              setModelId(event.target.value);
                              setError(null);
                              setNotice(null);
                            }}
                            aria-label="Model id"
                            placeholder="exact-model-id"
                            className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-[#101012] px-3.5 py-3 text-[#ECECEE] outline-none"
                          />
                        )}
                        {probeModels.length && !probeModels.includes(modelId) ? (
                          <button
                            type="button"
                            className="mt-2 text-[13px] text-[#85858A] underline"
                            onClick={() => setModelId(probeModels[0] ?? "")}
                          >
                            Use a found model
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <span>Model</span>
                      <ModelPicker
                        options={pickerOptions}
                        value={selected.id}
                        allowCustom={allowCustomModel}
                        onChange={(nextModelId) => {
                          cancelOAuthAttempt();
                          selectionRevisionRef.current += 1;
                          setModelId(nextModelId);
                          setError(null);
                          setNotice(null);
                        }}
                      />
                      {isOpenRouter ? (
                        <div className="mt-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy || probing}
                            onClick={() => void probeOpenRouterCatalog()}
                          >
                            {probing ? "Finding…" : "All OpenRouter models"}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                {!isOpenAiCompatible ? (
                  <p className="mt-2 text-[13px] leading-[1.5] text-[#85858A]">
                    {selected.billing}
                  </p>
                ) : null}

                {!isOpenAiCompatible ? (
                  <div className="mt-5 rounded-[13px] border border-[#26262A] px-4 py-3">
                    <div className="text-[12.5px] uppercase tracking-[0.08em] text-[#6C6C70]">
                      Personal credential
                    </div>
                    <div className="mt-1 text-[15px] text-[#ECECEE]">
                      {credential ? `Connected · ${credential.label}` : "Not connected"}
                    </div>
                    <div className="mt-1 text-[13px] text-[#85858A]">
                      {credential
                        ? "Your key or subscription token is stored securely and is never shown here."
                        : "Connect this provider to use it as your personal model."}
                    </div>
                  </div>
                ) : null}

                {subscriptionSignIn ? (
                  <div className="mt-5">
                    {oauth ? (
                      <div className="rounded-[13px] border border-[#26262A] px-4 py-3">
                        {oauth.mode === "auth-url" ? (
                          <>
                            <p className="text-sm leading-[1.5] text-[#85858A]">
                              Finish signing in at{" "}
                              <a
                                href={oauth.verificationUri}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[#ECECEE] underline"
                              >
                                {new URL(oauth.verificationUri).hostname}
                              </a>
                              . The final page may not load; paste its URL or code here.
                            </p>
                            <div className="mt-3 flex items-center gap-2">
                              <input
                                value={pasteCode}
                                onChange={(e) => setPasteCode(e.target.value)}
                                aria-label="Authorization code or callback URL"
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="http://localhost:53692/callback?code=…"
                                className="w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-2.5 text-[13px] text-[#ECECEE]"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!pasteCode.trim()}
                                onClick={() => void submitOAuthCode()}
                              >
                                Submit
                              </Button>
                            </div>
                            <p className="mt-2 text-sm text-[#85858A]">Waiting for sign-in…</p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm leading-[1.5] text-[#85858A]">
                              Enter this code at{" "}
                              <a
                                href={oauth.verificationUri}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[#ECECEE] underline"
                              >
                                {oauth.verificationUri.replace(/^https:\/\//, "")}
                              </a>
                            </p>
                            <p className="mt-2 font-mono text-[22px] tracking-[0.2em] text-[#F1F1F2]">
                              {oauth.userCode}
                            </p>
                            <p className="mt-2 text-sm text-[#85858A]">Waiting for sign-in…</p>
                          </>
                        )}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => beginSelectedSubscriptionSignIn()}
                      >
                        {oauthPending ? "Starting…" : (selected.oauthLabel ?? "Sign in")}
                      </Button>
                    )}
                  </div>
                ) : null}

                {acceptsKey ? (
                  <div className="mt-5">
                    {isOpenAiCompatible ? (
                      <details className="text-[13.5px] text-[#85858A]">
                        <summary className="w-fit cursor-pointer select-none">API key</summary>
                        <input
                          aria-label="API key"
                          value={apiKey}
                          onChange={(event) => updateApiKey(event.target.value)}
                          placeholder="Optional"
                          type="password"
                          autoComplete="new-password"
                          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-[#101012] px-3.5 py-3 text-[#ECECEE] outline-none"
                        />
                      </details>
                    ) : (
                      <label className="block text-[13.5px] text-[#85858A]">
                        {credential
                          ? "Replace API key"
                          : provider === "openai"
                            ? "OpenAI API key"
                            : subscriptionSignIn
                              ? "Or connect an API key"
                              : "API key"}
                        <input
                          value={apiKey}
                          onChange={(event) => updateApiKey(event.target.value)}
                          placeholder={provider === OPENROUTER_PROVIDER_ID ? "sk-or-…" : "sk-…"}
                          type="password"
                          autoComplete="new-password"
                          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-[#101012] px-3.5 py-3 text-[#ECECEE] outline-none"
                        />
                      </label>
                    )}
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={
                        busy ||
                        (isOpenAiCompatible ? !openAiCompatibleReady : apiKey.trim().length < 8)
                      }
                      onClick={() => void connectKey()}
                      className="mt-3"
                    >
                      {pending === "connect"
                        ? "Saving…"
                        : isOpenAiCompatible
                          ? "Save"
                          : credential
                            ? "Replace API key"
                            : "Connect API key"}
                    </Button>
                  </div>
                ) : null}

                {selected.auth === "oauth" && !subscriptionSignIn ? (
                  <p className="mt-5 text-sm leading-[1.5] text-[#85858A]">
                    This subscription sign-in is not available in Rakazo yet. Use a deployment
                    credential or choose another provider.
                  </p>
                ) : null}

                {credential && !isActive ? (
                  <div className="mt-6">
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={busy || (allowCustomModel && !activeModelId)}
                      onClick={() => void setModelDefault()}
                    >
                      {pending === "default" ? "Switching…" : "Use this model"}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : loading ? (
              <p className="text-[#85858A]">Loading model catalog…</p>
            ) : (
              <p className="text-[#85858A]">No model catalog is available.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
