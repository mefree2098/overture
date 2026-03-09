"use client";

import Link from "next/link";
import { startTransition, useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  FileText,
  LoaderCircle,
  Rocket,
  Settings2,
  Sparkles,
} from "lucide-react";
import { extractOutline } from "@/lib/spec-outline";
import type {
  AppSettingsRecord,
  ExecutionMode,
  PlannerReasoningEffort,
} from "@/lib/types";

const STARTER_TEMPLATE = `# Project plan

## Goal
Describe what you want built or improved.

## Main areas
- Product experience
- Core functionality
- Quality checks
- Deployment and launch

## Notes
Paste any research notes, requirements, risks, or ideas here.`;

function modeIsAvailable(
  mode: ExecutionMode,
  executionSupport: {
    localChatgptAvailable: boolean;
    hostedApiAvailable: boolean;
  },
) {
  return mode === "local_chatgpt"
    ? executionSupport.localChatgptAvailable
    : executionSupport.hostedApiAvailable;
}

function modeLabel(mode: ExecutionMode) {
  return mode === "local_chatgpt" ? "Local ChatGPT Codex" : "Hosted API Codex";
}

export function ProjectCreateForm({
  executionSupport,
  appSettings,
}: {
  executionSupport: {
    codexCliAvailable: boolean;
    codexAuthMode: "chatgpt" | "apikey" | "unknown" | "none";
    localChatgptAvailable: boolean;
    hostedApiAvailable: boolean;
    recommendedExecutionMode: ExecutionMode;
  };
  appSettings: AppSettingsRecord;
}) {
  const router = useRouter();
  const initialExecutionMode = useMemo(() => {
    if (modeIsAvailable(appSettings.defaultExecutionMode, executionSupport)) {
      return appSettings.defaultExecutionMode;
    }

    return executionSupport.recommendedExecutionMode;
  }, [appSettings.defaultExecutionMode, executionSupport]);
  const [name, setName] = useState("");
  const [repoSource, setRepoSource] = useState(
    appSettings.defaultRepoSource || process.env.NEXT_PUBLIC_DEFAULT_REPO || ".",
  );
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(initialExecutionMode);
  const [qaStrictness, setQaStrictness] = useState(appSettings.defaultQaStrictness);
  const [securityStrictness, setSecurityStrictness] = useState(
    appSettings.defaultSecurityStrictness,
  );
  const [plannerModel, setPlannerModel] = useState(appSettings.plannerModel ?? "");
  const [executionModel, setExecutionModel] = useState(appSettings.executionModel ?? "");
  const [plannerReasoningEffort, setPlannerReasoningEffort] =
    useState<PlannerReasoningEffort>(appSettings.plannerReasoningEffort);
  const [symphonyMaxConcurrentAgents, setSymphonyMaxConcurrentAgents] = useState(
    appSettings.symphonyMaxConcurrentAgents,
  );
  const [symphonyMaxTurns, setSymphonyMaxTurns] = useState(appSettings.symphonyMaxTurns);
  const [specFilename, setSpecFilename] = useState("plan.md");
  const [specText, setSpecText] = useState("");
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
            plannerModel: plannerModel.trim() || null,
            executionModel: executionModel.trim() || null,
            plannerReasoningEffort,
            symphonyMaxConcurrentAgents,
            symphonyMaxTurns,
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
      <div className="grid gap-8 xl:grid-cols-[1.04fr_0.96fr]">
        <div className="space-y-6">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--color-accent)]">
              Start a new project
            </span>
            <h2 className="text-balance text-4xl font-semibold text-[var(--color-ink)] lg:text-5xl">
              Start with just a name and your plan.
            </h2>
            <p className="max-w-3xl text-base leading-8 text-[var(--color-muted)]">
              Overture will read the document, build the task list, and set up the automated run
              for you. You only need to fill in the basics here.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
                Step 1
              </p>
              <p className="mt-3 text-base font-semibold text-[var(--color-ink)]">
                Name the project
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                Pick a clear name you will recognize later.
              </p>
            </div>
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
                Step 2
              </p>
              <p className="mt-3 text-base font-semibold text-[var(--color-ink)]">
                Paste the plan
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                Upload the markdown file or paste the text directly.
              </p>
            </div>
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
                Step 3
              </p>
              <p className="mt-3 text-base font-semibold text-[var(--color-ink)]">
                Review and start
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                Overture creates the project page and you choose when to start the run.
              </p>
            </div>
          </div>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-[var(--color-ink)]">
              Step 1: project name
            </span>
            <p className="text-sm leading-6 text-[var(--color-muted)]">
              Use the name you want to see on the dashboard.
            </p>
            <input
              aria-label="Project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Example: PenPal AI"
              className="glass-input w-full rounded-[22px] px-4 py-3"
            />
          </label>

          <div className="rounded-[24px] border border-white/8 bg-white/4 p-4 text-sm leading-7 text-[var(--color-muted)]">
            Overture will use your saved project folder setting by default:
            <span className="ml-2 font-semibold text-[var(--color-ink)]">
              {appSettings.defaultRepoSource || process.env.NEXT_PUBLIC_DEFAULT_REPO || "."}
            </span>
            . If you need a different folder or Git repository for this project, you can change it
            in <span className="font-semibold text-[var(--color-ink)]">Advanced project options</span>.
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  Step 2: add your markdown plan
                </p>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Paste the plan directly or upload a `.md` file. You do not need to clean up
                  citations or make it look perfect first.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  {specFilename}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSpecFilename("starter-plan.md");
                    setSpecText(STARTER_TEMPLATE);
                  }}
                  className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 text-sm font-semibold text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
                >
                  Use starter outline
                </button>
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
              aria-label="Plan content"
              value={specText}
              onChange={(event) => setSpecText(event.target.value)}
              placeholder={`# Your project plan\n\n## Goal\nDescribe the product or outcome.\n\n## Major sections\nAdd the main areas, milestones, requirements, risks, or research notes.\n\n## Notes\nMessy research notes are okay. Overture will organize them.`}
              className="glass-input fine-scrollbar min-h-[300px] w-full rounded-[30px] px-4 py-4 text-sm leading-7"
            />
            <p className="text-sm text-[var(--color-muted)]">
              Tip: deep research plans, rough notes, and long markdown documents are all valid
              inputs here.
            </p>
          </div>

          <details className="rounded-[28px] border border-white/8 bg-white/4 p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold text-[var(--color-ink)]">
              Advanced project options
              <ChevronDown className="h-4 w-4 text-[var(--color-muted)]" />
            </summary>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <label className="space-y-2 lg:col-span-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Project folder or Git repository
                </span>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  This is where the automated run will work after you start it.
                </p>
                <input
                  aria-label="Repo source"
                  value={repoSource}
                  onChange={(event) => setRepoSource(event.target.value)}
                  className="glass-input w-full rounded-[22px] px-4 py-3"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Run mode
                </span>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Choose whether this project should use your local ChatGPT Codex login or hosted
                  API mode.
                </p>
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
                    Local ChatGPT Codex
                  </option>
                  <option value="hosted_api" disabled={!executionSupport.hostedApiAvailable}>
                    Hosted API Codex
                  </option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Planning depth
                </span>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Controls how much extra thinking Codex spends while creating the plan.
                </p>
                <select
                  value={plannerReasoningEffort}
                  onChange={(event) =>
                    setPlannerReasoningEffort(
                      event.target.value as PlannerReasoningEffort,
                    )
                  }
                  className="glass-input w-full rounded-[22px] px-4 py-3"
                >
                  <option value="low">Fast</option>
                  <option value="medium">Balanced</option>
                  <option value="high">Deep</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Planning model
                </span>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Leave blank to use the saved default model from Settings.
                </p>
                <input
                  value={plannerModel}
                  onChange={(event) => setPlannerModel(event.target.value)}
                  placeholder="Optional"
                  className="glass-input w-full rounded-[22px] px-4 py-3"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Execution model
                </span>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Leave blank to use the saved default model from Settings.
                </p>
                <input
                  value={executionModel}
                  onChange={(event) => setExecutionModel(event.target.value)}
                  placeholder="Optional"
                  className="glass-input w-full rounded-[22px] px-4 py-3"
                />
              </label>

              <label className="space-y-2 rounded-[22px] border border-white/8 bg-white/4 p-4">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  QA strictness
                </span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={qaStrictness}
                  onChange={(event) => setQaStrictness(Number(event.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                />
                <div className="text-sm text-[var(--color-muted)]">{qaStrictness} / 5</div>
              </label>

              <label className="space-y-2 rounded-[22px] border border-white/8 bg-white/4 p-4">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Security strictness
                </span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={securityStrictness}
                  onChange={(event) => setSecurityStrictness(Number(event.target.value))}
                  className="w-full accent-[var(--color-magenta)]"
                />
                <div className="text-sm text-[var(--color-muted)]">
                  {securityStrictness} / 5
                </div>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Parallel Symphony agents
                </span>
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={symphonyMaxConcurrentAgents}
                  onChange={(event) =>
                    setSymphonyMaxConcurrentAgents(Number(event.target.value))
                  }
                  className="glass-input w-full rounded-[22px] px-4 py-3"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Max turns per ticket
                </span>
                <input
                  type="number"
                  min="4"
                  max="80"
                  value={symphonyMaxTurns}
                  onChange={(event) => setSymphonyMaxTurns(Number(event.target.value))}
                  className="glass-input w-full rounded-[22px] px-4 py-3"
                />
              </label>
            </div>
          </details>

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
              {submitting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {submitting ? "Creating your project..." : "Turn this plan into a project"}
            </button>
            <p className="text-sm text-[var(--color-muted)]">
              Most plans take about 20 to 60 seconds to organize into milestones and tasks.
            </p>
          </div>

          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        </div>

        <aside className="space-y-5">
          <div className="panel rounded-[30px] p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-[18px] border border-white/10 bg-white/6">
                <Sparkles className="h-5 w-5 text-[var(--color-accent)]" />
              </div>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                  What Overture does for you
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
                  You do not have to manage the process manually.
                </h3>
              </div>
            </div>

            <div className="mt-5 space-y-3 text-sm leading-7 text-[var(--color-muted)]">
              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <p className="font-semibold text-[var(--color-ink)]">1. Planning</p>
                <p className="mt-2">
                  Codex reads your plan and turns it into milestones, tasks, risks, and quality
                  gates.
                </p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <p className="font-semibold text-[var(--color-ink)]">2. Review</p>
                <p className="mt-2">
                  Overture creates a project page where you can review the generated work before
                  starting anything.
                </p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <p className="font-semibold text-[var(--color-ink)]">3. Automated run</p>
                <p className="mt-2">
                  When you start the run, Symphony works through the queue while Overture keeps the
                  progress, evidence, and final checks organized.
                </p>
              </div>
            </div>
          </div>

          <div className="panel rounded-[30px] p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Saved defaults
                </p>
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  New projects use these unless you change them in Advanced project options.
                </p>
              </div>
              <Link
                href="/settings"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Edit
              </Link>
            </div>

            <div className="mt-4 space-y-3 text-sm text-[var(--color-muted)]">
              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <p className="font-semibold text-[var(--color-ink)]">Planning model</p>
                <p className="mt-2">{appSettings.plannerModel ?? "Codex default"}</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <p className="font-semibold text-[var(--color-ink)]">Execution model</p>
                <p className="mt-2">{appSettings.executionModel ?? "Codex default"}</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <p className="font-semibold text-[var(--color-ink)]">Default mode</p>
                <p className="mt-2">{modeLabel(initialExecutionMode)}</p>
              </div>
            </div>
          </div>

          <div className="panel rounded-[30px] p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Plan preview
            </p>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              As you paste text, Overture previews the main headings it can see in the document.
            </p>

            <div className="mt-4 space-y-3">
              {outline.length ? (
                outline.slice(0, 8).map((node, index) => (
                  <div
                    key={`${node.title}-${index}`}
                    className="rounded-[20px] border border-white/8 bg-white/4 px-4 py-3"
                    style={{ marginLeft: `${Math.max(0, node.level - 1) * 14}px` }}
                  >
                    <p className="text-sm text-[var(--color-ink)]">{node.title}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-[20px] border border-dashed border-white/10 bg-white/3 px-4 py-6 text-sm text-[var(--color-muted)]">
                  Paste a plan and Overture will preview the section structure here.
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
