import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const quote = trimmed[0];
  if ((quote === `"` || quote === `'`) && trimmed.endsWith(quote)) {
    const inner = trimmed.slice(1, -1);
    if (quote === `"`) {
      return inner
        .replaceAll(String.raw`\n`, "\n")
        .replaceAll(String.raw`\r`, "\r")
        .replaceAll(String.raw`\t`, "\t")
        .replaceAll(String.raw`\\`, "\\")
        .replaceAll(String.raw`\"`, `"`);
    }
    return inner;
  }

  const commentIndex = trimmed.indexOf(" #");
  return commentIndex >= 0 ? trimmed.slice(0, commentIndex).trimEnd() : trimmed;
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue;
    }

    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));
    process.env[key] = value;
  }
}

function loadLocalEnvFiles(): void {
  const searchRoots = new Set<string>();
  let currentDir = process.cwd();

  while (true) {
    searchRoots.add(currentDir);
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  for (const root of Array.from(searchRoots).toReversed()) {
    loadEnvFile(path.join(root, ".env"));
    loadEnvFile(path.join(root, ".env.local"));
  }
}

loadLocalEnvFiles();
