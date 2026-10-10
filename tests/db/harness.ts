/**
 * Database test harness.
 *
 * Starts a REAL PostgreSQL 17 server (embedded-postgres, an ordinary user-mode process; no Docker) and
 * applies, in order: tests/db/shim.sql (Supabase-compatible roles, auth schema, default privileges),
 * an optional fixture, then every file in supabase/retailos/migrations. The default is a FRESH database,
 * the same starting point as a brand-new dedicated Supabase project.
 *
 * It is NOT Supabase. What it proves: constraints, RLS, functions, transactions, rollback and true
 * multi-connection concurrency on PostgreSQL 17. What it does not prove: Supabase Auth, PostgREST, the Data
 * API schema exposure, email, Storage, or hosted-platform behaviour.
 */
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

export interface TestDb {
  /** Superuser connection: bypasses RLS. Use only to build fixtures and to inspect results. */
  admin: Client;
  port: number;
  /** Open a new independent connection (superuser) for true concurrency. */
  connect: () => Promise<Client>;
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export interface StartOptions {
  /** Apply supabase/retailos/migrations (default true). */
  migrations?: boolean;
  /**
   * An extra SQL file (path relative to tests/db) applied after the Supabase shim and before the migrations.
   * Only for tests that need a deliberately unsuitable target, e.g. a database that already holds another
   * application. The default is a fresh, empty Supabase-like database.
   */
  fixture?: string;
}

export async function startDb(options: StartOptions = {}): Promise<TestDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nxr-pg-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    // Supabase databases are UTF-8; the Windows default (WIN1252) cannot even store the rupee sign.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();

  const connect = async () => {
    const c = new Client({
      host: "127.0.0.1",
      port,
      user: "postgres",
      password: "postgres",
      database: "postgres",
    });
    await c.connect();
    return c;
  };
  const admin = await connect();
  await admin.query(fs.readFileSync(path.join(ROOT, "tests", "db", "shim.sql"), "utf8"));
  if (options.fixture) await admin.query(fs.readFileSync(path.join(ROOT, "tests", "db", options.fixture), "utf8"));
  const stop = async () => {
    await admin.end().catch(() => {});
    await server.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  };
  if (options.migrations !== false) {
    try {
      const dirM = path.join(ROOT, "supabase", "retailos", "migrations");
      for (const f of fs
        .readdirSync(dirM)
        .filter((n) => n.endsWith(".sql"))
        .sort()) {
        try {
          await admin.query(fs.readFileSync(path.join(dirM, f), "utf8"));
        } catch (e) {
          throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      await stop(); // never leave a database process behind when a migration is refused or fails
      throw e;
    }
  }
  return { admin, port, connect, stop };
}

export interface Claims {
  aal?: "aal1" | "aal2";
}

/**
 * Run work as an API caller: role `authenticated` with a JWT whose subject is `userId`,
 * inside one transaction. Row Level Security and grants apply exactly as through Supabase's API.
 * Pass userId = null to act as an anonymous (signed-out) caller.
 */
export async function asUser<T>(
  client: Client,
  userId: string | null,
  work: (c: Client) => Promise<T>,
  claims: Claims = {},
): Promise<T> {
  await client.query("begin");
  try {
    const role = userId ? "authenticated" : "anon";
    await client.query(`set local role ${role}`);
    const jwt = userId
      ? { sub: userId, role: "authenticated", aal: claims.aal ?? "aal1" }
      : { role: "anon" };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(jwt)]);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  }
}

/** Like asUser but always rolls back (for probing that something is refused or invisible). */
export async function probe<T>(
  client: Client,
  userId: string | null,
  work: (c: Client) => Promise<T>,
  claims: Claims = {},
): Promise<T> {
  await client.query("begin");
  try {
    const role = userId ? "authenticated" : "anon";
    await client.query(`set local role ${role}`);
    const jwt = userId
      ? { sub: userId, role: "authenticated", aal: claims.aal ?? "aal1" }
      : { role: "anon" };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(jwt)]);
    return await work(client);
  } finally {
    await client.query("rollback").catch(() => {});
  }
}

/** The business error code raised by retailos_private.fail(), or the Postgres message for other errors. */
export function errorCode(e: unknown): string {
  const err = e as { message?: string; code?: string };
  return err.message ?? String(e);
}

/** Expect the callback to fail; return the error code/message. Fails the test if it succeeds. */
export async function expectFail(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (e) {
    return errorCode(e);
  }
  throw new Error("Expected the operation to be refused, but it succeeded");
}

/**
 * Run one statement inside an open transaction and expect it to be refused. Uses a savepoint so the
 * surrounding transaction survives and further statements can be tried.
 */
export async function refused(x: Client, sql: string, params: unknown[] = []): Promise<string> {
  await x.query("savepoint refusal_check");
  try {
    await x.query(sql, params);
  } catch (e) {
    await x.query("rollback to savepoint refusal_check");
    return errorCode(e);
  }
  await x.query("release savepoint refusal_check");
  throw new Error("Expected the statement to be refused, but it succeeded: " + sql);
}