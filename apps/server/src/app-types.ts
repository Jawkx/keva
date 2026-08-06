import type { BlobStore, ChangePublisher, MetadataStore } from "@keva/core";
import type { Layer } from "effect";
import type { Context } from "hono";
import type { Polar } from "@polar-sh/sdk";
import type { ApiTokenStore, Authenticator } from "./auth.js";
import type { UserAvatarResolver } from "./avatar.js";
import type { BillingMeter, BillingStore } from "./billing.js";
import type { McpDeps } from "./mcp.js";
import type { ShareGrantStore } from "./shares.js";
import type { ViewStore } from "./views.js";
import type { RealtimeGateway } from "./realtime.js";

export type AppServices =
  | Authenticator
  | BlobStore
  | MetadataStore
  | ApiTokenStore
  | ShareGrantStore
  | ViewStore;

export type RuntimeServices = AppServices | BillingMeter | ChangePublisher;

export interface AppServiceOptions {
  readonly layer: Layer.Layer<AppServices>;
  readonly changePublisher?: Layer.Layer<ChangePublisher>;
  readonly authHandler?: (request: Request) => Response | Promise<Response>;
  readonly billing?: {
    readonly store: BillingStore;
    readonly polar: Polar;
  };
  readonly mcp?: McpDeps;
  readonly userAvatars?: UserAvatarResolver;
  readonly realtime?: RealtimeGateway;
  readonly dispose?: () => Promise<void>;
}

export type CreateAppOptions =
  | AppServiceOptions
  | { readonly getRequestServices: (context: Context) => AppServiceOptions };

export type KevaApp = import("hono").Hono & { readonly dispose: () => Promise<void> };
