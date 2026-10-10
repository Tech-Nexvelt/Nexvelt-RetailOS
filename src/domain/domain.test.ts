import { describe, expect, it } from "vitest";
import { formatINR, parseRupees } from "./money";
import { isScannerBurst, looksLikeBarcode, normalizeCode } from "./barcode";
import { readFileSync } from "node:fs";
import { canOpen, landingFor, navFor, navForPermissions, ROLE_PERMISSIONS } from "./navigation";
import { BILLING_ERRORS } from "./errors";

describe("money", () => {
  it("formats paise with Indian digit grouping", () => {
    expect(formatINR(12345678)).toBe("₹1,23,456.78");
    expect(formatINR(0)).toBe("₹0.00");
  });

  it("parses typed rupees to paise without floating point drift", () => {
    expect(parseRupees("1,299")).toBe(129900);
    expect(parseRupees("₹ 10.05")).toBe(1005);
    expect(parseRupees("0.1")).toBe(10);
    expect(parseRupees("19.99")).toBe(1999);
  });

  it("rejects negative, malformed or over-precise input", () => {
    for (const bad of ["", "-5", "abc", "1.234", "1..2", "12e3"]) {
      expect(parseRupees(bad)).toBeNull();
    }
  });
});

describe("barcode helpers", () => {
  it("normalises scanner output", () => {
    expect(normalizeCode(" nr00000001\r\n")).toBe("NR00000001");
  });

  it("recognises barcode-shaped values", () => {
    expect(looksLikeBarcode("NR00000001")).toBe(true);
    expect(looksLikeBarcode("NR 1")).toBe(false);
    expect(looksLikeBarcode("AB")).toBe(false);
  });

  it("detects scanner bursts by key speed", () => {
    expect(isScannerBurst([0, 10, 20, 30, 40])).toBe(true);
    expect(isScannerBurst([0, 120, 260, 400, 520])).toBe(false);
    expect(isScannerBurst([0, 10, 20])).toBe(false);
  });
});

describe("navigation and landing pages", () => {
  it("shows a cashier only Billing by default", () => {
    expect(navFor("cashier").map((n) => n.key)).toEqual(["billing"]);
  });

  it("adds Sales for a cashier only when explicitly permitted", () => {
    const withSales = [...ROLE_PERMISSIONS.cashier, "sale.view"];
    expect(navForPermissions(withSales).map((n) => n.key)).toEqual(["billing", "sales"]);
  });

  it("shows owners all five workspaces in order, and never more than five items", () => {
    expect(navFor("owner").map((n) => n.key)).toEqual([
      "billing",
      "products",
      "sales",
      "reports",
      "settings",
    ]);
    for (const role of ["owner", "manager", "cashier"] as const) {
      expect(navFor(role).length).toBeLessThanOrEqual(5);
    }
  });

  it("gives managers day-to-day workspaces but not the owner dashboard", () => {
    const keys = navFor("manager").map((n) => n.key);
    expect(keys).toEqual(["billing", "products", "sales", "reports", "settings"]);
    expect(landingFor(ROLE_PERMISSIONS.manager)).toBe("/billing");
  });

  it("sends the owner to the dashboard and a cashier straight to Billing", () => {
    expect(landingFor(ROLE_PERMISSIONS.owner)).toBe("/dashboard");
    expect(landingFor(ROLE_PERMISSIONS.cashier)).toBe("/billing");
  });

  it("finds a landing page for odd permission sets, and refuses when there is nothing", () => {
    expect(landingFor(["report.view"])).toBe("/reports");
    expect(landingFor(["inventory.view"])).toBe("/products");
    expect(landingFor(["product.view"])).toBe("/no-access"); // searching products is not a workspace
    expect(landingFor([])).toBe("/no-access");
  });

  it("refuses direct URL access to workspaces the user may not open", () => {
    const cashier = ROLE_PERMISSIONS.cashier;
    expect(canOpen(cashier, "/billing")).toBe(true);
    for (const path of [
      "/dashboard",
      "/reports",
      "/settings",
      "/settings/staff",
      "/products",
      "/sales",
      "/reports/sales",
    ]) {
      expect(canOpen(cashier, path), path).toBe(false);
    }
    expect(canOpen(ROLE_PERMISSIONS.owner, "/dashboard")).toBe(true);
    expect(canOpen(ROLE_PERMISSIONS.manager, "/dashboard")).toBe(false);
  });

  it("does not allow unknown paths or look-alike prefixes", () => {
    for (const path of ["/admin", "/billing-secret", "/dashboardx", "/api/anything", "/"]) {
      expect(canOpen(ROLE_PERMISSIONS.owner, path), path).toBe(false);
    }
  });

  it("treats Set and array permission lists the same", () => {
    expect(navForPermissions(new Set(["sale.create"])).map((n) => n.key)).toEqual(["billing"]);
  });

  it("keeps the demo role map identical to the defaults seeded in the database", () => {
    const sql = readFileSync("supabase/migrations/20261010100002_tenancy.sql", "utf8");
    const seeded = (role: string) => {
      const m = new RegExp(String.raw`on p\.key in \(([^)]*)\)\s*where r\.key = '${role}'`).exec(
        sql,
      );
      if (!m) throw new Error("seed not found for " + role);
      return [...(m[1] as string).matchAll(/'([a-z_.]+)'/g)].map((x) => x[1] as string).sort();
    };
    expect([...ROLE_PERMISSIONS.cashier].sort()).toEqual(seeded("cashier"));
    // the database lists the manager's permissions in full; the demo builds them on top of the cashier's
    expect([...new Set(ROLE_PERMISSIONS.manager)].sort()).toEqual(seeded("branch_manager"));
  });
});

describe("error messages", () => {
  it("gives every error a title and a next step", () => {
    for (const e of Object.values(BILLING_ERRORS)) {
      expect(e.title.length).toBeGreaterThan(5);
      expect(e.fix.length).toBeGreaterThan(5);
    }
  });
});
