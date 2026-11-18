import { API_URL } from './config';
import type { Arrival, IngestResult, Network, Ping, TravelTable, VehicleView } from './core';

/** A bus its owner registered, shared by one of the owner's conductors signed in. */
export type OwnedBus = { plate: string; owner: string };

/** Who signs in: an owner's people, a route syndicate, or a contributor who records routes. */
export type AccountKind = 'owner' | 'manager' | 'conductor' | 'syndicate' | 'contributor';
export type Me = { kind: AccountKind; name: string; phoneEnd: string | null; owner: string | null };

/** A recording as the contributor sees it while and after riding. */
export type RecordingInfo = { id: string; name: string; startedAt: number; finishedAt?: number; points: number; halts: number; marks: number; lengthM?: number; minutes?: number };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 8000, key?: string): Promise<{ status: number; body: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    });
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

export const api = {
  /** The full network, or "unchanged" when the app already has this version. */
  async network(since?: number): Promise<Network | 'unchanged'> {
    const r = await request<Network>(`/api/network${since ? `?since=${since}` : ''}`, {}, 20_000);
    return r.status === 304 || !r.body ? 'unchanged' : r.body;
  },

  async arrivals(stopIds: string[]): Promise<Record<string, Arrival[]>> {
    const r = await request<{ arrivals: Record<string, Arrival[]> }>(
      `/api/arrivals?stops=${stopIds.map(encodeURIComponent).join(',')}`,
    );
    return r.body?.arrivals ?? {};
  },

  async vehicles(patternId: string): Promise<VehicleView[]> {
    const r = await request<{ vehicles: VehicleView[] }>(`/api/patterns/${encodeURIComponent(patternId)}/vehicles`);
    return r.body?.vehicles ?? [];
  },

  /**
   * A conductor shares as one signed in (`key`), giving the bus's number plate: `bus` says which of
   * their owner's buses it is, and the owner sees its trips. A rider may give the plate's last digits.
   */
  async startTrip(
    input: { patternId: string; role: 'rider' | 'conductor'; plate?: string },
    key?: string,
  ): Promise<{ sessionId: string; role: 'rider' | 'conductor'; bus?: OwnedBus }> {
    const r = await request<{ sessionId: string; role: 'rider' | 'conductor'; bus?: OwnedBus }>('/api/trips', post(input), 8000, key);
    if (!r.body) throw new ApiError(r.status, 'The server did not start the trip.');
    return r.body;
  },

  /** "sentAt" lets the server correct a phone whose clock is wrong; "ts" uses the same clock. */
  async sendPings(sessionId: string, pings: Ping[]): Promise<IngestResult> {
    const r = await request<IngestResult>(
      `/api/trips/${encodeURIComponent(sessionId)}/pings`,
      post({ pings, sentAt: Date.now() }),
    );
    if (!r.body) throw new ApiError(r.status, 'The server did not accept the locations.');
    return r.body;
  },

  async endTrip(sessionId: string): Promise<void> {
    await request(`/api/trips/${encodeURIComponent(sessionId)}/end`, { method: 'POST' });
  },

  /** "This route just passed this stop", from someone waiting there; it counts once another agrees. */
  async report(patternId: string, stopId: string, device: string): Promise<{ accepted: boolean; agreed: boolean; repeat: boolean }> {
    const r = await request<{ accepted: boolean; agreed: boolean; repeat: boolean }>('/api/reports', post({ patternId, stopId, device }));
    if (!r.body) throw new ApiError(r.status, 'The server did not take the report.');
    return r.body;
  },

  /** A suggested fix for the people who keep the routes right. */
  async suggest(input: { kind: string; text: string; routeId?: string; stopId?: string }): Promise<void> {
    await request('/api/corrections', post(input));
  },

  /** A link for family to follow this trip's bus. */
  async shareTrip(sessionId: string, destStopId: string | null): Promise<{ token: string; path: string }> {
    const r = await request<{ token: string; path: string }>(`/api/trips/${encodeURIComponent(sessionId)}/share`, post({ destStopId }));
    if (!r.body) throw new ApiError(r.status, 'The link could not be made.');
    return r.body;
  },

  // ---- Accounts: the same sign-in as /signin on the website ----

  async signIn(phone: string, password: string): Promise<{ key?: string; kind: AccountKind; mustChange?: boolean; changeToken?: string }> {
    const r = await request<{ key?: string; kind: AccountKind; mustChange?: boolean; changeToken?: string }>('/api/accounts/sign-in', post({ phone, password }));
    if (!r.body) throw new ApiError(r.status, 'The server did not answer.');
    return r.body;
  },

  /** After a temporary password: one of their own. */
  async choosePassword(changeToken: string, password: string): Promise<{ key: string; kind: AccountKind }> {
    const r = await request<{ key: string; kind: AccountKind }>('/api/accounts/password', post({ changeToken, password }));
    if (!r.body) throw new ApiError(r.status, 'The server did not answer.');
    return r.body;
  },

  async signUp(input: { kind: 'conductor' | 'contributor'; name: string; phone: string; password: string; ownerPhone?: string }): Promise<{ ownerName?: string }> {
    const r = await request<{ ownerName?: string }>('/api/accounts/sign-up', post(input));
    return r.body ?? {};
  },

  async me(key: string): Promise<Me> {
    const r = await request<Me>('/api/accounts/me', {}, 8000, key);
    if (!r.body) throw new ApiError(r.status, 'The server did not answer.');
    return r.body;
  },

  async signOut(key: string): Promise<void> {
    await request('/api/accounts/sign-out', { method: 'POST' }, 8000, key);
  },

  // ---- Contributors recording a route (the admins check it before anything changes) ----

  async recordings(key: string): Promise<RecordingInfo[]> {
    const r = await request<{ recordings: RecordingInfo[] }>('/api/contributor/recordings', {}, 8000, key);
    return r.body?.recordings ?? [];
  },

  async createRecording(key: string, name: string): Promise<RecordingInfo> {
    const r = await request<{ recording: RecordingInfo }>('/api/contributor/recordings', post({ name }), 8000, key);
    if (!r.body) throw new ApiError(r.status, 'The recording could not start.');
    return r.body.recording;
  },

  async addRecordingPoints(key: string, id: string, points: { lat: number; lng: number; accuracy?: number; ts: number }[]): Promise<number> {
    const r = await request<{ points: number }>(`/api/contributor/recordings/${encodeURIComponent(id)}/points`, post({ points }), 15_000, key);
    return r.body?.points ?? 0;
  },

  async markStop(key: string, id: string, mark: { lat: number; lng: number; ts: number; name?: string }): Promise<number> {
    const r = await request<{ marks: number }>(`/api/contributor/recordings/${encodeURIComponent(id)}/marks`, post(mark), 8000, key);
    return r.body?.marks ?? 0;
  },

  async finishRecording(key: string, id: string): Promise<{ lengthM?: number; minutes?: number; halts: unknown[] }> {
    const r = await request<{ recording: { lengthM?: number; minutes?: number; halts: unknown[] } }>(`/api/contributor/recordings/${encodeURIComponent(id)}/finish`, { method: 'POST' }, 20_000, key);
    if (!r.body) throw new ApiError(r.status, 'The recording could not be finished.');
    return r.body.recording;
  },

  async deleteRecording(key: string, id: string): Promise<void> {
    await request(`/api/contributor/recordings/${encodeURIComponent(id)}`, { method: 'DELETE' }, 8000, key);
  },

  /** Learned travel times for this hour, for planning with them. */
  async travelTimes(): Promise<TravelTable> {
    const r = await request<TravelTable>('/api/travel-times');
    if (!r.body) throw new ApiError(r.status, 'No travel times.');
    return r.body;
  },
};
