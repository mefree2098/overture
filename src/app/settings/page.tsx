export const dynamic = "force-dynamic";

import { SettingsForm } from "@/components/settings-form";
import { getCodexModelOptions } from "@/lib/model-catalog";
import { getAppSettings } from "@/lib/server/app-settings";
import { getExecutionModeSupport } from "@/lib/server/runtime-config";

export default function SettingsPage() {
  const settings = getAppSettings();
  const executionSupport = getExecutionModeSupport();
  const modelOptions = getCodexModelOptions([
    settings.plannerModel,
    settings.executionModel,
  ]);

  return (
    <main className="pb-10">
      <SettingsForm
        initialSettings={settings}
        executionSupport={executionSupport}
        modelOptions={modelOptions}
      />
    </main>
  );
}
