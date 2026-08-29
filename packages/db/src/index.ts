import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assert, canonicalize, sha256 } from "@lynxship/contracts";

export interface StateRepository<T> {
  read(): Promise<T>;
  write(value: T): Promise<T>;
}

export class JsonRepository<T> {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly file: string,
    readonly initial: T,
  ) {}

  private async readRaw(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return structuredClone(this.initial);
    }
  }

  private async writeRaw(value: T): Promise<T> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
    await rename(temporary, this.file);
    return value;
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async read(): Promise<T> {
    await this.writeQueue;
    return this.readRaw();
  }

  async write(value: T): Promise<T> {
    return this.enqueue(() => this.writeRaw(value));
  }

  async update(mutator: (current: T) => T | Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const current = await this.readRaw();
      return this.writeRaw(await mutator(current));
    });
  }
}

export class PostgresStateRepository<T> implements StateRepository<T> {
  readonly pool: Pool;

  constructor(
    readonly url: string,
    readonly key: string,
    readonly initial: T,
  ) {
    this.pool = new Pool({ connectionString: url });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS lynxship_state (
        state_key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async read(): Promise<T> {
    const result = await this.pool.query<{ payload: T }>(
      "SELECT payload FROM lynxship_state WHERE state_key = $1",
      [this.key],
    );
    return result.rows[0]?.payload ?? structuredClone(this.initial);
  }

  async write(value: T): Promise<T> {
    await this.pool.query(
      `
        INSERT INTO lynxship_state (state_key, payload, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (state_key)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `,
      [this.key, JSON.stringify(value)],
    );
    return value;
  }

  async probe(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createBackup<T>(
  state: T,
  createdAtOrOptions:
    | string
    | { createdAt?: string } = new Date().toISOString(),
) {
  const createdAt =
    typeof createdAtOrOptions === "string"
      ? createdAtOrOptions
      : (createdAtOrOptions.createdAt ?? new Date().toISOString());
  const payload = canonicalize({ version: 1, createdAt, state });
  return { version: 1, createdAt, hash: sha256(payload), payload };
}

export function restoreBackup<T>(backup: {
  version: number;
  hash: string;
  payload: string;
}): T {
  assert(
    backup.version === 1 && backup.hash === sha256(backup.payload),
    "BACKUP_INVALID",
    "Backup integrity check failed",
  );
  return (JSON.parse(backup.payload) as { state: T }).state;
}

export function validateMigrationNames(names: string[]) {
  const versions = names
    .map((name) => Number.parseInt(name.match(/^(\d+)/)?.[1] ?? "", 10))
    .sort((a, b) => a - b);
  assert(
    versions.every(Number.isInteger) &&
      versions.every((version, index) => version === index + 1),
    "MIGRATION_ORDER",
    "Migration versions must be contiguous starting at 1",
  );
  return versions;
}

export class MigrationTracker {
  readonly applied: Set<number>;

  constructor(applied: number[] = []) {
    this.applied = new Set(applied);
  }

  pending<T extends { version: number }>(migrations: T[]) {
    return migrations
      .filter((migration) => !this.applied.has(migration.version))
      .sort((a, b) => a.version - b.version);
  }

  apply(migration: { version: number }) {
    assert(
      !this.applied.has(migration.version),
      "MIGRATION_DUPLICATE",
      "Migration is already applied",
    );
    this.applied.add(migration.version);
    return [...this.applied].sort((a, b) => a - b);
  }
}
