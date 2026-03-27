import { detectNodeBootstrap } from "@t3tools/shared/bootstrap";
import { promises as fs } from "node:fs";
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

interface PackageJsonLike {
  readonly scripts?: Record<string, string> | null;
  readonly dependencies?: Record<string, string> | null;
  readonly devDependencies?: Record<string, string> | null;
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
  return detectNodeBootstrap({
    filePaths: existingFiles,
    packageJson,
  });
}
