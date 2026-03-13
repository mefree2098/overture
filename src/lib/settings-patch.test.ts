import {
  buildAppSettingsPatch,
  editableAppSettingsFromRecord,
  type EditableAppSettings,
} from "@/lib/settings-patch";

function makeEditableSettings(overrides: Partial<EditableAppSettings> = {}): EditableAppSettings {
  return {
    plannerModel: null,
    executionModel: null,
    plannerReasoningEffort: "low",
    executionReasoningEffort: "medium",
    defaultResearchProvider: "codex_native",
    defaultExecutionMode: "local_chatgpt",
    defaultRepoSource: ".",
    defaultQaStrictness: 4,
    defaultSecurityStrictness: 4,
    defaultDeploymentTargets: ["local"],
    symphonyMaxConcurrentAgents: 5,
    symphonyMaxTurns: 24,
    ...overrides,
  };
}

describe("settings-patch", () => {
  it("omits locked execution-mode defaults while still sending unrelated changes", () => {
    const baseline = makeEditableSettings({
      defaultExecutionMode: "hosted_api",
      defaultResearchProvider: "openai_responses",
    });
    const patch = buildAppSettingsPatch({
      baseline,
      current: makeEditableSettings({
        defaultExecutionMode: "local_chatgpt",
        defaultResearchProvider: "openai_responses",
        defaultQaStrictness: 5,
      }),
      executionModeLocked: true,
    });

    expect(patch).toEqual({
      defaultQaStrictness: 5,
    });
  });

  it("does not treat an unchanged stored research provider as a patch", () => {
    const baseline = makeEditableSettings({
      defaultResearchProvider: "openai_responses",
    });
    const patch = buildAppSettingsPatch({
      baseline,
      current: makeEditableSettings({
        defaultResearchProvider: "openai_responses",
      }),
    });

    expect(patch).toEqual({});
  });

  it("normalizes whitespace-only model and repo edits before diffing", () => {
    const baseline = makeEditableSettings({
      plannerModel: null,
      defaultRepoSource: ".",
    });
    const patch = buildAppSettingsPatch({
      baseline,
      current: makeEditableSettings({
        plannerModel: "   ",
        defaultRepoSource: "   ",
      }),
    });

    expect(editableAppSettingsFromRecord(makeEditableSettings({
      plannerModel: " gpt-5.4 ",
      defaultRepoSource: " ./repo ",
    }))).toMatchObject({
      plannerModel: "gpt-5.4",
      defaultRepoSource: "./repo",
    });
    expect(patch).toEqual({});
  });
});
