const JIRA_ISSUE_KEY_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/;

export function extractJiraIssueKey(
  candidates: Iterable<string | null | undefined>,
): string | null {
  for (const candidate of candidates) {
    const normalized = candidate?.trim() ?? "";
    if (normalized.length === 0) {
      continue;
    }
    const match = JIRA_ISSUE_KEY_PATTERN.exec(normalized.toUpperCase());
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}
