import { extractJiraIssueKey } from "@t3tools/shared/jira";
import { Effect, Layer } from "effect";

import { ServerSettingsService } from "../../serverSettings";
import { Jira, JiraError, type JiraShape } from "../Services/Jira";

interface JiraRestIssueResponse {
  readonly key?: string;
  readonly self?: string;
  readonly fields?: {
    readonly summary?: string;
    readonly status?: {
      readonly name?: string;
    };
    readonly assignee?: {
      readonly displayName?: string | null;
    } | null;
  };
}

function encodeBasicAuth(email: string, apiToken: string): string {
  return Buffer.from(`${email}:${apiToken}`, "utf8").toString("base64");
}

export const JiraLive = Layer.effect(
  Jira,
  Effect.gen(function* () {
    const settingsService = yield* ServerSettingsService;

    const service = {
      lookupIssue: (input) =>
        Effect.gen(function* () {
          const settings = yield* settingsService.getSettings.pipe(
            Effect.mapError(
              (cause) =>
                new JiraError({
                  message: "Failed to read server settings for Jira.",
                  cause,
                }),
            ),
          );
          const jira = settings.integrations.jira;
          if (
            !jira.enabled ||
            jira.baseUrl.trim().length === 0 ||
            jira.email.trim().length === 0 ||
            jira.apiToken.trim().length === 0
          ) {
            return {
              status: "not_configured",
              issueKey: null,
              issue: null,
              message: "Jira is not configured.",
            } as const;
          }

          const issueKey = extractJiraIssueKey(input.candidates);
          if (!issueKey) {
            return {
              status: "no_issue_key",
              issueKey: null,
              issue: null,
              message: "No Jira issue key detected.",
            } as const;
          }

          const baseUrl = jira.baseUrl.replace(/\/+$/g, "");
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
                headers: {
                  Accept: "application/json",
                  Authorization: `Basic ${encodeBasicAuth(jira.email, jira.apiToken)}`,
                },
              }),
            catch: (cause) =>
              new JiraError({
                message: "Failed to reach Jira.",
                cause,
              }),
          });

          if (response.status === 404) {
            return {
              status: "not_found",
              issueKey,
              issue: null,
              message: `Jira issue ${issueKey} was not found.`,
            } as const;
          }
          if (!response.ok) {
            return {
              status: "error",
              issueKey,
              issue: null,
              message: `Jira request failed with status ${response.status}.`,
            } as const;
          }

          const payload = (yield* Effect.tryPromise({
            try: () => response.json() as Promise<JiraRestIssueResponse>,
            catch: (cause) =>
              new JiraError({
                message: "Failed to parse Jira response.",
                cause,
              }),
          })) as JiraRestIssueResponse;

          const summary = payload.fields?.summary?.trim() ?? "";
          const status = payload.fields?.status?.name?.trim() ?? "";
          if (summary.length === 0 || status.length === 0) {
            return {
              status: "error",
              issueKey,
              issue: null,
              message: "Jira returned an incomplete issue payload.",
            } as const;
          }

          return {
            status: "connected",
            issueKey,
            issue: {
              key: payload.key?.trim() || issueKey,
              summary,
              status,
              assignee: payload.fields?.assignee?.displayName?.trim() || null,
              url: `${baseUrl}/browse/${payload.key?.trim() || issueKey}`,
            },
            message: null,
          } as const;
        }),
    } satisfies JiraShape;

    return service;
  }),
);
