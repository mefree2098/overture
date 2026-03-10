export interface ResearchCitation {
  title: string;
  url: string;
  source?: string | null;
}

export interface ResearchBundle {
  summary: string;
  researchReport: string;
  planMarkdown: string;
  architectureDecisions: string | null;
  citations: ResearchCitation[];
  openQuestions: string[];
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
}

export function buildResearchSummaryJson(bundle: ResearchBundle) {
  return JSON.stringify(
    {
      summary: bundle.summary,
      openQuestions: bundle.openQuestions,
      citations: bundle.citations,
      tokenUsage: bundle.tokenUsage ?? null,
    },
    null,
    2,
  );
}

export function normalizeResearchBundle(bundle: ResearchBundle): ResearchBundle {
  return {
    summary: bundle.summary.trim(),
    researchReport: bundle.researchReport.trim(),
    planMarkdown: bundle.planMarkdown.trim(),
    architectureDecisions: bundle.architectureDecisions?.trim() || null,
    citations: bundle.citations
      .map((citation) => ({
        title: citation.title.trim(),
        url: citation.url.trim(),
        source: citation.source?.trim() || null,
      }))
      .filter((citation) => citation.title && citation.url),
    openQuestions: bundle.openQuestions.map((item) => item.trim()).filter(Boolean),
    tokenUsage: bundle.tokenUsage ?? null,
  };
}
