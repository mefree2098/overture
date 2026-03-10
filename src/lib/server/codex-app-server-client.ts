import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { normalizeCodexReasoningEffort } from "@/lib/codex-reasoning";
import {
  hasHostedApiCodexAuth,
  hasLocalCodexAuth,
  resolveCodexBin,
} from "@/lib/server/runtime-config";
import { getWorkspaceRoot } from "@/lib/server/storage";
import type { TokenUsage } from "@/lib/token-usage";
import type {
  CodexReasoningEffort,
  ExecutionMode,
  WorkshopSearchMode,
} from "@/lib/types";

type JsonRpcRequest = {
  id: number;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

const WORKSHOP_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "assistantMessage",
    "promptDraft",
    "summary",
    "readyForResearch",
    "openQuestions",
  ],
  properties: {
    assistantMessage: { type: "string", minLength: 1, maxLength: 4000 },
    promptDraft: { type: "string", minLength: 1, maxLength: 12000 },
    summary: { type: "string", minLength: 1, maxLength: 4000 },
    readyForResearch: { type: "boolean" },
    openQuestions: {
      type: "array",
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 400 },
    },
  },
} as const;

function approvalPolicy() {
  return "never";
}

function forcedLoginMethod(executionMode: ExecutionMode) {
  return executionMode === "hosted_api" ? "api" : "chatgpt";
}

function webSearchMode(searchMode: WorkshopSearchMode) {
  return searchMode === "live" ? "live" : "cached";
}

function createMessage(payload: unknown) {
  return `${JSON.stringify(payload)}\n`;
}

function parseStructuredWorkshopPayload(text: string) {
  const parsed = JSON.parse(text) as {
    assistantMessage?: string;
    promptDraft?: string;
    summary?: string;
    readyForResearch?: boolean;
    openQuestions?: string[];
  };

  if (
    typeof parsed.assistantMessage !== "string" ||
    typeof parsed.promptDraft !== "string" ||
    typeof parsed.summary !== "string" ||
    typeof parsed.readyForResearch !== "boolean" ||
    !Array.isArray(parsed.openQuestions)
  ) {
    throw new Error("Codex workshop turn returned an invalid structured payload.");
  }

  return {
    assistantMessage: parsed.assistantMessage.trim(),
    promptDraft: parsed.promptDraft.trim(),
    summary: parsed.summary.trim(),
    readyForResearch: parsed.readyForResearch,
    openQuestions: parsed.openQuestions
      .map((item) => String(item).trim())
      .filter(Boolean),
  };
}

function buildWorkshopDeveloperInstructions(projectName: string, repoContext?: string | null) {
  return [
    `You are the Prompt Workshop inside Overture for project "${projectName}".`,
    "Your job is to turn rough product or software ideas into a strong deep research prompt.",
    "Use plain language suitable for a non-technical user.",
    "Ask only the most useful next question when details are missing.",
    "Maintain a canonical research prompt draft that could be handed to a deep research agent.",
    "If enough information is present, mark readyForResearch true and keep the assistant message concise.",
    "Never output markdown outside the required JSON object.",
    repoContext ? `Repository context: ${repoContext}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function toTokenUsage(value: Record<string, unknown> | undefined): TokenUsage | null {
  if (!value) {
    return null;
  }

  return {
    inputTokens: Number(value.inputTokens ?? 0),
    outputTokens: Number(value.outputTokens ?? 0),
    totalTokens: Number(value.totalTokens ?? 0),
  };
}

class CodexAppServerConnection {
  private child: ChildProcessWithoutNullStreams;
  private stdoutBuffer = "";
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private notificationListeners = new Set<(notification: JsonRpcNotification) => void>();
  private stderr = "";

  constructor(args: string[]) {
    this.child = spawn(resolveCodexBin(), args, {
      cwd: getWorkspaceRoot(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk.toString();
      this.flushMessages();
    });

    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });

    this.child.on("close", (code) => {
      const error = new Error(
        [
          `Codex App Server exited with code ${code ?? "unknown"}.`,
          this.stderr.trim() || null,
        ]
          .filter(Boolean)
          .join("\n"),
      );

      for (const pending of this.pending.values()) {
        pending.reject(error);
      }

      this.pending.clear();
    });
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "Overture",
        version: "0.1.0",
      },
      capabilities: null,
    });
    this.notify("initialized");
  }

  onNotification(listener: (notification: JsonRpcNotification) => void) {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  request(method: string, params?: unknown) {
    const id = this.nextRequestId++;
    const payload: JsonRpcRequest = {
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(createMessage(payload));
    });
  }

  notify(method: string, params?: unknown) {
    this.child.stdin.write(
      createMessage({
        method,
        ...(params === undefined ? {} : { params }),
      }),
    );
  }

  async close() {
    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      this.child.once("close", () => resolve());
      setTimeout(resolve, 1000);
    });
  }

  private flushMessages() {
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");

      if (newlineIndex === -1) {
        return;
      }

      const message = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (!message) {
        continue;
      }

      this.dispatchMessage(JSON.parse(message) as JsonRpcResponse | JsonRpcNotification);
    }
  }

  private dispatchMessage(message: JsonRpcResponse | JsonRpcNotification) {
    if (typeof (message as JsonRpcNotification).method === "string") {
      for (const listener of this.notificationListeners) {
        listener(message as JsonRpcNotification);
      }
      return;
    }

    const id = Number((message as JsonRpcResponse).id);
    const pending = this.pending.get(id);

    if (!pending) {
      return;
    }

    this.pending.delete(id);

    if ((message as JsonRpcResponse).error) {
      pending.reject(
        new Error((message as JsonRpcResponse).error?.message || "App Server request failed."),
      );
      return;
    }

    pending.resolve((message as JsonRpcResponse).result);
  }
}

export interface WorkshopTurnResult {
  threadId: string;
  title: string | null;
  assistantMessage: string;
  promptDraft: string;
  summary: string;
  readyForResearch: boolean;
  openQuestions: string[];
  tokenUsage: TokenUsage | null;
}

export async function runCodexWorkshopTurn(input: {
  projectName: string;
  executionMode: ExecutionMode;
  message: string;
  threadId?: string | null;
  model?: string | null;
  reasoningEffort?: CodexReasoningEffort | null;
  searchMode?: WorkshopSearchMode;
  repoContext?: string | null;
}) {
  if (input.executionMode === "hosted_api" && !hasHostedApiCodexAuth()) {
    throw new Error("Hosted API workshop mode requires OPENAI_API_KEY or Codex API auth.");
  }

  if (input.executionMode === "local_chatgpt" && !hasLocalCodexAuth()) {
    throw new Error("Local ChatGPT workshop mode requires a ChatGPT-authenticated Codex login.");
  }

  const args = [
    "app-server",
    "-c",
    `approval_policy="${approvalPolicy()}"`,
    "-c",
    `forced_login_method="${forcedLoginMethod(input.executionMode)}"`,
    "-c",
    `web_search="${webSearchMode(input.searchMode ?? "cached")}"`,
  ];
  const connection = new CodexAppServerConnection(args);
  let latestAgentMessage = "";
  let latestTokenUsage: TokenUsage | null = null;
  let latestThreadId = input.threadId?.trim() || "";
  let latestTitle: string | null = null;

  try {
    await connection.initialize();

    connection.onNotification((notification) => {
      if (notification.method === "thread/started") {
        const thread = notification.params?.thread as Record<string, unknown> | undefined;
        latestThreadId = String(thread?.id ?? latestThreadId);
        latestTitle = typeof thread?.name === "string" ? thread.name : latestTitle;
      }

      if (notification.method === "item/agentMessage/delta") {
        if (notification.params?.threadId === latestThreadId) {
          latestAgentMessage += String(notification.params.delta ?? "");
        }
      }

      if (notification.method === "item/completed") {
        if (notification.params?.threadId !== latestThreadId) {
          return;
        }

        const item = notification.params?.item as Record<string, unknown> | undefined;
        if (item?.type === "agentMessage" && typeof item.text === "string") {
          latestAgentMessage = item.text;
        }
      }

      if (notification.method === "thread/tokenUsage/updated") {
        if (notification.params?.threadId !== latestThreadId) {
          return;
        }

        const total = (notification.params.tokenUsage as Record<string, unknown> | undefined)
          ?.total as Record<string, unknown> | undefined;
        latestTokenUsage = toTokenUsage(total);
      }
    });

    const threadResponse = (await connection.request(
      input.threadId ? "thread/resume" : "thread/start",
      input.threadId
        ? {
            threadId: input.threadId,
            model: input.model?.trim() || null,
            cwd: getWorkspaceRoot(),
            approvalPolicy: approvalPolicy(),
            config: {
              web_search: webSearchMode(input.searchMode ?? "cached"),
            },
            developerInstructions: buildWorkshopDeveloperInstructions(
              input.projectName,
              input.repoContext,
            ),
          }
        : {
            model: input.model?.trim() || null,
            cwd: getWorkspaceRoot(),
            approvalPolicy: approvalPolicy(),
            sandbox: "read-only",
            config: {
              web_search: webSearchMode(input.searchMode ?? "cached"),
            },
            developerInstructions: buildWorkshopDeveloperInstructions(
              input.projectName,
              input.repoContext,
            ),
            personality: "pragmatic",
            ephemeral: false,
          },
    )) as {
      thread?: {
        id?: string;
        name?: string | null;
      };
    };

    latestThreadId = String(threadResponse.thread?.id ?? latestThreadId);
    latestTitle =
      typeof threadResponse.thread?.name === "string"
        ? threadResponse.thread.name
        : latestTitle;

    const turnResponse = (await connection.request("turn/start", {
      threadId: latestThreadId,
      input: [
        {
          type: "text",
          text: input.message,
          text_elements: [],
        },
      ],
      model: input.model?.trim() || null,
      effort: normalizeCodexReasoningEffort(input.reasoningEffort),
      outputSchema: WORKSHOP_OUTPUT_SCHEMA,
      approvalPolicy: approvalPolicy(),
      sandboxPolicy: {
        type: "readOnly",
        access: {
          type: "fullAccess",
        },
        networkAccess: input.searchMode === "live",
      },
      personality: "pragmatic",
    })) as {
      turn?: {
        id?: string;
      };
    };

    const turnId = String(turnResponse.turn?.id ?? "");

    await new Promise<void>((resolve, reject) => {
      const dispose = connection.onNotification((notification) => {
        if (notification.method === "turn/completed") {
          const params = notification.params as Record<string, unknown> | undefined;
          const turn = params?.turn as Record<string, unknown> | undefined;
          if (
            params?.threadId === latestThreadId &&
            (turnId ? turn?.id === turnId : true)
          ) {
            dispose();
            resolve();
          }
        }

        if (notification.method === "error") {
          dispose();
          reject(
            new Error(
              String(
                (notification.params as Record<string, unknown> | undefined)?.message ??
                  "Codex App Server turn failed.",
              ),
            ),
          );
        }
      });
    });

    const structured = parseStructuredWorkshopPayload(latestAgentMessage);

    return {
      threadId: latestThreadId,
      title: latestTitle,
      assistantMessage: structured.assistantMessage,
      promptDraft: structured.promptDraft,
      summary: structured.summary,
      readyForResearch: structured.readyForResearch,
      openQuestions: structured.openQuestions,
      tokenUsage: latestTokenUsage,
    } satisfies WorkshopTurnResult;
  } finally {
    await connection.close();
  }
}
