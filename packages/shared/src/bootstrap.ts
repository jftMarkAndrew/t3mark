export type DetectedBootstrapPackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface DetectNodeBootstrapInput {
  readonly filePaths: ReadonlyArray<string>;
  readonly packageJson?: {
    readonly scripts?: Record<string, string> | null;
    readonly dependencies?: Record<string, string> | null;
    readonly devDependencies?: Record<string, string> | null;
  } | null;
}

export interface DetectNodeBootstrapResult {
  readonly enabled: boolean;
  readonly installCommand: string | null;
  readonly devCommand: string | null;
  readonly detectedPackageManager: DetectedBootstrapPackageManager | null;
}

const PACKAGE_MANAGER_LOCKFILES: ReadonlyArray<{
  readonly fileName: string;
  readonly packageManager: DetectedBootstrapPackageManager;
  readonly installCommand: string;
}> = [
  {
    fileName: "pnpm-lock.yaml",
    packageManager: "pnpm",
    installCommand: "pnpm install --frozen-lockfile",
  },
  {
    fileName: "package-lock.json",
    packageManager: "npm",
    installCommand: "npm ci",
  },
  {
    fileName: "yarn.lock",
    packageManager: "yarn",
    installCommand: "yarn install --frozen-lockfile",
  },
  {
    fileName: "bun.lock",
    packageManager: "bun",
    installCommand: "bun install",
  },
  {
    fileName: "bun.lockb",
    packageManager: "bun",
    installCommand: "bun install",
  },
] as const;

function hasAngularDependency(
  packageJson: DetectNodeBootstrapInput["packageJson"],
  packageName: string,
): boolean {
  return Boolean(
    packageJson?.dependencies?.[packageName] ?? packageJson?.devDependencies?.[packageName],
  );
}

export function detectNodeBootstrap(input: DetectNodeBootstrapInput): DetectNodeBootstrapResult {
  const fileNameSet = new Set(input.filePaths);
  const detectedLockfile = PACKAGE_MANAGER_LOCKFILES.find((entry) =>
    fileNameSet.has(entry.fileName),
  );
  const scripts = input.packageJson?.scripts ?? null;

  let devCommand: string | null = null;
  if (typeof scripts?.dev === "string" && scripts.dev.trim().length > 0) {
    devCommand = "npm run dev -- --port {{port}}";
  } else if (typeof scripts?.start === "string" && scripts.start.trim().length > 0) {
    devCommand = "npm start -- --port {{port}}";
  } else if (
    hasAngularDependency(input.packageJson, "@angular/core") ||
    hasAngularDependency(input.packageJson, "@angular/cli")
  ) {
    devCommand = "ng serve --port {{port}}";
  }

  return {
    enabled: detectedLockfile !== undefined,
    installCommand: detectedLockfile?.installCommand ?? null,
    devCommand,
    detectedPackageManager: detectedLockfile?.packageManager ?? null,
  };
}
