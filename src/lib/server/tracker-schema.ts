import { buildSchema, graphql } from "graphql";
import {
  addTrackerComment,
  getTrackerIssueById,
  listTrackerIssuesForProject,
  updateWorkItemFromTracker,
} from "@/lib/server/repository";
import type { TrackerIssue } from "@/lib/types";

const schema = buildSchema(`
  type Query {
    issues(filter: IssueFilter, first: Int, after: String): IssueConnection!
    issue(id: ID!): Issue
    viewer: Viewer!
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
    priority: Int
    branchName: String
    url: String!
    createdAt: String!
    updatedAt: String!
    state: TeamState!
    assignee: User
    labels: LabelConnection!
    inverseRelations(first: Int): InverseRelationConnection!
    team: Team!
  }

  type Team {
    states(filter: TeamStateFilter, first: Int): TeamStateConnection!
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

  type Viewer {
    id: ID!
  }

  type User {
    id: ID!
  }

  type LabelConnection {
    nodes: [Label!]!
  }

  type Label {
    name: String!
  }

  type InverseRelationConnection {
    nodes: [InverseRelation!]!
  }

  type InverseRelation {
    type: String!
    issue: Issue!
  }
`);

const teamStates = [
  { id: "state-todo", name: "Todo" },
  { id: "state-in-progress", name: "In Progress" },
  { id: "state-review", name: "Review" },
  { id: "state-blocked", name: "Blocked" },
  { id: "state-done", name: "Done" },
];

function issueToGraphql(issue: TrackerIssue) {
  return {
    ...issue,
    priority: issue.priority,
    branchName: issue.branchName,
    state: {
      id: issue.stateId,
      name: issue.stateName,
    },
    assignee: issue.assigneeId ? { id: issue.assigneeId } : null,
    labels: {
      nodes: issue.labels.map((name) => ({ name })),
    },
    inverseRelations: () => ({
      nodes: issue.blockedBy.map((blocker) => ({
        type: "blocks",
        issue: {
          id: blocker.id,
          identifier: blocker.identifier,
          title: blocker.identifier,
          description: "",
          priority: null,
          branchName: null,
          url: "",
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          state: {
            id: teamStates.find((state) => state.name === blocker.stateName)?.id ?? "state-todo",
            name: blocker.stateName ?? "Todo",
          },
          assignee: null,
          labels: { nodes: [] },
          inverseRelations: () => ({ nodes: [] }),
          team: {
            states: () => ({
              nodes: teamStates,
            }),
          },
        },
      })),
    }),
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
                  issueToGraphql(issue),
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
      viewer: () => ({
        id: "overture-worker",
      }),
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
