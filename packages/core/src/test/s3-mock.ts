import { createHash } from "node:crypto";
import { type IncomingMessage, type Server, ServerResponse, createServer } from "node:http";
import { Schema } from "effect";

// Does not validate signatures; exercises the S3BlobStore's signed HTTP requests.

interface StoredObject {
  bytes: Buffer;
  contentType: string;
  etag: string;
}

export interface S3Mock {
  readonly endpoint: string;
  readonly bucket: string;
  readonly store: Map<string, StoredObject>;
  readonly close: () => Promise<void>;
}

const md5 = (b: Buffer): string => `"${createHash("md5").update(b).digest("hex")}"`;

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

const parsePath = (pathname: string) => {
  const parts = pathname.replace(/^\//, "").split("/").map(decodeURIComponent);
  return { bucket: parts[0] ?? "", key: parts.slice(1).join("/") };
};

const ListeningAddress = Schema.Struct({ port: Schema.Number });

export const startS3Mock = async (bucket = "keva"): Promise<S3Mock> => {
  const store = new Map<string, StoredObject>();

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { key } = parsePath(url.pathname);
    const method = req.method ?? "GET";

    if (method === "PUT") {
      const copySource = req.headers["x-amz-copy-source"];
      if (copySource !== undefined && !Array.isArray(copySource)) {
        const { key: fromKey } = parsePath(copySource);
        const src = store.get(fromKey);
        if (!src) {
          res.writeHead(404).end();
          return;
        }
        store.set(key, { ...src });
        res.writeHead(200, {
          ETag: src.etag,
          "content-type": "application/xml",
        });
        res.end(`<CopyObjectResult><ETag>${src.etag}</ETag></CopyObjectResult>`);
        return;
      }
      const bytes = await readBody(req);
      const contentTypeHeader = req.headers["content-type"];
      const contentType = Array.isArray(contentTypeHeader)
        ? (contentTypeHeader[0] ?? "application/octet-stream")
        : (contentTypeHeader ?? "application/octet-stream");
      const etag = md5(bytes);
      store.set(key, { bytes, contentType, etag });
      res.writeHead(200, { ETag: etag }).end();
      return;
    }

    if (method === "GET" || method === "HEAD") {
      const obj = store.get(key);
      if (!obj) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": obj.contentType,
        "content-length": String(obj.bytes.length),
        ETag: obj.etag,
      });
      res.end(method === "HEAD" ? undefined : obj.bytes);
      return;
    }

    if (method === "DELETE") {
      store.delete(key);
      res.writeHead(204).end();
      return;
    }

    res.writeHead(405).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = Schema.decodeUnknownSync(ListeningAddress)(server.address()).port;

  return {
    endpoint: `http://127.0.0.1:${port}`,
    bucket,
    store,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

// Config for S3BlobStoreLive pointed at a running mock.
export const s3MockConfig = (mock: S3Mock) => ({
  endpoint: mock.endpoint,
  region: "auto",
  accessKeyId: "test",
  secretAccessKey: "test",
  bucket: mock.bucket,
  forcePathStyle: true,
});

// Stage bytes at a key by issuing the same signed-style PUT the client would.
export const putObject = async (
  mock: S3Mock,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> => {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const res = await fetch(`${mock.endpoint}/${mock.bucket}/${key}`, {
    method: "PUT",
    headers: { "content-type": contentType, "content-length": String(bytes.byteLength) },
    body,
  });
  if (!res.ok) throw new Error(`mock PUT failed: ${res.status}`);
};
