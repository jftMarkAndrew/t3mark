import { JiraIssueLookupInput, JiraIssueLookupResult } from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export class JiraError extends Schema.TaggedErrorClass<JiraError>()("JiraError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface JiraShape {
  readonly lookupIssue: (
    input: JiraIssueLookupInput,
  ) => Effect.Effect<JiraIssueLookupResult, JiraError>;
}

export class Jira extends ServiceMap.Service<Jira, JiraShape>()("t3/fork/Services/Jira") {}
