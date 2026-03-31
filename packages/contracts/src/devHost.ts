import { Schema } from "effect";
import { PositiveInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const DevHostId = TrimmedNonEmptyString;
export type DevHostId = typeof DevHostId.Type;

export const DevHostLaunchKind = Schema.Literals(["localhost_launcher", "daytona_preview"]);
export type DevHostLaunchKind = typeof DevHostLaunchKind.Type;

export const DevHostStatus = Schema.Literals(["starting", "running", "error"]);
export type DevHostStatus = typeof DevHostStatus.Type;

export const ActiveDevHost = Schema.Struct({
  id: DevHostId,
  threadId: ThreadId,
  projectId: ProjectId,
  projectCwd: TrimmedNonEmptyString,
  terminalId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  port: Schema.optional(Schema.NullOr(PositiveInt)).pipe(Schema.withDecodingDefault(() => null)),
  launchKind: DevHostLaunchKind,
  status: DevHostStatus,
  url: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  primaryUrl: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  serviceUrls: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        web: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
          Schema.withDecodingDefault(() => null),
        ),
        server: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
          Schema.withDecodingDefault(() => null),
        ),
      }),
    ),
  ).pipe(Schema.withDecodingDefault(() => null)),
  workspaceId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  repoUrl: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  statusDetail: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  lastError: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  registeredAt: Schema.String,
});
export type ActiveDevHost = typeof ActiveDevHost.Type;

export const DevHostRegisterInput = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  projectCwd: TrimmedNonEmptyString,
  terminalId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  port: Schema.optional(Schema.NullOr(PositiveInt)).pipe(Schema.withDecodingDefault(() => null)),
  launchKind: DevHostLaunchKind,
  status: Schema.optional(DevHostStatus).pipe(Schema.withDecodingDefault(() => "running")),
  url: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  primaryUrl: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  serviceUrls: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        web: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
          Schema.withDecodingDefault(() => null),
        ),
        server: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
          Schema.withDecodingDefault(() => null),
        ),
      }),
    ),
  ).pipe(Schema.withDecodingDefault(() => null)),
  workspaceId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  repoUrl: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  statusDetail: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  lastError: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
export type DevHostRegisterInput = typeof DevHostRegisterInput.Type;

export const DevHostStopInput = Schema.Struct({
  hostId: DevHostId,
});
export type DevHostStopInput = typeof DevHostStopInput.Type;

export const DevHostListResult = Schema.Struct({
  hosts: Schema.Array(ActiveDevHost),
});
export type DevHostListResult = typeof DevHostListResult.Type;

export const DaytonaLaunchInput = Schema.Struct({
  threadId: ThreadId,
});
export type DaytonaLaunchInput = typeof DaytonaLaunchInput.Type;

export const DaytonaStopInput = Schema.Struct({
  hostId: DevHostId,
});
export type DaytonaStopInput = typeof DaytonaStopInput.Type;
