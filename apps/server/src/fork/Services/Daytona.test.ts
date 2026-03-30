import { afterEach, describe, expect, it } from "vitest";

import { parseGitHubRepoUrl, resolveDaytonaGitToken, resolveDaytonaServerStatus } from "./Daytona";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("Daytona service helpers", () => {
  it("parses supported GitHub HTTPS repository URLs", () => {
    expect(parseGitHubRepoUrl("https://github.com/owner/repo.git")).toEqual({
      normalizedUrl: "https://github.com/owner/repo.git",
      host: "github.com",
    });
    expect(parseGitHubRepoUrl("git@github.com:owner/repo.git")).toBeNull();
    expect(parseGitHubRepoUrl("https://gitlab.com/owner/repo.git")).toBeNull();
  });

  it("reads the Daytona Git token from the environment", () => {
    process.env.DAYTONA_GIT_TOKEN = " secret-token ";
    expect(resolveDaytonaGitToken()).toBe("secret-token");
  });

  it("reports when private GitHub previews are not fully configured", () => {
    delete process.env.DAYTONA_GIT_TOKEN;
    delete process.env.DAYTONA_API_KEY;
    const status = resolveDaytonaServerStatus();
    expect(status.configured).toBe(true);
    expect(status.message).toContain("DAYTONA_GIT_TOKEN");
  });
});
