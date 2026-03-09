import type { GateVerdict, WorkItemStatus } from "@/lib/types";
import { cn, titleFromKey } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  pass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  fail: "border-rose-200 bg-rose-50 text-rose-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  blocked: "border-amber-200 bg-amber-50 text-amber-800",
  pending: "border-stone-200 bg-stone-100 text-stone-700",
  queued: "border-stone-200 bg-stone-100 text-stone-700",
  in_progress: "border-sky-200 bg-sky-50 text-sky-700",
  verifying: "border-indigo-200 bg-indigo-50 text-indigo-700",
  partial: "border-orange-200 bg-orange-50 text-orange-700",
  waived: "border-violet-200 bg-violet-50 text-violet-700",
  awaiting_review: "border-teal-200 bg-teal-50 text-teal-700",
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
        "inline-flex items-center rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em]",
        STATUS_STYLES[status] ?? "border-stone-200 bg-stone-100 text-stone-700",
        className,
      )}
    >
      {titleFromKey(status)}
    </span>
  );
}
