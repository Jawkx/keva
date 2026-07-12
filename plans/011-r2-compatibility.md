# Plan 011 R2 compatibility decision

Cloudflare R2 supports presigned `PUT` URLs but not presigned `POST` form
policies, so its direct-browser path has no documented `content-length-range`
equivalent. The documented presigned-URL restriction is `Content-Type`; R2's
browser guidance requires CORS for the headers a client explicitly sends.

The direct `PUT` therefore is not treated as an exact pre-storage size boundary.
The API now uses a same-origin, authenticated, bounded streaming upload endpoint
that aborts and removes the staged object on overflow, while retaining
confirm-time `HEAD` validation and lifecycle cleanup. Real-R2 validation is
accepted by the owner for this plan.

The local Cloudflare OAuth session can list the `keva-staging` bucket, but it
cannot read the S3 API secret. The deployed staging Worker does not yet contain
this worktree's proxy implementation, so this acceptance substitutes for the
otherwise-required provider probe.

Sources: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[R2 upload objects](https://developers.cloudflare.com/r2/objects/upload-objects/), and
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).
