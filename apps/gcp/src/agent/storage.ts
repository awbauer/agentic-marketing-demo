import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** `@types/node` 24 predates `serialize()`/`deserialize()`, which Node 26 ships. */
type SerializableDatabase = DatabaseSync & {
  serialize(): Uint8Array;
  deserialize(bytes: Uint8Array): void;
};

/** Value types a Durable Object `this.sql` binding accepts. */
export type SqlValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | ArrayBuffer
  | Uint8Array;

/**
 * Statements that cannot change what a snapshot must carry. Idempotent schema setup is included: it
 * runs on every activation and is rebuilt from code, so it alone should not trigger a save.
 */
const NON_DIRTYING_STATEMENT =
  /^\s*(select|explain|pragma\s+\w+\s*$|create\s+(table|index|unique\s+index)\s+if\s+not\s+exists)\b/i;

/**
 * One agent's whole storage: the subclass's `sql` tables, chat messages, state, request context, and
 * MCP OAuth material, all in a single in-memory SQLite database so a snapshot is one consistent byte
 * image. Writes are announced so the host can coalesce them into snapshot saves.
 */
export class AgentStorage {
  #db: SerializableDatabase;
  readonly #writeListeners = new Set<() => void>();

  constructor(bytes?: Uint8Array | null) {
    this.#db = AgentStorage.#open(bytes);
  }

  static #open(bytes?: Uint8Array | null) {
    const db = new DatabaseSync(":memory:") as SerializableDatabase;
    if (bytes && bytes.length > 0) db.deserialize(bytes);
    db.exec("create table if not exists cf_agents_kv (key text primary key, value text not null)");
    return db;
  }

  /** Runs one statement like a Durable Object's `this.sql` and returns its rows as plain objects. */
  sql<T = Record<string, SqlValue>>(strings: TemplateStringsArray, ...values: SqlValue[]): T[] {
    return this.query<T>(strings.join("?"), values);
  }

  query<T = Record<string, SqlValue>>(statement: string, values: readonly SqlValue[] = []): T[] {
    const rows = this.#db.prepare(statement).all(...values.map(toInput));
    if (!NON_DIRTYING_STATEMENT.test(statement)) this.#announceWrite();
    return rows.map((row) => fromRow(row) as T);
  }

  kvGet(key: string): string | undefined {
    const row = this.#db.prepare("select value from cf_agents_kv where key = ?").get(key);
    return row ? String(row.value) : undefined;
  }

  kvPut(key: string, value: string) {
    this.#db
      .prepare("insert or replace into cf_agents_kv (key, value) values (?, ?)")
      .run(key, value);
    this.#announceWrite();
  }

  kvDelete(...keys: string[]) {
    if (keys.length === 0) return;
    const statement = this.#db.prepare("delete from cf_agents_kv where key = ?");
    for (const key of keys) statement.run(key);
    this.#announceWrite();
  }

  kvKeys(prefix: string): string[] {
    return this.#db
      .prepare("select key from cf_agents_kv where substr(key, 1, ?) = ? order by key")
      .all(prefix.length, prefix)
      .map((row) => String(row.key));
  }

  serialize(): Uint8Array {
    return this.#db.serialize();
  }

  /** Swaps in another process's image after a snapshot conflict; the caller reloads its caches. */
  replace(bytes: Uint8Array | null) {
    const next = AgentStorage.#open(bytes);
    this.#db.close();
    this.#db = next;
  }

  onWrite(listener: () => void) {
    this.#writeListeners.add(listener);
    return () => this.#writeListeners.delete(listener);
  }

  close() {
    this.#writeListeners.clear();
    this.#db.close();
  }

  #announceWrite() {
    for (const listener of this.#writeListeners) listener();
  }
}

function toInput(value: SqlValue): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

/** Durable Object rows are ordinary objects with ArrayBuffer blobs; mirror that shape. */
function fromRow(row: Record<string, unknown>) {
  const plain: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row))
    plain[key] =
      value instanceof Uint8Array
        ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
        : value;
  return plain;
}
