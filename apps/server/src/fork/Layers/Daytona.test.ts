import { describe, expect, it } from "vitest";
import type { OrchestrationProject, OrchestrationThread } from "@t3tools/contracts";

import {
  buildGitHubCloneCommand,
  launchDaytonaSandboxFullStackPreview,
  launchDaytonaSandboxPreview,
  normalizeDaytonaDevCommand,
  resolveBranch,
  resolveInstallCommands,
  resolveResourceProfiles,
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
      launchMode: "single-process",
      repoUrl: "https://github.com/owner/repo.git",
      defaultBranch: "main",
      installCommand: null,
      devCommand: "npm run start",
      previewPort: 4200,
      serverCommand: null,
      webCommand: null,
      serverPort: null,
      webPort: null,
      daytonaCredentialProfileId: null,
      gitCredentialProfileId: null,
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

  it("uses heavier Daytona resources for the full-stack t3 monorepo", () => {
    expect(
      resolveResourceProfiles({
        packageJson: { name: "@t3tools/monorepo" },
        launchMode: "full-stack-web",
      })[0],
    ).toEqual({
      cpu: 8,
      memory: 16,
      disk: 20,
    });
  });

  it("normalizes the t3 monorepo install command to a preview-safe Bun command", () => {
    expect(
      resolveInstallCommands({
        project: makeProject({
          daytona: {
            ...makeProject().daytona!,
            launchMode: "full-stack-web",
            installCommand: "bun install",
          },
        }),
        packageJson: { name: "@t3tools/monorepo" },
        launchMode: "full-stack-web",
      }),
    ).toEqual([
      "bun install --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress",
      "bun install --filter './apps/server' --filter './apps/web' --filter './packages/contracts' --filter './packages/shared' --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress",
    ]);
  });

  it("launches a cloned Daytona preview in the expected order", async () => {
    const calls: string[] = [];
    const statuses: string[] = [];
    const sandbox = {
      id: "sandbox-1",
      process: {
        executeCommand: async (command: string, cwd?: string, _env?: Record<string, string>) => {
          calls.push(`execute:${cwd ?? ""}:${command}`);
          return { exitCode: 0, result: "" };
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
        branches: ["main", null],
        gitToken: "secret-token",
      },
      installCommands: ["npm ci"],
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
    expect(calls[2]).toBe("execute:workspace/repo:npm ci");
    expect(calls[3]).toBe("deleteSession:t3-preview");
    expect(calls[4]).toBe("createSession:t3-preview");
    expect(calls[5]).toContain("cd workspace/repo && npm run start");
    expect(calls[6]).toContain("curl -fsS -o /dev/null http://127.0.0.1:4200/");
    expect(calls[7]).toBe("preview");
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

  it("launches a full-stack Daytona preview with backend before frontend", async () => {
    const calls: string[] = [];
    const statuses: string[] = [];
    const signedPreviewUrls = new Map([
      [3773, "https://server-preview.example"],
      [5733, "https://web-preview.example"],
    ]);
    const sandbox = {
      id: "sandbox-1",
      process: {
        executeCommand: async (command: string, cwd?: string) => {
          calls.push(`execute:${cwd ?? ""}:${command}`);
          return { exitCode: 0, result: "" };
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
      },
      fs: {
        uploadFiles: async () => {
          calls.push("upload");
        },
      },
      getSignedPreviewUrl: async (port: number) => {
        calls.push(`preview:${port}`);
        return { url: signedPreviewUrls.get(port) ?? null };
      },
    } as unknown as DaytonaLaunchSandbox;

    const preview = await launchDaytonaSandboxFullStackPreview({
      sandbox,
      sourceStrategy: {
        kind: "clone",
        repoUrl: "https://github.com/owner/repo.git",
        branches: ["main", null],
        gitToken: "secret-token",
      },
      installCommands: [
        "bun install --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress",
      ],
      serverCommand: "bun run dev:server -- --host 0.0.0.0 --port 3773",
      webCommand: "bun run dev:web",
      serverPort: 3773,
      webPort: 5733,
      onStatus: async (statusDetail) => {
        statuses.push(statusDetail);
      },
    });

    expect(preview.primaryUrl).toBe("https://web-preview.example");
    expect(preview.serviceUrls).toEqual({
      web: "https://web-preview.example",
      server: "https://server-preview.example",
    });
    expect(statuses).toEqual([
      "Cloning repository",
      "Installing dependencies",
      "Starting backend",
      "Waiting for backend",
      "Starting frontend",
      "Waiting for frontend",
      "Waiting for preview",
    ]);
    expect(calls[2]).toBe(
      "execute:workspace/repo:bun install --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress",
    );
    expect(
      calls.some((call) => call.includes(`session:${"t3-preview-server"}:cd workspace/repo`)),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.includes(`session:${"t3-preview-web"}:cd workspace/repo`) &&
          call.includes("VITE_WS_URL='wss://server-preview.example/'"),
      ),
    ).toBe(true);
  });

  it("falls back to the filtered install command after an OOM-style install failure", async () => {
    const calls: string[] = [];
    const sandbox = {
      id: "sandbox-1",
      process: {
        executeCommand: async (command: string, cwd?: string) => {
          calls.push(`execute:${cwd ?? ""}:${command}`);
          if (command.includes("bun install --ignore-scripts") && !command.includes("--filter")) {
            return {
              exitCode: 137,
              result:
                'error: prepare script from "@t3tools/shared" terminated by SIGKILL (Forced quit)',
            };
          }
          return { exitCode: 0, result: "" };
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
      },
      fs: {
        uploadFiles: async () => {
          calls.push("upload");
        },
      },
      getSignedPreviewUrl: async (port: number) => ({ url: `https://preview-${port}.example` }),
    } as unknown as DaytonaLaunchSandbox;

    await launchDaytonaSandboxFullStackPreview({
      sandbox,
      sourceStrategy: {
        kind: "clone",
        repoUrl: "https://github.com/owner/repo.git",
        branches: ["main", null],
        gitToken: "secret-token",
      },
      installCommands: [
        "bun install --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress",
        "bun install --filter './apps/server' --filter './apps/web' --filter './packages/contracts' --filter './packages/shared' --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress",
      ],
      serverCommand: "bun run dev:server -- --host 0.0.0.0 --port 3773",
      webCommand: "bun run dev:web",
      serverPort: 3773,
      webPort: 5733,
      onStatus: async () => undefined,
    });

    expect(
      calls.filter((call) => call.startsWith("execute:workspace/repo:bun install")).slice(0, 2),
    ).toEqual([
      "execute:workspace/repo:bun install --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress",
      "execute:workspace/repo:bun install --filter './apps/server' --filter './apps/web' --filter './packages/contracts' --filter './packages/shared' --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress",
    ]);
  });
});
