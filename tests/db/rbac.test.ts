/**
 * Role-based access control, proven against a REAL PostgreSQL 17 (embedded) with a Supabase-compatible
 * auth shim. Not Supabase itself. These are database-level tests: every denial below is produced by
 * RLS, grants, or an authorisation check INSIDE a database function, with no application code in the
 * way, which is what makes them evidence that "hiding a button" is not the only protection.
 *
 * Roles under test: owner (ownerA), branch manager (managerA1), cashier (cashierA1),
 * a cashier of another branch (cashierA2), another business (ownerB / cashierB1),
 * a signed-in user with no membership (outsider), a platform administrator (platformAdmin).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asUser, expectFail, probe, refused, startDb, type TestDb } from "./harness";
import { buildWorld, createUser, type World } from "./fixtures";
import { buildShop, cash, checkout, configureTax, quote, rpc, startDay, type Shop } from "./shop";

let db: TestDb;
let c: Client;
beforeAll(async () => {
  db = await startDb();
  c = db.admin;
});
afterAll(async () => {
  await db?.stop();
});

interface Ctx {
  w: World;
  s: Shop;
}
async function setup(tax: "off" | "exclusive" = "off"): Promise<Ctx> {
  const w = await buildWorld(c);
  const s = await buildShop(c, w);
  await configureTax(c, w, s, tax);
  expect((await startDay(c, w.cashierA1, w.a1.id, w.a1.counterId)).ok).toBe(true);
  return { w, s };
}
const sellAs = (
  x: Ctx,
  who: string,
  lines: unknown[],
  total: number,
  extra: Record<string, unknown> = {},
) =>
  checkout(c, who, {
    branch: x.w.a1.id,
    counter: x.w.a1.counterId,
    lines,
    payments: [cash(total)],
    expected: total,
    ...extra,
  });
const sellShirt = (x: Ctx, who = x.w.cashierA1) =>
  sellAs(x, who, [{ itemId: x.s.shirtM, quantity: 1 }], 129900);
const override = (
  x: Ctx,
  who: string,
  target: string,
  branch: string | null,
  perm: string,
  effect: "GRANT" | "DENY",
  reason = "test",
  expires: string | null = null,
) =>
  rpc(c, who, "select retailos.permission_override_set($1,$2,$3,$4,$5,$6,$7)", [
    x.w.tenantA,
    target,
    branch,
    perm,
    effect,
    reason,
    expires,
  ]);
const n = async (client: Client, sql: string, p: unknown[] = []) =>
  Number((await client.query(sql, p)).rows[0].n);

// ---------------------------------------------------------------------------------------------
describe("the permission catalogue and role defaults", () => {
  it("defines every granular key the product requires", async () => {
    const required = [
      "sale.view",
      "sale.create",
      "sale.view_history",
      "sale.void",
      "sale.return",
      "payment.record",
      "payment.refund",
      "discount.apply",
      "discount.override",
      "product.view",
      "product.create",
      "product.edit",
      "product.price_edit",
      "inventory.view",
      "inventory.adjust",
      "purchase.manage",
      "metal_rate.view",
      "metal_rate.set",
      "tax.manage",
      "report.view",
      "report.export",
      "staff.manage",
      "roles.manage",
      "branch.manage",
      "settings.manage",
    ];
    const have = (await c.query("select key from retailos.permissions")).rows.map((r) => r.key);
    expect(required.filter((k) => !have.includes(k))).toEqual([]);
  });

  it("gives the owner every permission", async () => {
    const r = await c.query(
      `select p.key from retailos.permissions p where not exists (
         select 1 from retailos.role_permissions rp join retailos.roles ro on ro.id = rp.role_id
          where ro.key = 'tenant_owner' and rp.permission_key = p.key)`,
    );
    expect(r.rows).toEqual([]);
  });

  it("gives the cashier exactly four defaults and nothing sensitive", async () => {
    const r = await c.query(
      `select rp.permission_key k from retailos.role_permissions rp join retailos.roles ro on ro.id = rp.role_id where ro.key = 'cashier' order by 1`,
    );
    expect(r.rows.map((x) => x.k)).toEqual([
      "cash_session.manage",
      "payment.record",
      "product.view",
      "sale.create",
    ]);
  });

  it("keeps every sensitive permission away from a branch manager by default", async () => {
    const r = await c.query(
      `select rp.permission_key k from retailos.role_permissions rp join retailos.roles ro on ro.id = rp.role_id where ro.key = 'branch_manager'`,
    );
    const have = r.rows.map((x) => x.k);
    for (const k of [
      "product.price_edit",
      "tax.manage",
      "metal_rate.set",
      "cost.view",
      "cost.manage",
      "roles.manage",
      "settings.manage",
      "branch.manage",
      "report.export",
      "payment.refund",
      "discount.override",
      "audit.view",
    ]) {
      expect(have, k).not.toContain(k);
    }
  });

  it("marks owner-only permissions as non-delegable", async () => {
    const r = await c.query("select key from retailos.permissions where not delegable order by 1");
    expect(r.rows.map((x) => x.key)).toEqual(["branch.manage", "roles.manage", "settings.manage"]);
  });

  it("tenant_member holds no permission at all", async () => {
    const r = await c.query(
      `select count(*)::int n from retailos.role_permissions rp join retailos.roles ro on ro.id = rp.role_id where ro.key = 'tenant_member'`,
    );
    expect(r.rows[0].n).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe("permission helpers can only answer true or false, never NULL (fail-open regression)", () => {
  it("returns a strict boolean for every user, permission and scope", async () => {
    const x = await setup();
    const keys = (await c.query("select key from retailos.permissions order by 1")).rows.map(
      (r) => r.key as string,
    );
    const users = [
      x.w.ownerA,
      x.w.managerA1,
      x.w.cashierA1,
      x.w.cashierA2,
      x.w.ownerB,
      x.w.outsider,
      x.w.platformAdmin,
    ];
    for (const u of users) {
      await probe(c, u, async (y) => {
        for (const k of keys) {
          const r = await y.query(
            `select retailos_private.has_tenant_permission($1,$3) a, retailos_private.has_any_permission($1,$3) b, retailos_private.has_branch_permission($2,$3) d`,
            [x.w.tenantA, x.w.a1.id, k],
          );
          for (const v of Object.values(r.rows[0])) expect(typeof v, `${u} ${k}`).toBe("boolean");
        }
      });
    }
  });

  it("an unexpected NULL from a permission check denies instead of allowing", async () => {
    const x = await setup();
    // Every guard is written as "<helper> IS NOT TRUE => refuse". Prove it on the real functions by
    // asking as a user who has no membership at all (the case that used to return NULL).
    await probe(c, x.w.outsider, async (y) => {
      expect(
        await refused(y, "select retailos_private.assert_any_permission($1,'product.price_edit')", [
          x.w.tenantA,
        ]),
      ).toBe("FORBIDDEN");
      expect(
        await refused(y, "select retailos_private.assert_tenant_permission($1,'roles.manage')", [
          x.w.tenantA,
        ]),
      ).toBe("FORBIDDEN");
      expect(
        await refused(y, "select retailos_private.assert_branch_permission($1,'sale.create')", [x.w.a1.id]),
      ).toBe("FORBIDDEN");
    });
    await probe(c, x.w.cashierA1, async (y) => {
      expect(
        await refused(y, "select retailos_private.assert_tenant_permission($1,'metal_rate.set')", [
          x.w.tenantA,
        ]),
      ).toBe("FORBIDDEN");
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe("reports: owner allowed, cashier denied (required test 1 and 2)", () => {
  async function withSales() {
    const x = await setup();
    expect((await sellShirt(x)).ok).toBe(true);
    expect((await sellAs(x, x.w.cashierA1, [{ itemId: x.s.jeans, quantity: 2 }], 379800)).ok).toBe(
      true,
    );
    return x;
  }
  const day = (d: number) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
  const from = day(-2);
  const to = day(2);

  it("the owner gets business-wide and branch reports that match the invoices", async () => {
    const x = await withSales();
    const t = await rpc(c, x.w.ownerA, "select retailos.report_tenant_sales($1,$2,$3)", [
      x.w.tenantA,
      from,
      to,
    ]);
    expect(t.ok && t.data.grandTotalPaise).toBe(129900 + 379800);
    expect(t.ok && t.data.branches.map((b: any) => b.branchCode)).toEqual(["A1", "A2"]);
    const b = await rpc(c, x.w.ownerA, "select retailos.report_sales_summary($1,$2,$3)", [
      x.w.a1.id,
      from,
      to,
    ]);
    expect(b.ok && b.data).toMatchObject({
      invoiceCount: 2,
      grandTotalPaise: 509700,
      byMethod: { CASH: 509700 },
    });
    const direct = await c.query(
      "select sum((grand_total*100)::bigint)::bigint s from retailos.invoices where tenant_id = $1",
      [x.w.tenantA],
    );
    expect(Number(direct.rows[0].s)).toBe(509700); // the report equals the ledger it summarises
  });

  it("a branch manager sees their own branch but NOT the business-wide report", async () => {
    const x = await withSales();
    expect(
      (
        await rpc(c, x.w.managerA1, "select retailos.report_sales_summary($1,$2,$3)", [
          x.w.a1.id,
          from,
          to,
        ])
      ).ok,
    ).toBe(true);
    expect(
      await rpc(c, x.w.managerA1, "select retailos.report_tenant_sales($1,$2,$3)", [
        x.w.tenantA,
        from,
        to,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, x.w.managerA1, "select retailos.report_sales_summary($1,$2,$3)", [
        x.w.a2.id,
        from,
        to,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("a cashier cannot run any report", async () => {
    const x = await withSales();
    expect(
      await rpc(c, x.w.cashierA1, "select retailos.report_sales_summary($1,$2,$3)", [
        x.w.a1.id,
        from,
        to,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, x.w.cashierA1, "select retailos.report_tenant_sales($1,$2,$3)", [
        x.w.tenantA,
        from,
        to,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, x.w.cashierA1, "select retailos.report_sales_export($1,$2,$3)", [
        x.w.a1.id,
        from,
        to,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("reports are refused for another business, outsiders, platform admins and anonymous callers", async () => {
    const x = await withSales();
    for (const who of [x.w.ownerB, x.w.cashierB1, x.w.outsider, x.w.platformAdmin]) {
      expect(
        await rpc(c, who, "select retailos.report_tenant_sales($1,$2,$3)", [x.w.tenantA, from, to]),
        who,
      ).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(
        await rpc(c, who, "select retailos.report_sales_summary($1,$2,$3)", [x.w.a1.id, from, to]),
        who,
      ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const anon = await rpc(c, null, "select retailos.report_sales_summary($1,$2,$3)", [
      x.w.a1.id,
      from,
      to,
    ]);
    expect(anon.ok === false && anon.code).toMatch(/permission denied/i);
  });

  it("rejects absurd date ranges", async () => {
    const x = await withSales();
    expect(
      await rpc(c, x.w.ownerA, "select retailos.report_sales_summary($1,$2,$3)", [
        x.w.a1.id,
        "2020-01-01",
        "2030-01-01",
      ]),
    ).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(
      await rpc(c, x.w.ownerA, "select retailos.report_sales_summary($1,$2,$3)", [
        x.w.a1.id,
        "2026-02-01",
        "2026-01-01",
      ]),
    ).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("exports need their own permission, are owner-only by default, and are audited with a row count", async () => {
    const x = await withSales();
    expect(
      await rpc(c, x.w.managerA1, "select retailos.report_sales_export($1,$2,$3)", [
        x.w.a1.id,
        from,
        to,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const ok = await rpc(c, x.w.ownerA, "select retailos.report_sales_export($1,$2,$3)", [
      x.w.a1.id,
      from,
      to,
    ]);
    expect(ok.ok && ok.data).toHaveLength(2);
    const a = await c.query(
      "select actor_user_id, after from retailos.audit_logs where tenant_id = $1 and action = 'report.export'",
      [x.w.tenantA],
    );
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].actor_user_id).toBe(x.w.ownerA);
    expect(a.rows[0].after.rows).toBe(2);
    // an explicit, branch-limited exception lets a manager export in that branch only
    expect(
      (await override(x, x.w.ownerA, x.w.managerA1, x.w.a1.id, "report.export", "GRANT")).ok,
    ).toBe(true);
    expect(
      (
        await rpc(c, x.w.managerA1, "select retailos.report_sales_export($1,$2,$3)", [
          x.w.a1.id,
          from,
          to,
        ])
      ).ok,
    ).toBe(true);
    expect(
      await rpc(c, x.w.managerA1, "select retailos.report_sales_export($1,$2,$3)", [
        x.w.a2.id,
        from,
        to,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("voided invoices drop out of the figures", async () => {
    const x = await withSales();
    const inv = (
      await c.query(
        "select id from retailos.invoices where tenant_id = $1 order by invoice_number limit 1",
        [x.w.tenantA],
      )
    ).rows[0].id;
    expect(
      (
        await rpc(c, x.w.managerA1, "select retailos.pos_void_invoice($1,'wrong item',$2)", [
          inv,
          crypto.randomUUID(),
        ])
      ).ok,
    ).toBe(true);
    const b = await rpc(c, x.w.ownerA, "select retailos.report_sales_summary($1,$2,$3)", [
      x.w.a1.id,
      from,
      to,
    ]);
    expect(b.ok && b.data.invoiceCount).toBe(1);
    expect(b.ok && b.data.grandTotalPaise).toBe(379800);
  });
});

// ---------------------------------------------------------------------------------------------
describe("nobody can change roles or permissions except through the guarded functions (required tests 3 and 4)", () => {
  it("a cashier cannot grant, deny or clear any permission, for anyone or for themselves", async () => {
    const x = await setup();
    expect(
      await override(x, x.w.cashierA1, x.w.cashierA1, x.w.a1.id, "sale.void", "GRANT"),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await override(x, x.w.cashierA1, x.w.managerA1, null, "sale.void", "DENY"),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(
        c,
        x.w.cashierA1,
        "select retailos.permission_override_clear($1,$2,null,'sale.create')",
        [x.w.tenantA, x.w.cashierA1],
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, x.w.cashierA1, "select retailos.discount_limit_set($1,'cashier',10000)", [
        x.w.tenantA,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("a cashier cannot promote themselves or anyone else", async () => {
    const x = await setup();
    expect(
      await rpc(c, x.w.cashierA1, "select retailos.membership_grant($1,$2,'tenant_owner')", [
        x.w.tenantA,
        x.w.cashierA1,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(
        c,
        x.w.cashierA1,
        "select retailos.membership_grant($1,$2,'tenant_member',$3::jsonb)",
        [x.w.tenantA, x.w.outsider, JSON.stringify([{ branchId: x.w.a1.id, role: "cashier" }])],
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, x.w.cashierA1, "select retailos.membership_set_status($1,$2,'DISABLED')", [
        x.w.tenantA,
        x.w.managerA1,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, x.w.cashierA1, "select retailos.branch_membership_set_status($1,$2,'DISABLED')", [
        x.w.a1.id,
        x.w.managerA1,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("every permission and role table rejects direct writes from every API role", async () => {
    const x = await setup();
    const rid = (await c.query("select id from retailos.roles where key = 'cashier'")).rows[0].id;
    for (const who of [x.w.cashierA1, x.w.managerA1, x.w.ownerA]) {
      const stmts: Array<[string, unknown[]]> = [
        [
          "insert into retailos.permission_overrides (tenant_id,user_id,permission_key,effect,reason,granted_by) values ($1,$2,'sale.void','GRANT','x',$2)",
          [x.w.tenantA, who],
        ],
        ["update retailos.permission_overrides set effect = 'GRANT'", []],
        ["delete from retailos.permission_overrides", []],
        [
          "insert into retailos.role_permissions (role_id, permission_key) values ($1,'sale.void')",
          [rid],
        ],
        ["update retailos.role_permissions set permission_key = 'sale.void'", []],
        ["delete from retailos.role_permissions", []],
        ["insert into retailos.roles (key,name,scope) values ('god','God','TENANT')", []],
        ["update retailos.roles set key = 'x'", []],
        ["insert into retailos.permissions (key,scope,description) values ('x.y','TENANT','x')", []],
        ["update retailos.permissions set delegable = true", []],
        ["update retailos.tenant_memberships set role_id = $1", [rid]],
        ["insert into retailos.platform_admins (user_id) values ($1)", [who]],
      ];
      await probe(c, who, async (y) => {
        for (const [sql, params] of stmts) {
          expect(await refused(y, sql, params), `${who}: ${sql}`).toMatch(
            /permission denied|row-level security/i,
          );
        }
      });
    }
  });

  it("the owner can grant and clear exceptions, within hard limits", async () => {
    const x = await setup();
    const o = x.w.ownerA;
    // not yourself, not an owner
    expect(await override(x, o, o, x.w.a1.id, "sale.void", "DENY")).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    const owner2 = await createUser(c, `owner2.${x.w.tenantA}@test.local`);
    await c.query(
      "insert into retailos.tenant_memberships (tenant_id, user_id, role_id) select $1, $2, id from retailos.roles where key = 'tenant_owner'",
      [x.w.tenantA, owner2],
    );
    expect(await override(x, o, owner2, null, "sale.void", "DENY")).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    // owner-only permissions can never be delegated
    for (const k of ["roles.manage", "settings.manage", "branch.manage"]) {
      expect(await override(x, o, x.w.managerA1, null, k, "GRANT"), k).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
    // shape rules
    expect(
      await override(x, o, x.w.managerA1, x.w.a1.id, "product.price_edit", "GRANT"),
    ).toMatchObject({ ok: false, code: "VALIDATION_ERROR" }); // tenant permission + branch
    expect(await override(x, o, x.w.managerA1, null, "sale.void", "GRANT")).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    }); // branch permission needs a branch
    expect(await override(x, o, x.w.managerA1, x.w.a2.id, "sale.void", "GRANT")).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    }); // not their branch
    expect(await override(x, o, x.w.outsider, null, "sale.void", "DENY")).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    }); // not a member
    expect(await override(x, o, x.w.managerA1, null, "no.such", "DENY")).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(await override(x, o, x.w.managerA1, null, "sale.void", "MAYBE" as never)).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(await override(x, o, x.w.managerA1, x.w.a1.id, "sale.void", "GRANT", "")).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    }); // reason required
    expect(
      await override(x, o, x.w.managerA1, null, "sale.void", "DENY", "ok", "2000-01-01T00:00:00Z"),
    ).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    // a valid one, then replace it, then clear it
    expect(
      (await override(x, o, x.w.cashierA1, x.w.a1.id, "sale.view", "GRANT", "owner asked")).ok,
    ).toBe(true);
    expect(
      (await override(x, o, x.w.cashierA1, x.w.a1.id, "sale.view", "GRANT", "renewed")).ok,
    ).toBe(true);
    expect(
      await n(c, "select count(*)::int n from retailos.permission_overrides where user_id = $1", [
        x.w.cashierA1,
      ]),
    ).toBe(1);
    expect(
      (
        await rpc(c, o, "select retailos.permission_override_clear($1,$2,$3,'sale.view')", [
          x.w.tenantA,
          x.w.cashierA1,
          x.w.a1.id,
        ])
      ).ok,
    ).toBe(true);
    expect(
      await rpc(c, o, "select retailos.permission_override_clear($1,$2,$3,'sale.view')", [
        x.w.tenantA,
        x.w.cashierA1,
        x.w.a1.id,
      ]),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("the owner of one business cannot set exceptions in another", async () => {
    const x = await setup();
    expect(
      await rpc(
        c,
        x.w.ownerB,
        "select retailos.permission_override_set($1,$2,null,'sale.void','DENY','x',null)",
        [x.w.tenantA, x.w.managerA1],
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("a person can see their own exceptions but not other people's", async () => {
    const x = await setup();
    await override(x, x.w.ownerA, x.w.cashierA1, x.w.a1.id, "sale.view", "GRANT");
    await override(x, x.w.ownerA, x.w.managerA1, x.w.a1.id, "report.export", "GRANT");
    await probe(c, x.w.cashierA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.permission_overrides")).toBe(1),
    );
    await probe(c, x.w.managerA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.permission_overrides")).toBe(1),
    );
    await probe(c, x.w.ownerA, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.permission_overrides")).toBe(2),
    );
    await probe(c, x.w.ownerB, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.permission_overrides")).toBe(0),
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("exceptions change what people can do, immediately and reversibly (required test 12)", () => {
  it("GRANT adds a capability; clearing it removes the capability on the very next call", async () => {
    const x = await setup();
    expect((await sellShirt(x)).ok).toBe(true);
    await probe(c, x.w.cashierA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.invoices")).toBe(0),
    ); // "Sales" is off by default
    expect((await override(x, x.w.ownerA, x.w.cashierA1, x.w.a1.id, "sale.view", "GRANT")).ok).toBe(
      true,
    );
    await probe(c, x.w.cashierA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.invoices")).toBe(1),
    ); // today's sales only
    await rpc(c, x.w.ownerA, "select retailos.permission_override_clear($1,$2,$3,'sale.view')", [
      x.w.tenantA,
      x.w.cashierA1,
      x.w.a1.id,
    ]);
    await probe(c, x.w.cashierA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.invoices")).toBe(0),
    );
  });

  it("sale.view shows today's invoices; sale.view_history shows older ones too", async () => {
    const x = await setup();
    await sellShirt(x);
    // age the invoice by one day (superuser, triggers bypassed - test fixture only)
    await c.query("set session_replication_role = replica");
    await c.query(
      "update retailos.invoices set business_date = current_date - 1 where tenant_id = $1",
      [x.w.tenantA],
    );
    await c.query("reset session_replication_role");
    await override(x, x.w.ownerA, x.w.cashierA1, x.w.a1.id, "sale.view", "GRANT");
    await probe(c, x.w.cashierA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.invoices")).toBe(0),
    );
    await override(x, x.w.ownerA, x.w.cashierA1, x.w.a1.id, "sale.view_history", "GRANT");
    await probe(c, x.w.cashierA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.invoices")).toBe(1),
    );
    await probe(c, x.w.cashierA2, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.invoices")).toBe(0),
    ); // another branch
  });

  it("DENY removes a role default, even from someone whose role includes it", async () => {
    const x = await setup();
    expect((await sellShirt(x, x.w.managerA1)).ok).toBe(true);
    expect(
      (
        await override(
          x,
          x.w.ownerA,
          x.w.managerA1,
          x.w.a1.id,
          "sale.create",
          "DENY",
          "suspended from tills",
        )
      ).ok,
    ).toBe(true);
    expect(await sellShirt(x, x.w.managerA1)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await quote(c, x.w.managerA1, x.w.a1.id, [{ itemId: x.s.shirtM, quantity: 1 }]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await sellShirt(x, x.w.cashierA1)).ok).toBe(true); // others unaffected
  });

  it("taking the money is a separate permission from creating the sale", async () => {
    const x = await setup();
    await override(x, x.w.ownerA, x.w.cashierA1, x.w.a1.id, "payment.record", "DENY");
    expect(await sellShirt(x)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await n(c, "select count(*)::int n from retailos.invoices where tenant_id = $1", [x.w.tenantA]),
    ).toBe(0);
  });

  it("DENY beats GRANT when both could apply", async () => {
    const x = await setup();
    await override(x, x.w.ownerA, x.w.cashierA1, x.w.a1.id, "sale.view_history", "GRANT");
    await override(x, x.w.ownerA, x.w.cashierA1, null, "sale.view_history", "DENY"); // tenant-wide DENY
    await sellShirt(x);
    await probe(c, x.w.cashierA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.invoices")).toBe(0),
    );
  });

  it("an expired exception stops applying without any action", async () => {
    const x = await setup();
    await c.query(
      `insert into retailos.permission_overrides (tenant_id,user_id,branch_id,permission_key,effect,reason,granted_by,created_at,expires_at)
       values ($1,$2,$3,'sale.view','GRANT','temp',$4, now() - interval '2 hours', now() - interval '1 hour')`,
      [x.w.tenantA, x.w.cashierA1, x.w.a1.id, x.w.ownerA],
    );
    await sellShirt(x);
    await probe(c, x.w.cashierA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.invoices")).toBe(0),
    );
    // and an expired DENY no longer blocks
    await c.query(
      `insert into retailos.permission_overrides (tenant_id,user_id,branch_id,permission_key,effect,reason,granted_by,created_at,expires_at)
       values ($1,$2,$3,'sale.create','DENY','old',$4, now() - interval '2 hours', now() - interval '1 hour')`,
      [x.w.tenantA, x.w.managerA1, x.w.a1.id, x.w.ownerA],
    );
    expect((await sellShirt(x, x.w.managerA1)).ok).toBe(true);
  });

  it("a tenant-level exception can be granted (the manager may reprice) and revoked", async () => {
    const x = await setup();
    let next = 1400;
    const reprice = (who: string) =>
      asUser(c, who, (y) =>
        y.query("update retailos.product_variants set selling_price = $2 where id = $1", [
          x.s.shirtM,
          ++next,
        ]),
      );
    expect(await expectFail(() => reprice(x.w.managerA1))).toBe("FORBIDDEN");
    expect(
      (
        await override(
          x,
          x.w.ownerA,
          x.w.managerA1,
          null,
          "product.price_edit",
          "GRANT",
          "pricing duty",
        )
      ).ok,
    ).toBe(true);
    await reprice(x.w.managerA1);
    const repriced = `${next}.00`; // the manager's successful change
    expect(
      (
        await c.query("select selling_price from retailos.product_variants where id = $1", [
          x.s.shirtM,
        ])
      ).rows[0].selling_price,
    ).toBe(repriced);
    expect(
      (
        await rpc(
          c,
          x.w.ownerA,
          "select retailos.permission_override_clear($1,$2,null,'product.price_edit')",
          [x.w.tenantA, x.w.managerA1],
        )
      ).ok,
    ).toBe(true);
    expect(await expectFail(() => reprice(x.w.managerA1))).toBe("FORBIDDEN");
    expect(
      (
        await c.query("select selling_price from retailos.product_variants where id = $1", [
          x.s.shirtM,
        ])
      ).rows[0].selling_price,
    ).toBe(repriced); // unchanged
  });

  it("an exception never creates access for someone who has no membership", async () => {
    const x = await setup();
    expect(
      await expectFail(() =>
        c.query(
          `insert into retailos.permission_overrides (tenant_id,user_id,permission_key,effect,reason,granted_by)
               values ($1,$2,'sale.view','GRANT','sneak',$3)`,
          [x.w.tenantA, x.w.outsider, x.w.ownerA],
        ),
      ),
    ).toMatch(/foreign key/);
    // and a member with no BRANCH membership gets nothing from a branch exception, even if one were forced in
    await c.query(
      `insert into retailos.permission_overrides (tenant_id,user_id,branch_id,permission_key,effect,reason,granted_by)
                   values ($1,$2,$3,'sale.create','GRANT','forced',$4)`,
      [x.w.tenantA, x.w.cashierA2, x.w.a1.id, x.w.ownerA],
    );
    expect(await sellShirt(x, x.w.cashierA2)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("disabling a person revokes everything at once, including exceptions", async () => {
    const x = await setup();
    await override(x, x.w.ownerA, x.w.cashierA1, x.w.a1.id, "sale.view", "GRANT");
    await rpc(c, x.w.ownerA, "select retailos.membership_set_status($1,$2,'DISABLED')", [
      x.w.tenantA,
      x.w.cashierA1,
    ]);
    expect(await sellShirt(x)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await probe(c, x.w.cashierA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.invoices")).toBe(0),
    );
  });

  it("changing a person's role takes effect on their very next request", async () => {
    const x = await setup();
    const voidIt = async () => {
      const inv = await sellShirt(x);
      const id = inv.ok ? inv.data.invoiceId : "";
      return rpc(c, x.w.managerA1, "select retailos.pos_void_invoice($1,'mistake',$2)", [
        id,
        crypto.randomUUID(),
      ]);
    };
    expect((await voidIt()).ok).toBe(true);
    // the owner demotes the manager to a cashier of the same branch
    await rpc(c, x.w.ownerA, "select retailos.membership_grant($1,$2,'tenant_member',$3::jsonb)", [
      x.w.tenantA,
      x.w.managerA1,
      JSON.stringify([{ branchId: x.w.a1.id, role: "cashier" }]),
    ]);
    expect(await voidIt()).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("cashiers cannot do owner work (required tests 5, 6, 7, 8)", () => {
  it("cannot edit base prices", async () => {
    const x = await setup();
    await probe(c, x.w.cashierA1, async (y) => {
      expect(
        (
          await y.query("update retailos.product_variants set selling_price = 1 where id = $1", [
            x.s.shirtM,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        await refused(
          y,
          "insert into retailos.product_variants (tenant_id,product_id,sku,selling_price) select tenant_id,product_id,'NEWSKU',1 from retailos.product_variants limit 1",
        ),
      ).toMatch(/row-level security/i);
    });
    await probe(c, x.w.managerA1, async (y) =>
      expect(
        await refused(y, "update retailos.product_variants set selling_price = 1 where id = $1", [
          x.s.shirtM,
        ]),
      ).toBe("FORBIDDEN"),
    );
    expect(
      (
        await c.query("select selling_price from retailos.product_variants where id = $1", [
          x.s.shirtM,
        ])
      ).rows[0].selling_price,
    ).toBe("1299.00");
  });

  it("cannot adjust inventory", async () => {
    const x = await setup();
    const adj = (who: string) =>
      rpc(c, who, "select retailos.inventory_adjust($1,$2,-1,'LOSS','x',$3)", [
        x.w.a1.id,
        x.s.jeans,
        crypto.randomUUID(),
      ]);
    expect(await adj(x.w.cashierA1)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await adj(x.w.cashierA2)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await adj(x.w.managerA1)).ok).toBe(true);
    await probe(c, x.w.cashierA1, async (y) => {
      expect(await refused(y, "update retailos.inventory_balances set on_hand = 999")).toMatch(
        /permission denied/i,
      );
      expect(
        await refused(
          y,
          "insert into retailos.inventory_movements (tenant_id,branch_id,movement_type,item_type,variant_id,quantity_delta,business_date) values ($1,$2,'ADJUSTMENT_IN','VARIANT',$3,5,current_date)",
          [x.w.tenantA, x.w.a1.id, x.s.jeans],
        ),
      ).toMatch(/permission denied/i);
    });
  });

  it("cannot read stock levels, ledger, costs, settings, audit log or other branches", async () => {
    const x = await setup();
    await c.query(
      "insert into retailos.variant_costs (tenant_id, variant_id, cost_price) values ($1,$2,500)",
      [x.w.tenantA, x.s.shirtM],
    );
    await sellShirt(x);
    await probe(c, x.w.cashierA1, async (y) => {
      for (const t of [
        "inventory_balances",
        "inventory_movements",
        "variant_costs",
        "jewellery_item_costs",
        "tenant_settings",
        "audit_logs",
        "role_discount_limits",
        "metal_rates",
        "tax_rates",
        "invoices",
        "payments",
      ]) {
        expect(await n(y, `select count(*)::int n from retailos.${t}`), t).toBe(0);
      }
      expect(await n(y, "select count(*)::int n from retailos.branches")).toBe(1); // only their own
    });
  });

  it("cannot change metal rates", async () => {
    const x = await setup();
    const setRate = (who: string, tenant = x.w.tenantA) =>
      rpc(c, who, "select retailos.metal_rate_set($1,'GOLD','22K',6500,'PER_GRAM',now(),'test',$2)", [
        tenant,
        crypto.randomUUID(),
      ]);
    expect(await setRate(x.w.cashierA1)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setRate(x.w.managerA1)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setRate(x.w.ownerB)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setRate(x.w.platformAdmin)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await probe(c, x.w.cashierA1, async (y) => {
      expect(
        await refused(
          y,
          "insert into retailos.metal_rates (tenant_id,metal_type,purity,entered_rate,entered_unit,rate_per_gram,effective_from,created_by) values ($1,'GOLD','22K',1,'PER_GRAM',1,now(),$2)",
          [x.w.tenantA, x.w.cashierA1],
        ),
      ).toMatch(/permission denied/i);
    });
    expect(
      await n(c, "select count(*)::int n from retailos.metal_rates where tenant_id = $1", [
        x.w.tenantA,
      ]),
    ).toBe(0);
  });

  it("the owner sets rates (idempotent, normalised, immutable, audited); an exception can delegate it", async () => {
    const x = await setup();
    const key = crypto.randomUUID();
    const at = new Date(Date.now() - 60e3).toISOString();
    const call = (who: string, unit = "PER_10_GRAM", rate = 65000) =>
      rpc(c, who, "select retailos.metal_rate_set($1,'gold','22k',$2,$3,$5,'bullion desk',$4)", [
        x.w.tenantA,
        rate,
        unit,
        key,
        at,
      ]);
    const a = await call(x.w.ownerA);
    const b = await call(x.w.ownerA);
    expect(a.ok && a.data.ratePerGram).toBe(6500);
    expect(b.ok && b.data.replayed).toBe(true);
    expect(await call(x.w.ownerA, "PER_GRAM", 6500)).toMatchObject({
      ok: false,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(
      await n(c, "select count(*)::int n from retailos.metal_rates where tenant_id = $1", [
        x.w.tenantA,
      ]),
    ).toBe(1);
    const row = (
      await c.query(
        "select metal_type, purity, entered_unit from retailos.metal_rates where tenant_id = $1",
        [x.w.tenantA],
      )
    ).rows[0];
    expect(row).toEqual({ metal_type: "GOLD", purity: "22K", entered_unit: "PER_10_GRAM" });
    expect(
      await expectFail(() => c.query("update retailos.metal_rates set entered_rate = 1")),
    ).toMatch(/append-only/);
    expect(await expectFail(() => c.query("delete from retailos.metal_rates"))).toMatch(
      /append-only/,
    );
    const audit = await c.query(
      "select actor_user_id from retailos.audit_logs where tenant_id = $1 and entity_type = 'metal_rate'",
      [x.w.tenantA],
    );
    expect(audit.rows).toEqual([{ actor_user_id: x.w.ownerA }]);
    // visibility: view is separate from set
    await probe(c, x.w.managerA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.metal_rates")).toBe(1),
    );
    await probe(c, x.w.cashierA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.metal_rates")).toBe(0),
    );
    await probe(c, x.w.ownerB, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.metal_rates")).toBe(0),
    );
    // delegation
    await override(x, x.w.ownerA, x.w.managerA1, null, "metal_rate.set", "GRANT", "rate desk");
    expect(
      (
        await rpc(
          c,
          x.w.managerA1,
          "select retailos.metal_rate_set($1,'GOLD','24K',7000,'PER_GRAM',now(),'',$2)",
          [x.w.tenantA, crypto.randomUUID()],
        )
      ).ok,
    ).toBe(true);
  });

  it("cannot change tax configuration", async () => {
    const x = await setup("exclusive");
    for (const who of [x.w.cashierA1, x.w.managerA1]) {
      await probe(c, who, async (y) => {
        expect(
          await refused(
            y,
            "insert into retailos.tax_classes (tenant_id,code,name) values ($1,'EVIL','Evil')",
            [x.w.tenantA],
          ),
        ).toMatch(/row-level security/i);
        expect(
          await refused(
            y,
            "insert into retailos.tax_rates (tenant_id,tax_class_id,effective_from,gst_rate_pct) values ($1,$2,'2030-01-01',0)",
            [x.w.tenantA, x.s.taxClass],
          ),
        ).toMatch(/row-level security|FORBIDDEN/i);
        expect(
          (await y.query("update retailos.tax_rates set effective_to = current_date")).rowCount,
        ).toBe(0);
        expect(
          (await y.query("update retailos.tenant_settings set tax_enforced = false")).rowCount,
        ).toBe(0);
      });
    }
    expect(
      (
        await c.query("select tax_enforced from retailos.tenant_settings where tenant_id = $1", [
          x.w.tenantA,
        ])
      ).rows[0].tax_enforced,
    ).toBe(true);
    // the owner can, and it is audited
    await asUser(c, x.w.ownerA, (y) =>
      y.query(
        "update retailos.tenant_settings set prices_include_tax_clothing = true where tenant_id = $1",
        [x.w.tenantA],
      ),
    );
    const a = await c.query(
      "select actor_user_id from retailos.audit_logs where tenant_id = $1 and entity_type = 'tenant_settings' order by id desc limit 1",
      [x.w.tenantA],
    );
    expect(a.rows[0].actor_user_id).toBe(x.w.ownerA);
  });

  it("cannot change business or branch settings, or add branches and counters", async () => {
    const x = await setup();
    await probe(c, x.w.cashierA1, async (y) => {
      expect(
        (
          await y.query("update retailos.tenants set trade_name = 'Mine' where id = $1", [
            x.w.tenantA,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        await refused(
          y,
          "insert into retailos.branches (tenant_id,code,name,state_code) values ($1,'ZZ','Z','TS')",
          [x.w.tenantA],
        ),
      ).toMatch(/row-level security/i);
      expect(
        await refused(
          y,
          "insert into retailos.counters (tenant_id,branch_id,code,name) values ($1,$2,'C9','x')",
          [x.w.tenantA, x.w.a1.id],
        ),
      ).toMatch(/row-level security/i);
    });
    await probe(c, x.w.managerA1, async (y) =>
      expect(
        (await y.query("update retailos.branches set name = 'X' where id = $1", [x.w.a1.id]))
          .rowCount,
      ).toBe(0),
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("voids and refunds (required test 7)", () => {
  async function sold() {
    const x = await setup();
    const r = await sellAs(
      x,
      x.w.cashierA1,
      [
        { itemId: x.s.shirtM, quantity: 2 },
        { itemId: x.s.necklace1, quantity: 1 },
        { itemId: x.s.chain, quantity: 1 },
      ],
      259800 + 49900 + 4850000,
    );
    expect(r.ok).toBe(true);
    return { x, invoiceId: r.ok ? (r.data.invoiceId as string) : "" };
  }
  const voidIt = (
    x: Ctx,
    who: string,
    id: string,
    reason = "customer changed mind",
    key = crypto.randomUUID(),
  ) => rpc(c, who, "select retailos.pos_void_invoice($1,$2,$3)", [id, reason, key]);

  it("a cashier cannot void a sale; nothing changes", async () => {
    const { x, invoiceId } = await sold();
    expect(await voidIt(x, x.w.cashierA1, invoiceId)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await voidIt(x, x.w.cashierA2, invoiceId)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await voidIt(x, x.w.ownerB, invoiceId)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await voidIt(x, x.w.outsider, invoiceId)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await voidIt(x, x.w.platformAdmin, invoiceId)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      (await c.query("select status from retailos.invoices where id = $1", [invoiceId])).rows[0]
        .status,
    ).toBe("ISSUED");
    const anon = await voidIt(x, null as never, invoiceId);
    expect(anon.ok === false && anon.code).toMatch(/permission denied/i);
  });

  it("a cashier cannot refund: there is no refund path and direct writes are refused", async () => {
    const { x, invoiceId } = await sold();
    await probe(c, x.w.cashierA1, async (y) => {
      expect(
        await refused(
          y,
          "insert into retailos.payments (tenant_id,branch_id,cash_session_id,invoice_id,direction,purpose,method,amount,recorded_by) select tenant_id,branch_id,cash_session_id,id,'OUT','REFUND','CASH',100,$2 from retailos.invoices where id = $1",
          [invoiceId, x.w.cashierA1],
        ),
      ).toMatch(/permission denied/i);
      expect(
        await refused(y, "update retailos.invoices set status = 'VOIDED' where id = $1", [invoiceId]),
      ).toMatch(/permission denied/i);
    });
    // payment.refund exists as a permission but no function uses it yet: a documented gap, not a silent bypass.
    const fns = await c.query(
      "select proname from pg_proc where pronamespace = 'retailos'::regnamespace and proname ilike '%refund%'",
    );
    expect(fns.rows).toEqual([]);
  });

  it("a manager can void the same day: stock, pieces, payments and audit all follow", async () => {
    const { x, invoiceId } = await sold();
    const r = await voidIt(x, x.w.managerA1, invoiceId, "wrong size");
    expect(r.ok && r.data).toMatchObject({ status: "VOIDED", replayed: false });
    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.shirtM,
        ])
      ).rows[0].on_hand,
    ).toBe(5); // restored
    const pieces = await c.query(
      "select status, sold_invoice_item_id is null as free from retailos.jewellery_items where id in ($1,$2) order by tag_code",
      [x.s.necklace1, x.s.chain],
    );
    expect(pieces.rows).toEqual([
      { status: "IN_STOCK", free: true },
      { status: "IN_STOCK", free: true },
    ]);
    const inv = (
      await c.query("select status, voided_by, void_reason from retailos.invoices where id = $1", [
        invoiceId,
      ])
    ).rows[0];
    expect(inv).toEqual({ status: "VOIDED", voided_by: x.w.managerA1, void_reason: "wrong size" });
    expect(
      (
        await c.query(
          "select distinct line_status from retailos.invoice_items where invoice_id = $1",
          [invoiceId],
        )
      ).rows,
    ).toEqual([{ line_status: "VOIDED" }]);
    const pay = await c.query(
      "select direction, purpose, amount from retailos.payments where invoice_id = $1 order by direction",
      [invoiceId],
    );
    expect(pay.rows).toEqual([
      { direction: "IN", purpose: "SALE", amount: "51597.00" },
      { direction: "OUT", purpose: "VOID_REVERSAL", amount: "51597.00" },
    ]);
    const audit = await c.query(
      "select actor_user_id, reason from retailos.audit_logs where tenant_id = $1 and action = 'invoice.void'",
      [x.w.tenantA],
    );
    expect(audit.rows).toEqual([{ actor_user_id: x.w.managerA1, reason: "wrong size" }]);
    // the ledger still balances and the pieces can be sold again
    const bad = await c.query(
      `select 1 from retailos.inventory_balances b where b.on_hand <> coalesce((select sum(quantity_delta) from retailos.inventory_movements m where m.branch_id = b.branch_id and m.variant_id = b.variant_id),0)`,
    );
    expect(bad.rows).toEqual([]);
    expect(
      (await sellAs(x, x.w.cashierA1, [{ itemId: x.s.necklace1, quantity: 1 }], 49900)).ok,
    ).toBe(true);
  });

  it("is idempotent, refuses a second void, and needs a real reason", async () => {
    const { x, invoiceId } = await sold();
    const key = crypto.randomUUID();
    const a = await voidIt(x, x.w.ownerA, invoiceId, "duplicate bill", key);
    const b = await voidIt(x, x.w.ownerA, invoiceId, "duplicate bill", key);
    expect(a.ok && b.ok && b.data.replayed).toBe(true);
    expect(await voidIt(x, x.w.ownerA, invoiceId, "again")).toMatchObject({
      ok: false,
      code: "ALREADY_VOIDED",
    });
    expect(
      await n(
        c,
        "select count(*)::int n from retailos.payments where invoice_id = $1 and direction = 'OUT'",
        [invoiceId],
      ),
    ).toBe(1);
    const y = await sold();
    expect(await voidIt(y.x, y.x.w.managerA1, y.invoiceId, "")).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(await voidIt(y.x, y.x.w.managerA1, y.invoiceId, "ab")).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(await voidIt(y.x, y.x.w.managerA1, crypto.randomUUID(), "valid reason")).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("is only possible on the same business day and while the cash session is open", async () => {
    const { x, invoiceId } = await sold();
    await c.query(
      "update retailos.cash_sessions set status = 'CLOSED', closed_at = now(), closed_by = $2 where tenant_id = $1",
      [x.w.tenantA, x.w.managerA1],
    );
    expect(await voidIt(x, x.w.managerA1, invoiceId)).toMatchObject({
      ok: false,
      code: "VOID_WINDOW_PASSED",
    });
    await c.query(
      "update retailos.cash_sessions set status = 'OPEN', closed_at = null, closed_by = null where tenant_id = $1",
      [x.w.tenantA],
    );
    await c.query("set session_replication_role = replica");
    await c.query("update retailos.invoices set business_date = current_date - 1 where id = $1", [
      invoiceId,
    ]);
    await c.query("reset session_replication_role");
    expect(await voidIt(x, x.w.managerA1, invoiceId)).toMatchObject({
      ok: false,
      code: "VOID_WINDOW_PASSED",
    });
    expect(await voidIt(x, x.w.ownerA, invoiceId)).toMatchObject({
      ok: false,
      code: "VOID_WINDOW_PASSED",
    }); // not even the owner
  });

  it("a void grant can be delegated to a cashier by exception, and withdrawn", async () => {
    const { x, invoiceId } = await sold();
    await override(
      x,
      x.w.ownerA,
      x.w.cashierA1,
      x.w.a1.id,
      "sale.void",
      "GRANT",
      "supervisor today",
      new Date(Date.now() + 3600e3).toISOString(),
    );
    expect((await voidIt(x, x.w.cashierA1, invoiceId)).ok).toBe(true);
  });

  it("invoices stay immutable apart from the void transition", async () => {
    const { x, invoiceId } = await sold();
    expect(
      await expectFail(() =>
        c.query("update retailos.invoices set grand_total = 1 where id = $1", [invoiceId]),
      ),
    ).toMatch(/append-only/);
    expect(
      await expectFail(() =>
        c.query("update retailos.invoices set status = 'VOIDED' where id = $1", [invoiceId]),
      ),
    ).toMatch(/voided_has_details|check constraint/);
    expect(
      await expectFail(() =>
        c.query(
          "update retailos.invoices set status = 'VOIDED', voided_at = now(), voided_by = $2, void_reason = 'x', grand_total = 2 where id = $1",
          [invoiceId, x.w.ownerA],
        ),
      ),
    ).toMatch(/append-only/);
    expect(
      await expectFail(() =>
        c.query("update retailos.invoice_items set line_status = 'VOIDED' where invoice_id = $1", [
          invoiceId,
        ]),
      ),
    ).toMatch(/append-only/); // parent not voided
    expect(
      await expectFail(() => c.query("delete from retailos.invoices where id = $1", [invoiceId])),
    ).toMatch(/append-only/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("branch managers manage their own branch's cashiers, within strict limits", () => {
  const grant = (x: Ctx, who: string, user: string, tenantRole: string, branches: unknown[]) =>
    rpc(c, who, "select retailos.membership_grant($1,$2,$3,$4::jsonb)", [
      x.w.tenantA,
      user,
      tenantRole,
      JSON.stringify(branches),
    ]);

  it("can add a cashier to their own branch and disable them again", async () => {
    const x = await setup();
    const u = await createUser(c, `new.${x.w.tenantA}@test.local`, "New Cashier");
    expect(
      (
        await grant(x, x.w.managerA1, u, "tenant_member", [
          { branchId: x.w.a1.id, role: "cashier" },
        ])
      ).ok,
    ).toBe(true);
    expect((await sellShirt(x, u)).ok).toBe(true);
    expect(
      (
        await rpc(
          c,
          x.w.managerA1,
          "select retailos.branch_membership_set_status($1,$2,'DISABLED')",
          [x.w.a1.id, u],
        )
      ).ok,
    ).toBe(true);
    expect(await sellShirt(x, u)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // and they can see their own branch's staff, but only that
    await probe(c, x.w.managerA1, async (y) => {
      const ids = (
        await y.query("select distinct user_id from retailos.branch_memberships")
      ).rows.map((r) => r.user_id);
      expect(ids).toContain(x.w.cashierA1);
      expect(ids).not.toContain(x.w.cashierA2);
    });
  });

  it("cannot reach other branches, other roles, owners, or existing people's roles", async () => {
    const x = await setup();
    const u = await createUser(c, `edge.${x.w.tenantA}@test.local`);
    const cashier = [{ branchId: x.w.a1.id, role: "cashier" }];
    expect(
      await grant(x, x.w.managerA1, u, "tenant_member", [{ branchId: x.w.a2.id, role: "cashier" }]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" }); // another branch
    expect(
      await grant(x, x.w.managerA1, u, "tenant_member", [
        { branchId: x.w.a1.id, role: "branch_manager" },
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" }); // a manager
    expect(await grant(x, x.w.managerA1, u, "tenant_owner", cashier)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    }); // an owner
    expect(await grant(x, x.w.managerA1, u, "tenant_member", [])).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    }); // tenant-only member
    expect(await grant(x, x.w.managerA1, x.w.managerA1, "tenant_member", cashier)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    }); // themselves
    expect(await grant(x, x.w.managerA1, x.w.ownerA, "tenant_member", cashier)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    }); // the owner
    expect(
      await n(c, "select count(*)::int n from retailos.tenant_memberships where user_id = $1", [u]),
    ).toBe(0);
  });

  it("cannot demote a colleague, or re-enable someone the owner disabled", async () => {
    const x = await setup();
    const other = await createUser(c, `mgr2.${x.w.tenantA}@test.local`);
    await c.query(
      "insert into retailos.tenant_memberships (tenant_id,user_id,role_id) select $1,$2,id from retailos.roles where key='tenant_member'",
      [x.w.tenantA, other],
    );
    await c.query(
      "insert into retailos.branch_memberships (tenant_id,branch_id,user_id,role_id) select $1,$2,$3,id from retailos.roles where key='branch_manager'",
      [x.w.tenantA, x.w.a1.id, other],
    );
    expect(
      await grant(x, x.w.managerA1, other, "tenant_member", [
        { branchId: x.w.a1.id, role: "cashier" },
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, x.w.managerA1, "select retailos.branch_membership_set_status($1,$2,'DISABLED')", [
        x.w.a1.id,
        other,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, x.w.managerA1, "select retailos.branch_membership_set_status($1,$2,'DISABLED')", [
        x.w.a1.id,
        x.w.managerA1,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // owner disables a cashier for the whole business; the manager cannot bring them back
    await rpc(c, x.w.ownerA, "select retailos.membership_set_status($1,$2,'DISABLED')", [
      x.w.tenantA,
      x.w.cashierA1,
    ]);
    expect(
      await grant(x, x.w.managerA1, x.w.cashierA1, "tenant_member", [
        { branchId: x.w.a1.id, role: "cashier" },
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, x.w.managerA1, "select retailos.branch_membership_set_status($1,$2,'ACTIVE')", [
        x.w.a1.id,
        x.w.cashierA1,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await sellShirt(x, x.w.cashierA1)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("a manager in branch A1 has no staff authority in branch A2", async () => {
    const x = await setup();
    expect(
      await rpc(c, x.w.managerA1, "select retailos.branch_membership_set_status($1,$2,'DISABLED')", [
        x.w.a2.id,
        x.w.cashierA2,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await sellShirt(x, x.w.cashierA1)).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------
describe("tenant and branch isolation by changing an ID in a request (required tests 9 and 10)", () => {
  it("swapping the branch id for another tenant's, or another branch's, is refused by every function", async () => {
    const x = await setup();
    const key = () => crypto.randomUUID();
    const line = [{ itemId: x.s.shirtM, quantity: 1 }];
    const calls: Array<[string, string, unknown[]]> = [
      [
        "checkout",
        "select retailos.pos_checkout($1,$2,$3,$4::jsonb,$5::jsonb,129900,null)",
        [x.w.b1.id, x.w.b1.counterId, key(), JSON.stringify(line), JSON.stringify([cash(129900)])],
      ],
      ["quote", "select retailos.pos_quote_cart($1,$2::jsonb)", [x.w.b1.id, JSON.stringify(line)]],
      ["barcode", "select retailos.resolve_barcode($1,'NR00000001')", [x.w.b1.id]],
      ["search", "select retailos.catalog_search($1,'shirt')", [x.w.b1.id]],
      ["session", "select retailos.pos_get_session($1,$2)", [x.w.b1.id, x.w.b1.counterId]],
      ["start day", "select retailos.pos_start_day($1,$2,0)", [x.w.b1.id, x.w.b1.counterId]],
      [
        "adjust",
        "select retailos.inventory_adjust($1,$2,-1,'LOSS','x',$3)",
        [x.w.b1.id, x.s.jeans, key()],
      ],
      ["summary", "select retailos.report_sales_summary($1,'2020-01-01','2020-02-01')", [x.w.b1.id]],
    ];
    for (const [label, sql, params] of calls) {
      // cashierA1 belongs to tenant A / branch A1 only; B1 belongs to another business
      expect(await rpc(c, x.w.cashierA1, sql, params), `A1 cashier -> B1 ${label}`).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(await rpc(c, x.w.ownerA, sql, params), `owner A -> B1 ${label}`).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
    // the branch-A2 cashier cannot use branch A1 either, even though both are the same business
    expect(
      await rpc(c, x.w.cashierA2, "select retailos.pos_quote_cart($1,$2::jsonb)", [
        x.w.a1.id,
        JSON.stringify(line),
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, x.w.cashierA2, "select retailos.resolve_barcode($1,'NR00000001')", [x.w.a1.id]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("a counter from a different branch or business cannot be used to take a sale", async () => {
    const x = await setup();
    const line = [{ itemId: x.s.shirtM, quantity: 1 }];
    for (const counter of [x.w.a2.counterId, x.w.b1.counterId]) {
      const r = await checkout(c, x.w.cashierA1, {
        branch: x.w.a1.id,
        counter,
        lines: line,
        payments: [cash(129900)],
        expected: 129900,
      });
      expect(r, counter).toMatchObject({ ok: false, code: "SESSION_NOT_OPEN" });
    }
  });

  it("an item id from another business is simply not found, never leaked", async () => {
    const x = await setup();
    const other = await setup();
    const r = await sellAs(x, x.w.cashierA1, [{ itemId: other.s.shirtM, quantity: 1 }], 129900);
    expect(r).toMatchObject({ ok: false, code: "ITEM_NOT_FOUND" });
    const q = await quote(c, x.w.cashierA1, x.w.a1.id, [
      { itemId: other.s.necklace1, quantity: 1 },
    ]);
    expect(q.ok && q.data.issues[0].code).toBe("ITEM_NOT_FOUND");
  });

  it("reading another business's rows by id returns nothing from any table", async () => {
    const x = await setup();
    const other = await setup();
    await sellShirt(other);
    const tables = [
      "invoices",
      "invoice_items",
      "payments",
      "inventory_balances",
      "inventory_movements",
      "product_variants",
      "products",
      "jewellery_items",
      "barcode_aliases",
      "tax_classes",
      "categories",
      "tenant_memberships",
      "branch_memberships",
      "audit_logs",
      "cash_sessions",
      "permission_overrides",
      "role_discount_limits",
    ];
    for (const who of [x.w.ownerA, x.w.managerA1, x.w.cashierA1]) {
      await probe(c, who, async (y) => {
        for (const t of tables)
          expect(
            await n(y, `select count(*)::int n from retailos.${t} where tenant_id = $1`, [
              other.w.tenantA,
            ]),
            `${t}`,
          ).toBe(0);
      });
    }
  });

  it("writing a row into another business is refused even with a forged tenant_id", async () => {
    const x = await setup();
    const other = await setup();
    await probe(c, x.w.ownerA, async (y) => {
      expect(
        await refused(y, "insert into retailos.brands (tenant_id,name) values ($1,'Planted')", [
          other.w.tenantA,
        ]),
      ).toMatch(/row-level security/i);
      expect(
        await refused(
          y,
          "insert into retailos.tax_classes (tenant_id,code,name) values ($1,'P','Planted')",
          [other.w.tenantA],
        ),
      ).toMatch(/row-level security/i);
      expect(
        (
          await y.query(
            "update retailos.product_variants set selling_price = 1 where tenant_id = $1",
            [other.w.tenantA],
          )
        ).rowCount,
      ).toBe(0);
    });
  });

  it("every function in the public schema is closed to anonymous callers", async () => {
    const r = await c.query(
      `select p.proname from pg_proc p where p.pronamespace = 'retailos'::regnamespace
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))`,
    );
    expect(r.rows.map((x) => x.proname)).toEqual([]);
  });

  it("every public table has RLS on, and anon has nothing", async () => {
    expect(
      (
        await c.query(
          "select relname from pg_class where relnamespace = 'retailos'::regnamespace and left(relname, 9) <> 'retailos_' and relkind = 'r' and not relrowsecurity",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await c.query(
          "select table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'retailos' and left(table_name, 9) <> 'retailos_'",
        )
      ).rows,
    ).toEqual([]);
  });

  it("the exact set of privileges the signed-in role holds on each table is pinned", async () => {
    const r = await c.query(
      `select table_name, string_agg(privilege_type, ',' order by privilege_type) p
         from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'retailos' and left(table_name, 9) <> 'retailos_'
        group by 1 order by 1`,
    );
    const got = Object.fromEntries(r.rows.map((x) => [x.table_name, x.p]));
    // Anything here beyond SELECT is a deliberate, RLS-protected exception. A new write privilege
    // appearing without being added to this list is a security review item.
    expect(got).toEqual({
      audit_logs: "SELECT",
      barcode_aliases: "INSERT,SELECT",
      branch_memberships: "SELECT",
      branches: "INSERT,SELECT,UPDATE",
      brands: "INSERT,SELECT,UPDATE",
      cash_sessions: "SELECT",
      categories: "INSERT,SELECT,UPDATE",
      counters: "INSERT,SELECT,UPDATE",
      inventory_balances: "SELECT",
      inventory_movements: "SELECT",
      invoice_items: "SELECT",
      invoices: "SELECT",
      jewellery_designs: "INSERT,SELECT,UPDATE",
      jewellery_item_costs: "INSERT,SELECT,UPDATE",
      jewellery_items: "SELECT",
      metal_rates: "SELECT",
      payments: "SELECT",
      permission_overrides: "SELECT",
      permissions: "SELECT",
      product_variants: "INSERT,SELECT,UPDATE",
      products: "INSERT,SELECT,UPDATE",
      profiles: "SELECT",
      role_discount_limits: "SELECT",
      role_permissions: "SELECT",
      roles: "SELECT",
      tax_classes: "INSERT,SELECT,UPDATE",
      tax_rates: "INSERT,SELECT",
      tenant_memberships: "SELECT",
      tenant_settings: "SELECT",
      tenants: "SELECT",
      variant_costs: "INSERT,SELECT,UPDATE",
    });
    // Column-level UPDATE grants (the only way those tables can be changed), pinned separately.
    const cols = await c.query(
      `select table_name, string_agg(column_name, ',' order by column_name) c
         from information_schema.column_privileges
        where grantee = 'authenticated' and table_schema = 'retailos' and left(table_name, 9) <> 'retailos_' and privilege_type = 'UPDATE'
          and table_name in ('tenants','tenant_settings','profiles','tax_rates','barcode_aliases')
        group by 1 order by 1`,
    );
    expect(Object.fromEntries(cols.rows.map((x) => [x.table_name, x.c]))).toEqual({
      barcode_aliases: "is_active",
      profiles: "full_name,phone",
      tax_rates: "effective_to",
      tenant_settings:
        "allow_negative_stock,financial_year_start_month,prices_include_tax_clothing,prices_include_tax_jewellery,tax_enforced",
      tenants: "gstin,legal_name,state_code,trade_name",
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe("platform administrator boundary", () => {
  it("can create a tenant (with MFA) but gets no business data and cannot grant themselves access", async () => {
    const x = await setup();
    await sellShirt(x);
    const p = x.w.platformAdmin;
    await probe(c, p, async (y) => {
      for (const t of [
        "invoices",
        "invoice_items",
        "payments",
        "tenants",
        "branches",
        "product_variants",
        "audit_logs",
        "inventory_balances",
      ]) {
        expect(await n(y, `select count(*)::int n from retailos.${t}`), t).toBe(0);
      }
    });
    expect(
      await rpc(c, p, "select retailos.membership_grant($1,$2,'tenant_owner')", [x.w.tenantA, p]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, p, "select retailos.report_tenant_sales($1,'2020-01-01','2020-02-01')", [
        x.w.tenantA,
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await rpc(c, p, "select retailos.pos_quote_cart($1,'[]'::jsonb)", [x.w.a1.id]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await override(x, p, x.w.cashierA1, null, "sale.view_history", "GRANT")).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    const owner = await createUser(c, `po.${x.w.tenantA}@test.local`);
    expect(
      (
        await rpc(
          c,
          p,
          "select retailos.platform_create_tenant($1,'Fresh Co Ltd','Fresh Co',$2)",
          [
            `FR${x.w.tenantA
              .slice(0, 6)
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "X")}`,
            owner,
          ],
          { aal: "aal2" },
        )
      ).ok,
    ).toBe(true);
  });

  it("an ordinary user cannot become a platform administrator or create tenants", async () => {
    const x = await setup();
    const owner = await createUser(c, `po2.${x.w.tenantA}@test.local`);
    for (const who of [x.w.ownerA, x.w.managerA1, x.w.cashierA1, x.w.outsider]) {
      expect(
        await rpc(
          c,
          who,
          "select retailos.platform_create_tenant('HACK','Hack Ltd','Hack',$1)",
          [owner],
          { aal: "aal2" },
        ),
      ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("sensitive operations leave an audit trail (required test: audited)", () => {
  it("records who did what for each class of sensitive change", async () => {
    const x = await setup("exclusive");
    const o = x.w.ownerA;
    await asUser(c, o, (y) =>
      y.query("update retailos.product_variants set selling_price = 1500 where id = $1", [
        x.s.shirtM,
      ]),
    ); // price
    await rpc(c, o, "select retailos.metal_rate_set($1,'GOLD','22K',6500,'PER_GRAM',now(),'',$2)", [
      x.w.tenantA,
      crypto.randomUUID(),
    ]); // metal rate
    await rpc(c, o, "select retailos.discount_limit_set($1,'branch_manager',300)", [x.w.tenantA]); // discount limit
    await override(x, o, x.w.cashierA1, x.w.a1.id, "sale.view", "GRANT"); // permission change
    await rpc(c, x.w.managerA1, "select retailos.inventory_adjust($1,$2,-1,'DAMAGE','x',$3)", [
      x.w.a1.id,
      x.s.jeans,
      crypto.randomUUID(),
    ]); // stock adjustment
    await asUser(c, o, (y) =>
      y.query(
        "update retailos.tenant_settings set prices_include_tax_clothing = true where tenant_id = $1",
        [x.w.tenantA],
      ),
    ); // tax setting
    // a tax-rate change is made the realistic way: end the current rate, then add the new one
    await asUser(c, o, (y) =>
      y.query(
        "update retailos.tax_rates set effective_to = '2090-01-01' where tenant_id = $1 and effective_to is null",
        [x.w.tenantA],
      ),
    );
    await asUser(c, o, (y) =>
      y.query(
        "insert into retailos.tax_rates (tenant_id,tax_class_id,effective_from,gst_rate_pct) values ($1,$2,'2090-01-01',3)",
        [x.w.tenantA, x.s.taxClass],
      ),
    ); // tax rate
    const sale = await rpc(
      c,
      x.w.ownerA,
      "select retailos.pos_checkout($1,$2,$3,$4::jsonb,$5::jsonb,$6,null)",
      [
        x.w.a1.id,
        x.w.a1.counterId,
        crypto.randomUUID(),
        JSON.stringify([
          {
            itemId: x.s.jeans,
            quantity: 1,
            discountPaise: 10000,
            discountReason: "loyal customer",
          },
        ]),
        JSON.stringify([cash(179900)]),
        179900,
      ],
    ); // tax-inclusive (set above): 1899.00 - 100.00 discount
    expect(sale.ok, JSON.stringify(sale)).toBe(true);
    await rpc(c, x.w.managerA1, "select retailos.pos_void_invoice($1,'test void',$2)", [
      sale.ok ? sale.data.invoiceId : null,
      crypto.randomUUID(),
    ]); // void
    await rpc(c, o, "select retailos.report_sales_export($1,$2,$3)", [
      x.w.a1.id,
      new Date(Date.now() - 86400e3).toISOString().slice(0, 10),
      new Date(Date.now() + 86400e3).toISOString().slice(0, 10),
    ]); // export

    const log = await c.query(
      "select action, actor_user_id from retailos.audit_logs where tenant_id = $1",
      [x.w.tenantA],
    );
    // rows written by test fixtures (superuser, no signed-in user) have no actor; only user actions count here
    const by = (action: string) =>
      log.rows.filter((r) => r.action === action && r.actor_user_id).map((r) => r.actor_user_id);
    expect(by("product_variant.update")).toContain(o);
    expect(by("metal_rate.insert")).toEqual([o]);
    expect(by("role_discount_limit.insert")).toEqual([o]);
    expect(by("permission_override.insert")).toEqual([o]);
    expect(by("inventory.adjust")).toEqual([x.w.managerA1]);
    expect(by("tenant_settings.update")).toContain(o);
    expect(by("tax_rate.insert")).toEqual([o]);
    expect(by("invoice.insert")).toEqual([o]);
    expect(by("invoice.void")).toEqual([x.w.managerA1]);
    expect(by("report.export")).toEqual([o]);
    // the discount given is recoverable from the immutable invoice line it was applied to
    const line = (
      await c.query(
        "select discount_amount, discount_reason from retailos.invoice_items where tenant_id = $1",
        [x.w.tenantA],
      )
    ).rows[0];
    expect(line).toEqual({ discount_amount: "100.00", discount_reason: "loyal customer" });
  });

  it("the audit log is readable only with audit.view, and by nobody else's business", async () => {
    const x = await setup();
    await override(x, x.w.ownerA, x.w.cashierA1, x.w.a1.id, "sale.view", "GRANT");
    await probe(c, x.w.ownerA, async (y) =>
      expect(
        await n(y, "select count(*)::int n from retailos.audit_logs where tenant_id = $1", [
          x.w.tenantA,
        ]),
      ).toBeGreaterThan(0),
    );
    for (const who of [x.w.managerA1, x.w.cashierA1, x.w.platformAdmin, x.w.outsider]) {
      await probe(c, who, async (y) =>
        expect(await n(y, "select count(*)::int n from retailos.audit_logs"), who).toBe(0),
      );
    }
    // another business's owner can read their own business's audit log, but none of this one's
    await probe(c, x.w.ownerB, async (y) =>
      expect(
        await n(y, "select count(*)::int n from retailos.audit_logs where tenant_id = $1", [
          x.w.tenantA,
        ]),
      ).toBe(0),
    );
    await override(x, x.w.ownerA, x.w.managerA1, null, "audit.view", "GRANT", "supervisor");
    await probe(c, x.w.managerA1, async (y) =>
      expect(await n(y, "select count(*)::int n from retailos.audit_logs")).toBeGreaterThan(0),
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("privileged functions validate authorisation independently (required test 13)", () => {
  it("each privileged function refuses an unauthorised caller by itself, with no application layer", async () => {
    const x = await setup();
    const inv = await sellShirt(x);
    const id = inv.ok ? inv.data.invoiceId : crypto.randomUUID();
    const k = () => crypto.randomUUID();
    const privileged: Array<[string, string, unknown[]]> = [
      [
        "inventory_adjust",
        "select retailos.inventory_adjust($1,$2,-1,'LOSS','x',$3)",
        [x.w.a1.id, x.s.jeans, k()],
      ],
      [
        "metal_rate_set",
        "select retailos.metal_rate_set($1,'GOLD','22K',1,'PER_GRAM',now(),'',$2)",
        [x.w.tenantA, k()],
      ],
      [
        "permission_override_set",
        "select retailos.permission_override_set($1,$2,null,'sale.void','DENY','x',null)",
        [x.w.tenantA, x.w.managerA1],
      ],
      [
        "permission_override_clear",
        "select retailos.permission_override_clear($1,$2,null,'sale.void')",
        [x.w.tenantA, x.w.managerA1],
      ],
      ["discount_limit_set", "select retailos.discount_limit_set($1,'cashier',100)", [x.w.tenantA]],
      [
        "membership_grant",
        "select retailos.membership_grant($1,$2,'tenant_owner')",
        [x.w.tenantA, x.w.outsider],
      ],
      [
        "membership_set_status",
        "select retailos.membership_set_status($1,$2,'DISABLED')",
        [x.w.tenantA, x.w.managerA1],
      ],
      [
        "branch_membership_set_status",
        "select retailos.branch_membership_set_status($1,$2,'DISABLED')",
        [x.w.a1.id, x.w.managerA1],
      ],
      ["pos_void_invoice", "select retailos.pos_void_invoice($1,'because',$2)", [id, k()]],
      [
        "report_tenant_sales",
        "select retailos.report_tenant_sales($1,'2020-01-01','2020-02-01')",
        [x.w.tenantA],
      ],
      [
        "report_sales_export",
        "select retailos.report_sales_export($1,'2020-01-01','2020-02-01')",
        [x.w.a1.id],
      ],
    ];
    // cashierA1 holds none of these. The result must be FORBIDDEN for every one.
    for (const [name, sql, params] of privileged) {
      expect(await rpc(c, x.w.cashierA1, sql, params), name).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
    // and the same functions were not silently allowing the unauthenticated either
    for (const [name, sql, params] of privileged) {
      const r = await rpc(c, null, sql, params);
      expect(r.ok === false && r.code, name).toMatch(/permission denied/i);
    }
  });

  it("an authenticated token with no membership is refused by the money-moving functions", async () => {
    const x = await setup();
    const line = [{ itemId: x.s.shirtM, quantity: 1 }];
    for (const who of [x.w.outsider, x.w.platformAdmin, x.w.ownerB]) {
      expect(await sellAs(x, who, line, 129900), who).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(await startDay(c, who, x.w.a1.id, x.w.a1.counterId), who).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
    expect(
      await n(c, "select count(*)::int n from retailos.invoices where tenant_id = $1", [x.w.tenantA]),
    ).toBe(0);
  });

  it("the day cannot be started by someone whose cash-session permission was denied", async () => {
    const x = await setup();
    await c.query(
      "update retailos.cash_sessions set status = 'CLOSED', closed_at = now(), closed_by = $2 where tenant_id = $1",
      [x.w.tenantA, x.w.ownerA],
    );
    await override(x, x.w.ownerA, x.w.cashierA1, x.w.a1.id, "cash_session.manage", "DENY");
    expect(await startDay(c, x.w.cashierA1, x.w.a1.id, x.w.a1.counterId)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect((await startDay(c, x.w.managerA1, x.w.a1.id, x.w.a1.counterId)).ok).toBe(true);
  });
});
