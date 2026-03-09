import { buildSpecIr } from "@/lib/server/spec-parser";

const SOURCE = `
# Blueprint

**20) MVP scope**
- multi-project isolation
- pause/resume + audit trail

**22) Implementation plan broken into milestones**
Milestone A: Platform skeleton
- Control plane API + UI scaffolding
- DB schema + audit log

Milestone B: Verification
- Playwright screenshots + video capture
- Security scanning runners

**23) Detailed backlog / epics / tasks**
Epic: Core PM + persistence
- Implement Project/PlanVersion/WorkItem schemas
- Append-only audit events

**27) Open questions that must be resolved before implementation**
- How should hosted execution be isolated?
`;

describe("buildSpecIr", () => {
  it("extracts milestones, epics, questions, and acceptance criteria", () => {
    const specIr = buildSpecIr(SOURCE);

    expect(specIr.milestones).toHaveLength(2);
    expect(specIr.epics).toHaveLength(1);
    expect(specIr.openQuestions).toContain(
      "How should hosted execution be isolated?",
    );
    expect(specIr.acceptanceCriteria).toContain("multi-project isolation");
    expect(specIr.integrations).toContain("Playwright");
  });
});
