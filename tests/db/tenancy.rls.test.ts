/**
 * Negative authorisation tests for the tenancy tables.
 * Environment: REAL PostgreSQL 17 (embedded) + Supabase-compatible auth shim. Not Supabase itself.
 * Each test acts as a restricted `authenticated` (or `anon`) caller. A passing test means the
 * operation was refused or the rows were invisible.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asUser, expectFail, probe, refused, startDb, type TestDb } from "./harness";
import { buildWorld, createUser, type World } from "./fixtures";

let db: TestDb;
let c: Client;
let w: World;

beforeAll(async () => {
  db = await startDb();
  c = db.admin;
  w = await buildWorld(c);
});
afterAll(async () => {
  await db?.stop();
});

const count = async (client: Client, sql: string, params: unknown[] = []) =>
  Number((await client.query(sql, params)).rows[0].n);

describe("migrations", () => {
  it("every table in the public schema has RLS enabled", async () => {
    const r = await c.query(
      "select relname from pg_class where relnamespace = 'retailos'::regnamespace and relkind = 'r' and not relrowsecurity",
    );
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });

  it("the anon role holds no privilege on any public table", async () => {
    const r = await c.query(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'retailos'`,
    );
    expect(r.rows).toEqual([]);
  });

  it("no function in public or private is executable by PUBLIC or anon", async () => {
    const r = await c.query(
      `select n.nspname || '.' || p.proname as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('retailos','retailos_private')
         and (has_function_privilege('anon', p.oid, 'execute'))`,
    );
    expect(r.rows.map((x) => x.fn)).toEqual([]);
  });
});

describe("cross-tenant reads (TC-SEC-01)", () => {
  it("a tenant A user sees nothing of tenant B in any tenancy table", async () => {
    for (const who of [w.ownerA, w.managerA1, w.cashierA1]) {
      await probe(c, who, async (x) => {
        expect(
          await count(x, "select count(*)::int n from retailos.tenants where id = $1", [w.tenantB]),
        ).toBe(0);
        expect(
          await count(
            x,
            "select count(*)::int n from retailos.tenant_settings where tenant_id = $1",
            [w.tenantB],
          ),
        ).toBe(0);
        expect(
          await count(x, "select count(*)::int n from retailos.branches where tenant_id = $1", [
            w.tenantB,
          ]),
        ).toBe(0);
        expect(
          await count(x, "select count(*)::int n from retailos.counters where tenant_id = $1", [
            w.tenantB,
          ]),
        ).toBe(0);
        expect(
          await count(
            x,
            "select count(*)::int n from retailos.tenant_memberships where tenant_id = $1",
            [w.tenantB],
          ),
        ).toBe(0);
        expect(
          await count(
            x,
            "select count(*)::int n from retailos.branch_memberships where tenant_id = $1",
            [w.tenantB],
          ),
        ).toBe(0);
        expect(
          await count(
            x,
            "select count(*)::int n from retailos.role_discount_limits where tenant_id = $1",
            [w.tenantB],
          ),
        ).toBe(0);
        expect(
          await count(x, "select count(*)::int n from retailos.profiles where id = $1", [w.ownerB]),
        ).toBe(0);
      });
    }
  });

  it("the reverse also holds (tenant B cannot see tenant A)", async () => {
    await probe(c, w.ownerB, async (x) => {
      expect(
        await count(x, "select count(*)::int n from retailos.tenants where id = $1", [w.tenantA]),
      ).toBe(0);
      expect(
        await count(x, "select count(*)::int n from retailos.branches where tenant_id = $1", [
          w.tenantA,
        ]),
      ).toBe(0);
    });
  });

  it("a user with no membership sees no tenant data at all", async () => {
    await probe(c, w.outsider, async (x) => {
      for (const t of [
        "tenants",
        "tenant_settings",
        "branches",
        "counters",
        "tenant_memberships",
        "branch_memberships",
      ]) {
        expect(await count(x, `select count(*)::int n from retailos.${t}`), t).toBe(0);
      }
    });
  });
});

describe("anonymous callers (TC-SEC-11)", () => {
  it("are refused on every table", async () => {
    for (const t of [
      "tenants",
      "branches",
      "profiles",
      "tenant_memberships",
      "roles",
      "permissions",
      "audit_logs",
    ]) {
      const msg = await probe(c, null, () =>
        expectFail(() => c.query(`select * from retailos.${t}`)),
      );
      expect(msg, t).toMatch(/permission denied/i);
    }
  });

  it("cannot call any public function", async () => {
    const msg = await probe(c, null, () =>
      expectFail(() =>
        c.query("select retailos.membership_set_status($1, $2, 'DISABLED')", [
          w.tenantA,
          w.cashierA1,
        ]),
      ),
    );
    expect(msg).toMatch(/permission denied/i);
  });
});

describe("cross-tenant writes (TC-SEC-02, 03)", () => {
  it("an owner of A cannot insert a branch into tenant B", async () => {
    const msg = await probe(c, w.ownerA, () =>
      expectFail(() =>
        c.query(
          "insert into retailos.branches (tenant_id, code, name, state_code) values ($1, 'X1', 'Evil', 'TS')",
          [w.tenantB],
        ),
      ),
    );
    expect(msg).toMatch(/row-level security/i);
  });

  it("an owner of A cannot update tenant B's profile or settings", async () => {
    await probe(c, w.ownerA, async (x) => {
      const t = await x.query("update retailos.tenants set trade_name = 'Hacked' where id = $1", [
        w.tenantB,
      ]);
      expect(t.rowCount).toBe(0);
      const s = await x.query(
        "update retailos.tenant_settings set tax_enforced = false where tenant_id = $1",
        [w.tenantB],
      );
      expect(s.rowCount).toBe(0);
    });
    const check = await c.query("select trade_name from retailos.tenants where id = $1", [w.tenantB]);
    expect(check.rows[0].trade_name).not.toBe("Hacked");
  });

  it("a counter cannot point at a branch of another tenant (composite foreign key)", async () => {
    const msg = await expectFail(() =>
      c.query(
        "insert into retailos.counters (tenant_id, branch_id, code, name) values ($1, $2, 'ZZ', 'Cross')",
        [w.tenantA, w.b1.id],
      ),
    );
    expect(msg).toMatch(/foreign key/i);
  });

  it("a branch membership cannot link a user who is not a member of that tenant", async () => {
    const rid = (await c.query("select id from retailos.roles where key = 'cashier'")).rows[0].id;
    const msg = await expectFail(() =>
      c.query(
        "insert into retailos.branch_memberships (tenant_id, branch_id, user_id, role_id) values ($1, $2, $3, $4)",
        [w.tenantA, w.a1.id, w.cashierB1, rid],
      ),
    );
    expect(msg).toMatch(/foreign key/i);
  });
});

describe("branch isolation (TC-SEC-04)", () => {
  it("a branch member sees only their own branch", async () => {
    await probe(c, w.cashierA1, async (x) => {
      const ids = (await x.query("select id from retailos.branches order by code")).rows.map(
        (r) => r.id,
      );
      expect(ids).toEqual([w.a1.id]);
      expect(
        await count(x, "select count(*)::int n from retailos.counters where branch_id = $1", [
          w.a2.id,
        ]),
      ).toBe(0);
    });
  });

  it("the owner sees every branch of their own tenant", async () => {
    await probe(c, w.ownerA, async (x) => {
      const ids = (await x.query("select id from retailos.branches")).rows.map((r) => r.id).sort();
      expect(ids).toEqual([w.a1.id, w.a2.id].sort());
    });
  });

  it("a cashier cannot create or edit branches or counters", async () => {
    await probe(c, w.cashierA1, async (x) => {
      const ins = await expectFail(() =>
        x.query(
          "insert into retailos.branches (tenant_id, code, name, state_code) values ($1, 'N1', 'New', 'TS')",
          [w.tenantA],
        ),
      );
      expect(ins).toMatch(/row-level security/i);
    });
    await probe(c, w.managerA1, async (x) => {
      const upd = await x.query("update retailos.branches set name = 'Renamed' where id = $1", [
        w.a1.id,
      ]);
      expect(upd.rowCount).toBe(0);
    });
  });
});

describe("membership and role integrity", () => {
  it("nobody can write memberships directly (only through functions)", async () => {
    const rid = (await c.query("select id from retailos.roles where key = 'tenant_owner'")).rows[0]
      .id;
    for (const who of [w.ownerA, w.managerA1, w.cashierA1]) {
      await probe(c, who, async (x) => {
        expect(
          await refused(
            x,
            "insert into retailos.tenant_memberships (tenant_id, user_id, role_id) values ($1, $2, $3)",
            [w.tenantA, w.outsider, rid],
          ),
        ).toMatch(/permission denied/i);
        expect(
          await refused(x, "update retailos.tenant_memberships set role_id = $1", [rid]),
        ).toMatch(/permission denied/i);
        expect(await refused(x, "delete from retailos.tenant_memberships")).toMatch(
          /permission denied/i,
        );
        expect(await refused(x, "update retailos.branch_memberships set status = 'ACTIVE'")).toMatch(
          /permission denied/i,
        );
      });
    }
  });

  it("a cashier cannot promote themselves or others", async () => {
    const msg = await probe(c, w.cashierA1, () =>
      expectFail(() =>
        c.query("select retailos.membership_grant($1, $2, 'tenant_owner')", [w.tenantA, w.cashierA1]),
      ),
    );
    expect(msg).toBe("FORBIDDEN");
  });

  it("a branch manager cannot make tenant-level membership changes", async () => {
    await probe(c, w.managerA1, async (x) => {
      expect(
        await refused(x, "select retailos.membership_grant($1, $2, 'tenant_member')", [
          w.tenantA,
          w.outsider,
        ]),
      ).toBe("FORBIDDEN");
      expect(
        await refused(x, "select retailos.membership_set_status($1, $2, 'DISABLED')", [
          w.tenantA,
          w.cashierA1,
        ]),
      ).toBe("FORBIDDEN");
    });
  });
  it("an owner of tenant A cannot manage tenant B's users", async () => {
    const g = await probe(c, w.ownerA, () =>
      expectFail(() =>
        c.query("select retailos.membership_grant($1, $2, 'tenant_member')", [w.tenantB, w.outsider]),
      ),
    );
    expect(g).toBe("FORBIDDEN");
  });

  it("an owner can invite staff and the role is taken from the roles table", async () => {
    const newUser = await createUser(c, "new.staff@test.local", "New Staff");
    await asUser(c, w.ownerA, (x) =>
      x.query("select retailos.membership_grant($1, $2, 'tenant_member', $3::jsonb)", [
        w.tenantA,
        newUser,
        JSON.stringify([{ branchId: w.a2.id, role: "cashier" }]),
      ]),
    );
    const r = await c.query(
      `select r.key from retailos.branch_memberships bm join retailos.roles r on r.id = bm.role_id
       where bm.user_id = $1 and bm.branch_id = $2`,
      [newUser, w.a2.id],
    );
    expect(r.rows.map((x) => x.key)).toEqual(["cashier"]);
  });

  it("rejects unknown roles, tenant roles in the branch slot, and branches of another tenant", async () => {
    const u = await createUser(c, "bad.role@test.local");
    const run = (role: string, branches: unknown[]) =>
      asUser(c, w.ownerA, (x) =>
        x.query("select retailos.membership_grant($1, $2, $3, $4::jsonb)", [
          w.tenantA,
          u,
          role,
          JSON.stringify(branches),
        ]),
      );
    expect(await expectFail(() => run("superadmin", []))).toBe("VALIDATION_ERROR");
    expect(
      await expectFail(() => run("tenant_member", [{ branchId: w.a1.id, role: "tenant_owner" }])),
    ).toBe("VALIDATION_ERROR");
    expect(
      await expectFail(() => run("tenant_member", [{ branchId: w.b1.id, role: "cashier" }])),
    ).toBe("VALIDATION_ERROR");
  });

  it("sign-up metadata can never create access (profile only carries a name)", async () => {
    const evil = await c.query(
      "insert into auth.users (email, raw_user_meta_data) values ('evil@test.local', $1) returning id",
      [
        JSON.stringify({
          full_name: "Evil",
          role: "tenant_owner",
          tenant_id: w.tenantA,
          is_admin: true,
        }),
      ],
    );
    const id = evil.rows[0].id;
    expect(
      await count(c, "select count(*)::int n from retailos.tenant_memberships where user_id = $1", [
        id,
      ]),
    ).toBe(0);
    expect(
      await count(c, "select count(*)::int n from retailos.platform_admins where user_id = $1", [id]),
    ).toBe(0);
    // Signing up creates no RetailOS profile either: a profile appears only when someone is given access.
    expect(await count(c, "select count(*)::int n from retailos.profiles where id = $1", [id])).toBe(0);
    await probe(c, id, async (x) => {
      expect(await count(x, "select count(*)::int n from retailos.tenants")).toBe(0);
      expect(await count(x, "select count(*)::int n from retailos.branches")).toBe(0);
    });
  });

  it("nobody, including the owner, can disable their own membership", async () => {
    const msg = await asUser(c, w.ownerA, (x) =>
      expectFail(() =>
        x.query("select retailos.membership_set_status($1, $2, 'DISABLED')", [w.tenantA, w.ownerA]),
      ),
    ).catch((e) => e.message);
    expect(msg).toBe("FORBIDDEN");
    expect(
      await count(
        c,
        "select count(*)::int n from retailos.tenant_memberships where user_id = $1 and status = 'ACTIVE'",
        [w.ownerA],
      ),
    ).toBe(1);
  });
});

describe("revocation and suspension (TC-SEC-06, 07)", () => {
  it("a disabled membership loses access on the very next query", async () => {
    const u = await createUser(c, "leaver@test.local");
    await asUser(c, w.ownerA, (x) =>
      x.query("select retailos.membership_grant($1, $2, 'tenant_member', $3::jsonb)", [
        w.tenantA,
        u,
        JSON.stringify([{ branchId: w.a1.id, role: "cashier" }]),
      ]),
    );
    await probe(c, u, async (x) =>
      expect(await count(x, "select count(*)::int n from retailos.branches")).toBe(1),
    );
    await asUser(c, w.ownerA, (x) =>
      x.query("select retailos.membership_set_status($1, $2, 'DISABLED')", [w.tenantA, u]),
    );
    await probe(c, u, async (x) => {
      expect(await count(x, "select count(*)::int n from retailos.branches")).toBe(0);
      expect(await count(x, "select count(*)::int n from retailos.tenants")).toBe(0);
    });
  });

  it("re-enabling a user does not silently restore their branch roles", async () => {
    const u = await createUser(c, "returner@test.local");
    await asUser(c, w.ownerA, (x) =>
      x.query("select retailos.membership_grant($1, $2, 'tenant_member', $3::jsonb)", [
        w.tenantA,
        u,
        JSON.stringify([{ branchId: w.a1.id, role: "cashier" }]),
      ]),
    );
    await asUser(c, w.ownerA, (x) =>
      x.query("select retailos.membership_set_status($1, $2, 'DISABLED')", [w.tenantA, u]),
    );
    await asUser(c, w.ownerA, (x) =>
      x.query("select retailos.membership_set_status($1, $2, 'ACTIVE')", [w.tenantA, u]),
    );
    await probe(c, u, async (x) => {
      expect(await count(x, "select count(*)::int n from retailos.tenants")).toBe(1);
      expect(await count(x, "select count(*)::int n from retailos.branches")).toBe(0);
    });
  });

  it("a suspended tenant is invisible and unusable to all of its users", async () => {
    await c.query("update retailos.tenants set status = 'SUSPENDED' where id = $1", [w.tenantB]);
    try {
      for (const who of [w.ownerB, w.cashierB1]) {
        await probe(c, who, async (x) => {
          expect(await count(x, "select count(*)::int n from retailos.tenants")).toBe(0);
          expect(await count(x, "select count(*)::int n from retailos.branches")).toBe(0);
        });
      }
    } finally {
      await c.query("update retailos.tenants set status = 'ACTIVE' where id = $1", [w.tenantB]);
    }
  });

  it("an inactive branch grants no access", async () => {
    await c.query("update retailos.branches set status = 'INACTIVE' where id = $1", [w.a2.id]);
    try {
      await probe(c, w.cashierA2, async (x) =>
        expect(await count(x, "select count(*)::int n from retailos.branches")).toBe(0),
      );
    } finally {
      await c.query("update retailos.branches set status = 'ACTIVE' where id = $1", [w.a2.id]);
    }
  });
});

describe("platform administrator boundaries (TC-SEC-12, 15)", () => {
  it("a platform admin sees no tenant data without being a member", async () => {
    await probe(c, w.platformAdmin, async (x) => {
      for (const t of ["tenants", "branches", "tenant_memberships", "tenant_settings"]) {
        expect(await count(x, `select count(*)::int n from retailos.${t}`), t).toBe(0);
      }
    });
  });

  it("only a platform admin with MFA (aal2) can create a tenant", async () => {
    const owner = await createUser(c, "newowner@test.local");
    const call = (user: string, aal: "aal1" | "aal2") =>
      asUser(
        c,
        user,
        (x) =>
          x.query("select retailos.platform_create_tenant('NEWCO','New Co Pvt','New Co',$1)", [
            owner,
          ]),
        { aal },
      );
    expect(await expectFail(() => call(w.ownerA, "aal2"))).toBe("FORBIDDEN");
    expect(await expectFail(() => call(w.platformAdmin, "aal1"))).toBe("MFA_REQUIRED");
    await call(w.platformAdmin, "aal2");
    expect(await count(c, "select count(*)::int n from retailos.tenants where code = 'NEWCO'")).toBe(
      1,
    );
    await probe(c, owner, async (x) =>
      expect(await count(x, "select count(*)::int n from retailos.tenants")).toBe(1),
    );
  });

  it("platform_admins cannot be read or written by any API caller", async () => {
    for (const who of [w.platformAdmin, w.ownerA, w.cashierA1]) {
      const msg = await probe(c, who, () =>
        expectFail(() => c.query("select * from retailos.platform_admins")),
      );
      expect(msg).toMatch(/permission denied/i);
      const ins = await probe(c, who, () =>
        expectFail(() =>
          c.query("insert into retailos.platform_admins (user_id) values ($1)", [who]),
        ),
      );
      expect(ins).toMatch(/permission denied/i);
    }
  });
});

describe("profiles and settings", () => {
  it("users edit only their own name and phone", async () => {
    await probe(c, w.cashierA1, async (x) => {
      const own = await x.query("update retailos.profiles set full_name = 'Renamed' where id = $1", [
        w.cashierA1,
      ]);
      expect(own.rowCount).toBe(1);
      const other = await x.query(
        "update retailos.profiles set full_name = 'Renamed' where id = $1",
        [w.managerA1],
      );
      expect(other.rowCount).toBe(0);
      const status = await expectFail(() =>
        x.query("update retailos.profiles set status = 'DISABLED' where id = $1", [w.cashierA1]),
      );
      expect(status).toMatch(/permission denied/i);
    });
  });

  it("only the owner can change tenant settings; the change is audited", async () => {
    await probe(c, w.managerA1, async (x) => {
      const r = await x.query(
        "update retailos.tenant_settings set prices_include_tax_clothing = true where tenant_id = $1",
        [w.tenantA],
      );
      expect(r.rowCount).toBe(0);
    });
    await asUser(c, w.ownerA, (x) =>
      x.query(
        "update retailos.tenant_settings set prices_include_tax_clothing = true where tenant_id = $1",
        [w.tenantA],
      ),
    );
    const a = await c.query(
      "select actor_user_id, action from retailos.audit_logs where tenant_id = $1 and entity_type = 'tenant_settings' order by id desc limit 1",
      [w.tenantA],
    );
    expect(a.rows[0].action).toBe("tenant_settings.update");
    expect(a.rows[0].actor_user_id).toBe(w.ownerA);
  });

  it("discount limits are set only through discount_limit_set, and only with roles.manage", async () => {
    const cashierRole = (await c.query("select id from retailos.roles where key = 'cashier'")).rows[0]
      .id;
    await probe(c, w.managerA1, async (x) => {
      expect(
        await refused(x, "select retailos.discount_limit_set($1, 'branch_manager', 500)", [
          w.tenantA,
        ]),
      ).toBe("FORBIDDEN");
      expect(
        await refused(
          x,
          "insert into retailos.role_discount_limits (tenant_id, role_id, max_line_discount_bps) values ($1, $2, 500)",
          [w.tenantA, cashierRole],
        ),
      ).toMatch(/permission denied/i);
    });
    await probe(c, w.ownerA, async (x) => {
      expect(
        await refused(
          x,
          "insert into retailos.role_discount_limits (tenant_id, role_id, max_line_discount_bps) values ($1, $2, 500)",
          [w.tenantA, cashierRole],
        ),
      ).toMatch(/permission denied/i);
      await x.query("select retailos.discount_limit_set($1, 'branch_manager', 500)", [w.tenantA]);
      expect(
        (
          await x.query(
            "select max_line_discount_bps from retailos.role_discount_limits where tenant_id = $1",
            [w.tenantA],
          )
        ).rows[0].max_line_discount_bps,
      ).toBe(500);
      expect(
        await refused(x, "select retailos.discount_limit_set($1, 'branch_manager', 10001)", [
          w.tenantA,
        ]),
      ).toBe("VALIDATION_ERROR");
      expect(
        await refused(x, "select retailos.discount_limit_set($1, 'tenant_owner', 100)", [w.tenantA]),
      ).toBe("VALIDATION_ERROR");
    });
    // other tenants cannot read or use it
    await probe(c, w.ownerB, async (x) =>
      expect(
        await count(
          x,
          "select count(*)::int n from retailos.role_discount_limits where tenant_id = $1",
          [w.tenantA],
        ),
      ).toBe(0),
    );
  });
});

describe("audit log (TC-SEC-10)", () => {
  it("is append-only for everyone, including the superuser", async () => {
    await c.query(
      "insert into retailos.audit_logs (tenant_id, action, entity_type) values ($1, 'test.event', 'test')",
      [w.tenantA],
    );
    expect(await expectFail(() => c.query("update retailos.audit_logs set action = 'x'"))).toMatch(
      /append-only/,
    );
    expect(await expectFail(() => c.query("delete from retailos.audit_logs"))).toMatch(/append-only/);
    expect(await expectFail(() => c.query("truncate retailos.audit_logs"))).toMatch(/append-only/);
  });

  it("application roles cannot write it at all, and only audit.view holders can read it", async () => {
    for (const who of [w.ownerA, w.cashierA1]) {
      const m = await probe(c, who, () =>
        expectFail(() =>
          c.query(
            "insert into retailos.audit_logs (tenant_id, action, entity_type) values ($1,'forged','x')",
            [w.tenantA],
          ),
        ),
      );
      expect(m).toMatch(/permission denied/i);
    }
    await probe(c, w.ownerA, async (x) =>
      expect(
        await count(x, "select count(*)::int n from retailos.audit_logs where tenant_id = $1", [
          w.tenantA,
        ]),
      ).toBeGreaterThan(0),
    );
    await probe(c, w.cashierA1, async (x) =>
      expect(await count(x, "select count(*)::int n from retailos.audit_logs")).toBe(0),
    );
    await probe(c, w.managerA1, async (x) =>
      expect(await count(x, "select count(*)::int n from retailos.audit_logs")).toBe(0),
    );
    await probe(c, w.ownerB, async (x) =>
      expect(
        await count(x, "select count(*)::int n from retailos.audit_logs where tenant_id = $1", [
          w.tenantA,
        ]),
      ).toBe(0),
    );
  });
});
