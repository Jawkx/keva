import { afterAll, describe, expect, it } from "vitest";
import { makeThumbnailJobStore, enqueueThumbnailJob } from "./postgres/thumbnail-jobs.js";
import { testSql } from "./test/db.js";

const sql = testSql(4);
const jobs = makeThumbnailJobStore(sql);
const tenantId = "thumbnail-jobs-test";

const insertItem = async (contentType = "image/jpeg", status = "ready") => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await sql`
    insert into items (
      id, tenant_id, name, content_type, declared_size, size, etag, source, status,
      storage_key, staging_key, created_at, updated_at, properties, presentation
    ) values (
      ${id}, ${tenantId}, 'image', ${contentType}, 10, 10, 'source-etag', 'upload', ${status},
      ${`items/${tenantId}/${id}`}, ${`staging/${tenantId}/${id}`}, ${now}, ${now}, '{}', '{}'
    )
  `;
  return id;
};

afterAll(() => sql.end({ timeout: 5 }));

describe("Postgres thumbnail job store", () => {
  it("claims a runnable job only once and guards finalization by lease token", async () => {
    const itemId = await insertItem();
    await enqueueThumbnailJob(sql, { tenantId, itemId, sourceEtag: "source-etag" });

    const [first, second] = await Promise.all([jobs.claimNext(), jobs.claimNext()]);
    const claimed = first ?? second;
    expect(claimed).not.toBeNull();
    expect(first === null || second === null).toBe(true);
    expect(claimed?.attempts).toBe(1);
    expect(await jobs.markFailed(tenantId, itemId, crypto.randomUUID(), "stale")).toBe(false);
    expect(
      await jobs.markReady(tenantId, itemId, claimed!.leaseToken, {
        key: `thumbnails/${tenantId}/${itemId}/v1.webp`,
        contentType: "image/webp",
        size: 100,
        width: 64,
        height: 32,
      }),
    ).toBe(true);
  });

  it("releases expired leases for reclaiming", async () => {
    const itemId = await insertItem();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await enqueueThumbnailJob(sql, { tenantId, itemId, sourceEtag: null, now });
    const first = await jobs.claimNext({ now, leaseMs: 1_000 });

    expect(await jobs.releaseExpiredLeases(new Date(now.getTime() + 1_001))).toBe(1);
    const reclaimed = await jobs.claimNext({ now: new Date(now.getTime() + 1_002) });
    expect(reclaimed?.itemId).toBe(itemId);
    expect(reclaimed?.leaseToken).not.toBe(first?.leaseToken);
  });

  it("uses the retry schedule and rejects stale retry tokens", async () => {
    const itemId = await insertItem();
    let now = new Date("2026-01-01T00:00:00.000Z");
    await enqueueThumbnailJob(sql, { tenantId, itemId, sourceEtag: null, now });
    const expectedDelays = [60_000, 300_000, 1_800_000, 7_200_000];

    for (const delay of expectedDelays) {
      const claim = await jobs.claimNext({ now });
      expect(claim).not.toBeNull();
      expect(await jobs.markRetry(tenantId, itemId, crypto.randomUUID(), "stale", now)).toBeNull();
      const result = await jobs.markRetry(tenantId, itemId, claim!.leaseToken, "temporary", now);
      expect(result).toEqual({
        state: "pending",
        nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
      });
      now = new Date(now.getTime() + delay);
    }

    const finalClaim = await jobs.claimNext({ now });
    const result = await jobs.markRetry(tenantId, itemId, finalClaim!.leaseToken, "exhausted", now);
    expect(result).toEqual({ state: "failed", nextAttemptAt: null });
  });

  it("backfills eligible missing and outdated jobs idempotently", async () => {
    const eligible = await insertItem("image/png");
    await insertItem("image/gif");

    expect(await jobs.enqueueMissing({ recipeVersion: 1 })).toBe(1);
    expect(await jobs.enqueueMissing({ recipeVersion: 1 })).toBe(0);
    expect(await jobs.enqueueMissing({ recipeVersion: 2 })).toBe(1);
    const rows = await sql<{ item_id: string; recipe_version: number }[]>`
      select item_id, recipe_version from thumbnail_jobs
    `;
    expect(rows).toEqual([{ item_id: eligible, recipe_version: 2 }]);
  });
});
