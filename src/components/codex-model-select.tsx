"use client";

import type { CodexModelOption } from "@/lib/model-catalog";

function groupOptions(options: CodexModelOption[]) {
  const grouped = new Map<string, CodexModelOption[]>();

  for (const option of options) {
    const current = grouped.get(option.group) ?? [];
    current.push(option);
    grouped.set(option.group, current);
  }

  return [...grouped.entries()];
}

export function CodexModelSelect({
  id,
  name,
  value,
  onChange,
  options,
  defaultLabel,
  defaultDescription,
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: CodexModelOption[];
  defaultLabel: string;
  defaultDescription: string;
}) {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <div className="space-y-2">
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="glass-input w-full rounded-[22px] px-4 py-3"
      >
        <option value="">{defaultLabel}</option>
        {groupOptions(options).map(([group, groupOptions]) => (
          <optgroup key={group} label={group}>
            {groupOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-xs leading-6 text-[var(--color-muted)]">
        {selectedOption?.description ?? defaultDescription}
      </p>
    </div>
  );
}
