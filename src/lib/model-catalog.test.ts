import { describe, expect, it } from "vitest";
import { getCodexModelOptions } from "@/lib/model-catalog";

describe("model catalog", () => {
  it("includes the default codex model options", () => {
    const options = getCodexModelOptions();

    expect(options.some((option) => option.value === "gpt-5.4")).toBe(true);
    expect(options.some((option) => option.value === "gpt-5.3-codex")).toBe(true);
    expect(options.some((option) => option.value === "gpt-5.3-codex-spark")).toBe(true);
    expect(options.some((option) => option.value === "gpt-5.1-codex-mini")).toBe(true);
  });

  it("preserves existing custom saved values in the dropdown", () => {
    const options = getCodexModelOptions(["custom-codex-model"]);
    const customOption = options.find((option) => option.value === "custom-codex-model");

    expect(customOption?.group).toBe("Current custom selections");
  });
});
