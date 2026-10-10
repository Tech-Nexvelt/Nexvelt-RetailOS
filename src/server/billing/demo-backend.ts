import type { ActorPolicy } from "@/domain/policy";
import type { BillingBackend } from "./backend";
import type { BillingEngine } from "./engine";

/** Adapts the in-memory DEMO engine to the backend interface. Development use only. */
export class DemoBillingBackend implements BillingBackend {
  constructor(
    private readonly engine: BillingEngine,
    private readonly policy: ActorPolicy,
  ) {}
  getSession = async () => ({ ok: true as const, data: this.engine.getSession() });
  startDay = async (float: number) => this.engine.openSession(float);
  scan = async (code: string, cart: Parameters<BillingEngine["scan"]>[1]) =>
    this.engine.scan(code, cart, this.policy);
  search = async (q: string) => ({ ok: true as const, data: this.engine.search(q) });
  addItem = async (id: string, cart: Parameters<BillingEngine["addItem"]>[1]) =>
    this.engine.addItem(id, cart, this.policy);
  quote = async (cart: Parameters<BillingEngine["quote"]>[0]) => ({
    ok: true as const,
    data: this.engine.quote(cart, this.policy),
  });
  checkout = async (input: Parameters<BillingEngine["checkout"]>[0]) =>
    this.engine.checkout(input, this.policy);
}
