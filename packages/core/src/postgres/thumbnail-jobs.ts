import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  GENERATED_THUMBNAIL_CONTENT_TYPE_ALLOWLIST,
  THUMBNAIL_RECIPE_VERSION,
} from "../thumbnail.js";

export type ThumbnailJobState = "pending" | "processing" | "ready" | "failed";

export interface ClaimedThumbnailJob {
  readonly tenantId: string;
  readonly itemId: string;
  readonly recipeVersion: number;
  readonly attempts: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly sourceEtag: string | null;
  readonly storageKey: string;
  readonly contentType: string;
}

export interface ReadyThumbnailOutput {
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
}

export interface ThumbnailRetryResult {
  readonly state: "pending" | "failed";
  readonly nextAttemptAt: string | null;
}

interface ClaimedRow {
  tenant_id: string;
  item_id: string;
  recipe_version: number;
  attempts: number;
  lease_token: string;
  lease_expires_at: string;
  source_etag: string | null;
  storage_key: string;
  content_type: string;
}

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000] as const;
const MAX_ERROR_CODE_LENGTH = 128;

const boundedErrorCode = (errorCode: string): string => errorCode.slice(0, MAX_ERROR_CODE_LENGTH);
const iso = (value: Date): string => value.toISOString();

export const enqueueThumbnailJob = async (
  sql: Sql | TransactionSql,
  input: {
    readonly tenantId: string;
    readonly itemId: string;
    readonly sourceEtag: string | null;
    readonly recipeVersion?: number;
    readonly now?: Date;
  },
): Promise<void> => {
  const now = iso(input.now ?? new Date());
  await sql`
    insert into thumbnail_jobs (
      tenant_id, item_id, recipe_version, state, attempts, next_attempt_at, source_etag,
      created_at, updated_at
    ) values (
      ${input.tenantId}, ${input.itemId}, ${input.recipeVersion ?? THUMBNAIL_RECIPE_VERSION},
      'pending', 0, ${now}, ${input.sourceEtag}, ${now}, ${now}
    )
    on conflict (tenant_id, item_id) do update set
      recipe_version = excluded.recipe_version,
      state = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at,
      lease_token = null, lease_expires_at = null, source_etag = excluded.source_etag,
      output_key = null, output_content_type = null, output_size = null,
      output_width = null, output_height = null, error_code = null,
      updated_at = excluded.updated_at, completed_at = null
  `;
};

export const makeThumbnailJobStore = (sql: Sql) => ({
  hasRunnableJobs: async (now = new Date()): Promise<boolean> => {
    const rows = await sql<{ exists: boolean }[]>`
      select exists(
        select 1 from thumbnail_jobs
        where state = 'pending' and next_attempt_at <= ${iso(now)}
      ) as exists
    `;
    return rows[0]?.exists ?? false;
  },

  claimNext: async (
    options: { readonly leaseMs?: number; readonly now?: Date } = {},
  ): Promise<ClaimedThumbnailJob | null> => {
    const now = options.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + (options.leaseMs ?? 60_000));
    const leaseToken = randomUUID();
    const rows = await sql<ClaimedRow[]>`
      with candidate as (
        select tenant_id, item_id
        from thumbnail_jobs
        where state = 'pending' and next_attempt_at <= ${iso(now)}
        order by next_attempt_at, created_at, tenant_id, item_id
        for update skip locked
        limit 1
      )
      update thumbnail_jobs as job set
        state = 'processing', attempts = job.attempts + 1,
        lease_token = ${leaseToken}, lease_expires_at = ${iso(leaseExpiresAt)},
        updated_at = ${iso(now)}
      from candidate, items
      where job.tenant_id = candidate.tenant_id and job.item_id = candidate.item_id
        and items.tenant_id = job.tenant_id and items.id = job.item_id
      returning job.tenant_id, job.item_id, job.recipe_version, job.attempts,
        job.lease_token, job.lease_expires_at, job.source_etag,
        items.storage_key, items.content_type
    `;
    const row = rows[0];
    return row
      ? {
          tenantId: row.tenant_id,
          itemId: row.item_id,
          recipeVersion: row.recipe_version,
          attempts: row.attempts,
          leaseToken: row.lease_token,
          leaseExpiresAt: row.lease_expires_at,
          sourceEtag: row.source_etag,
          storageKey: row.storage_key,
          contentType: row.content_type,
        }
      : null;
  },

  markReady: async (
    tenantId: string,
    itemId: string,
    leaseToken: string,
    output: ReadyThumbnailOutput,
    now = new Date(),
  ): Promise<boolean> => {
    const rows = await sql<{ item_id: string }[]>`
      update thumbnail_jobs set
        state = 'ready', output_key = ${output.key}, output_content_type = ${output.contentType},
        output_size = ${output.size}, output_width = ${output.width}, output_height = ${output.height},
        lease_token = null, lease_expires_at = null, error_code = null,
        updated_at = ${iso(now)}, completed_at = ${iso(now)}
      where tenant_id = ${tenantId} and item_id = ${itemId}
        and state = 'processing' and lease_token = ${leaseToken}
      returning item_id
    `;
    return rows.length === 1;
  },

  markRetry: async (
    tenantId: string,
    itemId: string,
    leaseToken: string,
    errorCode: string,
    now = new Date(),
  ): Promise<ThumbnailRetryResult | null> => {
    return sql.begin(async (transaction) => {
      const jobs = await transaction<{ attempts: number }[]>`
        select attempts from thumbnail_jobs
        where tenant_id = ${tenantId} and item_id = ${itemId}
          and state = 'processing' and lease_token = ${leaseToken}
        for update
      `;
      const job = jobs[0];
      if (!job) return null;
      const delay = RETRY_DELAYS_MS[job.attempts - 1];
      const state = delay === undefined ? "failed" : "pending";
      const nextAttemptAt = delay === undefined ? null : iso(new Date(now.getTime() + delay));
      await transaction`
        update thumbnail_jobs set state = ${state}, next_attempt_at = ${nextAttemptAt ?? iso(now)},
          lease_token = null, lease_expires_at = null, error_code = ${boundedErrorCode(errorCode)},
          updated_at = ${iso(now)}, completed_at = ${state === "failed" ? iso(now) : null}
        where tenant_id = ${tenantId} and item_id = ${itemId} and lease_token = ${leaseToken}
      `;
      return { state, nextAttemptAt };
    });
  },

  markFailed: async (
    tenantId: string,
    itemId: string,
    leaseToken: string,
    errorCode: string,
    now = new Date(),
  ): Promise<boolean> => {
    const rows = await sql<{ item_id: string }[]>`
      update thumbnail_jobs set state = 'failed', lease_token = null, lease_expires_at = null,
        error_code = ${boundedErrorCode(errorCode)}, updated_at = ${iso(now)}, completed_at = ${iso(now)}
      where tenant_id = ${tenantId} and item_id = ${itemId}
        and state = 'processing' and lease_token = ${leaseToken}
      returning item_id
    `;
    return rows.length === 1;
  },

  releaseExpiredLeases: async (now = new Date()): Promise<number> => {
    const rows = await sql<{ item_id: string }[]>`
      update thumbnail_jobs set state = 'pending', next_attempt_at = ${iso(now)},
        lease_token = null, lease_expires_at = null, updated_at = ${iso(now)}
      where state = 'processing' and lease_expires_at <= ${iso(now)}
      returning item_id
    `;
    return rows.length;
  },

  enqueueMissing: async (
    options: { readonly recipeVersion?: number; readonly limit?: number; readonly now?: Date } = {},
  ): Promise<number> => {
    const recipeVersion = options.recipeVersion ?? THUMBNAIL_RECIPE_VERSION;
    const limit = Math.max(0, options.limit ?? 200);
    const now = iso(options.now ?? new Date());
    const rows = await sql<{ item_id: string }[]>`
      with candidates as (
        select item.tenant_id, item.id, item.etag
        from items as item
        left join thumbnail_jobs as job
          on job.tenant_id = item.tenant_id and job.item_id = item.id
        where item.status = 'ready' and item.deleted_at is null
          and trim(lower(split_part(item.content_type, ';', 1))) in ${sql(GENERATED_THUMBNAIL_CONTENT_TYPE_ALLOWLIST)}
          and (job.item_id is null or job.recipe_version < ${recipeVersion})
        order by item.created_at, item.tenant_id, item.id
        limit ${limit}
      )
      insert into thumbnail_jobs (
        tenant_id, item_id, recipe_version, state, attempts, next_attempt_at, source_etag,
        created_at, updated_at
      )
      select tenant_id, id, ${recipeVersion}, 'pending', 0, ${now}, etag, ${now}, ${now}
      from candidates
      on conflict (tenant_id, item_id) do update set
        recipe_version = excluded.recipe_version, state = 'pending', attempts = 0,
        next_attempt_at = excluded.next_attempt_at, lease_token = null, lease_expires_at = null,
        source_etag = excluded.source_etag, output_key = null, output_content_type = null,
        output_size = null, output_width = null, output_height = null, error_code = null,
        updated_at = excluded.updated_at, completed_at = null
      returning item_id
    `;
    return rows.length;
  },
});

export type ThumbnailJobStore = ReturnType<typeof makeThumbnailJobStore>;
