import { describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { detectProjectBootstrap } from "./projectBootstrapDetection";

async function withTempProject(
  files: Readonly<Record<string, string>>,
  run: (cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "t3-bootstrap-detect-"));
  try {
    await Promise.all(
      Object.entries(files).map(async ([relativePath, contents]) => {
        const targetPath = path.join(cwd, relativePath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, contents, "utf8");
      }),
    );
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function packageJson(contents: Record<string, unknown>): string {
  return `${JSON.stringify(contents, null, 2)}\n`;
}

describe("detectProjectBootstrap", () => {
  it("detects a remote-safe Angular Daytona start command", async () => {
    await withTempProject(
      {
        "package.json": packageJson({
          name: "angular-app",
          scripts: {
            start: "ng serve",
          },
          dependencies: {
            "@angular/core": "^17.0.0",
          },
          devDependencies: {
            "@angular/cli": "^17.0.0",
          },
        }),
        "package-lock.json": "{}\n",
      },
      async (cwd) => {
        const result = await detectProjectBootstrap({ cwd });
        expect(result.detectedDaytonaDevCommand).toBe(
          "npm run start -- --host 0.0.0.0 --port 4200",
        );
        expect(result.detectedAppPort).toBe(4200);
      },
    );
  });

  it("falls back to ng serve for Angular repos without a start script", async () => {
    await withTempProject(
      {
        "package.json": packageJson({
          name: "angular-app",
          scripts: {},
          dependencies: {
            "@angular/core": "^17.0.0",
          },
          devDependencies: {
            "@angular/cli": "^17.0.0",
          },
        }),
        "package-lock.json": "{}\n",
      },
      async (cwd) => {
        const result = await detectProjectBootstrap({ cwd });
        expect(result.detectedDaytonaDevCommand).toBe("ng serve --host 0.0.0.0 --port 4200");
        expect(result.detectedAppPort).toBe(4200);
      },
    );
  });

  it("preserves explicit Angular ports in detected Daytona commands", async () => {
    await withTempProject(
      {
        "package.json": packageJson({
          name: "angular-app",
          scripts: {
            start: "ng serve --port 4400",
          },
          dependencies: {
            "@angular/core": "^17.0.0",
          },
          devDependencies: {
            "@angular/cli": "^17.0.0",
          },
        }),
        "package-lock.json": "{}\n",
      },
      async (cwd) => {
        const result = await detectProjectBootstrap({ cwd });
        expect(result.detectedDaytonaDevCommand).toBe(
          "npm run start -- --host 0.0.0.0 --port 4400",
        );
        expect(result.detectedAppPort).toBe(4400);
      },
    );
  });

  it("detects full-stack Daytona defaults for the t3 monorepo", async () => {
    await withTempProject(
      {
        "package.json": packageJson({
          name: "@t3tools/monorepo",
          scripts: {
            "dev:server": "node scripts/dev-runner.ts dev:server",
            "dev:web": "node scripts/dev-runner.ts dev:web",
          },
        }),
        "bun.lock": "",
      },
      async (cwd) => {
        const result = await detectProjectBootstrap({ cwd });
        expect(result.detectedDaytonaLaunchMode).toBe("full-stack-web");
        expect(result.detectedDaytonaInstallCommand).toBe(
          "bun install --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress",
        );
        expect(result.detectedDaytonaServerCommand).toBe(
          "bun run dev:server -- --host 0.0.0.0 --port 3773",
        );
        expect(result.detectedDaytonaWebCommand).toBe("bun run dev:web");
        expect(result.detectedDaytonaServerPort).toBe(3773);
        expect(result.detectedDaytonaWebPort).toBe(5733);
      },
    );
  });
});
