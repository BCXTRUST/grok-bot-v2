import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyDraft } from "./model.js";
import { LinkBuilderPreview } from "./preview.js";

describe("link builder screens", () => {
  it("shows NEW and LIVE rings and an operator pill", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="dashboard" />);
    expect(html).toContain("NEW");
    expect(html).toContain("LIVE");
    expect(html).toContain("needs operator ×1");
    expect(html).toContain("Parked fragen.nordlicht.example");
  });

  it("puts the responsibility sentence under Start building and does not render a checkbox", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="review" />);
    expect(html).toContain("Start building");
    expect(html).toContain("responsible for this content");
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("undisclosed persona");
  });

  it("offers continue and skip on the operator ticket", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="operator" />);
    expect(html).toContain("solved it, continue");
    expect(html).toContain("Skip host");
    expect(html).toContain("Live screen");
    expect(html).toContain("fragen.nordlicht.example");
  });

  it("renders the brand step", () => {
    const html = renderToStaticMarkup(<LinkBuilderPreview screen="wizard" />);
    expect(html).toContain("Brand &amp; domains");
    expect(html).toContain("nordlicht.example");
    expect(emptyDraft().disclosureMode).toBe("undisclosed_persona");
  });
});
