// Cloud Storage on Google Cloud: the campaign image bucket, shaped like the R2 binding the shared
// code calls, and the chat snapshot store the Node agent host persists each chat to (ADR-018).
import { Readable } from "node:stream";
import type { Bucket } from "@google-cloud/storage";
import { SnapshotConflictError, type SnapshotStore } from "../agent/snapshots";

/** The part of R2's object the shared code reads. */
export type StoredObject = {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type ObjectStore = {
  get(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    value: Uint8Array | ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
};

const isNotFound = (error: unknown) => (error as { code?: number }).code === 404;
const isPreconditionFailed = (error: unknown) => (error as { code?: number }).code === 412;

export function gcsObjectStore(bucket: Bucket): ObjectStore {
  return {
    async get(key) {
      const file = bucket.file(key);
      try {
        const [[metadata], [bytes]] = await Promise.all([file.getMetadata(), file.download()]);
        const data = new Uint8Array(bytes);
        return {
          body: Readable.toWeb(Readable.from([data])) as ReadableStream<Uint8Array>,
          ...(metadata.contentType ? { httpMetadata: { contentType: metadata.contentType } } : {}),
          customMetadata: Object.fromEntries(
            Object.entries(metadata.metadata ?? {}).map(([name, value]) => [name, String(value)]),
          ),
          arrayBuffer: async () =>
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async put(key, value, options) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      await bucket.file(key).save(Buffer.from(bytes), {
        resumable: false,
        contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
        metadata: { metadata: options?.customMetadata ?? {} },
      });
    },
  };
}

/**
 * Each chat's storage as one object, written only if nobody else wrote it since it was read
 * (Cloud Storage generation preconditions), so two instances can never silently overwrite a chat.
 */
export function gcsSnapshotStore(bucket: Bucket, prefix = "sessions/"): SnapshotStore {
  const key = (name: string) => `${prefix}${encodeURIComponent(name)}.sqlite`;
  const file = (name: string) => bucket.file(key(name));
  return {
    async load(name) {
      try {
        const [metadata] = await file(name).getMetadata();
        const generation = String(metadata.generation);
        // Download that exact generation, so the bytes and the generation belong together.
        const [bytes] = await bucket.file(key(name), { generation: Number(generation) }).download();
        return { bytes: new Uint8Array(bytes), generation };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async save(name, bytes, ifGeneration) {
      const target = file(name);
      try {
        await target.save(Buffer.from(bytes), {
          resumable: false,
          contentType: "application/vnd.sqlite3",
          preconditionOpts: { ifGenerationMatch: ifGeneration === null ? 0 : Number(ifGeneration) },
        });
      } catch (error) {
        if (isPreconditionFailed(error)) throw new SnapshotConflictError(name, ifGeneration, null);
        throw error;
      }
      // The upload's response is the new object; its generation is the one this write made.
      if (target.metadata.generation) return String(target.metadata.generation);
      const [metadata] = await target.getMetadata();
      return String(metadata.generation);
    },
  };
}
