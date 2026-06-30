# Data model

The data model is where the vision becomes concrete: a file is an item with
open-ended, structured meaning. This document defines exactly how that meaning
is stored, what can be expressed, and what can be queried — tightly enough to
implement against, because loose property semantics turn into an unqueryable
mess later.

## Two stores, one record

Every item's metadata splits into two physically different shapes inside one
Postgres row:

```sql
items (
  id           uuid primary key,
  tenant_id    text not null,             -- isolation; see auth.md
  name         text not null,             -- human/agent label, not a path
  -- system properties: typed, keva-owned, finite → real columns ─────────────
  content_type text not null,
  size         bigint,                     -- null until confirmed
  etag         text,
  checksum     text,
  source       text not null,             -- 'upload' | 'integration:<x>' | 'agent:<x>'
  status       text not null,             -- 'pending' | 'ready' | 'deleting' (see lifecycle.md)
  storage_key  text not null,             -- derived final key: items/<tenant_id>/<id>
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  -- user/agent meaning: open-ended → one JSONB column ──────────────────────
  properties   jsonb not null default '{}'
)
```

Why the split:

- **System properties are real, typed columns.** They are known, finite, and
  keva owns them. Real columns get btree indexes, so "all `video/*` over 100 MB
  created this week" is an ordinary fast query.
- **User/agent properties live in one `jsonb` column.** keva can't know the keys
  ahead of time ("your schema is yours"), so they can't be columns. A **GIN
  index** (default `jsonb_ops`) accelerates equality, membership, and key-existence
  queries; ranges and substrings fall back to a scan within the tenant (see
  [Indexing strategy](#indexing-strategy)).

## The three tiers of metadata

Metadata is divided by a single question: **does producing it require opening
the file?** This line is identical to the BYOA boundary — keva can only derive
what it knows without reading the bytes.

| Tier         | Examples                                                                     | Produced by                                                | When                              |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------- |
| **Captured** | `size`, `etag`, `storage_key`, `status`, timestamps, declared `content_type` | keva, from the storage/transport layer                     | at create + the HEAD-confirm step |
| **Derived**  | `kind` (image/video/doc), file extension                                     | keva, as a **pure function of captured fields** (no bytes) | on write, or computed on read     |
| **Enriched** | dimensions, video duration, EXIF, transcript, tags, embeddings               | the **agent/client (BYOA)** → written into `properties`    | whenever the agent runs           |

**Where "type" lands:** `content_type` (MIME) is _captured_ — declared by the
client at initiate, then confirmed/overwritten from what storage actually
recorded during HEAD (so it isn't blind trust). A higher-level `kind` ("photo" /
"video" / "document") is _derived_ — a pure function `category(content_type)`,
which keva can compute itself.

**The hard boundary:** anything needing the bytes understood — dimensions,
duration, EXIF, transcripts, embeddings — keva does **not** derive. Those are
enriched properties the agent computes and writes back. If you ever want
trustworthy type detection (magic-byte sniffing rather than trusting the
declared MIME), that too is an enrichment job, not something keva does.

## Property value types

User/agent property values are intentionally JSON-shaped and **flat**:

- **Scalars:** `string`, `number`, `boolean`, `null`.
- **Homogeneous arrays of scalars:** e.g. `["bali", "diving"]` or `[1, 2, 3]`.
  All elements must share one scalar type; **mixed-type arrays are rejected at
  validation** (so `contains` and ordering stay well-defined). `null` is not a
  valid array element.
- **No nested objects, no nested arrays.** Nesting is rejected at validation.

Constraining the _value space_ (so everything is queryable and serializable)
while leaving the _key space_ fully open is the deliberate trade. `null` is a
**legal stored value** — it is not a deletion sentinel (see update semantics).

## Keys

- Non-empty, **≤ 128 chars**, case-sensitive.
- Pattern: `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` (alphanumeric start; `.` `_` `-`
  separators — dotted namespaces encouraged, e.g. `exif.iso`, `ai.caption`).
- **Reserved namespaces** (cannot be set in the `properties` bag):
  - `system.*` — reserved for keva's captured/derived fields.
  - `keva.*` — reserved for future internal use.
- Reserved query identifiers `id` and `name` map to columns, not properties.

## Limits (initial, tunable)

- ≤ **256** property keys per item.
- String value ≤ **8 KB**; array ≤ **256** elements.
- Total `properties` JSON ≤ **64 KB** per item.

These are guardrails against accidental abuse, not product limits; revisit with
real usage.

## Update semantics

Property updates are explicit, which removes the classic "does `null` mean
delete or mean null?" ambiguity:

```
PATCH /items/:id/properties
{
  "set":   { "location": "bali", "rating": 5, "tags": ["a","b"], "note": null },
  "unset": ["draft", "old_key"]
}
```

- `set` upserts keys (and may set a value to `null`).
- `unset` removes keys.
- System fields are never writable through this endpoint.

## Query model

A query is a conjunction (AND) of property conditions plus pagination:

```ts
type Query = {
  where: Array<{ key: string; op: Operator; value?: PropertyValue }>;
  limit: number; // ≤ 1000, default 100
  cursor?: string;
};
```

### Key resolution

- `name` → the `name` column.
- `system.<field>` (e.g. `system.content_type`, `system.size`) → that column.
- anything else → a path into the `properties` JSONB.

### Operator × type matrix

| Operator                    | Valid value types                                    | Semantics                                                       |
| --------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| `eq` / `neq`                | string, number, boolean, null                        | exact, **type-strict** equality (no coercion)                   |
| `gt` / `gte` / `lt` / `lte` | number, string (lexicographic), ISO-8601 date string | ordering; **rejected at validation** for boolean / null / array |
| `contains`                  | array (membership of a scalar), string (substring)   |                                                                 |
| `exists`                    | any key                                              | true if the key is present, **even if its value is `null`**     |

Rules (precise enough to implement against):

- **No type coercion.** `eq` across differing types is `false`. `"5"` ≠ `5`.
- **Missing keys.** A condition on an absent key matches **nothing** — including
  `neq`. `neq` means "key present **and** value ≠ operand", _not_ "value ≠
  operand or key missing" (SQL `NULL` semantics; the JSONB path yields no row).
  To also match absent keys, that's a separate `exists`-based condition — but
  queries are pure AND, so there is no implicit OR.
- **`contains` operand is a single member**, never an array. `{key:"tags",
op:"contains", value:"bali"}` tests array membership of the scalar `"bali"`
  (or, for a string-valued property, substring containment). Passing an array
  as the operand is a `ValidationError`.
- **Dates are strings; keva does not parse or normalize them.** Convention: store
  timestamps as **ISO-8601 UTC** (`YYYY-MM-DDTHH:mm:ssZ`), which sorts correctly
  under lexicographic string comparison — so `gt`/`lt` on such strings behave as
  date ordering. No timezone math, no date type in v0.
- **Validation vs. evaluation.** Combinations whose type is knowable from the
  literal (e.g. `gt` with a boolean operand) are rejected when the query is
  parsed (Effect Schema). Because stored values are dynamic, a type-mismatch
  against a _stored_ value evaluates to no-match rather than an error.
- `exists` distinguishes "key present with value `null`" (true) from "key
  absent" (false) — which is why `null` must be a real value, not a tombstone.

### Pagination

Opaque cursor (keyset over `created_at, id`), forward-only to start. `limit`
capped at 1000.

## Indexing strategy

Be honest about what a JSONB GIN index does and does not accelerate (see the
[PostgreSQL JSONB indexing docs](https://www.postgresql.org/docs/current/datatype-json.html#JSON-INDEXING)):

- **System columns** → btree indexes on the hot ones (`tenant_id`, `status`,
  `content_type`, `size`, `created_at`).
- **`properties` JSONB** → a **default `jsonb_ops` GIN** index (not
  `jsonb_path_ops`), because `jsonb_path_ops` supports only containment (`@>`)
  and **cannot** index key-existence (`?`). With `jsonb_ops`:
  - **Index-served:** `eq` (compiled to `properties @> '{"k":v}'`), `contains`
    membership (`properties @> '{"k":[member]}'`), and `exists` (`properties ? 'k'`).
  - **Not index-served (sequential within the tenant):** `neq`, the ordering
    operators (`gt/gte/lt/lte`), and `contains` _substring_ on strings. These
    fall back to a scan.
- **The tenant bound saves us.** Every query is `tenant_id = …` first (a btree
  index, `tenant_id`-leading composites), so even unindexed property predicates
  only scan within one tenant — acceptable at small scale.
- **Hot keys later** → add expression indexes for specific frequently-ranged
  keys, e.g. `CREATE INDEX ON items ((properties->>'rating'))`, once usage
  shows which keys need them.
- **Vectors (later)** → embeddings are enriched properties, but for ANN search
  they want a dedicated `vector` column (pgvector), not the JSONB bag.

## Scaling the query model — will dynamic properties stay queryable?

Open-ended properties have a reputation for becoming unqueryable. They don't
here, because of one structural fact and one escape hatch. The "schemaless data
is unqueryable" failure mode is about _global_ queries over hundreds of millions
of rows — which keva never does.

- **Every query is tenant-bounded.** `WHERE tenant_id = X` comes first, so the
  cost of a dynamic-property predicate is bounded by _one tenant's_ data
  (thousands to low-millions of items), never the whole table. A sequential
  scan within a tenant is an acceptable **floor** for the long tail of
  rarely-queried keys.
- **The default GIN already covers the common cases across the open keyspace** —
  equality, array membership, and key-existence are indexed for _any_ key without
  enumerating keys ahead of time. This is the bread-and-butter "query by meaning"
  path and it scales.
- **The genuinely hard operators** — ranges, sorts, and substrings on arbitrary
  keys — are made fast _on demand_, never by indexing everything (which is the
  real path to ruin: bloat, write amplification, unbounded keyspace). Escalation,
  applied only to the small, stable set of keys a workload actually needs:
  1. tenant scan (floor);
  2. an **expression index** on a hot key;
  3. **promotion to a typed, indexed property** (the escape hatch below);
  4. `pg_trgm` / `tsvector` for substring/full-text on chosen text keys;
  5. pgvector for semantic search.

**The escape hatch (opt-in indexed/typed properties).** A user or agent may
_optionally declare_ a specific key as typed + indexed (e.g. "`rating` is a
number, index it"; "`caption` is full-text searchable"). When declared, keva
maintains an expression index (or promoted column) for it. This keeps "your
schema is yours" as the open-ended default while making the handful of keys that
need ranges/sorts first-class — and it **bounds index growth** to _declared_
keys, not the whole keyspace. 95% of properties stay flexible and
equality/membership/existence-queryable; the 5% that need more are promoted by
the user who cares.

**The only thing that stays genuinely impossible** — fast arbitrary range/sort/
substring over _every_ property _globally_ — is something keva never needs to
do. (See [Deferred](#deferred): typed property definitions are the described
form of this escape hatch.)

## Deferred

- **Provenance** — "who set this property, and when" (user vs. agent X). The
  vision has agents writing metadata, so this likely matters eventually; for now
  values are plain. Adding provenance is an enrichment of the property model,
  not a v0 concern.
- **Schema-per-tenant / typed property definitions** — optional user-declared
  types + indexes for specific keys; the escape hatch described under
  [Scaling the query model](#scaling-the-query-model--will-dynamic-properties-stay-queryable).
  Open-ended bag first.
