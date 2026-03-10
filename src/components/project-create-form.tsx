"use client";

import { CodexReasoningSelect } from "@/components/codex-reasoning-select";
import { CodexModelSelect } from "@/components/codex-model-select";
import { ResearchProviderSelect } from "@/components/research-provider-select";
import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BrainCircuit,
  ChevronDown,
  FileText,
  LoaderCircle,
  Rocket,
  Settings2,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { CodexModelOption } from "@/lib/model-catalog";
import { getCodexReasoningEffortOptions } from "@/lib/codex-reasoning";
import { extractOutline } from "@/lib/spec-outline";
import type {
  AppSettingsRecord,
  CodexReasoningEffort,
  ExecutionMode,
  ResearchProvider,
  WorkshopSearchMode,
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

type CreatePath = "guided" | "quick";

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

function searchModeLabel(mode: WorkshopSearchMode) {
  switch (mode) {
    case "live":
      return "Live search";
    case "provider_fallback":
      return "Provider fallback";
    default:
      return "Cached search";
  }
}

export function ProjectCreateForm({
  executionSupport,
  appSettings,
  modelOptions,
}: {
  executionSupport: {
    codexCliAvailable: boolean;
    codexAuthMode: "chatgpt" | "apikey" | "unknown" | "none";
    localChatgptAvailable: boolean;
    hostedApiAvailable: boolean;
    recommendedExecutionMode: ExecutionMode;
  };
  appSettings: AppSettingsRecord;
  modelOptions: CodexModelOption[];
}) {
  const router = useRouter();
  const initialExecutionMode = useMemo(() => {
    if (modeIsAvailable(appSettings.defaultExecutionMode, executionSupport)) {
      return appSettings.defaultExecutionMode;
    }

    return executionSupport.recommendedExecutionMode;
  }, [appSettings.defaultExecutionMode, executionSupport]);
  const [name, setName] = useState("");
  const [createPath, setCreatePath] = useState<CreatePath>("guided");
  const [repoSource, setRepoSource] = useState(
    appSettings.defaultRepoSource || process.env.NEXT_PUBLIC_DEFAULT_REPO || ".",
  );
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(initialExecutionMode);
  const [researchProvider, setResearchProvider] = useState<ResearchProvider>(
    appSettings.defaultResearchProvider,
  );
  const [qaStrictness, setQaStrictness] = useState(appSettings.defaultQaStrictness);
  const [securityStrictness, setSecurityStrictness] = useState(
    appSettings.defaultSecurityStrictness,
  );
  const [plannerModel, setPlannerModel] = useState(appSettings.plannerModel ?? "");
  const [executionModel, setExecutionModel] = useState(appSettings.executionModel ?? "");
  const [plannerReasoningEffort, setPlannerReasoningEffort] =
    useState<CodexReasoningEffort>(appSettings.plannerReasoningEffort);
  const [executionReasoningEffort, setExecutionReasoningEffort] =
    useState<CodexReasoningEffort>(appSettings.executionReasoningEffort);
  const [symphonyMaxConcurrentAgents, setSymphonyMaxConcurrentAgents] = useState(
    appSettings.symphonyMaxConcurrentAgents,
  );
  const [symphonyMaxTurns, setSymphonyMaxTurns] = useState(appSettings.symphonyMaxTurns);
  const [workshopKickoff, setWorkshopKickoff] = useState("");
  const [workshopSearchMode, setWorkshopSearchMode] =
    useState<WorkshopSearchMode>("cached");
  const [specFilename, setSpecFilename] = useState("plan.md");
  const [specText, setSpecText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredSpecText = useDeferredValue(specText);
  const outline = extractOutline(deferredSpecText);
  const plannerReasoningOptions = getCodexReasoningEffortOptions(plannerModel);
  const executionReasoningOptions = getCodexReasoningEffortOptions(executionModel);

  useEffect(() => {
    if (
      plannerReasoningOptions.some((option) => option.value === plannerReasoningEffort)
    ) {
      return;
    }

    setPlannerReasoningEffort(
      plannerReasoningOptions.at(-1)?.value ?? appSettings.plannerReasoningEffort,
    );
  }, [appSettings.plannerReasoningEffort, plannerReasoningEffort, plannerReasoningOptions]);

  useEffect(() => {
    if (
      executionReasoningOptions.some((option) => option.value === executionReasoningEffort)
    ) {
      return;
    }

    setExecutionReasoningEffort(
      executionReasoningOptions.at(-1)?.value ?? appSettings.executionReasoningEffort,
    );
  }, [
    appSettings.executionReasoningEffort,
    executionReasoningEffort,
    executionReasoningOptions,
  ]);

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
            sourceBriefText: specText.trim() || null,
            sourceBriefFilename: specText.trim() ? specFilename : null,
            researchProvider,
            plannerModel: plannerModel.trim() || null,
            executionModel: executionModel.trim() || null,
            plannerReasoningEffort,
            executionReasoningEffort,
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

  function handleGuidedSubmit() {
    setSubmitting(true);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/projects/drafts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            repoSource,
            executionMode,
            researchProvider,
            plannerModel: plannerModel.trim() || null,
            executionModel: executionModel.trim() || null,
            plannerReasoningEffort,
            executionReasoningEffort,
            symphonyMaxConcurrentAgents,
            symphonyMaxTurns,
          }),
        });

        const data = (await response.json()) as { projectId?: string; error?: string };
        if (!response.ok || !data.projectId) {
          throw new Error(data.error ?? "Failed to create guided project.");
        }

        const kickoffMessage =
          workshopKickoff.trim() ||
          (specText.trim()
            ? "Use the source brief attached to this project to draft the first research-ready prompt, summary, and research objectives. Ask no follow-up questions unless critical information is missing."
            : "");

        if (kickoffMessage) {
          const workshopResponse = await fetch(`/api/projects/${data.projectId}/workshop`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: kickoffMessage,
              searchMode: workshopSearchMode,
              repoContext: repoSource,
            }),
          });
          const workshopPayload = (await workshopResponse.json().catch(() => ({}))) as {
            error?: string;
          };

          if (!workshopResponse.ok) {
            throw new Error(
              workshopPayload.error ??
                "The draft project was created, but the first workshop turn failed.",
            );
          }
        }

        router.push(`/projects/${data.projectId}/workshop`);
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to create guided project.",
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
              Choose the fast lane or let Overture build the plan with you.
            </h2>
            <p className="max-w-3xl text-base leading-8 text-[var(--color-muted)]">
              If you already have a finished `plan.md`, use the quick path. If you only have notes,
              goals, or messy research, start the guided flow and Overture will help shape the
              research prompt first.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setCreatePath("guided")}
              className={`rounded-[24px] border p-5 text-left transition ${
                createPath === "guided"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                  : "border-white/8 bg-white/4 hover:border-[var(--color-accent)]"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-[16px] border border-white/10 bg-white/8">
                  <Wand2 className="h-4 w-4 text-[var(--color-accent)]" />
                </div>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
                    Guided flow
                  </p>
                  <p className="mt-1 text-base font-semibold text-[var(--color-ink)]">
                    Start from notes, goals, or rough ideas
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                Overture opens a Prompt Workshop, runs deep research, lets you review the generated
                plan, then hands it into the existing execution system.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setCreatePath("quick")}
              className={`rounded-[24px] border p-5 text-left transition ${
                createPath === "quick"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                  : "border-white/8 bg-white/4 hover:border-[var(--color-accent)]"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-[16px] border border-white/10 bg-white/8">
                  <BrainCircuit className="h-4 w-4 text-[var(--color-accent)]" />
                </div>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
                    Quick path
                  </p>
                  <p className="mt-1 text-base font-semibold text-[var(--color-ink)]">
                    I already have a finished plan
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                Upload or paste `plan.md`, skip the workshop and research stages, and go straight
                to Overture’s existing planner and execution review flow.
              </p>
            </button>
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

          {createPath === "guided" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    Step 2: tell Overture what you want
                  </p>
                  <p className="text-sm leading-6 text-[var(--color-muted)]">
                    Paste your notes, goals, constraints, links, or messy research. The Prompt
                    Workshop will ask follow-up questions and build a proper research prompt with
                    you.
                  </p>
                </div>
                <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  {searchModeLabel(workshopSearchMode)}
                </span>
              </div>
              <textarea
                aria-label="Workshop kickoff notes"
                value={workshopKickoff}
                onChange={(event) => setWorkshopKickoff(event.target.value)}
                placeholder={`What should Overture research and build?\n\nExample:\n- Build a writer-first character simulation platform for authors\n- Start with a web product\n- Make memory inspectable and canon-first\n- Include launch and deploy guidance for local, Docker, and iOS later`}
                className="glass-input fine-scrollbar min-h-[280px] w-full rounded-[30px] px-4 py-4 text-sm leading-7"
              />
              <p className="text-sm text-[var(--color-muted)]">
                Overture will save a draft project first, then open the Prompt Workshop so you can
                refine the research prompt before any plan is ingested.
              </p>
            </div>
          ) : (
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
          )}

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
                  Research provider
                </span>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Guided projects use this provider when Overture runs the deep research stage.
                </p>
                <ResearchProviderSelect
                  id="project-research-provider"
                  name="researchProvider"
                  value={researchProvider}
                  onChange={setResearchProvider}
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

              {createPath === "guided" ? (
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-[var(--color-ink)]">
                    Workshop search mode
                  </span>
                  <p className="text-sm leading-6 text-[var(--color-muted)]">
                    Choose whether the Prompt Workshop should stay on cached search, use live
                    search, or fall back to other configured providers.
                  </p>
                  <select
                    value={workshopSearchMode}
                    onChange={(event) =>
                      setWorkshopSearchMode(event.target.value as WorkshopSearchMode)
                    }
                    className="glass-input w-full rounded-[22px] px-4 py-3"
                  >
                    <option value="cached">Cached search</option>
                    <option value="live">Live search</option>
                    <option value="provider_fallback">Provider fallback</option>
                  </select>
                </label>
              ) : null}

              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Planning thinking level
                </span>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Controls the Codex `model_reasoning_effort` used while creating the plan.
                </p>
                <CodexReasoningSelect
                  id="project-planner-reasoning-effort"
                  name="plannerReasoningEffort"
                  value={plannerReasoningEffort}
                  onChange={setPlannerReasoningEffort}
                  options={plannerReasoningOptions}
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Planning model
                </span>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Choose an explicit planning model or leave this on `Codex default`.
                </p>
                <CodexModelSelect
                  id="project-planner-model"
                  name="plannerModel"
                  value={plannerModel}
                  onChange={setPlannerModel}
                  options={modelOptions}
                  defaultLabel="Codex default"
                  defaultDescription="Use the saved default planning model from Settings."
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Execution model
                </span>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Choose an explicit execution model or leave this on `Codex default`.
                </p>
                <CodexModelSelect
                  id="project-execution-model"
                  name="executionModel"
                  value={executionModel}
                  onChange={setExecutionModel}
                  options={modelOptions}
                  defaultLabel="Codex default"
                  defaultDescription="Use the saved default execution model from Settings."
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Agent thinking level
                </span>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Controls the Codex `model_reasoning_effort` used by Symphony agents for this project.
                </p>
                <CodexReasoningSelect
                  id="project-execution-reasoning-effort"
                  name="executionReasoningEffort"
                  value={executionReasoningEffort}
                  onChange={setExecutionReasoningEffort}
                  options={executionReasoningOptions}
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
                !executionSupport.codexCliAvailable ||
                (executionMode === "local_chatgpt" &&
                  !executionSupport.localChatgptAvailable) ||
                (executionMode === "hosted_api" && !executionSupport.hostedApiAvailable) ||
                (createPath === "quick" && !specText.trim())
              }
              onClick={createPath === "guided" ? handleGuidedSubmit : handleSubmit}
              className="glass-button inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {submitting
                ? createPath === "guided"
                  ? "Creating guided project..."
                  : "Creating your project..."
                : createPath === "guided"
                  ? "Start guided project"
                  : "Turn this plan into a project"}
            </button>
            <p className="text-sm text-[var(--color-muted)]">
              {createPath === "guided"
                ? "The guided path creates a draft project first, then opens the Prompt Workshop so you can shape the research prompt."
                : "Most plans take about 20 to 60 seconds to organize into milestones and tasks."}
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
                <p className="font-semibold text-[var(--color-ink)]">
                  {createPath === "guided" ? "1. Prompt workshop" : "1. Planning"}
                </p>
                <p className="mt-2">
                  {createPath === "guided"
                    ? "Codex App Server helps refine your rough notes into a canonical deep-research prompt."
                    : "Codex reads your plan and turns it into milestones, tasks, risks, and quality gates."}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <p className="font-semibold text-[var(--color-ink)]">
                  {createPath === "guided" ? "2. Deep research" : "2. Review"}
                </p>
                <p className="mt-2">
                  {createPath === "guided"
                    ? "Overture runs research, writes `research-report.md` and `plan.md`, and keeps the artifacts visible."
                    : "Overture creates a project page where you can review the generated work before starting anything."}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <p className="font-semibold text-[var(--color-ink)]">
                  {createPath === "guided" ? "3. Plan review and run" : "3. Automated run"}
                </p>
                <p className="mt-2">
                  {createPath === "guided"
                    ? "You approve the generated plan, then Symphony executes it while Overture manages launch, deploy, and evidence."
                    : "When you start the run, Symphony works through the queue while Overture keeps the progress, evidence, and final checks organized."}
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
              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <p className="font-semibold text-[var(--color-ink)]">Research provider</p>
                <p className="mt-2">{appSettings.defaultResearchProvider}</p>
              </div>
            </div>
          </div>

          <div className="panel rounded-[30px] p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              {createPath === "guided" ? "Guided flow preview" : "Plan preview"}
            </p>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {createPath === "guided"
                ? "This is what happens after you create a guided project."
                : "As you paste text, Overture previews the main headings it can see in the document."}
            </p>

            <div className="mt-4 space-y-3">
              {createPath === "guided" ? (
                <>
                  <div className="rounded-[20px] border border-white/8 bg-white/4 px-4 py-3">
                    <p className="text-sm text-[var(--color-ink)]">1. Prompt Workshop</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-muted)]">
                      Threaded Codex conversation with a live prompt draft.
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/4 px-4 py-3">
                    <p className="text-sm text-[var(--color-ink)]">2. Deep Research Run</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-muted)]">
                      Generates `research-report.md`, `plan.md`, citations, and open questions.
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/4 px-4 py-3">
                    <p className="text-sm text-[var(--color-ink)]">3. Plan Review</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-muted)]">
                      You edit or approve the generated plan before ingestion.
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/4 px-4 py-3">
                    <p className="text-sm text-[var(--color-ink)]">4. Build, Launch, Deploy</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-muted)]">
                      Overture hands the approved plan to Symphony, then manages launch and deploy
                      profiles with artifacts.
                    </p>
                  </div>
                </>
              ) : outline.length ? (
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
