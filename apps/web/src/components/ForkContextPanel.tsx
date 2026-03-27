import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";
import { extractJiraIssueKey } from "@t3tools/shared/jira";
import { useEffect, useMemo, useState } from "react";

import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import DiffPanel from "./DiffPanel";
import { PatchDiffView } from "./PatchDiffView";
import { Button } from "./ui/button";
import { cn } from "~/lib/utils";
import { useStore } from "../store";
import {
  gitOpenPullRequestsQueryOptions,
  gitPullRequestDiffQueryOptions,
  gitStatusQueryOptions,
} from "../lib/gitReactQuery";
import { jiraIssueQueryOptions } from "../lib/forkReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";

type ContextPanelTab = "turn" | "pr" | "issue";

function ContextTabs(props: {
  activeTab: ContextPanelTab;
  tabs: ReadonlyArray<{ id: ContextPanelTab; label: string }>;
  onSelect: (tab: ContextPanelTab) => void;
}) {
  return (
    <div className="border-b border-border bg-card/80 px-3 py-2">
      <div className="flex items-center gap-1">
        {props.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              props.activeTab === tab.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            onClick={() => props.onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PullRequestDiffPanel(props: {
  mode: DiffPanelMode;
  isLoading: boolean;
  errorMessage: string | null;
  diff: {
    pullRequest: {
      number: number;
      title: string;
      baseBranch: string;
      headBranch: string;
      url: string;
    };
    patch: string;
    files: Array<{ path: string; additions: number; deletions: number }>;
  } | null;
  cwd: string | null;
}) {
  const api = readNativeApi();
  const diff = props.diff;

  return (
    <DiffPanelShell
      mode={props.mode}
      header={
        <div className="flex min-w-0 items-center justify-between gap-2 [-webkit-app-region:no-drag]">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">PR Diff</div>
            {diff ? (
              <div className="truncate text-[11px] text-muted-foreground">
                #{diff.pullRequest.number} {diff.pullRequest.baseBranch} →{" "}
                {diff.pullRequest.headBranch}
              </div>
            ) : null}
          </div>
          {diff ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!api) {
                  return;
                }
                void api.shell.openExternal(diff.pullRequest.url).catch(() => undefined);
              }}
            >
              Open PR
            </Button>
          ) : null}
        </div>
      }
    >
      {props.isLoading ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Loading pull request diff...
        </div>
      ) : props.errorMessage ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-red-500/80">
          {props.errorMessage}
        </div>
      ) : !diff ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No pull request is associated with this thread.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <div className="truncate text-sm font-medium text-foreground">
              {diff.pullRequest.title}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {diff.files.map((file) => (
                <span
                  key={file.path}
                  className="rounded-md border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground"
                >
                  {file.path} {file.additions > 0 ? `+${file.additions}` : ""}{" "}
                  {file.deletions > 0 ? `-${file.deletions}` : ""}
                </span>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <PatchDiffView patch={diff.patch} cacheScope="fork-pr-diff" cwd={props.cwd} />
          </div>
        </div>
      )}
    </DiffPanelShell>
  );
}

function JiraIssuePanel(props: {
  mode: DiffPanelMode;
  jiraEnabled: boolean;
  result: {
    status: "connected" | "not_configured" | "no_issue_key" | "not_found" | "error";
    message: string | null;
    issue: {
      key: string;
      summary: string;
      status: string;
      assignee: string | null;
      url: string;
    } | null;
  } | null;
  isLoading: boolean;
}) {
  const api = readNativeApi();
  const issue = props.result?.issue ?? null;

  return (
    <DiffPanelShell
      mode={props.mode}
      header={
        <div className="flex min-w-0 items-center justify-between gap-2 [-webkit-app-region:no-drag]">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">Issue</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {issue?.key ?? (props.jiraEnabled ? "Jira connected" : "Jira unavailable")}
            </div>
          </div>
          {issue ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!api) {
                  return;
                }
                void api.shell.openExternal(issue.url).catch(() => undefined);
              }}
            >
              Open Issue
            </Button>
          ) : null}
        </div>
      }
    >
      {props.isLoading ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Loading Jira issue...
        </div>
      ) : issue ? (
        <div className="p-4">
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {issue.key}
            </div>
            <div className="mt-2 text-sm font-medium text-foreground">{issue.summary}</div>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <span className="rounded-full border border-border/70 px-2 py-1">
                Status: {issue.status}
              </span>
              <span className="rounded-full border border-border/70 px-2 py-1">
                Assignee: {issue.assignee ?? "Unassigned"}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          {props.result?.message ??
            (props.jiraEnabled
              ? "No Jira issue detected for this thread."
              : "Jira is not configured.")}
        </div>
      )}
    </DiffPanelShell>
  );
}

export default function ForkContextPanel(props: { mode?: DiffPanelMode }) {
  const mode = props.mode ?? "inline";
  const activeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeThread = useStore((store) =>
    activeThreadId ? store.threads.find((thread) => thread.id === activeThreadId) : undefined,
  );
  const activeProject = useStore((store) =>
    activeThread
      ? store.projects.find((project) => project.id === activeThread.projectId)
      : undefined,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
  const projectCwd = activeProject?.cwd ?? null;
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const gitStatusQuery = useQuery(gitStatusQueryOptions(activeCwd));
  const projectOpenPullRequestsQuery = useQuery(gitOpenPullRequestsQueryOptions(projectCwd));
  const detectedIssueKey = useMemo(
    () => extractJiraIssueKey([activeThread?.title, activeThread?.branch]),
    [activeThread?.branch, activeThread?.title],
  );
  const matchedOpenPullRequest = useMemo(() => {
    const pullRequests = projectOpenPullRequestsQuery.data?.pullRequests ?? [];
    if (pullRequests.length === 0) {
      return null;
    }
    if (activeThread?.branch) {
      const branchMatch =
        pullRequests.find((pullRequest) => pullRequest.headBranch === activeThread.branch) ?? null;
      if (branchMatch) {
        return branchMatch;
      }
    }
    if (activeThread?.title) {
      const titleMatch =
        pullRequests.find(
          (pullRequest) =>
            pullRequest.title.localeCompare(activeThread.title, undefined, {
              sensitivity: "base",
            }) === 0,
        ) ?? null;
      if (titleMatch) {
        return titleMatch;
      }
    }
    if (detectedIssueKey) {
      return (
        pullRequests.find((pullRequest) =>
          [pullRequest.title, pullRequest.headBranch].some((value) =>
            value.toUpperCase().includes(detectedIssueKey),
          ),
        ) ?? null
      );
    }
    return null;
  }, [
    activeThread?.branch,
    activeThread?.title,
    detectedIssueKey,
    projectOpenPullRequestsQuery.data?.pullRequests,
  ]);
  const prReference = gitStatusQuery.data?.pr
    ? String(gitStatusQuery.data.pr.number)
    : matchedOpenPullRequest
      ? String(matchedOpenPullRequest.number)
      : null;
  const prDiffQuery = useQuery(
    gitPullRequestDiffQueryOptions({
      cwd: projectCwd,
      reference: prReference,
    }),
  );
  const jiraCandidates = useMemo(
    () =>
      [
        activeThread?.title ?? null,
        activeThread?.branch ?? null,
        gitStatusQuery.data?.pr?.title ?? null,
        matchedOpenPullRequest?.title ?? null,
        prDiffQuery.data?.pullRequest.title ?? null,
      ].filter((candidate): candidate is string =>
        Boolean(candidate && candidate.trim().length > 0),
      ),
    [
      activeThread?.branch,
      activeThread?.title,
      gitStatusQuery.data?.pr?.title,
      matchedOpenPullRequest?.title,
      prDiffQuery.data?.pullRequest.title,
    ],
  );
  const jiraQuery = useQuery(jiraIssueQueryOptions(jiraCandidates));
  const jiraEnabled = serverConfigQuery.data?.settings.integrations.jira.enabled ?? false;
  const tabs = useMemo(() => {
    const next: Array<{ id: ContextPanelTab; label: string }> = [
      { id: "turn", label: "Turn Diff" },
    ];
    if (prReference) {
      next.push({ id: "pr", label: "PR Diff" });
    }
    if (jiraEnabled || jiraCandidates.length > 0) {
      next.push({ id: "issue", label: "Issue" });
    }
    return next;
  }, [jiraCandidates.length, jiraEnabled, prReference]);
  const [activeTab, setActiveTab] = useState<ContextPanelTab>("turn");

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("turn");
    }
  }, [activeTab, tabs]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ContextTabs activeTab={activeTab} tabs={tabs} onSelect={setActiveTab} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "turn" ? (
          <DiffPanel mode={mode} />
        ) : activeTab === "pr" ? (
          <PullRequestDiffPanel
            mode={mode}
            isLoading={prDiffQuery.isLoading}
            errorMessage={prDiffQuery.error instanceof Error ? prDiffQuery.error.message : null}
            cwd={projectCwd}
            diff={
              prDiffQuery.data
                ? {
                    pullRequest: {
                      number: prDiffQuery.data.pullRequest.number,
                      title: prDiffQuery.data.pullRequest.title,
                      baseBranch: prDiffQuery.data.pullRequest.baseBranch,
                      headBranch: prDiffQuery.data.pullRequest.headBranch,
                      url: prDiffQuery.data.pullRequest.url,
                    },
                    patch: prDiffQuery.data.patch,
                    files: prDiffQuery.data.files.map((file) => ({
                      path: file.path,
                      additions: file.additions,
                      deletions: file.deletions,
                    })),
                  }
                : null
            }
          />
        ) : (
          <JiraIssuePanel
            mode={mode}
            jiraEnabled={jiraEnabled}
            result={jiraQuery.data ?? null}
            isLoading={jiraQuery.isLoading}
          />
        )}
      </div>
    </div>
  );
}
