# Plan 019 EXPLAIN evidence

Measured locally on PostgreSQL 14.15 with 50,000 ready items for one tenant,
each containing three scalar properties, including 50,000 distinct `category`
values. The SQL used `EXPLAIN (ANALYZE, BUFFERS, SUMMARY)`.

| Query | Result for `category` | Execution evidence |
| --- | ---: | --- |
| Previous aggregate | 50,000 values, 738,894-byte JSON payload | 240.623 ms; aggregate sorted all 150,000 key/value rows |
| Bounded aggregate | 100 values, 1,482-byte JSON payload | JSON aggregation is filtered to rank <= 100; returned payload is bounded |

For the global lifecycle predicate `status = 'pending' AND created_at < now()`
ordered by `created_at`, sparse pending data used `items_status_created_idx`:
`Index Scan`, 3 buffer accesses, and 0.028 ms for `LIMIT 100`. Without the
index, the same query performed a sequential scan of 50,001 rows and took
7.464 ms. A deliberately 50%-pending seed selected a sequential scan, which
is the correct planner choice and not an index regression.
