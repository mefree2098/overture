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

  it("treats heading-driven research blueprints as first-class plan structure", () => {
    const specIr = buildSpecIr(`
# PenPalAI Deep Research Blueprint

## Executive Summary

Writer-first character simulation platform.

## Product Design Blueprint

### Core user promises

- Canon-first consistency
- Memory you can inspect

### Primary workflows

**Character creation (writer-first, not chatbot-first)**
- Structured attributes
- Relationship seeds

**Conversation modes**
- Roleplay mode
- Interview mode

## Memory System Design

### Storage architecture

1. Postgres as source of truth
2. pgvector for episodic retrieval

### Memory write policy

- Store validated memory write proposals
`);

    expect(specIr.milestones.map((milestone) => milestone.name)).toContain(
      "Product Design Blueprint",
    );
    expect(specIr.milestones.map((milestone) => milestone.name)).toContain(
      "Memory System Design",
    );
    expect(specIr.epics.map((epic) => epic.name)).toContain("Primary workflows");
    expect(specIr.epics.map((epic) => epic.name)).toContain("Storage architecture");
    expect(
      specIr.epics.find((epic) => epic.name === "Primary workflows")?.milestoneName,
    ).toBe("Product Design Blueprint");
    expect(
      specIr.epics.find((epic) => epic.name === "Primary workflows")?.tasks,
    ).toContain("Character creation (writer-first, not chatbot-first)");
    expect(
      specIr.epics.find((epic) => epic.name === "Storage architecture")?.tasks,
    ).toContain("Postgres as source of truth");
  });

  it("preserves heading-driven roots when research plans also include explicit backlog sections", () => {
    const specIr = buildSpecIr(`
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
`);

    expect(specIr.milestones.map((milestone) => milestone.name)).toContain(
      "Product Design Blueprint",
    );
    expect(specIr.milestones.map((milestone) => milestone.name)).toContain(
      "Implementation roadmap",
    );
    expect(specIr.milestones.map((milestone) => milestone.name)).not.toContain(
      "Milestone A: Platform skeleton",
    );
    expect(specIr.epics.map((epic) => epic.name)).toContain("Core user promises");
    expect(specIr.epics.map((epic) => epic.name)).toContain("Verification loop");
    expect(
      specIr.epics.find((epic) => epic.name === "Verification loop")?.milestoneName,
    ).toBe("Implementation roadmap");
  });
});
