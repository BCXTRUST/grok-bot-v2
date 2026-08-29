import { describe, expect, it } from "vitest";
import { computerObservation } from "./computer-support.js";
import {
  MAX_OBSERVE_WITHOUT_ACT,
  OBSERVE_WITHOUT_ACT_ERROR,
  observationScreenshot,
  observationToolResult,
  parseComputerActions,
  shouldAttachObservationToThread,
  shouldRefuseObserve,
} from "./computer-tools.js";

describe("computer tool bridge", () => {
  it("normalizes a bounded batch into provider-neutral actions", () => {
    expect(
      parseComputerActions([
        { kind: "click", x: 20.4, y: 30.6 },
        { kind: "type", text: "hello" },
        { kind: "scroll", direction: "up", amount: 999 },
      ]),
    ).toEqual([
      { kind: "pointer", x: 20, y: 31, type: "click", button: "left" },
      { kind: "clipboard", text: "hello" },
      { kind: "scroll", direction: "up", amount: 20 },
    ]);
  });

  it("rejects batches whose expanded double-click actions exceed the limit", () => {
    expect(() =>
      parseComputerActions(
        Array.from({ length: 13 }, () => ({ kind: "click", x: 10, y: 10, double: true })),
      ),
    ).toThrow(/more than 24/);
  });

  it("returns observations as model-visible image content", () => {
    const observation = computerObservation(Uint8Array.from([1, 2, 3]), {
      mimeType: "image/png",
      width: 1280,
      height: 800,
    });
    const result = observationToolResult(observation);
    expect(result.content).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "image", data: "AQID", mimeType: "image/png" },
    ]);
    expect(observationScreenshot(result)).toEqual({
      bytes: Uint8Array.from([1, 2, 3]),
      mimeType: "image/png",
      name: "computer-screen.png",
    });
  });

  it("does not resend an unchanged screenshot", () => {
    const observation = computerObservation(Uint8Array.from([1, 2, 3]), {
      mimeType: "image/png",
      width: 1280,
      height: 800,
    });
    const result = observationToolResult(observation, "observed", observation.frameId);

    expect(result.content).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("unchanged") }),
    ]);
  });

  it("names open windows so the model can close Files without asking", () => {
    const observation = computerObservation(Uint8Array.from([1, 2, 3]), {
      mimeType: "image/png",
      width: 1280,
      height: 800,
      windows: [
        { id: "1", title: "Files", focused: true },
        { id: "2", title: "Living with chronic pain" },
      ],
    });
    const result = observationToolResult(observation);
    const text = result.content.find((part) => part.type === "text");
    expect(text && "text" in text ? text.text : "").toContain("Files (focused)");
    expect(text && "text" in text ? text.text : "").toContain("Living with chronic pain");
  });

  it("tells the model to leave a CAPTCHA wall", () => {
    const observation = computerObservation(Uint8Array.from([1, 2, 3]), {
      mimeType: "image/png",
      width: 1280,
      height: 800,
      windows: [{ id: "1", title: "https://www.google.com/sorry/index", focused: true }],
    });
    const result = observationToolResult(observation);
    const text = result.content.find((part) => part.type === "text");
    expect(text && "text" in text ? text.text : "").toContain("Leave with open_path");
  });

  it("caps observe-without-act and skips duplicate chat screenshots", () => {
    expect(MAX_OBSERVE_WITHOUT_ACT).toBe(2);
    expect(shouldRefuseObserve(0)).toBe(false);
    expect(shouldRefuseObserve(2)).toBe(true);
    expect(OBSERVE_WITHOUT_ACT_ERROR).toMatch(/computer_act or open_path/);
    expect(
      shouldAttachObservationToThread({
        unchanged: false,
        source: "observe",
        attachedObserveInStreak: true,
      }),
    ).toBe(false);
    expect(
      shouldAttachObservationToThread({
        unchanged: false,
        source: "act",
        attachedObserveInStreak: true,
      }),
    ).toBe(true);
  });
});
