import { describe, expect, it } from "vitest";
import { modelCredentialDto } from "./model-connect.js";
import { serializeModelSecret } from "./pi-oauth.js";

describe("modelCredentialDto", () => {
  it("returns stored baseUrl and modelId for openai-compatible credentials", () => {
    const plaintext = serializeModelSecret({
      kind: "openai_compatible",
      baseUrl: "https://example.invalid/v1",
    });
    expect(
      modelCredentialDto(
        {
          id: "cred-1",
          provider: "openai-compatible",
          label: "Local MLX",
          isDefault: true,
          defaultModel: "qwen3-4b",
        },
        plaintext,
      ),
    ).toEqual({
      id: "cred-1",
      provider: "openai-compatible",
      label: "Local MLX",
      hasKey: true,
      isDefault: true,
      baseUrl: "https://example.invalid/v1",
      modelId: "qwen3-4b",
    });
  });

  it("exposes the last selected model for hosted providers", () => {
    expect(
      modelCredentialDto({
        id: "cred-2",
        provider: "openrouter",
        label: "OpenRouter",
        isDefault: true,
        defaultModel: "openai/gpt-5",
      }),
    ).toMatchObject({ provider: "openrouter", modelId: "openai/gpt-5" });
  });
});
