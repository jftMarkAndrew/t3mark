import type {
  ActiveDevHost,
  CredentialProfilesState,
  DaytonaLaunchInput,
  DaytonaServerStatus,
  DaytonaStopInput,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export const DAYTONA_DEFAULT_API_URL = "https://app.daytona.io/api";
export const DAYTONA_DEFAULT_TEST_API_KEY =
  "dtn_a55a00ef1cf5363a313dd973a3241701152f36d831a92a722e348982712bb0d1";
export const DAYTONA_GITHUB_HOST = "github.com";

function pushUnique(parts: string[], value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return;
  }
  if (!parts.includes(normalized)) {
    parts.push(normalized);
  }
}

function stringifyUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) {
    return null;
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" ? serialized : null;
  } catch {
    return null;
  }
}

export function describeDaytonaCause(cause: unknown, seen = new Set<unknown>()): string | null {
  if (cause == null || seen.has(cause)) {
    return null;
  }

  if (typeof cause === "string") {
    return cause.trim() || null;
  }

  if (typeof cause !== "object") {
    return null;
  }

  seen.add(cause);
  const details: string[] = [];
  const candidate = cause as {
    name?: unknown;
    message?: unknown;
    cause?: unknown;
    result?: unknown;
    stderr?: unknown;
    stdout?: unknown;
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    response?: { data?: unknown; status?: unknown } | unknown;
  };

  if (typeof candidate.message === "string") {
    pushUnique(details, candidate.message);
  } else if (typeof candidate.name === "string" && candidate.name !== "Error") {
    pushUnique(details, candidate.name);
  }

  if (typeof candidate.result === "string") {
    pushUnique(details, candidate.result);
  }
  if (typeof candidate.stderr === "string") {
    pushUnique(details, candidate.stderr);
  }
  if (typeof candidate.stdout === "string") {
    pushUnique(details, candidate.stdout);
  }
  if (typeof candidate.code === "string" || typeof candidate.code === "number") {
    pushUnique(details, `code ${String(candidate.code)}`);
  }
  if (typeof candidate.status === "number") {
    pushUnique(details, `status ${candidate.status}`);
  }
  if (typeof candidate.statusCode === "number") {
    pushUnique(details, `status ${candidate.statusCode}`);
  }

  const response =
    candidate.response && typeof candidate.response === "object"
      ? (candidate.response as { data?: unknown; status?: unknown })
      : null;
  if (response) {
    if (typeof response.status === "number") {
      pushUnique(details, `response status ${response.status}`);
    }
    pushUnique(details, stringifyUnknown(response.data));
  }

  pushUnique(details, describeDaytonaCause(candidate.cause, seen));
  return details.length > 0 ? details.join(" | ") : null;
}

export function formatDaytonaErrorMessage(summary: string, cause?: unknown): string {
  const detail = describeDaytonaCause(cause);
  return detail ? `${summary} ${detail}` : summary;
}

export class DaytonaError extends Schema.TaggedErrorClass<DaytonaError>()("DaytonaError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface DaytonaShape {
  readonly launchPreview: (input: DaytonaLaunchInput) => Effect.Effect<ActiveDevHost, DaytonaError>;
  readonly stopPreview: (input: DaytonaStopInput) => Effect.Effect<void, DaytonaError>;
}

export class DaytonaService extends ServiceMap.Service<DaytonaService, DaytonaShape>()(
  "t3/fork/Services/Daytona",
) {}

export function resolveDaytonaCredentials(): {
  apiKey: string;
  apiUrl: string;
  target: string | null;
  source: "env" | "test-default";
} {
  const apiKey = process.env.DAYTONA_API_KEY?.trim() || DAYTONA_DEFAULT_TEST_API_KEY;
  const apiUrl = process.env.DAYTONA_API_URL?.trim() || DAYTONA_DEFAULT_API_URL;
  const target = process.env.DAYTONA_TARGET?.trim() || null;
  const source = process.env.DAYTONA_API_KEY?.trim() ? "env" : "test-default";

  return {
    apiKey,
    apiUrl,
    target,
    source,
  };
}

export function resolveDaytonaGitToken(): string | null {
  const token = process.env.DAYTONA_GIT_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

export function parseGitHubRepoUrl(
  repoUrl: string,
): { normalizedUrl: string; host: string } | null {
  try {
    const parsed = new URL(repoUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== DAYTONA_GITHUB_HOST) {
      return null;
    }
    return {
      normalizedUrl: parsed.toString(),
      host: parsed.hostname,
    };
  } catch {
    return null;
  }
}

export function resolveDaytonaServerStatus(
  credentialsState?: typeof CredentialProfilesState.Type | null,
): DaytonaServerStatus {
  const credentials = resolveDaytonaCredentials();
  const gitToken = resolveDaytonaGitToken();
  const profiles = credentialsState?.profiles ?? [];
  const hasDaytonaProfile = profiles.some(
    (profile) => profile.kind === "daytona" && profile.hasSecret,
  );
  const hasGitHubProfile = profiles.some(
    (profile) => profile.kind === "github" && profile.hasSecret,
  );

  return {
    configured: true,
    apiUrl: credentials.apiUrl,
    target: credentials.target,
    message:
      hasDaytonaProfile && hasGitHubProfile
        ? "App-managed Daytona and GitHub credentials are configured."
        : hasDaytonaProfile
          ? "App-managed Daytona credentials are configured. Add a GitHub credential for private repository previews."
          : credentials.source === "env"
            ? gitToken
              ? "Daytona API ready. Private GitHub previews are enabled with DAYTONA_GIT_TOKEN."
              : "Daytona API ready. Set DAYTONA_GIT_TOKEN to enable private GitHub previews."
            : gitToken
              ? "Using the built-in Daytona test API key. Private GitHub previews are enabled with DAYTONA_GIT_TOKEN."
              : "Using the built-in Daytona test API key. Set DAYTONA_API_KEY to override it and DAYTONA_GIT_TOKEN for private GitHub previews.",
  };
}
