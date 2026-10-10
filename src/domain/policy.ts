import type { Role } from "./navigation";

/**
 * Maximum line discount a role may give without a manager approval, in basis points (100 = 1%).
 *
 * The client has NOT yet decided discount limits for managers and cashiers (OQ-21), so they get
 * zero and every discount for them is refused. Only the owner, who sets prices anyway, is
 * unrestricted. These values must be replaced by per-tenant configuration (`role_discount_limits`,
 * DATABASE_DESIGN §4.6) when the database layer lands.
 */
export const DISCOUNT_LIMIT_BPS: Record<Role, number> = {
  owner: 10000,
  manager: 0,
  cashier: 0,
};

export interface ActorPolicy {
  maxDiscountBps: number;
}

export function policyFor(role: Role): ActorPolicy {
  return { maxDiscountBps: DISCOUNT_LIMIT_BPS[role] };
}

/** No discounts unless the caller is explicitly given authority. */
export const NO_DISCOUNT_AUTHORITY: ActorPolicy = { maxDiscountBps: 0 };
