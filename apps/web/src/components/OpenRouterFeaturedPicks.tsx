import { OPENROUTER_FEATURED_MODELS, OPENROUTER_PROVIDER_ID } from "@rakazo/contracts";

export function OpenRouterFeaturedPicks({
  provider,
  selectedId,
  onSelect,
}: {
  provider: string;
  selectedId: string;
  onSelect: (modelId: string) => void;
}) {
  if (provider !== OPENROUTER_PROVIDER_ID) return null;
  return (
    <fieldset className="mt-3 flex flex-wrap gap-2 border-0 p-0">
      <legend className="sr-only">OpenRouter featured models</legend>
      {OPENROUTER_FEATURED_MODELS.map((entry) => {
        const selected = selectedId === entry.id;
        return (
          <button
            key={entry.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(entry.id)}
            className={`rounded-[11px] border px-3.5 py-2 text-sm ${
              selected
                ? "border-[#ECECEE] bg-[#1A1A1D] text-[#F1F1F2]"
                : "border-[#26262A] text-[#ECECEE] hover:bg-[#161618]"
            }`}
          >
            {entry.label}
          </button>
        );
      })}
    </fieldset>
  );
}
