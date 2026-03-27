import { Schema } from "effect";
import { PositiveInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const DevHostId = TrimmedNonEmptyString;
export type DevHostId = typeof DevHostId.Type;

export const DevHostLaunchKind = Schema.Literal("localhost_launcher");
export type DevHostLaunchKind = typeof DevHostLaunchKind.Type;

export const DevHostStatus = Schema.Literal("running");
export type DevHostStatus = typeof DevHostStatus.Type;

export const ActiveDevHost = Schema.Struct({
  id: DevHostId,
  threadId: ThreadId,
  projectId: ProjectId,
  projectCwd: TrimmedNonEmptyString,
  terminalId: TrimmedNonEmptyString,
  port: PositiveInt,
  launchKind: DevHostLaunchKind,
  status: DevHostStatus,
  registeredAt: Schema.String,
});
export type ActiveDevHost = typeof ActiveDevHost.Type;

export const DevHostRegisterInput = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  projectCwd: TrimmedNonEmptyString,
  terminalId: TrimmedNonEmptyString,
  port: PositiveInt,
  launchKind: DevHostLaunchKind,
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
