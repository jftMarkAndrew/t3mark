import type { GitBranch } from "@t3tools/contracts";

import type { Thread } from "./types";

function normalizeWorktreePath(path: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

export function resolveTrackedWorktreePath(
  worktreePath: string | null,
  branches: ReadonlyArray<Pick<GitBranch, "worktreePath">> | null | undefined,
): string | null {
  const normalizedWorktreePath = normalizeWorktreePath(worktreePath);
  if (!normalizedWorktreePath) {
    return null;
  }
  if (!branches) {
    return normalizedWorktreePath;
  }
  return branches.some(
    (branch) => normalizeWorktreePath(branch.worktreePath) === normalizedWorktreePath,
  )
    ? normalizedWorktreePath
    : null;
}

export function getOrphanedWorktreePathForThread(
  threads: readonly Thread[],
  threadId: Thread["id"],
): string | null {
  const targetThread = threads.find((thread) => thread.id === threadId);
  if (!targetThread) {
    return null;
  }

  const targetWorktreePath = normalizeWorktreePath(targetThread.worktreePath);
  if (!targetWorktreePath) {
    return null;
  }

  const isShared = threads.some((thread) => {
    if (thread.id === threadId) {
      return false;
    }
    return normalizeWorktreePath(thread.worktreePath) === targetWorktreePath;
  });

  return isShared ? null : targetWorktreePath;
}

export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim();
  if (!trimmed) {
    return worktreePath;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1]?.trim() ?? "";
  return lastPart.length > 0 ? lastPart : trimmed;
}
