/** After a real submit, one retry, then the host is `spam_blocked` forever. */
export function spamRetryDecision(input: {
  messages: readonly string[];
  sentences: readonly string[];
  retriesUsed: number;
  maxRetries?: number;
}): "ignore" | "retry" | "block" {
  const max = input.maxRetries ?? 1;
  const text = input.messages.join("\n");
  const hit = input.sentences.some((sentence) => sentence.length > 0 && text.includes(sentence));
  if (!hit) return "ignore";
  if (input.retriesUsed < max) return "retry";
  return "block";
}
