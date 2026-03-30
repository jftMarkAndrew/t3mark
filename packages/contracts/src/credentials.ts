import { Schema } from "effect";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";

export const CredentialProfileId = TrimmedNonEmptyString;
export type CredentialProfileId = typeof CredentialProfileId.Type;

export const CredentialProviderKind = Schema.Literals(["daytona", "github"]);
export type CredentialProviderKind = typeof CredentialProviderKind.Type;

export const CredentialValidationStatus = Schema.Literals(["unknown", "valid", "invalid", "error"]);
export type CredentialValidationStatus = typeof CredentialValidationStatus.Type;

export const CredentialProfile = Schema.Struct({
  id: CredentialProfileId,
  kind: CredentialProviderKind,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  isDefault: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  hasSecret: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  lastValidatedAt: Schema.optional(Schema.NullOr(IsoDateTime)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  validationStatus: Schema.optional(CredentialValidationStatus).pipe(
    Schema.withDecodingDefault(() => "unknown"),
  ),
  validationMessage: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CredentialProfile = typeof CredentialProfile.Type;

export const CredentialProfilesState = Schema.Struct({
  profiles: Schema.Array(CredentialProfile).pipe(Schema.withDecodingDefault(() => [])),
});
export type CredentialProfilesState = typeof CredentialProfilesState.Type;

export const CredentialProfileUpsertInput = Schema.Struct({
  id: Schema.optional(Schema.NullOr(CredentialProfileId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  kind: CredentialProviderKind,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  isDefault: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  secret: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  validate: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => true)),
});
export type CredentialProfileUpsertInput = typeof CredentialProfileUpsertInput.Type;

export const CredentialProfileDeleteInput = Schema.Struct({
  profileId: CredentialProfileId,
});
export type CredentialProfileDeleteInput = typeof CredentialProfileDeleteInput.Type;

export const CredentialProfileValidateInput = Schema.Struct({
  profileId: CredentialProfileId,
});
export type CredentialProfileValidateInput = typeof CredentialProfileValidateInput.Type;
