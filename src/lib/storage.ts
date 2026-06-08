import "server-only";
import path from "path";
import { mkdir, readFile, writeFile, stat, unlink } from "fs/promises";
import { getUploadsDir } from "@/lib/uploads";

/**
 * Object storage abstraction.
 *
 * Two backends, selected by STORAGE_DRIVER:
 *   - "local" (default) — files on disk under UPLOADS_PATH. Keeps self-hosted
 *     installs working with zero extra config.
 *   - "s3" — any S3-compatible object store. The SAME driver covers AWS S3 and
 *     Hetzner Object Storage; they differ only in endpoint/region. See
 *     .env.example for both configs.
 *
 * Objects are addressed by a "key" — a slash-separated path such as
 * "documents/2026/<uuid>.pdf". Keys are validated to prevent traversal.
 *
 * Serving: prefer proxying object bytes through an auth-gated route (like the
 * existing /api/uploads/[...path] handler) for private/GDPR-sensitive files.
 * Use signedUrl() only when a time-limited direct download is acceptable.
 */

export type StorageDriverName = "local" | "s3";

export interface PutOptions {
  /** MIME type stored as object metadata (S3) and returned by get(). */
  contentType: string;
  /** Original filename, surfaced as Content-Disposition on signed downloads. */
  filename?: string;
}

export interface GetResult {
  body: Buffer;
  contentType: string;
  size: number;
}

export interface StorageDriver {
  readonly name: StorageDriverName;
  put(key: string, body: Buffer, opts: PutOptions): Promise<void>;
  get(key: string): Promise<GetResult | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * Time-limited direct-download URL. Returns null for backends that can't
   * sign (local disk) — callers must fall back to a proxy route.
   */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

/** Throws on keys that could escape the storage root or are malformed. */
export function assertSafeKey(key: string): void {
  if (
    !key ||
    key.length > 1024 ||
    !KEY_RE.test(key) ||
    key.includes("..") ||
    key.includes("//") ||
    key.startsWith("/") ||
    key.endsWith("/")
  ) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
  }
}

/** Builds a safe key like "documents/<uuid>.pdf" from a category + filename. */
export function buildStorageKey(category: string, filename: string): string {
  const safeCategory = category.replace(/[^a-zA-Z0-9-_]/g, "");
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  const key = `${safeCategory}/${safeName}`;
  assertSafeKey(key);
  return key;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
};

export function contentTypeFromKey(key: string): string {
  const ext = path.extname(key).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (STORAGE_DRIVER=s3)`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Local disk driver
// ---------------------------------------------------------------------------

function createLocalDriver(): StorageDriver {
  const root = getUploadsDir();

  function resolve(key: string): string {
    assertSafeKey(key);
    const full = path.join(root, key);
    // Defence in depth — assertSafeKey already blocks traversal.
    if (!full.startsWith(root)) {
      throw new Error(`Resolved path escapes uploads root: ${key}`);
    }
    return full;
  }

  return {
    name: "local",

    async put(key, body) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body);
    },

    async get(key) {
      const full = resolve(key);
      try {
        const info = await stat(full);
        const body = await readFile(full);
        return {
          body,
          size: info.size,
          contentType: contentTypeFromKey(key),
        };
      } catch {
        return null;
      }
    },

    async delete(key) {
      try {
        await unlink(resolve(key));
      } catch {
        // already gone — idempotent delete
      }
    },

    async exists(key) {
      try {
        await stat(resolve(key));
        return true;
      } catch {
        return false;
      }
    },

    async signedUrl() {
      // Local disk can't sign — caller must proxy through an auth-gated route.
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// S3-compatible driver (AWS S3 + Hetzner Object Storage)
// ---------------------------------------------------------------------------

function createS3Driver(): StorageDriver {
  const bucket = requireEnv("S3_BUCKET");
  const region = process.env.S3_REGION || "us-east-1";
  const endpoint = process.env.S3_ENDPOINT || undefined;
  // Hetzner works with virtual-hosted style; flip to "true" only if your
  // provider/bucket name requires path-style addressing.
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";
  const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");

  // Lazily construct the SDK client so "local" installs never need the
  // @aws-sdk packages and don't pay the import cost at boot.
  let clientPromise: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
  function client() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { S3Client } = await import("@aws-sdk/client-s3");
        return new S3Client({
          region,
          endpoint,
          forcePathStyle,
          credentials: { accessKeyId, secretAccessKey },
        });
      })();
    }
    return clientPromise;
  }

  return {
    name: "s3",

    async put(key, body, opts) {
      assertSafeKey(key);
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await client();
      await c.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: opts.contentType,
          ContentLength: body.length,
        })
      );
    },

    async get(key) {
      assertSafeKey(key);
      const { GetObjectCommand, S3ServiceException } = await import(
        "@aws-sdk/client-s3"
      );
      const c = await client();
      try {
        const res = await c.send(
          new GetObjectCommand({ Bucket: bucket, Key: key })
        );
        const bytes = await res.Body!.transformToByteArray();
        const body = Buffer.from(bytes);
        return {
          body,
          size: body.length,
          contentType: res.ContentType || contentTypeFromKey(key),
        };
      } catch (err) {
        if (
          err instanceof S3ServiceException &&
          (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404)
        ) {
          return null;
        }
        throw err;
      }
    },

    async delete(key) {
      assertSafeKey(key);
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await client();
      // S3 DeleteObject is idempotent — 204 even if the key was absent.
      await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async exists(key) {
      assertSafeKey(key);
      const { HeadObjectCommand, S3ServiceException } = await import(
        "@aws-sdk/client-s3"
      );
      const c = await client();
      try {
        await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (err) {
        if (
          err instanceof S3ServiceException &&
          (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404)
        ) {
          return false;
        }
        throw err;
      }
    },

    async signedUrl(key, expiresInSeconds = 300) {
      assertSafeKey(key);
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const c = await client();
      return getSignedUrl(
        c,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: expiresInSeconds }
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Factory (memoized singleton)
// ---------------------------------------------------------------------------

let cached: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (cached) return cached;
  const driver = (process.env.STORAGE_DRIVER || "local") as StorageDriverName;
  cached = driver === "s3" ? createS3Driver() : createLocalDriver();
  return cached;
}

/** Test/hot-reload escape hatch — drops the memoized driver. */
export function resetStorage(): void {
  cached = null;
}
