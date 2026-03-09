import type { OutlineNode } from "@/lib/types";

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const BOLD_HEADING_PATTERN = /^\*\*(.+)\*\*$/;

export function extractOutline(text: string): OutlineNode[] {
  const outline: OutlineNode[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const markdownMatch = line.match(HEADING_PATTERN);
    if (markdownMatch) {
      outline.push({
        level: markdownMatch[1].length,
        title: markdownMatch[2].trim(),
      });
      continue;
    }

    const boldMatch = line.match(BOLD_HEADING_PATTERN);
    if (boldMatch) {
      outline.push({
        level: 2,
        title: boldMatch[1].trim(),
      });
    }
  }

  return outline;
}
