import {
  ItemPatch,
  BatchDelete,
  BatchDeleteResult,
  DownloadResult,
  InitiateUpload,
  InitiateUploadResult,
  KevaError,
  KevaItem,
  PropertyKeysResult,
  PropertyValuesResult,
  Query,
  QueryResult,
  type PropertyScalar as PropertyScalarType,
  type ItemPatch as ItemPatchType,
  type BatchDeleteResult as BatchDeleteResultType,
  type DownloadResult as DownloadResultType,
  type InitiateUpload as InitiateUploadType,
  type KevaError as KevaErrorType,
  type KevaItem as KevaItemType,
  type Query as QueryType,
  type QueryResult as QueryResultType,
} from "@keva/schema";
import { Schema } from "effect";

export type {
  ItemPatchType as ItemPatch,
  BatchDeleteResultType as BatchDeleteResult,
  InitiateUploadType as InitiateUpload,
  KevaErrorType as KevaError,
  KevaItemType as KevaItem,
  QueryType as Query,
  QueryResultType as QueryResult,
  DownloadResultType as DownloadResult,
  PropertyScalarType as PropertyScalar,
};

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

  async #request<A, I>(
    method: string,
    path: string,
    schema: Schema.Schema<A, I>,
    body?: unknown,
  ): Promise<A> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      credentials: this.#credentials,
      headers: {
        ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
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
        throw new KevaProtocolError(
          `Server returned ${response.status} with an invalid error body`,
        );
      }
    }
    try {
      return decode(schema, payload);
    } catch {
      throw new KevaProtocolError(
        `Server returned ${response.status} with an invalid response body`,
      );
    }
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
}
