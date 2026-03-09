import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { getWorkspaceRoot } from "@/lib/server/storage";
import {
  codexCliAvailable,
  hasHostedApiCodexAuth,
  hasLocalCodexAuth,
  resolveCodexBin,
} from "@/lib/server/runtime-config";
import { buildSpecIr } from "@/lib/server/spec-parser";
import type { CreateProjectInput, DeploymentTarget, SpecIR } from "@/lib/types";

const DEPLOYMENT_TARGETS = ["local", "jetson", "azure", "aws"] as const;

const plannerOutputSchema = z.object({
  summary: z.string().min(40).max(1200),
  features: z.array(z.string().min(3)).max(40).default([]),
  roles: z.array(z.string().min(3)).max(20).default([]),
  entities: z.array(z.string().min(2)).max(40).default([]),
  integrations: z.array(z.string().min(2)).max(40).default([]),
  constraints: z.array(z.string().min(3)).max(40).default([]),
  risks: z.array(z.string().min(3)).max(30).default([]),
  acceptanceCriteria: z.array(z.string().min(3)).max(40).default([]),
  deploymentTargets: z.array(z.enum(DEPLOYMENT_TARGETS)).max(4).default([]),
  milestones: z
    .array(
      z.object({
        name: z.string().min(3).max(180),
        tasks: z.array(z.string().min(3).max(240)).max(10).default([]),
      }),
    )
    .min(1)
    .max(16),
  epics: z
    .array(
      z.object({
        name: z.string().min(3).max(180),
        milestoneName: z.string().min(3).max(180).nullable().optional(),
        tasks: z.array(z.string().min(3).max(240)).max(10).default([]),
      }),
    )
    .max(80)
    .default([]),
  openQuestions: z.array(z.string().min(3)).max(20).default([]),
});

const plannerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "features",
    "roles",
    "entities",
    "integrations",
    "constraints",
    "risks",
    "acceptanceCriteria",
    "deploymentTargets",
    "milestones",
    "epics",
    "openQuestions",
  ],
  properties: {
    summary: { type: "string", minLength: 40, maxLength: 1200 },
    features: {
      type: "array",
      maxItems: 40,
      items: { type: "string", minLength: 3, maxLength: 240 },
    },
    roles: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 3, maxLength: 120 },
    },
    entities: {
      type: "array",
      maxItems: 40,
      items: { type: "string", minLength: 2, maxLength: 120 },
    },
    integrations: {
      type: "array",
      maxItems: 40,
      items: { type: "string", minLength: 2, maxLength: 120 },
    },
    constraints: {
      type: "array",
      maxItems: 40,
      items: { type: "string", minLength: 3, maxLength: 240 },
    },
    risks: {
      type: "array",
      maxItems: 30,
      items: { type: "string", minLength: 3, maxLength: 240 },
    },
    acceptanceCriteria: {
      type: "array",
      maxItems: 40,
      items: { type: "string", minLength: 3, maxLength: 240 },
    },
    deploymentTargets: {
      type: "array",
      maxItems: 4,
      items: {
        type: "string",
        enum: [...DEPLOYMENT_TARGETS],
      },
    },
    milestones: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "tasks"],
        properties: {
          name: { type: "string", minLength: 3, maxLength: 180 },
          tasks: {
            type: "array",
            maxItems: 10,
            items: { type: "string", minLength: 3, maxLength: 240 },
          },
        },
      },
    },
    epics: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "milestoneName", "tasks"],
        properties: {
          name: { type: "string", minLength: 3, maxLength: 180 },
          milestoneName: {
            anyOf: [{ type: "string", minLength: 3, maxLength: 180 }, { type: "null" }],
          },
          tasks: {
            type: "array",
            maxItems: 10,
            items: { type: "string", minLength: 3, maxLength: 240 },
          },
        },
      },
    },
    openQuestions: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 3, maxLength: 240 },
    },
  },
} as const;

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeDeploymentTargets(targets: DeploymentTarget[]) {
  return [...new Set(targets.filter((target) => DEPLOYMENT_TARGETS.includes(target)))];
}

function buildPlannerPrompt(input: Pick<CreateProjectInput, "name" | "executionMode" | "specText">) {
  return [
    "You are the canonical planning engine for Overture.",
    "Read the attached deep research implementation plan and produce an executable software delivery model.",
    "Return exactly one JSON object matching the provided schema. Do not emit markdown, code fences, or commentary.",
    "Do not browse the web, do not use tools, and do not rely on any external context outside the provided plan.",
    "Interpret research prose into concrete engineering work.",
    "Milestones must be top-level execution bundles. Epics must attach to milestones using milestoneName whenever possible.",
    "Task titles must be short, concrete, and implementation-ready.",
    "Preserve important QA, security, deployment, platform, and UX obligations from the source plan.",
    "Ignore citation markers and focus on actionable delivery work.",
    `Project name: ${input.name}`,
    `Execution mode: ${input.executionMode}`,
    "",
    "Source plan:",
    input.specText,
  ].join("\n");
}

function runCodexPlanner(
  input: Pick<CreateProjectInput, "name" | "executionMode" | "specText">,
  schemaPath: string,
  resultPath: string,
) {
  return new Promise<void>((resolve, reject) => {
    const codexBin = resolveCodexBin();
    const timeoutMs = Number(process.env.OVERTURE_LLM_PLANNER_TIMEOUT_MS ?? 180000);
    const approvalPolicyArg = 'approval_policy="never"';
    const forcedLoginMethodArg =
      input.executionMode === "hosted_api"
        ? 'forced_login_method="api"'
        : 'forced_login_method="chatgpt"';
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "-c",
      approvalPolicyArg,
      "-c",
      forcedLoginMethodArg,
      "-c",
      'model_reasoning_effort="low"',
      "--output-schema",
      schemaPath,
      "--output-last-message",
      resultPath,
      "--cd",
      getWorkspaceRoot(),
    ];
    const model = process.env.OVERTURE_CODEX_MODEL?.trim();

    if (model) {
      args.push("--model", model);
    }

    args.push("-");

    const child = spawn(codexBin, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          [
            `Codex planning failed with exit code ${code}.`,
            timedOut ? `Planner timed out after ${timeoutMs}ms.` : null,
            stderr.trim(),
            stdout.trim(),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    });

    child.stdin.write(buildPlannerPrompt(input));
    child.stdin.end();
  });
}

export async function buildSpecIrWithLlm(
  input: Pick<CreateProjectInput, "name" | "executionMode" | "specText">,
): Promise<SpecIR> {
  if (!codexCliAvailable()) {
    throw new Error("Codex CLI is not installed or not available on PATH.");
  }

  if (input.executionMode === "hosted_api" && !hasHostedApiCodexAuth()) {
    throw new Error(
      "hosted_api execution mode requires OPENAI_API_KEY or an existing API-key Codex login.",
    );
  }

  if (input.executionMode === "local_chatgpt" && !hasLocalCodexAuth()) {
    throw new Error(
      "local_chatgpt execution mode requires a ChatGPT-authenticated Codex login.",
    );
  }

  const structural = buildSpecIr(input.specText);
  const tempDir = await mkdtemp(path.join(tmpdir(), "overture-llm-plan-"));
  const schemaPath = path.join(tempDir, "planner.schema.json");
  const resultPath = path.join(tempDir, "planner-result.json");

  await writeFile(schemaPath, JSON.stringify(plannerJsonSchema, null, 2), "utf8");

  try {
    await runCodexPlanner(input, schemaPath, resultPath);
    const parsed = plannerOutputSchema.parse(
      JSON.parse(await readFile(resultPath, "utf8")),
    );

    return {
      summary: parsed.summary.trim(),
      outline: structural.outline,
      sections: structural.sections,
      features: unique([
        ...parsed.features,
        ...parsed.milestones.map((milestone) => milestone.name),
        ...parsed.epics.map((epic) => epic.name),
      ]),
      roles: unique(parsed.roles),
      entities: unique(parsed.entities),
      integrations: unique(parsed.integrations),
      constraints: unique(parsed.constraints),
      risks: unique(parsed.risks),
      acceptanceCriteria: unique(parsed.acceptanceCriteria),
      deploymentTargets: normalizeDeploymentTargets(parsed.deploymentTargets),
      milestones: parsed.milestones.map((milestone) => ({
        name: milestone.name.trim(),
        tasks: unique(milestone.tasks),
      })),
      epics: parsed.epics.map((epic) => ({
        name: epic.name.trim(),
        milestoneName: epic.milestoneName?.trim() ?? null,
        tasks: unique(epic.tasks),
      })),
      openQuestions: unique(parsed.openQuestions),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
