import { describe, expect, it } from "vitest";
import { choosePersonaComputer } from "./persona-computer.js";

describe("choosePersonaComputer", () => {
  it("prefers a running team computer", () => {
    const chosen = choosePersonaComputer([
      { scope: "dedicated", state: "running", providerRef: "desk" },
      { scope: "team", state: "running", providerRef: "team" },
    ]);
    expect(chosen?.providerRef).toBe("team");
  });

  it("uses a running dedicated computer when the workspace has no team machine", () => {
    const chosen = choosePersonaComputer([
      { scope: "team", state: "stopped", providerRef: null },
      { scope: "dedicated", state: "running", providerRef: "desk" },
    ]);
    expect(chosen).toMatchObject({ scope: "dedicated", providerRef: "desk" });
  });

  it("returns null when nothing is running", () => {
    expect(
      choosePersonaComputer([{ scope: "team", state: "stopped", providerRef: null }]),
    ).toBeNull();
  });
});
