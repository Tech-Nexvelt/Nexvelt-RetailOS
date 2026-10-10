/**
 * REHEARSAL of docs/proposals/product-images.sql (a proposal, not a migration). It runs the proposal file exactly as written against
 * a fresh local database with a minimal STAND-IN for Supabase's `storage` schema, then tries to break tenant isolation and the
 * permission rules. It proves the SQL logic. It does NOT prove Supabase Storage itself (signed URLs, size and MIME enforcement by the
 * storage service): those need the real project after you approve the change.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { asUser, refused, startDb, type TestDb } from "./harness";
import { buildWorld, type World } from "./fixtures";

const STAND_IN = `
create schema if not exists storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;`;

let db: TestDb;
let c: Client;
let w: World;
let productA: string;
let designA: string;
const path = (tenant: string, kind: "products" | "jewellery", owner: string) => `${tenant}/${kind}/${owner}/${randomUUID()}.jpg`;
const put = (x: Client, name: string, bucket = "product-images") => x.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]);

beforeAll(async () => {
  db = await startDb();
  c = db.admin;
  w = await buildWorld(c);
  await c.query(STAND_IN);
  await c.query(fs.readFileSync("docs/proposals/product-images.sql", "utf8"));
  await asUser(c, w.ownerA, async (x) => {
    const p = (await x.query("select retailos.catalog_create_clothing($1, 'Image Test Shirt', 'IMG-1', 'Shirts', null, $2::jsonb, $3) as r", [w.a1.id, JSON.stringify([{ size: "M", colour: "Blue", pricePaise: 10000 }]), randomUUID()])).rows[0].r;
    productA = p.productId;
    const j = (await x.query("select retailos.catalog_create_jewellery($1, 'IMITATION', 'Image Test Ring', 'Rings', null, 9900, null, null, null, null, null, null, $2) as r", [w.a1.id, randomUUID()])).rows[0].r;
    designA = j.designId;
  });
}, 120000);
afterAll(async () => {
  await db?.stop();
});

describe("proposal SQL applies cleanly and sets up exactly what it says", () => {
  it("creates a PRIVATE 5 MB bucket limited to JPEG/PNG/WebP, the two columns, the guards and three policies (no update policy)", async () => {
    const b = (await c.query("select id, public, file_size_limit::int fsl, allowed_mime_types from storage.buckets")).rows;
    expect(b).toEqual([{ id: "product-images", public: false, fsl: 5242880, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] }]);
    const cols = (await c.query("select table_name from information_schema.columns where table_schema='retailos' and column_name='image_path' order by 1")).rows.map((r) => r.table_name);
    expect(cols).toEqual(["jewellery_designs", "products"]);
    const pol = (await c.query("select policyname, cmd from pg_policies where schemaname='storage' and tablename='objects' order by 1")).rows;
    expect(pol).toEqual([{ policyname: "product_images_delete", cmd: "DELETE" }, { policyname: "product_images_insert", cmd: "INSERT" }, { policyname: "product_images_read", cmd: "SELECT" }]);
  });
  it("the helper functions are closed to anonymous callers", async () => {
    const r = (await c.query("select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('public', p.oid, 'execute') pub from pg_proc p where p.proname like 'image_path_%' and p.pronamespace = 'retailos_private'::regnamespace")).rows;
    expect(r.length).toBe(4);
    for (const x of r) expect({ n: x.proname, a: x.a, pub: x.pub }).toEqual({ n: x.proname, a: false, pub: false });
  });
});

describe("storage policies: who may upload, read and delete", () => {
  it("an owner uploads under their own tenant and can read it back", async () => {
    const name = path(w.tenantA, "products", productA);
    await asUser(c, w.ownerA, async (x) => {
      await put(x, name);
      expect((await x.query("select count(*)::int n from storage.objects where name = $1", [name])).rows[0].n).toBe(1);
    });
  });
  it("a manager may upload exactly when the existing permission system gives them product.edit", async () => {
    const may = await asUser(c, w.managerA1, async (x) => (await x.query("select retailos_private.has_tenant_permission($1, 'product.edit') as p", [w.tenantA])).rows[0].p as boolean);
    const name = path(w.tenantA, "products", productA);
    await asUser(c, w.managerA1, async (x) => {
      if (may) await put(x, name);
      else expect(await refused(x, "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [name])).toBeTruthy();
    });
  });
  it("a cashier can SEE tenant images (they show in billing) but cannot upload or delete", async () => {
    const existing = path(w.tenantA, "products", productA);
    await c.query("insert into storage.objects (bucket_id, name) values ('product-images', $1)", [existing]);
    await asUser(c, w.cashierA1, async (x) => {
      expect((await x.query("select count(*)::int n from storage.objects where name = $1", [existing])).rows[0].n).toBe(1);
      expect(await refused(x, "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [path(w.tenantA, "products", productA)])).toBeTruthy();
      expect((await x.query("delete from storage.objects where name = $1", [existing])).rowCount).toBe(0);
    });
    expect((await c.query("select count(*)::int n from storage.objects where name = $1", [existing])).rows[0].n).toBe(1);
  });
  it("another tenant's owner cannot upload into, read, or delete this tenant's images", async () => {
    const mine = path(w.tenantA, "products", productA);
    await c.query("insert into storage.objects (bucket_id, name) values ('product-images', $1)", [mine]);
    await asUser(c, w.ownerB, async (x) => {
      expect(await refused(x, "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [path(w.tenantA, "products", productA)])).toBeTruthy();
      expect((await x.query("select count(*)::int n from storage.objects where name = $1", [mine])).rows[0].n).toBe(0);
      expect((await x.query("delete from storage.objects where name = $1", [mine])).rowCount).toBe(0);
      expect((await x.query("select count(*)::int n from storage.objects where name like $1", [`${w.tenantA}/%`])).rows[0].n).toBe(0);
    });
    expect((await c.query("select count(*)::int n from storage.objects where name = $1", [mine])).rows[0].n).toBe(1);
  });
  it("a signed-in outsider with no membership and an anonymous caller get nothing", async () => {
    await asUser(c, w.outsider, async (x) => {
      expect(await refused(x, "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [path(w.tenantA, "products", productA)])).toBeTruthy();
      expect((await x.query("select count(*)::int n from storage.objects")).rows[0].n).toBe(0);
    });
    await asUser(c, null, async (x) => {
      expect(await refused(x, "select count(*) from storage.objects")).toBeTruthy();
    });
  });
  it("malformed or manipulated names are refused even for the owner of the tenant", async () => {
    const ok = productA;
    const bad = [
      `${w.tenantA}/products/${ok}/../${randomUUID()}.jpg`, // traversal
      `${w.tenantA}/products/${ok}/${randomUUID()}.gif`, // unsupported extension
      `${w.tenantA}/products/${ok}/${randomUUID()}.JPG`, // upper case
      `${w.tenantA}/other/${ok}/${randomUUID()}.jpg`, // unknown kind
      `not-a-tenant/products/${ok}/${randomUUID()}.jpg`, // first folder not a tenant id
      `${w.tenantA}/products/${randomUUID()}.jpg`, // missing owner folder
      `${w.tenantA}/products/${ok}/${randomUUID()}.jpg/extra`,
      `${w.tenantA}//products/${ok}/${randomUUID()}.jpg`,
      `${w.tenantB}/../${w.tenantA}/products/${ok}/${randomUUID()}.jpg`, // another tenant first, ours smuggled behind it
    ];
    await asUser(c, w.ownerA, async (x) => {
      for (const n of bad) expect(await refused(x, "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [n]), n).toBeTruthy();
      // and not into any other bucket
      expect(await refused(x, "insert into storage.objects (bucket_id, name) values ($1, $2)", ["avatars", path(w.tenantA, "products", ok)])).toBeTruthy();
    });
  });
  it("objects are immutable: nobody, including the owner, can overwrite or rename one (a replacement is a new file)", async () => {
    const name = path(w.tenantA, "products", productA);
    await c.query("insert into storage.objects (bucket_id, name) values ('product-images', $1)", [name]);
    await asUser(c, w.ownerA, async (x) => {
      expect((await x.query("update storage.objects set name = $2 where name = $1", [name, path(w.tenantA, "products", productA)])).rowCount).toBe(0);
    });
  });
  it("the owner can delete their own old image (after a replacement has been saved)", async () => {
    const name = path(w.tenantA, "products", productA);
    await c.query("insert into storage.objects (bucket_id, name) values ('product-images', $1)", [name]);
    await asUser(c, w.ownerA, async (x) => {
      expect((await x.query("delete from storage.objects where name = $1", [name])).rowCount).toBe(1);
    });
  });
});

describe("image_path guard: a reference can only point at this row's own, same-tenant file", () => {
  it("accepts the product's own path, clears it with NULL, and records an audit entry on change only", async () => {
    const mine = path(w.tenantA, "products", productA);
    await asUser(c, w.ownerA, async (x) => {
      expect((await x.query("update retailos.products set image_path = $1 where id = $2", [mine, productA])).rowCount).toBe(1);
      expect((await x.query("update retailos.products set name = name where id = $1", [productA])).rowCount).toBe(1); // no image change: no new audit row
      expect((await x.query("update retailos.products set image_path = null where id = $1", [productA])).rowCount).toBe(1);
    });
    const a = (await c.query("select action, before->>'image_path' b, after->>'image_path' a from retailos.audit_logs where entity_type='product_image' and entity_id = $1 order by id", [productA])).rows;
    expect(a.map((r) => r.action)).toEqual(["product_image.update", "product_image.update"]);
    expect(a[0]).toMatchObject({ b: null, a: mine });
    expect(a[1]).toMatchObject({ b: mine, a: null });
  });
  it("refuses another tenant's path, another product's path, the wrong kind, and junk", async () => {
    const other = (await c.query("select id from retailos.products where tenant_id = $1 limit 1", [w.tenantA])).rows[0].id;
    void other;
    const elsewhere = randomUUID();
    const bad = [path(w.tenantB, "products", productA), path(w.tenantA, "products", elsewhere), path(w.tenantA, "jewellery", productA), "../../etc/passwd", "x".repeat(50), ""];
    await asUser(c, w.ownerA, async (x) => {
      for (const p of bad) expect(await refused(x, "update retailos.products set image_path = $1 where id = $2", [p, productA]), p).toBeTruthy();
    });
    expect((await c.query("select image_path from retailos.products where id = $1", [productA])).rows[0].image_path).toBeNull();
  });
  it("jewellery designs use their own folder kind and id", async () => {
    const mine = path(w.tenantA, "jewellery", designA);
    await asUser(c, w.ownerA, async (x) => {
      expect((await x.query("update retailos.jewellery_designs set image_path = $1 where id = $2", [mine, designA])).rowCount).toBe(1);
      expect(await refused(x, "update retailos.jewellery_designs set image_path = $1 where id = $2", [path(w.tenantA, "products", designA), designA])).toBeTruthy();
      expect(await refused(x, "update retailos.jewellery_designs set image_path = $1 where id = $2", [path(w.tenantB, "jewellery", designA), designA])).toBeTruthy();
    });
    expect((await c.query("select image_path from retailos.jewellery_designs where id = $1", [designA])).rows[0].image_path).toBe(mine);
  });
  it("the existing row-level rules still stop another tenant's user from touching these rows at all", async () => {
    await asUser(c, w.ownerB, async (x) => {
      expect((await x.query("update retailos.products set image_path = null where id = $1", [productA])).rowCount).toBe(0);
    });
  });
  it("existing product creation is unaffected: new products still have no image", async () => {
    expect((await c.query("select count(*)::int n from retailos.products where image_path is not null")).rows[0].n).toBe(0);
  });
});
