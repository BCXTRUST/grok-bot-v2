import type {
  LbDraftView,
  LbHostView,
  LbOperatorTicketView,
  LbProjectCard,
  LbProjectDetail,
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
  createdAt: "2026-10-05T12:00:00.000Z",
};

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
          onCheckBalance={() => undefined}
          onStart={() => undefined}
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
    draft.lanes = [{ id: "lane-schlaf", tag: "Schlaf", description: "Abend" }];
    return (
      <div className="min-h-screen bg-[#050506]">
        <WizardView
          step={6}
          draft={draft}
          issues={[]}
          busy={false}
          started={false}
          onChange={() => undefined}
          onBack={() => undefined}
          onNext={() => undefined}
          onCheckBalance={() => undefined}
          onStart={() => undefined}
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
