import { describe, expect, it, vi } from "vitest";
import {
  confirmLink,
  inviteStaff,
  requestPasswordReset,
  setPassword,
  signIn,
  signOut,
  validateNewPassword,
  type AdminAuth,
  type AuthApi,
  type RpcCaller,
} from "./service";
import { buildContext, type ContextRows } from "./context";
import { ROLE_PERMISSIONS } from "@/domain/navigation";

const ok = { error: null };
function auth(over: Partial<AuthApi> = {}): AuthApi {
  return {
    signInWithPassword: vi.fn(async () => ok),
    signOut: vi.fn(async () => ok),
    resetPasswordForEmail: vi.fn(async () => ok),
    updateUser: vi.fn(async () => ok),
    getUser: vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null })),
    verifyOtp: vi.fn(async () => ok),
    ...over,
  };
}

describe("sign-in", () => {
  it("signs in and sends the user to a safe destination", async () => {
    const a = auth();
    const r = await signIn(a, {
      email: " Owner@Shop.COM ",
      password: "secret-password",
      next: "/reports",
    });
    expect(r).toEqual({ ok: true, redirectTo: "/reports" });
    expect(a.signInWithPassword).toHaveBeenCalledWith({
      email: "owner@shop.com",
      password: "secret-password",
    });
  });

  it("never redirects to another site or a protocol-relative URL", async () => {
    for (const next of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "evil",
      "/ok\nSet-Cookie:x",
    ]) {
      const r = await signIn(auth(), { email: "a@b.co", password: "x", next });
      expect(r, next).toEqual({ ok: true, redirectTo: "/billing" });
    }
  });

  it("gives one message for a wrong password, an unknown email and an unconfirmed account", async () => {
    const msgs = new Set<string>();
    for (const message of ["Invalid login credentials", "Email not confirmed", "User not found"]) {
      const r = await signIn(auth({ signInWithPassword: async () => ({ error: { message } }) }), {
        email: "a@b.co",
        password: "x",
      });
      expect(r.ok).toBe(false);
      msgs.add((r as { message: string }).message);
    }
    expect(msgs.size).toBe(1);
    expect([...msgs][0]).not.toMatch(/exist|found|confirm|invalid login/i);
  });

  it("explains rate limiting without revealing anything else", async () => {
    const r = await signIn(
      auth({ signInWithPassword: async () => ({ error: { message: "x", status: 429 } }) }),
      { email: "a@b.co", password: "x" },
    );
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/too many/i) });
  });

  it("does not call the provider for malformed input", async () => {
    const a = auth();
    for (const raw of [
      { email: "", password: "x" },
      { email: "not-an-email", password: "x" },
      { email: "a@b.co", password: "" },
      { email: 5, password: {} },
    ]) {
      expect((await signIn(a, raw as never)).ok).toBe(false);
    }
    expect(a.signInWithPassword).not.toHaveBeenCalled();
  });

  it("sign-out returns to the login page", async () => {
    const a = auth();
    expect(await signOut(a)).toEqual({ ok: true, redirectTo: "/login" });
    expect(a.signOut).toHaveBeenCalled();
  });
});

describe("password recovery", () => {
  it("reports success whether or not the email has an account, and even if the provider fails", async () => {
    const messages = new Set<string>();
    for (const resetPasswordForEmail of [
      async () => ok,
      async () => ({ error: { message: "User not found" } }),
      async () => {
        throw new Error("network");
      },
    ]) {
      const r = await requestPasswordReset(
        auth({ resetPasswordForEmail }),
        "https://app.example",
        "someone@shop.com",
      );
      expect(r.ok).toBe(true);
      messages.add((r as { message: string }).message);
    }
    expect(messages.size).toBe(1);
  });

  it("builds the link from the configured site address, not from the request", async () => {
    const a = auth();
    await requestPasswordReset(a, "https://app.example", "someone@shop.com");
    expect(a.resetPasswordForEmail).toHaveBeenCalledWith("someone@shop.com", {
      redirectTo: "https://app.example/auth/confirm?next=/auth/set-password",
    });
  });

  it("rejects a malformed address without calling the provider", async () => {
    const a = auth();
    expect((await requestPasswordReset(a, "https://app.example", "nope")).ok).toBe(false);
    expect(a.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("applies a password policy", () => {
    expect(validateNewPassword("short", "short")).toMatch(/at least 10/);
    expect(validateNewPassword("a".repeat(73), "a".repeat(73))).toMatch(/at most 72/);
    expect(validateNewPassword("aaaaaaaaaaaa", "aaaaaaaaaaaa")).toMatch(/repeated/);
    expect(validateNewPassword("a-good-passphrase", "different")).toMatch(/do not match/);
    expect(validateNewPassword("a-good-passphrase", "a-good-passphrase")).toBeNull();
    expect(validateNewPassword(undefined, undefined)).not.toBeNull();
  });

  it("sets a new password only for a verified session", async () => {
    const a = auth();
    expect(await setPassword(a, "a-good-passphrase", "a-good-passphrase")).toEqual({
      ok: true,
      redirectTo: "/billing",
    });
    expect(a.updateUser).toHaveBeenCalledWith({ password: "a-good-passphrase" });
    const none = auth({ getUser: async () => ({ data: { user: null }, error: null }) });
    expect(await setPassword(none, "a-good-passphrase", "a-good-passphrase")).toMatchObject({
      ok: false,
    });
    expect(none.updateUser).not.toHaveBeenCalled();
  });

  it("accepts only the three link types, and only with a token", async () => {
    expect((await confirmLink(auth(), "tok", "invite", null)).ok).toBe(true);
    expect((await confirmLink(auth(), "tok", "recovery", "/auth/set-password")).ok).toBe(true);
    for (const [tok, type] of [
      [null, "invite"],
      ["tok", "magiclink"],
      ["tok", null],
      ["", "recovery"],
      ["tok", "admin"],
    ] as const) {
      expect((await confirmLink(auth(), tok, type, null)).ok, `${tok}/${type}`).toBe(false);
    }
    expect(await confirmLink(auth(), "tok", "recovery", "//evil.com")).toEqual({
      ok: true,
      redirectTo: "/auth/set-password",
    });
    expect(
      (
        await confirmLink(
          auth({ verifyOtp: async () => ({ error: { message: "expired" } }) }),
          "tok",
          "invite",
          null,
        )
      ).ok,
    ).toBe(false);
  });
});

describe("staff invitations", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  const B1 = "22222222-2222-4222-8222-222222222222";
  const B2 = "33333333-3333-4333-8333-333333333333";
  const roles = { o: "r-o", m: "r-m", c: "r-c", t: "r-t" };
  const rolePermissions = [
    ...ROLE_PERMISSIONS.owner.map((p) => ({ role_id: roles.o, permission_key: p })),
    ...ROLE_PERMISSIONS.manager.map((p) => ({ role_id: roles.m, permission_key: p })),
    ...ROLE_PERMISSIONS.cashier.map((p) => ({ role_id: roles.c, permission_key: p })),
  ];
  const rows = (over: Partial<ContextRows>): ContextRows => ({
    userId: "inviter",
    email: null,
    tenantMemberships: [],
    branchMemberships: [],
    roles: [
      { id: roles.o, key: "tenant_owner" },
      { id: roles.t, key: "tenant_member" },
      { id: roles.m, key: "branch_manager" },
      { id: roles.c, key: "cashier" },
    ],
    rolePermissions,
    tenants: [{ id: T, code: "T", trade_name: "Shop", status: "ACTIVE" }],
    branches: [
      { id: B1, tenant_id: T, code: "B1", name: "One", status: "ACTIVE" },
      { id: B2, tenant_id: T, code: "B2", name: "Two", status: "ACTIVE" },
    ],
    counters: [],
    overrides: [],
    ...over,
  });
  const ownerCtx = buildContext(rows({ tenantMemberships: [{ tenant_id: T, role_id: roles.o }] }));
  const managerCtx = buildContext(
    rows({
      tenantMemberships: [{ tenant_id: T, role_id: roles.t }],
      branchMemberships: [{ branch_id: B1, role_id: roles.m }],
    }),
  );
  const cashierCtx = buildContext(
    rows({
      tenantMemberships: [{ tenant_id: T, role_id: roles.t }],
      branchMemberships: [{ branch_id: B1, role_id: roles.c }],
    }),
  );

  function deps(
    ctx: ReturnType<typeof buildContext>,
    input: unknown,
    over: { admin?: AdminAuth | null; rpcError?: boolean } = {},
  ) {
    const invite = vi.fn(async () => ({ data: { user: { id: "new-user" } }, error: null }));
    const rpc = vi.fn(async () => ({ error: over.rpcError ? { message: "FORBIDDEN" } : null }));
    const admin: AdminAuth | null =
      over.admin === undefined ? { inviteUserByEmail: invite } : over.admin;
    return {
      invite,
      rpc,
      d: { ctx, admin, userClient: { rpc } as RpcCaller, siteUrl: "https://app.example", input },
    };
  }
  const good = {
    tenantId: T,
    email: "New.Staff@Shop.com",
    fullName: "New Staff",
    tenantRole: "tenant_member",
    branchRoles: [{ branchId: B1, role: "cashier" }],
  };

  it("sends the invitation with a display name only, then grants access as the inviter", async () => {
    const { d, invite, rpc } = deps(ownerCtx, good);
    expect(await inviteStaff(d)).toMatchObject({ ok: true });
    expect(invite).toHaveBeenCalledWith("new.staff@shop.com", {
      data: { full_name: "New Staff" },
      redirectTo: "https://app.example/auth/confirm?next=/auth/set-password",
    });
    const meta = (invite.mock.calls[0] as unknown as [string, { data: Record<string, unknown> }])[1]
      .data;
    expect(Object.keys(meta)).toEqual(["full_name"]); // no role, tenant or admin flag travels in user metadata
    expect(rpc).toHaveBeenCalledWith("membership_grant", {
      p_tenant: T,
      p_user: "new-user",
      p_tenant_role: "tenant_member",
      p_branch_roles: good.branchRoles,
    });
  });

  it("refuses a cashier before contacting the auth provider", async () => {
    const { d, invite, rpc } = deps(cashierCtx, good);
    expect(await inviteStaff(d)).toMatchObject({ ok: false });
    expect(invite).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets a branch manager invite a cashier into their own branch only", async () => {
    expect((await inviteStaff(deps(managerCtx, good).d)).ok).toBe(true);
    for (const branchRoles of [
      [{ branchId: B2, role: "cashier" }], // another branch
      [{ branchId: B1, role: "branch_manager" }], // a manager
      [
        { branchId: B1, role: "cashier" },
        { branchId: B2, role: "cashier" },
      ],
      [], // tenant-wide member with no branch
    ]) {
      const { d, invite } = deps(managerCtx, { ...good, branchRoles });
      expect((await inviteStaff(d)).ok, JSON.stringify(branchRoles)).toBe(false);
      expect(invite).not.toHaveBeenCalled();
    }
  });

  it("cannot be used to request the owner role, an unknown role, or extra fields", async () => {
    for (const input of [
      { ...good, tenantRole: "tenant_owner" },
      { ...good, tenantRole: "platform_admin" },
      { ...good, branchRoles: [{ branchId: B1, role: "tenant_owner" }] },
      { ...good, role: "tenant_owner" },
      { ...good, branchRoles: [{ branchId: B1, role: "cashier", permissions: ["*"] }] },
      { ...good, tenantId: "not-a-uuid" },
      { ...good, email: "bad" },
      { ...good, fullName: "" },
    ]) {
      const { d, invite } = deps(ownerCtx, input);
      expect((await inviteStaff(d)).ok, JSON.stringify(input)).toBe(false);
      expect(invite).not.toHaveBeenCalled();
    }
  });

  it("reports honestly when the server cannot invite or the grant is refused", async () => {
    expect(await inviteStaff(deps(ownerCtx, good, { admin: null }).d)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/not set up/i),
    });
    expect(await inviteStaff(deps(ownerCtx, good, { rpcError: true }).d)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/access could not be set up/i),
    });
  });
});
