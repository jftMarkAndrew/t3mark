import { Daytona, Image, type Sandbox } from "@daytonaio/sdk";
import type { OrchestrationProject, OrchestrationThread, ProjectScript } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { CredentialProfilesService } from "../Services/Credentials";
import { DevHostRegistry } from "../Services/DevHostRegistry";
import {
  DAYTONA_DEFAULT_API_URL,
  describeDaytonaCause,
  DaytonaError,
  DaytonaService,
  formatDaytonaErrorMessage,
  parseGitHubRepoUrl,
  resolveDaytonaCredentials,
  type DaytonaShape,
} from "../Services/Daytona";

const DAYTONA_REPO_DIR = "workspace/repo";
const DAYTONA_SESSION_ID = "t3-preview";
const DAYTONA_SERVER_SESSION_ID = "t3-preview-server";
const DAYTONA_WEB_SESSION_ID = "t3-preview-web";
const DAYTONA_LABEL_PREFIX = "t3mark";
const DAYTONA_PREVIEW_EXPIRY_SECONDS = 60 * 60 * 24;
const DAYTONA_POLL_INTERVAL_MS = 2_000;
const DAYTONA_PREVIEW_TIMEOUT_MS = 90_000;
const DAYTONA_PORT_READY_TIMEOUT_MS = 90_000;
const DAYTONA_INSTALL_TIMEOUT_SECONDS = 60 * 20;
const DAYTONA_SYNC_TIMEOUT_SECONDS = 60 * 30;
const DAYTONA_UPLOAD_BATCH_SIZE = 200;
const DAYTONA_RESOURCE_PROFILES = [
  {
    cpu: 4,
    memory: 8,
    disk: 10,
  },
  {
    cpu: 2,
    memory: 4,
    disk: 8,
  },
  {
    cpu: 2,
    memory: 2,
    disk: 6,
  },
  {
    cpu: 1,
    memory: 1,
    disk: 4,
  },
] as const;
const DAYTONA_HEAVY_MONOREPO_RESOURCE_PROFILES = [
  {
    cpu: 8,
    memory: 16,
    disk: 20,
  },
  ...DAYTONA_RESOURCE_PROFILES,
] as const;
const DAYTONA_BUN_IMAGE = "oven/bun:1.3.9";
const DAYTONA_NODE_IMAGE = "node:22-bookworm";
const DEFAULT_LOCALHOST_BASE_PORT = 4200;
const T3TOOLS_MONOREPO_NAME = "@t3tools/monorepo";
const T3TOOLS_PREVIEW_SAFE_BUN_INSTALL =
  "bun install --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress";
const T3TOOLS_PREVIEW_FILTERED_BUN_INSTALL =
  "bun install --filter './apps/server' --filter './apps/web' --filter './packages/contracts' --filter './packages/shared' --ignore-scripts --concurrent-scripts 1 --frozen-lockfile --no-progress";
const DAYTONA_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  ".turbo",
  ".next",
  "dist",
  "build",
  "coverage",
  ".angular",
  "out-tsc",
  ".cache",
  "out",
  "tmp",
  ".idea",
  ".vscode",
]);
const DAYTONA_IGNORED_FILE_NAMES = new Set([".DS_Store", ".git"]);

interface PackageJsonLike {
  readonly name?: string | null;
  readonly scripts?: Record<string, string> | null;
  readonly dependencies?: Record<string, string> | null;
  readonly devDependencies?: Record<string, string> | null;
}

function isT3ToolsMonorepo(packageJson: PackageJsonLike | null): boolean {
  return packageJson?.name === T3TOOLS_MONOREPO_NAME;
}

export interface DaytonaLaunchSandbox {
  readonly id: string;
  readonly process: {
    executeCommand: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<unknown>;
    deleteSession: (sessionId: string) => Promise<unknown>;
    createSession: (sessionId: string) => Promise<unknown>;
    executeSessionCommand: (
      sessionId: string,
      input: { command: string; runAsync: boolean },
    ) => Promise<unknown>;
  };
  readonly fs: {
    uploadFiles: (
      files: Array<{ source: string; destination: string }>,
      timeoutSeconds: number,
    ) => Promise<unknown>;
  };
  readonly getSignedPreviewUrl: (
    port: number,
    expirySeconds: number,
  ) => Promise<{ url?: string | null }>;
}

export type DaytonaSourceStrategy =
  | {
      readonly kind: "clone";
      readonly repoUrl: string;
      readonly branches: ReadonlyArray<string | null>;
      readonly gitToken: string;
    }
  | {
      readonly kind: "upload";
      readonly sourceWorkspacePath: string;
    };

function hostId(threadId: string, workspaceId: string): string {
  return `${threadId}:${workspaceId}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function stripAnsiAndControl(value: string): string {
  let result = "";
  let index = 0;

  while (index < value.length) {
    const char = value[index]!;
    const code = value.charCodeAt(index);

    if (code === 0x1b) {
      index += 1;
      if (index < value.length && value[index] === "[") {
        index += 1;
        while (index < value.length) {
          const nextCode = value.charCodeAt(index);
          index += 1;
          if (nextCode >= 0x40 && nextCode <= 0x7e) {
            break;
          }
        }
      }
      continue;
    }

    if (char === "\n" || char === "\r" || char === "\t" || (code >= 0x20 && code !== 0x7f)) {
      result += char;
    }
    index += 1;
  }

  return result;
}

function normalizeCommandOutput(parts: Array<string | null | undefined>): string {
  return parts
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => stripAnsiAndControl(value))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join("\n");
}

function redactSecretValues(value: string): string {
  return value
    .replace(/x-access-token:[^@'"\s]+@github\.com/g, "x-access-token:[REDACTED]@github.com")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_[REDACTED]");
}

interface DaytonaExecuteCommandResponse {
  readonly exitCode?: number | null;
  readonly result?: string | null;
  readonly artifacts?: {
    readonly stdout?: string | null;
    readonly stderr?: string | null;
  } | null;
}

function summarizeCommandFailureOutput(params: {
  label: string;
  exitCode: number | undefined;
  output: string;
  command: string;
  cwd?: string;
}): string {
  const location = params.cwd ? ` in ${params.cwd}` : "";
  const redactedCommand = redactSecretValues(params.command);
  const redactedOutput = redactSecretValues(params.output);
  if (params.exitCode === 137) {
    const guidance = [
      `${params.label} was killed by the Daytona sandbox (exit code 137)${location}.`,
      "This usually means the install exceeded the sandbox's memory or resource limit.",
      "The preview has not reached backend/frontend startup yet.",
      redactedCommand === T3TOOLS_PREVIEW_SAFE_BUN_INSTALL
        ? "T3Mark already uses a preview-safe Bun install mode in Daytona. If this still fails, the remaining issue is likely sandbox capacity, not missing app dependencies."
        : "Try a larger Daytona sandbox profile or the low-memory preview install mode.",
      `Command: ${redactedCommand}`,
    ];
    if (redactedOutput) {
      guidance.push(redactedOutput);
    }
    return guidance.join("\n");
  }
  if (params.exitCode === -1) {
    if (redactedOutput) {
      return `${params.label} failed before the command could run${location}.\nCommand: ${redactedCommand}\n${redactedOutput}`;
    }
    return `${params.label} failed before the command could run${location}.\nCommand: ${redactedCommand}`;
  }
  if (redactedOutput) {
    return `${params.label} failed with exit code ${params.exitCode ?? "unknown"}${location}.\nCommand: ${redactedCommand}\n${redactedOutput}`;
  }
  return `${params.label} failed with exit code ${params.exitCode ?? "unknown"}${location}.\nCommand: ${redactedCommand}`;
}

async function executeCheckedCommand(params: {
  sandbox: DaytonaLaunchSandbox;
  label: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutSeconds?: number;
}): Promise<DaytonaExecuteCommandResponse> {
  const response = (await params.sandbox.process.executeCommand(
    params.command,
    params.cwd,
    params.env,
    params.timeoutSeconds,
  )) as DaytonaExecuteCommandResponse;

  if ((response.exitCode ?? 0) === 0) {
    return response;
  }

  const output = normalizeCommandOutput([
    response.artifacts?.stdout,
    response.artifacts?.stderr,
    response.result,
  ]);
  throw new Error(
    summarizeCommandFailureOutput({
      label: params.label,
      exitCode: response.exitCode ?? undefined,
      output,
      command: params.command,
      ...(params.cwd ? { cwd: params.cwd } : {}),
    }),
  );
}

async function statIfExists(targetPath: string) {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readPackageJsonLike(cwd: string): Promise<PackageJsonLike | null> {
  try {
    const contents = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    return JSON.parse(contents) as PackageJsonLike;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function collectWorkspaceFiles(
  sourceRoot: string,
  currentDir = sourceRoot,
): Promise<Array<{ source: string; destination: string }>> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: Array<{ source: string; destination: string }> = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory() && DAYTONA_IGNORED_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }
    if (entry.isFile() && DAYTONA_IGNORED_FILE_NAMES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectWorkspaceFiles(sourceRoot, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const relativePath = path.relative(sourceRoot, absolutePath).split(path.sep).join("/");
    files.push({
      source: absolutePath,
      destination: `${DAYTONA_REPO_DIR}/${relativePath}`,
    });
  }

  return files;
}

function resolveSourceWorkspacePath(
  thread: OrchestrationThread,
  project: OrchestrationProject,
): string {
  return thread.worktreePath ?? project.workspaceRoot;
}

function formatUploadPhase(startIndex: number, endIndex: number, total: number): string {
  return `Uploading files ${startIndex}-${endIndex} of ${total}`;
}

async function resolveExistingSourceWorkspacePath(
  thread: OrchestrationThread,
  project: OrchestrationProject,
): Promise<string> {
  const preferredPath = resolveSourceWorkspacePath(thread, project);
  const preferredStat = await statIfExists(preferredPath);
  if (preferredStat?.isDirectory()) {
    return preferredPath;
  }

  const projectRootStat = await statIfExists(project.workspaceRoot);
  if (projectRootStat?.isDirectory()) {
    return project.workspaceRoot;
  }

  throw new Error(
    `Neither worktree nor project root exists. worktreePath=${thread.worktreePath ?? "null"} workspaceRoot=${project.workspaceRoot}`,
  );
}

async function runBlockingCommand(params: {
  sandbox: DaytonaLaunchSandbox;
  label: string;
  command: string;
  cwd?: string;
  timeoutSeconds: number;
}): Promise<void> {
  try {
    await executeCheckedCommand({
      sandbox: params.sandbox,
      label: params.label,
      command: params.command,
      env: {
        CI: "1",
        TERM: "dumb",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      timeoutSeconds: params.timeoutSeconds,
      ...(params.cwd ? { cwd: params.cwd } : {}),
    });
  } catch (cause) {
    if (cause instanceof Error) {
      throw cause;
    }
    throw new Error(String(cause ?? `${params.label} failed.`), { cause });
  }
}

function resolveLocalhostLauncherScript(project: OrchestrationProject): ProjectScript | null {
  return project.scripts.find((script) => script.runAsLocalhostLauncher) ?? null;
}

function resolvePreviewPort(project: OrchestrationProject): number {
  return (
    project.daytona?.previewPort ??
    resolveLocalhostLauncherScript(project)?.localhostBasePort ??
    DEFAULT_LOCALHOST_BASE_PORT
  );
}

function resolveInstallCommand(project: OrchestrationProject): string | null {
  return project.daytona?.installCommand ?? project.bootstrap?.installCommand ?? null;
}

function isGenericBunInstallCommand(command: string | null): boolean {
  const normalized = command?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized === "bun install" || normalized === "bun i";
}

export function resolveInstallCommands(params: {
  project: OrchestrationProject;
  packageJson: PackageJsonLike | null;
  launchMode: ResolvedDaytonaLaunchConfig["launchMode"];
}): ReadonlyArray<string> {
  const installCommand = resolveInstallCommand(params.project)?.trim() ?? null;
  if (!installCommand) {
    return [];
  }

  if (params.launchMode === "full-stack-web" && isT3ToolsMonorepo(params.packageJson)) {
    if (
      isGenericBunInstallCommand(installCommand) ||
      installCommand === T3TOOLS_PREVIEW_SAFE_BUN_INSTALL
    ) {
      return [T3TOOLS_PREVIEW_SAFE_BUN_INSTALL, T3TOOLS_PREVIEW_FILTERED_BUN_INSTALL];
    }
  }

  return [installCommand];
}

function resolveDevCommand(project: OrchestrationProject): string | null {
  return (
    project.daytona?.devCommand ??
    project.bootstrap?.devCommand ??
    resolveLocalhostLauncherScript(project)?.command ??
    null
  );
}

type ResolvedDaytonaLaunchConfig =
  | {
      readonly launchMode: "single-process";
      readonly installCommand: string | null;
      readonly devCommand: string;
      readonly previewPort: number;
    }
  | {
      readonly launchMode: "full-stack-web";
      readonly installCommand: string | null;
      readonly serverCommand: string;
      readonly webCommand: string;
      readonly serverPort: number;
      readonly webPort: number;
    };

function resolvePrimaryPort(project: OrchestrationProject): number {
  if (project.daytona?.launchMode === "full-stack-web") {
    return project.daytona.webPort ?? 5733;
  }

  return resolvePreviewPort(project);
}

function resolveDaytonaLaunchConfig(
  project: OrchestrationProject,
): ResolvedDaytonaLaunchConfig | null {
  const launchMode = project.daytona?.launchMode ?? "single-process";
  const installCommand = resolveInstallCommand(project);

  if (launchMode === "full-stack-web") {
    const serverCommand = project.daytona?.serverCommand?.trim() ?? "";
    const webCommand = project.daytona?.webCommand?.trim() ?? "";
    const serverPort = project.daytona?.serverPort ?? 3773;
    const webPort = project.daytona?.webPort ?? 5733;
    if (!serverCommand || !webCommand) {
      return null;
    }
    return {
      launchMode,
      installCommand,
      serverCommand,
      webCommand,
      serverPort,
      webPort,
    };
  }

  const devCommand = resolveDevCommand(project)?.trim() ?? "";
  if (!devCommand) {
    return null;
  }
  return {
    launchMode,
    installCommand,
    devCommand,
    previewPort: resolvePreviewPort(project),
  };
}

function hasPackage(packageJson: PackageJsonLike | null, packageName: string): boolean {
  return Boolean(
    packageJson?.dependencies?.[packageName] ?? packageJson?.devDependencies?.[packageName],
  );
}

function isAngularProject(packageJson: PackageJsonLike | null, devCommand: string): boolean {
  return (
    hasPackage(packageJson, "@angular/core") ||
    hasPackage(packageJson, "@angular/cli") ||
    devCommand.toLowerCase().includes("ng serve")
  );
}

function hasPortFlag(command: string): boolean {
  return /(?:^|\s)(?:--port(?:=|\s+)|-p\s+)\d{2,5}(?:\s|$)/.test(command);
}

function hasHostFlag(command: string): boolean {
  return /(?:^|\s)--host(?:=|\s+)[^\s]+(?:\s|$)/.test(command);
}

export function normalizeDaytonaDevCommand(params: {
  packageJson: PackageJsonLike | null;
  devCommand: string;
  previewPort: number;
}): string {
  const trimmed = params.devCommand.trim();
  if (!isAngularProject(params.packageJson, trimmed)) {
    return trimmed;
  }

  if (hasHostFlag(trimmed) && hasPortFlag(trimmed)) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  const hostPortFlags = `${hasHostFlag(trimmed) ? "" : " --host 0.0.0.0"}${
    hasPortFlag(trimmed) ? "" : ` --port ${params.previewPort}`
  }`;

  if (/^(npm run|pnpm|bun run) start(?:\s|$)/.test(lower) && !trimmed.includes(" -- ")) {
    return `${trimmed} --${hostPortFlags}`;
  }

  return `${trimmed}${hostPortFlags}`;
}

function resolveSandboxImage(params: { installCommand: string | null; devCommand: string }): Image {
  const combined = `${params.installCommand ?? ""}\n${params.devCommand}`.toLowerCase();
  const baseImage = combined.includes("bun ") ? DAYTONA_BUN_IMAGE : DAYTONA_NODE_IMAGE;
  return Image.base(baseImage).runCommands(
    "if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y git curl ca-certificates python3 make g++ pkg-config && rm -rf /var/lib/apt/lists/*; fi",
  );
}

function isDaytonaMemoryLimitError(cause: unknown): boolean {
  const detail = describeDaytonaCause(cause)?.toLowerCase() ?? "";
  return detail.includes("total memory limit exceeded");
}

export function resolveResourceProfiles(params: {
  packageJson: PackageJsonLike | null;
  launchMode: ResolvedDaytonaLaunchConfig["launchMode"];
}) {
  if (params.launchMode === "full-stack-web" && isT3ToolsMonorepo(params.packageJson)) {
    return DAYTONA_HEAVY_MONOREPO_RESOURCE_PROFILES;
  }
  return DAYTONA_RESOURCE_PROFILES;
}

async function createSandboxWithFallback(params: {
  client: Daytona;
  projectId: string;
  threadId: string;
  image: Image;
  resourceProfiles?: ReadonlyArray<{ cpu: number; memory: number; disk: number }>;
}): Promise<Sandbox> {
  let createFailure: unknown = null;

  for (const resources of params.resourceProfiles ?? DAYTONA_RESOURCE_PROFILES) {
    try {
      return await params.client.create({
        language: "typescript",
        image: params.image,
        autoDeleteInterval: 0,
        resources,
        labels: {
          [`${DAYTONA_LABEL_PREFIX}:projectId`]: params.projectId,
          [`${DAYTONA_LABEL_PREFIX}:threadId`]: params.threadId,
        },
      });
    } catch (cause) {
      createFailure = cause;
      if (!isDaytonaMemoryLimitError(cause)) {
        break;
      }
    }
  }

  throw createFailure instanceof Error
    ? createFailure
    : new Error(String(createFailure ?? "Failed to create Daytona workspace."));
}

export function resolveBranch(
  thread: OrchestrationThread,
  project: OrchestrationProject,
): string | null {
  return thread.branch ?? project.daytona?.defaultBranch ?? null;
}

function resolveCloneBranches(
  thread: OrchestrationThread,
  project: OrchestrationProject,
): ReadonlyArray<string | null> {
  const candidates = [thread.branch ?? null, project.daytona?.defaultBranch ?? null, null];
  const unique: Array<string | null> = [];
  for (const candidate of candidates) {
    if (!unique.includes(candidate)) {
      unique.push(candidate);
    }
  }
  return unique;
}

export function resolveDaytonaSourceStrategy(params: {
  project: OrchestrationProject;
  thread: OrchestrationThread;
  sourceWorkspacePath: string;
  gitToken: string | null;
}): DaytonaSourceStrategy {
  const repoUrl = params.project.daytona?.repoUrl?.trim() ?? "";
  if (repoUrl.length === 0) {
    return {
      kind: "upload",
      sourceWorkspacePath: params.sourceWorkspacePath,
    };
  }

  const githubRepo = parseGitHubRepoUrl(repoUrl);
  if (!githubRepo) {
    throw new Error("Only HTTPS GitHub repository URLs are supported for Daytona clones.");
  }
  if (!params.gitToken) {
    throw new Error(
      "DAYTONA_GIT_TOKEN is required to launch Daytona previews from GitHub repositories.",
    );
  }

  return {
    kind: "clone",
    repoUrl: githubRepo.normalizedUrl,
    branches: resolveCloneBranches(params.thread, params.project),
    gitToken: params.gitToken,
  };
}

export function buildGitHubCloneCommand(params: {
  repoUrl: string;
  branch: string | null;
  gitToken: string;
}): string {
  const encodedToken = encodeURIComponent(params.gitToken);
  const branchArgs = params.branch
    ? ` --branch ${shellQuote(params.branch)} --single-branch`
    : " --single-branch";
  return `git -c url."https://x-access-token:${encodedToken}@github.com/".insteadOf=https://github.com/ clone --depth 1${branchArgs} ${shellQuote(params.repoUrl)} ${shellQuote(DAYTONA_REPO_DIR)}`;
}

function isMissingRemoteBranchError(error: unknown): boolean {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");
  return detail.includes("Remote branch") && detail.includes("not found");
}

function resolveThreadContext(
  snapshot: {
    projects: ReadonlyArray<OrchestrationProject>;
    threads: ReadonlyArray<OrchestrationThread>;
  },
  threadId: string,
): { project: OrchestrationProject; thread: OrchestrationThread } {
  const thread = snapshot.threads.find(
    (entry) => entry.id === threadId && entry.deletedAt === null,
  );
  if (!thread) {
    throw new Error(`Thread ${threadId} was not found.`);
  }
  const project = snapshot.projects.find(
    (entry) => entry.id === thread.projectId && entry.deletedAt === null,
  );
  if (!project) {
    throw new Error(`Project ${thread.projectId} was not found.`);
  }
  return { project, thread };
}

async function waitForPreviewUrl(sandbox: Sandbox, port: number): Promise<string> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < DAYTONA_PREVIEW_TIMEOUT_MS) {
    try {
      const preview = await sandbox.getSignedPreviewUrl(port, DAYTONA_PREVIEW_EXPIRY_SECONDS);
      if (preview.url) {
        return preview.url;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, DAYTONA_POLL_INTERVAL_MS));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for Daytona preview on port ${port}.`);
}

function toWebSocketUrl(value: string): string {
  const url = new URL(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function resolvePublicWebEnv(previewUrl: string): {
  host: string;
  protocol: string;
  port: string;
} {
  const url = new URL(previewUrl);
  return {
    host: url.hostname,
    protocol: url.protocol.replace(/:$/, ""),
    port: url.port,
  };
}

function buildEnvPrefixedCommand(
  envs: Readonly<Record<string, string | null | undefined>>,
  command: string,
): string {
  const assignments = Object.entries(envs)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}=${shellQuote(value)}`);

  if (assignments.length === 0) {
    return command;
  }

  return `env ${assignments.join(" ")} ${command}`;
}

async function waitForSandboxHttpReady(sandbox: Sandbox, port: number): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < DAYTONA_PORT_READY_TIMEOUT_MS) {
    try {
      await executeCheckedCommand({
        sandbox: sandbox as DaytonaLaunchSandbox,
        label: `wait for app on port ${port}`,
        command: `sh -lc "curl -fsS -o /dev/null http://127.0.0.1:${port}/ || curl -fsS -o /dev/null http://127.0.0.1:${port}"`,
      });
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, DAYTONA_POLL_INTERVAL_MS));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for the Daytona app to respond on port ${port}.`);
}

async function recreateSession(sandbox: DaytonaLaunchSandbox, sessionId: string): Promise<void> {
  try {
    await sandbox.process.deleteSession(sessionId);
  } catch {
    // Ignore missing sessions.
  }
  await sandbox.process.createSession(sessionId);
}

async function populateSandboxWorkspace(params: {
  sandbox: DaytonaLaunchSandbox;
  sourceStrategy: DaytonaSourceStrategy;
  onStatus: (statusDetail: string) => Promise<void>;
}): Promise<void> {
  await params.onStatus(
    params.sourceStrategy.kind === "clone" ? "Cloning repository" : "Preparing sandbox workspace",
  );
  await withDaytonaStep("prepare sandbox workspace", () =>
    executeCheckedCommand({
      sandbox: params.sandbox,
      label: "prepare sandbox workspace",
      command: `mkdir -p ${shellQuote("workspace")}`,
    }),
  );

  const { sourceStrategy } = params;

  if (sourceStrategy.kind === "clone") {
    let cloneError: unknown = null;
    for (const branch of sourceStrategy.branches) {
      try {
        await withDaytonaStep("clone repository", () =>
          executeCheckedCommand({
            sandbox: params.sandbox,
            label: "clone repository",
            command: buildGitHubCloneCommand({
              repoUrl: sourceStrategy.repoUrl,
              branch,
              gitToken: sourceStrategy.gitToken,
            }),
          }),
        );
        cloneError = null;
        break;
      } catch (error) {
        cloneError = error;
        if (!(branch && isMissingRemoteBranchError(error))) {
          break;
        }
      }
    }
    if (cloneError) {
      throw cloneError;
    }
    return;
  }

  await params.onStatus("Scanning local workspace");
  const workspaceFiles = await withDaytonaStep("scan local workspace", () =>
    collectWorkspaceFiles(sourceStrategy.sourceWorkspacePath),
  );
  await params.onStatus("Preparing sandbox workspace");
  await withDaytonaStep("prepare sandbox repo directory", () =>
    executeCheckedCommand({
      sandbox: params.sandbox,
      label: "prepare sandbox repo directory",
      command: `mkdir -p ${shellQuote(DAYTONA_REPO_DIR)}`,
    }),
  );
  for (let index = 0; index < workspaceFiles.length; index += DAYTONA_UPLOAD_BATCH_SIZE) {
    const batch = workspaceFiles.slice(index, index + DAYTONA_UPLOAD_BATCH_SIZE);
    await params.onStatus(
      formatUploadPhase(index + 1, index + batch.length, workspaceFiles.length),
    );
    await withDaytonaStep(
      formatUploadPhase(index + 1, index + batch.length, workspaceFiles.length),
      () => params.sandbox.fs.uploadFiles(batch, DAYTONA_SYNC_TIMEOUT_SECONDS),
    );
  }
}

async function installWithFallback(params: {
  sandbox: DaytonaLaunchSandbox;
  installCommands: ReadonlyArray<string>;
  onStatus: (statusDetail: string) => Promise<void>;
}): Promise<void> {
  if (params.installCommands.length === 0) {
    return;
  }

  let lastError: unknown = null;
  for (const [index, command] of params.installCommands.entries()) {
    await params.onStatus(
      index === 0 ? "Installing dependencies" : "Retrying with lighter install mode",
    );
    try {
      await withDaytonaStep("install dependencies", () =>
        runBlockingCommand({
          sandbox: params.sandbox,
          label: "install dependencies",
          command,
          cwd: DAYTONA_REPO_DIR,
          timeoutSeconds: DAYTONA_INSTALL_TIMEOUT_SECONDS,
        }),
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to install dependencies in the Daytona sandbox.");
}

export async function launchDaytonaSandboxPreview(params: {
  sandbox: DaytonaLaunchSandbox;
  sourceStrategy: DaytonaSourceStrategy;
  installCommands: ReadonlyArray<string>;
  devCommand: string;
  previewPort: number;
  onStatus: (statusDetail: string) => Promise<void>;
}): Promise<string> {
  await populateSandboxWorkspace({
    sandbox: params.sandbox,
    sourceStrategy: params.sourceStrategy,
    onStatus: params.onStatus,
  });
  await installWithFallback({
    sandbox: params.sandbox,
    installCommands: params.installCommands,
    onStatus: params.onStatus,
  });
  try {
    await params.sandbox.process.deleteSession(DAYTONA_SESSION_ID);
  } catch {
    // Ignore missing sessions.
  }
  await params.onStatus("Starting dev server");
  await withDaytonaStep("create preview session", () =>
    params.sandbox.process.createSession(DAYTONA_SESSION_ID),
  );
  await withDaytonaStep("start dev command", () =>
    params.sandbox.process.executeSessionCommand(DAYTONA_SESSION_ID, {
      command: `cd ${DAYTONA_REPO_DIR} && ${params.devCommand}`,
      runAsync: true,
    }),
  );
  await params.onStatus(`Waiting for app on port ${params.previewPort}`);
  await withDaytonaStep(`wait for app on port ${params.previewPort}`, () =>
    waitForSandboxHttpReady(params.sandbox as Sandbox, params.previewPort),
  );
  await params.onStatus(`Waiting for preview on port ${params.previewPort}`);
  return withDaytonaStep(`open preview on port ${params.previewPort}`, () =>
    waitForPreviewUrl(params.sandbox as Sandbox, params.previewPort),
  );
}

export async function launchDaytonaSandboxFullStackPreview(params: {
  sandbox: DaytonaLaunchSandbox;
  sourceStrategy: DaytonaSourceStrategy;
  installCommands: ReadonlyArray<string>;
  serverCommand: string;
  webCommand: string;
  serverPort: number;
  webPort: number;
  onStatus: (statusDetail: string) => Promise<void>;
}): Promise<{
  primaryUrl: string;
  serviceUrls: {
    web: string;
    server: string;
  };
}> {
  await populateSandboxWorkspace({
    sandbox: params.sandbox,
    sourceStrategy: params.sourceStrategy,
    onStatus: params.onStatus,
  });
  await installWithFallback({
    sandbox: params.sandbox,
    installCommands: params.installCommands,
    onStatus: params.onStatus,
  });

  await params.onStatus("Starting backend");
  await withDaytonaStep("create backend session", () =>
    recreateSession(params.sandbox, DAYTONA_SERVER_SESSION_ID),
  );
  await withDaytonaStep("start backend command", () =>
    params.sandbox.process.executeSessionCommand(DAYTONA_SERVER_SESSION_ID, {
      command: `cd ${DAYTONA_REPO_DIR} && ${params.serverCommand}`,
      runAsync: true,
    }),
  );

  await params.onStatus("Waiting for backend");
  await withDaytonaStep(`wait for backend on port ${params.serverPort}`, () =>
    waitForSandboxHttpReady(params.sandbox as Sandbox, params.serverPort),
  );
  const backendPreviewUrl = await withDaytonaStep(
    `open backend preview on port ${params.serverPort}`,
    () => waitForPreviewUrl(params.sandbox as Sandbox, params.serverPort),
  );

  const webPreviewUrl = await withDaytonaStep(`prepare web preview on port ${params.webPort}`, () =>
    waitForPreviewUrl(params.sandbox as Sandbox, params.webPort),
  );
  const publicWebEnv = resolvePublicWebEnv(webPreviewUrl);

  await params.onStatus("Starting frontend");
  await withDaytonaStep("create frontend session", () =>
    recreateSession(params.sandbox, DAYTONA_WEB_SESSION_ID),
  );
  await withDaytonaStep("start frontend command", () =>
    params.sandbox.process.executeSessionCommand(DAYTONA_WEB_SESSION_ID, {
      command: `cd ${DAYTONA_REPO_DIR} && ${buildEnvPrefixedCommand(
        {
          T3_DAYTONA_MODE: "1",
          T3_PUBLIC_WEB_HOST: publicWebEnv.host,
          T3_PUBLIC_WEB_PROTOCOL: publicWebEnv.protocol,
          T3_PUBLIC_WEB_PORT: publicWebEnv.port,
          T3_PUBLIC_SERVER_URL: backendPreviewUrl,
          T3_PUBLIC_SERVER_WS_URL: toWebSocketUrl(backendPreviewUrl),
          VITE_WS_URL: toWebSocketUrl(backendPreviewUrl),
          PORT: String(params.webPort),
        },
        params.webCommand,
      )}`,
      runAsync: true,
    }),
  );

  await params.onStatus("Waiting for frontend");
  await withDaytonaStep(`wait for frontend on port ${params.webPort}`, () =>
    waitForSandboxHttpReady(params.sandbox as Sandbox, params.webPort),
  );
  await params.onStatus("Waiting for preview");

  return {
    primaryUrl: webPreviewUrl,
    serviceUrls: {
      web: webPreviewUrl,
      server: backendPreviewUrl,
    },
  };
}

async function withDaytonaStep<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    throw new DaytonaError({
      message: formatDaytonaErrorMessage(`Daytona step failed: ${label}.`, cause),
      cause,
    });
  }
}

export const DaytonaLive = Layer.effect(
  DaytonaService,
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const credentialProfilesService = yield* CredentialProfilesService;
    const devHostRegistry = yield* DevHostRegistry;
    const services = yield* Effect.services<never>();
    const runPromise = Effect.runPromiseWith(services);

    const makeClient = (apiKey: string) =>
      Effect.try({
        try: () => {
          const credentials = resolveDaytonaCredentials();
          return new Daytona({
            apiKey,
            apiUrl: credentials.apiUrl || DAYTONA_DEFAULT_API_URL,
            ...(credentials.target ? { target: credentials.target } : {}),
          });
        },
        catch: (cause) =>
          new DaytonaError({
            message: formatDaytonaErrorMessage("Failed to initialize Daytona client.", cause),
            cause,
          }),
      });

    const service = {
      launchPreview: (input) =>
        Effect.gen(function* () {
          const provisionalWorkspaceId = `pending-${randomUUID()}`;
          const provisionalHostId = hostId(input.threadId, provisionalWorkspaceId);
          const snapshot = yield* projectionSnapshotQuery.getSnapshot();
          const { project, thread } = yield* Effect.try({
            try: () => resolveThreadContext(snapshot, input.threadId),
            catch: (cause) =>
              new DaytonaError({
                message: formatDaytonaErrorMessage("Failed to resolve thread.", cause),
                cause,
              }),
          });
          if (!project.daytona?.enabled) {
            return yield* new DaytonaError({
              message: "Daytona is not enabled for this project.",
            });
          }
          const branch = resolveBranch(thread, project);
          yield* devHostRegistry.registerHost({
            threadId: thread.id,
            projectId: project.id,
            projectCwd: project.workspaceRoot,
            terminalId: null,
            port: resolvePrimaryPort(project),
            launchKind: "daytona_preview",
            status: "starting",
            workspaceId: provisionalWorkspaceId,
            branch,
            repoUrl: project.daytona.repoUrl ?? null,
            statusDetail: "Preparing Daytona launch",
          });
          const launchConfig = resolveDaytonaLaunchConfig(project);
          if (!launchConfig) {
            return yield* new DaytonaError({
              message: "Daytona commands are not fully configured for this project.",
            });
          }
          const sourceWorkspacePath = yield* Effect.tryPromise({
            try: () => resolveExistingSourceWorkspacePath(thread, project),
            catch: (cause) =>
              new DaytonaError({
                message: formatDaytonaErrorMessage(
                  "Failed to resolve source workspace for Daytona preview.",
                  cause,
                ),
                cause,
              }),
          });
          const sourcePackageJson = yield* Effect.tryPromise({
            try: () => readPackageJsonLike(sourceWorkspacePath),
            catch: (cause) =>
              new DaytonaError({
                message: formatDaytonaErrorMessage(
                  "Failed to inspect source workspace metadata for Daytona preview.",
                  cause,
                ),
                cause,
              }),
          });
          const installCommands = resolveInstallCommands({
            project,
            packageJson: sourcePackageJson,
            launchMode: launchConfig.launchMode,
          });
          const resolvedDaytonaSecret = yield* credentialProfilesService
            .resolveSecret({
              kind: "daytona",
              profileId: project.daytona?.daytonaCredentialProfileId ?? null,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new DaytonaError({
                    message: formatDaytonaErrorMessage(
                      "Failed to resolve Daytona API credentials.",
                      cause,
                    ),
                    cause,
                  }),
              ),
            );
          const resolvedGitSecret = yield* credentialProfilesService
            .resolveSecret({
              kind: "github",
              profileId: project.daytona?.gitCredentialProfileId ?? null,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new DaytonaError({
                    message: formatDaytonaErrorMessage(
                      "Failed to resolve Git credentials for Daytona.",
                      cause,
                    ),
                    cause,
                  }),
              ),
            );
          const sourceStrategy = yield* Effect.try({
            try: () =>
              resolveDaytonaSourceStrategy({
                project,
                thread,
                sourceWorkspacePath,
                gitToken: resolvedGitSecret.secret,
              }),
            catch: (cause) =>
              new DaytonaError({
                message: formatDaytonaErrorMessage(
                  "Failed to determine Daytona source strategy.",
                  cause,
                ),
                cause,
              }),
          });
          const sandboxImage = resolveSandboxImage({
            installCommand: installCommands[0] ?? launchConfig.installCommand,
            devCommand:
              launchConfig.launchMode === "single-process"
                ? normalizeDaytonaDevCommand({
                    packageJson: sourcePackageJson,
                    devCommand: launchConfig.devCommand,
                    previewPort: launchConfig.previewPort,
                  })
                : `${launchConfig.serverCommand}\n${launchConfig.webCommand}`,
          });
          const client = yield* makeClient(
            resolvedDaytonaSecret.secret ?? resolveDaytonaCredentials().apiKey,
          );

          void (async () => {
            let activeWorkspaceId = provisionalWorkspaceId;
            let sandbox: Sandbox | null = null;
            const updateStartingHost = (statusDetail: string) =>
              devHostRegistry.registerHost({
                threadId: thread.id,
                projectId: project.id,
                projectCwd: project.workspaceRoot,
                terminalId: null,
                port:
                  launchConfig.launchMode === "full-stack-web"
                    ? launchConfig.webPort
                    : launchConfig.previewPort,
                launchKind: "daytona_preview",
                status: "starting",
                workspaceId: activeWorkspaceId,
                branch,
                repoUrl: project.daytona?.repoUrl ?? null,
                statusDetail,
              });
            try {
              await runPromise(updateStartingHost("Creating Daytona workspace"));
              sandbox = await createSandboxWithFallback({
                client,
                projectId: project.id,
                threadId: thread.id,
                image: sandboxImage,
                resourceProfiles: resolveResourceProfiles({
                  packageJson: sourcePackageJson,
                  launchMode: launchConfig.launchMode,
                }),
              });
              const activeSandbox = sandbox;
              activeWorkspaceId = activeSandbox.id;
              const previewResult =
                launchConfig.launchMode === "full-stack-web"
                  ? await launchDaytonaSandboxFullStackPreview({
                      sandbox: activeSandbox,
                      sourceStrategy,
                      installCommands,
                      serverCommand: launchConfig.serverCommand,
                      webCommand: launchConfig.webCommand,
                      serverPort: launchConfig.serverPort,
                      webPort: launchConfig.webPort,
                      onStatus: (statusDetail) => runPromise(updateStartingHost(statusDetail)),
                    })
                  : {
                      primaryUrl: await launchDaytonaSandboxPreview({
                        sandbox: activeSandbox,
                        sourceStrategy,
                        installCommands,
                        devCommand: normalizeDaytonaDevCommand({
                          packageJson: sourcePackageJson,
                          devCommand: launchConfig.devCommand,
                          previewPort: launchConfig.previewPort,
                        }),
                        previewPort: launchConfig.previewPort,
                        onStatus: (statusDetail) => runPromise(updateStartingHost(statusDetail)),
                      }),
                      serviceUrls: null,
                    };
              await runPromise(
                devHostRegistry.registerHost({
                  threadId: thread.id,
                  projectId: project.id,
                  projectCwd: project.workspaceRoot,
                  terminalId: null,
                  port:
                    launchConfig.launchMode === "full-stack-web"
                      ? launchConfig.webPort
                      : launchConfig.previewPort,
                  launchKind: "daytona_preview",
                  status: "running",
                  url: previewResult.primaryUrl,
                  primaryUrl: previewResult.primaryUrl,
                  serviceUrls: previewResult.serviceUrls,
                  workspaceId: activeWorkspaceId,
                  branch,
                  repoUrl: project.daytona?.repoUrl ?? null,
                  statusDetail: "Preview ready",
                }),
              );
            } catch (cause) {
              const error =
                cause &&
                typeof cause === "object" &&
                "_tag" in cause &&
                cause._tag === "DaytonaError"
                  ? cause
                  : new DaytonaError({
                      message: formatDaytonaErrorMessage("Failed to start Daytona preview.", cause),
                      cause,
                    });
              const lastError =
                error && typeof error === "object" && "message" in error
                  ? String(error.message)
                  : "Failed to start Daytona preview.";
              await runPromise(
                Effect.all([
                  Effect.tryPromise({
                    try: async () => {
                      if (sandbox) {
                        await sandbox.delete();
                      }
                    },
                    catch: () => undefined,
                  }).pipe(Effect.ignore),
                  devHostRegistry.registerHost({
                    threadId: thread.id,
                    projectId: project.id,
                    projectCwd: project.workspaceRoot,
                    terminalId: null,
                    port:
                      launchConfig.launchMode === "full-stack-web"
                        ? launchConfig.webPort
                        : launchConfig.previewPort,
                    launchKind: "daytona_preview",
                    status: "error",
                    workspaceId: activeWorkspaceId,
                    branch,
                    repoUrl: project.daytona?.repoUrl ?? null,
                    statusDetail: "Launch failed",
                    lastError,
                  }),
                ]).pipe(Effect.asVoid),
              );
            }
          })();

          const host = yield* devHostRegistry.getHost(provisionalHostId);
          if (!host) {
            return yield* new DaytonaError({
              message: "Daytona preview was created but not registered.",
            });
          }
          return host;
        }).pipe(
          Effect.mapError(
            (cause) =>
              new DaytonaError({
                message: formatDaytonaErrorMessage("Failed to launch Daytona preview.", cause),
                cause,
              }),
          ),
        ),
      stopPreview: (input) =>
        Effect.gen(function* () {
          const host = yield* devHostRegistry.getHost(input.hostId);
          if (!host) {
            return;
          }
          if (host.launchKind !== "daytona_preview" || !host.workspaceId) {
            yield* devHostRegistry.unregisterHost(input.hostId);
            return;
          }
          const snapshot = yield* projectionSnapshotQuery.getSnapshot();
          const { project } = yield* Effect.try({
            try: () => resolveThreadContext(snapshot, host.threadId),
            catch: (cause) =>
              new DaytonaError({
                message: formatDaytonaErrorMessage(
                  "Failed to resolve Daytona preview thread during stop.",
                  cause,
                ),
                cause,
              }),
          });
          const resolvedDaytonaSecret = yield* credentialProfilesService
            .resolveSecret({
              kind: "daytona",
              profileId: project.daytona?.daytonaCredentialProfileId ?? null,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new DaytonaError({
                    message: formatDaytonaErrorMessage(
                      "Failed to resolve Daytona API credentials.",
                      cause,
                    ),
                    cause,
                  }),
              ),
            );
          const client = yield* makeClient(
            resolvedDaytonaSecret.secret ?? resolveDaytonaCredentials().apiKey,
          );
          yield* Effect.tryPromise({
            try: async () => {
              const sandbox = await client.get(host.workspaceId!);
              await sandbox.delete();
            },
            catch: (cause) =>
              new DaytonaError({
                message: formatDaytonaErrorMessage("Failed to stop Daytona preview.", cause),
                cause,
              }),
          });
          yield* devHostRegistry.unregisterHost(input.hostId);
        }).pipe(
          Effect.mapError(
            (cause) =>
              new DaytonaError({
                message: formatDaytonaErrorMessage("Failed to stop Daytona preview.", cause),
                cause,
              }),
          ),
        ),
    } satisfies DaytonaShape;

    return service;
  }),
);
