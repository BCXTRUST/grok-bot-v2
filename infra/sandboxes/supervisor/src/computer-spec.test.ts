import { describe, expect, it } from "vitest";
import {
  COMPUTER_IMAGE,
  containerCreateOptions,
  containerNameFor,
  screenUrlFor,
  xdotoolCommand,
} from "./computer-spec.js";

describe("graphical computer spec", () => {
  it("creates a VNC desktop, not an alpine sleep fallback", () => {
    const options = containerCreateOptions({
      name: "rakazo-bot-abc",
      image: COMPUTER_IMAGE,
      botId: "abc",
      workspaceId: "ws",
      homePath: "/var/rakazo/homes/abc",
    });
    expect(options.Image).toBe("rakazo/computer:local");
    expect(options.Image).not.toMatch(/alpine/);
    expect(options).not.toHaveProperty("Entrypoint");
    expect(JSON.stringify(options)).not.toMatch(/sleep/);
    expect(options.HostConfig.Binds).toEqual(["/var/rakazo/homes/abc:/home/rakazo"]);
    expect(options.Env).toContain(
      "PATH=/home/rakazo/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
    expect(options.Env).toContain("NPM_CONFIG_PREFIX=/home/rakazo/.local");
    expect(options.ExposedPorts).toEqual({ "6080/tcp": {} });
    expect(options.HostConfig.PortBindings["6080/tcp"]?.[0]?.HostIp).toBe("127.0.0.1");
  });

  it("keeps container names stable so a bot can resume", () => {
    expect(containerNameFor("bot_1")).toBe("rakazo-bot-bot_1");
    expect(containerNameFor("bot_1")).toBe(containerNameFor("bot_1"));
  });

  it("points the screen at the chrome-less noVNC embed", () => {
    expect(screenUrlFor("16080")).toBe("http://127.0.0.1:16080/embed.html");
  });

  it("turns takeover input into xdotool", () => {
    expect(xdotoolCommand({ kind: "key", key: "Enter" })).toEqual([
      "xdotool",
      "key",
      "--clearmodifiers",
      "Return",
    ]);
    expect(xdotoolCommand({ kind: "pointer", x: 10, y: 20, type: "click" })).toEqual([
      "xdotool",
      "mousemove",
      "--",
      "10",
      "20",
      "click",
      "1",
    ]);
  });
});
