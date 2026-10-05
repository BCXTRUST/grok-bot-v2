import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AdapterContext,
  AdapterDescriptor,
  SearchProvider,
  SearchProviderCapabilities,
  WebSearchRequest,
  WebSearchResult,
} from "@rakazo/adapter-kit";
import { WebSearchRequestSchema, WebSearchResultSchema } from "@rakazo/adapter-kit";
import { z } from "zod";
import { searchFixtureKey } from "./dataforseo-search.js";

/**
 * Replays `fixtures/serp/<country>-<language>/<query-hash>.json`. A missing file is an empty
 * result, so a lane without a recording does not throw.
 */

const FileSchema = z.array(
  z.object({
    url: z.string(),
    title: z.string().default(""),
    snippet: z.string().optional(),
    description: z.string().optional(),
    domain: z.string().optional(),
  }),
);

export function recordedSerpDir(from = import.meta.url): string {
  return new URL("../fixtures/serp/", from).pathname;
}

export class RecordedSearchProvider implements SearchProvider {
  constructor(private readonly root: string) {}

  describe(): AdapterDescriptor<SearchProviderCapabilities> {
    return {
      id: "recorded-serp",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { maxDepth: 100, operators: true },
    };
  }

  async search(request: WebSearchRequest, _context: AdapterContext): Promise<WebSearchResult[]> {
    const parsed = WebSearchRequestSchema.parse(request);
    const folder = `${parsed.country}-${parsed.language}`;
    const file = join(this.root, folder, `${searchFixtureKey(parsed.query)}.json`);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      return [];
    }
    const rows = FileSchema.parse(JSON.parse(text));
    const results: WebSearchResult[] = [];
    for (const row of rows) {
      const parsedRow = WebSearchResultSchema.safeParse({
        url: row.url,
        title: row.title,
        snippet: row.snippet ?? row.description ?? "",
        domain: row.domain || new URL(row.url).hostname,
      });
      if (parsedRow.success) results.push(parsedRow.data);
      if (results.length >= parsed.depth) break;
    }
    return results;
  }
}
