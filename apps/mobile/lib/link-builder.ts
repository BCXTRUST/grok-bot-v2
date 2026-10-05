/**
 * Operator tickets open at /link-builder-ticket. Push deep links are not wired:
 * the existing Expo push payload is a bot-thread notification, and extending it
 * is left for the operations milestone.
 */
export const OPERATOR_TICKET_PATH = "/link-builder-ticket";

export interface MobileLbCard {
  id: string;
  name: string;
  activityLabel: string;
  newToday: number;
  liveToday: number;
  newPerDay: number;
  livePerDay: number;
  runStatus: string | null;
  lastEvent: string | null;
  operatorQueue: number;
}

export interface MobileLbTicket {
  id: string;
  projectId: string;
  domain: string;
  reason: string;
  status: string;
  note: string | null;
  screenUrl: string | null;
}

export function projectStatusLine(
  card: Pick<MobileLbCard, "activityLabel" | "newToday" | "liveToday" | "newPerDay" | "livePerDay">,
): string {
  return `${card.activityLabel} · NEW ${card.newToday}/${card.newPerDay} · LIVE ${card.liveToday}/${card.livePerDay}`;
}

export function ticketActionBody(note: string): { note?: string } {
  const trimmed = note.trim();
  return trimmed ? { note: trimmed } : {};
}
