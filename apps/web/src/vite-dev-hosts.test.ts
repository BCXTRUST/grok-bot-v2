import { describe, expect, it } from "vitest";
import { VITE_ALLOWED_HOSTS } from "./vite-dev-hosts.js";

describe("Vite allowed hosts", () => {
  it("accepts every Host header so Cloudflare tunnels are not blocked", () => {
    expect(VITE_ALLOWED_HOSTS).toBe(true);
  });
});
