import type { ActiveDevHost } from "@t3tools/contracts";
import { Effect, Layer, Ref } from "effect";

import { TerminalManager } from "../../terminal/Services/Manager";
import {
  DevHostRegistry,
  DevHostRegistryError,
  type DevHostRegistryShape,
} from "../Services/DevHostRegistry";

function hostKey(threadId: string, terminalId: string): string {
  return `${threadId}:${terminalId}`;
}

export const DevHostRegistryLive = Layer.effect(
  DevHostRegistry,
  Effect.gen(function* () {
    const terminalManager = yield* TerminalManager;
    const hostsRef = yield* Ref.make(new Map<string, ActiveDevHost>());

    const service = {
      registerHost: (input) =>
        Ref.update(hostsRef, (current) => {
          const next = new Map(current);
          const registeredAt = new Date().toISOString();
          next.set(hostKey(input.threadId, input.terminalId), {
            id: hostKey(input.threadId, input.terminalId),
            threadId: input.threadId,
            projectId: input.projectId,
            projectCwd: input.projectCwd,
            terminalId: input.terminalId,
            port: input.port,
            launchKind: input.launchKind,
            status: "running",
            registeredAt,
          });
          return next;
        }).pipe(
          Effect.mapError(
            (cause) =>
              new DevHostRegistryError({
                message: "Failed to register dev host.",
                cause,
              }),
          ),
        ),
      listHosts: Ref.get(hostsRef).pipe(
        Effect.map((hosts) => ({
          hosts: [...hosts.values()].toSorted((left, right) => left.port - right.port),
        })),
      ),
      stopHost: (input) =>
        Effect.gen(function* () {
          const hosts = yield* Ref.get(hostsRef);
          const host =
            [...hosts.values()].find((candidate) => candidate.id === input.hostId) ?? null;
          if (!host) {
            return;
          }
          yield* terminalManager
            .write({
              threadId: host.threadId,
              terminalId: host.terminalId,
              data: "\u0003",
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new DevHostRegistryError({
                    message: "Failed to stop dev host.",
                    cause,
                  }),
              ),
            );
        }),
      reconcileTerminalEvent: (event) =>
        Ref.update(hostsRef, (current) => {
          if (event.type !== "activity" && event.type !== "exited" && event.type !== "error") {
            return current;
          }
          const next = new Map(current);
          for (const [key, host] of next.entries()) {
            if (host.threadId !== event.threadId || host.terminalId !== event.terminalId) {
              continue;
            }
            if (event.type === "activity" && event.hasRunningSubprocess) {
              continue;
            }
            next.delete(key);
          }
          return next;
        }).pipe(Effect.orDie),
    } satisfies DevHostRegistryShape;

    return service;
  }),
);
