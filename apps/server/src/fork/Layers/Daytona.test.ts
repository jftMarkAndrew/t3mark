import { describe, expect, it } from "vitest";
import type { OrchestrationProject, OrchestrationThread } from "@t3tools/contracts";

import {
  buildGitHubCloneCommand,
  launchDaytonaSandboxPreview,
  normalizeDaytonaDevCommand,
  resolveBranch,
  resolveDaytonaSourceStrategy,
  type DaytonaLaunchSandbox,
} from "./Daytona";

function makeProject(overrides: Partial<OrchestrationProject> = {}): OrchestrationProject {
  return {
    id: "project-1" as never,
    title: "Project",
    workspaceRoot: "/repo",
    defaultModelSelection: null,
    scripts: [],
    bootstrap: null,
    daytona: {
      enabled: true,
      repoUrl: "https://github.com/owner/repo.git",
      defaultBranch: "main",
      installCommand: null,
      devCommand: "npm run start",
      previewPort: 4200,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function makeThread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: "thread-1" as never,
    projectId: "project-1" as never,
    title: "Thread",
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    interactionMode: "default",
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    devServerPort: null,
    bootstrapStatus: "idle",
    bootstrapCommand: null,
    bootstrapLastError: null,
    pendingLocalhostLaunch: false,
    latestTurn: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

describe("Daytona launch helpers", () => {
  it("prefers the thread branch over the project default branch", () => {
    expect(resolveBranch(makeThread({ branch: "feature/x" }), makeProject())).toBe("feature/x");
    expect(resolveBranch(makeThread(), makeProject())).toBe("main");
  });

  it("requires a git token for GitHub clone launches", () => {
    expect(() =>
      resolveDaytonaSourceStrategy({
        project: makeProject(),
        thread: makeThread(),
        sourceWorkspacePath: "/repo",
        gitToken: null,
      }),
    ).toThrow("DAYTONA_GIT_TOKEN");
  });

  it("normalizes Angular start commands for remote previews", () => {
    expect(
      normalizeDaytonaDevCommand({
        packageJson: {
          dependencies: {
            "@angular/core": "^17.0.0",
          },
        },
        devCommand: "npm run start",
        previewPort: 4200,
      }),
    ).toBe("npm run start -- --host 0.0.0.0 --port 4200");
  });

  it("launches a cloned Daytona preview in the expected order", async () => {
    const calls: string[] = [];
    const statuses: string[] = [];
    const sandbox = {
      id: "sandbox-1",
      process: {
        executeCommand: async (command: string) => {
          calls.push(`execute:${command}`);
        },
        deleteSession: async (sessionId: string) => {
          calls.push(`deleteSession:${sessionId}`);
        },
        createSession: async (sessionId: string) => {
          calls.push(`createSession:${sessionId}`);
        },
        executeSessionCommand: async (
          sessionId: string,
          input: { command: string; runAsync: boolean },
        ) => {
          calls.push(`session:${sessionId}:${input.command}`);
        },
        createPty: async () => ({
          waitForConnection: async () => {
            calls.push("pty:connect");
          },
          sendInput: async (input: string) => {
            calls.push(`pty:input:${input.split("\n")[0] ?? ""}`);
          },
          wait: async () => ({ exitCode: 0 }),
          kill: async () => undefined,
          disconnect: async () => undefined,
        }),
      },
      fs: {
        uploadFiles: async () => {
          calls.push("upload");
        },
      },
      getSignedPreviewUrl: async () => {
        calls.push("preview");
        return { url: "https://preview.example" };
      },
    } as unknown as DaytonaLaunchSandbox;

    const previewUrl = await launchDaytonaSandboxPreview({
      sandbox,
      sourceStrategy: {
        kind: "clone",
        repoUrl: "https://github.com/owner/repo.git",
        branch: "main",
        gitToken: "secret-token",
      },
      installCommand: "npm ci",
      devCommand: "npm run start -- --host 0.0.0.0 --port 4200",
      previewPort: 4200,
      onStatus: async (statusDetail) => {
        statuses.push(statusDetail);
      },
    });

    expect(previewUrl).toBe("https://preview.example");
    expect(statuses).toEqual([
      "Cloning repository",
      "Installing dependencies",
      "Starting dev server",
      "Waiting for app on port 4200",
      "Waiting for preview on port 4200",
    ]);
    expect(calls[0]).toContain("mkdir -p 'workspace'");
    expect(calls[1]).toContain("git -c url.");
    expect(calls[2]).toBe("pty:connect");
    expect(calls[3]).toBe("pty:input:npm ci");
    expect(calls[4]).toBe("deleteSession:t3-preview");
    expect(calls[5]).toBe("createSession:t3-preview");
    expect(calls[6]).toContain("cd workspace/repo && npm run start");
    expect(calls[7]).toContain("curl -fsS -o /dev/null http://127.0.0.1:4200/");
    expect(calls[8]).toBe("preview");
    expect(calls.some((call) => call.startsWith("upload"))).toBe(false);
  });

  it("builds clone commands with a branch when available", () => {
    expect(
      buildGitHubCloneCommand({
        repoUrl: "https://github.com/owner/repo.git",
        branch: "main",
        gitToken: "secret token",
      }),
    ).toContain("--branch 'main' --single-branch");
  });
});
