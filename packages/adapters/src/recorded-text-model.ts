import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AdapterContext,
  AdapterDescriptor,
  ModelLane,
  TextModel,
  TextModelCapabilities,
  TextModelRequest,
  TextModelResult,
} from "@rakazo/adapter-kit";
import { z } from "zod";

/**
 * Replays `fixtures/models/<lane>/<prompt-hash>.json`. The hash is the lane plus the prompt.
 * A file may be a valid value, a recorded refusal, or an off-schema answer.
 */

const FileSchema = z.object({
  modelId: z.string().min(1).default("recorded"),
  ok: z.boolean().optional(),
  reason: z.enum(["refusal", "schema", "error"]).optional(),
  raw: z.string().optional(),
  value: z.unknown().optional(),
  tokens: z
    .object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() })
    .optional(),
});

export function textModelFixtureKey(lane: string, system: string, user: string): string {
  return createHash("sha256").update(`${lane}\n${system}\n${user}`).digest("hex").slice(0, 16);
}

export function recordedModelDir(from = import.meta.url): string {
  return new URL("../fixtures/models/", from).pathname;
}

export class RecordedTextModel implements TextModel {
  constructor(private readonly root: string) {}

  describe(): AdapterDescriptor<TextModelCapabilities> {
    return {
      id: "recorded-text-model",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { lanes: ["draft", "classify", "fallback"], structuredOutput: true },
    };
  }

  async complete<T>(
    request: TextModelRequest<T>,
    _context: AdapterContext,
  ): Promise<TextModelResult<T>> {
    const key = textModelFixtureKey(request.lane, request.system, request.user);
    const file = join(this.root, request.lane, `${key}.json`);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      return { ok: false, reason: "error", modelId: "recorded-missing", raw: "missing fixture" };
    }
    const parsed = FileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return { ok: false, reason: "schema", modelId: "recorded", raw: text.slice(0, 500) };
    }
    const row = parsed.data;
    if (row.ok === false || (row.reason && row.value === undefined)) {
      return {
        ok: false,
        reason: row.reason ?? "error",
        modelId: row.modelId,
        raw: row.raw,
      };
    }
    const value = request.schema.safeParse(row.value);
    if (!value.success) {
      return {
        ok: false,
        reason: "schema",
        modelId: row.modelId,
        raw: row.raw ?? JSON.stringify(row.value),
      };
    }
    return {
      ok: true,
      value: value.data,
      modelId: row.modelId,
      tokens: row.tokens ?? { input: 1, output: 1 },
    };
  }
}

export type { ModelLane };
