import { detectNodeBootstrap } from "@t3tools/shared/bootstrap";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type { ProjectDetectBootstrapInput, ProjectDetectBootstrapResult } from "@t3tools/contracts";

const DETECTION_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;
const execFileAsync = promisify(execFile);

const APP_PORT_BY_PACKAGE_NAME: ReadonlyArray<{ packageName: string; port: number }> = [
  { packageName: "@angular/core", port: 4200 },
  { packageName: "@angular/cli", port: 4200 },
  { packageName: "astro", port: 4321 },
  { packageName: "next", port: 3000 },
  { packageName: "react-scripts", port: 3000 },
  { packageName: "@remix-run/dev", port: 3000 },
  { packageName: "@sveltejs/kit", port: 5173 },
  { packageName: "vite", port: 5173 },
  { packageName: "nuxt", port: 3000 },
  { packageName: "nuxt3", port: 3000 },
];

interface PackageJsonLike {
  readonly name?: string | null;
  readonly scripts?: Record<string, string> | null;
  readonly dependencies?: Record<string, string> | null;
  readonly devDependencies?: Record<string, string> | null;
}

function isAngularProject(packageJson: PackageJsonLike | null): boolean {
  return hasPackage(packageJson, "@angular/core") || hasPackage(packageJson, "@angular/cli");
}

function detectExplicitScriptPort(packageJson: PackageJsonLike | null): number | null {
  const packageScripts = packageJson?.scripts ?? null;
  const combinedScriptText = [packageScripts?.dev, packageScripts?.start].filter(Boolean).join(" ");
  const explicitPortMatch = /(?:^|\s)(?:--port(?:=|\s+)|-p\s+)(\d{2,5})(?:\s|$)/.exec(
    combinedScriptText,
  );
  if (!explicitPortMatch) {
    return null;
  }

  const parsedPort = Number.parseInt(explicitPortMatch[1] ?? "", 10);
  return Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : null;
}

function normalizeGitRemoteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const sshMatch = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (sshMatch) {
    const [, host = "", repoPath = ""] = sshMatch;
    const normalizedRepoPath = repoPath.replace(/^\/+/g, "");
    return `https://${host}/${normalizedRepoPath}`;
  }

  return trimmed;
}

function hasPackage(packageJson: PackageJsonLike | null, packageName: string): boolean {
  return Boolean(
    packageJson?.dependencies?.[packageName] ?? packageJson?.devDependencies?.[packageName],
  );
}

function deriveDaytonaDevCommand(
  packageJson: PackageJsonLike | null,
  packageManager: string | null,
) {
  const scripts = packageJson?.scripts ?? null;
  const angularProject = isAngularProject(packageJson);
  const angularPort = detectExplicitScriptPort(packageJson) ?? 4200;
  const commandPrefix =
    packageManager === "bun"
      ? "bun run"
      : packageManager === "pnpm"
        ? "pnpm"
        : packageManager === "yarn"
          ? "yarn"
          : "npm run";

  if (
    !angularProject &&
    typeof scripts?.["dev:web"] === "string" &&
    scripts["dev:web"].trim().length > 0
  ) {
    return `${commandPrefix} dev:web`;
  }
  if (angularProject && typeof scripts?.start === "string" && scripts.start.trim().length > 0) {
    if (packageManager === "yarn") {
      return `yarn start --host 0.0.0.0 --port ${angularPort}`;
    }
    return `${commandPrefix} start -- --host 0.0.0.0 --port ${angularPort}`;
  }
  if (!angularProject && typeof scripts?.dev === "string" && scripts.dev.trim().length > 0) {
    return `${commandPrefix} dev`;
  }
  if (!angularProject && typeof scripts?.start === "string" && scripts.start.trim().length > 0) {
    return packageManager === "yarn" ? "yarn start" : `${commandPrefix} start`;
  }
  if (angularProject) {
    return `ng serve --host 0.0.0.0 --port ${angularPort}`;
  }
  return null;
}

function deriveDaytonaInstallCommand(
  packageJson: PackageJsonLike | null,
  packageManager: string | null,
  bootstrapInstallCommand: string | null,
): string | null {
  if (packageJson?.name === "@t3tools/monorepo" && packageManager === "bun") {
    return "bun install --filter './' --filter './apps/web' --filter './packages/contracts' --filter './packages/shared' --ignore-scripts";
  }

  return bootstrapInstallCommand;
}

function deriveDaytonaAppPort(packageJson: PackageJsonLike | null): number {
  if (packageJson?.name === "@t3tools/monorepo") {
    return 5733;
  }
  const explicitPort = detectExplicitScriptPort(packageJson);
  if (explicitPort !== null) {
    return explicitPort;
  }

  if (isAngularProject(packageJson)) {
    return 4200;
  }

  for (const entry of APP_PORT_BY_PACKAGE_NAME) {
    if (hasPackage(packageJson, entry.packageName)) {
      return entry.port;
    }
  }

  return 3000;
}

async function runGitCommand(cwd: string, args: ReadonlyArray<string>): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: 5_000,
      maxBuffer: 256 * 1024,
    });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function detectGitRepoUrl(cwd: string): Promise<string | null> {
  const remoteUrl = await runGitCommand(cwd, ["remote", "get-url", "origin"]);
  return remoteUrl ? normalizeGitRemoteUrl(remoteUrl) : null;
}

async function detectGitDefaultBranch(cwd: string): Promise<string | null> {
  const originHeadRef = await runGitCommand(cwd, [
    "symbolic-ref",
    "--quiet",
    "refs/remotes/origin/HEAD",
  ]);
  if (originHeadRef) {
    const originPrefix = "refs/remotes/origin/";
    if (originHeadRef.startsWith(originPrefix)) {
      const branchName = originHeadRef.slice(originPrefix.length).trim();
      if (branchName.length > 0) {
        return branchName;
      }
    }
  }

  const currentBranch = await runGitCommand(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (currentBranch && currentBranch !== "HEAD") {
    return currentBranch;
  }

  return null;
}

async function readPackageJsonIfPresent(cwd: string): Promise<PackageJsonLike | null> {
  const packageJsonPath = path.join(cwd, "package.json");
  try {
    const contents = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(contents) as PackageJsonLike;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function detectProjectBootstrap(
  input: ProjectDetectBootstrapInput,
): Promise<ProjectDetectBootstrapResult> {
  const existingFiles: string[] = [];
  await Promise.all(
    DETECTION_FILES.map(async (fileName) => {
      try {
        await fs.access(path.join(input.cwd, fileName));
        existingFiles.push(fileName);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }),
  );

  const packageJson = await readPackageJsonIfPresent(input.cwd);
  const bootstrap = detectNodeBootstrap({
    filePaths: existingFiles,
    packageJson,
  });
  const [detectedRepoUrl, detectedDefaultBranch] = await Promise.all([
    detectGitRepoUrl(input.cwd),
    detectGitDefaultBranch(input.cwd),
  ]);

  return {
    ...bootstrap,
    detectedRepoUrl,
    detectedDefaultBranch,
    detectedDaytonaInstallCommand: deriveDaytonaInstallCommand(
      packageJson,
      bootstrap.detectedPackageManager,
      bootstrap.installCommand,
    ),
    detectedDaytonaDevCommand: deriveDaytonaDevCommand(
      packageJson,
      bootstrap.detectedPackageManager,
    ),
    detectedAppPort: deriveDaytonaAppPort(packageJson),
  };
}
