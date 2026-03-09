import { buildSchema, graphql } from "graphql";
import {
  addTrackerComment,
  getTrackerIssueById,
  listTrackerIssuesForProject,
  updateWorkItemFromTracker,
} from "@/lib/server/repository";

const schema = buildSchema(`
  type Query {
    issues(filter: IssueFilter, first: Int, after: String): IssueConnection!
    issue(id: ID!): Issue
  }

  type Mutation {
    commentCreate(input: CommentCreateInput!): MutationSuccess!
    issueUpdate(id: ID!, input: IssueUpdateInput!): MutationSuccess!
  }

  input IssueFilter {
    project: IssueProjectFilter
    state: IssueStateFilter
    id: IssueIdFilter
  }

  input IssueProjectFilter {
    slugId: StringEqFilter
  }

  input IssueStateFilter {
    name: StringInFilter
  }

  input IssueIdFilter {
    in: [ID!]
  }

  input StringEqFilter {
    eq: String
  }

  input StringInFilter {
    in: [String!]
    eq: String
  }

  input CommentCreateInput {
    issueId: ID!
    body: String!
  }

  input IssueUpdateInput {
    stateId: ID!
  }

  type MutationSuccess {
    success: Boolean!
  }

  type IssueConnection {
    nodes: [Issue!]!
    pageInfo: PageInfo!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type Issue {
    id: ID!
    identifier: String!
    title: String!
    description: String!
    url: String!
    updatedAt: String!
    state: TeamState!
    team: Team!
  }

  type Team {
    states(filter: TeamStateFilter): TeamStateConnection!
  }

  input TeamStateFilter {
    name: StringInFilter
  }

  type TeamStateConnection {
    nodes: [TeamState!]!
  }

  type TeamState {
    id: ID!
    name: String!
  }
`);

const teamStates = [
  { id: "state-todo", name: "Todo" },
  { id: "state-in-progress", name: "In Progress" },
  { id: "state-review", name: "Review" },
  { id: "state-blocked", name: "Blocked" },
  { id: "state-done", name: "Done" },
];

function issueToGraphql(issue: NonNullable<ReturnType<typeof getTrackerIssueById>>) {
  return {
    ...issue,
    state: {
      id: issue.stateId,
      name: issue.stateName,
    },
    team: {
      states: ({
        filter,
      }: {
        filter?: {
          name?: {
            eq?: string;
            in?: string[];
          };
        };
      }) => {
        const candidateNames = filter?.name?.in ?? (filter?.name?.eq ? [filter.name.eq] : []);
        return {
          nodes: candidateNames.length
            ? teamStates.filter((state) => candidateNames.includes(state.name))
            : teamStates,
        };
      },
    },
  };
}

export async function executeTrackerQuery(input: {
  query: string;
  variables?: Record<string, unknown>;
  tokenRole: "symphony" | "control" | "anonymous";
}) {
  return graphql({
    schema,
    source: input.query,
    variableValues: input.variables,
    rootValue: {
      issues: ({
        filter,
      }: {
        filter?: {
          project?: {
            slugId?: {
              eq?: string;
            };
          };
          state?: {
            name?: {
              in?: string[];
            };
          };
          id?: {
            in?: string[];
          };
        };
      }) => {
        const projectSlug = filter?.project?.slugId?.eq;
        const states = filter?.state?.name?.in;
        const ids = filter?.id?.in;

        const issues =
          ids?.length
            ? ids
                .map((id) => getTrackerIssueById(id))
                .filter(Boolean)
                .map((issue) => issueToGraphql(issue!))
            : projectSlug
              ? listTrackerIssuesForProject(projectSlug, states).map((issue) =>
                  issueToGraphql({
                    ...issue,
                    stateName: issue.stateName,
                    stateId: issue.stateId,
                  }),
                )
              : [];

        return {
          nodes: issues,
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        };
      },
      issue: ({ id }: { id: string }) => {
        const issue = getTrackerIssueById(id);
        return issue ? issueToGraphql(issue) : null;
      },
      commentCreate: ({ input: mutationInput }: { input: { issueId: string; body: string } }) => {
        addTrackerComment(mutationInput);
        return { success: true };
      },
      issueUpdate: ({
        id,
        input: mutationInput,
      }: {
        id: string;
        input: { stateId: string };
      }) => {
        if (input.tokenRole !== "control" && mutationInput.stateId === "state-done") {
          throw new Error(
            "SYMPHONY_TRACKER_TOKEN cannot transition issues to terminal Done.",
          );
        }

        updateWorkItemFromTracker({
          issueId: id,
          stateId: mutationInput.stateId,
        });
        return { success: true };
      },
    },
  });
}
