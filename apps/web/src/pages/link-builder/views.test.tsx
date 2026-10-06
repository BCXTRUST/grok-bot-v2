import type { LbOperatorTicketView, LbProjectDetail, LbRunStepView } from "@rakazo/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyDraft, emptyPage, PAGE_BOX_LIMIT } from "./model.js";
import { LinkBuilderPreview } from "./preview.js";
import { OperatorView, ProjectView, WizardView } from "./views.js";

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
    expect(settings).not.toContain("password");
    expect(settings).not.toContain("secret");
    const runs = renderToStaticMarkup(<LinkBuilderPreview screen="runs" />);
    expect(runs).toContain("coherence_refused");
    expect(runs).toContain("edge_block");
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

  it("lets the Runs tab pick a step screenshot, defaulting to the latest", () => {
    const html = renderToStaticMarkup(
      <ProjectView
        project={{ name: "Nordlicht" } as LbProjectDetail}
        status={null}
        hosts={[]}
        placements={[]}
        runs={[]}
        steps={[
          step(0, "select_host", []),
          step(1, "open_session", ["a1"]),
          step(2, "post", ["a2"]),
        ]}
        threads={[]}
        drafts={[]}
        captchas={[]}
        tickets={[]}
        tab="Runs"
        onTab={noop}
        onStart={noop}
        onPause={noop}
        onStop={noop}
        onVerify={noop}
        onOpenTicket={noop}
        loadArtifact={loadArtifact}
        busy={false}
      />,
    );
    expect(html.match(/aria-pressed/g)).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
    expect(html.indexOf('aria-pressed="true"')).toBeGreaterThan(html.indexOf("2. open_session"));
    expect(html).toContain("Step 3 screenshot");
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

  it("shows a sandbox hint on the Captchas tab", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="captchas" />);
    expect(html).toContain("placed_submitted");
    expect(html).toContain("Sandbox answer. The solver is not production-configured.");
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
    expect(html).toContain("nordlicht.example");
    expect(html).toContain('aria-label="Setup steps"');
    expect(html).not.toContain("M20 6 9 17 4 12");
    expect(emptyDraft().disclosureMode).toBe("undisclosed_persona");
  });

  it("marks earlier steps done beside the review form", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="review" />);
    expect(html.split("M20 6 9 17 4 12").length - 1).toBe(5);
    expect(html).not.toContain("Captell token");
    expect(html).not.toContain("Check balance");
    expect(html).toContain('aria-current="step"');
  });
});
