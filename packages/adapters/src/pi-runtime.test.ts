import { describe, expect, it } from "vitest";
import { describeToolActivity, preferComputerVisionModel } from "./pi-runtime.js";

describe("describeToolActivity", () => {
  it("summarizes builtin tools with their most informative argument", () => {
    expect(describeToolActivity("shell", { command: "pnpm test --filter web" })).toBe(
      "Running: pnpm test --filter web",
    );
    expect(describeToolActivity("read_file", { path: "notes/plan.md" })).toBe(
      "Reading notes/plan.md",
    );
    expect(describeToolActivity("write_file", { path: "out.csv", content: "…" })).toBe(
      "Writing out.csv",
    );
    expect(describeToolActivity("render_plot", { spec: {} })).toBe("Rendering a chart");
    expect(describeToolActivity("add_mcp_server", { name: "Linear" })).toBe(
      "Connecting MCP server: Linear",
    );
    expect(describeToolActivity("run_subagent", { name: "scout", task: "…" })).toBe(
      "Delegating to helper: scout",
    );
  });

  it("names MCP server and remote tool", () => {
    expect(describeToolActivity("mcp__brex__list_expenses", {})).toBe("Using brex: list_expenses");
    expect(describeToolActivity("mcp__demo-oauth__greet", {})).toBe("Using demo-oauth: greet");
  });

  it("truncates long details and collapses whitespace", () => {
    const long = `x${"y".repeat(200)}`;
    const line = describeToolActivity("shell", { command: `a\n\t${long}` });
    expect(line.length).toBeLessThanOrEqual("Running: ".length + 91);
    expect(line).toContain("…");
    expect(line).not.toContain("\n");
    expect(line).toMatch(/^Running: a x/);
  });

  it("redacts credentials from activity details", () => {
    const token = "fake-token";
    const line = describeToolActivity("shell", {
      command: `curl -H 'Authorization: Bearer ${token}' https://example.test?api_key=fake-key password=fake-password`,
    });

    expect(line).toContain("Bearer [redacted]");
    expect(line).toContain("api_key=[redacted]");
    expect(line).not.toContain(token);
    expect(line).not.toContain("fake-key");
    expect(line).not.toContain("fake-password");
  });

  it("falls back to the tool name", () => {
    expect(describeToolActivity("destination_write", undefined)).toBe("Using destination_write");
  });
});

describe("preferComputerVisionModel", () => {
  const textOnly = { id: "deepseek/deepseek-v4-flash-0731", provider: "openrouter", input: ["text"] };
  const vision = {
    id: "openai/gpt-4.1-mini",
    provider: "openrouter",
    input: ["text", "image"],
  };
  const models = {
    getModel: (provider: string, id: string) =>
      provider === "openrouter" && id === vision.id ? vision : undefined,
  };

  it("keeps a text-only model when the run has no computer", () => {
    expect(preferComputerVisionModel(models as never, textOnly as never, [])).toBe(textOnly);
  });

  it("keeps a model that already accepts images", () => {
    expect(
      preferComputerVisionModel(models as never, vision as never, [
        { name: "computer_observe" } as never,
      ]),
    ).toBe(vision);
  });

  it("swaps a text-only model for a vision model when computer_observe is present", () => {
    expect(
      preferComputerVisionModel(models as never, textOnly as never, [
        { name: "computer_observe" } as never,
      ]),
    ).toBe(vision);
  });

  it("synthesizes a vision OpenRouter model when the catalog has no fallback", () => {
    const empty = { getModel: () => undefined };
    const chosen = preferComputerVisionModel(empty as never, textOnly as never, [
      { name: "computer_observe" } as never,
    ]);
    expect(chosen.id).toBe("openai/gpt-4.1-mini");
    expect(chosen.input).toContain("image");
  });
});

