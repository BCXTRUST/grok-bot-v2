export class IllegalTransition extends Error {
  readonly machine: string;
  readonly from: string;
  readonly event: string;

  constructor(machine: string, from: string, event: string) {
    super(`Illegal ${machine} transition: ${event} from ${from}`);
    this.name = "IllegalTransition";
    this.machine = machine;
    this.from = from;
    this.event = event;
  }
}

export function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}
