import Markdown, { MarkdownStream } from "@ronradtke/react-native-markdown-display";
import { memo } from "react";
import { Linking, StyleSheet } from "react-native";
import type { ChatMarkdownProps } from "./markdown";
import { sanitizeMarkdownUrl } from "./markdown";

const styles = StyleSheet.create({
  body: {
    color: "#DFDFE2",
    fontSize: 15.5,
    lineHeight: 23,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 9,
  },
  heading1: {
    color: "#F3F3F4",
    fontSize: 21,
    lineHeight: 27,
    marginTop: 10,
    marginBottom: 5,
  },
  heading2: {
    color: "#F3F3F4",
    fontSize: 19,
    lineHeight: 25,
    marginTop: 10,
    marginBottom: 5,
  },
  heading3: {
    color: "#F3F3F4",
    fontSize: 17,
    lineHeight: 23,
    marginTop: 8,
    marginBottom: 4,
  },
  strong: {
    color: "#F3F3F4",
    fontWeight: "700",
  },
  link: {
    color: "#86B7FF",
    textDecorationLine: "underline",
  },
  code_inline: {
    color: "#ECECEE",
    backgroundColor: "#101012",
    borderColor: "#34343A",
    borderWidth: StyleSheet.hairlineWidth,
  },
  code_block: {
    color: "#ECECEE",
    backgroundColor: "#0E0E10",
    borderColor: "#2D2D32",
  },
  fence: {
    backgroundColor: "#0E0E10",
    borderColor: "#2D2D32",
  },
  fence_code: {
    backgroundColor: "#0E0E10",
  },
  blockquote: {
    backgroundColor: "transparent",
    borderLeftColor: "#55555C",
  },
  table: {
    borderColor: "#34343A",
  },
  tr: {
    borderColor: "#34343A",
  },
  hr: {
    backgroundColor: "#34343A",
  },
});

async function openSafeLink(url: string) {
  const safeUrl = sanitizeMarkdownUrl(url);
  if (!safeUrl) return;
  if (await Linking.canOpenURL(safeUrl)) await Linking.openURL(safeUrl);
}

export const ChatMarkdown = memo(function ChatMarkdown({
  children,
  streaming = false,
}: ChatMarkdownProps) {
  const sharedProps = {
    colorScheme: "dark" as const,
    style: styles,
    allowedImageHandlers: ["https://", "http://"],
    onLinkPress: (url: string) => {
      void openSafeLink(url);
      return true;
    },
  };

  return streaming ? (
    <MarkdownStream {...sharedProps} cursorColor="#85858A" streaming>
      {children}
    </MarkdownStream>
  ) : (
    <Markdown {...sharedProps}>{children}</Markdown>
  );
});

export type { ChatMarkdownProps } from "./markdown";
