import type {
  LbBillingOffer,
  LbCaptchaEventView,
  LbDraftView,
  LbHostView,
  LbOperatorTicketView,
  LbPlacementView,
  LbProjectCard,
  LbProjectDetail,
  LbProjectStatusView,
  LbProxyLeaseView,
  LbRunStepView,
  LbRunView,
  LbThreadView,
} from "@rakazo/contracts";
import { isFixtureHostDomain } from "@rakazo/linkbuilder-core";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LoadingState } from "../../components/beautiful-ui/primitives";
import { rpc } from "../../lib/rpc";
import {
  artifactImageSrc,
  canStart,
  draftFromProject,
  dropBlankPages,
  emptyDraft,
  patchFromDraft,
  slugifyProjectName,
  WIZARD_STEPS,
  type WizardDraft,
  withPagePrefill,
  withPersonaPrefill,
  wizardStepIssues,
} from "./model.js";
import { CreditPackagesView, DashboardView, OperatorView, ProjectView, WizardView } from "./views.js";

function useArtifactLoader(projectId: string) {
  return useCallback(
    (artifactId: string) =>
      rpc.linkBuilder.artifacts.get({ projectId, artifactId }).then(artifactImageSrc),
    [projectId],
  );
}

export function LinkBuilderPage() {
  const params = useParams();
  const path = window.location.pathname;
  if (path.includes("/operator/") && params.projectId && params.ticketId) {
    return <OperatorRoute projectId={params.projectId} ticketId={params.ticketId} />;
  }
  if (path === "/link-builder/credits") return <CreditsRoute />;
  if (path.includes("/new")) return <WizardRoute projectId={params.projectId} />;
  if (params.projectId) return <ProjectRoute projectId={params.projectId} />;
  return <DashboardRoute />;
}

function DashboardRoute() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<LbProjectCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await rpc.linkBuilder.projects.list();
        if (!cancelled) setCards(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  if (!cards) {
    return (
      <div className="grid h-full place-items-center">
        {error ? (
          <p className="text-[13px] text-[#FF8B8B]">{error}</p>
        ) : (
          <LoadingState label="Loading projects" />
        )}
      </div>
    );
  }
  return (
    <DashboardView
      cards={cards}
      loading={false}
      onNew={() => navigate("/link-builder/new")}
      onOpen={(card) =>
        navigate(
          card.status === "draft" ? `/link-builder/new/${card.id}` : `/link-builder/${card.id}`,
        )
      }
    />
  );
}

async function suggestPage(input: { url: string; allowedDomains: string[] }) {
  try {
    return await rpc.linkBuilder.pages.suggest(input);
  } catch {
    return { keyword: "", rule: "" };
  }
}

function useBillingOffer() {
  const [offer, setOffer] = useState<LbBillingOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void rpc.linkBuilder.billing
      .offer()
      .then((next) => {
        if (!cancelled) setOffer(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function buy(packageId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.linkBuilder.billing.checkout({ packageId });
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setOffer((current) =>
        current
          ? {
              ...current,
              balance: result.balance,
              entitled: result.entitled,
              reason: result.reason,
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not buy");
    } finally {
      setBusy(false);
    }
  }

  return { offer, error, busy, buy };
}

function BillingBody({
  offer,
  error,
  busy,
  onBuy,
}: {
  offer: LbBillingOffer | null;
  error: string | null;
  busy: boolean;
  onBuy: (packageId: string) => void;
}) {
  if (!offer) {
    return (
      <div className="grid h-full place-items-center">
        {error ? (
          <p className="text-[13px] text-[#FF8B8B]">{error}</p>
        ) : (
          <LoadingState label="Loading packages" />
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <CreditPackagesView
        packages={offer.packages}
        balance={offer.balance}
        reason={error || offer.reason}
        busy={busy}
        onBuy={onBuy}
      />
    </div>
  );
}

function CreditsRoute() {
  const billing = useBillingOffer();
  return (
    <BillingBody
      offer={billing.offer}
      error={billing.error}
      busy={billing.busy}
      onBuy={(packageId) => void billing.buy(packageId)}
    />
  );
}

function NewProjectGate() {
  const billing = useBillingOffer();
  if (!billing.offer) {
    return (
      <BillingBody
        offer={null}
        error={billing.error}
        busy={billing.busy}
        onBuy={() => undefined}
      />
    );
  }
  if (billing.offer.entitled) return <WizardEditor />;
  return (
    <BillingBody
      offer={billing.offer}
      error={billing.error}
      busy={billing.busy}
      onBuy={(packageId) => void billing.buy(packageId)}
    />
  );
}

function WizardRoute({ projectId }: { projectId?: string }) {
  if (!projectId) return <NewProjectGate />;
  return <WizardEditor projectId={projectId} />;
}

function WizardEditor({ projectId }: { projectId?: string }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<WizardDraft>(emptyDraft);
  const [id, setId] = useState<string | undefined>(projectId);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(!projectId);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void rpc.linkBuilder.projects.get({ projectId }).then((project) => {
      if (cancelled) return;
      setDraft(draftFromProject(project));
      setId(project.id);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const save = useCallback(
    async (next: WizardDraft) => {
      const patch = patchFromDraft(next);
      delete patch.captchaToken;
      if (!id) {
        const created = await rpc.linkBuilder.projects.create({
          name: patch.name,
          slug: patch.slug || slugifyProjectName(patch.name),
          brandName: patch.brandName,
          allowedDomains: patch.allowedDomains,
          markets: patch.markets,
        });
        setId(created.id);
        navigate(`/link-builder/new/${created.id}`, { replace: true });
        const updated = await rpc.linkBuilder.projects.update({ projectId: created.id, ...patch });
        return updated;
      }
      return rpc.linkBuilder.projects.update({ projectId: id, ...patch });
    },
    [id, navigate],
  );

  async function nextStep() {
    const next =
      step === 0
        ? withPersonaPrefill(draft)
        : step === 2
          ? withPagePrefill(draft)
          : step === 3
            ? dropBlankPages(draft)
            : draft;
    if (next !== draft) setDraft(next);
    const found = wizardStepIssues(step, next);
    setIssues(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      const saved = await save(next);
      setDraft(draftFromProject(saved));
      setStep((value) => Math.min(WIZARD_STEPS.length - 1, value + 1));
    } catch (err) {
      setIssues([err instanceof Error ? err.message : "Could not save"]);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const found = wizardStepIssues(WIZARD_STEPS.length - 1, draft);
    setIssues(found);
    if (!canStart(draft) || !id) return;
    setBusy(true);
    try {
      await rpc.linkBuilder.projects.start({ projectId: id });
      setStarted(true);
      navigate(`/link-builder/${id}`);
    } catch (err) {
      setIssues([err instanceof Error ? err.message : "Could not start"]);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="grid h-full place-items-center">
        <LoadingState label="Loading draft" />
      </div>
    );
  }
  return (
    <WizardView
      step={step}
      draft={draft}
      issues={issues}
      busy={busy}
      started={started}
      onChange={setDraft}
      onBack={() => {
        setIssues([]);
        if (step === 0) navigate("/link-builder");
        else setStep((value) => value - 1);
      }}
      onNext={() => void nextStep()}
      onStart={() => void start()}
      onSuggestPage={suggestPage}
      onGoTo={(index) => {
        if (index > step) return;
        setIssues([]);
        setStep(index);
      }}
    />
  );
}

function ProjectRoute({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("Overview");
  const [project, setProject] = useState<LbProjectDetail | null>(null);
  const [status, setStatus] = useState<LbProjectStatusView | null>(null);
  const [hosts, setHosts] = useState<LbHostView[]>([]);
  const [placements, setPlacements] = useState<LbPlacementView[]>([]);
  const [runs, setRuns] = useState<LbRunView[]>([]);
  const [steps, setSteps] = useState<LbRunStepView[]>([]);
  const [threads, setThreads] = useState<LbThreadView[]>([]);
  const [drafts, setDrafts] = useState<LbDraftView[]>([]);
  const [captchas, setCaptchas] = useState<LbCaptchaEventView[]>([]);
  const [tickets, setTickets] = useState<LbOperatorTicketView[]>([]);
  const [leases, setLeases] = useState<LbProxyLeaseView[]>([]);
  const [busy, setBusy] = useState(false);
  const loadArtifact = useArtifactLoader(projectId);

  const reload = useCallback(async () => {
    const [
      nextProject,
      nextStatus,
      nextHosts,
      nextPlacements,
      nextRuns,
      nextThreads,
      nextDrafts,
      nextCaptchas,
      nextTickets,
      nextLeases,
    ] = await Promise.all([
      rpc.linkBuilder.projects.get({ projectId }),
      rpc.linkBuilder.projects.status({ projectId }),
      rpc.linkBuilder.hosts.list({ projectId }),
      rpc.linkBuilder.placements.list({ projectId }),
      rpc.linkBuilder.runs.list({ projectId }),
      rpc.linkBuilder.threads.list({ projectId }),
      rpc.linkBuilder.drafts.list({ projectId }),
      rpc.linkBuilder.captcha.events({ projectId }),
      rpc.linkBuilder.operator.tickets({ projectId }),
      rpc.linkBuilder.proxyLeases.list({ projectId }),
    ]);
    setProject(nextProject);
    setStatus(nextStatus);
    setHosts(nextHosts);
    setPlacements(nextPlacements);
    setRuns(nextRuns);
    setThreads(nextThreads);
    setDrafts(nextDrafts);
    setCaptchas(nextCaptchas);
    setTickets(nextTickets);
    setLeases(nextLeases);
    const latest = nextRuns[0];
    if (latest) setSteps(await rpc.linkBuilder.runs.steps({ projectId, runId: latest.id }));
  }, [projectId]);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    const abort = new AbortController();
    let cursor = "";
    void (async () => {
      while (!abort.signal.aborted) {
        try {
          const events = await rpc.linkBuilder.subscribe(
            { projectId, cursor },
            { signal: abort.signal },
          );
          for await (const event of events) {
            if (abort.signal.aborted) return;
            cursor = event.cursor;
            await reload();
          }
        } catch {
          if (abort.signal.aborted) return;
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    })();
    return () => abort.abort();
  }, [projectId, reload]);

  if (!project) {
    return (
      <div className="grid h-full place-items-center">
        <LoadingState label="Loading project" />
      </div>
    );
  }

  async function act(kind: "start" | "pause" | "stop") {
    setBusy(true);
    try {
      if (kind === "start") await rpc.linkBuilder.projects.start({ projectId });
      if (kind === "pause") await rpc.linkBuilder.projects.pause({ projectId });
      if (kind === "stop") await rpc.linkBuilder.projects.stop({ projectId });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProjectView
      project={project}
      status={status}
      hosts={hosts}
      placements={placements}
      runs={runs}
      steps={steps}
      threads={threads}
      drafts={drafts}
      captchas={captchas}
      leases={leases}
      tickets={tickets}
      tab={tab}
      onTab={setTab}
      busy={busy}
      onStart={() => act("start")}
      onPause={() => act("pause")}
      onStop={() => act("stop")}
      onVerify={(placementId) =>
        void rpc.linkBuilder.placements.verify({ projectId, placementId }).then(() => reload())
      }
      onOpenTicket={(ticketId) => navigate(`/link-builder/${projectId}/operator/${ticketId}`)}
      onDecideDraft={(draftId, decision) => {
        const call =
          decision === "approved"
            ? rpc.linkBuilder.drafts.approve({ projectId, draftId })
            : rpc.linkBuilder.drafts.discard({ projectId, draftId });
        void call.then(() => reload());
      }}
      loadArtifact={loadArtifact}
      creditNote={null}
      onBuyCredits={() => navigate("/link-builder/credits")}
    />
  );
}

function OperatorRoute({ projectId, ticketId }: { projectId: string; ticketId: string }) {
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<LbOperatorTicketView | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const loadArtifact = useArtifactLoader(projectId);
  useEffect(() => {
    let cancelled = false;
    void rpc.linkBuilder.operator.tickets({ projectId }).then((tickets) => {
      if (cancelled) return;
      const found = tickets.find((item) => item.id === ticketId) ?? null;
      const captcha =
        found?.reason === "captcha_unsolved" || isFixtureHostDomain(found?.domain ?? "");
      if (!found || captcha) {
        navigate(`/link-builder/${projectId}`, { replace: true });
        return;
      }
      setTicket(found);
      setNote(found.note ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, projectId, ticketId]);
  if (!ticket) {
    return (
      <div className="grid h-full place-items-center">
        <LoadingState label="Loading ticket" />
      </div>
    );
  }
  async function settle(kind: "continue" | "skip") {
    setBusy(true);
    try {
      const updated =
        kind === "continue"
          ? await rpc.linkBuilder.operator.continue({ projectId, ticketId, note })
          : await rpc.linkBuilder.operator.skip({ projectId, ticketId, note });
      setTicket(updated);
      setDone(kind === "continue" ? "Continued" : "Skipped");
    } finally {
      setBusy(false);
    }
  }
  return (
    <OperatorView
      ticket={ticket}
      note={note}
      busy={busy}
      done={done}
      onNote={setNote}
      onContinue={() => void settle("continue")}
      onSkip={() => void settle("skip")}
      loadArtifact={loadArtifact}
    />
  );
}
