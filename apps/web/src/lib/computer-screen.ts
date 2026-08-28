export function screenFrameSrc(frame: {
  image?: string | null;
  mimeType?: string | null;
}): string | null {
  if (!frame.image) return null;
  return `data:${frame.mimeType || "image/png"};base64,${frame.image}`;
}

export function latestComputerScreenshotId(
  messages: Array<{
    blocks?: Array<{ kind?: string; artifactId?: string; name?: string }>;
  }>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const blocks = messages[index]?.blocks ?? [];
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (
        block?.kind === "image" &&
        block.artifactId &&
        (!block.name || block.name.startsWith("computer-screen"))
      ) {
        return block.artifactId;
      }
    }
  }
  return null;
}
