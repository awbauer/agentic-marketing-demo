/**
 * Durable home for each agent's SQLite image. An agent instance keeps all of its storage in one
 * in-memory database; the host serializes it and writes it here, guarded by a generation check so
 * two processes that both hold the same chat cannot silently overwrite each other.
 */
export interface SnapshotStore {
  load(name: string): Promise<{ bytes: Uint8Array; generation: string } | null>;
  /** Writes only if the stored generation still equals ifGeneration (null = must not exist). Returns the new generation; throws SnapshotConflictError on mismatch. */
  save(name: string, bytes: Uint8Array, ifGeneration: string | null): Promise<string>;
}

/** Another writer moved the snapshot on since this instance last loaded or saved it. */
export class SnapshotConflictError extends Error {
  constructor(name: string, expected: string | null, actual: string | null) {
    super(
      `Snapshot "${name}" changed underneath this instance (expected generation ${expected ?? "none"}, found ${actual ?? "none"}).`,
    );
    this.name = "SnapshotConflictError";
  }
}

/** Process-local store for tests and local development; copies bytes so callers cannot alias them. */
export class MemorySnapshotStore implements SnapshotStore {
  readonly #entries = new Map<string, { bytes: Uint8Array; generation: string }>();
  #counter = 0;

  async load(name: string) {
    const entry = this.#entries.get(name);
    return entry ? { bytes: entry.bytes.slice(), generation: entry.generation } : null;
  }

  async save(name: string, bytes: Uint8Array, ifGeneration: string | null) {
    const current = this.#entries.get(name)?.generation ?? null;
    if (current !== ifGeneration) throw new SnapshotConflictError(name, ifGeneration, current);
    this.#counter += 1;
    const generation = String(this.#counter);
    this.#entries.set(name, { bytes: bytes.slice(), generation });
    return generation;
  }
}
