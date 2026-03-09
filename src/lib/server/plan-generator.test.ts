import { generatePlanFromSpec } from "@/lib/server/plan-generator";
import { buildSpecIr } from "@/lib/server/spec-parser";

const SOURCE = `
# Blueprint

**20) MVP scope**
- hard closure gates for QA + security + local deployment

**22) Implementation plan broken into milestones**
Milestone A: Platform skeleton
- Control plane API + UI scaffolding

Milestone B: Verification
- Security scanning runners

**23) Detailed backlog / epics / tasks**
Epic: UX polish
- Project dashboard
`;

describe("generatePlanFromSpec", () => {
  it("injects policy workstreams alongside parsed milestones and epics", () => {
    const result = generatePlanFromSpec(buildSpecIr(SOURCE));
    const titles = result.workItems.map((item) => item.title);

    expect(titles).toContain("Mandatory QA gate stack");
    expect(titles).toContain("Mandatory security loop");
    expect(titles).toContain("Deployment verification matrix");
    expect(result.dependencyEdges.length).toBeGreaterThan(0);
  });
});
