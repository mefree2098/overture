import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildCodexAppServerCommand,
  readLogTail,
} from "@/lib/server/symphony-manager";

describe("readLogTail", () => {
  it("reads only the end of large log files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "overture-symphony-log-"));
    const filePath = path.join(directory, "bootstrap.log");

    try {
      const earlyNoise = `${"noise-".repeat(20_000)}\n`;
      const finalLines = [
        "line-a",
        "line-b",
        "line-c",
        "line-d",
      ].join("\n");

      await writeFile(filePath, `${earlyNoise}${finalLines}\n`, "utf8");

      await expect(readLogTail(filePath, 2, 256)).resolves.toEqual(["line-c", "line-d"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("buildCodexAppServerCommand", () => {
  it("puts top-level Codex flags before the app-server subcommand", () => {
    const command = buildCodexAppServerCommand({
      executionModel: "gpt-5.4",
      executionReasoningEffort: "xhigh",
    });

    expect(command).toContain("--model 'gpt-5.4' app-server");
    expect(command).not.toContain("app-server --model");
    expect(command).toContain(`-c 'model_reasoning_effort="xhigh"'`);
  });
});
