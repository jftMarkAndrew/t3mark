import { Daytona, Image, type Sandbox } from "@daytonaio/sdk";
import type { OrchestrationProject, OrchestrationThread, ProjectScript } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { DevHostRegistry } from "../Services/DevHostRegistry";
import {
  DAYTONA_DEFAULT_API_URL,
  describeDaytonaCause,
  DaytonaError,
  DaytonaService,
  formatDaytonaErrorMessage,
  resolveDaytonaCredentials,
  resolveDaytonaServerStatus,
  type DaytonaShape,
} from "../Services/Daytona";

const DAYTONA_REPO_DIR = "workspace/repo";
const DAYTONA_SESSION_ID = "t3-preview";
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
const DAYTONA_BUN_IMAGE = "oven/bun:1.3.9";
const DAYTONA_NODE_IMAGE = "node:22-bookworm";
const DEFAULT_LOCALHOST_BASE_PORT = 4200;
const DAYTONA_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  ".turbo",
  ".next",
  "dist",
  "build",
  "coverage",
  ".idea",
  ".vscode",
]);
const DAYTONA_IGNORED_FILE_NAMES = new Set([".DS_Store", ".git"]);

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

function summarizePtyFailureOutput(params: {
  label: string;
  exitCode: number | undefined;
  output: string;
}): string {
  const rawLines = params.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const filteredLines = rawLines.filter((line) => {
    if (line.startsWith("__T3_EXIT_CODE__:")) return false;
    if (line === "code=$?") return false;
    if (line === 'exit "$code"') return false;
    if (line === `printf '\\n__T3_EXIT_CODE__:%s\\n' "$code"`) return false;
    if (line === params.label) return false;
    if (/^[0-9a-f-]+%$/.test(line)) return false;
    if (/^[0-9a-f-]+%\s/.test(line)) return false;
    return true;
  });
  const uniqueLines: string[] = [];
  for (const line of filteredLines) {
    if (uniqueLines.at(-1) !== line) {
      uniqueLines.push(line);
    }
  }
  const detail = uniqueLines.slice(-8).join("\n");
  if (params.exitCode === 137) {
    return detail
      ? `${params.label} failed with exit code 137. The install process was killed inside the Daytona sandbox, which usually means it hit a memory or resource limit.\n${detail}`
      : `${params.label} failed with exit code 137. The install process was killed inside the Daytona sandbox, which usually means it hit a memory or resource limit.`;
  }
  if (detail) {
    return `${params.label} failed with exit code ${params.exitCode ?? "unknown"}.\n${detail}`;
  }
  return `${params.label} failed with exit code ${params.exitCode ?? "unknown"}.`;
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

async function readPackageJsonLike(cwd: string): Promise<{ name?: string | null } | null> {
  try {
    const contents = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    return JSON.parse(contents) as { name?: string | null };
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

async function runBlockingPtyCommand(params: {
  sandbox: Sandbox;
  label: string;
  command: string;
  cwd?: string;
  timeoutSeconds: number;
}): Promise<void> {
  const sessionId = `t3-${params.label.replaceAll(/\s+/g, "-").toLowerCase()}-${randomUUID()}`;
  const outputChunks: string[] = [];
  const textDecoder = new TextDecoder();
  const pty = await params.sandbox.process.createPty({
    id: sessionId,
    cols: 160,
    rows: 40,
    envs: {
      CI: "1",
      TERM: "dumb",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
    ...(params.cwd ? { cwd: params.cwd } : {}),
    onData: (data) => {
      outputChunks.push(textDecoder.decode(data));
    },
  });

  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(async () => {
      try {
        await pty.kill();
      } catch {
        // Ignore PTY kill failures on timeout.
      }
      const detail = normalizeCommandOutput(outputChunks);
      reject(
        new Error(
          detail ||
            `${params.label} timed out after ${params.timeoutSeconds} seconds without a terminal exit code.`,
        ),
      );
    }, params.timeoutSeconds * 1000);
  });

  try {
    await pty.waitForConnection();
    const wrappedCommand = `${params.command}\ncode=$?\nprintf '\\n__T3_EXIT_CODE__:%s\\n' "$code"\nexit "$code"\n`;
    await pty.sendInput(wrappedCommand);
    const result = await Promise.race([pty.wait(), timeoutPromise]);
    const fullOutput = normalizeCommandOutput(outputChunks);
    if (result.exitCode === 0) {
      return;
    }
    throw new Error(
      summarizePtyFailureOutput({
        label: params.label,
        exitCode: result.exitCode,
        output: fullOutput,
      }),
    );
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    await pty.disconnect().catch(() => undefined);
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

function resolveOptimizedDaytonaLaunch(params: {
  project: OrchestrationProject;
  packageName: string | null;
  installCommand: string | null;
  devCommand: string;
  previewPort: number;
}): {
  installCommand: string | null;
  devCommand: string;
  previewPort: number;
} {
  if (params.packageName !== "@t3tools/monorepo") {
    return {
      installCommand: params.installCommand,
      devCommand: params.devCommand,
      previewPort: params.previewPort,
    };
  }

  const optimizedInstallCommand =
    params.installCommand === null || params.installCommand === "bun install"
      ? "bun install --filter './' --filter './apps/web' --filter './packages/contracts' --filter './packages/shared' --ignore-scripts"
      : params.installCommand;
  const optimizedDevCommand =
    params.devCommand === "bun run dev" ? "bun run dev:web" : params.devCommand;
  const optimizedPreviewPort =
    params.previewPort === 3000 || params.previewPort === DEFAULT_LOCALHOST_BASE_PORT
      ? 5733
      : params.previewPort;

  return {
    installCommand: optimizedInstallCommand,
    devCommand: optimizedDevCommand,
    previewPort: optimizedPreviewPort,
  };
}

function resolveInstallCommand(project: OrchestrationProject): string | null {
  return project.daytona?.installCommand ?? project.bootstrap?.installCommand ?? null;
}

function resolveDevCommand(project: OrchestrationProject): string | null {
  return (
    project.daytona?.devCommand ??
    project.bootstrap?.devCommand ??
    resolveLocalhostLauncherScript(project)?.command ??
    null
  );
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

async function createSandboxWithFallback(params: {
  client: Daytona;
  projectId: string;
  threadId: string;
  image: Image;
}): Promise<Sandbox> {
  let createFailure: unknown = null;

  for (const resources of DAYTONA_RESOURCE_PROFILES) {
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

function resolveBranch(thread: OrchestrationThread, project: OrchestrationProject): string | null {
  return thread.branch ?? project.daytona?.defaultBranch ?? null;
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

async function waitForSandboxHttpReady(sandbox: Sandbox, port: number): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < DAYTONA_PORT_READY_TIMEOUT_MS) {
    try {
      await sandbox.process.executeCommand(
        `sh -lc "curl -fsS -o /dev/null http://127.0.0.1:${port}/ || curl -fsS -o /dev/null http://127.0.0.1:${port}"`,
      );
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
    const status = resolveDaytonaServerStatus();
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const devHostRegistry = yield* DevHostRegistry;
    const services = yield* Effect.services<never>();
    const runPromise = Effect.runPromiseWith(services);

    const makeClient = () =>
      Effect.try({
        try: () => {
          const credentials = resolveDaytonaCredentials();
          if (!status.configured) {
            throw new Error(status.message ?? "Daytona is not configured.");
          }
          return new Daytona({
            apiKey: credentials.apiKey,
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
            port: resolvePreviewPort(project),
            launchKind: "daytona_preview",
            status: "starting",
            workspaceId: provisionalWorkspaceId,
            branch,
            repoUrl: project.daytona.repoUrl ?? null,
            statusDetail: "Preparing Daytona launch",
          });
          const configuredDevCommand = resolveDevCommand(project);
          if (!configuredDevCommand) {
            return yield* new DaytonaError({
              message: "No Daytona dev command is configured for this project.",
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
          const optimizedLaunch = resolveOptimizedDaytonaLaunch({
            project,
            packageName: sourcePackageJson?.name ?? null,
            installCommand: resolveInstallCommand(project),
            devCommand: configuredDevCommand,
            previewPort: resolvePreviewPort(project),
          });
          const previewPort = optimizedLaunch.previewPort;
          const installCommand = optimizedLaunch.installCommand;
          const devCommand = optimizedLaunch.devCommand;
          const sandboxImage = resolveSandboxImage({
            installCommand,
            devCommand,
          });
          const client = yield* makeClient();

          void (async () => {
            let activeWorkspaceId = provisionalWorkspaceId;
            let sandbox: Sandbox | null = null;
            const updateStartingHost = (statusDetail: string) =>
              devHostRegistry.registerHost({
                threadId: thread.id,
                projectId: project.id,
                projectCwd: project.workspaceRoot,
                terminalId: null,
                port: previewPort,
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
              });
              const activeSandbox = sandbox;
              activeWorkspaceId = activeSandbox.id;
              await runPromise(updateStartingHost("Preparing Daytona workspace"));
              await runPromise(updateStartingHost("Scanning local workspace"));
              const workspaceFiles = await withDaytonaStep("scan local workspace", () =>
                collectWorkspaceFiles(sourceWorkspacePath),
              );
              await runPromise(updateStartingHost("Preparing sandbox workspace"));
              await withDaytonaStep("prepare sandbox workspace", () =>
                activeSandbox.process.executeCommand(`mkdir -p ${shellQuote(DAYTONA_REPO_DIR)}`),
              );
              for (
                let index = 0;
                index < workspaceFiles.length;
                index += DAYTONA_UPLOAD_BATCH_SIZE
              ) {
                const batch = workspaceFiles.slice(index, index + DAYTONA_UPLOAD_BATCH_SIZE);
                await runPromise(
                  updateStartingHost(
                    formatUploadPhase(index + 1, index + batch.length, workspaceFiles.length),
                  ),
                );
                await withDaytonaStep(
                  formatUploadPhase(index + 1, index + batch.length, workspaceFiles.length),
                  () => activeSandbox.fs.uploadFiles(batch, DAYTONA_SYNC_TIMEOUT_SECONDS),
                );
              }
              if (installCommand) {
                await runPromise(updateStartingHost("Installing dependencies"));
                await withDaytonaStep("install dependencies", () =>
                  runBlockingPtyCommand({
                    sandbox: activeSandbox,
                    label: "install dependencies",
                    command: installCommand,
                    cwd: DAYTONA_REPO_DIR,
                    timeoutSeconds: DAYTONA_INSTALL_TIMEOUT_SECONDS,
                  }),
                );
              }
              try {
                await activeSandbox.process.deleteSession(DAYTONA_SESSION_ID);
              } catch {
                // Ignore missing sessions.
              }
              await runPromise(updateStartingHost("Starting dev server"));
              await withDaytonaStep("create preview session", () =>
                activeSandbox.process.createSession(DAYTONA_SESSION_ID),
              );
              await withDaytonaStep("start dev command", () =>
                activeSandbox.process.executeSessionCommand(DAYTONA_SESSION_ID, {
                  command: `cd ${DAYTONA_REPO_DIR} && ${devCommand}`,
                  runAsync: true,
                }),
              );
              await runPromise(updateStartingHost(`Waiting for app on port ${previewPort}`));
              await withDaytonaStep(`wait for app on port ${previewPort}`, () =>
                waitForSandboxHttpReady(activeSandbox, previewPort),
              );
              await runPromise(updateStartingHost(`Waiting for preview on port ${previewPort}`));
              const previewUrl = await withDaytonaStep(`open preview on port ${previewPort}`, () =>
                waitForPreviewUrl(activeSandbox, previewPort),
              );
              await runPromise(
                devHostRegistry.registerHost({
                  threadId: thread.id,
                  projectId: project.id,
                  projectCwd: project.workspaceRoot,
                  terminalId: null,
                  port: previewPort,
                  launchKind: "daytona_preview",
                  status: "running",
                  url: previewUrl,
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
                    port: previewPort,
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
          const client = yield* makeClient();
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
