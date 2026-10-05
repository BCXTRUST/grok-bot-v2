import { type LbProjectStatus, LbProjectStatusSchema } from "@rakazo/contracts";
import { IllegalTransition } from "./errors.js";

export type ProjectStatus = LbProjectStatus;

export const PROJECT_STATUSES = LbProjectStatusSchema.options;

const ALLOWED: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ["active", "archived"],
  active: ["paused", "stopped", "archived"],
  paused: ["active", "stopped", "archived"],
  stopped: ["active", "archived"],
  archived: [],
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function transitionProject(from: ProjectStatus, to: ProjectStatus): ProjectStatus {
  if (!canTransitionProject(from, to)) throw new IllegalTransition("project", from, to);
  return to;
}
