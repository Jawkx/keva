import { DEFAULT_STORAGE_QUOTA_BYTES } from "@keva/core";
import type { Sql } from "postgres";

export interface AdminUserUsage {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly tenantId: string | null;
  readonly usedBytes: number;
  readonly quotaBytes: number | null;
  readonly quotaSource: "default" | "custom" | "unlimited";
}

export interface AdminStore {
  readonly listUsers: (search: string) => Promise<ReadonlyArray<AdminUserUsage>>;
  readonly setQuota: (userId: string, quotaBytes: number | null) => Promise<AdminUserUsage | null>;
}

interface AdminUserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly tenant_id: string | null;
  readonly used_bytes: string | null;
  readonly quota_bytes: string | null;
  readonly has_usage: boolean;
}

const mapUser = (row: AdminUserRow): AdminUserUsage => {
  const quotaBytes = row.has_usage
    ? row.quota_bytes === null
      ? null
      : Number(row.quota_bytes)
    : DEFAULT_STORAGE_QUOTA_BYTES;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    tenantId: row.tenant_id,
    usedBytes: Number(row.used_bytes ?? 0),
    quotaBytes,
    quotaSource: !row.has_usage
      ? "default"
      : quotaBytes === null
        ? "unlimited"
        : quotaBytes === DEFAULT_STORAGE_QUOTA_BYTES
          ? "default"
          : "custom",
  };
};

const userQuery = (sql: Sql, predicate: ReturnType<Sql>) => sql<AdminUserRow[]>`
  select u.id, u.name, u.email, membership.organization_id as tenant_id,
         usage.used_bytes, usage.quota_bytes,
         (usage.tenant_id is not null) as has_usage
  from "user" u
  left join lateral (
    select m.organization_id
    from member m
    where m.user_id = u.id
    order by m.created_at asc
    limit 1
  ) membership on true
  left join tenant_usage usage on usage.tenant_id = membership.organization_id
  where ${predicate}
  order by u.created_at desc
  limit 100
`;

export const makeAdminStore = (sql: Sql): AdminStore => ({
  listUsers: async (search) => {
    const term = search.trim();
    const pattern = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const rows = await userQuery(
      sql,
      term
        ? sql`(u.name ilike ${pattern} escape '\\' or u.email ilike ${pattern} escape '\\')`
        : sql`true`,
    );
    return rows.map(mapUser);
  },
  setQuota: async (userId, quotaBytes) => {
    const memberships = await sql<{ organization_id: string }[]>`
      select organization_id from member
      where user_id = ${userId}
      order by created_at asc
      limit 1
    `;
    const tenantId = memberships[0]?.organization_id;
    if (!tenantId) return null;
    await sql`
      insert into tenant_usage (tenant_id, used_bytes, quota_bytes)
      values (
        ${tenantId},
        (
          select coalesce(sum(coalesce(size, declared_size)), 0)::bigint
          from items
          where tenant_id = ${tenantId} and status in ('pending', 'ready')
        ),
        ${quotaBytes}
      )
      on conflict (tenant_id) do update set quota_bytes = excluded.quota_bytes
    `;
    const rows = await userQuery(sql, sql`u.id = ${userId}`);
    return rows[0] ? mapUser(rows[0]) : null;
  },
});
