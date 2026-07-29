import { canonicalizeProperties, type KevaItem } from "@keva/schema";
import type { Sql } from "postgres";
import { DEFAULT_STORAGE_QUOTA_BYTES } from "../services.js";
import { asIso, jsonbParam } from "./mappers.js";

// Reserve tenant storage inside an open transaction: locks the tenant_usage
// row, checks the quota, and adds the declared size. Returns false (leaving the
// transaction to roll back) when the quota would be exceeded.
export type ReservationOutcome =
  | { readonly status: "ok"; readonly periodStart: string | null }
  | { readonly status: "storage" | "items" | "uploads" | "subscription" };

export const reserveTenantQuota = async (
  transaction: Sql,
  tenantId: string,
  declaredSize: number,
): Promise<ReservationOutcome> => {
  await transaction`
    insert into tenant_usage (tenant_id, used_bytes, used_items, quota_bytes, quota_items)
    values (${tenantId}, 0, 0, ${DEFAULT_STORAGE_QUOTA_BYTES}, null)
    on conflict (tenant_id) do nothing
  `;
  const usage = await transaction<
    {
      used_bytes: string;
      used_items: string;
      quota_bytes: string | null;
      quota_items: string | null;
    }[]
  >`
    select used_bytes, used_items, quota_bytes, quota_items
    from tenant_usage where tenant_id = ${tenantId} for update
  `;
  const current = usage[0]!;
  const usedBytes = Number(current.used_bytes);
  const usedItems = Number(current.used_items);
  const quotaBytes = current.quota_bytes === null ? null : Number(current.quota_bytes);
  const quotaItems = current.quota_items === null ? null : Number(current.quota_items);
  const billing = await transaction<
    {
      status: string;
      grace_ends_at: Date | string | null;
      trial_ends_at: Date | string | null;
      current_period_start: Date | string | null;
      current_period_end: Date | string | null;
      monthly_uploads_limit: string;
    }[]
  >`
    select status, grace_ends_at, trial_ends_at, current_period_start, current_period_end,
           monthly_uploads_limit
    from tenant_billing where tenant_id = ${tenantId} for update
  `;
  let periodStart: string | null = null;
  const entitlement = billing[0];
  if (entitlement) {
    const allowed =
      entitlement.status === "active" ||
      (entitlement.status === "trialing" &&
        entitlement.trial_ends_at !== null &&
        new Date(entitlement.trial_ends_at) > new Date()) ||
      (entitlement.status === "past_due" &&
        entitlement.grace_ends_at !== null &&
        new Date(entitlement.grace_ends_at) > new Date());
    if (!allowed || !entitlement.current_period_start || !entitlement.current_period_end) {
      return { status: "subscription" };
    }
    if (quotaBytes !== null && usedBytes + declaredSize > quotaBytes) return { status: "storage" };
    if (quotaItems !== null && usedItems + 1 > quotaItems) return { status: "items" };
    periodStart = asIso(entitlement.current_period_start);
    const periodEnd = asIso(entitlement.current_period_end);
    await transaction`
      insert into tenant_period_usage (
        tenant_id, period_start, period_end, uploads_used, uploads_reserved, api_requests_used
      ) values (${tenantId}, ${periodStart}, ${periodEnd}, 0, 0, 0)
      on conflict (tenant_id, period_start) do nothing
    `;
    const periods = await transaction<{ uploads_used: string; uploads_reserved: string }[]>`
      select uploads_used, uploads_reserved from tenant_period_usage
      where tenant_id = ${tenantId} and period_start = ${periodStart}
      for update
    `;
    const uploads = Number(periods[0]!.uploads_used) + Number(periods[0]!.uploads_reserved);
    if (uploads + 1 > Number(entitlement.monthly_uploads_limit)) {
      return { status: "uploads" };
    }
    await transaction`
      update tenant_period_usage set uploads_reserved = uploads_reserved + 1
      where tenant_id = ${tenantId} and period_start = ${periodStart}
    `;
  }
  if (!entitlement) {
    if (quotaBytes !== null && usedBytes + declaredSize > quotaBytes) return { status: "storage" };
    if (quotaItems !== null && usedItems + 1 > quotaItems) return { status: "items" };
  }
  await transaction`
    update tenant_usage
    set used_bytes = used_bytes + ${declaredSize}, used_items = used_items + 1
    where tenant_id = ${tenantId}
  `;
  return { status: "ok", periodStart };
};

export const insertItemRow = async (
  transaction: Sql,
  item: KevaItem,
  periodStart: string | null,
): Promise<void> => {
  const properties = canonicalizeProperties(item.properties);
  await transaction`
    insert into items (
      id, tenant_id, name, content_type, declared_size, size, etag,
      source, status, storage_key, staging_key, created_at,
      updated_at, properties, upload_period_start, upload_reservation_state
    ) values (
      ${item.id}, ${item.tenantId}, ${item.name}, ${item.contentType},
      ${item.declaredSize}, ${item.size}, ${item.etag},
      ${item.source}, ${item.status}, ${item.storageKey},
      ${item.stagingKey}, ${item.createdAt}, ${item.updatedAt},
      ${jsonbParam(properties)}::text::jsonb, ${periodStart}, ${periodStart ? "reserved" : null}
    )
  `;
};
