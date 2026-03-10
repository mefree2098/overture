import { rewriteSummaryForProjectName, stripAnsi, titleFromKey } from "@/lib/utils";

describe("utils", () => {
  it("formats common runtime labels with preserved acronyms", () => {
    expect(titleFromKey("local_chatgpt")).toBe("Local ChatGPT");
    expect(titleFromKey("hosted_api")).toBe("Hosted API");
    expect(titleFromKey("qa")).toBe("QA");
  });

  it("strips ansi escape codes from terminal output", () => {
    expect(stripAnsi("\u001b[32mready\u001b[0m")).toBe("ready");
  });

  it("rewrites renamed project summaries", () => {
    expect(
      rewriteSummaryForProjectName(
        "Build Overture Control Plane as a writer-first character simulation platform.",
        "PenPal",
        "Overture Control Plane",
      ),
    ).toBe("Build PenPal as a writer-first character simulation platform.");
    expect(
      rewriteSummaryForProjectName(
        "Build Overture Control Plane as a writer-first character simulation platform.",
        "PenPal",
      ),
    ).toBe("Build PenPal as a writer-first character simulation platform.");
  });
});
