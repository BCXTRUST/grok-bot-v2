import { describe, expect, it } from "vitest";
import {
  artifactImageUri,
  OPERATOR_TICKET_PATH,
  projectStatusLine,
  ticketActionBody,
} from "./link-builder.js";

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

  it("shows only raster screenshots", () => {
    expect(artifactImageUri({ mimeType: "image/png", contentBase64: "iVBO" })).toBe(
      "data:image/png;base64,iVBO",
    );
    expect(artifactImageUri({ mimeType: "text/html", contentBase64: "PGh0bWw+" })).toBeNull();
  });
});
