"use client";

import { startTransition, useDeferredValue, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  FileText,
  GitBranchPlus,
  LoaderCircle,
  Rocket,
  Shield,
} from "lucide-react";
import type { ExecutionMode } from "@/lib/types";
import { extractOutline } from "@/lib/spec-outline";

const DEFAULT_SPEC = `# Deep research blueprint

Paste a markdown blueprint with heading hierarchy, bold subheads, and working notes to generate a dependency-aware project plan with QA, security, deployment, and release gates injected by default.
`;

const EXECUTION_MODE_COPY = {
  local_chatgpt:
    "Uses the local Codex runtime authenticated through this machine's ChatGPT sign-in.",
  hosted_api:
    "Uses Codex with OPENAI_API_KEY for fully API-backed planning and execution.",
} as const;

export function ProjectCreateForm({
  executionSupport,
}: {
  executionSupport: {
    codexCliAvailable: boolean;
    codexAuthMode: "chatgpt" | "apikey" | "unknown" | "none";
    localChatgptAvailable: boolean;
    hostedApiAvailable: boolean;
    recommendedExecutionMode: ExecutionMode;
  };
}) {
  const router = useRouter();
  const [name, setName] = useState("Overture Control Plane");
  const [repoSource, setRepoSource] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_REPO ?? ".",
  );
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(
    executionSupport.recommendedExecutionMode,
  );
  const [qaStrictness, setQaStrictness] = useState(4);
  const [securityStrictness, setSecurityStrictness] = useState(4);
  const [specFilename, setSpecFilename] = useState("plan.md");
  const [specText, setSpecText] = useState(DEFAULT_SPEC);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredSpecText = useDeferredValue(specText);
  const outline = extractOutline(deferredSpecText);

  async function handleFileChange(file: File | undefined) {
    if (!file) {
      return;
    }

    setSpecFilename(file.name);
    setSpecText(await file.text());
  }

  function handleSubmit() {
    setSubmitting(true);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            repoSource,
            executionMode,
            policyProfile: {
              qaStrictness,
              securityStrictness,
            },
            specFilename,
            specText,
          }),
        });

        const data = (await response.json()) as { projectId?: string; error?: string };
        if (!response.ok || !data.projectId) {
          throw new Error(data.error ?? "Failed to create project.");
        }

        router.push(`/projects/${data.projectId}`);
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error ? submitError.message : "Failed to create project.",
        );
      } finally {
        setSubmitting(false);
      }
    });
  }

  return (
    <section className="panel halo-ring rounded-[36px] border p-6 lg:p-8">
      <div className="grid gap-8 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--color-accent)]">
                Project Intake
              </span>
              <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                LLM Planner
              </span>
              <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                Symphony Ready
              </span>
            </div>
            <div className="space-y-3">
              <h2 className="holo-text max-w-3xl text-balance text-4xl font-semibold text-[var(--color-ink)] lg:text-5xl">
                Compile a deep research blueprint into a live execution lattice.
              </h2>
              <p className="max-w-3xl text-lg leading-8 text-[var(--color-muted)]">
                Overture sends the source blueprint through a real Codex planning pass, converts the
                result into milestone and epic tickets, mirrors those tickets through the tracker
                bridge, then hands execution off to Symphony.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Project name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="glass-input w-full rounded-[22px] px-4 py-3"
              />
            </label>
            <label className="space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Repo source
              </span>
              <input
                value={repoSource}
                onChange={(event) => setRepoSource(event.target.value)}
                className="glass-input w-full rounded-[22px] px-4 py-3"
              />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr_0.95fr]">
            <label className="space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Execution mode
              </span>
              <select
                value={executionMode}
                onChange={(event) =>
                  setExecutionMode(event.target.value as ExecutionMode)
                }
                className="glass-input w-full rounded-[22px] px-4 py-3"
              >
                <option
                  value="local_chatgpt"
                  disabled={!executionSupport.localChatgptAvailable}
                >
                  Local Codex via ChatGPT auth
                </option>
                <option value="hosted_api" disabled={!executionSupport.hostedApiAvailable}>
                  Codex via OpenAI API key
                </option>
              </select>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                {EXECUTION_MODE_COPY[executionMode]}
              </p>
              <p className="text-xs leading-5 text-[var(--color-muted)]">
                Runtime status:{" "}
                {executionSupport.codexCliAvailable
                  ? executionSupport.localChatgptAvailable
                    ? "ChatGPT-authenticated Codex available."
                    : executionSupport.hostedApiAvailable
                      ? "API-key Codex runtime available."
                      : "Codex CLI present, but no usable auth detected yet."
                  : "Codex CLI not detected."}
              </p>
            </label>
            <label className="space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                QA strictness
              </span>
              <div className="rounded-[22px] border border-[var(--color-border)] bg-white/6 px-4 py-4">
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={qaStrictness}
                  onChange={(event) => setQaStrictness(Number(event.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                />
                <div className="mt-2 text-sm text-[var(--color-muted)]">{qaStrictness} / 5</div>
              </div>
            </label>
            <label className="space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Security strictness
              </span>
              <div className="rounded-[22px] border border-[var(--color-border)] bg-white/6 px-4 py-4">
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={securityStrictness}
                  onChange={(event) => setSecurityStrictness(Number(event.target.value))}
                  className="w-full accent-[var(--color-magenta)]"
                />
                <div className="mt-2 text-sm text-[var(--color-muted)]">
                  {securityStrictness} / 5
                </div>
              </div>
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Blueprint source
                </p>
                <p className="text-sm text-[var(--color-muted)]">
                  Upload markdown or paste the deep research plan directly.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  {specFilename}
                </span>
                <label className="glass-button inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm transition">
                  <FileText className="h-4 w-4" />
                  Upload file
                  <input
                    type="file"
                    accept=".md,.txt,.markdown"
                    className="hidden"
                    onChange={(event) => {
                      void handleFileChange(event.target.files?.[0]);
                    }}
                  />
                </label>
              </div>
            </div>
            <textarea
              value={specText}
              onChange={(event) => setSpecText(event.target.value)}
              className="glass-input fine-scrollbar min-h-[380px] w-full rounded-[30px] px-4 py-4 font-mono text-sm leading-7"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              disabled={
                submitting ||
                !name.trim() ||
                !specText.trim() ||
                !executionSupport.codexCliAvailable ||
                (executionMode === "local_chatgpt" &&
                  !executionSupport.localChatgptAvailable) ||
                (executionMode === "hosted_api" && !executionSupport.hostedApiAvailable)
              }
              onClick={handleSubmit}
              className="glass-button inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {submitting ? "Compiling execution graph..." : "Compile execution graph"}
            </button>
            <p className="text-sm text-[var(--color-muted)]">
              Planning runs can take 20-60 seconds on complex research blueprints.
            </p>
          </div>

          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        </div>

        <aside className="panel-grid rounded-[32px] border border-[var(--color-border)] bg-[rgba(5,16,31,0.55)] p-5">
          <div className="space-y-5">
            <div className="rounded-[26px] border border-[var(--color-border)] bg-white/5 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-[var(--color-accent)]">
                Execution Fabric
              </p>
              <div className="mt-4 space-y-3 text-sm text-[var(--color-muted)]">
                <div className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/4 p-4">
                  <Bot className="mt-0.5 h-4 w-4 text-[var(--color-accent)]" />
                  <div>
                    <p className="font-semibold text-[var(--color-ink)]">Codex planner</p>
                    <p className="mt-1 leading-6">
                      Extracts milestones, epics, risks, entities, and operational gates from the
                      blueprint.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/4 p-4">
                  <GitBranchPlus className="mt-0.5 h-4 w-4 text-[var(--color-magenta)]" />
                  <div>
                    <p className="font-semibold text-[var(--color-ink)]">Tracker bridge</p>
                    <p className="mt-1 leading-6">
                      Mirrors the internal plan into a Linear-compatible GraphQL surface for
                      Symphony orchestration.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/4 p-4">
                  <Shield className="mt-0.5 h-4 w-4 text-[var(--color-success)]" />
                  <div>
                    <p className="font-semibold text-[var(--color-ink)]">Gate enforcement</p>
                    <p className="mt-1 leading-6">
                      QA, security, deployment, and release closure remain mandatory even when the
                      source plan omits them.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[26px] border border-[var(--color-border)] bg-white/5 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                    Live blueprint outline
                  </p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {outline.length} outline nodes detected from {specFilename}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Preview
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {outline.slice(0, 12).map((node) => (
                  <div
                    key={`${node.level}-${node.title}`}
                    className="rounded-[20px] border border-white/8 bg-white/4 px-4 py-3"
                    style={{ marginLeft: `${(node.level - 1) * 14}px` }}
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                      Level {node.level}
                    </p>
                    <p className="mt-1 text-sm font-medium text-[var(--color-ink)]">
                      {node.title}
                    </p>
                  </div>
                ))}
                {outline.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted)]">
                    Paste a research blueprint to see the inferred structure here.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
