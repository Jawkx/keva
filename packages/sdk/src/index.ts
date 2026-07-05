import {
  ItemPatch,
  BatchDelete,
  BatchDeleteResult,
  CreateShareGrant,
  CreateShareGrantResult,
  DownloadResult,
  InitiateUpload,
  InitiateUploadResult,
  KevaError,
  KevaItem,
  PropertyKeysResult,
  PropertyValuesResult,
  Query,
  QueryResult,
  ShareGrantRecord,
  ShareSelf,
  SharedInitiateUploadResult,
  SharedItem,
  SharedQueryResult,
  UsageResult,
  type PropertyScalar as PropertyScalarType,
  type ItemPatch as ItemPatchType,
  type BatchDeleteResult as BatchDeleteResultType,
  type CreateShareGrant as CreateShareGrantType,
  type CreateShareGrantResult as CreateShareGrantResultType,
  type DownloadResult as DownloadResultType,
  type InitiateUpload as InitiateUploadType,
  type KevaError as KevaErrorType,
  type KevaItem as KevaItemType,
  type Query as QueryType,
  type QueryResult as QueryResultType,
  type ShareGrantRecord as ShareGrantRecordType,
  type ShareSelf as ShareSelfType,
  type SharedItem as SharedItemType,
  type SharedQueryResult as SharedQueryResultType,
  type UsageResult as UsageResultType,
} from "@keva/schema";
import { Schema } from "effect";

export type {
  ItemPatchType as ItemPatch,
  BatchDeleteResultType as BatchDeleteResult,
  CreateShareGrantType as CreateShareGrant,
  CreateShareGrantResultType as CreateShareGrantResult,
  InitiateUploadType as InitiateUpload,
  KevaErrorType as KevaError,
  KevaItemType as KevaItem,
  QueryType as Query,
  QueryResultType as QueryResult,
  DownloadResultType as DownloadResult,
  PropertyScalarType as PropertyScalar,
  ShareGrantRecordType as ShareGrantRecord,
  ShareSelfType as ShareSelf,
  SharedItemType as SharedItem,
  SharedQueryResultType as SharedQueryResult,
  UsageResultType as UsageResult,
};

// Share links carry a `keva_sh_` bearer token (vs. `keva_sk_` API tokens). The
// web app uses this to validate a `/s/:token` route param before any network
// call.
export const SHARE_TOKEN_PREFIX = "keva_sh_";
export const isShareToken = (token: string): boolean => token.startsWith(SHARE_TOKEN_PREFIX);

export type UploadBody = BodyInit;

/**
 * Two ways to authenticate, one client:
 * - `token`: a `keva_sk_…` Bearer token (machines, agents, the CLI/SDK).
 * - session cookie: omit `token` and the client sends the browser's cookies
 *   (`credentials: "include"`), so the web app reuses the logged-in session.
 *
 * Provide one or the other. If `token` is set it takes precedence; otherwise
 * the client falls back to cookie-based session auth.
 */
export interface KevaClientOptions {
  readonly baseUrl: string;
  readonly token?: string;
  /**
   * Fetch credentials mode for keva API calls. Defaults to `"include"` when no
   * `token` is given (browser session), otherwise `"same-origin"`.
   */
  readonly credentials?: RequestCredentials;
  readonly fetch?: typeof globalThis.fetch;
}

export class KevaProtocolError extends Error {
  readonly _tag = "KevaProtocolError";
}

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A =>
  Schema.decodeUnknownSync(schema)(value);

interface RequestConfig {
  readonly baseUrl: string;
  readonly token: string | undefined;
  readonly credentials: RequestCredentials;
  readonly fetch: typeof globalThis.fetch;
}

// Shared request/decode pipeline for both the owner (`KevaClient`) and share
// (`ShareClient`) clients: attach bearer/cookie auth, decode a typed KevaError
// on a non-2xx, otherwise decode the success schema.
const httpRequest = async <A, I>(
  config: RequestConfig,
  method: string,
  path: string,
  schema: Schema.Schema<A, I>,
  body?: unknown,
): Promise<A> => {
  const response = await config.fetch(`${config.baseUrl}${path}`, {
    method,
    credentials: config.credentials,
    headers: {
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    try {
      throw decode(KevaError, payload);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "_tag" in error &&
        error._tag !== "ParseError"
      )
        throw error;
      throw new KevaProtocolError(`Server returned ${response.status} with an invalid error body`);
    }
  }
  try {
    return decode(schema, payload);
  } catch {
    throw new KevaProtocolError(
      `Server returned ${response.status} with an invalid response body`,
    );
  }
};

export class KevaClient {
  readonly #baseUrl: string;
  readonly #token: string | undefined;
  readonly #credentials: RequestCredentials;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: KevaClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#token = options.token;
    this.#credentials = options.credentials ?? (options.token ? "same-origin" : "include");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  #request<A, I>(
    method: string,
    path: string,
    schema: Schema.Schema<A, I>,
    body?: unknown,
  ): Promise<A> {
    return httpRequest(
      {
        baseUrl: this.#baseUrl,
        token: this.#token,
        credentials: this.#credentials,
        fetch: this.#fetch,
      },
      method,
      path,
      schema,
      body,
    );
  }

  async initiate(input: InitiateUploadType) {
    const body = decode(InitiateUpload, input);
    return this.#request("POST", "/items", InitiateUploadResult, body);
  }

  async uploadBody(input: InitiateUploadType, body: UploadBody): Promise<KevaItemType> {
    const initiated = await this.initiate(input);
    const response = await this.#fetch(initiated.uploadUrl, {
      method: "PUT",
      headers: initiated.headers,
      body,
    });
    if (!response.ok) {
      throw new KevaProtocolError(`Blob upload failed with ${response.status}`);
    }
    return this.confirm(initiated.item.id);
  }

  uploadFile(
    file: File,
    options: {
      readonly properties?: InitiateUploadType["properties"];
      readonly source?: string;
    } = {},
  ): Promise<KevaItemType> {
    return this.uploadBody(
      {
        name: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        source: options.source ?? "upload",
        properties: options.properties ?? {},
      },
      file,
    );
  }

  upload(input: InitiateUploadType, body: UploadBody): Promise<KevaItemType> {
    return this.uploadBody(input, body);
  }

  confirm(id: string): Promise<KevaItemType> {
    return this.#request("POST", `/items/${encodeURIComponent(id)}/confirm`, KevaItem);
  }

  get(id: string): Promise<KevaItemType> {
    return this.#request("GET", `/items/${encodeURIComponent(id)}`, KevaItem);
  }

  getDownloadUrl(id: string): Promise<DownloadResultType> {
    return this.#request("GET", `/items/${encodeURIComponent(id)}/content`, DownloadResult);
  }

  async downloadResponse(id: string): Promise<Response> {
    const target = await this.getDownloadUrl(id);
    const response = await this.#fetch(target.url);
    if (!response.ok) {
      throw new KevaProtocolError(`Blob download failed with ${response.status}`);
    }
    return response;
  }

  async downloadBytes(id: string): Promise<Uint8Array> {
    const response = await this.downloadResponse(id);
    return new Uint8Array(await response.arrayBuffer());
  }

  download(id: string): Promise<Uint8Array> {
    return this.downloadBytes(id);
  }

  patch(id: string, patch: ItemPatchType): Promise<KevaItemType> {
    return this.#request(
      "PATCH",
      `/items/${encodeURIComponent(id)}`,
      KevaItem,
      decode(ItemPatch, patch),
    );
  }

  query(
    query: QueryType = { where: [], limit: 100, order: "created_at_asc" },
  ): Promise<QueryResultType> {
    return this.#request("POST", "/query", QueryResult, decode(Query, query));
  }

  // Storage usage: totals + per-content-type breakdown for the tenant.
  usage(): Promise<UsageResultType> {
    return this.#request("GET", "/usage", UsageResult);
  }

  // Distinct property keys across the tenant, for key autocomplete.
  async propertyKeys(): Promise<string[]> {
    const { keys } = await this.#request("GET", "/properties/keys", PropertyKeysResult);
    return [...keys];
  }

  // Distinct scalar values seen for one property key, for value autocomplete.
  async propertyValues(key: string): Promise<PropertyScalarType[]> {
    const { values } = await this.#request(
      "GET",
      `/properties/values?key=${encodeURIComponent(key)}`,
      PropertyValuesResult,
    );
    return [...values];
  }

  async delete(id: string): Promise<void> {
    await this.#request(
      "DELETE",
      `/items/${encodeURIComponent(id)}`,
      Schema.Struct({ ok: Schema.Boolean }),
    );
  }

  deleteMany(ids: readonly string[]): Promise<BatchDeleteResultType> {
    return this.#request("POST", "/items/delete", BatchDeleteResult, decode(BatchDelete, { ids }));
  }

  // ── Share grants (owner session) ────────────────────────────────────────

  // Mint a share link. The plaintext token in the result is shown once.
  createShare(input: CreateShareGrantType): Promise<CreateShareGrantResultType> {
    return this.#request("POST", "/shares", CreateShareGrantResult, decode(CreateShareGrant, input));
  }

  async listShares(): Promise<ShareGrantRecordType[]> {
    const records = await this.#request("GET", "/shares", Schema.Array(ShareGrantRecord));
    return [...records];
  }

  async revokeShare(id: string): Promise<{ revoked: boolean }> {
    return this.#request(
      "DELETE",
      `/shares/${encodeURIComponent(id)}`,
      Schema.Struct({ revoked: Schema.Boolean }),
    );
  }
}

export interface ShareClientOptions {
  readonly baseUrl: string;
  readonly shareToken: string;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Client for a public share link (`keva_sh_…`). Item responses are redacted to
 * `SharedItem` (no tenant-internal storage fields), so this is a separate type
 * from `KevaClient` rather than a mode of it. Only the operations a share
 * visitor may perform are exposed — no patch/delete/usage/property autocomplete.
 */
export class ShareClient {
  readonly #config: RequestConfig;

  constructor(options: ShareClientOptions) {
    this.#config = {
      baseUrl: options.baseUrl.replace(/\/$/, ""),
      token: options.shareToken,
      credentials: "same-origin",
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    };
  }

  #request<A, I>(
    method: string,
    path: string,
    schema: Schema.Schema<A, I>,
    body?: unknown,
  ): Promise<A> {
    return httpRequest(this.#config, method, path, schema, body);
  }

  self(): Promise<ShareSelfType> {
    return this.#request("GET", "/shares/self", ShareSelf);
  }

  query(
    query: QueryType = { where: [], limit: 100, order: "created_at_desc" },
  ): Promise<SharedQueryResultType> {
    return this.#request("POST", "/query", SharedQueryResult, decode(Query, query));
  }

  get(id: string): Promise<SharedItemType> {
    return this.#request("GET", `/items/${encodeURIComponent(id)}`, SharedItem);
  }

  getDownloadUrl(id: string): Promise<DownloadResultType> {
    return this.#request("GET", `/items/${encodeURIComponent(id)}/content`, DownloadResult);
  }

  confirm(id: string): Promise<SharedItemType> {
    return this.#request("POST", `/items/${encodeURIComponent(id)}/confirm`, SharedItem);
  }

  // Upload into the share. Name/size/type only — the server force-applies the
  // grant's property stamp and rejects any caller-supplied properties/source.
  async uploadFile(file: File): Promise<SharedItemType> {
    const initiated = await this.#request(
      "POST",
      "/items",
      SharedInitiateUploadResult,
      decode(InitiateUpload, {
        name: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      }),
    );
    const response = await this.#config.fetch(initiated.uploadUrl, {
      method: "PUT",
      headers: initiated.headers,
      body: file,
    });
    if (!response.ok) {
      throw new KevaProtocolError(`Blob upload failed with ${response.status}`);
    }
    return this.confirm(initiated.item.id);
  }
}

export const shareClient = (baseUrl: string, shareToken: string): ShareClient =>
  new ShareClient({ baseUrl, shareToken });
