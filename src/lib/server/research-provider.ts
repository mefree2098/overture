import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { normalizeCodexReasoningEffort } from "@/lib/codex-reasoning";
import type { ResearchBundle } from "@/lib/server/research-artifacts";
import { normalizeResearchBundle } from "@/lib/server/research-artifacts";
import {
  hasHostedApiCodexAuth,
  hasLocalCodexAuth,
  normalizeRepoSource,
  resolveCodexBin,
} from "@/lib/server/runtime-config";
import { extractAbsoluteTokenUsageFromJsonLines, hasTokenUsage } from "@/lib/token-usage";
import type { ProjectRecord, WorkshopSearchMode } from "@/lib/types";

const researchBundleSchema = z.object({
  summary: z.string().min(20).max(4000),
  researchReport: z.string().min(200),
  planMarkdown: z.string().min(200),
  architectureDecisions: z.string().nullable().default(null),
  citations: z
    .array(
      z.object({
        title: z.string().min(1).max(400),
        url: z.string().url(),
        source: z.string().nullable().optional(),
      }),
    )
    .max(40)
    .default([]),
  openQuestions: z.array(z.string().min(1).max(400)).max(20).default([]),
}) satisfies z.ZodType<ResearchBundle>;

const researchBundleJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "researchReport",
    "planMarkdown",
    "architectureDecisions",
    "citations",
    "openQuestions",
  ],
  properties: {
    summary: { type: "string", minLength: 20, maxLength: 4000 },
    researchReport: { type: "string", minLength: 200 },
    planMarkdown: { type: "string", minLength: 200 },
    architectureDecisions: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    citations: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "source"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 400 },
          url: { type: "string", minLength: 1, maxLength: 2000 },
          source: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
        },
      },
    },
    openQuestions: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 400 },
    },
  },
} as const;

function execSearchMode(searchMode: WorkshopSearchMode) {
  return searchMode === "live" ? "live" : "cached";
}

async function runCodexNativeResearch(input: {
  project: ProjectRecord;
  prompt: string;
  searchMode: WorkshopSearchMode;
}) {
  if (input.project.executionMode === "hosted_api" && !hasHostedApiCodexAuth()) {
    throw new Error("Hosted API research mode requires OPENAI_API_KEY or Codex API auth.");
  }

  if (input.project.executionMode === "local_chatgpt" && !hasLocalCodexAuth()) {
    throw new Error("Local ChatGPT research mode requires a ChatGPT-authenticated Codex login.");
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "overture-research-"));
  const schemaPath = path.join(tempDir, "research-bundle.schema.json");
  const resultPath = path.join(tempDir, "research-bundle.json");
  await writeFile(schemaPath, JSON.stringify(researchBundleJsonSchema, null, 2), "utf8");

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "-c",
    'approval_policy="never"',
    "-c",
    `forced_login_method="${input.project.executionMode === "hosted_api" ? "api" : "chatgpt"}"`,
    "-c",
    `web_search="${execSearchMode(input.searchMode)}"`,
    "-c",
    `model_reasoning_effort="${normalizeCodexReasoningEffort(
      input.project.plannerReasoningEffort,
    )}"`,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    resultPath,
    "--json",
    "--cd",
    normalizeRepoSource(input.project.repoSource),
  ];

  if (input.project.plannerModel) {
    args.push("--model", input.project.plannerModel);
  }

  args.push("-");
  let stdout = "";
  let stderr = "";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveCodexBin(), args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          [
            `Codex deep research failed with exit code ${code}.`,
            stderr.trim(),
            stdout.trim(),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    });

    child.stdin.write(input.prompt);
    child.stdin.end();
  });

  try {
    const tokenUsage = extractAbsoluteTokenUsageFromJsonLines(stdout);
    const bundle = researchBundleSchema.parse(
      JSON.parse(await readFile(resultPath, "utf8")),
    );

    return normalizeResearchBundle({
      ...bundle,
      tokenUsage: hasTokenUsage(tokenUsage) ? tokenUsage : null,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runResponsesResearch(input: {
  project: ProjectRecord;
  prompt: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("openai_responses research requires OPENAI_API_KEY.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.project.plannerModel ?? "gpt-5.4",
      input: input.prompt,
      reasoning: {
        effort: normalizeCodexReasoningEffort(input.project.plannerReasoningEffort),
      },
      tools: [{ type: "web_search_preview" }],
      text: {
        format: {
          type: "json_schema",
          name: "research_bundle",
          strict: true,
          schema: researchBundleJsonSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Responses research failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    output?: Array<Record<string, unknown>>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  };
  const message = payload.output?.find((item) => item.type === "message");
  const content = Array.isArray(message?.content)
    ? (message?.content as Array<Record<string, unknown>>).find(
        (item) => item.type === "output_text",
      )
    : null;

  if (!content || typeof content.text !== "string") {
    throw new Error("OpenAI Responses research did not return a structured output message.");
  }

  const bundle = normalizeResearchBundle(
    researchBundleSchema.parse(JSON.parse(content.text)),
  );

  return {
    ...bundle,
    tokenUsage: payload.usage
      ? {
          inputTokens: Number(payload.usage.input_tokens ?? 0),
          outputTokens: Number(payload.usage.output_tokens ?? 0),
          totalTokens: Number(payload.usage.total_tokens ?? 0),
        }
      : null,
  };
}

export async function runResearchProvider(input: {
  project: ProjectRecord;
  prompt: string;
  provider: ProjectRecord["researchProvider"];
  searchMode: WorkshopSearchMode;
}) {
  switch (input.provider) {
    case "openai_responses":
      return runResponsesResearch({
        project: input.project,
        prompt: input.prompt,
      });
    default:
      return runCodexNativeResearch({
        project: input.project,
        prompt: input.prompt,
        searchMode: input.searchMode,
      });
  }
}
