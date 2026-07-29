import { Schema } from "effect";
import { AvatarRecipe } from "./avatar.js";
import { Scope } from "./common.js";
import { ShareGrantContext } from "./share-context.js";

// Who performed an action. An OAuth-MCP call carries both the authorizing
// `user` and the acting `agent`; names are display snapshots — `agent.name` is
// self-asserted via dynamic client registration, never authorize on it.
export const Actor = Schema.Struct({
  user: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      avatar: Schema.optional(AvatarRecipe),
    }),
  ),
  agent: Schema.optional(Schema.Struct({ clientId: Schema.String, name: Schema.String })),
  token: Schema.optional(Schema.Struct({ id: Schema.String, name: Schema.String })),
  share: Schema.optional(Schema.Struct({ grantId: Schema.String, name: Schema.String })),
});
export type Actor = typeof Actor.Type;

const PrincipalBase = {
  tenantId: Schema.NonEmptyString,
  scopes: Schema.Array(Scope),
  actor: Schema.optional(Actor),
};

export const SessionPrincipal = Schema.Struct({ ...PrincipalBase, via: Schema.Literal("session") });
export type SessionPrincipal = typeof SessionPrincipal.Type;

export const TokenPrincipal = Schema.Struct({ ...PrincipalBase, via: Schema.Literal("token") });
export type TokenPrincipal = typeof TokenPrincipal.Type;

export const SharePrincipal = Schema.Struct({
  ...PrincipalBase,
  via: Schema.Literal("share"),
  share: ShareGrantContext,
});
export type SharePrincipal = typeof SharePrincipal.Type;

export const Principal = Schema.Union(SessionPrincipal, TokenPrincipal, SharePrincipal);
export type Principal = typeof Principal.Type;
