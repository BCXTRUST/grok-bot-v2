import type { ModelCatalogEntry } from "@rakazo/contracts";
import { ChevronDown } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export function ModelPicker({
  options,
  value,
  onChange,
  allowCustom = false,
}: {
  options: ModelCatalogEntry[];
  value: string;
  onChange: (value: string) => void;
  allowCustom?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.id} ${option.label}`.toLowerCase().includes(needle),
    );
  }, [options, query]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const selected = options.find((option) => option.id === value);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    setHighlightedIndex(0);
    setOpen(false);
    setQuery("");
  }, [value]);

  useEffect(() => {
    if (!open) return;
    (filtered.length ? optionRefs.current[highlightedIndex] : searchRef.current)?.focus();
  }, [filtered.length, highlightedIndex, open]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function moveHighlight(index: number) {
    if (!filtered.length) return;
    setHighlightedIndex((index + filtered.length) % filtered.length);
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex(Math.max(filtered.length - 1, 0));
    }
  }

  function onOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(filtered.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = filtered[index];
      if (option) choose(option.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  const customQuery = query.trim();
  const showCustom = Boolean(
    allowCustom && customQuery && !options.some((option) => option.id === customQuery),
  );

  return (
    <div ref={rootRef} className="relative mt-2">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label="Model"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center justify-between rounded-[11px] border border-[#26262A] bg-[#101012] px-3.5 py-3 text-start text-[#ECECEE] outline-none focus-visible:border-[#4A4A50]"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="min-w-0 truncate">
          {selected?.label ?? value ?? options[selectedIndex]?.label}
        </span>
        <span className="ml-3 shrink-0 text-[#85858A]" aria-hidden="true">
          <ChevronDown size={16} strokeWidth={1.8} />
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-[11px] border border-[#26262A] bg-[#101012] shadow-[0_20px_45px_rgba(0,0,0,.55)]">
          <label className="sr-only" htmlFor={`${listboxId}-search`}>
            Search models
          </label>
          <input
            ref={searchRef}
            id={`${listboxId}-search`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && filtered[0]) {
                event.preventDefault();
                setHighlightedIndex(0);
                optionRefs.current[0]?.focus();
              } else if (event.key === "Enter" && showCustom) {
                event.preventDefault();
                choose(customQuery);
              } else if (event.key === "Enter" && filtered[0]) {
                event.preventDefault();
                choose(filtered[0].id);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
              }
            }}
            placeholder="Search or paste a model id"
            className="m-1 w-[calc(100%-8px)] rounded-[8px] border border-[#26262A] bg-[#0C0C0E] px-3 py-2 text-[13px] text-[#ECECEE] outline-none"
          />
          <div
            id={listboxId}
            role="listbox"
            aria-label="Model options"
            className="rk-scroll max-h-72 overflow-y-auto p-1"
          >
            {filtered.map((option, index) => (
              <button
                key={`${option.provider}:${option.id}`}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={option.id === value}
                tabIndex={index === highlightedIndex ? 0 : -1}
                className={`w-full rounded-[8px] px-3 py-2 text-start text-[13.5px] text-[#ECECEE] outline-none hover:bg-[#1A1A1D] focus-visible:bg-[#1A1A1D] ${
                  option.id === value ? "bg-[#1A1A1D]" : ""
                }`}
                onClick={() => choose(option.id)}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
              >
                <span className="block truncate">{option.label}</span>
                {option.label !== option.id ? (
                  <span className="mt-0.5 block truncate text-[11px] text-[#6C6C70]">
                    {option.id}
                  </span>
                ) : null}
              </button>
            ))}
            {showCustom ? (
              <button
                type="button"
                className="w-full rounded-[8px] px-3 py-2 text-start text-[13.5px] text-[#ECECEE] hover:bg-[#1A1A1D]"
                onClick={() => choose(customQuery)}
              >
                Use {customQuery}
              </button>
            ) : null}
            {!filtered.length && !showCustom ? (
              <p className="px-3 py-2 text-[13px] text-[#85858A]">No models match.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
