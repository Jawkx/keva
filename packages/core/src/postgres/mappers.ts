import {
  canonicalizeProperties,
  type Actor,
  type ItemEvent,
  type ItemEventPayload,
  type KevaItem,
} from "@keva/schema";
import type { UploadAttempt } from "../services.js";

export interface ItemRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly content_type: string;
  readonly declared_size: number | string;
  readonly size: number | string | null;
  readonly etag: string | null;
  readonly source: string;
  readonly uploaded_by_user_id: string | null;
  readonly status: "pending" | "confirming" | "ready" | "deleting";
  readonly storage_key: string;
  readonly staging_key: string;
  readonly revision: number;
  readonly upload_period_start: Date | string | null;
  readonly upload_reservation_state: "reserved" | "consumed" | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly deleted_at: Date | string | null;
  readonly properties: KevaItem["properties"];
  readonly presentation: NonNullable<KevaItem["presentation"]>;
}

export const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export const mapRow = (row: ItemRow): KevaItem => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  contentType: row.content_type,
  declaredSize: Number(row.declared_size),
  size: row.size === null ? null : Number(row.size),
  etag: row.etag,
  source: row.source,
  ...(row.uploaded_by_user_id === null ? {} : { uploadedByUserId: row.uploaded_by_user_id }),
  status: row.status,
  storageKey: row.storage_key,
  stagingKey: row.staging_key,
  revision: row.revision,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
  ...(row.deleted_at === null ? {} : { deletedAt: asIso(row.deleted_at) }),
  properties: canonicalizeProperties(row.properties),
  presentation: row.presentation,
});

export interface UploadAttemptRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly item_id: string | null;
  readonly retry_key: string | null;
  readonly request_hash: string | null;
  readonly staging_key: string;
  readonly storage_key: string;
  readonly upload_url: string;
  readonly upload_headers: Readonly<Record<string, string>>;
  readonly expected_size: number | string;
  readonly expires_at: Date | string;
  readonly state: UploadAttempt["state"];
  readonly observed_etag: string | null;
  readonly cleanup_after: Date | string;
  readonly next_retry_at: Date | string;
  readonly retry_count: number;
}

export const mapAttemptRow = (row: UploadAttemptRow): UploadAttempt => ({
  id: row.id,
  tenantId: row.tenant_id,
  itemId: row.item_id,
  retryKey: row.retry_key,
  requestHash: row.request_hash,
  stagingKey: row.staging_key,
  storageKey: row.storage_key,
  uploadUrl: row.upload_url,
  uploadHeaders: row.upload_headers,
  expectedSize: Number(row.expected_size),
  expiresAt: asIso(row.expires_at),
  state: row.state,
  observedEtag: row.observed_etag,
  cleanupAfter: asIso(row.cleanup_after),
  nextRetryAt: asIso(row.next_retry_at),
  retryCount: row.retry_count,
});

export interface ItemEventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly action: ItemEvent["action"];
  readonly actor: Actor | null;
  readonly payload: ItemEventPayload;
  readonly created_at: Date | string;
}

export type PatchResult =
  | { readonly status: "missing" }
  | { readonly status: "conflict" }
  | { readonly status: "limit-exceeded" }
  | { readonly status: "updated"; readonly previous: KevaItem; readonly updated: KevaItem };

export const mapEventRow = (row: ItemEventRow): ItemEvent => ({
  id: row.id,
  tenantId: row.tenant_id,
  itemId: row.item_id,
  itemName: row.item_name,
  action: row.action,
  actor: row.actor,
  payload: row.payload,
  createdAt: asIso(row.created_at),
});

export const jsonbParam = (value: unknown): string | null =>
  value === undefined || value === null ? null : JSON.stringify(value);
