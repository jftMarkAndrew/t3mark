import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

const DEV_HOSTS_STALE_TIME_MS = 2_000;
const DEV_HOSTS_REFETCH_INTERVAL_MS = 5_000;

export const forkQueryKeys = {
  all: ["fork"] as const,
  devHosts: () => ["fork", "dev-hosts"] as const,
  jiraIssue: (candidates: readonly string[]) => ["fork", "jira-issue", ...candidates] as const,
};

export function devHostsQueryOptions() {
  return queryOptions({
    queryKey: forkQueryKeys.devHosts(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.devHosts.list();
    },
    staleTime: DEV_HOSTS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: DEV_HOSTS_REFETCH_INTERVAL_MS,
  });
}

export function jiraIssueQueryOptions(candidates: readonly string[]) {
  return queryOptions({
    queryKey: forkQueryKeys.jiraIssue(candidates),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getJiraIssue({ candidates: [...candidates] });
    },
    enabled: candidates.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}
