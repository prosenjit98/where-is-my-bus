import type { Arrival, IngestResult, Network, Ping, TravelTable, VehicleView } from './core.ts';

// The same server as the phone app, on the same address as this page.

/** A bus its owner registered, shared by one of their conductors. */
export type OwnedBus = { plate: string; owner: string };

/** Who a sign-in key from /signin signs in (GET /api/accounts/me). `owner`: the owner's name, for their staff and the owner. */
export type Me = { kind: 'owner' | 'manager' | 'conductor' | 'syndicate' | 'contributor'; name: string; phoneEnd: string | null; owner: string | null };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<{ status: number; body: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) } });
    if (res.status === 304) return { status: 304, body: null };
    const text = await res.text();
    const body = text ? (JSON.parse(text) as T & { error?: string }) : null;
    if (!res.ok) throw new ApiError(res.status, body?.error ?? `The server answered ${res.status}.`);
    return { status: res.status, body };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'No connection to the server.');
  } finally {
    clearTimeout(timer);
  }
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const signedIn = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` });

export const api = {
  /** The full network, or "unchanged" when this copy is already the latest. */
  async network(since?: number): Promise<Network | 'unchanged'> {
    const r = await request<Network>(`/api/network${since ? `?since=${since}` : ''}`, {}, 20_000);
    return r.status === 304 || !r.body ? 'unchanged' : r.body;
  },

  async arrivals(stopIds: string[]): Promise<Record<string, Arrival[]>> {
    const r = await request<{ arrivals: Record<string, Arrival[]> }>(`/api/arrivals?stops=${stopIds.map(encodeURIComponent).join(',')}`);
    return r.body?.arrivals ?? {};
  },

  /** Learned travel times for this hour, to plan with. */
  async travelTimes(): Promise<TravelTable> {
    const r = await request<TravelTable>('/api/travel-times');
    if (!r.body) throw new ApiError(r.status, 'No travel times.');
    return r.body;
  },

  async vehicles(patternId: string): Promise<VehicleView[]> {
    const r = await request<{ vehicles: VehicleView[] }>(`/api/patterns/${encodeURIComponent(patternId)}/vehicles`);
    return r.body?.vehicles ?? [];
  },

  /** The buses on these directions, pushed as they move; null where the browser has no EventSource. */
  liveVehicles(patternIds: string[], onVehicles: (vehicles: VehicleView[]) => void): EventSource | null {
    if (typeof EventSource !== 'function') return null;
    const stream = new EventSource(`/api/live?patterns=${patternIds.map(encodeURIComponent).join(',')}`);
    stream.addEventListener('vehicles', (e) => {
      try {
        onVehicles((JSON.parse((e as MessageEvent<string>).data) as { vehicles: VehicleView[] }).vehicles);
      } catch {
        // A broken event is skipped; the next one replaces it.
      }
    });
    return stream;
  },

  /**
   * A rider's trip, with the last 4 digits of the plate if they typed them; or a conductor's, signed
   * in (`key`) and with the whole plate of one of their owner's buses. `bus` then says which bus it
   * is and whose: its owner sees its trips.
   */
  async startTrip(
    input: { patternId: string; role: 'rider' | 'conductor'; plate?: string },
    key?: string,
  ): Promise<{ sessionId: string; role: 'rider' | 'conductor'; bus?: OwnedBus }> {
    const init = post(input);
    if (key) init.headers = signedIn(key);
    const r = await request<{ sessionId: string; role: 'rider' | 'conductor'; bus?: OwnedBus }>('/api/trips', init);
    if (!r.body) throw new ApiError(r.status, 'The server did not start the trip.');
    return r.body;
  },

  /** Who the key from /signin signs in. */
  async me(key: string): Promise<Me> {
    const r = await request<Me>('/api/accounts/me', { headers: signedIn(key) });
    if (!r.body) throw new ApiError(r.status, 'The server did not say who is signed in.');
    return r.body;
  },

  async signOut(key: string): Promise<void> {
    await request('/api/accounts/sign-out', { method: 'POST', headers: signedIn(key) });
  },

  /**
   * Positions carry the browser's clock in "ts", and "sentAt" lets the server correct a wrong clock.
   * `last`: the final positions as the trip ends, sent even if the page is closed straight after.
   */
  async sendPings(sessionId: string, pings: Ping[], last = false): Promise<IngestResult> {
    const r = await request<IngestResult>(`/api/trips/${encodeURIComponent(sessionId)}/pings`, { ...post({ pings, sentAt: Date.now() }), keepalive: last });
    if (!r.body) throw new ApiError(r.status, 'The server did not accept the locations.');
    return r.body;
  },

  async endTrip(sessionId: string): Promise<void> {
    // Kept alive, so the trip ends on the server even when the conductor closes the page at once.
    await request(`/api/trips/${encodeURIComponent(sessionId)}/end`, { method: 'POST', keepalive: true });
  },

  /** "This bus just passed this stop", from someone without location. `agreed`: another rider, or a tracked bus, says the same. */
  async report(patternId: string, stopId: string, device: string): Promise<{ accepted: boolean; agreed: boolean; repeat: boolean }> {
    const r = await request<{ accepted: boolean; agreed: boolean; repeat: boolean }>('/api/reports', post({ patternId, stopId, device }));
    if (!r.body) throw new ApiError(r.status, 'The server did not take the report.');
    return r.body;
  },

  /** A suggested fix for the admins. */
  async suggest(input: { kind: string; text: string; routeId?: string; stopId?: string }): Promise<void> {
    await request('/api/corrections', post(input));
  },

  /** A link for family to follow the bus, with the rider's stop for the arrival time. */
  async shareTrip(sessionId: string, destStopId: string | null): Promise<{ token: string; path: string }> {
    const r = await request<{ token: string; path: string }>(`/api/trips/${encodeURIComponent(sessionId)}/share`, post({ destStopId }));
    if (!r.body) throw new ApiError(r.status, 'The server did not make a link.');
    return r.body;
  },
};
