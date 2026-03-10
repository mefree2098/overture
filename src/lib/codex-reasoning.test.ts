import {
  codexReasoningEffortLabel,
  getCodexReasoningEffortOptions,
  normalizeCodexReasoningEffort,
} from "@/lib/codex-reasoning";

describe("codex reasoning options", () => {
  it("normalizes persisted values and labels them for the UI", () => {
    expect(normalizeCodexReasoningEffort("xhigh")).toBe("xhigh");
    expect(normalizeCodexReasoningEffort("unknown")).toBe("low");
    expect(codexReasoningEffortLabel("xhigh")).toBe("Extra High");
  });

  it("only offers extra high for newer GPT-5 Codex-capable models", () => {
    expect(getCodexReasoningEffortOptions("gpt-5.4").map((option) => option.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(
      getCodexReasoningEffortOptions("gpt-5.1-codex").map((option) => option.value),
    ).toEqual(["low", "medium", "high"]);
  });
});
