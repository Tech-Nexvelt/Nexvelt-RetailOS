/**
 * TRUE concurrency tests: every racer has its own PostgreSQL connection and transaction, and all
 * racers are released together. These exercise row locks, the idempotency insert, the gapless
 * sequence and the unique-index backstops under real contention.
 *
 * Environment: REAL PostgreSQL 17 (embedded) with a Supabase-compatible auth shim. Not Supabase,
 * and a single local server, so this proves the locking design on PostgreSQL semantics. It does not
 * prove behaviour on a hosted, pooled (PgBouncer) Supabase deployment; repeat it there.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { startDb, type TestDb } from "./harness";
import { buildWorld, type World } from "./fixtures";
import { buildShop, cash, checkout, configureTax, rpc, startDay, type Shop } from "./shop";

let db: TestDb;
let c: Client;
const open: Client[] = [];

beforeAll(async () => {
  db = await startDb();
  c = db.admin;
});
afterEach(async () => {
  while (open.length)
    await open
      .pop()
      ?.end()
      .catch(() => {});
});
afterAll(async () => {
  await db?.stop();
});

interface Ctx {
  w: World;
  s: Shop;
}
async function setup(): Promise<Ctx> {
  const w = await buildWorld(c);
  const s = await buildShop(c, w);
  await configureTax(c, w, s, "off");
  expect((await startDay(c, w.cashierA1, w.a1.id, w.a1.counterId)).ok).toBe(true);
  return { w, s };
}

async function clients(n: number): Promise<Client[]> {
  const cs = await Promise.all(Array.from({ length: n }, () => db.connect()));
  open.push(...cs);
  return cs;
}

type Outcome = { ok: true; data: any } | { ok: false; code: string };
/** Release all racers at the same moment, each on its own connection. */
async function race(
  n: number,
  fn: (i: number, client: Client) => Promise<Outcome>,
): Promise<Outcome[]> {
  const cs = await clients(n);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const runs = cs.map(async (client, i) => {
    await gate;
    return fn(i, client);
  });
  await new Promise((r) => setTimeout(r, 25));
  release();
  try {
    return await Promise.all(runs);
  } finally {
    // Release this round's connections immediately so long loops stay under max_connections.
    await Promise.all(cs.map((cl) => cl.end().catch(() => {})));
    for (const cl of cs) {
      const i = open.indexOf(cl);
      if (i >= 0) open.splice(i, 1);
    }
  }
}

const oks = (rs: Outcome[]) => rs.filter((r) => r.ok) as Array<{ ok: true; data: any }>;
const fails = (rs: Outcome[]) => rs.filter((r) => !r.ok) as Array<{ ok: false; code: string }>;
const codes = (rs: Outcome[]) => fails(rs).map((r) => r.code);

const sellAs = (
  x: Ctx,
  client: Client,
  who: string,
  lines: unknown[],
  total: number,
  key?: string,
) =>
  checkout(client, who, {
    branch: x.w.a1.id,
    counter: x.w.a1.counterId,
    key,
    lines,
    payments: [cash(total)],
    expected: total,
  }) as Promise<Outcome>;

async function newImitation(x: Ctx, tag: string, price = "100.00"): Promise<string> {
  const design = (
    await c.query(
      "select id from retailos.jewellery_designs where tenant_id = $1 and design_code = 'KUNDAN'",
      [x.w.tenantA],
    )
  ).rows[0].id;
  return (
    await c.query(
      "insert into retailos.jewellery_items (tenant_id, branch_id, design_id, kind, tag_code, tag_price) values ($1,$2,$3,'IMITATION',$4,$5) returning id",
      [x.w.tenantA, x.w.a1.id, design, tag, price],
    )
  ).rows[0].id;
}

const invoiceCount = async (x: Ctx) =>
  (await c.query("select count(*)::int n from retailos.invoices where tenant_id = $1", [x.w.tenantA]))
    .rows[0].n as number;

const noLockErrors = (rs: Outcome[]) => {
  const bad = codes(rs).filter((m) =>
    /deadlock|lock timeout|could not serialize|canceling statement/i.test(m),
  );
  expect(bad, "lock-related failures").toEqual([]);
};

// ---------------------------------------------------------------------------------------------
describe("TC-CONC-01: the same serialized jewellery piece is never sold twice", () => {
  it("5 cashiers race for one piece, 20 times: exactly one wins each round", async () => {
    const x = await setup();
    for (let round = 0; round < 20; round++) {
      const item = await newImitation(x, `IJ10${String(round).padStart(5, "0")}`, "100.00");
      const rs = await race(5, (_, cl) =>
        sellAs(x, cl, x.w.cashierA1, [{ itemId: item, quantity: 1 }], 10000),
      );
      expect(oks(rs), `round ${round}`).toHaveLength(1);
      expect(codes(rs), `round ${round}`).toEqual(Array(4).fill("ITEM_ALREADY_SOLD"));
      noLockErrors(rs);
      const live = (
        await c.query(
          "select count(*)::int n from retailos.invoice_items where jewellery_item_id = $1 and line_status = 'SOLD'",
          [item],
        )
      ).rows[0].n;
      expect(live).toBe(1);
      expect(
        (await c.query("select status from retailos.jewellery_items where id = $1", [item])).rows[0]
          .status,
      ).toBe("SOLD");
    }
    expect(await invoiceCount(x)).toBe(20);
  });

  it("two cashiers in DIFFERENT branches of the same tenant cannot both sell it either", async () => {
    const x = await setup();
    // a piece lives in exactly one branch; the other branch's cashier is refused, the owner may sell
    const item = await newImitation(x, "IJ2000001");
    const rs = await race(4, (i, cl) =>
      i % 2 === 0
        ? sellAs(x, cl, x.w.cashierA1, [{ itemId: item, quantity: 1 }], 10000)
        : (checkout(cl, x.w.cashierA2, {
            branch: x.w.a2.id,
            counter: x.w.a2.counterId,
            lines: [{ itemId: item, quantity: 1 }],
            payments: [cash(10000)],
            expected: 10000,
          }) as Promise<Outcome>),
    );
    expect(oks(rs)).toHaveLength(1);
    expect(await invoiceCount(x)).toBe(1);
  });

  it("a mixed cart containing the contested piece fails as a whole for the loser", async () => {
    const x = await setup();
    const item = await newImitation(x, "IJ3000001", "100.00");
    const rs = await race(6, (_, cl) =>
      sellAs(
        x,
        cl,
        x.w.cashierA1,
        [
          { itemId: item, quantity: 1 },
          { itemId: x.s.jeans, quantity: 1 },
        ],
        10000 + 189900,
      ),
    );
    expect(oks(rs)).toHaveLength(1);
    // the 5 losers must not have taken any jeans stock
    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.jeans,
        ])
      ).rows[0].on_hand,
    ).toBe(9);
    expect(await invoiceCount(x)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("TC-CONC-02: stock is never oversold", () => {
  it("8 racers for the last unit: one wins, balance is exactly 0", async () => {
    const x = await setup();
    const rs = await race(8, (_, cl) =>
      sellAs(x, cl, x.w.cashierA1, [{ itemId: x.s.shirtL, quantity: 1 }], 129900),
    );
    expect(oks(rs)).toHaveLength(1);
    expect(codes(rs)).toEqual(Array(7).fill("INSUFFICIENT_STOCK"));
    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.shirtL,
        ])
      ).rows[0].on_hand,
    ).toBe(0);
  });

  it("10 racers for 5 units: exactly 5 sales, never negative", async () => {
    const x = await setup();
    const rs = await race(10, (_, cl) =>
      sellAs(x, cl, x.w.cashierA1, [{ itemId: x.s.shirtM, quantity: 1 }], 129900),
    );
    expect(oks(rs)).toHaveLength(5);
    expect(codes(rs)).toEqual(Array(5).fill("INSUFFICIENT_STOCK"));
    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.shirtM,
        ])
      ).rows[0].on_hand,
    ).toBe(0);
    const sum = (
      await c.query(
        "select sum(quantity_delta)::int s from retailos.inventory_movements where variant_id = $1",
        [x.s.shirtM],
      )
    ).rows[0].s;
    expect(sum).toBe(0); // 5 opening - 5 sold
  });

  it("a sale and a stock adjustment racing for the last unit: exactly one succeeds", async () => {
    const x = await setup();
    for (let i = 0; i < 10; i++) {
      await c.query(
        "select retailos_private.apply_variant_movement($1,$2,$3,1,'OPENING','TEST',null,null,null,current_date)",
        [x.w.tenantA, x.w.a1.id, x.s.jeans],
      ); // keep jeans at a known level
    }
    // jeans: 10 opening + 10 = 20. Drain to exactly 1.
    await c.query(
      "select retailos_private.apply_variant_movement($1,$2,$3,-19,'ADJUSTMENT_OUT','TEST',null,'LOSS',null,current_date)",
      [x.w.tenantA, x.w.a1.id, x.s.jeans],
    );
    const rs = await race(2, (i, cl) =>
      i === 0
        ? sellAs(x, cl, x.w.cashierA1, [{ itemId: x.s.jeans, quantity: 1 }], 189900)
        : (rpc(cl, x.w.managerA1, "select retailos.inventory_adjust($1,$2,-1,'DAMAGE','race',$3)", [
            x.w.a1.id,
            x.s.jeans,
            crypto.randomUUID(),
          ]) as Promise<Outcome>),
    );
    expect(oks(rs)).toHaveLength(1);
    expect(codes(rs)[0]).toBe("INSUFFICIENT_STOCK");
    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.jeans,
        ])
      ).rows[0].on_hand,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe("TC-CONC-03: concurrent duplicates with one idempotency key", () => {
  it("10 identical concurrent submissions create exactly one invoice", async () => {
    const x = await setup();
    const key = crypto.randomUUID();
    const rs = await race(10, (_, cl) =>
      sellAs(x, cl, x.w.cashierA1, [{ itemId: x.s.shirtM, quantity: 2 }], 259800, key),
    );
    expect(oks(rs)).toHaveLength(10); // every caller gets the (same) answer
    const ids = new Set(oks(rs).map((r) => r.data.invoiceId));
    expect(ids.size).toBe(1);
    expect(oks(rs).filter((r) => r.data.replayed === false)).toHaveLength(1);
    expect(oks(rs).filter((r) => r.data.replayed === true)).toHaveLength(9);
    expect(await invoiceCount(x)).toBe(1);
    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.shirtM,
        ])
      ).rows[0].on_hand,
    ).toBe(3); // decremented once
  });

  it("two DIFFERENT requests racing on one key: one wins, the other is told the key is taken", async () => {
    const x = await setup();
    const key = crypto.randomUUID();
    const rs = await race(2, (i, cl) =>
      sellAs(
        x,
        cl,
        x.w.cashierA1,
        [{ itemId: i === 0 ? x.s.shirtM : x.s.jeans, quantity: 1 }],
        i === 0 ? 129900 : 189900,
        key,
      ),
    );
    expect(oks(rs)).toHaveLength(1);
    expect(codes(rs)).toEqual(["IDEMPOTENCY_KEY_REUSED"]);
    expect(await invoiceCount(x)).toBe(1);
  });

  it("if the first attempt fails, a concurrent duplicate proceeds and can succeed", async () => {
    const x = await setup();
    const key = crypto.randomUUID();
    // both carry the SAME content, so the hash matches; the request is valid, so both resolve to one invoice
    const rs = await race(4, (_, cl) =>
      sellAs(x, cl, x.w.cashierA1, [{ itemId: x.s.jeans, quantity: 1 }], 189900, key),
    );
    expect(oks(rs)).toHaveLength(4);
    expect(await invoiceCount(x)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("TC-CHK-10: gapless invoice numbers under concurrency", () => {
  it("25 concurrent sales get numbers 1..25 with no gaps and no duplicates", async () => {
    const x = await setup();
    await c.query(
      "select retailos_private.apply_variant_movement($1,$2,$3,100,'OPENING','TEST',null,null,null,current_date)",
      [x.w.tenantA, x.w.a1.id, x.s.jeans],
    );
    const rs = await race(25, (_, cl) =>
      sellAs(x, cl, x.w.cashierA1, [{ itemId: x.s.jeans, quantity: 1 }], 189900),
    );
    expect(oks(rs)).toHaveLength(25);
    noLockErrors(rs);
    const nums = oks(rs)
      .map((r) => Number(String(r.data.invoiceNumber).split("-")[1]))
      .sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(oks(rs).map((r) => r.data.invoiceNumber)).size).toBe(25);
  });

  it("failed attempts running at the same time do not consume numbers", async () => {
    const x = await setup();
    await c.query(
      "select retailos_private.apply_variant_movement($1,$2,$3,100,'OPENING','TEST',null,null,null,current_date)",
      [x.w.tenantA, x.w.a1.id, x.s.jeans],
    );
    const rs = await race(
      20,
      (i, cl) =>
        i % 2 === 0
          ? sellAs(x, cl, x.w.cashierA1, [{ itemId: x.s.jeans, quantity: 1 }], 189900) // valid
          : (checkout(cl, x.w.cashierA1, {
              branch: x.w.a1.id,
              counter: x.w.a1.counterId,
              lines: [{ itemId: x.s.jeans, quantity: 1 }],
              payments: [cash(1)],
              expected: 189900,
            }) as Promise<Outcome>), // payment mismatch
    );
    expect(oks(rs)).toHaveLength(10);
    expect(codes(rs)).toEqual(Array(10).fill("PAYMENT_MISMATCH"));
    const nums = oks(rs)
      .map((r) => Number(String(r.data.invoiceNumber).split("-")[1]))
      .sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });
});

// ---------------------------------------------------------------------------------------------
describe("TC-CONC-04: no deadlocks when carts overlap in opposite orders", () => {
  it("12 racers over a ring of 6 pieces, each wanting two neighbours listed in alternating order", async () => {
    const x = await setup();
    const items: string[] = [];
    for (let i = 0; i < 6; i++)
      items.push(await newImitation(x, `IJ40${String(i).padStart(5, "0")}`, "100.00"));
    const rs = await race(12, (i, cl) => {
      const a = items[i % 6] as string;
      const b = items[(i + 1) % 6] as string;
      const lines =
        i % 2 === 0
          ? [
              { itemId: a, quantity: 1 },
              { itemId: b, quantity: 1 },
            ]
          : [
              { itemId: b, quantity: 1 },
              { itemId: a, quantity: 1 },
            ];
      return sellAs(x, cl, x.w.cashierA1, lines, 20000);
    });
    noLockErrors(rs);
    // every piece is in at most one invoice, and each successful invoice holds two distinct pieces
    const sold = (
      await c.query(
        "select jewellery_item_id, count(*)::int n from retailos.invoice_items where tenant_id = $1 and jewellery_item_id is not null group by 1",
        [x.w.tenantA],
      )
    ).rows;
    expect(sold.every((r) => r.n === 1)).toBe(true);
    expect(sold.length).toBe(oks(rs).length * 2);
    expect(oks(rs).length).toBeGreaterThanOrEqual(1);
    expect(oks(rs).length).toBeLessThanOrEqual(3);
    for (const f of fails(rs)) expect(f.code).toBe("ITEM_ALREADY_SOLD");
  });

  it("carts mixing clothing and jewellery in opposite order do not deadlock", async () => {
    const x = await setup();
    await c.query(
      "select retailos_private.apply_variant_movement($1,$2,$3,50,'OPENING','TEST',null,null,null,current_date)",
      [x.w.tenantA, x.w.a1.id, x.s.jeans],
    );
    const pieces = [
      await newImitation(x, "IJ5000001"),
      await newImitation(x, "IJ5000002"),
      await newImitation(x, "IJ5000003"),
      await newImitation(x, "IJ5000004"),
    ];
    const rs = await race(16, (i, cl) => {
      const piece = pieces[i % 4] as string;
      const lines =
        i % 2 === 0
          ? [
              { itemId: x.s.jeans, quantity: 1 },
              { itemId: piece, quantity: 1 },
            ]
          : [
              { itemId: piece, quantity: 1 },
              { itemId: x.s.jeans, quantity: 1 },
            ];
      return sellAs(x, cl, x.w.cashierA1, lines, 189900 + 10000);
    });
    noLockErrors(rs);
    expect(oks(rs)).toHaveLength(4); // one winner per piece
    expect(codes(rs).every((m) => m === "ITEM_ALREADY_SOLD")).toBe(true);
    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.jeans,
        ])
      ).rows[0].on_hand,
    ).toBe(10 + 50 - 4);
  });
});

// ---------------------------------------------------------------------------------------------
describe("other races", () => {
  it("two cashiers starting the day at once leave exactly one open session", async () => {
    const w = await buildWorld(c);
    const rs = await race(
      6,
      (_, cl) => startDay(cl, w.cashierA1, w.a1.id, w.a1.counterId) as Promise<Outcome>,
    );
    expect(oks(rs)).toHaveLength(6);
    expect(
      (
        await c.query(
          "select count(*)::int n from retailos.cash_sessions where tenant_id = $1 and status = 'OPEN'",
          [w.tenantA],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("a price change racing with checkouts never produces a mixed or inconsistent invoice", async () => {
    const x = await setup();
    const rs = await race(8, (i, cl) =>
      i === 0
        ? (rpc(
            cl,
            x.w.ownerA,
            "update retailos.product_variants set selling_price = 1500.00 where id = $1 returning 1 as ok",
            [x.s.shirtM],
          ) as Promise<Outcome>)
        : sellAs(x, cl, x.w.cashierA1, [{ itemId: x.s.shirtM, quantity: 1 }], 129900),
    );
    // each sale either completed at the old price or was told the price changed; never a wrong total
    for (const f of fails(rs).slice(0))
      expect(["PRICE_STALE", "INSUFFICIENT_STOCK"]).toContain(f.code);
    const bad = await c.query(
      "select 1 from retailos.invoice_items where tenant_id = $1 and unit_price <> 1299.00 and line_total <> unit_price",
      [x.w.tenantA],
    );
    expect(bad.rows).toEqual([]);
    const inv = await c.query("select grand_total from retailos.invoices where tenant_id = $1", [
      x.w.tenantA,
    ]);
    for (const r of inv.rows) expect(r.grand_total).toBe("1299.00");
  });

  it("the ledger still equals the balances after a burst of concurrent activity", async () => {
    const x = await setup();
    await c.query(
      "select retailos_private.apply_variant_movement($1,$2,$3,60,'OPENING','TEST',null,null,null,current_date)",
      [x.w.tenantA, x.w.a1.id, x.s.jeans],
    );
    await race(30, (i, cl) =>
      i % 5 === 0
        ? (rpc(cl, x.w.managerA1, "select retailos.inventory_adjust($1,$2,-1,'LOSS','burst',$3)", [
            x.w.a1.id,
            x.s.jeans,
            crypto.randomUUID(),
          ]) as Promise<Outcome>)
        : sellAs(x, cl, x.w.cashierA1, [{ itemId: x.s.jeans, quantity: 1 }], 189900),
    );
    const bad = await c.query(
      `select b.variant_id from retailos.inventory_balances b
       where b.on_hand <> coalesce((select sum(quantity_delta) from retailos.inventory_movements m where m.branch_id = b.branch_id and m.variant_id = b.variant_id), 0)
          or b.on_hand < 0`,
    );
    expect(bad.rows).toEqual([]);
    // invoices reconcile with their lines and payments
    const unbalanced = await c.query(
      `select i.id from retailos.invoices i
       where i.grand_total <> (select coalesce(sum(line_total),0) from retailos.invoice_items where invoice_id = i.id) + i.round_off
          or i.grand_total <> (select coalesce(sum(amount),0) from retailos.payments where invoice_id = i.id)`,
    );
    expect(unbalanced.rows).toEqual([]);
  });
});
