import { Daytona } from "@daytonaio/sdk";
import {
  CredentialProfile,
  CredentialProfileDeleteInput,
  CredentialProfileId,
  CredentialProfileUpsertInput,
  CredentialProfilesState,
  CredentialProfileValidateInput,
  CredentialProviderKind,
  CredentialValidationStatus,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap, Stream } from "effect";

export class CredentialProfilesError extends Schema.TaggedErrorClass<CredentialProfilesError>()(
  "CredentialProfilesError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface ResolvedCredentialSecret {
  readonly profile: typeof CredentialProfile.Type | null;
  readonly secret: string | null;
  readonly source: "profile" | "env" | "none";
}

export interface CredentialProfilesShape {
  readonly listProfiles: Effect.Effect<
    typeof CredentialProfilesState.Type,
    CredentialProfilesError
  >;
  readonly upsertProfile: (
    input: typeof CredentialProfileUpsertInput.Type,
  ) => Effect.Effect<typeof CredentialProfile.Type, CredentialProfilesError>;
  readonly deleteProfile: (
    input: typeof CredentialProfileDeleteInput.Type,
  ) => Effect.Effect<void, CredentialProfilesError>;
  readonly validateProfile: (
    input: typeof CredentialProfileValidateInput.Type,
  ) => Effect.Effect<typeof CredentialProfile.Type, CredentialProfilesError>;
  readonly resolveSecret: (params: {
    kind: typeof CredentialProviderKind.Type;
    profileId: typeof CredentialProfileId.Type | null;
  }) => Effect.Effect<ResolvedCredentialSecret, CredentialProfilesError>;
  readonly streamChanges: Stream.Stream<typeof CredentialProfilesState.Type>;
}

export class CredentialProfilesService extends ServiceMap.Service<
  CredentialProfilesService,
  CredentialProfilesShape
>()("t3/fork/CredentialProfilesService") {
  static readonly layerTest = (overrides?: {
    profiles?: ReadonlyArray<typeof CredentialProfile.Type>;
    secrets?: Readonly<Record<string, string>>;
  }) => {
    const profiles = overrides?.profiles ?? [];
    const secrets = overrides?.secrets ?? {};
    return ServiceMap.make(this, {
      listProfiles: Effect.succeed({ profiles: Array.from(profiles) }),
      upsertProfile: (input) =>
        Effect.succeed({
          id: (input.id ?? "profile-test") as typeof CredentialProfileId.Type,
          kind: input.kind,
          name: input.name,
          description: input.description,
          isDefault: input.isDefault,
          hasSecret: Boolean(
            input.secret ?? secrets[`${input.kind}:${input.id ?? "profile-test"}`],
          ),
          lastValidatedAt: null,
          validationStatus: "unknown" as typeof CredentialValidationStatus.Type,
          validationMessage: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      deleteProfile: () => Effect.void,
      validateProfile: (input) =>
        Effect.gen(function* () {
          const state = yield* Effect.succeed({ profiles: Array.from(profiles) });
          const profile = state.profiles.find((entry) => entry.id === input.profileId);
          if (!profile) {
            return yield* new CredentialProfilesError({
              message: `Credential profile '${input.profileId}' was not found.`,
            });
          }
          return profile;
        }),
      resolveSecret: ({ kind, profileId }) =>
        Effect.succeed({
          profile: profiles.find((entry) => entry.id === profileId && entry.kind === kind) ?? null,
          secret: profileId ? (secrets[`${kind}:${profileId}`] ?? null) : null,
          source: profileId ? "profile" : "none",
        }),
      streamChanges: Stream.empty,
    });
  };
}

export const DAYTONA_ENV_FALLBACK_API_KEY = () => process.env.DAYTONA_API_KEY?.trim() || null;
export const GITHUB_ENV_FALLBACK_TOKEN = () => process.env.DAYTONA_GIT_TOKEN?.trim() || null;
export const DAYTONA_ENV_API_URL = () =>
  process.env.DAYTONA_API_URL?.trim() || "https://app.daytona.io/api";
export const DAYTONA_ENV_TARGET = () => process.env.DAYTONA_TARGET?.trim() || null;
const CREDENTIAL_VALIDATION_TIMEOUT_MS = 8_000;

async function withValidationTimeout<T>(
  operation: () => Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(timeoutMessage)),
          CREDENTIAL_VALIDATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function validateDaytonaApiKey(apiKey: string): Promise<{
  status: typeof CredentialValidationStatus.Type;
  message: string | null;
}> {
  try {
    await withValidationTimeout(async () => {
      await using daytona = new Daytona({
        apiKey,
        apiUrl: DAYTONA_ENV_API_URL(),
        ...(DAYTONA_ENV_TARGET() ? { target: DAYTONA_ENV_TARGET()! } : {}),
      });
      await daytona.list(undefined, 1, 1);
    }, "Daytona validation timed out.");
    return {
      status: "valid",
      message: "Validated against the Daytona API.",
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to validate Daytona key.";
    return {
      status: "invalid",
      message,
    };
  }
}

export async function validateGitHubToken(secret: string): Promise<{
  status: typeof CredentialValidationStatus.Type;
  message: string | null;
}> {
  try {
    const response = await withValidationTimeout(
      () =>
        fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${secret}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "t3code",
          },
        }),
      "GitHub validation timed out.",
    );
    if (response.ok) {
      const scopes = response.headers.get("x-oauth-scopes");
      return {
        status: "valid",
        message:
          scopes && scopes.trim().length > 0
            ? `Validated. Scopes: ${scopes}`
            : "Validated against GitHub.",
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        status: "invalid",
        message: `GitHub rejected the token (${response.status}).`,
      };
    }
    return {
      status: "error",
      message: `GitHub validation failed with status ${response.status}.`,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Unable to validate GitHub token.",
    };
  }
}
