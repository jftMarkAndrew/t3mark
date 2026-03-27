import { Schema } from "effect";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";

export const JiraSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  baseUrl: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  email: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  apiToken: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
});
export type JiraSettings = typeof JiraSettings.Type;

export const JiraSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  baseUrl: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
  apiToken: Schema.optionalKey(Schema.String),
});
export type JiraSettingsPatch = typeof JiraSettingsPatch.Type;

export const JiraIssueSummary = Schema.Struct({
  key: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  status: TrimmedNonEmptyString,
  assignee: Schema.NullOr(TrimmedNonEmptyString),
  url: TrimmedNonEmptyString,
});
export type JiraIssueSummary = typeof JiraIssueSummary.Type;

export const JiraIssueLookupStatus = Schema.Literals([
  "connected",
  "not_configured",
  "no_issue_key",
  "not_found",
  "error",
]);
export type JiraIssueLookupStatus = typeof JiraIssueLookupStatus.Type;

export const JiraIssueLookupInput = Schema.Struct({
  candidates: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type JiraIssueLookupInput = typeof JiraIssueLookupInput.Type;

export const JiraIssueLookupResult = Schema.Struct({
  status: JiraIssueLookupStatus,
  issueKey: Schema.NullOr(TrimmedNonEmptyString),
  issue: Schema.NullOr(JiraIssueSummary),
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type JiraIssueLookupResult = typeof JiraIssueLookupResult.Type;
