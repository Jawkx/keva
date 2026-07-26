import {
  AccountShareRecord,
  AccountShareSelf,
  BatchPatch,
  BatchPatchResult,
  ItemPatch,
  BatchDelete,
  BatchDeleteResult,
  CreateAccountShare,
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
  PropertySuggestionsResult,
  PropertyValuesResult,
  Query,
  ReceivedShare,
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
  type AccountShareRecord as AccountShareRecordType,
  type AccountShareSelf as AccountShareSelfType,
  type CreateAccountShare as CreateAccountShareType,
  type ReceivedShare as ReceivedShareType,
  type Properties as PropertiesType,
  type PropertyScalar as PropertyScalarType,
  type PropertyValue as PropertyValueType,
  type PropertySummary as PropertySummaryType,
  type PropertySuggestion as PropertySuggestionType,
  type QueryCondition as QueryConditionType,
  type BatchPatchItem as BatchPatchItemType,
  type BatchPatchResult as BatchPatchResultType,
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
import { Cause, Effect, Exit, Option, Schema } from "effect";

export type {
  AccountShareRecordType as AccountShareRecord,
  AccountShareSelfType as AccountShareSelf,
  CreateAccountShareType as CreateAccountShare,
  ReceivedShareType as ReceivedShare,
  ItemPatchType as ItemPatch,
  BatchPatchItemType as BatchPatchItem,
  BatchPatchResultType as BatchPatchResult,
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
  PropertiesType as Properties,
  PropertyScalarType as PropertyScalar,
  PropertyValueType as PropertyValue,
  PropertySummaryType as PropertySummary,
  PropertySuggestionType as PropertySuggestion,
  QueryConditionType as QueryCondition,
  ShareGrantRecordType as ShareGrantRecord,
  ShareSelfType as ShareSelf,
  SharedItemType as SharedItem,
  SharedQueryResultType as SharedQueryResult,
  UsageResultType as UsageResult,
};

export type BatchPatchChanges = {
  readonly set?: ItemPatchType["set"];
  readonly unset?: ItemPatchType["unset"];
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

export class KevaTransportError extends Error {
  readonly _tag = "KevaTransportError";

  constructor(readonly cause: unknown) {
    super("Unable to reach the server", { cause });
  }
}

export type KevaClientError = KevaErrorType | KevaProtocolError | KevaTransportError;

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A =>
  Schema.decodeUnknownSync(schema)(value);

interface RequestConfig {
  readonly baseUrl: string;
  readonly token: string | undefined;
  readonly credentials: RequestCredentials;
  readonly fetch: typeof globalThis.fetch;
}

const fetchEffect = (
  fetch: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Effect.Effect<Response, KevaTransportError> =>
  Effect.tryPromise({
    try: (signal) => fetch(input, { ...init, signal }),
    catch: (cause) => new KevaTransportError(cause),
  });

const requireOk = (
  response: Response,
  message: string,
): Effect.Effect<Response, KevaProtocolError> =>
  response.ok ? Effect.succeed(response) : Effect.fail(new KevaProtocolError(message));

const downloadBytesFromUrlEffect = (
  fetch: typeof globalThis.fetch,
  url: string,
): Effect.Effect<Uint8Array, KevaProtocolError | KevaTransportError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new KevaProtocolError(`Blob download failed with ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    catch: (cause) => (cause instanceof KevaProtocolError ? cause : new KevaTransportError(cause)),
  });

const decodeResponse = <A, I>(
  schema: Schema.Schema<A, I>,
  value: unknown,
  message: string,
): Effect.Effect<A, KevaProtocolError> =>
  Schema.decodeUnknown(schema)(value).pipe(Effect.mapError(() => new KevaProtocolError(message)));

const httpRequestEffect = <A, I>(
  config: RequestConfig,
  method: string,
  path: string,
  schema: Schema.Schema<A, I>,
  body?: unknown,
): Effect.Effect<A, KevaClientError> =>
  Effect.gen(function* () {
    const response = yield* fetchEffect(config.fetch, `${config.baseUrl}${path}`, {
      method,
      credentials: config.credentials,
      headers: {
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload: unknown = yield* Effect.promise(() => response.json().catch(() => undefined));
    if (!response.ok) {
      const apiError = yield* decodeResponse(
        KevaError,
        payload,
        `Server returned ${response.status} with an invalid error body`,
      );
      return yield* Effect.fail(apiError);
    }
    return yield* decodeResponse(
      schema,
      payload,
      `Server returned ${response.status} with an invalid response body`,
    );
  });

const httpRequest = <A, I>(
  config: RequestConfig,
  method: string,
  path: string,
  schema: Schema.Schema<A, I>,
  body?: unknown,
): Promise<A> =>
  Effect.runPromiseExit(httpRequestEffect(config, method, path, schema, body)).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.failureOption(exit.cause);
    if (Option.isNone(failure)) throw Cause.squash(exit.cause);
    throw failure.value instanceof KevaTransportError ? failure.value.cause : failure.value;
  });

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

  #requestEffect<A, I>(
    method: string,
    path: string,
    schema: Schema.Schema<A, I>,
    body?: unknown,
  ): Effect.Effect<A, KevaClientError> {
    return httpRequestEffect(
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

  startUploadEffect(input: InitiateUploadType): Effect.Effect<ItemUploadSession, KevaClientError> {
    return Effect.try({
      try: () => decode(InitiateUpload, input),
      catch: () => new KevaProtocolError("Invalid upload input"),
    }).pipe(
      Effect.flatMap((body) =>
        this.#requestEffect("POST", "/items", OwnerInitiateUploadResult, body),
      ),
      Effect.map((initiated) => ({ initiated })),
    );
  }

  async putUpload(session: ItemUploadSession, body: UploadBody): Promise<void> {
    const response = await this.#fetch(session.initiated.uploadUrl, {
      method: "PUT",
      headers: session.initiated.headers,
      credentials: "omit",
      body,
    });
    if (!response.ok) {
      throw new KevaProtocolError(`Blob upload failed with ${response.status}`);
    }
  }

  putUploadEffect(
    session: ItemUploadSession,
    body: UploadBody,
  ): Effect.Effect<void, KevaProtocolError | KevaTransportError> {
    return fetchEffect(this.#fetch, session.initiated.uploadUrl, {
      method: "PUT",
      headers: session.initiated.headers,
      credentials: "omit",
      body,
    }).pipe(
      Effect.flatMap((response) =>
        requireOk(response, `Blob upload failed with ${response.status}`),
      ),
      Effect.asVoid,
    );
  }

  completeUpload(session: ItemUploadSession): Promise<KevaItemType> {
    return this.confirm(session.initiated.item.id);
  }

  completeUploadEffect(session: ItemUploadSession): Effect.Effect<KevaItemType, KevaClientError> {
    return this.#requestEffect(
      "POST",
      `/items/${encodeURIComponent(session.initiated.item.id)}/confirm`,
      OwnerItem,
    );
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

  getEffect(id: string): Effect.Effect<KevaItemType, KevaClientError> {
    return this.#requestEffect("GET", `/items/${encodeURIComponent(id)}`, OwnerItem);
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

  downloadBytesEffect(id: string): Effect.Effect<Uint8Array, KevaClientError> {
    return this.#requestEffect(
      "GET",
      `/items/${encodeURIComponent(id)}/content`,
      DownloadResult,
    ).pipe(Effect.flatMap((target) => downloadBytesFromUrlEffect(this.#fetch, target.url)));
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

  patchMany(ids: readonly string[], patch: BatchPatchChanges): Promise<BatchPatchResultType>;
  patchMany(
    items: readonly BatchPatchItemType[],
    patch: BatchPatchChanges,
  ): Promise<BatchPatchResultType>;
  patchMany(
    targets: readonly (string | BatchPatchItemType)[],
    patch: BatchPatchChanges,
  ): Promise<BatchPatchResultType> {
    const items = targets.map((target) => (typeof target === "string" ? { id: target } : target));
    return this.#request(
      "POST",
      "/items/patch",
      BatchPatchResult,
      decode(BatchPatch, { items, ...patch }),
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

  queryEffect(
    query: QueryType = { where: [], limit: 100, order: "created_at_asc" },
  ): Effect.Effect<QueryResultType, KevaClientError> {
    return Effect.try({
      try: () => decode(Query, query),
      catch: () => new KevaProtocolError("Invalid query input"),
    }).pipe(
      Effect.flatMap((body) => this.#requestEffect("POST", "/query", OwnerQueryResult, body)),
    );
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

  async propertySuggestions(search: string): Promise<PropertySuggestionType[]> {
    const { entries } = await this.#request(
      "GET",
      `/properties/search?q=${encodeURIComponent(search)}`,
      PropertySuggestionsResult,
    );
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

  createAccountShare(input: CreateAccountShareType): Promise<AccountShareRecordType> {
    return this.#request(
      "POST",
      "/account-shares",
      AccountShareRecord,
      decode(CreateAccountShare, input),
    );
  }

  async listAccountShares(): Promise<AccountShareRecordType[]> {
    const records = await this.#request("GET", "/account-shares", Schema.Array(AccountShareRecord));
    return [...records];
  }

  revokeAccountShare(id: string): Promise<{ revoked: boolean }> {
    return this.#request(
      "DELETE",
      `/account-shares/${encodeURIComponent(id)}`,
      Schema.Struct({ revoked: Schema.Boolean }),
    );
  }

  async listReceivedShares(): Promise<ReceivedShareType[]> {
    const records = await this.#request("GET", "/shared-views", Schema.Array(ReceivedShare));
    return [...records];
  }

  acceptReceivedShare(id: string): Promise<ReceivedShareType> {
    return this.#request("POST", `/shared-views/${encodeURIComponent(id)}/accept`, ReceivedShare);
  }

  declineReceivedShare(id: string): Promise<{ declined: boolean }> {
    return this.#request(
      "POST",
      `/shared-views/${encodeURIComponent(id)}/decline`,
      Schema.Struct({ declined: Schema.Boolean }),
    );
  }

  leaveReceivedShare(id: string): Promise<{ left: boolean }> {
    return this.#request(
      "DELETE",
      `/shared-views/${encodeURIComponent(id)}`,
      Schema.Struct({ left: Schema.Boolean }),
    );
  }

  sharedView(id: string): SharedViewClient {
    return new SharedViewClient({
      baseUrl: this.#baseUrl,
      grantId: id,
      credentials: this.#credentials,
      fetch: this.#fetch,
    });
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

export interface ShareAccessClient {
  self(): Promise<ShareSelfType | AccountShareSelfType>;
  query(query?: QueryType): Promise<SharedQueryResultType>;
  get(id: string): Promise<SharedItemType>;
  getDownloadUrl(id: string): Promise<DownloadResultType>;
  downloadBytes(id: string): Promise<Uint8Array>;
  startUpload(file: File): Promise<ShareUploadSession>;
  putUpload(session: ShareUploadSession, body: UploadBody): Promise<void>;
  completeUpload(session: ShareUploadSession): Promise<SharedItemType>;
  uploadFile(file: File): Promise<SharedItemType>;
}

export interface EffectShareAccessClient extends ShareAccessClient {
  downloadBytesEffect(id: string): Effect.Effect<Uint8Array, KevaClientError>;
  startUploadEffect(file: File): Effect.Effect<ShareUploadSession, KevaClientError>;
  putUploadEffect(
    session: ShareUploadSession,
    body: UploadBody,
  ): Effect.Effect<void, KevaProtocolError | KevaTransportError>;
  completeUploadEffect(session: ShareUploadSession): Effect.Effect<SharedItemType, KevaClientError>;
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

  #requestEffect<A, I>(
    method: string,
    path: string,
    schema: Schema.Schema<A, I>,
    body?: unknown,
  ): Effect.Effect<A, KevaClientError> {
    return httpRequestEffect(this.#config, method, path, schema, body);
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

  downloadBytesEffect(id: string): Effect.Effect<Uint8Array, KevaClientError> {
    return this.#requestEffect(
      "GET",
      `/items/${encodeURIComponent(id)}/content`,
      DownloadResult,
    ).pipe(Effect.flatMap((target) => downloadBytesFromUrlEffect(this.#config.fetch, target.url)));
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

  startUploadEffect(file: File): Effect.Effect<ShareUploadSession, KevaClientError> {
    return Effect.try({
      try: () =>
        decode(InitiateUpload, {
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      catch: () => new KevaProtocolError("Invalid upload input"),
    }).pipe(
      Effect.flatMap((body) =>
        this.#requestEffect("POST", "/items", SharedInitiateUploadResult, body),
      ),
      Effect.map((initiated) => ({ initiated })),
    );
  }

  async putUpload(session: ShareUploadSession, body: UploadBody): Promise<void> {
    const response = await this.#config.fetch(session.initiated.uploadUrl, {
      method: "PUT",
      headers: session.initiated.headers,
      credentials: "omit",
      body,
    });
    if (!response.ok) {
      throw new KevaProtocolError(`Blob upload failed with ${response.status}`);
    }
  }

  putUploadEffect(
    session: ShareUploadSession,
    body: UploadBody,
  ): Effect.Effect<void, KevaProtocolError | KevaTransportError> {
    return fetchEffect(this.#config.fetch, session.initiated.uploadUrl, {
      method: "PUT",
      headers: session.initiated.headers,
      credentials: "omit",
      body,
    }).pipe(
      Effect.flatMap((response) =>
        requireOk(response, `Blob upload failed with ${response.status}`),
      ),
      Effect.asVoid,
    );
  }

  completeUpload(session: ShareUploadSession): Promise<SharedItemType> {
    return this.confirm(session.initiated.item.id);
  }

  completeUploadEffect(
    session: ShareUploadSession,
  ): Effect.Effect<SharedItemType, KevaClientError> {
    return this.#requestEffect(
      "POST",
      `/items/${encodeURIComponent(session.initiated.item.id)}/confirm`,
      SharedItem,
    );
  }

  // Upload into the share. Name/size/type only — the server force-applies the
  // grant's property stamp and rejects any caller-supplied properties/source.
  async uploadFile(file: File): Promise<SharedItemType> {
    const session = await this.startUpload(file);
    await this.putUpload(session, file);
    return this.completeUpload(session);
  }
}

export interface SharedViewClientOptions {
  readonly baseUrl: string;
  readonly grantId: string;
  readonly credentials?: RequestCredentials;
  readonly fetch?: typeof globalThis.fetch;
}

export class SharedViewClient implements ShareAccessClient {
  readonly #config: RequestConfig;
  readonly #prefix: string;

  constructor(options: SharedViewClientOptions) {
    this.#config = {
      baseUrl: options.baseUrl.replace(/\/$/, ""),
      token: undefined,
      credentials: options.credentials ?? "include",
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    };
    this.#prefix = `/shared-views/${encodeURIComponent(options.grantId)}`;
  }

  #request<A, I>(
    method: string,
    path: string,
    schema: Schema.Schema<A, I>,
    body?: unknown,
  ): Promise<A> {
    return httpRequest(this.#config, method, `${this.#prefix}${path}`, schema, body);
  }

  #requestEffect<A, I>(
    method: string,
    path: string,
    schema: Schema.Schema<A, I>,
    body?: unknown,
  ): Effect.Effect<A, KevaClientError> {
    return httpRequestEffect(this.#config, method, `${this.#prefix}${path}`, schema, body);
  }

  self(): Promise<AccountShareSelfType> {
    return this.#request("GET", "/self", AccountShareSelf);
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

  async downloadBytes(id: string): Promise<Uint8Array> {
    const target = await this.getDownloadUrl(id);
    const response = await this.#config.fetch(target.url);
    if (!response.ok) throw new KevaProtocolError(`Blob download failed with ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  downloadBytesEffect(id: string): Effect.Effect<Uint8Array, KevaClientError> {
    return this.#requestEffect(
      "GET",
      `/items/${encodeURIComponent(id)}/content`,
      DownloadResult,
    ).pipe(Effect.flatMap((target) => downloadBytesFromUrlEffect(this.#config.fetch, target.url)));
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

  startUploadEffect(file: File): Effect.Effect<ShareUploadSession, KevaClientError> {
    return Effect.try({
      try: () =>
        decode(InitiateUpload, {
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      catch: () => new KevaProtocolError("Invalid upload input"),
    }).pipe(
      Effect.flatMap((body) =>
        this.#requestEffect("POST", "/items", SharedInitiateUploadResult, body),
      ),
      Effect.map((initiated) => ({ initiated })),
    );
  }

  async putUpload(session: ShareUploadSession, body: UploadBody): Promise<void> {
    const response = await this.#config.fetch(session.initiated.uploadUrl, {
      method: "PUT",
      headers: session.initiated.headers,
      credentials: "omit",
      body,
    });
    if (!response.ok) throw new KevaProtocolError(`Blob upload failed with ${response.status}`);
  }

  putUploadEffect(
    session: ShareUploadSession,
    body: UploadBody,
  ): Effect.Effect<void, KevaProtocolError | KevaTransportError> {
    return fetchEffect(this.#config.fetch, session.initiated.uploadUrl, {
      method: "PUT",
      headers: session.initiated.headers,
      credentials: "omit",
      body,
    }).pipe(
      Effect.flatMap((response) =>
        requireOk(response, `Blob upload failed with ${response.status}`),
      ),
      Effect.asVoid,
    );
  }

  completeUpload(session: ShareUploadSession): Promise<SharedItemType> {
    return this.confirm(session.initiated.item.id);
  }

  completeUploadEffect(
    session: ShareUploadSession,
  ): Effect.Effect<SharedItemType, KevaClientError> {
    return this.#requestEffect(
      "POST",
      `/items/${encodeURIComponent(session.initiated.item.id)}/confirm`,
      SharedItem,
    );
  }

  async uploadFile(file: File): Promise<SharedItemType> {
    const session = await this.startUpload(file);
    await this.putUpload(session, file);
    return this.completeUpload(session);
  }
}

export const shareClient = (baseUrl: string, shareToken: string): ShareClient =>
  new ShareClient({ baseUrl, shareToken });
