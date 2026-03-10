import {
  EMPTY_TOKEN_USAGE,
  addTokenUsage,
  hasTokenUsage,
  maxTokenUsage,
  parseTokenUsage,
} from "@/lib/token-usage";

describe("token usage helpers", () => {
  it("parses codex token payloads", () => {
    expect(
      parseTokenUsage({
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    });
  });

  it("falls back to camelCase and derived totals", () => {
    expect(
      parseTokenUsage({
        inputTokens: "90",
        outputTokens: "10",
      }),
    ).toEqual({
      inputTokens: 90,
      outputTokens: 10,
      totalTokens: 100,
    });
  });

  it("adds and compares usage safely", () => {
    const total = addTokenUsage(
      { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
      { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
    );

    expect(total).toEqual({
      inputTokens: 140,
      outputTokens: 35,
      totalTokens: 175,
    });
    expect(
      maxTokenUsage(total, { inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
    ).toEqual(total);
    expect(hasTokenUsage(total)).toBe(true);
    expect(hasTokenUsage(EMPTY_TOKEN_USAGE)).toBe(false);
  });
});
