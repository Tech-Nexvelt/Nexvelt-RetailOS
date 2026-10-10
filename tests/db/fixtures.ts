import type { Client } from "pg";

/** Fixtures are built as the superuser (bypassing RLS) so tests can then act as restricted users. */
export async function createUser(admin: Client, email: string, fullName = ""): Promise<string> {
  const r = await admin.query(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ full_name: fullName })],
  );
  // RetailOS adds no trigger on auth.users (a sign-up alone grants nothing). A profile is created explicitly,
  // exactly as the membership functions do it when someone is given access.
  await admin.query("select retailos_private.ensure_profile($1)", [r.rows[0].id]);
  return r.rows[0].id as string;
}

export async function roleId(admin: Client, key: string): Promise<string> {
  const r = await admin.query("select id from retailos.roles where key = $1 and tenant_id is null", [
    key,
  ]);
  return r.rows[0].id as string;
}

export async function createTenant(admin: Client, code: string): Promise<string> {
  const t = await admin.query(
    "insert into retailos.tenants (code, legal_name, trade_name) values ($1, $2, $2) returning id",
    [code, `${code} Retail`],
  );
  await admin.query("insert into retailos.tenant_settings (tenant_id) values ($1)", [t.rows[0].id]);
  return t.rows[0].id as string;
}

export async function createBranch(
  admin: Client,
  tenantId: string,
  code: string,
  stateCode = "TS",
): Promise<{ id: string; counterId: string }> {
  const b = await admin.query(
    "insert into retailos.branches (tenant_id, code, name, state_code) values ($1, $2, $2, $3) returning id",
    [tenantId, code, stateCode],
  );
  const c = await admin.query(
    "insert into retailos.counters (tenant_id, branch_id, code, name) values ($1, $2, 'C1', 'Counter 1') returning id",
    [tenantId, b.rows[0].id],
  );
  return { id: b.rows[0].id as string, counterId: c.rows[0].id as string };
}

export async function addTenantMember(
  admin: Client,
  tenantId: string,
  userId: string,
  role: string,
) {
  await admin.query(
    "insert into retailos.tenant_memberships (tenant_id, user_id, role_id) values ($1, $2, $3)",
    [tenantId, userId, await roleId(admin, role)],
  );
}

export async function addBranchMember(
  admin: Client,
  tenantId: string,
  branchId: string,
  userId: string,
  role: string,
) {
  await admin.query(
    "insert into retailos.branch_memberships (tenant_id, branch_id, user_id, role_id) values ($1, $2, $3, $4)",
    [tenantId, branchId, userId, await roleId(admin, role)],
  );
}

export interface World {
  tenantA: string;
  tenantB: string;
  a1: { id: string; counterId: string };
  a2: { id: string; counterId: string };
  b1: { id: string; counterId: string };
  ownerA: string;
  managerA1: string;
  cashierA1: string;
  cashierA2: string;
  ownerB: string;
  cashierB1: string;
  outsider: string;
  platformAdmin: string;
}

/** Two tenants. Tenant A has two branches. Tenant B has one. Plus an outsider with no membership. */
let seq = 0;
/** A short unique tag so many independent worlds can live in one database. */
export function uniqueTag(): string {
  seq += 1;
  return seq.toString(36).toUpperCase();
}

export async function buildWorld(admin: Client, tag = uniqueTag()): Promise<World> {
  const tenantA = await createTenant(admin, "AAA" + tag);
  const tenantB = await createTenant(admin, "BBB" + tag);
  const a1 = await createBranch(admin, tenantA, "A1");
  const a2 = await createBranch(admin, tenantA, "A2");
  const b1 = await createBranch(admin, tenantB, "B1");

  const ownerA = await createUser(admin, `owner.a.${tag}@test.local`, "Owner A");
  const managerA1 = await createUser(admin, `manager.a1.${tag}@test.local`, "Manager A1");
  const cashierA1 = await createUser(admin, `cashier.a1.${tag}@test.local`, "Cashier A1");
  const cashierA2 = await createUser(admin, `cashier.a2.${tag}@test.local`, "Cashier A2");
  const ownerB = await createUser(admin, `owner.b.${tag}@test.local`, "Owner B");
  const cashierB1 = await createUser(admin, `cashier.b1.${tag}@test.local`, "Cashier B1");
  const outsider = await createUser(admin, `outsider.${tag}@test.local`, "Outsider");
  const platformAdmin = await createUser(admin, `platform.${tag}@test.local`, "Platform Admin");
  await admin.query("insert into retailos.platform_admins (user_id) values ($1)", [platformAdmin]);

  await addTenantMember(admin, tenantA, ownerA, "tenant_owner");
  for (const u of [managerA1, cashierA1, cashierA2])
    await addTenantMember(admin, tenantA, u, "tenant_member");
  await addBranchMember(admin, tenantA, a1.id, managerA1, "branch_manager");
  await addBranchMember(admin, tenantA, a1.id, cashierA1, "cashier");
  await addBranchMember(admin, tenantA, a2.id, cashierA2, "cashier");

  await addTenantMember(admin, tenantB, ownerB, "tenant_owner");
  await addTenantMember(admin, tenantB, cashierB1, "tenant_member");
  await addBranchMember(admin, tenantB, b1.id, cashierB1, "cashier");

  return {
    tenantA,
    tenantB,
    a1,
    a2,
    b1,
    ownerA,
    managerA1,
    cashierA1,
    cashierA2,
    ownerB,
    cashierB1,
    outsider,
    platformAdmin,
  };
}
