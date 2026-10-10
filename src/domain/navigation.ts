/**
 * Role-aware navigation. The five workspaces (UX plan §2) are shown only when the user holds at least
 * one of the permissions that make the workspace useful. Items a user may not open are omitted
 * entirely, never shown disabled. This decides what to DISPLAY. It is not security: every page,
 * server action and database function re-checks the permission on its own.
 *
 * Permission keys are the ones in the database (supabase/migrations/…_tenancy.sql).
 */
export type NavKey = "billing" | "products" | "sales" | "reports" | "settings";

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  /** Any one of these permissions grants access to the workspace. */
  anyOf: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { key: "billing", label: "Billing", href: "/billing", anyOf: ["sale.create"] },
  {
    key: "products",
    label: "Products & Stock",
    href: "/products",
    // product.view alone (needed to search while billing) does NOT open the stock workspace.
    anyOf: [
      "product.create",
      "product.edit",
      "product.price_edit",
      "inventory.view",
      "purchase.manage",
    ],
  },
  { key: "sales", label: "Sales", href: "/sales", anyOf: ["sale.view", "sale.view_history"] },
  { key: "reports", label: "Reports", href: "/reports", anyOf: ["report.view"] },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    anyOf: [
      "settings.manage",
      "staff.manage",
      "roles.manage",
      "branch.manage",
      "tax.manage",
      "metal_rate.view",
    ],
  },
];

export type PermissionSet = ReadonlySet<string> | readonly string[];
const has = (perms: PermissionSet, p: string) =>
  Array.isArray(perms) ? perms.includes(p) : (perms as ReadonlySet<string>).has(p);

export function navForPermissions(perms: PermissionSet): NavItem[] {
  return NAV_ITEMS.filter((item) => item.anyOf.some((p) => has(perms, p)));
}

export const OWNER_HOME = "/dashboard";
export const BILLING_HOME = "/billing";
export const NO_ACCESS = "/no-access";

/**
 * Where a user lands after signing in.
 *  - Owner-level (can manage settings and see reports): the Owner Dashboard.
 *  - Anyone who can sell: Billing, straight away.
 *  - Otherwise the first workspace they may open, or the "no access" page.
 */
export function landingFor(perms: PermissionSet): string {
  if (has(perms, "settings.manage") && has(perms, "report.view")) return OWNER_HOME;
  if (has(perms, "sale.create")) return BILLING_HOME;
  return navForPermissions(perms)[0]?.href ?? NO_ACCESS;
}

/** May this user open the given path? Used by the server to refuse direct URL access. */
export function canOpen(perms: PermissionSet, pathname: string): boolean {
  if (pathname === OWNER_HOME || pathname.startsWith(`${OWNER_HOME}/`)) {
    return has(perms, "settings.manage") && has(perms, "report.view");
  }
  const item = NAV_ITEMS.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  if (!item) return false; // unknown paths are not silently allowed
  return item.anyOf.some((p) => has(perms, p));
}

// ---------------------------------------------------------------------------------------------
// DEMO ONLY (BILLING_BACKEND=demo): a fixed role -> permission map so the role-aware screens can be
// reviewed without a database. It mirrors the defaults seeded in the database, nothing more.
// ---------------------------------------------------------------------------------------------
export type Role = "owner" | "manager" | "cashier";

const CASHIER = ["sale.create", "payment.record", "product.view", "cash_session.manage"];
const MANAGER = [
  ...CASHIER,
  "sale.view",
  "sale.view_history",
  "sale.void",
  "sale.return",
  "discount.apply",
  "product.create",
  "product.edit",
  "inventory.view",
  "inventory.adjust",
  "purchase.manage",
  "metal_rate.view",
  "report.view",
  "customer.view",
  "customer.manage",
  "staff.manage",
];
const OWNER = [
  ...MANAGER,
  "payment.refund",
  "discount.override",
  "product.price_edit",
  "cost.view",
  "cost.manage",
  "metal_rate.set",
  "tax.manage",
  "report.export",
  "audit.view",
  "roles.manage",
  "branch.manage",
  "settings.manage",
];

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  cashier: CASHIER,
  manager: MANAGER,
  owner: OWNER,
};

export function can(role: Role, permission: string): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function navFor(role: Role): NavItem[] {
  return navForPermissions(ROLE_PERMISSIONS[role]);
}

/** @deprecated use landingFor(permissions). Kept for the demo screens. */
export const HOME_PATH = BILLING_HOME;
