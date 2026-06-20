# keva — Build Plan

> Storage that you and your agent can use. See [`../VISION.md`](../VISION.md).

This directory is the technical plan for keva: architecture, data model, auth,
API, and a phased roadmap. The repo is currently empty (only markdown) — this is
a greenfield build onto the decisions recorded here.

## How the plan is organized

| Doc | Covers |
|---|---|
| [`architecture.md`](./architecture.md) | Stack decisions, the layered architecture, monorepo layout, rejected alternatives. |
| [`data-model.md`](./data-model.md) | The object/attribute model: the system-vs-attributes split, the captured/derived/enriched tiers, and the exact attribute & query semantics. |
| [`auth.md`](./auth.md) | Authentication, authorization, tenancy. Better Auth sessions for people, opaque tokens for machines, one `Principal`. |
| [`api.md`](./api.md) | The HTTP surface, the upload/download flows, and the typed error contract. |
| [`lifecycle.md`](./lifecycle.md) | The object state machine (`pending`/`ready`/`deleting`): immutable-final-key uploads, idempotent confirm, two-phase delete, and the reaper/sweeper. |
| [`roadmap.md`](./roadmap.md) | Phased delivery, guardrails, and open questions. |

## What keva is

keva is a **metadata-rich, S3-backed object store** with a clean API and an MCP
endpoint. A file is not a blob buried in a folder tree — it is an **object with
open-ended key-value attributes** that anything can read, write, and query by.
Some of that meaning is captured automatically (type, size, source); most of it
is defined by you or by the agents working on your behalf.

Two surfaces, one core: a **web app** where a person logs in and manages their
files, and a **programmable API/MCP** that developers and agents build on. The
graphical app and the agent are two clients of the same core — that is the whole
design, not a feature bolted on.

## The architectural through-line

**The asset is the core.** `@keva/core` holds all the rules — the object model,
tenancy, validation, the storage and metadata contracts. Everything else (the
HTTP edge, the web app, the MCP server, the SDK, the choice of storage backend
or database host or runtime) is a swappable client or adapter around that core.
This is why nearly every decision in this plan is low-regret: changing the edge
framework, the blob backend, or the deploy target never touches the core.

## Bring Your Own Agent (a hard architecture constraint)

keva does **not** run inference, enrichment, or hosted agents. It is the
*substrate* agents plug into. An agent connects over the API/MCP, computes
embeddings/tags/captions itself, and **writes them back as attributes**; keva
stores, indexes, and serves. This keeps keva free of model/compute concerns —
the metadata and (later) vector index are infrastructure, not inference. It also
draws a clean line in the data model (see [`data-model.md`](./data-model.md)):
keva derives only what it can know *without opening the file*; everything that
requires understanding the bytes is enriched by the agent.

## Technical non-goals (for now)

- Running agents / model inference / enrichment (BYOA).
- Multipart upload (>5 GB files); multi-region.
- Real-time collaboration / sharing between users.
- Deep deploy automation — deployment is the operator's responsibility; the
  architecture targets Cloudflare Workers or a plain Node host (see
  [`architecture.md`](./architecture.md)).
