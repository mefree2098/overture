"use client";

import { startTransition, useDeferredValue, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, LoaderCircle, Sparkles } from "lucide-react";
import { extractOutline } from "@/lib/spec-outline";

const DEFAULT_SPEC = `# Platform blueprint

Paste a spec or upload a markdown file to generate a dependency-aware project plan with QA, security, and deployment gates injected by default.
`;

export function ProjectCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("Overture Control Plane");
  const [repoSource, setRepoSource] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_REPO ?? ".",
  );
  const [executionMode, setExecutionMode] = useState<"local_chatgpt" | "hosted_api">(
    "local_chatgpt",
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
    <section className="panel rounded-[32px] border p-6 lg:p-8">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <div className="space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-3 py-1 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" />
              Create Project
            </span>
            <h2 className="max-w-2xl text-balance text-4xl font-semibold text-[var(--color-ink)]">
              Ingest a deep research plan and turn it into a resumable execution graph.
            </h2>
            <p className="max-w-2xl text-lg text-[var(--color-muted)]">
              The planner extracts milestones, epics, risks, and acceptance criteria, then
              injects mandatory QA, security, deployment, and release gates before execution
              starts.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Project name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-2xl border border-[var(--color-border)] bg-white px-4 py-3 outline-none transition focus:border-[var(--color-accent)]"
              />
            </label>
            <label className="space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Repo source
              </span>
              <input
                value={repoSource}
                onChange={(event) => setRepoSource(event.target.value)}
                className="w-full rounded-2xl border border-[var(--color-border)] bg-white px-4 py-3 outline-none transition focus:border-[var(--color-accent)]"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Execution mode
              </span>
              <select
                value={executionMode}
                onChange={(event) =>
                  setExecutionMode(event.target.value as "local_chatgpt" | "hosted_api")
                }
                className="w-full rounded-2xl border border-[var(--color-border)] bg-white px-4 py-3 outline-none transition focus:border-[var(--color-accent)]"
              >
                <option value="local_chatgpt">Local execution (ChatGPT sign-in)</option>
                <option value="hosted_api">Hosted execution (API key)</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
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
            <label className="space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Security strictness
              </span>
              <input
                type="range"
                min="1"
                max="5"
                value={securityStrictness}
                onChange={(event) => setSecurityStrictness(Number(event.target.value))}
                className="w-full accent-[var(--color-accent)]"
              />
              <div className="text-sm text-[var(--color-muted)]">
                {securityStrictness} / 5
              </div>
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Spec intake
                </p>
                <p className="text-sm text-[var(--color-muted)]">
                  Upload markdown or paste the plan directly.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-4 py-2 text-sm text-[var(--color-ink)] transition hover:border-[var(--color-accent)]">
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
            <textarea
              value={specText}
              onChange={(event) => setSpecText(event.target.value)}
              className="fine-scrollbar min-h-[360px] w-full rounded-[28px] border border-[var(--color-border)] bg-[rgba(255,255,255,0.82)] px-4 py-4 font-mono text-sm leading-6 outline-none transition focus:border-[var(--color-accent)]"
            />
          </div>

          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}

          <button
            type="button"
            disabled={submitting || !name.trim() || !specText.trim()}
            onClick={handleSubmit}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--color-panel-strong)] px-5 py-3 text-sm font-semibold text-[var(--color-surface)] transition hover:bg-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Generate project plan
          </button>
        </div>

        <aside className="panel-grid rounded-[28px] border border-[var(--color-border)] bg-[rgba(255,252,245,0.78)] p-5">
          <div className="space-y-5">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Live parsing preview
              </p>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                {outline.length} headings detected from {specFilename}
              </p>
            </div>
            <div className="space-y-3">
              {outline.slice(0, 12).map((node) => (
                <div
                  key={`${node.level}-${node.title}`}
                  className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3"
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
                  Paste a spec to see the inferred outline here.
                </p>
              ) : null}
            </div>
            <div className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                Mandatory injections
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
                <li>QA workstream with evidence capture</li>
                <li>Security loop with remediation tracking</li>
                <li>Deployment planning for local, Jetson, Azure, and AWS</li>
                <li>Release gate that blocks closure until verification passes</li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
