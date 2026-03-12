import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function makeExecutable(filePath: string) {
  writeFileSync(filePath, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(filePath, 0o755);
}

describe("runtime-config", () => {
  const originalEnv = { ...process.env };
  let sandboxRoot = "";

  beforeEach(() => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), "overture-runtime-config-"));
    process.env = { ...originalEnv };
    process.env.CODEX_HOME = path.join(sandboxRoot, "codex-home");
    process.env.OVERTURE_CODEX_BIN = path.join(sandboxRoot, "bin", "codex");
    mkdirSync(path.dirname(process.env.OVERTURE_CODEX_BIN), { recursive: true });
    makeExecutable(process.env.OVERTURE_CODEX_BIN);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(sandboxRoot, { recursive: true, force: true });
    vi.resetModules();
  });

  it("prefers hosted_api when API-key auth is present", async () => {
    mkdirSync(process.env.CODEX_HOME!, { recursive: true });
    writeFileSync(
      path.join(process.env.CODEX_HOME!, "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-test",
      }),
      "utf8",
    );

    const runtimeConfig = await import("@/lib/server/runtime-config");
    const support = runtimeConfig.getExecutionModeSupport();

    expect(support.codexCliAvailable).toBe(true);
    expect(support.codexAuthMode).toBe("apikey");
    expect(support.hostedApiAvailable).toBe(true);
    expect(support.localChatgptAvailable).toBe(false);
    expect(support.recommendedExecutionMode).toBe("hosted_api");
    expect(support.researchProviderAvailability).toEqual({
      codexNativeAvailable: true,
      openaiResponsesAvailable: false,
    });
  });

  it("prefers local_chatgpt when ChatGPT auth is present and no API-key auth exists", async () => {
    mkdirSync(process.env.CODEX_HOME!, { recursive: true });
    writeFileSync(
      path.join(process.env.CODEX_HOME!, "auth.json"),
      JSON.stringify({
        tokens: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      }),
      "utf8",
    );

    const runtimeConfig = await import("@/lib/server/runtime-config");
    const support = runtimeConfig.getExecutionModeSupport();

    expect(support.codexCliAvailable).toBe(true);
    expect(support.codexAuthMode).toBe("chatgpt");
    expect(support.hostedApiAvailable).toBe(false);
    expect(support.localChatgptAvailable).toBe(true);
    expect(support.recommendedExecutionMode).toBe("local_chatgpt");
    expect(support.researchProviderAvailability).toEqual({
      codexNativeAvailable: true,
      openaiResponsesAvailable: false,
    });
  });

  it("reports OpenAI Responses availability only when OPENAI_API_KEY is present", async () => {
    process.env.OPENAI_API_KEY = "sk-live-test";

    const runtimeConfig = await import("@/lib/server/runtime-config");
    const support = runtimeConfig.getExecutionModeSupport();

    expect(support.researchProviderAvailability.openaiResponsesAvailable).toBe(true);
  });

  it("maps the legacy default repo source to the current workspace root", async () => {
    const runtimeConfig = await import("@/lib/server/runtime-config");

    expect(runtimeConfig.normalizeRepoSource("/workspace/project")).toBe(process.cwd());
  });

  it("normalizes internal origins so Symphony targets loopback instead of bind addresses", async () => {
    const runtimeConfig = await import("@/lib/server/runtime-config");

    expect(runtimeConfig.getInternalControlPlaneOrigin("http://0.0.0.0:3000")).toBe(
      "http://127.0.0.1:3000",
    );
    expect(runtimeConfig.getInternalControlPlaneOrigin("http://localhost:3100")).toBe(
      "http://127.0.0.1:3100",
    );
  });
});
