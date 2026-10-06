import type {
  LbDraftView,
  LbHostView,
  LbOperatorTicketView,
  LbProjectCard,
  LbProjectDetail,
  LbProjectStatusView,
  LbThreadView,
} from "@rakazo/contracts";
import { emptyDraft } from "./model.js";
import { DashboardView, OperatorView, ProjectView, WizardView } from "./views.js";

const card: LbProjectCard = {
  id: "demo",
  name: "Nordlicht",
  slug: "nordlicht-wellness",
  status: "active",
  brandName: "Nordlicht",
  activity: "needs_operator",
  activityLabel: "needs operator ×1",
  newToday: 1,
  liveToday: 1,
  liveWeek: 1,
  newPerDay: 2,
  livePerDay: 2,
  liveWeekCap: 8,
  runStatus: "partial",
  lastEvent: "Parked fragen.nordlicht.example for an operator",
  operatorQueue: 1,
};

const ticket: LbOperatorTicketView = {
  id: "ticket-1",
  projectId: "demo",
  hostId: "host-1",
  domain: "fragen.nordlicht.example",
  runId: "run-1",
  reason: "captcha_unsolved",
  screenUrl: null,
  screenshotArtifactId: null,
  note: null,
  status: "open",
  expiresAt: "2026-10-05T17:12:00.000Z",
  createdAt: "2026-10-05T12:00:00.000Z",
};

const PREVIEW_NOW = Date.parse("2026-10-05T12:00:00.000Z");

/** Dev-only fixture screens for visual checks. Not linked from the product. */
export function LinkBuilderPreview({ screen }: { screen: string }) {
  if (screen === "wizard") {
    const draft = emptyDraft();
    draft.name = "Nordlicht";
    draft.brandName = "Nordlicht";
    draft.allowedDomains = "nordlicht.example";
    return (
      <div className="min-h-screen bg-[#050506]">
        <WizardView
          step={0}
          draft={draft}
          issues={[]}
          busy={false}
          started={false}
          onChange={() => undefined}
          onBack={() => undefined}
          onNext={() => undefined}
          onStart={() => undefined}
          onGoTo={() => undefined}
        />
      </div>
    );
  }
  if (screen === "review") {
    const draft = emptyDraft();
    draft.name = "Nordlicht";
    draft.brandName = "Nordlicht";
    draft.allowedDomains = "nordlicht.example";
    draft.displayName = "Mira Sol";
    draft.mailboxAddress = "mira.sol@inbox.example";
    draft.mailboxId = "mbx-nordlicht-demo";
    draft.captchaConfigured = true;
    draft.pages = [
      {
        id: "page-schlaf",
        url: "https://nordlicht.example/schlaf",
        keyword: "Schlaf",
        rules: "Abend",
      },
    ];
    return (
      <div className="min-h-screen bg-[#050506]">
        <WizardView
          step={5}
          draft={draft}
          issues={[]}
          busy={false}
          started={false}
          onChange={() => undefined}
          onBack={() => undefined}
          onNext={() => undefined}
          onStart={() => undefined}
          onGoTo={() => undefined}
        />
      </div>
    );
  }
  if (screen === "captchas") {
    return (
      <div className="min-h-screen bg-[#050506]">
        <ProjectView
          project={{ name: "Nordlicht" } as LbProjectDetail}
          status={null}
          hosts={[]}
          placements={[]}
          runs={[]}
          steps={[]}
          threads={[]}
          drafts={[]}
          captchas={[
            { id: "cap-1", outcome: "placed_submitted", domain: "forum.nordlicht.example" },
            { id: "cap-2", outcome: "sandbox", domain: "fragen.nordlicht.example" },
          ]}
          tickets={[]}
          tab="Captchas"
          onTab={() => undefined}
          onStart={() => undefined}
          onPause={() => undefined}
          onStop={() => undefined}
          onVerify={() => undefined}
          onOpenTicket={() => undefined}
          busy={false}
        />
      </div>
    );
  }
  if (screen === "hosts") {
    const host: LbHostView = {
      id: "host-1",
      registrableDomain: "rueckenforum.example",
      homepageUrl: "https://rueckenforum.example/",
      platform: "phpbb",
      country: "DE",
      language: "de",
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
      status: "qualified",
      parkedFrom: null,
      qualityScore: 0.9,
      topicTags: ["Rückenschmerzen"],
      captchaType: "image_letters",
      hrefForNewMembers: "after_n_posts",
      relDefault: "ugc",
      signatureLinks: false,
      minPostsForLinks: 2,
      registerUrl: "https://rueckenforum.example/ucp.php?mode=register",
      statusReason: null,
    };
    return (
      <div className="min-h-screen bg-[#050506]">
        <ProjectView
          project={{ name: "Nordlicht", disclosureMode: "undisclosed_persona" } as LbProjectDetail}
          status={null}
          hosts={[
            host,
            {
              ...host,
              id: "host-2",
              registrableDomain: "arkose-board.example",
              status: "unsupported_captcha",
              captchaType: "unsupported",
              statusReason: "unsupported_captcha",
            },
          ]}
          placements={[]}
          runs={[]}
          steps={[]}
          threads={[]}
          drafts={[]}
          captchas={[]}
          tickets={[]}
          tab="Hosts"
          onTab={() => undefined}
          onStart={() => undefined}
          onPause={() => undefined}
          onStop={() => undefined}
          onVerify={() => undefined}
          onOpenTicket={() => undefined}
          busy={false}
        />
      </div>
    );
  }
  if (screen === "threads") {
    const thread: LbThreadView = {
      id: "thread-1",
      hostId: "host-1",
      domain: "rueckenforum.example",
      url: "https://rueckenforum.example/viewtopic.php?t=11",
      title: "Was hilft bei Rückenschmerzen?",
      excerpt: "Nach dem Büro wird es steif.",
      status: "candidate",
      relevance: 0.86,
      openQuestion: true,
      laneId: "lane-ruecken",
      rejectReason: null,
    };
    const draft: LbDraftView = {
      id: "draft-1",
      threadCandidateId: thread.id,
      body: "Kurze Pausen und Dehnen helfen vielen. Schau mal hier, da ist das ganz gut erklärt.",
      status: "drafted",
      linkSlot: "inline",
      modelLane: "draft",
      modelId: "recorded-draft",
      targetUrl: "https://nordlicht.example/ruecken",
      anchorText: "Dehnen",
      confidence: 0.84,
      qualityChecks: {
        factsOnly: false,
        noBannedClaims: true,
        registerMatches: true,
        lengthOk: true,
        singleLink: true,
        notTestimonial: true,
        issues: ["facts_only"],
      },
    };
    return (
      <div className="min-h-screen bg-[#050506]">
        <ProjectView
          project={{ name: "Nordlicht", disclosureMode: "drafts_only" } as LbProjectDetail}
          status={null}
          hosts={[]}
          placements={[]}
          runs={[]}
          steps={[]}
          threads={[thread]}
          drafts={[draft]}
          captchas={[]}
          tickets={[]}
          tab="Threads"
          onTab={() => undefined}
          onStart={() => undefined}
          onPause={() => undefined}
          onStop={() => undefined}
          onVerify={() => undefined}
          onOpenTicket={() => undefined}
          onDecideDraft={() => undefined}
          busy={false}
        />
      </div>
    );
  }
  if (screen === "settings") {
    return (
      <div className="min-h-screen bg-[#050506]">
        <ProjectView
          project={
            {
              name: "Nordlicht",
              disclosureMode: "undisclosed_persona",
              markets: [
                { country: "DE", language: "de", locale: "de-DE", timezoneId: "Europe/Berlin" },
              ],
              linkRatio: { links: 1, posts: 3 },
              proxyPolicy: "static_isp_per_persona",
              denyHosts: [],
            } as unknown as LbProjectDetail
          }
          status={null}
          hosts={[]}
          placements={[]}
          runs={[]}
          steps={[]}
          threads={[]}
          drafts={[]}
          leases={[
            {
              id: "lease-de",
              country: "DE",
              kind: "static_isp",
              providerId: "iproyal",
              expiresAt: "2026-10-12T12:00:00.000Z",
              status: "active",
            },
            {
              id: "lease-us",
              country: "US",
              kind: "residential",
              providerId: "oxylabs",
              expiresAt: "2026-10-06T12:00:00.000Z",
              status: "active",
            },
          ]}
          captchas={[]}
          tickets={[]}
          tab="Settings"
          onTab={() => undefined}
          onStart={() => undefined}
          onPause={() => undefined}
          onStop={() => undefined}
          onVerify={() => undefined}
          onOpenTicket={() => undefined}
          busy={false}
        />
      </div>
    );
  }
  if (screen === "runs") {
    return (
      <div className="min-h-screen bg-[#050506]">
        <ProjectView
          project={{ name: "Nordlicht" } as LbProjectDetail}
          status={null}
          hosts={[]}
          placements={[]}
          runs={[]}
          steps={[
            {
              id: "step-1",
              stepIndex: 0,
              kind: "coherence_refused",
              hostId: "host-1",
              lastAction: "Coherence refused",
              error: null,
              costs: { credits: 0, tokens: 0, bytes: 0, ms: 0 },
              artifactIds: [],
              createdAt: "2026-10-05T12:00:00.000Z",
            },
            {
              id: "step-2",
              stepIndex: 1,
              kind: "edge_block",
              hostId: "host-2",
              lastAction: "Edge block",
              error: null,
              costs: { credits: 0, tokens: 0, bytes: 0, ms: 0 },
              artifactIds: [],
              createdAt: "2026-10-05T12:05:00.000Z",
            },
          ]}
          threads={[]}
          drafts={[]}
          captchas={[]}
          tickets={[]}
          tab="Runs"
          onTab={() => undefined}
          onStart={() => undefined}
          onPause={() => undefined}
          onStop={() => undefined}
          onVerify={() => undefined}
          onOpenTicket={() => undefined}
          busy={false}
        />
      </div>
    );
  }
  if (screen === "overview") {
    const status: LbProjectStatusView = {
      projectId: "demo",
      projectStatus: "active",
      activity: "out_of_window",
      activityLabel: "out of window",
      run: {
        id: "run-1",
        date: "2026-10-05",
        status: "partial",
        newToday: 1,
        liveToday: 1,
        liveWeek: 1,
        uniqueHosts: 2,
        lastAction: "Day closed",
        lastError: null,
      },
      whyNot: {
        supply: { qualified: 3, ready: 0 },
        parked: 1,
        spamBlocked: 1,
        unsupportedCaptcha: 0,
        pendingEmail: 2,
        pendingAdmin: 0,
        modelErrors: 0,
        modelRefusals: 0,
        captchaBalance: 120,
        proxy: "ok",
        reasons: ["host_supply_exhausted", "pending_email", "operator_parked", "spam_filtered"],
      },
      operatorQueue: 1,
      scheduleActive: false,
      scheduleReason: "after_window",
      newPerDay: 2,
      livePerDay: 2,
      liveWeekCap: 8,
      lastEvent: "Paused, Captell balance is low",
      costs: {
        day: { captellCredits: 12, modelTokens: 40, searchQueries: 1, proxyLeaseDays: 1 },
        week: { captellCredits: 28, modelTokens: 90, searchQueries: 4, proxyLeaseDays: 2 },
      },
    };
    return (
      <div className="min-h-screen bg-[#050506]">
        <ProjectView
          project={{ name: "Nordlicht", disclosureMode: "undisclosed_persona" } as LbProjectDetail}
          status={status}
          hosts={[]}
          placements={[]}
          runs={[]}
          steps={[]}
          threads={[]}
          drafts={[]}
          captchas={[]}
          tickets={[]}
          tab="Overview"
          onTab={() => undefined}
          onStart={() => undefined}
          onPause={() => undefined}
          onStop={() => undefined}
          onVerify={() => undefined}
          onOpenTicket={() => undefined}
          busy={false}
        />
      </div>
    );
  }
  if (screen === "operator") {
    return (
      <div className="min-h-screen bg-[#050506]">
        <OperatorView
          ticket={ticket}
          note=""
          busy={false}
          done={null}
          onNote={() => undefined}
          onContinue={() => undefined}
          onSkip={() => undefined}
          now={PREVIEW_NOW}
        />
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[#050506]">
      <DashboardView
        cards={[card]}
        loading={false}
        onOpen={() => undefined}
        onNew={() => undefined}
      />
    </div>
  );
}
