import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";

import { DevHostRegistryLive } from "./DevHostRegistry";
import { DevHostRegistry } from "../Services/DevHostRegistry";
import { TerminalManager } from "../../terminal/Services/Manager";

describe("DevHostRegistry", () => {
  it("registers, lists, reconciles, and stops dev hosts", async () => {
    const write = vi.fn(() => Effect.void);
    const terminalManagerLayer = Layer.succeed(TerminalManager, {
      open: vi.fn(),
      write,
      resize: vi.fn(),
      clear: vi.fn(),
      restart: vi.fn(),
      close: vi.fn(),
      subscribe: vi.fn(),
      dispose: Effect.void,
    } as never);
    const registryLayer = DevHostRegistryLive.pipe(Layer.provide(terminalManagerLayer));

    const program = Effect.gen(function* () {
      const registry = yield* DevHostRegistry;
      yield* registry.registerHost({
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        projectCwd: "/repo",
        terminalId: "terminal-1",
        port: 4200,
        launchKind: "localhost_launcher",
      });

      const listed = yield* registry.listHosts;
      expect(listed.hosts).toHaveLength(1);
      expect(listed.hosts[0]?.port).toBe(4200);

      yield* registry.reconcileTerminalEvent({
        type: "activity",
        threadId: "thread-1",
        terminalId: "terminal-1",
        createdAt: new Date().toISOString(),
        hasRunningSubprocess: false,
      });

      const afterExit = yield* registry.listHosts;
      expect(afterExit.hosts).toHaveLength(0);

      yield* registry.registerHost({
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        projectCwd: "/repo",
        terminalId: "terminal-1",
        port: 4200,
        launchKind: "localhost_launcher",
      });
      const running = yield* registry.listHosts;
      const hostId = running.hosts[0]?.id;
      if (!hostId) {
        throw new Error("Expected registered host.");
      }
      yield* registry.stopHost({ hostId });
      expect(write).toHaveBeenCalledWith({
        threadId: "thread-1",
        terminalId: "terminal-1",
        data: "\u0003",
      });

      const afterStopSignal = yield* registry.listHosts;
      expect(afterStopSignal.hosts).toHaveLength(1);

      yield* registry.reconcileTerminalEvent({
        type: "activity",
        threadId: "thread-1",
        terminalId: "terminal-1",
        createdAt: new Date().toISOString(),
        hasRunningSubprocess: false,
      });

      const afterStopExit = yield* registry.listHosts;
      expect(afterStopExit.hosts).toHaveLength(0);
    }).pipe(Effect.provide(registryLayer));

    await Effect.runPromise(program);
  });
});
