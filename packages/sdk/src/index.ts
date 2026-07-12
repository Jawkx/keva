import {
  ItemPatch,
  BatchDelete,
  BatchDeleteResult,
  CreateShareGrant,
  CreateShareGrantResult,
  CreateView,
  DownloadResult,
  InitiateUpload,
  OwnerInitiateUploadResult,
  ItemEventsResult,
  KevaError,
  OwnerItem,
  PropertyKeysResult,
  PropertySummaryResult,
  PropertyValuesResult,
  Query,
  OwnerQueryResult,
  ShareGrantRecord,
  ShareSelf,
  SharedInitiateUploadResult,
  SharedItem,
  SharedQueryResult,
  UpdateView,
  UsageResult,
  ViewRecord,
  type PropertyKind as PropertyKindType,
  type PropertyScalar as PropertyScalarType,
  type PropertySummary as PropertySummaryType,
  type ItemPatch as ItemPatchType,
  type BatchDeleteResult as BatchDeleteResultType,
  type CreateShareGrant as CreateShareGrantType,
  type CreateShareGrantResult as CreateShareGrantResultType,
  type CreateView as CreateViewType,
  type DownloadResult as DownloadResultType,
  type InitiateUpload as InitiateUploadType,
  type OwnerInitiateUploadResult as InitiateUploadResultType,
  type ItemEvent as ItemEventType,
  type ItemEventsResult as ItemEventsResultType,
  type KevaError as KevaErrorType,
  type OwnerItem as KevaItemType,
  type Query as QueryType,
  type OwnerQueryResult as QueryResultType,
  type ShareGrantRecord as ShareGrantRecordType,
  type ShareSelf as ShareSelfType,
  type SharedItem as SharedItemType,
  type SharedInitiateUploadResult as SharedInitiateUploadResultType,
  type SharedQueryResult as SharedQueryResultType,
  type UpdateView as UpdateViewType,
  type UsageResult as UsageResultType,
  type ViewRecord as ViewRecordType,
} from "@keva/schema";
import { Schema } from "effect";

export type {
  ItemPatchType as ItemPatch,
  BatchDeleteResultType as BatchDeleteResult,
  CreateShareGrantType as CreateShareGrant,
  CreateShareGrantResultType as CreateShareGrantResult,
  CreateViewType as CreateView,
  UpdateViewType as UpdateView,
  ViewRecordType as ViewRecord,
  InitiateUploadType as InitiateUpload,
  ItemEventType as ItemEvent,
  ItemEventsResultType as ItemEventsResult,
  KevaErrorType as KevaError,
  KevaItemType as KevaItem,
  QueryType as Query,
  QueryResultType as QueryResult,
  DownloadResultType as DownloadResult,
  PropertyKindType as PropertyKind,
  PropertyScalarType as PropertyScalar,
  PropertySummaryType as PropertySummary,
  ShareGrantRecordType as ShareGrantRecord,
  ShareSelfType as ShareSelf,
  SharedItemType as SharedItem,
  SharedQueryResultType as SharedQueryResult,
  UsageResultType as UsageResult,
};

export const SHARE_TOKEN_PREFIX = "keva_sh_";
export const isShareToken = (token: string): boolean => token.startsWith(SHARE_TOKEN_PREFIX);

export type UploadBody = BodyInit;

type InitiatedUpload = {
  readonly uploadUrl: string;
  readonly expiresAt: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly item: { readonly id: string };
};

export interface UploadSession<I extends InitiatedUpload = InitiatedUpload> {
  readonly initiated: I;
}

export type ItemUploadSession = UploadSession<InitiateUploadResultType>;
export type ShareUploadSession = UploadSession<SharedInitiateUploadResultType>;

export const isUploadSessionExpired = (session: UploadSession, at = Date.now()): boolean => {
  const expiresAt = Date.parse(session.initiated.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= at;
};

export interface KevaClientOptions {
  readonly baseUrl: string;
  readonly token?: string;
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
    throw new KevaProtocolError(`Server returned ${response.status} with an invalid response body`);
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
    return this.#request("POST", "/items", OwnerInitiateUploadResult, body);
  }

  async startUpload(input: InitiateUploadType): Promise<ItemUploadSession> {
    return { initiated: await this.initiate(input) };
  }

  async putUpload(session: ItemUploadSession, body: UploadBody): Promise<void> {
    // The upload URL is presigned; its authorization travels in the query
    // string. Do not attach the Keva bearer token or credentials — that would
    // leak the token to the storage origin and break real S3/R2 uploads.
    const response = await this.#fetch(session.initiated.uploadUrl, {
      method: "PUT",
      headers: session.initiated.headers,
      body,
    });
    if (!response.ok) {
      throw new KevaProtocolError(`Blob upload failed with ${response.status}`);
    }
  }

  completeUpload(session: ItemUploadSession): Promise<KevaItemType> {
    return this.confirm(session.initiated.item.id);
  }

  async uploadBody(input: InitiateUploadType, body: UploadBody): Promise<KevaItemType> {
    const session = await this.startUpload(input);
    await this.putUpload(session, body);
    return this.completeUpload(session);
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
    return this.#request("POST", `/items/${encodeURIComponent(id)}/confirm`, OwnerItem);
  }

  get(id: string): Promise<KevaItemType> {
    return this.#request("GET", `/items/${encodeURIComponent(id)}`, OwnerItem);
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
      OwnerItem,
      decode(ItemPatch, patch),
    );
  }

  /** Per-item history, newest-first. Events outlive deleted items. */
  events(
    id: string,
    options: { readonly limit?: number; readonly cursor?: string } = {},
  ): Promise<ItemEventsResultType> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    const query = params.size > 0 ? `?${params}` : "";
    return this.#request(
      "GET",
      `/items/${encodeURIComponent(id)}/events${query}`,
      ItemEventsResult,
    );
  }

  query(
    query: QueryType = { where: [], limit: 100, order: "created_at_asc" },
  ): Promise<QueryResultType> {
    return this.#request("POST", "/query", OwnerQueryResult, decode(Query, query));
  }

  usage(): Promise<UsageResultType> {
    return this.#request("GET", "/usage", UsageResult);
  }

  async propertyKeys(): Promise<string[]> {
    const { keys } = await this.#request("GET", "/properties/keys", PropertyKeysResult);
    return [...keys];
  }

  async propertyValues(key: string): Promise<PropertyScalarType[]> {
    const { values } = await this.#request(
      "GET",
      `/properties/values?key=${encodeURIComponent(key)}`,
      PropertyValuesResult,
    );
    return [...values];
  }

  async propertySummary(): Promise<PropertySummaryType[]> {
    const { entries } = await this.#request("GET", "/properties/summary", PropertySummaryResult);
    return [...entries];
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

  createShare(input: CreateShareGrantType): Promise<CreateShareGrantResultType> {
    return this.#request(
      "POST",
      "/shares",
      CreateShareGrantResult,
      decode(CreateShareGrant, input),
    );
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

  createView(input: CreateViewType): Promise<ViewRecordType> {
    return this.#request("POST", "/views", ViewRecord, decode(CreateView, input));
  }

  async listViews(): Promise<ViewRecordType[]> {
    const records = await this.#request("GET", "/views", Schema.Array(ViewRecord));
    return [...records];
  }

  getView(id: string): Promise<ViewRecordType> {
    return this.#request("GET", `/views/${encodeURIComponent(id)}`, ViewRecord);
  }

  updateView(id: string, input: UpdateViewType): Promise<ViewRecordType> {
    return this.#request(
      "PATCH",
      `/views/${encodeURIComponent(id)}`,
      ViewRecord,
      decode(UpdateView, input),
    );
  }

  async deleteView(id: string): Promise<{ deleted: boolean }> {
    return this.#request(
      "DELETE",
      `/views/${encodeURIComponent(id)}`,
      Schema.Struct({ deleted: Schema.Boolean }),
    );
  }
}

export interface ShareClientOptions {
  readonly baseUrl: string;
  readonly shareToken: string;
  readonly fetch?: typeof globalThis.fetch;
}

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

  async downloadResponse(id: string): Promise<Response> {
    const target = await this.getDownloadUrl(id);
    const response = await this.#config.fetch(target.url);
    if (!response.ok) {
      throw new KevaProtocolError(`Blob download failed with ${response.status}`);
    }
    return response;
  }

  async downloadBytes(id: string): Promise<Uint8Array> {
    const response = await this.downloadResponse(id);
    return new Uint8Array(await response.arrayBuffer());
  }

  confirm(id: string): Promise<SharedItemType> {
    return this.#request("POST", `/items/${encodeURIComponent(id)}/confirm`, SharedItem);
  }

  async startUpload(file: File): Promise<ShareUploadSession> {
    return {
      initiated: await this.#request(
        "POST",
        "/items",
        SharedInitiateUploadResult,
        decode(InitiateUpload, {
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      ),
    };
  }

  async putUpload(session: ShareUploadSession, body: UploadBody): Promise<void> {
    // Presigned URL — auth is in the query string. Never attach the share
    // secret here; it would leak the secret to the storage origin.
    const response = await this.#config.fetch(session.initiated.uploadUrl, {
      method: "PUT",
      headers: session.initiated.headers,
      body,
    });
    if (!response.ok) {
      throw new KevaProtocolError(`Blob upload failed with ${response.status}`);
    }
  }

  completeUpload(session: ShareUploadSession): Promise<SharedItemType> {
    return this.confirm(session.initiated.item.id);
  }

  // Upload into the share. Name/size/type only — the server force-applies the
  // grant's property stamp and rejects any caller-supplied properties/source.
  async uploadFile(file: File): Promise<SharedItemType> {
    const session = await this.startUpload(file);
    await this.putUpload(session, file);
    return this.completeUpload(session);
  }
}

export const shareClient = (baseUrl: string, shareToken: string): ShareClient =>
  new ShareClient({ baseUrl, shareToken });
