import { describe, expect, it } from "vitest";

import { extractJiraIssueKey } from "./jira";

describe("extractJiraIssueKey", () => {
  it("finds the first Jira key across mixed candidates", () => {
    expect(
      extractJiraIssueKey(["feature/noet-1234-something", "PR title", "NOET-5678 follow-up"]),
    ).toBe("NOET-1234");
  });

  it("returns null when no Jira key is present", () => {
    expect(extractJiraIssueKey(["feature/no-ticket", "small cleanup"])).toBeNull();
  });
});
