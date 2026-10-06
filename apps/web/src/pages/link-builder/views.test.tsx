import type {
  LbDraftView,
  LbHostView,
  LbOperatorTicketView,
  LbPlacementView,
  LbProjectDetail,
  LbProjectStatusView,
  LbRunStepView,
  LbWhyNot,
} from "@rakazo/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyDraft, emptyPage, PAGE_BOX_LIMIT } from "./model.js";
import { LinkBuilderPreview } from "./preview.js";
import { CreditPackagesView, OperatorView, ProjectView, WizardView } from "./views.js";

const noop = () => undefined;
const loadArtifact = async () => "data:image/png;base64,iVBO";

function step(index: number, kind: string, artifactIds: string[]): LbRunStepView {
  return {
    id: `step-${index}`,
    stepIndex: index,
    kind,
    hostId: "host-1",
    lastAction: kind,
    error: null,
    costs: { credits: 0, tokens: 0, bytes: 0, ms: 0 },
    artifactIds,
    createdAt: "2026-10-05T12:00:00.000Z",
  };
}

describe("link builder screens", () => {
  it("shows proxy leases without credentials and names coherence and edge blocks", () => {
    const settings = renderToStaticMarkup(<LinkBuilderPreview screen="settings" />);
    expect(settings).toContain("static isp per persona");
    expect(settings).toContain("DE");
    expect(settings).toContain("static isp");
    expect(settings).toContain("iproyal");
    expect(settings).toContain('aria-label="Proxy leases"');
    expect(settings).toContain('aria-label="Settings"');
    expect(settings).toContain('aria-label="Page 1"');
    expect(settings).toContain('aria-label="Save settings"');
    expect(settings).toContain("New accounts per day");
    expect(settings).toContain('aria-label="Name on forums"');
    expect(settings).toContain('aria-label="Window start"');
    expect(settings).not.toContain("password");
    expect(settings).not.toContain("secret");
    expect(settings).not.toContain('role="tablist"');
    const runs = renderToStaticMarkup(<LinkBuilderPreview screen="runs" />);
    expect(runs).toContain("Coherence refused");
    expect(runs).toContain("Edge block");
    expect(runs).not.toContain('role="tablist"');
  });

  it("shows NEW and LIVE rings and an operator pill", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="dashboard" />);
    expect(html).toContain("New accounts per day");
    expect(html).toContain("Live links per day");
    expect(html).toContain("Live links per week");
    expect(html).toContain("needs operator ×1");
    expect(html).toContain("Parked fragen.nordlicht.example");
  });

  it("puts the responsibility sentence under Start building and does not render a checkbox", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="review" />);
    expect(html).toContain("Start building");
    expect(html).toContain("responsible for this content");
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Writes as the persona");
    expect(html).toContain("New accounts per day");
    expect(html).not.toContain("New / day");
    expect(html).not.toContain("Week cap");
  });

  it("offers continue and skip on the operator ticket", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="operator" />);
    expect(html).toContain("solved it, continue");
    expect(html).toContain("Skip host");
    expect(html).toContain("Live screen");
    expect(html).toContain("fragen.nordlicht.example");
  });

  it("shows the latest step screenshot on the dashboard computer", () => {
    const html = renderToStaticMarkup(
      <ProjectView
        project={{ name: "Nordlicht" } as LbProjectDetail}
        status={null}
        hosts={[]}
        placements={[]}
        steps={[
          step(0, "select_host", []),
          step(1, "open_session", ["a1"]),
          step(2, "post", ["a2"]),
        ]}
        threads={[]}
        drafts={[]}
        tickets={[]}
        surface="dashboard"
        onSurface={noop}
        onStart={noop}
        onPause={noop}
        onStop={noop}
        loadArtifact={loadArtifact}
        busy={false}
      />,
    );
    expect(html).toContain('data-frame="artifact"');
    expect(html).toContain('aria-label="Computer"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain(">Runs<");
  });

  it("shows the parked screenshot on an operator ticket without a live screen", () => {
    const ticket = {
      id: "ticket-1",
      projectId: "demo",
      hostId: "host-1",
      domain: "fragen.nordlicht.example",
      runId: "run-1",
      reason: "captcha_unsolved",
      screenUrl: null,
      screenshotArtifactId: "shot-1",
      note: null,
      status: "open",
      expiresAt: "2026-10-05T18:00:00.000Z",
      createdAt: "2026-10-05T12:00:00.000Z",
    } satisfies LbOperatorTicketView;
    const props = {
      ticket,
      note: "",
      busy: false,
      done: null,
      onNote: noop,
      onContinue: noop,
      onSkip: noop,
    };
    const html = renderToStaticMarkup(<OperatorView {...props} loadArtifact={loadArtifact} />);
    expect(html).toContain("Screenshot");
    expect(html).not.toContain('aria-label="Live screen"');
    expect(renderToStaticMarkup(<OperatorView {...props} />)).toContain('aria-label="Live screen"');
  });

  it("does not ask the customer to solve a captcha", () => {
    const html = renderToStaticMarkup(
      <ProjectView
        project={{ name: "Vitaminexpress" } as LbProjectDetail}
        status={null}
        hosts={[]}
        placements={[]}
        steps={[]}
        threads={[]}
        drafts={[]}
        tickets={[
          {
            id: "ticket-1",
            projectId: "demo",
            hostId: "host-1",
            domain: "fragen-1ej2xe.example",
            runId: "run-1",
            reason: "captcha_unsolved",
            screenUrl: null,
            screenshotArtifactId: null,
            note: null,
            status: "open",
            expiresAt: null,
            createdAt: "2026-10-05T12:00:00.000Z",
          },
          {
            id: "ticket-2",
            projectId: "demo",
            hostId: "host-2",
            domain: "board.example.org",
            runId: "run-1",
            reason: "missing_password",
            screenUrl: null,
            screenshotArtifactId: null,
            note: null,
            status: "open",
            expiresAt: null,
            createdAt: "2026-10-05T12:00:00.000Z",
          },
        ]}
        surface="dashboard"
        onSurface={noop}
        onStart={noop}
        onPause={noop}
        onStop={noop}
        busy={false}
      />,
    );
    expect(html).not.toContain("fragen-1ej2xe.example");
    expect(html).not.toContain("I've solved it");
    expect(html).not.toContain("Open computer");
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain(">Captchas<");
  });

  it("shows the forums and links the bot picked, and hides fixture boards", () => {
    const html = renderToStaticMarkup(
      <ProjectView
        project={{ name: "Vitaminexpress", slug: "vitaminexpress" } as LbProjectDetail}
        status={null}
        hosts={
          [
            { id: "host-1", registrableDomain: "fragen-1ej2xe.example", status: "qualified" },
            { id: "host-2", registrableDomain: "rueckenforum.de", status: "qualified" },
          ] as LbHostView[]
        }
        placements={
          [
            { id: "place-1", domain: "brett-1ej2xe.example", status: "live", rel: [] },
            { id: "place-2", domain: "board.example.org", status: "live", rel: [] },
          ] as LbPlacementView[]
        }
        steps={[]}
        threads={[]}
        drafts={[]}
        tickets={[]}
        surface="dashboard"
        onSurface={noop}
        onStart={noop}
        onPause={noop}
        onStop={noop}
        busy={false}
      />,
    );
    expect(html).toContain('aria-label="Forums"');
    expect(html).toContain("rueckenforum.de");
    expect(html).toContain('aria-label="Links placed"');
    expect(html).toContain("board.example.org");
    expect(html).not.toContain("fragen-");
    expect(html).not.toContain("brett-");
    expect(html).not.toContain(">Hosts<");
    expect(html).not.toContain(">Placements<");
  });

  it("does not open a captcha handoff on the dashboard", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="captchas" />);
    expect(html).not.toContain("placed_submitted");
    expect(html).not.toContain("Sandbox answer");
    expect(html).not.toContain(">Captchas<");
    expect(html).toContain('aria-label="Settings"');
  });

  it("gives each page its own box and stops the plus at 10", () => {
    const draft = emptyDraft();
    draft.allowedDomains = "nordlicht.example";
    const one = renderToStaticMarkup(
      <WizardView
        step={3}
        draft={draft}
        issues={[]}
        busy={false}
        started={false}
        onChange={noop}
        onBack={noop}
        onNext={noop}
        onStart={noop}
        onGoTo={noop}
      />,
    );
    expect(one).toContain("Keyword");
    expect(one).toContain("Rules");
    expect(one).toContain('aria-label="Page 1"');
    expect(one).toContain('aria-label="Add a page"');
    expect(one).not.toContain("Remove page");
    expect(one).not.toContain("Topic to write about");
    const full = {
      ...draft,
      pages: Array.from({ length: PAGE_BOX_LIMIT }, (_, index) => ({
        ...emptyPage(),
        id: `page-${index}`,
        url: index === 0 ? "https://nordlicht.example/schlaf" : "",
      })),
    };
    const ten = renderToStaticMarkup(
      <WizardView
        step={3}
        draft={full}
        issues={[]}
        busy={false}
        started={false}
        onChange={noop}
        onBack={noop}
        onNext={noop}
        onStart={noop}
        onGoTo={noop}
      />,
    );
    expect(ten).toContain('aria-label="Add a page" disabled');
    expect(ten).toContain('aria-label="Remove page 2"');
    expect(ten).not.toContain("Topic to write about");
  });

  it("renders the brand step", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="wizard" />);
    expect(html).toContain("Brand &amp; domains");
    expect(html).toContain("Persona &amp; inbox");
    expect(html).toContain("Quotas &amp; schedule");
    expect(html).toContain("Topics &amp; targets");
    expect(html).toContain("Review");
    expect(html).not.toContain("Policy");
    expect(html).not.toContain("Countries to post in");
    expect(html).not.toContain("Forums to skip");
    expect(html).not.toContain("How posts identify you");
    expect(html).toContain("nordlicht.example");
    expect(html).toContain('aria-label="Setup steps"');
    expect(html).toContain("Step 1 of 5");
    expect(html).not.toContain("M20 6 9 17 4 12");
    expect(emptyDraft().disclosureMode).toBe("undisclosed_persona");
  });

  it("marks earlier steps done beside the review form", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="review" />);
    expect(html.split("M20 6 9 17 4 12").length - 1).toBe(4);
    expect(html).not.toContain("Policy");
    expect(html).not.toContain("Captell token");
    expect(html).not.toContain("Check balance");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Step 5 of 5: Review");
  });

  it("shows the computer working and a growing feed instead of NEW/LIVE rings", () => {
    const discovered = step(0, "research", []);
    discovered.lastAction = "Checking Google for on-topic forums";
    const probed = step(1, "research", ["shot-1"]);
    probed.lastAction = "Looking for threads";
    const html = renderOverview(statusView({ activity: "running", activityLabel: "running" }), [
      discovered,
      probed,
    ]);
    expect(html).toContain("New accounts per day");
    expect(html).toContain("Live links today");
    expect(html).toContain(">0/2</span>");
    expect(html).toContain(">0/1</span>");
    expect(html).not.toContain("New links today");
    expect(html).not.toContain("NEW ");
    expect(html).not.toContain("LIVE ");
    expect(html).toContain('aria-label="Computer"');
    expect(html).toContain('aria-label="Stage"');
    expect(html).toContain("Register");
    expect(html).toContain("Warmup");
    expect(html).toContain("Place");
    expect(html).toContain("Verify");
    expect(html).toContain("bui-pixel-on");
    expect(html).toContain('data-status="working"');
    expect(html).toContain('data-frame="artifact"');
    expect(html).not.toContain("forum-a.example");
    expect(html.indexOf('aria-label="Looking for threads"')).toBeLessThan(
      html.indexOf("Checking Google for on-topic forums"),
    );
    expect(html.indexOf("Checking Google for on-topic forums")).toBeLessThan(
      html.lastIndexOf("Looking for threads"),
    );
    expect(html).not.toContain("Why not");
    expect(html).not.toContain("Proxy ok");
    expect(html).not.toContain("Supply");
    expect(html).not.toContain("Live screen");
    expect(html.indexOf('aria-label="Computer"')).toBeLessThan(html.indexOf("12 tokens"));
  });

  it("shows the stage rail and the current action when no screen exists", () => {
    const reading = step(0, "research", []);
    reading.lastAction = "Checking Google for on-topic forums";
    const html = renderOverview(
      statusView({
        activity: "running",
        activityLabel: "running",
        lastEvent: "Checking Google for on-topic forums",
        run: {
          id: "run-1",
          date: "2026-10-06",
          status: "running",
          newToday: 0,
          liveToday: 0,
          liveWeek: 0,
          uniqueHosts: 0,
          lastAction: "Checking Google for on-topic forums",
          lastError: null,
        },
      }),
      [reading],
    );
    expect(html).toContain('data-frame="pending"');
    expect(html).toContain('data-stage="research"');
    expect(html).toContain('aria-label="Stage"');
    expect(html).toContain("Research");
    expect(html).toContain("Register");
    expect(html).toContain("Warmup");
    expect(html).toContain("Place");
    expect(html).toContain("Verify");
    expect(html).toContain('aria-label="Checking Google for on-topic forums"');
    expect(html.indexOf('aria-label="Checking Google for on-topic forums"')).toBeLessThan(
      html.indexOf("No session"),
    );
    expect(html).toContain("bui-pixel-on");
    expect(html).toContain("No session");
    expect(html).toContain('data-session="closed"');
    expect(html).toContain('data-pixel="trail"');
    expect(html).toContain('aria-label="Settings"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain(">Overview<");
    expect(html).not.toContain(">Targets<");
    expect(html).not.toContain(">Hosts<");
    expect(html).not.toContain(">Threads<");
    expect(html).not.toContain(">Placements<");
    expect(html).not.toContain(">Runs<");
    expect(html).not.toContain(">Captchas<");
    expect(html).not.toContain("I've solved it");
    expect(html).not.toContain("28px 28px");
  });

  it("stays on research when Verify has no placement, and still shows a frame", () => {
    const reading = step(0, "research", []);
    reading.lastAction = "Continuing";
    const verify = step(1, "lb_verify", ["shot-9"]);
    verify.lastAction = "Verify";
    const html = renderOverview(
      statusView({
        activity: "running",
        activityLabel: "running",
        lastEvent: "Continuing",
        run: {
          id: "run-1",
          date: "2026-10-06",
          status: "running",
          newToday: 0,
          liveToday: 0,
          liveWeek: 0,
          uniqueHosts: 0,
          lastAction: "Continuing",
          lastError: null,
        },
      }),
      [reading, verify],
    );
    expect(html).toContain('data-stage="research"');
    expect(html).toContain('data-frame="artifact"');
    const workingAt = html.indexOf('data-status="working"');
    const row = html.slice(workingAt, workingAt + 2500);
    expect(row).toContain("Continuing");
    expect(row).not.toContain("Verify");
    expect(html).not.toContain("I've solved it");
    expect(html).not.toContain("fragen-");
    expect(html).toContain("New accounts per day");
    expect(html).toContain("Live links today");
  });

  it("hides a fixture draft on a customer project", () => {
    const html = renderOverview(
      statusView({ activity: "running", activityLabel: "running" }),
      [],
      [
        {
          id: "draft-1",
          threadCandidateId: "thread-1",
          body: "Eine feste Uhrzeit hilft oft. Das hier erklärt es ganz gut.",
          status: "posted",
          linkSlot: "inline",
          modelLane: "draft",
          modelId: "fake-draft",
          targetUrl: null,
          anchorText: null,
          confidence: null,
          qualityChecks: {
            factsOnly: true,
            noBannedClaims: true,
            registerMatches: true,
            lengthOk: true,
            singleLink: true,
            notTestimonial: true,
            issues: [],
          },
        },
      ],
    );
    expect(html).not.toContain("feste Uhrzeit");
    expect(html).not.toContain("nordlicht.example");
  });

  it("keeps a calm computer when the run is paused and hides an all-zero why-not list", () => {
    const html = renderOverview(
      statusView({
        activity: "paused",
        activityLabel: "paused",
        lastEvent: "Looking for threads",
      }),
      [],
    );
    expect(html).not.toContain("bui-pixel-on");
    expect(html).toContain('aria-label="Computer"');
    expect(html).toContain("Looking for threads");
    expect(html).not.toContain(".example");
    expect(html).toContain("New accounts per day");
    expect(html).not.toContain("New links today");
    expect(html).not.toContain("Why not");
    expect(html).not.toContain("Parked 0");
    expect(html).not.toContain("Proxy ok");
  });

  it("puts real blockers in the feed after the computer", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="overview" />);
    expect(html).toContain("New accounts per day");
    expect(html).toContain("Live links today");
    expect(html).not.toContain("New links today");
    expect(html).toContain("Parked 1");
    expect(html).toContain("Pending email 2");
    expect(html).toContain("Spam blocked 1");
    expect(html).not.toContain("Why not");
    expect(html).not.toContain("Proxy ok");
    expect(html).not.toContain("Unsupported captcha 0");
    expect(html.indexOf('aria-label="Computer"')).toBeLessThan(html.indexOf("Parked 1"));
    expect(html.indexOf("New accounts per day")).toBeLessThan(html.indexOf("40 tokens"));
  });

  it("shows credit packages with prices before a project exists", () => {
    const html = renderToStaticMarkup(
      <CreditPackagesView
        packages={[
          {
            id: "starter",
            name: "Starter",
            credits: 200,
            priceCents: 2900,
            currency: "eur",
            recommended: false,
          },
          {
            id: "growth",
            name: "Growth",
            credits: 1000,
            priceCents: 9900,
            currency: "eur",
            recommended: true,
          },
        ]}
        balance={80}
        reason="Checkout is not connected. No card was charged and credits were not added."
        busy={false}
        onBuy={() => undefined}
      />,
    );
    expect(html).toContain("€29");
    expect(html).toContain("€99");
    expect(html).toContain("200 credits");
    expect(html).toContain("1,000 credits");
    expect(html).toContain('aria-label="Buy Starter"');
    expect(html).toContain('aria-label="Buy Growth"');
    expect(html).toContain('aria-label="Setup"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Checkout is not connected");
    expect(html).not.toContain("Brand &amp; domains");
  });
});

const zeroWhy: LbWhyNot = {
  supply: { qualified: 0, ready: 0 },
  parked: 0,
  spamBlocked: 0,
  unsupportedCaptcha: 0,
  pendingEmail: 0,
  pendingAdmin: 0,
  modelErrors: 0,
  modelRefusals: 0,
  captchaBalance: null,
  proxy: "ok",
  reasons: ["host_supply_exhausted"],
};

function statusView(overrides: Partial<LbProjectStatusView> = {}): LbProjectStatusView {
  return {
    projectId: "demo",
    projectStatus: "active",
    activity: "running",
    activityLabel: "running",
    run: {
      id: "run-1",
      date: "2026-10-06",
      status: "running",
      newToday: 0,
      liveToday: 0,
      liveWeek: 0,
      uniqueHosts: 1,
      lastAction: "Probed brett-1ej2xe.example",
      lastError: null,
    },
    whyNot: zeroWhy,
    operatorQueue: 0,
    scheduleActive: true,
    scheduleReason: "in_window",
    newPerDay: 2,
    livePerDay: 1,
    liveWeekCap: 8,
    lastEvent: "Probed brett-1ej2xe.example",
    costs: {
      day: { captellCredits: 0, modelTokens: 12, searchQueries: 1, proxyLeaseDays: 0 },
      week: { captellCredits: 0, modelTokens: 12, searchQueries: 1, proxyLeaseDays: 0 },
    },
    ...overrides,
  };
}

function renderOverview(
  status: LbProjectStatusView,
  steps: LbRunStepView[],
  drafts: LbDraftView[] = [],
) {
  return renderToStaticMarkup(
    <ProjectView
      project={{ name: "Vitaminexpress" } as LbProjectDetail}
      status={status}
      hosts={[]}
      placements={[]}
      steps={steps}
      threads={[]}
      drafts={drafts}
      tickets={[]}
      surface="dashboard"
      onSurface={noop}
      onStart={noop}
      onPause={noop}
      onStop={noop}
      loadArtifact={loadArtifact}
      busy={false}
    />,
  );
}
