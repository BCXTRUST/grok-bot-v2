import type { LbOperatorTicketView, LbProjectCard } from "@rakazo/contracts";
import { emptyDraft } from "./model.js";
import { DashboardView, OperatorView, WizardView } from "./views.js";

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
