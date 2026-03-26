import { describe, expect, it } from "vitest";

import {
  commandForProjectScript,
  DEFAULT_LOCALHOST_BASE_PORT,
  localhostLauncherProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
  projectScriptCwd,
  projectScriptContainsPortPlaceholder,
  projectScriptRuntimeEnv,
  projectScriptIdFromCommand,
  renderProjectScriptCommand,
  setupProjectScript,
} from "./projectScripts";

describe("projectScripts helpers", () => {
  it("builds and parses script run commands", () => {
    const command = commandForProjectScript("lint");
    expect(command).toBe("script.lint.run");
    expect(projectScriptIdFromCommand(command)).toBe("lint");
    expect(projectScriptIdFromCommand("terminal.toggle")).toBeNull();
  });

  it("slugifies and dedupes project script ids", () => {
    expect(nextProjectScriptId("Run Tests", [])).toBe("run-tests");
    expect(nextProjectScriptId("Run Tests", ["run-tests"])).toBe("run-tests-2");
    expect(nextProjectScriptId("!!!", [])).toBe("script");
  });

  it("resolves primary and setup scripts", () => {
    const scripts = [
      {
        id: "setup",
        name: "Setup",
        command: "bun install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
        runAsLocalhostLauncher: false,
        localhostBasePort: null,
      },
      {
        id: "test",
        name: "Test",
        command: "bun test",
        icon: "test" as const,
        runOnWorktreeCreate: false,
        runAsLocalhostLauncher: false,
        localhostBasePort: null,
      },
    ];

    expect(primaryProjectScript(scripts)?.id).toBe("test");
    expect(setupProjectScript(scripts)?.id).toBe("setup");
  });

  it("resolves localhost launcher scripts and renders their commands", () => {
    const scripts = [
      {
        id: "dev",
        name: "Dev",
        command: "npm run dev -- --port {{port}}",
        icon: "play" as const,
        runOnWorktreeCreate: false,
        runAsLocalhostLauncher: true,
        localhostBasePort: DEFAULT_LOCALHOST_BASE_PORT,
      },
    ];

    expect(localhostLauncherProjectScript(scripts)?.id).toBe("dev");
    expect(projectScriptContainsPortPlaceholder(scripts[0]!.command)).toBe(true);
    expect(
      renderProjectScriptCommand({
        command: scripts[0]!.command,
        port: 4202,
      }),
    ).toBe("npm run dev -- --port 4202");
  });

  it("builds default runtime env for scripts", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      worktreePath: "/repo/worktree-a",
    });

    expect(env).toMatchObject({
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/repo/worktree-a",
    });
  });

  it("allows overriding runtime env values", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      extraEnv: {
        T3CODE_PROJECT_ROOT: "/custom-root",
        CUSTOM_FLAG: "1",
      },
    });

    expect(env.T3CODE_PROJECT_ROOT).toBe("/custom-root");
    expect(env.CUSTOM_FLAG).toBe("1");
    expect(env.T3CODE_WORKTREE_PATH).toBeUndefined();
  });

  it("prefers the worktree path for script cwd resolution", () => {
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: "/repo/worktree-a",
      }),
    ).toBe("/repo/worktree-a");
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: null,
      }),
    ).toBe("/repo");
  });
});
