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
import { useEffect, useState } from "react";
import {
  BuiButton,
  BuiCard,
  LoadingState,
  SuccessPop,
} from "../../components/beautiful-ui/primitives";
import {
  addMarket,
  disclosureLabel,
  FUNNEL_COLUMNS,
  funnelColumnId,
  LB_WIZARD_COUNTRIES,
  QUOTA_LABELS,
  RESPONSIBILITY_SENTENCE,
  removeMarket,
  WIZARD_STEP_HINTS,
  WIZARD_STEPS,
  type WizardDraft,
  warmupNote,
} from "./model.js";

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
}: {
  step: number;
  draft: WizardDraft;
  issues: string[];
  busy: boolean;
  started: boolean;
  onChange: (draft: WizardDraft) => void;
  onBack: () => void;
  onNext: () => void;
  onStart: () => void;
  onGoTo: (step: number) => void;
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
          <BuiCard className="flex flex-col gap-3 p-4">
            {step === 0 ? <BrandFields draft={draft} onChange={onChange} /> : null}
            {step === 1 ? <PersonaFields draft={draft} onChange={onChange} /> : null}
            {step === 2 ? <QuotaFields draft={draft} onChange={onChange} /> : null}
            {step === 3 ? <TopicFields draft={draft} onChange={onChange} /> : null}
            {step === 4 ? <PolicyFields draft={draft} onChange={onChange} /> : null}
            {step === last ? <ReviewFields draft={draft} /> : null}
            {issues.length > 0 ? (
              <ul className="flex flex-col gap-1 text-[13px] text-[#FF8B8B]" role="alert">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </BuiCard>
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
}) {
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
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-medium text-[#ECECEE]">{project.name}</h1>
        {status ? <Pill label={status.activityLabel} /> : null}
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
          busy={busy}
          onStart={onStart}
          onPause={onPause}
          onStop={onStop}
        />
      ) : null}
      {tab === "Targets" ? <TargetList project={project} /> : null}
      {tab === "Hosts" ? <HostBoard hosts={hosts} /> : null}
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
  busy,
  onStart,
  onPause,
  onStop,
}: {
  project: LbProjectDetail;
  status: LbProjectStatusView | null;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
}) {
  return (
    <BuiCard className="flex flex-col gap-4 p-4">
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
      <div className="flex flex-wrap gap-4">
        <Ring
          label={QUOTA_LABELS.newPerDay}
          value={status?.run?.newToday ?? 0}
          max={status?.newPerDay ?? project.quotas?.newPerDay ?? 0}
        />
        <Ring
          label={QUOTA_LABELS.livePerDay}
          value={status?.run?.liveToday ?? 0}
          max={status?.livePerDay ?? project.quotas?.livePerDay ?? 0}
        />
      </div>
      <div className="text-[13px] text-[#A6A6AD]">{status?.lastEvent ?? project.status}</div>
      {status?.whyNot && (status.run?.liveToday ?? 0) < (status.livePerDay ?? 0) ? (
        <section aria-label="Why not">
          <div className="text-[12px] text-[#85858A]">Why not</div>
          <ul className="mt-1 text-[13px] text-[#ECECEE]">
            <li>
              Supply {status.whyNot.supply.qualified} qualified, {status.whyNot.supply.ready} ready
            </li>
            <li>Parked {status.whyNot.parked}</li>
            <li>Spam blocked {status.whyNot.spamBlocked}</li>
            <li>Unsupported captcha {status.whyNot.unsupportedCaptcha}</li>
            <li>Pending email {status.whyNot.pendingEmail}</li>
            <li>Pending admin {status.whyNot.pendingAdmin}</li>
            <li>Model errors {status.whyNot.modelErrors}</li>
            <li>Proxy {status.whyNot.proxy}</li>
          </ul>
        </section>
      ) : null}
      {status?.costs ? (
        <section aria-label="Costs">
          <div className="text-[12px] text-[#85858A]">Costs</div>
          <p className="mt-1 text-[13px] text-[#ECECEE]">
            Today {status.costs.day.modelTokens} tokens · {status.costs.day.searchQueries} searches
            · {status.costs.day.proxyLeaseDays} proxy days
          </p>
          <p className="text-[13px] text-[#A6A6AD]">
            Week {status.costs.week.modelTokens} tokens · {status.costs.week.searchQueries} searches
            · {status.costs.week.proxyLeaseDays} proxy days
          </p>
        </section>
      ) : null}
      <div
        role="img"
        className="grid h-28 place-items-center rounded-xl border border-dashed border-[#2A2A31] text-[12.5px] text-[#85858A]"
        aria-label="Live screen thumbnail"
      >
        Live screen
      </div>
    </BuiCard>
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
          {target.url}
        </li>
      ))}
    </ul>
  );
}

function HostBoard({ hosts }: { hosts: LbHostView[] }) {
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
}: {
  artifactId: string;
  load: ArtifactLoader;
  label: string;
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
  if (src === undefined) return <LoadingState label={label} />;
  if (src === null) return null;
  return <img src={src} alt={label} className="w-full rounded-[12px] border border-[#2A2A31]" />;
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
  return (
    <div className="flex flex-col gap-3">
      {captchas.map((event) => (
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
      {tickets.map((ticket) => (
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
}: {
  draft: WizardDraft;
  onChange: (draft: WizardDraft) => void;
}) {
  const lane = draft.lanes[0];
  return (
    <>
      <Field label="Topic to write about">
        <input
          aria-label="Topic to write about"
          className={inputClass}
          value={lane?.tag ?? ""}
          onChange={(event) =>
            onChange({
              ...draft,
              lanes: [
                {
                  id: lane?.id ?? "lane",
                  tag: event.target.value,
                  description: lane?.description ?? "",
                },
              ],
            })
          }
        />
      </Field>
      <Field label="Page to link">
        <input
          aria-label="Page to link"
          className={inputClass}
          value={draft.targets[0]?.url ?? ""}
          onChange={(event) =>
            onChange({ ...draft, targets: [{ url: event.target.value, keywords: "" }] })
          }
        />
      </Field>
      <Field label="Facts the posts can use">
        <textarea
          aria-label="Facts the posts can use"
          className={`${inputClass} min-h-20`}
          value={draft.facts}
          onChange={(event) => onChange({ ...draft, facts: event.target.value })}
        />
      </Field>
    </>
  );
}

function PolicyFields({
  draft,
  onChange,
}: {
  draft: WizardDraft;
  onChange: (draft: WizardDraft) => void;
}) {
  return (
    <>
      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="text-[12.5px] text-[#A6A6AD]">Countries to post in</legend>
        <div className="flex flex-wrap gap-2">
          {LB_WIZARD_COUNTRIES.map((country) => {
            const selected = draft.markets.some((market) => market.country === country);
            return (
              <button
                key={country}
                type="button"
                aria-pressed={selected}
                aria-label={country}
                className={`rounded-full px-3 py-1 text-[13px] ${selected ? "bg-[#232327] text-[#ECECEE]" : "text-[#A6A6AD]"}`}
                onClick={() => onChange(toggleCountry(draft, country, selected))}
              >
                {country}
              </button>
            );
          })}
        </div>
      </fieldset>
      {draft.markets.map((market, index) => (
        <div key={`${market.country}-${market.language}`} className="grid grid-cols-2 gap-2">
          <Field label={`${market.country} language and region`}>
            <input
              aria-label={`${market.country} language and region`}
              className={inputClass}
              value={market.locale}
              onChange={(event) =>
                onChange({
                  ...draft,
                  markets: draft.markets.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, locale: event.target.value } : item,
                  ),
                })
              }
            />
          </Field>
          <Field label={`${market.country} time zone`}>
            <input
              aria-label={`${market.country} time zone`}
              className={inputClass}
              value={market.timezoneId}
              onChange={(event) =>
                onChange({
                  ...draft,
                  markets: draft.markets.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, timezoneId: event.target.value } : item,
                  ),
                  timezone: index === 0 ? event.target.value : draft.timezone,
                })
              }
            />
          </Field>
        </div>
      ))}
      <Field label="Forums to skip">
        <input
          aria-label="Forums to skip"
          className={inputClass}
          value={draft.denyHosts}
          onChange={(event) => onChange({ ...draft, denyHosts: event.target.value })}
        />
      </Field>
      <details>
        <summary className="cursor-pointer text-[13px] text-[#A6A6AD]">
          How posts identify you
        </summary>
        <select
          aria-label="How posts identify you"
          className={`${inputClass} mt-2`}
          value={draft.disclosureMode}
          onChange={(event) =>
            onChange({
              ...draft,
              disclosureMode: event.target.value as WizardDraft["disclosureMode"],
            })
          }
        >
          <option value="undisclosed_persona">{disclosureLabel("undisclosed_persona")}</option>
          <option value="disclosed_persona">{disclosureLabel("disclosed_persona")}</option>
          <option value="disclosed_brand">{disclosureLabel("disclosed_brand")}</option>
          <option value="drafts_only">{disclosureLabel("drafts_only")}</option>
        </select>
      </details>
    </>
  );
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

function toggleCountry(draft: WizardDraft, country: string, selected: boolean): WizardDraft {
  if (!selected) return addMarket(draft, country);
  const index = draft.markets.findIndex((market) => market.country === country);
  if (index < 0) return draft;
  return removeMarket(draft, index);
}
