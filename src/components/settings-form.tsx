"use client";

import { startTransition, useState } from "react";
import { CheckCircle2, LoaderCircle, Settings2, Sparkles } from "lucide-react";
import type { AppSettingsRecord, ExecutionMode, PlannerReasoningEffort } from "@/lib/types";

function supportLabel(
  executionSupport: {
    codexCliAvailable: boolean;
    codexAuthMode: "chatgpt" | "apikey" | "unknown" | "none";
    localChatgptAvailable: boolean;
    hostedApiAvailable: boolean;
    recommendedExecutionMode: ExecutionMode;
  },
) {
  if (!executionSupport.codexCliAvailable) {
    return "Codex CLI is not available yet on this machine.";
  }

  if (executionSupport.localChatgptAvailable) {
    return "ChatGPT-backed Codex is ready for local planning and execution.";
  }

  if (executionSupport.hostedApiAvailable) {
    return "API-key-backed Codex is available. ChatGPT auth is not detected.";
  }

  return "Codex CLI is installed, but Overture could not find a usable login yet.";
}

export function SettingsForm({
  initialSettings,
  executionSupport,
}: {
  initialSettings: AppSettingsRecord;
  executionSupport: {
    codexCliAvailable: boolean;
    codexAuthMode: "chatgpt" | "apikey" | "unknown" | "none";
    localChatgptAvailable: boolean;
    hostedApiAvailable: boolean;
    recommendedExecutionMode: ExecutionMode;
  };
}) {
  const [plannerModel, setPlannerModel] = useState(initialSettings.plannerModel ?? "");
  const [executionModel, setExecutionModel] = useState(initialSettings.executionModel ?? "");
  const [plannerReasoningEffort, setPlannerReasoningEffort] =
    useState<PlannerReasoningEffort>(initialSettings.plannerReasoningEffort);
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
  const [symphonyMaxConcurrentAgents, setSymphonyMaxConcurrentAgents] = useState(
    initialSettings.symphonyMaxConcurrentAgents,
  );
  const [symphonyMaxTurns, setSymphonyMaxTurns] = useState(
    initialSettings.symphonyMaxTurns,
  );
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setSaving(true);
    setSavedMessage(null);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/settings", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            plannerModel: plannerModel.trim() || null,
            executionModel: executionModel.trim() || null,
            plannerReasoningEffort,
            defaultExecutionMode,
            defaultRepoSource,
            defaultQaStrictness,
            defaultSecurityStrictness,
            symphonyMaxConcurrentAgents,
            symphonyMaxTurns,
          }),
        });
        const payload = (await response.json()) as {
          error?: string;
          updatedAt?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to save settings.");
        }

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
              These settings become the starting point for every new project. You can leave model
              names blank to let Codex choose its default automatically.
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
              <input
                value={plannerModel}
                onChange={(event) => setPlannerModel(event.target.value)}
                placeholder="Leave blank to use the Codex default"
                className="glass-input w-full rounded-[22px] px-4 py-3"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Execution model
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                The model Symphony should use while working through project tickets.
              </p>
              <input
                value={executionModel}
                onChange={(event) => setExecutionModel(event.target.value)}
                placeholder="Leave blank to use the Codex default"
                className="glass-input w-full rounded-[22px] px-4 py-3"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                Planning depth
              </span>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Higher depth asks Codex to spend more reasoning effort when building the plan.
              </p>
              <select
                value={plannerReasoningEffort}
                onChange={(event) =>
                  setPlannerReasoningEffort(event.target.value as PlannerReasoningEffort)
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
                {supportLabel(executionSupport)}
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
              <p className="font-semibold text-[var(--color-ink)]">Blank model fields</p>
              <p className="mt-2">
                If you leave a model blank, Overture does not force one and lets the Codex CLI pick
                its own default.
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
