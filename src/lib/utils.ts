import { format, formatDistanceToNowStrict } from "date-fns";
import { clsx } from "clsx";

export function cn(...inputs: Array<string | false | null | undefined>) {
  return clsx(inputs);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function titleFromKey(value: string) {
  const normalized = value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

  return normalized
    .replace(/\bChatgpt\b/g, "ChatGPT")
    .replace(/\bApi\b/g, "API")
    .replace(/\bAws\b/g, "AWS")
    .replace(/\bQa\b/g, "QA")
    .replace(/\bUx\b/g, "UX");
}

export function formatDateTime(value: string) {
  return format(new Date(value), "MMM d, yyyy HH:mm");
}

export function formatRelativeTime(value: string) {
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

export function stripAnsi(value: string) {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "")
    .replace(/\r/g, "")
    .trim();
}

export function tryParseJson<T>(value: string | null): T {
  if (!value) {
    return {} as T;
  }

  return JSON.parse(value) as T;
}

export function hashColor(input: string) {
  let hash = 0;
  for (const char of input) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 56% 42%)`;
}
