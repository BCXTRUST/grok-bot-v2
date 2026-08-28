export function screenFrameSrc(frame: {
  image?: string | null;
  mimeType?: string | null;
}): string | null {
  if (!frame.image) return null;
  return `data:${frame.mimeType || "image/png"};base64,${frame.image}`;
}
