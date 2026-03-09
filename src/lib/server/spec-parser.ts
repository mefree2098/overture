import { createHash } from "node:crypto";
import { DEPLOYMENT_TARGETS } from "@/lib/constants";
import { extractOutline } from "@/lib/spec-outline";
import type {
  DeploymentTarget,
  SectionBlock,
  SpecEpic,
  SpecIR,
  SpecMilestone,
} from "@/lib/types";

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const BOLD_HEADING_PATTERN = /^\*\*(.+)\*\*$/;
const BULLET_PATTERN = /^[-*]\s+(.*)$/;
const ORDERED_LIST_PATTERN = /^\d+[.)]\s+(.*)$/;
const LIST_PATTERN = /^(?:[-*]|\d+[.)])\s+(.*)$/;
const CITATION_PATTERN = /[^]+/g;

function cleanExtractedText(value: string) {
  return value
    .replace(CITATION_PATTERN, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countMarkdownHeadings(markdown: string, level: number) {
  const patterns = [
    /^#\s+.+$/gm,
    /^##\s+.+$/gm,
    /^###\s+.+$/gm,
    /^####\s+.+$/gm,
    /^#####\s+.+$/gm,
    /^######\s+.+$/gm,
  ];
  const pattern = patterns[Math.max(1, Math.min(level, 6)) - 1];
  return [...markdown.matchAll(pattern)].length;
}

function splitIntoSections(text: string): SectionBlock[] {
  const lines = text.split(/\r?\n/);
  const sections: SectionBlock[] = [];
  let currentMarkdownLevel = 1;
  let current: SectionBlock = {
    title: "Overview",
    level: 1,
    body: "",
    bullets: [],
  };

  const pushCurrent = () => {
    current.body = current.body.trim();
    current.bullets = current.bullets.filter(Boolean);
    sections.push(current);
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const markdownMatch = line.trim().match(HEADING_PATTERN);
    const boldMatch = line.trim().match(BOLD_HEADING_PATTERN);

    if (markdownMatch) {
      pushCurrent();
      currentMarkdownLevel = markdownMatch[1].length;
      current = {
        title: cleanExtractedText(markdownMatch[2]),
        level: currentMarkdownLevel,
        body: "",
        bullets: [],
      };
      continue;
    }

    if (boldMatch) {
      pushCurrent();
      current = {
        title: cleanExtractedText(boldMatch[1]),
        level: Math.min(currentMarkdownLevel + 1, 6),
        body: "",
        bullets: [],
      };
      continue;
    }

    const bulletMatch = line.trim().match(BULLET_PATTERN);
    const orderedMatch = line.trim().match(ORDERED_LIST_PATTERN);
    if (bulletMatch) {
      current.bullets.push(cleanExtractedText(bulletMatch[1]));
    } else if (orderedMatch) {
      current.bullets.push(cleanExtractedText(orderedMatch[1]));
    }

    current.body += `${line}\n`;
  }

  pushCurrent();

  return sections.filter(
    (section) =>
      section.title !== "Overview" || section.body || section.bullets.length > 0,
  );
}

function sectionDescendants(sections: SectionBlock[], index: number) {
  const root = sections[index];
  const descendants: SectionBlock[] = [];

  for (let cursor = index + 1; cursor < sections.length; cursor += 1) {
    const candidate = sections[cursor];
    if (candidate.level <= root.level) {
      break;
    }
    descendants.push(candidate);
  }

  return descendants;
}

function parentSectionIndex(sections: SectionBlock[], index: number) {
  const current = sections[index];

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (sections[cursor].level < current.level) {
      return cursor;
    }
  }

  return null;
}

function findSectionIndex(sections: SectionBlock[], query: string) {
  const normalized = query.toLowerCase();
  return sections.findIndex((section) => section.title.toLowerCase().includes(normalized));
}

function findSection(sections: SectionBlock[], query: string) {
  const index = findSectionIndex(sections, query);
  return index === -1 ? undefined : sections[index];
}

function extractMilestones(section: SectionBlock | undefined): SpecMilestone[] {
  if (!section) {
    return [];
  }

  const milestones: SpecMilestone[] = [];
  let current: SpecMilestone | null = null;

  for (const rawLine of section.body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const milestoneMatch = line.match(/^Milestone\s+([A-Z]):\s+(.+)$/);
    if (milestoneMatch) {
      if (current) {
        milestones.push(current);
      }
      current = {
        name: `Milestone ${milestoneMatch[1]}: ${milestoneMatch[2].trim()}`,
        tasks: [],
      };
      continue;
    }

    const bulletMatch = line.match(LIST_PATTERN);
    if (bulletMatch && current) {
      current.tasks.push(cleanExtractedText(bulletMatch[1]));
    }
  }

  if (current) {
    milestones.push(current);
  }

  return milestones;
}

function extractEpics(
  section: SectionBlock | undefined,
  milestoneName: string | null = null,
): SpecEpic[] {
  if (!section) {
    return [];
  }

  const epics: SpecEpic[] = [];
  let current: SpecEpic | null = null;

  for (const rawLine of section.body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const epicMatch = line.match(/^Epic:\s+(.+)$/);
    if (epicMatch) {
      if (current) {
        epics.push(current);
      }
      current = {
        name: epicMatch[1].trim(),
        tasks: [],
        milestoneName,
      };
      continue;
    }

    const bulletMatch = line.match(LIST_PATTERN);
    if (bulletMatch && current) {
      current.tasks.push(cleanExtractedText(bulletMatch[1]));
    }
  }

  if (current) {
    epics.push(current);
  }

  return epics;
}

function normalizeTitleKey(value: string | null | undefined) {
  return cleanExtractedText(value ?? "").toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => cleanExtractedText(value)).filter(Boolean))];
}

function mergeEpics(primary: SpecEpic[], secondary: SpecEpic[]) {
  const merged: SpecEpic[] = [];
  const indexesByName = new Map<string, number>();

  for (const epic of [...primary, ...secondary]) {
    const key = normalizeTitleKey(epic.name);
    const existingIndex = indexesByName.get(key);

    if (existingIndex === undefined) {
      merged.push({
        ...epic,
        milestoneName: epic.milestoneName ?? null,
        tasks: unique(epic.tasks),
      });
      indexesByName.set(key, merged.length - 1);
      continue;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      milestoneName: existing.milestoneName ?? epic.milestoneName ?? null,
      tasks: unique([...existing.tasks, ...epic.tasks]),
    };
  }

  return merged.filter((epic) => epic.tasks.length > 0);
}

function collectSentenceCandidates(body: string) {
  return unique(
    body
      .split(/\r?\n/)
      .map((line) => cleanExtractedText(line))
      .filter(Boolean)
      .filter((line) => !LIST_PATTERN.test(line))
      .flatMap((line) =>
        line
          .split(/(?<=[.!?])\s+/)
          .map((sentence) => cleanExtractedText(sentence))
          .filter((sentence) => sentence.length >= 24 && sentence.length <= 160),
      ),
  );
}

function isMetaTopLevelSection(title: string) {
  const normalized = title.toLowerCase();
  return (
    normalized.includes("executive summary") ||
    normalized.includes("overview") ||
    normalized.includes("appendix") ||
    normalized.includes("references")
  );
}

function deriveTasksFromSection(
  sections: SectionBlock[],
  index: number,
  maxTasks = 6,
) {
  const section = sections[index];
  const descendants = sectionDescendants(sections, index);
  const immediateChildTitles = descendants
    .filter((candidate) => candidate.level === section.level + 1)
    .map((candidate) => candidate.title);
  const descendantBullets = descendants
    .filter((candidate) => candidate.level === section.level + 1)
    .flatMap((candidate) => candidate.bullets);
  const structuredCandidates = unique([
    ...immediateChildTitles,
    ...section.bullets,
    ...descendantBullets,
  ]);

  if (structuredCandidates.length > 0) {
    return structuredCandidates.slice(0, maxTasks);
  }

  return collectSentenceCandidates(section.body).slice(0, maxTasks);
}

function inferMilestonesFromHeadings(sections: SectionBlock[]): SpecMilestone[] {
  return sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.level === 2 && !isMetaTopLevelSection(section.title))
    .map(({ section, index }) => ({
      name: section.title,
      tasks: deriveTasksFromSection(sections, index),
    }))
    .filter((milestone) => milestone.tasks.length > 0);
}

function inferEpicsFromHeadings(sections: SectionBlock[]): SpecEpic[] {
  return sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.level >= 3)
    .map(({ section, index }) => {
      const parentIndex = parentSectionIndex(sections, index);
      const parentSection = parentIndex === null ? null : sections[parentIndex];

      return {
        name: section.title,
        tasks: deriveTasksFromSection(sections, index, 5),
        milestoneName:
          parentSection && parentSection.level === 2 && !isMetaTopLevelSection(parentSection.title)
            ? parentSection.title
            : null,
      };
    })
    .filter((epic) => epic.milestoneName !== null)
    .filter((epic) => epic.tasks.length > 0);
}

function collectAcceptanceCriteria(sections: SectionBlock[]) {
  const explicit = findSection(sections, "MVP scope")?.bullets ?? [];
  const promiseBullets = sections
    .filter((section) =>
      /\bpromise\b|\bacceptance criteria\b|\bsuccess criteria\b|\brequirements?\b/i.test(
        section.title,
      ),
    )
    .flatMap((section) => section.bullets);
  const implicit = sections.flatMap((section) =>
    section.body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\bmust\b|\brequired\b|\bblock\b/i.test(line)),
  );

  return unique([...explicit, ...promiseBullets, ...implicit]).slice(0, 18);
}

function collectRisks(sections: SectionBlock[]) {
  return unique(
    sections.flatMap((section) => {
      const titledRisk =
        section.title.toLowerCase().includes("risk") ||
        section.title.toLowerCase().includes("open question");
      const bodyLines = section.body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => titledRisk || /^Risk:/i.test(line));

      return [...(titledRisk ? section.bullets : []), ...bodyLines];
    }),
  ).slice(0, 12);
}

function collectOpenQuestions(sections: SectionBlock[]) {
  const explicitSection = findSection(sections, "Open questions");
  const explicit = explicitSection
    ? [
        ...explicitSection.bullets,
        ...explicitSection.body
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => /\?$/.test(line)),
      ]
    : [];

  const implicit = sections.flatMap((section) => {
    const treatAllLinesAsQuestions = /\bopen questions?\b|\bunknowns?\b/i.test(section.title);
    return [
      ...(treatAllLinesAsQuestions ? section.bullets : []),
      ...section.body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(
          (line) =>
            (treatAllLinesAsQuestions && line.length > 0) || /\?$/.test(line),
        ),
    ];
  });

  return unique([...explicit, ...implicit]).slice(0, 12);
}

function collectEntities(text: string) {
  const backticks = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const capitalized = [...text.matchAll(/\b([A-Z][A-Za-z0-9/+-]{2,})\b/g)].map(
    (match) => match[1],
  );
  return unique([...backticks, ...capitalized]).slice(0, 24);
}

function collectIntegrations(text: string) {
  const candidates = [
    "Codex",
    "Symphony",
    "Linear",
    "Playwright",
    "Semgrep",
    "Trivy",
    "ZAP",
    "Docker",
    "Azure",
    "AWS",
    "Jetson",
    "Cosmos DB",
    "DynamoDB",
  ];

  return candidates.filter((candidate) =>
    text.toLowerCase().includes(candidate.toLowerCase()),
  );
}

function collectConstraints(sections: SectionBlock[]) {
  return unique(
    sections.flatMap((section) =>
      section.body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(
          (line) =>
            /\bmust\b|\bcannot\b|\bconstraint\b|\brequired\b|\bdefault\b/i.test(
              line,
            ),
        ),
    ),
  ).slice(0, 20);
}

function collectRoles(text: string) {
  const roleCandidates = [
    "Planner / Decomposition Agent",
    "Implementation Agent",
    "QA Agent",
    "Security Agent",
    "UI/UX Review Agent",
    "Deployment Agent",
    "Docs/Runbook Agent",
    "Release Readiness Agent",
  ];

  return roleCandidates.filter((candidate) => text.includes(candidate));
}

function collectDeploymentTargets(text: string): DeploymentTarget[] {
  return DEPLOYMENT_TARGETS.filter((target) =>
    text.toLowerCase().includes(target.toLowerCase()),
  );
}

export function getContentHash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export function buildSpecIr(markdown: string): SpecIR {
  const sections = splitIntoSections(markdown);
  const outline = extractOutline(markdown);
  const inferredMilestones = inferMilestonesFromHeadings(sections);
  const inferredEpics = inferEpicsFromHeadings(sections);
  const explicitMilestoneSection = findSection(
    sections,
    "Implementation plan broken into milestones",
  );
  const explicitEpicSectionIndex = findSectionIndex(
    sections,
    "Detailed backlog / epics / tasks",
  );
  const explicitEpicSection =
    explicitEpicSectionIndex === -1 ? undefined : sections[explicitEpicSectionIndex];
  const explicitEpicParentIndex =
    explicitEpicSectionIndex === -1
      ? null
      : parentSectionIndex(sections, explicitEpicSectionIndex);
  const explicitEpicMilestoneName =
    explicitEpicParentIndex !== null &&
    sections[explicitEpicParentIndex] &&
    sections[explicitEpicParentIndex].level === 2 &&
    !isMetaTopLevelSection(sections[explicitEpicParentIndex].title)
      ? sections[explicitEpicParentIndex].title
      : null;
  const explicitMilestones = extractMilestones(explicitMilestoneSection);
  const explicitEpics = extractEpics(explicitEpicSection, explicitEpicMilestoneName);
  const markdownH2Count = countMarkdownHeadings(markdown, 2);
  const markdownH3Count = countMarkdownHeadings(markdown, 3);
  const preferHeadingStructure =
    markdownH2Count >= 2 || (markdownH2Count >= 1 && markdownH3Count >= 1);
  const milestones =
    preferHeadingStructure && inferredMilestones.length > 0
      ? inferredMilestones
      : explicitMilestones.length > 0
        ? explicitMilestones
        : inferredMilestones;
  const epics =
    preferHeadingStructure
      ? mergeEpics(inferredEpics, explicitEpics)
      : explicitEpics.length > 0
        ? mergeEpics(explicitEpics, inferredEpics)
        : mergeEpics(inferredEpics, explicitEpics);
  const openQuestions = collectOpenQuestions(sections);
  const acceptanceCriteria = collectAcceptanceCriteria(sections);
  const integrations = collectIntegrations(markdown);
  const risks = collectRisks(sections);
  const constraints = collectConstraints(sections);
  const summarySection = findSection(sections, "Executive summary");
  const summary =
    summarySection?.body.replace(/\s+/g, " ").trim().slice(0, 520) ??
    "Structured software delivery blueprint with strict QA, security, and deployment gates.";

  return {
    summary,
    outline,
    sections,
    features: unique([
      ...milestones.map((milestone) => milestone.name),
      ...epics.map((epic) => epic.name),
      ...acceptanceCriteria.slice(0, 8),
    ]),
    roles: collectRoles(markdown),
    entities: collectEntities(markdown),
    integrations,
    constraints,
    risks,
    acceptanceCriteria,
    deploymentTargets: collectDeploymentTargets(markdown),
    milestones,
    epics,
    openQuestions,
  };
}
