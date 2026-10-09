export interface PersonaComputerRef {
  scope: string;
  state: string;
  providerRef: string | null;
}

/**
 * The persona browser and the operator screen share one machine. A running team computer
 * wins. A running dedicated computer is used when the workspace never started a team one.
 */
export function choosePersonaComputer<T extends PersonaComputerRef>(rows: readonly T[]): T | null {
  const usable = rows.filter(
    (row) => Boolean(row.providerRef) && (row.state === "running" || row.state === "booting"),
  );
  return usable.find((row) => row.scope === "team") ?? usable[0] ?? null;
}
