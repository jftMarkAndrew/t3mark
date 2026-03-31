import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";
import { BootstrapPackageManager } from "./orchestration";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export const ProjectDetectBootstrapInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ProjectDetectBootstrapInput = typeof ProjectDetectBootstrapInput.Type;

export const ProjectDetectBootstrapResult = Schema.Struct({
  enabled: Schema.Boolean,
  installCommand: Schema.NullOr(TrimmedNonEmptyString),
  devCommand: Schema.NullOr(TrimmedNonEmptyString),
  detectedPackageManager: Schema.NullOr(BootstrapPackageManager),
  detectedRepoUrl: Schema.NullOr(TrimmedNonEmptyString),
  detectedDefaultBranch: Schema.NullOr(TrimmedNonEmptyString),
  detectedDaytonaLaunchMode: Schema.NullOr(Schema.Literals(["single-process", "full-stack-web"])),
  detectedDaytonaInstallCommand: Schema.NullOr(TrimmedNonEmptyString),
  detectedDaytonaDevCommand: Schema.NullOr(TrimmedNonEmptyString),
  detectedDaytonaServerCommand: Schema.NullOr(TrimmedNonEmptyString),
  detectedDaytonaWebCommand: Schema.NullOr(TrimmedNonEmptyString),
  detectedAppPort: Schema.NullOr(PositiveInt),
  detectedDaytonaServerPort: Schema.NullOr(PositiveInt),
  detectedDaytonaWebPort: Schema.NullOr(PositiveInt),
});
export type ProjectDetectBootstrapResult = typeof ProjectDetectBootstrapResult.Type;
