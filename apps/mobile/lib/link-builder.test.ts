import { describe, expect, it } from "vitest";
import { OPERATOR_TICKET_PATH, projectStatusLine, ticketActionBody } from "./link-builder.js";

describe("mobile link builder", () => {
  it("summarizes counters and run state", () => {
    expect(
      projectStatusLine({
        activityLabel: "needs operator ×1",
        newToday: 1,
        newPerDay: 2,
        liveToday: 1,
        livePerDay: 2,
      }),
    ).toBe("needs operator ×1 · NEW 1/2 · LIVE 1/2");
  });

  it("sends a note only when the operator typed one", () => {
    expect(ticketActionBody("  solved  ")).toEqual({ note: "solved" });
    expect(ticketActionBody("   ")).toEqual({});
    expect(OPERATOR_TICKET_PATH).toBe("/link-builder-ticket");
  });
});
