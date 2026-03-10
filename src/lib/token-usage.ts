export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function firstNumber(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) {
    return 0;
  }

  for (const key of keys) {
    const value = asFiniteNumber(record[key]);

    if (value > 0) {
      return value;
    }
  }

  return 0;
}

export function parseTokenUsage(value: unknown): TokenUsage {
  const record = asRecord(value);
  const inputTokens = Math.max(
    0,
    firstNumber(record, [
      "input_tokens",
      "inputTokens",
      "prompt_tokens",
      "promptTokens",
      "in_tokens",
      "inTokens",
    ]),
  );
  const outputTokens = Math.max(
    0,
    firstNumber(record, [
      "output_tokens",
      "outputTokens",
      "completion_tokens",
      "completionTokens",
      "out_tokens",
      "outTokens",
    ]),
  );
  const totalTokens = Math.max(
    inputTokens + outputTokens,
    firstNumber(record, ["total_tokens", "totalTokens"]),
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function addTokenUsage(...values: TokenUsage[]) {
  return values.reduce<TokenUsage>(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
    }),
    { ...EMPTY_TOKEN_USAGE },
  );
}

export function maxTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: Math.max(left.inputTokens, right.inputTokens),
    outputTokens: Math.max(left.outputTokens, right.outputTokens),
    totalTokens: Math.max(left.totalTokens, right.totalTokens),
  };
}

export function hasTokenUsage(usage: TokenUsage) {
  return usage.inputTokens > 0 || usage.outputTokens > 0 || usage.totalTokens > 0;
}
