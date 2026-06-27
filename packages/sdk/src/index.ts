import {
  AttributePatch,
  DownloadResult,
  InitiateUpload,
  InitiateUploadResult,
  KevaError,
  KevaObject,
  Query,
  QueryResult,
  type AttributePatch as AttributePatchType,
  type DownloadResult as DownloadResultType,
  type InitiateUpload as InitiateUploadType,
  type KevaError as KevaErrorType,
  type KevaObject as KevaObjectType,
  type Query as QueryType,
  type QueryResult as QueryResultType,
} from "@keva/schema";
import { Schema } from "effect";

export type {
  AttributePatchType as AttributePatch,
  InitiateUploadType as InitiateUpload,
  KevaErrorType as KevaError,
  KevaObjectType as KevaObject,
  QueryType as Query,
  QueryResultType as QueryResult,
  DownloadResultType as DownloadResult,
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
    this.#credentials =
      options.credentials ?? (options.token ? "same-origin" : "include");
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
        ) throw error;
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
    return this.#request("POST", "/objects", InitiateUploadResult, body);
  }

  async uploadBody(
    input: InitiateUploadType,
    body: UploadBody,
  ): Promise<KevaObjectType> {
    const initiated = await this.initiate(input);
    const response = await this.#fetch(initiated.uploadUrl, {
      method: "PUT",
      headers: initiated.headers,
      body,
    });
    if (!response.ok) {
      throw new KevaProtocolError(`Blob upload failed with ${response.status}`);
    }
    return this.confirm(initiated.object.id);
  }

  uploadFile(
    file: File,
    options: {
      readonly attributes?: InitiateUploadType["attributes"];
      readonly source?: string;
    } = {},
  ): Promise<KevaObjectType> {
    return this.uploadBody(
      {
        name: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        source: options.source ?? "upload",
        attributes: options.attributes ?? {},
      },
      file,
    );
  }

  upload(input: InitiateUploadType, body: UploadBody): Promise<KevaObjectType> {
    return this.uploadBody(input, body);
  }

  confirm(id: string): Promise<KevaObjectType> {
    return this.#request("POST", `/objects/${encodeURIComponent(id)}/confirm`, KevaObject);
  }

  get(id: string): Promise<KevaObjectType> {
    return this.#request("GET", `/objects/${encodeURIComponent(id)}`, KevaObject);
  }

  getDownloadUrl(id: string): Promise<DownloadResultType> {
    return this.#request(
      "GET",
      `/objects/${encodeURIComponent(id)}/content`,
      DownloadResult,
    );
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

  patchAttributes(
    id: string,
    patch: AttributePatchType,
  ): Promise<KevaObjectType> {
    return this.#request(
      "PATCH",
      `/objects/${encodeURIComponent(id)}/attributes`,
      KevaObject,
      decode(AttributePatch, patch),
    );
  }

  query(query: QueryType = { where: [], limit: 100 }): Promise<QueryResultType> {
    return this.#request("POST", "/query", QueryResult, decode(Query, query));
  }

  async delete(id: string): Promise<void> {
    await this.#request(
      "DELETE",
      `/objects/${encodeURIComponent(id)}`,
      Schema.Struct({ ok: Schema.Boolean }),
    );
  }
}
