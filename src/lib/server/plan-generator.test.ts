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

  it("creates non-policy work items for heading-driven research plans", () => {
    const result = generatePlanFromSpec(
      buildSpecIr(`
# Research blueprint

## Executive Summary

Writers need stable character memory.

## Product Design Blueprint

### Core user promises
- Canon-first consistency

### Primary workflows
**Character creation**
- Guided intake

## Technical Architecture and UX Flows

### Recommended system architecture
1. Postgres
2. pgvector
`),
    );

    const nonInjectedTopLevel = result.workItems.filter(
      (item) => !item.parentId && item.metadata.injected !== true,
    );
    const productDesignMilestone = result.workItems.find(
      (item) => item.title === "Product Design Blueprint",
    );
    const primaryWorkflowsEpic = result.workItems.find(
      (item) => item.title === "Primary workflows",
    );
    const duplicatePrimaryWorkflowTask = result.workItems.find(
      (item) =>
        item.title === "Primary workflows" &&
        item.parentId === productDesignMilestone?.id &&
        item.id !== primaryWorkflowsEpic?.id,
    );

    expect(nonInjectedTopLevel.map((item) => item.title)).toContain(
      "Product Design Blueprint",
    );
    expect(nonInjectedTopLevel.map((item) => item.title)).toContain(
      "Technical Architecture and UX Flows",
    );
    expect(nonInjectedTopLevel).not.toContainEqual(
      expect.objectContaining({ title: "Primary workflows" }),
    );
    expect(primaryWorkflowsEpic?.parentId).toBe(productDesignMilestone?.id ?? null);
    expect(duplicatePrimaryWorkflowTask).toBeUndefined();
  });

  it("keeps blueprint roots when explicit roadmap blocks appear inside research plans", () => {
    const result = generatePlanFromSpec(
      buildSpecIr(`
# Delivery blueprint

## Product Design Blueprint

### Core user promises
- Canon-first consistency

## Implementation roadmap

Milestone A: Platform skeleton
- Control plane API + UI scaffolding

### Detailed backlog / epics / tasks

Epic: Verification loop
- Screenshot evidence capture
`),
    );

    const nonInjectedTopLevel = result.workItems.filter(
      (item) => !item.parentId && item.metadata.injected !== true,
    );
    const roadmapMilestone = result.workItems.find(
      (item) => item.title === "Implementation roadmap",
    );
    const verificationEpic = result.workItems.find(
      (item) => item.title === "Verification loop",
    );

    expect(nonInjectedTopLevel.map((item) => item.title)).toContain(
      "Product Design Blueprint",
    );
    expect(nonInjectedTopLevel.map((item) => item.title)).toContain(
      "Implementation roadmap",
    );
    expect(nonInjectedTopLevel.map((item) => item.title)).not.toContain(
      "Milestone A: Platform skeleton",
    );
    expect(verificationEpic?.parentId).toBe(roadmapMilestone?.id ?? null);
  });

  it("does not emit milestone leaf tasks when the milestone already has explicit epics", () => {
    const result = generatePlanFromSpec(
      buildSpecIr(`
# Delivery blueprint

## Foundation
- Set up the platform baseline
- Wire the auth layer

### Persistence
- Create the database schema

### Runtime
- Add the worker runtime
`),
    );

    const milestoneTaskKeys = result.workItems
      .filter((item) => item.key.startsWith("M1."))
      .map((item) => item.key);
    const epicTitles = result.workItems
      .filter((item) => item.key.startsWith("E"))
      .map((item) => item.title);

    expect(milestoneTaskKeys).toHaveLength(0);
    expect(epicTitles).toEqual(expect.arrayContaining(["Persistence", "Runtime"]));
  });
});
