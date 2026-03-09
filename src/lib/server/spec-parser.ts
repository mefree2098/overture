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

function splitIntoSections(text: string): SectionBlock[] {
  const lines = text.split(/\r?\n/);
  const sections: SectionBlock[] = [];
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
      current = {
        title: markdownMatch[2].trim(),
        level: markdownMatch[1].length,
        body: "",
        bullets: [],
      };
      continue;
    }

    if (boldMatch) {
      pushCurrent();
      current = {
        title: boldMatch[1].trim(),
        level: 2,
        body: "",
        bullets: [],
      };
      continue;
    }

    const bulletMatch = line.trim().match(BULLET_PATTERN);
    if (bulletMatch) {
      current.bullets.push(bulletMatch[1].trim());
    }

    current.body += `${line}\n`;
  }

  pushCurrent();

  return sections.filter((section) => section.body || section.bullets.length > 0);
}

function findSection(sections: SectionBlock[], query: string) {
  const normalized = query.toLowerCase();
  return sections.find((section) => section.title.toLowerCase().includes(normalized));
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

    const bulletMatch = line.match(BULLET_PATTERN);
    if (bulletMatch && current) {
      current.tasks.push(bulletMatch[1].trim());
    }
  }

  if (current) {
    milestones.push(current);
  }

  return milestones;
}

function extractEpics(section: SectionBlock | undefined): SpecEpic[] {
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
      };
      continue;
    }

    const bulletMatch = line.match(BULLET_PATTERN);
    if (bulletMatch && current) {
      current.tasks.push(bulletMatch[1].trim());
    }
  }

  if (current) {
    epics.push(current);
  }

  return epics;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function collectAcceptanceCriteria(sections: SectionBlock[]) {
  const explicit = findSection(sections, "MVP scope")?.bullets ?? [];
  const implicit = sections.flatMap((section) =>
    section.body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\bmust\b|\brequired\b|\bblock\b/i.test(line)),
  );

  return unique([...explicit, ...implicit]).slice(0, 18);
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

function collectOpenQuestions(section: SectionBlock | undefined) {
  if (!section) {
    return [];
  }

  return unique([
    ...section.bullets,
    ...section.body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\?$/.test(line)),
  ]);
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
  const milestones = extractMilestones(
    findSection(sections, "Implementation plan broken into milestones"),
  );
  const epics = extractEpics(findSection(sections, "Detailed backlog / epics / tasks"));
  const openQuestions = collectOpenQuestions(findSection(sections, "Open questions"));
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
