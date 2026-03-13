"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import {
  CodexReasoningSelect,
} from "@/components/codex-reasoning-select";
import { CodexModelSelect } from "@/components/codex-model-select";
import { DeploymentTargetsField } from "@/components/deployment-targets-field";
import { ResearchProviderSelect } from "@/components/research-provider-select";
import {
  getCodexReasoningEffortOptions,
} from "@/lib/codex-reasoning";
import type { CodexModelOption } from "@/lib/model-catalog";
import {
  isResearchProviderAvailable,
  preferredResearchProvider,
} from "@/lib/research-provider-catalog";
import {
  executionModeAvailable,
  executionModeLabel,
  resolvePreferredExecutionMode,
  runtimeSupportLabel,
} from "@/lib/runtime-support";
import {
  buildAppSettingsPatch,
  editableAppSettingsFromRecord,
  type EditableAppSettings,
} from "@/lib/settings-patch";
import { CheckCircle2, LoaderCircle, Settings2, Sparkles } from "lucide-react";
import type {
  AppSettingsRecord,
  CodexReasoningEffort,
  ExecutionMode,
  ResearchProvider,
} from "@/lib/types";

export function SettingsForm({
  initialSettings,
  executionModeOverride,
  executionSupport,
  modelOptions,
}: {
  initialSettings: AppSettingsRecord;
  executionModeOverride: ExecutionMode | null;
  executionSupport: {
    codexCliAvailable: boolean;
    codexAuthMode: "chatgpt" | "apikey" | "unknown" | "none";
    localChatgptAvailable: boolean;
    hostedApiAvailable: boolean;
    recommendedExecutionMode: ExecutionMode;
    researchProviderAvailability: {
      codexNativeAvailable: boolean;
      openaiResponsesAvailable: boolean;
    };
  };
  modelOptions: CodexModelOption[];
}) {
  const [baseline, setBaseline] = useState<EditableAppSettings>(
    editableAppSettingsFromRecord(initialSettings),
  );
  const [plannerModel, setPlannerModel] = useState(initialSettings.plannerModel ?? "");
  const [executionModel, setExecutionModel] = useState(initialSettings.executionModel ?? "");
  const [plannerReasoningEffort, setPlannerReasoningEffort] =
    useState<CodexReasoningEffort>(initialSettings.plannerReasoningEffort);
  const [executionReasoningEffort, setExecutionReasoningEffort] =
    useState<CodexReasoningEffort>(initialSettings.executionReasoningEffort);
  const [defaultResearchProvider, setDefaultResearchProvider] =
    useState<ResearchProvider>(initialSettings.defaultResearchProvider);
  const [defaultExecutionMode, setDefaultExecutionMode] = useState<ExecutionMode>(
    initialSettings.defaultExecutionMode,
  );
  const [defaultRepoSource, setDefaultRepoSource] = useState(
    initialSettings.defaultRepoSource,
  );
  const [defaultQaStrictness, setDefaultQaStrictness] = useState(
    initialSettings.defaultQaStrictness,
  );
  const [defaultSecurityStrictness, setDefaultSecurityStrictness] = useState(
    initialSettings.defaultSecurityStrictness,
  );
  const [defaultDeploymentTargets, setDefaultDeploymentTargets] = useState(
    initialSettings.defaultDeploymentTargets,
  );
  const [symphonyMaxConcurrentAgents, setSymphonyMaxConcurrentAgents] = useState(
    initialSettings.symphonyMaxConcurrentAgents,
  );
  const [symphonyMaxTurns, setSymphonyMaxTurns] = useState(
    initialSettings.symphonyMaxTurns,
  );
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plannerReasoningOptions = getCodexReasoningEffortOptions(plannerModel);
  const executionReasoningOptions = getCodexReasoningEffortOptions(executionModel);
  const executionModeLocked = Boolean(executionModeOverride);
  const selectedResearchProviderAvailable = isResearchProviderAvailable(
    defaultResearchProvider,
    executionSupport.researchProviderAvailability,
  );
  const effectiveResearchProvider = useMemo(
    () =>
      preferredResearchProvider(
        defaultResearchProvider,
        executionSupport.researchProviderAvailability,
      ),
    [defaultResearchProvider, executionSupport.researchProviderAvailability],
  );
  const selectedExecutionModeAvailable = executionModeAvailable(
    defaultExecutionMode,
    executionSupport,
  );
  const effectiveExecutionMode = useMemo(
    () => resolvePreferredExecutionMode(defaultExecutionMode, executionSupport),
    [defaultExecutionMode, executionSupport],
  );

  useEffect(() => {
    if (
      plannerReasoningOptions.some((option) => option.value === plannerReasoningEffort)
    ) {
      return;
    }

    setPlannerReasoningEffort(
      plannerReasoningOptions.at(-1)?.value ?? initialSettings.plannerReasoningEffort,
    );
  }, [
    initialSettings.plannerReasoningEffort,
    plannerReasoningEffort,
    plannerReasoningOptions,
  ]);

  useEffect(() => {
    if (
      executionReasoningOptions.some((option) => option.value === executionReasoningEffort)
    ) {
      return;
    }

    setExecutionReasoningEffort(
      executionReasoningOptions.at(-1)?.value ?? initialSettings.executionReasoningEffort,
    );
  }, [
    executionReasoningEffort,
    executionReasoningOptions,
    initialSettings.executionReasoningEffort,
  ]);

  function handleSave() {
    setSaving(true);
    setSavedMessage(null);
    setError(null);

    startTransition(async () => {
      try {
        const patch = buildAppSettingsPatch({
          baseline,
          current: {
            plannerModel: plannerModel.trim() || null,
            executionModel: executionModel.trim() || null,
            plannerReasoningEffort,
            executionReasoningEffort,
            defaultResearchProvider,
            defaultExecutionMode,
            defaultRepoSource,
            defaultQaStrictness,
            defaultSecurityStrictness,
            defaultDeploymentTargets,
            symphonyMaxConcurrentAgents,
            symphonyMaxTurns,
          },
          executionModeLocked,
        });

        if (!Object.keys(patch).length) {
          setSavedMessage("Settings already match the current defaults.");
          setSaving(false);
          return;
        }

        const response = await fetch("/api/settings", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(patch),
        });
        const payload = (await response.json()) as AppSettingsRecord & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to save settings.");
        }

        setBaseline(editableAppSettingsFromRecord(payload));
        setSavedMessage("Settings saved. New projects will use these defaults.");
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Unable to save settings.");
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <section className="panel halo-ring rounded-[32px] p-6 lg:p-8">
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-accent)]">
              Platform defaults
            </p>
            <h1 className="text-4xl font-semibold text-[var(--color-ink)] lg:text-5xl">
              Choose how Overture plans and runs projects.
            </h1>
            <p className="max-w-3xl text-base leading-8 text-[var(--color-muted)]">
              These settings become the starting point for every new project. Leave a model on
              `Codex default` if you want the CLI to choose automatically.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Planning model
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                The model Codex should use when turning a plan into milestones and tickets.
              </p>
              <CodexModelSelect
                id="planner-model"
                name="plannerModel"
                value={plannerModel}
                onChange={setPlannerModel}
                options={modelOptions}
                defaultLabel="Codex default"
                defaultDescription="Let the Codex CLI choose its own default planning model."
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Execution model
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                The model Symphony should use while working through project tickets.
              </p>
              <CodexModelSelect
                id="execution-model"
                name="executionModel"
                value={executionModel}
                onChange={setExecutionModel}
                options={modelOptions}
                defaultLabel="Codex default"
                defaultDescription="Let the Codex CLI choose its own default execution model."
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Planning thinking level
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Controls the Codex `model_reasoning_effort` used while turning a plan into tickets.
              </p>
              <CodexReasoningSelect
                id="planner-reasoning-effort"
                name="plannerReasoningEffort"
                value={plannerReasoningEffort}
                onChange={setPlannerReasoningEffort}
                options={plannerReasoningOptions}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Agent thinking level
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Controls the Codex `model_reasoning_effort` used by Symphony agents during ticket execution.
              </p>
              <CodexReasoningSelect
                id="execution-reasoning-effort"
                name="executionReasoningEffort"
                value={executionReasoningEffort}
                onChange={setExecutionReasoningEffort}
                options={executionReasoningOptions}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Default research provider
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                This decides which research engine Overture uses first during the guided pipeline.
              </p>
              <ResearchProviderSelect
                id="default-research-provider"
                name="defaultResearchProvider"
                value={defaultResearchProvider}
                availability={executionSupport.researchProviderAvailability}
                onChange={setDefaultResearchProvider}
              />
              {!selectedResearchProviderAvailable ? (
                <p className="text-xs leading-6 text-[var(--color-muted)]">
                  {effectiveResearchProvider !== defaultResearchProvider
                    ? `This saved default is not currently available. New projects use ${
                        effectiveResearchProvider === "openai_responses"
                          ? "OpenAI Responses"
                          : "Codex native"
                      } until ${
                        defaultResearchProvider === "openai_responses"
                          ? "OpenAI Responses"
                          : "Codex native"
                      } becomes available again.`
                    : `This saved default is not currently available. Guided research stays blocked until ${
                        defaultResearchProvider === "openai_responses"
                          ? "OpenAI Responses"
                          : "Codex native"
                      } becomes available on this machine.`}
                </p>
              ) : null}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Default execution mode
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Choose whether new projects should use ChatGPT-based local Codex or API-key mode by
                default.
              </p>
              <select
                value={defaultExecutionMode}
                onChange={(event) =>
                  setDefaultExecutionMode(event.target.value as ExecutionMode)
                }
                disabled={executionModeLocked}
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
              {executionModeLocked ? (
                <p className="text-xs leading-6 text-[var(--color-muted)]">
                  Managed by `OVERTURE_DEFAULT_EXECUTION_MODE`. Change that environment variable to
                  update the platform default.
                  {!selectedExecutionModeAvailable
                    ? ` New projects on this machine currently fall back to ${executionModeLabel(effectiveExecutionMode)} until ${executionModeLabel(defaultExecutionMode)} becomes available.`
                    : ""}
                </p>
              ) : !selectedExecutionModeAvailable ? (
                <p className="text-xs leading-6 text-[var(--color-muted)]">
                  This saved default is not currently available. New projects use{" "}
                  {executionModeLabel(effectiveExecutionMode)} until{" "}
                  {executionModeLabel(defaultExecutionMode)} becomes available again.
                </p>
              ) : null}
            </label>

            <label className="space-y-2 lg:col-span-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Default repository source
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                The repo or folder new projects should use unless you override it in the project
                form.
              </p>
              <input
                value={defaultRepoSource}
                onChange={(event) => setDefaultRepoSource(event.target.value)}
                className="glass-input w-full rounded-[22px] px-4 py-3"
              />
            </label>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <label className="space-y-2 rounded-[24px] border border-white/8 bg-white/4 p-4">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                QA strictness
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Higher values push new projects to require stronger testing and validation evidence.
              </p>
              <input
                type="range"
                min="1"
                max="5"
                value={defaultQaStrictness}
                onChange={(event) => setDefaultQaStrictness(Number(event.target.value))}
                className="w-full accent-[var(--color-accent)]"
              />
              <div className="text-sm text-[var(--color-muted)]">{defaultQaStrictness} / 5</div>
            </label>

            <label className="space-y-2 rounded-[24px] border border-white/8 bg-white/4 p-4">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Security strictness
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Higher values push new projects toward stronger scans, checks, and closure gates.
              </p>
              <input
                type="range"
                min="1"
                max="5"
                value={defaultSecurityStrictness}
                onChange={(event) => setDefaultSecurityStrictness(Number(event.target.value))}
                className="w-full accent-[var(--color-magenta)]"
              />
              <div className="text-sm text-[var(--color-muted)]">
                {defaultSecurityStrictness} / 5
              </div>
            </label>

            <div className="space-y-2 rounded-[24px] border border-white/8 bg-white/4 p-4 lg:col-span-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Default deployment targets
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Overture uses these targets when it generates deployment work, handoff guidance, and
                publish commands for new projects.
              </p>
              <DeploymentTargetsField
                selectedTargets={defaultDeploymentTargets}
                onChange={setDefaultDeploymentTargets}
              />
            </div>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Parallel Symphony agents
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                How many tickets Symphony can work on at the same time for a new project.
              </p>
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
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                The maximum number of Codex turns Symphony should spend on a single issue before it
                gives up.
              </p>
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

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="glass-button inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
              {saving ? "Saving settings..." : "Save settings"}
            </button>
            {savedMessage ? (
              <span className="inline-flex items-center gap-2 text-sm text-[var(--color-success)]">
                <CheckCircle2 className="h-4 w-4" />
                {savedMessage}
              </span>
            ) : null}
            {error ? <span className="text-sm text-[var(--color-danger)]">{error}</span> : null}
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="panel rounded-[30px] p-6">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-[18px] border border-white/10 bg-white/6">
              <Sparkles className="h-5 w-5 text-[var(--color-accent)]" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                Current runtime status
              </h2>
              <p className="text-sm leading-7 text-[var(--color-muted)]">
                {runtimeSupportLabel(executionSupport)}
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3 text-sm text-[var(--color-muted)]">
            <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
              <p className="font-semibold text-[var(--color-ink)]">Detected auth mode</p>
              <p className="mt-2">
                {executionSupport.codexAuthMode === "chatgpt"
                  ? "ChatGPT"
                  : executionSupport.codexAuthMode === "apikey"
                    ? "API key"
                    : executionSupport.codexAuthMode}
              </p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
              <p className="font-semibold text-[var(--color-ink)]">Recommended default</p>
              <p className="mt-2">
                {executionSupport.recommendedExecutionMode === "local_chatgpt"
                  ? "Local ChatGPT Codex"
                  : "Hosted API Codex"}
              </p>
            </div>
          </div>
        </section>

        <section className="panel rounded-[30px] p-6">
          <h2 className="text-2xl font-semibold text-[var(--color-ink)]">What these affect</h2>
          <div className="mt-5 space-y-3 text-sm leading-7 text-[var(--color-muted)]">
            <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
              <p className="font-semibold text-[var(--color-ink)]">New projects only</p>
              <p className="mt-2">
                Saved settings become the default for future projects. Existing projects keep the
                planner and execution settings they were created with.
              </p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
              <p className="font-semibold text-[var(--color-ink)]">Model dropdowns</p>
              <p className="mt-2">
                If you leave the dropdown on `Codex default`, Overture does not force a model and
                lets the Codex CLI pick its own default.
              </p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
              <p className="font-semibold text-[var(--color-ink)]">Project-level overrides</p>
              <p className="mt-2">
                The project creation screen still lets you override any of these defaults for one
                specific run.
              </p>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}
