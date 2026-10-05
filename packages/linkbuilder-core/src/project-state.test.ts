import { describe, expect, it } from "vitest";
import { IllegalTransition } from "./errors.js";
import { transitionProject } from "./project-state.js";

describe("project state", () => {
  it("starts, pauses, resumes, and stops", () => {
    expect(transitionProject("draft", "active")).toBe("active");
    expect(transitionProject("active", "paused")).toBe("paused");
    expect(transitionProject("paused", "active")).toBe("active");
    expect(transitionProject("active", "stopped")).toBe("stopped");
    expect(transitionProject("stopped", "active")).toBe("active");
  });

  it("rejects an illegal jump", () => {
    expect(() => transitionProject("draft", "paused")).toThrow(IllegalTransition);
    expect(() => transitionProject("archived", "active")).toThrow(IllegalTransition);
  });
});
