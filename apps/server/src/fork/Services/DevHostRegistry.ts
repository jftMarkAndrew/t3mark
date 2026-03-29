import {
  type ActiveDevHost,
  DevHostListResult,
  DevHostRegisterInput,
  DevHostStopInput,
  type TerminalEvent,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export class DevHostRegistryError extends Schema.TaggedErrorClass<DevHostRegistryError>()(
  "DevHostRegistryError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface DevHostRegistryShape {
  readonly registerHost: (input: DevHostRegisterInput) => Effect.Effect<void, DevHostRegistryError>;
  readonly unregisterHost: (hostId: string) => Effect.Effect<void, never>;
  readonly getHost: (hostId: string) => Effect.Effect<ActiveDevHost | null, never>;
  readonly listHosts: Effect.Effect<DevHostListResult, never>;
  readonly stopHost: (input: DevHostStopInput) => Effect.Effect<void, DevHostRegistryError>;
  readonly reconcileTerminalEvent: (event: TerminalEvent) => Effect.Effect<void, never>;
}

export class DevHostRegistry extends ServiceMap.Service<DevHostRegistry, DevHostRegistryShape>()(
  "t3/fork/Services/DevHostRegistry",
) {}
