export const dynamic = "force-dynamic";

import { SettingsForm } from "@/components/settings-form";
import { getAppSettings } from "@/lib/server/app-settings";
import { getExecutionModeSupport } from "@/lib/server/runtime-config";

export default function SettingsPage() {
  const settings = getAppSettings();
  const executionSupport = getExecutionModeSupport();

  return (
    <main className="pb-10">
      <SettingsForm
        initialSettings={settings}
        executionSupport={executionSupport}
      />
    </main>
  );
}
