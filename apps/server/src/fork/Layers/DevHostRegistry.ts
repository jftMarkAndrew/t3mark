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
          if (input.launchKind === "daytona_preview") {
            for (const [key, host] of next.entries()) {
              if (host.launchKind === "daytona_preview" && host.threadId === input.threadId) {
                next.delete(key);
              }
            }
          }
          const id =
            input.launchKind === "localhost_launcher"
              ? hostKey(input.threadId, input.terminalId ?? "default")
              : hostKey(input.threadId, input.workspaceId ?? `daytona-${registeredAt}`);
          next.set(id, {
            id,
            threadId: input.threadId,
            projectId: input.projectId,
            projectCwd: input.projectCwd,
            terminalId: input.terminalId ?? null,
            port: input.port ?? null,
            launchKind: input.launchKind,
            status: input.status ?? "running",
            url: input.url ?? input.primaryUrl ?? input.serviceUrls?.web ?? null,
            primaryUrl: input.primaryUrl ?? input.url ?? input.serviceUrls?.web ?? null,
            serviceUrls: input.serviceUrls ?? null,
            workspaceId: input.workspaceId ?? null,
            branch: input.branch ?? null,
            repoUrl: input.repoUrl ?? null,
            statusDetail: input.statusDetail ?? null,
            lastError: input.lastError ?? null,
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
      unregisterHost: (hostId) =>
        Ref.update(hostsRef, (current) => {
          if (!current.has(hostId)) {
            return current;
          }
          const next = new Map(current);
          next.delete(hostId);
          return next;
        }).pipe(Effect.orDie),
      getHost: (hostId) => Ref.get(hostsRef).pipe(Effect.map((hosts) => hosts.get(hostId) ?? null)),
      listHosts: Ref.get(hostsRef).pipe(
        Effect.map((hosts) => ({
          hosts: [...hosts.values()].toSorted(
            (left, right) =>
              (left.port ?? Number.MAX_SAFE_INTEGER) - (right.port ?? Number.MAX_SAFE_INTEGER),
          ),
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
          if (host.launchKind !== "localhost_launcher" || !host.terminalId) {
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
