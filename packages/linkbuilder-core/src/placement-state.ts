import { type LbPlacementStatus, LbPlacementStatusSchema } from "@rakazo/contracts";
import { IllegalTransition } from "./errors.js";

export type PlacementStatus = LbPlacementStatus;

export const PLACEMENT_STATUSES = LbPlacementStatusSchema.options;

const ALLOWED: Record<PlacementStatus, readonly PlacementStatus[]> = {
  pending: ["live", "nofollow_live", "removed", "dead"],
  live: ["nofollow_live", "removed", "dead"],
  nofollow_live: ["live", "removed", "dead"],
  // Re-verification keeps running after a removal and may find the link restored.
  removed: ["live", "nofollow_live", "dead"],
  dead: [],
};

/** Re-verifying into the same status is an idempotent no-op. */
export function canTransitionPlacement(from: PlacementStatus, to: PlacementStatus): boolean {
  return from === to || ALLOWED[from].includes(to);
}

export function transitionPlacement(from: PlacementStatus, to: PlacementStatus): PlacementStatus {
  if (!canTransitionPlacement(from, to)) throw new IllegalTransition("placement", from, to);
  return to;
}

export interface VerificationFacts {
  hrefFound: boolean;
  /** Raw `rel` attribute value or tokens of the matching anchor. */
  rel?: string | readonly string[] | null;
  postPresent: boolean;
  threadPresent: boolean;
  noindex: boolean;
}

export interface VerificationOutcome {
  status: Exclude<PlacementStatus, "pending">;
  rel: string[];
  followable: boolean;
  indexable: boolean;
}

const NON_FOLLOW_REL = new Set(["nofollow", "ugc", "sponsored"]);

export function normalizeRel(rel: VerificationFacts["rel"]): string[] {
  if (!rel) return [];
  const tokens =
    typeof rel === "string" ? rel.split(/\s+/) : rel.flatMap((part) => part.split(/\s+/));
  return [...new Set(tokens.map((token) => token.trim().toLowerCase()).filter(Boolean))].sort();
}

export function evaluateVerification(facts: VerificationFacts): VerificationOutcome {
  const rel = normalizeRel(facts.rel);
  const indexable = !facts.noindex;
  if (!facts.threadPresent || !facts.postPresent) {
    return { status: "dead", rel, followable: false, indexable };
  }
  if (!facts.hrefFound) return { status: "removed", rel, followable: false, indexable };
  // A noindex page passes no ranking signal, so it is reported with the non-followable links.
  const followable = indexable && !rel.some((token) => NON_FOLLOW_REL.has(token));
  return { status: followable ? "live" : "nofollow_live", rel, followable, indexable };
}

/** Whether an outcome counts toward the LIVE quota; the DB still allows one counted per host. */
export function shouldCount(
  outcome: PlacementStatus | Pick<VerificationOutcome, "status">,
  countNofollow: boolean,
): boolean {
  const status = typeof outcome === "string" ? outcome : outcome.status;
  if (status === "live") return true;
  if (status === "nofollow_live") return countNofollow;
  return false;
}
