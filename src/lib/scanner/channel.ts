/**
 * Thin wrapper around a Supabase Realtime Broadcast channel with automatic re-subscription.
 * The channel name is NOT a credential: every message on it is authenticated (HMAC) and verified by the billing computer's server
 * check before it is used, so knowing or guessing the name grants nothing beyond being able to send messages that are discarded.
 * Camera frames, prices, stock and payments never travel on this channel.
 */
import { BROADCAST_EVENT, channelName } from "./protocol";

export interface ChannelLike {
  on(type: "broadcast", filter: { event: string }, cb: (p: { payload: unknown }) => void): ChannelLike;
  subscribe(cb?: (status: string) => void): ChannelLike;
  send(m: { type: "broadcast"; event: string; payload: unknown }): Promise<unknown> | unknown;
}
export interface RealtimeClient {
  channel(name: string, opts?: unknown): ChannelLike;
  removeChannel(ch: ChannelLike): Promise<unknown> | unknown;
}

export interface OpenChannel {
  send(payload: unknown): void;
  close(): void;
}

export interface ChannelHandlers {
  onPayload(payload: unknown): void;
  /** true when the channel is subscribed, false when it dropped. Called only on changes. */
  onTransport(up: boolean): void;
}

export function openScanChannel(
  client: RealtimeClient,
  sid: string,
  h: ChannelHandlers,
  timers: { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void } = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) },
): OpenChannel {
  let ch: ChannelLike | null = null;
  let closed = false;
  let up = false;
  let attempt = 0;
  let retry: unknown = null;
  let generation = 0;

  const setUp = (v: boolean) => {
    if (up !== v) {
      up = v;
      h.onTransport(v);
    }
  };

  const connect = () => {
    if (closed) return;
    const mine = ++generation;
    const c = client.channel(channelName(sid), { config: { broadcast: { self: false } } });
    ch = c;
    c.on("broadcast", { event: BROADCAST_EVENT }, ({ payload }) => {
      if (!closed && mine === generation) h.onPayload(payload);
    });
    c.subscribe((status) => {
      if (closed || mine !== generation) return; // stale callback from a channel we already replaced
      if (status === "SUBSCRIBED") {
        attempt = 0;
        setUp(true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setUp(false);
        if (retry === null) {
          retry = timers.set(() => {
            retry = null;
            if (closed) return;
            const old = ch;
            if (old) void Promise.resolve(client.removeChannel(old)).catch(() => {});
            connect();
          }, Math.min(15_000, 1000 * 2 ** attempt++));
        }
      }
    });
  };
  connect();

  return {
    send(payload) {
      if (closed || !ch || !up) return; // the controllers resend unacknowledged events after reconnect
      void Promise.resolve(ch.send({ type: "broadcast", event: BROADCAST_EVENT, payload })).catch(() => setUp(false));
    },
    close() {
      closed = true;
      if (retry !== null) timers.clear(retry);
      const old = ch;
      ch = null;
      if (old) void Promise.resolve(client.removeChannel(old)).catch(() => {});
    },
  };
}
