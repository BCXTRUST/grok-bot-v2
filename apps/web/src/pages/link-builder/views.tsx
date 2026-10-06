import type {
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
import {
  FIXTURE_DEMO_SLUG,
  isFixtureHostDomain,
  showHostToCustomer,
  stageFromActivity,
  WORK_STAGE_LABELS,
  WORK_STAGES,
} from "@rakazo/linkbuilder-core";
import { useEffect, useRef, useState } from "react";
import {
  BuiButton,
  BuiCard,
  LoadingState,
  Shimmer,
  SuccessPop,
  TaskRow,
} from "../../components/beautiful-ui/primitives";
import {
  addWizardPage,
  disclosureLabel,
  FUNNEL_COLUMNS,
  funnelColumnId,
  normalizePageUrl,
  PAGE_BOX_LIMIT,
  pageDomains,
  QUOTA_LABELS,
  RESPONSIBILITY_SENTENCE,
  removeWizardPage,
  WIZARD_STEP_HINTS,
  WIZARD_STEPS,
  type WizardDraft,
  warmupNote,
} from "./model.js";
import {
  OVERVIEW_COUNTS,
  type OverviewFeedItem,
  type OverviewIntent,
  overviewAction,
  overviewFeed,
  overviewFrame,
  overviewPill,
  overviewWorking,
  whyNotFeedLines,
} from "./overview.js";

const inputClass =
  "w-full rounded-xl border border-[#2A2A31] bg-[#141416] px-3 py-2 text-[14px] text-[#ECECEE] outline-none";

export function DashboardView({
  cards,
  loading,
  onOpen,
  onNew,
}: {
  cards: LbProjectCard[];
  loading: boolean;
  onOpen: (card: LbProjectCard) => void;
  onNew: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-[22px] font-medium text-[#ECECEE]">Link Builder</h1>
        <BuiButton tone="accent" label="New project" onClick={onNew}>
          New project
        </BuiButton>
      </header>
      {loading ? <LoadingState label="Loading projects" /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((card) => (
          <BuiCard key={card.id} className="p-4">
            <button
              type="button"
              className="flex w-full flex-col gap-3 text-left"
              aria-label={`Open ${card.name}`}
              onClick={() => onOpen(card)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[16px] text-[#ECECEE]">{card.name}</div>
                  <div className="text-[12.5px] text-[#85858A]">{card.brandName}</div>
                </div>
                <Pill label={card.activityLabel} />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Ring label={QUOTA_LABELS.newPerDay} value={card.newToday} max={card.newPerDay} />
                <Ring
                  label={QUOTA_LABELS.livePerDay}
                  value={card.liveToday}
                  max={card.livePerDay}
                />
                <WeekBar value={card.liveWeek} max={card.liveWeekCap} />
              </div>
              <div className="truncate text-[12.5px] text-[#A6A6AD]">
                {card.lastEvent ?? "No events yet"}
              </div>
            </button>
          </BuiCard>
        ))}
      </div>
    </main>
  );
}

export function WizardView({
  step,
  draft,
  issues,
  busy,
  started,
  onChange,
  onBack,
  onNext,
  onStart,
  onGoTo,
  onSuggestPage,
}: {
  step: number;
  draft: WizardDraft;
  issues: string[];
  busy: boolean;
  started: boolean;
  onChange: (next: WizardDraft | ((current: WizardDraft) => WizardDraft)) => void;
  onBack: () => void;
  onNext: () => void;
  onStart: () => void;
  onGoTo: (step: number) => void;
  onSuggestPage?: (input: {
    url: string;
    allowedDomains: string[];
  }) => Promise<{ keyword: string; rule: string }>;
}) {
  const title = WIZARD_STEPS[step] ?? "Review";
  const last = WIZARD_STEPS.length - 1;
  return (
    <main
      className="grid h-full min-h-dvh w-full min-w-0 overflow-x-clip bg-[#050506]"
      style={{ gridTemplateColumns: "280px minmax(0, 1fr)" }}
    >
      <ol
        aria-label="Setup steps"
        className="flex min-w-0 flex-col gap-0.5 overflow-y-auto border-r border-[#2A2A31] px-3 py-8"
        style={{ position: "sticky", top: 0, height: "100vh", alignSelf: "start" }}
      >
        {WIZARD_STEPS.map((label, index) => {
          const current = index === step;
          const done = index < step;
          return (
            <li key={label}>
              <button
                type="button"
                aria-current={current ? "step" : undefined}
                aria-label={`Step ${index + 1} of ${WIZARD_STEPS.length}: ${label}${done ? ", done" : ""}`}
                disabled={busy || index > step}
                onClick={() => onGoTo(index)}
                className={`flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] leading-snug ${
                  current
                    ? "bg-[#1C1C20] text-[#ECECEE] shadow-[inset_2px_0_0_#7785ff]"
                    : done
                      ? "text-[#C8C8CD] hover:bg-[#141416]"
                      : "text-[#85858A]"
                } disabled:hover:bg-transparent`}
              >
                <StepMark index={index} done={done} />
                <span className="min-w-0 flex-1 whitespace-normal break-words">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="rk-scroll min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-8">
          <h1 className="text-[22px] font-medium text-[#ECECEE]">{title}</h1>
          <p className="text-[13px] text-[#A6A6AD]">{WIZARD_STEP_HINTS[step]}</p>
          {step === 3 ? (
            <TopicFields draft={draft} onChange={onChange} onSuggestPage={onSuggestPage} />
          ) : (
            <BuiCard className="flex flex-col gap-3 p-4">
              {step === 0 ? <BrandFields draft={draft} onChange={onChange} /> : null}
              {step === 1 ? <PersonaFields draft={draft} onChange={onChange} /> : null}
              {step === 2 ? <QuotaFields draft={draft} onChange={onChange} /> : null}
              {step === last ? <ReviewFields draft={draft} /> : null}
            </BuiCard>
          )}
          {issues.length > 0 ? (
            <ul className="flex flex-col gap-1 text-[13px] text-[#FF8B8B]" role="alert">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <BuiButton label="Back" onClick={onBack} disabled={step === 0 || busy}>
              Back
            </BuiButton>
            {step < last ? (
              <BuiButton tone="accent" label="Continue" onClick={onNext} disabled={busy}>
                Continue
              </BuiButton>
            ) : (
              <div className="flex flex-col items-end gap-2">
                {started ? <SuccessPop label="Started" /> : null}
                <BuiButton tone="accent" label="Start building" onClick={onStart} disabled={busy}>
                  Start building
                </BuiButton>
                <p className="max-w-sm text-right text-[12px] text-[#85858A]">
                  {RESPONSIBILITY_SENTENCE}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function StepMark({ index, done }: { index: number; done: boolean }) {
  if (done) {
    return (
      <svg
        className="mt-0.5 shrink-0"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#3dbb72"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M20 6 9 17 4 12" />
      </svg>
    );
  }
  return <span className="mt-0.5 w-3.5 shrink-0 text-center tabular-nums">{index + 1}</span>;
}

export function ProjectView({
  project,
  status,
  hosts,
  placements,
  runs,
  steps,
  threads,
  drafts,
  leases = [],
  captchas,
  tickets,
  tab,
  onTab,
  onStart,
  onPause,
  onStop,
  onVerify,
  onOpenTicket,
  onDecideDraft,
  loadArtifact,
  busy,
  creditNote,
  onBuyCredits,
}: {
  project: LbProjectDetail;
  status: LbProjectStatusView | null;
  hosts: LbHostView[];
  placements: LbPlacementView[];
  runs: LbRunView[];
  steps: LbRunStepView[];
  threads: LbThreadView[];
  drafts: LbDraftView[];
  leases?: LbProxyLeaseView[];
  captchas: { id: string; outcome: string; domain: string | null }[];
  tickets: LbOperatorTicketView[];
  tab: string;
  onTab: (tab: string) => void;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onVerify: (placementId: string) => void;
  onOpenTicket: (ticketId: string) => void;
  onDecideDraft?: (draftId: string, decision: "approved" | "discarded") => void;
  loadArtifact?: ArtifactLoader;
  busy: boolean;
  creditNote?: string | null;
  onBuyCredits?: () => void;
}) {
  const [intent, setIntent] = useState<OverviewIntent>(null);
  useEffect(() => {
    if (!intent || busy) return;
    setIntent(null);
  }, [intent, busy]);
  const working = overviewWorking({ activity: status?.activity ?? null, intent });
  const pill = overviewPill({ activityLabel: status?.activityLabel ?? null, intent });
  function request(kind: "start" | "pause" | "stop") {
    const next: OverviewIntent =
      kind === "start" ? "working" : kind === "pause" ? "paused" : "stopped";
    setIntent(next);
    const run = kind === "start" ? onStart() : kind === "pause" ? onPause() : onStop();
    void Promise.resolve(run).catch(() => setIntent(null));
  }
  const tabs = [
    "Overview",
    "Targets",
    "Hosts",
    "Threads",
    "Placements",
    "Runs",
    "Captchas",
    "Settings",
  ];
  const wide = tab === "Overview";
  return (
    <main
      className={
        wide
          ? "mx-auto flex min-h-dvh w-full max-w-[1400px] flex-col gap-3 px-4 py-4"
          : "mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8"
      }
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-medium text-[#ECECEE]">{project.name}</h1>
        <div className="flex items-start gap-4">
          {pill ? <Pill label={pill} /> : null}
          <CreditBudget
            balance={status?.credits?.balance ?? null}
            note={creditNote}
            busy={busy}
            onBuy={onBuyCredits}
          />
        </div>
      </header>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Project">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`rounded-full px-3 py-1 text-[13px] ${tab === name ? "bg-[#232327] text-[#ECECEE]" : "text-[#A6A6AD]"}`}
            onClick={() => onTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "Overview" ? (
        <Overview
          project={project}
          status={status}
          steps={steps}
          tickets={tickets}
          working={working}
          busy={busy}
          loadArtifact={loadArtifact}
          onStart={() => request("start")}
          onPause={() => request("pause")}
          onStop={() => request("stop")}
        />
      ) : null}
      {tab === "Targets" ? <TargetList project={project} /> : null}
      {tab === "Hosts" ? (
        <HostBoard
          hosts={hosts.filter((host) => showHostToCustomer(host.registrableDomain, project.slug))}
          researching={working}
        />
      ) : null}
      {tab === "Threads" ? (
        <ThreadList
          threads={threads}
          drafts={drafts}
          draftsOnly={project.disclosureMode === "drafts_only"}
          onDecide={onDecideDraft}
        />
      ) : null}
      {tab === "Placements" ? <PlacementTable rows={placements} onVerify={onVerify} /> : null}
      {tab === "Runs" ? (
        <RunTimeline runs={runs} steps={steps} loadArtifact={loadArtifact} />
      ) : null}
      {tab === "Captchas" ? (
        <CaptchaPanel captchas={captchas} tickets={tickets} onOpenTicket={onOpenTicket} />
      ) : null}
      {tab === "Settings" ? <SettingsPanel project={project} leases={leases} /> : null}
    </main>
  );
}

export function ticketCountdown(expiresAt: string | null, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const remaining = Date.parse(expiresAt) - now;
  if (Number.isNaN(remaining)) return null;
  if (remaining <= 0) return "Expired";
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function OperatorView({
  ticket,
  note,
  busy,
  done,
  onNote,
  onContinue,
  onSkip,
  loadArtifact,
  now,
}: {
  ticket: LbOperatorTicketView;
  note: string;
  busy: boolean;
  done: string | null;
  onNote: (note: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  loadArtifact?: ArtifactLoader;
  now?: number;
}) {
  const embed = ticket.screenUrl?.startsWith("/novnc/") || ticket.screenUrl?.startsWith("https://");
  const shot = !embed && loadArtifact ? ticket.screenshotArtifactId : null;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <h1 className="text-[22px] font-medium text-[#ECECEE]">{ticket.domain}</h1>
      {ticketCountdown(ticket.expiresAt, now) ? (
        <p className="text-[13px] text-[#A6A6AD]">{ticketCountdown(ticket.expiresAt, now)}</p>
      ) : null}
      {shot && loadArtifact ? (
        <ArtifactShot artifactId={shot} load={loadArtifact} label="Screenshot" />
      ) : (
        <div
          role="img"
          className="grid min-h-[320px] place-items-center overflow-hidden rounded-[16px] border border-[#2A2A31] bg-[#101012]"
          aria-label="Live screen"
        >
          {embed && ticket.screenUrl ? (
            <iframe title="Live screen" src={ticket.screenUrl} className="h-[420px] w-full" />
          ) : (
            <span className="text-[13px] text-[#85858A]">Live screen</span>
          )}
        </div>
      )}
      <label className="text-[13px] text-[#A6A6AD]">
        Note
        <textarea
          aria-label="Note"
          value={note}
          onChange={(event) => onNote(event.target.value)}
          className={`${inputClass} mt-1 min-h-20`}
        />
      </label>
      {done ? <SuccessPop label={done} /> : null}
      <div className="flex gap-3">
        <BuiButton
          tone="accent"
          label="I've solved it, continue"
          onClick={onContinue}
          disabled={busy}
        >
          I've solved it, continue
        </BuiButton>
        <BuiButton label="Skip host" onClick={onSkip} disabled={busy}>
          Skip host
        </BuiButton>
      </div>
    </main>
  );
}

function Overview({
  project,
  status,
  steps,
  tickets,
  working,
  busy,
  loadArtifact,
  onStart,
  onPause,
  onStop,
}: {
  project: LbProjectDetail;
  status: LbProjectStatusView | null;
  steps: LbRunStepView[];
  tickets: LbOperatorTicketView[];
  working: boolean;
  busy: boolean;
  loadArtifact?: ArtifactLoader;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
}) {
  const newToday = status?.run?.newToday ?? 0;
  const liveToday = status?.run?.liveToday ?? 0;
  const newPerDay = status?.newPerDay ?? project.quotas?.newPerDay ?? 0;
  const livePerDay = status?.livePerDay ?? project.quotas?.livePerDay ?? 0;
  const hideExampleCopy = project.slug !== FIXTURE_DEMO_SLUG;
  const items = overviewFeed({
    steps,
    lastEvent: status?.lastEvent ?? null,
    working,
    blockers: whyNotFeedLines(status?.whyNot),
    hideExampleCopy,
  });
  const action = overviewAction(items, working);
  const frame = overviewFrame({ steps, tickets });
  const stage = stageFromActivity({
    runStatus: working ? "running" : (status?.run?.status ?? null),
    lastAction: status?.run?.lastAction ?? status?.lastEvent ?? action ?? null,
    stepKinds: steps.map((step) => step.kind),
  });
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Overview">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <BuiButton tone="accent" label="Start" onClick={onStart} disabled={busy}>
            Start
          </BuiButton>
          <BuiButton label="Pause" onClick={onPause} disabled={busy}>
            Pause
          </BuiButton>
          <BuiButton label="Stop" onClick={onStop} disabled={busy}>
            Stop
          </BuiButton>
        </div>
        <div className="flex flex-wrap gap-6">
          <TodayCount label={OVERVIEW_COUNTS.newToday} value={newToday} max={newPerDay} />
          <TodayCount label={OVERVIEW_COUNTS.liveToday} value={liveToday} max={livePerDay} />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,380px)]">
        <ComputerPane
          working={working}
          action={action}
          stage={stage}
          frame={frame}
          loadArtifact={loadArtifact}
        />
        <div className="flex min-h-[520px] flex-col gap-3 lg:max-h-[calc(100dvh-9rem)]">
          <ActivityFeed items={items} />
          {status?.costs ? <CostNote costs={status.costs} /> : null}
        </div>
      </div>
    </section>
  );
}

function TodayCount({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <p className="text-[15px] text-[#ECECEE]">
      <span className="text-[#A6A6AD]">{label} </span>
      <span className="tabular-nums">{`${value}/${max}`}</span>
    </p>
  );
}

function ComputerPane({
  working,
  action,
  stage,
  frame,
  loadArtifact,
}: {
  working: boolean;
  action: string;
  stage: (typeof WORK_STAGES)[number];
  frame: ReturnType<typeof overviewFrame>;
  loadArtifact?: ArtifactLoader;
}) {
  const label = action || WORK_STAGE_LABELS[stage];
  const stageIndex = WORK_STAGES.indexOf(stage);
  return (
    <section
      aria-label="Computer"
      data-frame={frame?.kind ?? "pending"}
      data-stage={stage}
      className="relative flex min-h-[520px] flex-col overflow-hidden rounded-[16px] border border-[#2A2A31] bg-[#101012]"
      style={{ boxShadow: "var(--bui-shadow-card)" }}
    >
      <div className="flex h-10 items-center gap-2 border-b border-[#2A2A31] bg-[#101012] px-3">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: working ? "var(--bui-green)" : "#3a3a40" }}
        />
        <ol aria-label="Stage" className="flex min-w-0 gap-1 overflow-hidden">
          {WORK_STAGES.map((name, index) => {
            const current = name === stage;
            const done = index < stageIndex;
            return (
              <li
                key={name}
                aria-current={current ? "step" : undefined}
                className={`rounded-full px-2 py-0.5 text-[12px] ${
                  current
                    ? "bg-[#232327] text-[#ECECEE]"
                    : done
                      ? "text-[#C8C8CD]"
                      : "text-[#8A8A90]"
                }`}
              >
                {current && working ? (
                  <Shimmer>{WORK_STAGE_LABELS[name]}</Shimmer>
                ) : (
                  WORK_STAGE_LABELS[name]
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="relative min-h-[480px] flex-1">
        {frame?.kind === "url" ? (
          <iframe title="Computer" src={frame.url} className="absolute inset-0 h-full w-full" />
        ) : (
          <WorkingScreen working={working} label={label} stage={stage} />
        )}
        {frame?.kind === "artifact" && loadArtifact ? (
          <ArtifactShot
            artifactId={frame.artifactId}
            load={loadArtifact}
            label="Computer"
            untilReady="blank"
            className="absolute inset-0 z-[1] h-full w-full bg-[#0c0c0e] object-contain"
          />
        ) : null}
        {working && frame?.kind === "url" ? (
          <div className="absolute bottom-4 left-4 z-20">
            <LoadingState label={label} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function WorkingScreen({
  working,
  label,
  stage,
}: {
  working: boolean;
  label: string;
  stage: (typeof WORK_STAGES)[number];
}) {
  return (
    <div
      className="grid min-h-[480px] place-items-center p-6"
      style={{
        backgroundColor: "#0c0c0e",
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }}
    >
      <BuiCard className="w-full max-w-lg p-5" aria-label={label}>
        <div className="text-[12px] text-[#A6A6AD]">
          {working ? <Shimmer>{WORK_STAGE_LABELS[stage]}</Shimmer> : WORK_STAGE_LABELS[stage]}
        </div>
        <div className="mt-3">
          {working ? (
            <LoadingState label={label} />
          ) : (
            <p className="text-[15px] text-[#ECECEE]">{label}</p>
          )}
        </div>
      </BuiCard>
    </div>
  );
}

function ActivityFeed({ items }: { items: OverviewFeedItem[] }) {
  const scroller = useRef<HTMLElement>(null);
  const tail = `${items.length}:${items[items.length - 1]?.id ?? ""}`;
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [tail]);
  return (
    <section
      ref={scroller}
      className="rk-scroll min-h-0 flex-1 overflow-y-auto"
      aria-label="Activity"
      aria-live="polite"
    >
      <BuiCard className="overflow-hidden">
        {items.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-[#85858A]">No events yet</p>
        ) : (
          items.map((item) => (
            <TaskRow
              key={item.id}
              status={item.status}
              label={item.label}
              meta={feedMeta(item.at)}
            />
          ))
        )}
      </BuiCard>
    </section>
  );
}

function feedMeta(at: string | null): string | undefined {
  if (!at) return undefined;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function CostNote({ costs }: { costs: NonNullable<LbProjectStatusView["costs"]> }) {
  const line = (label: string, row: LbProjectStatusView["costs"]["day"]) =>
    `${label} ${row.modelTokens} tokens · ${row.searchQueries} searches · ${row.proxyLeaseDays} proxy days`;
  return (
    <p className="text-[12px] text-[#6C6C70]">
      {line("Today", costs.day)}
      <span className="mx-2">·</span>
      {line("Week", costs.week)}
    </p>
  );
}

function TargetList({ project }: { project: LbProjectDetail }) {
  if (project.targets.length === 0) {
    return <p className="text-[13px] text-[#85858A]">No pages to link yet</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {project.targets.map((target) => (
        <li key={target.url} className="text-[14px] text-[#ECECEE]">
          <div>{target.url}</div>
          {target.keywordClusters[0] ? (
            <div className="text-[12.5px] text-[#A6A6AD]">Keyword {target.keywordClusters[0]}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function HostBoard({ hosts, researching }: { hosts: LbHostView[]; researching?: boolean }) {
  if (hosts.length === 0) {
    return (
      <section aria-label="Hosts">
        {researching ? <LoadingState label="Researching" /> : null}
      </section>
    );
  }
  return (
    <section className="flex gap-3 overflow-x-auto" aria-label="Host funnel">
      {FUNNEL_COLUMNS.map((column) => {
        const rows = hosts.filter((host) => funnelColumnId(host.status) === column.id);
        return (
          <section key={column.id} className="min-w-40 flex-1" aria-label={column.label}>
            <h2 className="mb-2 text-[12px] uppercase tracking-wide text-[#85858A]">
              {column.label}
            </h2>
            <div className="flex flex-col gap-2">
              {rows.map((host) => (
                <BuiCard key={host.id} className="px-3 py-2 text-[13px] text-[#ECECEE]">
                  <div>{host.registrableDomain}</div>
                  <div className="text-[12px] text-[#A6A6AD]">
                    {host.platform}
                    {host.captchaType ? ` · ${host.captchaType}` : ""}
                    {` · ${host.hrefForNewMembers}`}
                  </div>
                  <div className="text-[12px] text-[#85858A]">
                    {[host.country, host.language, host.locale, host.timezoneId]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {host.statusReason ? (
                    <div className="text-[12px] text-[#85858A]">{host.statusReason}</div>
                  ) : null}
                </BuiCard>
              ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}

function ThreadList({
  threads,
  drafts,
  draftsOnly,
  onDecide,
}: {
  threads: LbThreadView[];
  drafts: LbDraftView[];
  draftsOnly: boolean;
  onDecide?: (draftId: string, decision: "approved" | "discarded") => void;
}) {
  return (
    <section className="flex flex-col gap-3" aria-label="Threads and drafts">
      {threads.map((thread) => (
        <div key={thread.id} className="text-[14px] text-[#ECECEE]">
          <div>{thread.title}</div>
          <div className="text-[12px] text-[#85858A]">{thread.relevance.toFixed(2)}</div>
        </div>
      ))}
      {drafts.map((draft) => (
        <BuiCard key={draft.id} className="flex flex-col gap-2 p-3 text-[13px] text-[#C9C9CE]">
          <p>{draft.body}</p>
          {draft.qualityChecks.issues.length > 0 ? (
            <ul aria-label="Fit check">
              {draft.qualityChecks.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          {draftsOnly && draft.status === "drafted" && onDecide ? (
            <div className="flex gap-2">
              <BuiButton label="Approve draft" onClick={() => onDecide(draft.id, "approved")}>
                Approve
              </BuiButton>
              <BuiButton label="Discard draft" onClick={() => onDecide(draft.id, "discarded")}>
                Discard
              </BuiButton>
            </div>
          ) : null}
        </BuiCard>
      ))}
    </section>
  );
}

function PlacementTable({
  rows,
  onVerify,
}: {
  rows: LbPlacementView[];
  onVerify: (placementId: string) => void;
}) {
  return (
    <table className="w-full text-left text-[13px] text-[#ECECEE]">
      <thead className="text-[#85858A]">
        <tr>
          <th className="py-2">Host</th>
          <th>rel</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-[#2A2A31]">
            <td className="py-2">{row.domain}</td>
            <td>{row.rel.join(" ") || "—"}</td>
            <td>{row.status}</td>
            <td className="flex gap-2 py-2">
              <BuiButton label={`Verify ${row.domain}`} onClick={() => onVerify(row.id)}>
                Verify
              </BuiButton>
              {row.snapshotArtifactId ? (
                <a
                  href={`/artifacts/${row.snapshotArtifactId}`}
                  className="self-center text-[#A6A6AD]"
                >
                  Snapshot
                </a>
              ) : (
                <span className="self-center text-[#85858A]">No snapshot</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Resolves an artifact id to an image URL, or null when the artifact is not an image. */
export type ArtifactLoader = (artifactId: string) => Promise<string | null>;

export function ArtifactShot({
  artifactId,
  load,
  label,
  className = "w-full rounded-[12px] border border-[#2A2A31]",
  untilReady = "loader",
}: {
  artifactId: string;
  load: ArtifactLoader;
  label: string;
  className?: string;
  /** `blank` keeps the surrounding pane visible until the image arrives. */
  untilReady?: "loader" | "blank";
}) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setSrc(undefined);
    load(artifactId)
      .then((next) => {
        if (live) setSrc(next);
      })
      .catch(() => {
        if (live) setSrc(null);
      });
    return () => {
      live = false;
    };
  }, [artifactId, load]);
  if (src === undefined) return untilReady === "blank" ? null : <LoadingState label={label} />;
  if (src === null) return null;
  return <img src={src} alt={label} className={className} />;
}

function RunTimeline({
  runs,
  steps,
  loadArtifact,
}: {
  runs: LbRunView[];
  steps: LbRunStepView[];
  loadArtifact?: ArtifactLoader;
}) {
  const withShots = steps.filter((step) => step.artifactIds.length > 0);
  const [picked, setPicked] = useState<string | null>(null);
  const shown =
    withShots.find((step) => step.id === picked) ?? withShots[withShots.length - 1] ?? null;
  return (
    <div className="flex flex-col gap-3">
      {runs.map((run) => (
        <div key={run.id} className="text-[13px] text-[#A6A6AD]">
          {run.date} · {run.status} · {run.lastAction}
        </div>
      ))}
      <ol className="flex flex-col gap-2" aria-label="Run steps">
        {steps.map((step) => {
          const text = `${step.stepIndex + 1}. ${step.lastAction ?? step.kind}`;
          return (
            <li key={step.id} className="text-[14px] text-[#ECECEE]">
              {loadArtifact && step.artifactIds.length > 0 ? (
                <button
                  type="button"
                  aria-pressed={shown?.id === step.id}
                  className={`text-left ${shown?.id === step.id ? "text-[#ECECEE]" : "text-[#A6A6AD]"}`}
                  onClick={() => setPicked(step.id)}
                >
                  {text}
                </button>
              ) : (
                text
              )}
              {step.kind === "coherence_refused" || step.kind === "edge_block" ? (
                <span className="ml-2 text-[13px] text-[#E8B931]">{step.kind}</span>
              ) : null}
              {step.error ? (
                <span className="ml-2 text-[13px] text-[#E5484D]">{step.error}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {loadArtifact && shown ? (
        <ArtifactShot
          artifactId={shown.artifactIds[0]!}
          load={loadArtifact}
          label={`Step ${shown.stepIndex + 1} screenshot`}
        />
      ) : null}
    </div>
  );
}

function CaptchaPanel({
  captchas,
  tickets,
  onOpenTicket,
}: {
  captchas: Array<{ id: string; outcome: string; domain: string | null }>;
  tickets: LbOperatorTicketView[];
  onOpenTicket: (ticketId: string) => void;
}) {
  const events = captchas.filter((event) => !isFixtureHostDomain(event.domain ?? ""));
  const handoff = tickets.filter(
    (ticket) => ticket.reason !== "captcha_unsolved" && !isFixtureHostDomain(ticket.domain ?? ""),
  );
  return (
    <div className="flex flex-col gap-3">
      {events.map((event) => (
        <div key={event.id} className="text-[13px] text-[#C9C9CE]">
          <div>
            {event.domain} · {event.outcome}
          </div>
          {event.outcome === "sandbox" ? (
            <div className="text-[12px] text-[#E8B931]">
              Sandbox answer. The solver is not production-configured.
            </div>
          ) : null}
        </div>
      ))}
      {handoff.map((ticket) => (
        <BuiCard key={ticket.id} className="flex items-center justify-between p-3">
          <span className="text-[14px] text-[#ECECEE]">
            {ticket.domain} · {ticket.status}
            {ticketCountdown(ticket.expiresAt) ? ` · ${ticketCountdown(ticket.expiresAt)}` : ""}
          </span>
          {ticket.status === "open" ? (
            <BuiButton
              label={`Open computer for ${ticket.domain}`}
              onClick={() => onOpenTicket(ticket.id)}
            >
              Open computer
            </BuiButton>
          ) : null}
        </BuiCard>
      ))}
    </div>
  );
}

function SettingsPanel({
  project,
  leases,
}: {
  project: LbProjectDetail;
  leases: LbProxyLeaseView[];
}) {
  return (
    <BuiCard className="flex flex-col gap-2 p-4 text-[13px] text-[#C9C9CE]">
      <div>How posts identify you: {disclosureLabel(project.disclosureMode)}</div>
      <div>Countries {project.markets.map((market) => market.country).join(", ")}</div>
      <div>
        {project.linkRatio.links} {project.linkRatio.links === 1 ? "link" : "links"} in every{" "}
        {project.linkRatio.posts} posts
      </div>
      <div>Proxy {project.proxyPolicy.replaceAll("_", " ")}</div>
      <div>Forums to skip {project.denyHosts.join(", ") || "none"}</div>
      <ul aria-label="Proxy leases" className="flex flex-col gap-1">
        {leases.length === 0 ? <li>No active lease</li> : null}
        {leases.map((lease) => (
          <li key={lease.id}>
            {lease.country} · {lease.kind.replaceAll("_", " ")} ·{" "}
            {lease.expiresAt ? lease.expiresAt.slice(0, 16) : "open"} · {lease.providerId}
          </li>
        ))}
      </ul>
    </BuiCard>
  );
}

function BrandFields({
  draft,
  onChange,
}: {
  draft: WizardDraft;
  onChange: (draft: WizardDraft) => void;
}) {
  return (
    <>
      <Field label="Project name">
        <input
          aria-label="Project name"
          className={inputClass}
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </Field>
      <Field label="Brand name">
        <input
          aria-label="Brand name"
          className={inputClass}
          value={draft.brandName}
          onChange={(event) => onChange({ ...draft, brandName: event.target.value })}
        />
      </Field>
      <Field label="Sites posts may link to">
        <input
          aria-label="Sites posts may link to"
          className={inputClass}
          value={draft.allowedDomains}
          placeholder="https://www.example.com/de"
          onChange={(event) => onChange({ ...draft, allowedDomains: event.target.value })}
        />
        <p className="mt-1 text-[12px] text-[#85858A]">
          A domain, www, https, or a path. Separate several sites with a comma.
        </p>
      </Field>
    </>
  );
}

function PersonaFields({
  draft,
  onChange,
}: {
  draft: WizardDraft;
  onChange: (draft: WizardDraft) => void;
}) {
  return (
    <>
      <Field label="Name on forums">
        <input
          aria-label="Name on forums"
          className={inputClass}
          value={draft.displayName}
          onChange={(event) => onChange({ ...draft, displayName: event.target.value })}
        />
      </Field>
      <Field label="Bio on forums">
        <textarea
          aria-label="Bio on forums"
          className={`${inputClass} min-h-20`}
          value={draft.bio}
          onChange={(event) => onChange({ ...draft, bio: event.target.value })}
        />
      </Field>
      {draft.markets[0]?.language === "de" ? (
        <Field label="Address people as">
          <select
            aria-label="Address people as"
            className={inputClass}
            value={draft.register}
            onChange={(event) =>
              onChange({ ...draft, register: event.target.value as "du" | "sie" })
            }
          >
            <option value="du">du, informal</option>
            <option value="sie">sie, formal</option>
          </select>
        </Field>
      ) : null}
      <div className="text-[13px] text-[#A6A6AD]">
        {draft.mailboxAddress
          ? `Forum mail arrives at ${draft.mailboxAddress}`
          : "The inbox is created when you continue."}
      </div>
    </>
  );
}

function QuotaFields({
  draft,
  onChange,
}: {
  draft: WizardDraft;
  onChange: (draft: WizardDraft) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Field label={QUOTA_LABELS.newPerDay}>
          <input
            aria-label={QUOTA_LABELS.newPerDay}
            className={inputClass}
            value={draft.newPerDay}
            onChange={(event) => onChange({ ...draft, newPerDay: event.target.value })}
          />
        </Field>
        <Field label={QUOTA_LABELS.livePerDay}>
          <input
            aria-label={QUOTA_LABELS.livePerDay}
            className={inputClass}
            value={draft.livePerDay}
            onChange={(event) => onChange({ ...draft, livePerDay: event.target.value })}
          />
        </Field>
        <Field label={QUOTA_LABELS.liveWeek}>
          <input
            aria-label={QUOTA_LABELS.liveWeek}
            className={inputClass}
            value={draft.liveWeekCap}
            onChange={(event) => onChange({ ...draft, liveWeekCap: event.target.value })}
          />
        </Field>
      </div>
      <Field label="Time zone for posting">
        <input
          aria-label="Time zone for posting"
          className={inputClass}
          value={draft.timezone}
          onChange={(event) => onChange({ ...draft, timezone: event.target.value })}
        />
      </Field>
      <p className="text-[13px] text-[#A6A6AD]">{warmupNote(24)}</p>
    </>
  );
}

function TopicFields({
  draft,
  onChange,
  onSuggestPage,
}: {
  draft: WizardDraft;
  onChange: (next: WizardDraft | ((current: WizardDraft) => WizardDraft)) => void;
  onSuggestPage?: (input: {
    url: string;
    allowedDomains: string[];
  }) => Promise<{ keyword: string; rule: string }>;
}) {
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const asked = useRef(new Set<string>());
  const pending = draft.pages
    .map((page) => {
      const url = normalizePageUrl(page.url);
      if (!url || (page.keyword.trim() && page.rules.trim())) return "";
      return `${page.id}:${url}`;
    })
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    if (!onSuggestPage || !pending) return;
    const domains = pageDomains(draftRef.current);
    for (const page of draftRef.current.pages) {
      const url = normalizePageUrl(page.url);
      if (!url || asked.current.has(url)) continue;
      if (page.keyword.trim() && page.rules.trim()) continue;
      asked.current.add(url);
      void onSuggestPage({ url, allowedDomains: domains }).then((suggestion) => {
        onChange((current) => ({
          ...current,
          pages: current.pages.map((item) => {
            if (item.id !== page.id || normalizePageUrl(item.url) !== url) return item;
            return {
              ...item,
              keyword: item.keyword.trim() ? item.keyword : suggestion.keyword,
              rules: item.rules.trim() ? item.rules : suggestion.rule,
            };
          }),
        }));
      });
    }
  }, [pending, onChange, onSuggestPage]);
  const atLimit = draft.pages.length >= PAGE_BOX_LIMIT;
  return (
    <div className="flex flex-col gap-3">
      {draft.pages.map((page, index) => (
        <BuiCard key={page.id} className="flex flex-col gap-3 p-4">
          {draft.pages.length > 1 ? (
            <div className="flex justify-end">
              <button
                type="button"
                aria-label={`Remove page ${index + 1}`}
                className="text-[13px] text-[#A6A6AD]"
                onClick={() => onChange(removeWizardPage(draft, index))}
              >
                Remove
              </button>
            </div>
          ) : null}
          <Field label="Page">
            <input
              aria-label={`Page ${index + 1}`}
              className={inputClass}
              inputMode="url"
              value={page.url}
              onChange={(event) => onChange(updatePage(draft, index, { url: event.target.value }))}
            />
          </Field>
          <Field label="Keyword">
            <input
              aria-label={`Keyword ${index + 1}`}
              className={inputClass}
              value={page.keyword}
              maxLength={80}
              onChange={(event) =>
                onChange(updatePage(draft, index, { keyword: event.target.value }))
              }
            />
          </Field>
          <Field label="Rules">
            <textarea
              aria-label={`Rules ${index + 1}`}
              className={`${inputClass} min-h-20`}
              value={page.rules}
              maxLength={500}
              onChange={(event) =>
                onChange(updatePage(draft, index, { rules: event.target.value }))
              }
            />
          </Field>
        </BuiCard>
      ))}
      <button
        type="button"
        aria-label="Add a page"
        disabled={atLimit}
        className="h-10 rounded-xl border border-[#2A2A31] text-[18px] text-[#ECECEE] disabled:cursor-not-allowed disabled:text-[#4A4A50]"
        onClick={() => onChange(addWizardPage(draft))}
      >
        +
      </button>
    </div>
  );
}

function updatePage(
  draft: WizardDraft,
  index: number,
  patch: Partial<Pick<WizardDraft["pages"][number], "url" | "keyword" | "rules">>,
): WizardDraft {
  return {
    ...draft,
    pages: draft.pages.map((page, item) => (item === index ? { ...page, ...patch } : page)),
  };
}

function ReviewFields({ draft }: { draft: WizardDraft }) {
  return (
    <dl className="flex flex-col gap-2 text-[13px]">
      {(
        [
          ["Brand name", draft.brandName],
          ["Sites", draft.allowedDomains || "—"],
          ["Countries", draft.markets.map((market) => market.country).join(", ")],
          ["Name on forums", draft.displayName || "—"],
          ["Inbox", draft.mailboxAddress ?? "—"],
          ...draft.pages
            .filter((page) => page.url.trim() || page.keyword.trim())
            .flatMap((page, index) => [
              [`Page ${index + 1}`, page.url || "—"],
              [`Keyword ${index + 1}`, page.keyword || "—"],
              [`Rules ${index + 1}`, page.rules || "—"],
            ]),
          [QUOTA_LABELS.newPerDay, draft.newPerDay],
          [QUOTA_LABELS.livePerDay, draft.livePerDay],
          [QUOTA_LABELS.liveWeek, draft.liveWeekCap || "—"],
          ["How posts identify you", disclosureLabel(draft.disclosureMode)],
        ] as const
      ).map(([label, value]) => (
        <div key={label}>
          <dt className="text-[#85858A]">{label}</dt>
          <dd className="text-[#C9C9CE]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block text-[12.5px] text-[#A6A6AD]">
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CreditBudget({
  balance,
  note,
  busy,
  onBuy,
}: {
  balance: number | null;
  note?: string | null;
  busy: boolean;
  onBuy?: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="text-[13px] text-[#ECECEE]">
        <span className="tabular-nums">{balance ?? "—"}</span>
        <span className="text-[#A6A6AD]"> credits</span>
      </div>
      <BuiButton label="Add credits" onClick={onBuy} disabled={busy || !onBuy}>
        Add credits
      </BuiButton>
      {note ? <p className="max-w-56 text-right text-[12px] text-[#A6A6AD]">{note}</p> : null}
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-[#232327] px-2 py-1 text-[12px] text-[#ECECEE]">{label}</span>
  );
}

function Ring({ label, value, max }: { label: string; value: number; max: number }) {
  const radius = 16;
  const circ = 2 * Math.PI * radius;
  const pct = max <= 0 ? 0 : Math.min(1, value / max);
  return (
    <div role="img" className="flex items-center gap-2" aria-label={`${label} ${value} of ${max}`}>
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r={radius} stroke="#2A2A31" strokeWidth="3" fill="none" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          stroke="#7785ff"
          strokeWidth="3"
          fill="none"
          strokeDasharray={`${circ * pct} ${circ}`}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <span className="text-[12px] text-[#ECECEE]">
        {label} {value}/{max}
      </span>
    </div>
  );
}

function WeekBar({ value, max }: { value: number; max: number | null }) {
  const pct = !max || max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      role="img"
      className="min-w-24 flex-1"
      aria-label={`${QUOTA_LABELS.liveWeek} ${value} of ${max ?? value}`}
    >
      <div className="mb-1 text-[12px] text-[#A6A6AD]">
        {QUOTA_LABELS.liveWeek} {value}
        {max ? `/${max}` : ""}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#2A2A31]">
        <div className="h-full bg-[#3dbb72]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
