import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";

import {
  CredentialProfilesState,
  type CredentialProfile as CredentialProfileModel,
  type CredentialProviderKind,
  type CredentialProfilesState as CredentialProfilesStateModel,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path, PubSub, Ref, Schema, Stream } from "effect";

import { ServerConfig } from "../../config";
import {
  CredentialProfilesError,
  CredentialProfilesService,
  DAYTONA_ENV_FALLBACK_API_KEY,
  GITHUB_ENV_FALLBACK_TOKEN,
  validateDaytonaApiKey,
  validateGitHubToken,
} from "../Services/Credentials";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE_NAME = "t3code.credentials";
const decodeCredentialProfilesState = Schema.decodeUnknownSync(CredentialProfilesState);

function keychainAccount(kind: CredentialProviderKind, profileId: string): string {
  return `${kind}:${profileId}`;
}

async function runSecurityCommand(
  args: ReadonlyArray<string>,
  options: { allowNonZeroExit?: boolean } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync("security", args, {
      timeout: 10_000,
      maxBuffer: 512 * 1024,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: 0,
    };
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
    };
    const code = typeof error.code === "number" ? error.code : 1;
    if (options.allowNonZeroExit) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        code,
      };
    }
    throw new CredentialProfilesError({
      message: "Keychain access failed.",
      cause,
    });
  }
}

async function setKeychainSecret(
  kind: CredentialProviderKind,
  profileId: string,
  secret: string,
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new CredentialProfilesError({
      message: "OS keychain storage is only supported on macOS in this build.",
    });
  }

  await runSecurityCommand([
    "add-generic-password",
    "-a",
    keychainAccount(kind, profileId),
    "-s",
    KEYCHAIN_SERVICE_NAME,
    "-w",
    secret,
    "-U",
  ]);
}

async function readKeychainSecret(
  kind: CredentialProviderKind,
  profileId: string,
): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  const result = await runSecurityCommand(
    [
      "find-generic-password",
      "-a",
      keychainAccount(kind, profileId),
      "-s",
      KEYCHAIN_SERVICE_NAME,
      "-w",
    ],
    { allowNonZeroExit: true },
  );

  if (result.code !== 0) {
    return null;
  }

  return result.stdout.replace(/\r?\n$/, "");
}

async function deleteKeychainSecret(
  kind: CredentialProviderKind,
  profileId: string,
): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  await runSecurityCommand(
    [
      "delete-generic-password",
      "-a",
      keychainAccount(kind, profileId),
      "-s",
      KEYCHAIN_SERVICE_NAME,
    ],
    { allowNonZeroExit: true },
  );
}

export const CredentialProfilesLive = Layer.effect(
  CredentialProfilesService,
  Effect.gen(function* () {
    const { credentialsPath } = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateRef = yield* Ref.make<CredentialProfilesStateModel>({ profiles: [] });
    const changes = yield* PubSub.unbounded<CredentialProfilesStateModel>();

    const loadState = Effect.gen(function* () {
      const exists = yield* fs.exists(credentialsPath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return { profiles: [] } satisfies CredentialProfilesStateModel;
      }

      const raw = yield* fs.readFileString(credentialsPath).pipe(
        Effect.mapError(
          (cause) =>
            new CredentialProfilesError({
              message: "Failed to read credential metadata.",
              cause,
            }),
        ),
      );

      return yield* Effect.try({
        try: () => decodeCredentialProfilesState(JSON.parse(raw)),
        catch: (cause) =>
          new CredentialProfilesError({
            message: "Failed to parse credential metadata.",
            cause,
          }),
      });
    });

    const persistState = (state: CredentialProfilesStateModel) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(credentialsPath), { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new CredentialProfilesError({
                message: "Failed to prepare credential metadata directory.",
                cause,
              }),
          ),
        );
        yield* fs.writeFileString(credentialsPath, `${JSON.stringify(state, null, 2)}\n`).pipe(
          Effect.mapError(
            (cause) =>
              new CredentialProfilesError({
                message: "Failed to persist credential metadata.",
                cause,
              }),
          ),
        );
      });

    const emitChange = (state: CredentialProfilesStateModel) =>
      PubSub.publish(changes, state).pipe(Effect.asVoid);

    const writeState = (state: CredentialProfilesStateModel) =>
      Effect.gen(function* () {
        yield* Ref.set(stateRef, state);
        yield* persistState(state);
        yield* emitChange(state);
      });

    const validateSecret = (kind: CredentialProviderKind, secret: string) =>
      Effect.tryPromise({
        try: () =>
          kind === "daytona" ? validateDaytonaApiKey(secret) : validateGitHubToken(secret),
        catch: (cause) =>
          new CredentialProfilesError({
            message: "Credential validation failed.",
            cause,
          }),
      });

    const validateStoredProfile = (
      state: CredentialProfilesStateModel,
      profileId: string,
    ): Effect.Effect<CredentialProfileModel, CredentialProfilesError> =>
      Effect.gen(function* () {
        const existing = state.profiles.find((profile) => profile.id === profileId);
        if (!existing) {
          return yield* new CredentialProfilesError({
            message: `Credential profile '${profileId}' was not found.`,
          });
        }

        const secret = yield* Effect.tryPromise({
          try: () => readKeychainSecret(existing.kind, existing.id),
          catch: (cause) =>
            new CredentialProfilesError({
              message: "Failed to read secret from the OS keychain.",
              cause,
            }),
        });

        const validation =
          secret === null
            ? {
                status: "invalid" as const,
                message: "No stored secret. Paste a token to validate this profile.",
              }
            : yield* validateSecret(existing.kind, secret);

        const nextProfile: CredentialProfileModel = {
          ...existing,
          hasSecret: secret !== null,
          lastValidatedAt: new Date().toISOString(),
          validationStatus: validation.status,
          validationMessage: validation.message,
          updatedAt: new Date().toISOString(),
        };

        yield* writeState({
          profiles: state.profiles.map((profile) =>
            profile.id === existing.id ? nextProfile : profile,
          ),
        });

        return nextProfile;
      });

    const currentState = yield* loadState.pipe(
      Effect.orElseSucceed(() => ({ profiles: [] }) satisfies CredentialProfilesStateModel),
    );
    yield* Ref.set(stateRef, currentState);

    return {
      listProfiles: Ref.get(stateRef),
      upsertProfile: (input) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const existing = input.id
            ? (state.profiles.find((profile) => profile.id === input.id) ?? null)
            : null;
          const now = new Date().toISOString();
          const profileId = input.id ?? crypto.randomUUID();

          if (existing && existing.kind !== input.kind) {
            yield* Effect.tryPromise({
              try: () => deleteKeychainSecret(existing.kind, existing.id),
              catch: (cause) =>
                new CredentialProfilesError({
                  message: "Failed to rotate credential secret storage.",
                  cause,
                }),
            });
          }

          const inputSecret = typeof input.secret === "string" ? input.secret : null;
          if (inputSecret !== null) {
            yield* Effect.tryPromise({
              try: () => setKeychainSecret(input.kind, profileId, inputSecret),
              catch: (cause) =>
                new CredentialProfilesError({
                  message: "Failed to save secret to the OS keychain.",
                  cause,
                }),
            });
          }

          const nextProfile: CredentialProfileModel = {
            id: profileId,
            kind: input.kind,
            name: input.name,
            description: input.description,
            isDefault: input.isDefault,
            hasSecret: inputSecret !== null ? true : (existing?.hasSecret ?? false),
            lastValidatedAt: existing?.lastValidatedAt ?? null,
            validationStatus: existing?.validationStatus ?? "unknown",
            validationMessage: existing?.validationMessage ?? null,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };

          const nextProfiles = state.profiles
            .filter((profile) => profile.id !== profileId)
            .map((profile) => {
              if (profile.kind === input.kind && input.isDefault) {
                return Object.assign({}, profile, { isDefault: false });
              }
              return profile;
            });
          nextProfiles.push(nextProfile);

          yield* writeState({ profiles: nextProfiles });

          if (input.validate) {
            return yield* validateStoredProfile({ profiles: nextProfiles }, profileId);
          }

          return nextProfile;
        }),
      deleteProfile: (input) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const existing = state.profiles.find((profile) => profile.id === input.profileId);
          if (!existing) {
            return;
          }

          yield* Effect.tryPromise({
            try: () => deleteKeychainSecret(existing.kind, existing.id),
            catch: (cause) =>
              new CredentialProfilesError({
                message: "Failed to delete secret from the OS keychain.",
                cause,
              }),
          });

          yield* writeState({
            profiles: state.profiles.filter((profile) => profile.id !== input.profileId),
          });
        }),
      validateProfile: (input) =>
        Ref.get(stateRef).pipe(
          Effect.flatMap((state) => validateStoredProfile(state, input.profileId)),
        ),
      resolveSecret: ({ kind, profileId }) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const selectedProfile =
            profileId !== null
              ? (state.profiles.find(
                  (profile) => profile.id === profileId && profile.kind === kind,
                ) ?? null)
              : (state.profiles.find((profile) => profile.kind === kind && profile.isDefault) ??
                null);

          if (selectedProfile) {
            const secret = yield* Effect.tryPromise({
              try: () => readKeychainSecret(selectedProfile.kind, selectedProfile.id),
              catch: (cause) =>
                new CredentialProfilesError({
                  message: "Failed to read secret from the OS keychain.",
                  cause,
                }),
            });

            if (secret === null) {
              return yield* new CredentialProfilesError({
                message: `Credential profile '${selectedProfile.name}' has no stored secret.`,
              });
            }

            return {
              profile: {
                ...selectedProfile,
                hasSecret: true,
              },
              secret,
              source: "profile" as const,
            };
          }

          const envSecret =
            kind === "daytona" ? DAYTONA_ENV_FALLBACK_API_KEY() : GITHUB_ENV_FALLBACK_TOKEN();
          return {
            profile: null,
            secret: envSecret,
            source: envSecret ? ("env" as const) : ("none" as const),
          };
        }),
      streamChanges: Stream.fromPubSub(changes),
    };
  }),
);
