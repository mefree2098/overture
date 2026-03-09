import type { GateVerdict, WorkItemStatus } from "@/lib/types";
import { cn, titleFromKey } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  pass: "border-emerald-300/35 bg-emerald-400/10 text-emerald-200",
  done: "border-emerald-300/35 bg-emerald-400/10 text-emerald-200",
  fail: "border-rose-300/35 bg-rose-400/10 text-rose-200",
  failed: "border-rose-300/35 bg-rose-400/10 text-rose-200",
  blocked: "border-amber-300/40 bg-amber-400/10 text-amber-100",
  pending: "border-white/10 bg-white/6 text-slate-200",
  queued: "border-cyan-300/30 bg-cyan-400/10 text-cyan-100",
  in_progress: "border-sky-300/35 bg-sky-400/10 text-sky-100",
  verifying: "border-indigo-300/35 bg-indigo-400/10 text-indigo-100",
  partial: "border-fuchsia-300/35 bg-fuchsia-400/10 text-fuchsia-100",
  waived: "border-violet-300/35 bg-violet-400/10 text-violet-100",
  awaiting_review: "border-teal-300/35 bg-teal-400/10 text-teal-100",
};

export function StatusPill({
  status,
  className,
}: {
  status: GateVerdict | WorkItemStatus | string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.24em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        STATUS_STYLES[status] ?? "border-white/10 bg-white/6 text-slate-200",
        className,
      )}
    >
      {titleFromKey(status)}
    </span>
  );
}
