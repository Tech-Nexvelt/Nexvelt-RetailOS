/**
 * Database test harness.
 *
 * Starts a REAL PostgreSQL 17 server (embedded-postgres, an ordinary user-mode process; no Docker)
 * and applies, in order: tests/db/shim.sql (Supabase-compatible roles and auth schema),
 * tests/db/prodlike.sql (a RECONSTRUCTION of the live Tirumala + deployed retailos shape, audited
 * read-only on 2026-10-10), then every file in supabase/retailos/migrations. It is NOT Supabase itself
 * and NOT the live database: passing here does not prove the live project accepts the migrations. What it proves: constraints, RLS,
 * functions, transactions, rollback and true multi-connection concurrency on PostgreSQL 17.
 * What it does not prove: Supabase Auth, PostgREST, Storage, or the hosted environment.
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

/**
 * DB_BASE=live-clone: replay the schema extracted READ-ONLY from the live project
 * (scripts/clone-live-schema.mjs -> .local/live-clone/schema.sql, git-ignored) instead of the hand-made
 * tests/db/prodlike.sql. The shim's own default privileges are dropped because the live ones come from the clone.
 * Statements that fail are retried (views depend on each other) until no progress is made.
 */
async function loadLiveClone(admin: Client, shim: string) {
  const file = path.join(ROOT, ".local", "live-clone", "schema.sql");
  if (!fs.existsSync(file)) throw new Error("DB_BASE=live-clone needs .local/live-clone/schema.sql (run scripts/clone-live-schema.mjs)");
  await admin.query(
    shim
      .split(String.fromCharCode(10))
      .filter((l) => !/^alter default privileges/i.test(l) && !/^grant usage on schema public/i.test(l))
      .join(String.fromCharCode(10)),
  );
  // Stand-in for the live uuid-ossp extension (the only extension function the live schema references).
  await admin.query(
    "create schema if not exists extensions; create or replace function extensions.uuid_generate_v4() returns uuid language sql as 'select gen_random_uuid()'",
  );
  let pending = fs
    .readFileSync(file, "utf8")
    .split(/^-- @stmt$/m)
    .map((x) => x.trim())
    .filter(Boolean);
  for (let pass = 0; pending.length && pass < 8; pass++) {
    const failed: { sql: string; err: string }[] = [];
    for (const sql of pending) {
      try {
        await admin.query(sql);
      } catch (e) {
        failed.push({ sql, err: (e as Error).message });
      }
    }
    if (failed.length === pending.length || pass === 7) {
      if (failed.length) {
        const msg = failed.slice(0, 5).map((f) => f.err + " :: " + f.sql.slice(0, 120)).join(String.fromCharCode(10));
        throw new Error("live clone could not be replayed (" + failed.length + " statements): " + msg);
      }
    }
    pending = failed.map((f) => f.sql);
  }
}

export async function startDb(options: { migrations?: boolean } = {}): Promise<TestDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nxr-pg-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    // The live Supabase database is UTF-8; the Windows default (WIN1252) cannot even store the rupee sign.
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
  const shim = fs.readFileSync(path.join(ROOT, "tests", "db", "shim.sql"), "utf8");
  if (process.env.DB_BASE === "live-clone") {
    await loadLiveClone(admin, shim);
  } else {
    await admin.query(shim);
    await admin.query(fs.readFileSync(path.join(ROOT, "tests", "db", "prodlike.sql"), "utf8"));
  }
  if (options.migrations !== false) {
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
  }
  return {
    admin,
    port,
    connect,
    stop: async () => {
      await admin.end().catch(() => {});
      await server.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
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
