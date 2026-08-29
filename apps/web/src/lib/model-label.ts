import { DEFAULT_OPENROUTER_MODEL_ID, resolveOpenRouterModelId } from "@rakazo/core";

export function modelLabel(id: string | null | undefined, needsModel = false) {
  const resolved = resolveOpenRouterModelId(id ?? undefined);
  if (needsModel && (!id || resolved === "scripted")) return "Choose model";
  const target = !id || resolved === "scripted" ? DEFAULT_OPENROUTER_MODEL_ID : resolved;
  if (target.includes("grok-4.6")) return "Grok 4.6";
  if (target.includes("aion")) return "Grok 4.6";
  if (target.includes("grok")) return "Grok";
  const short = target.split("/").pop() ?? target;
  return short.replace(/-/g, " ");
}
