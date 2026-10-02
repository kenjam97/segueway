import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/live/route";
import { liveSnapshot, liveCommand, livePlayback, remoteControl } from "@/lib/server/live";
import { createSession, getSession, store, SESSION_COOKIE, type Session } from "@/lib/server/store";
import type { Event } from "@/lib/events/model";
import { LEGACY_QUEUE_ERROR } from "@/lib/live/machine";

const origin = "http://127.0.0.1:3000";
const event: Event = { id: "wedding", name: "Wedding", sections: ["a", "b"].map((id, i) => ({ id, name: id, playbackMode: i ? "once" : "loop", tracks: [{ entryId: id, spotifyId: id, uri: `spotify:track:${id}`, name: id, artists: ["Artist"], durationMs: 60_000, artwork: null, albumName: "Album" }] })) };
let id: string;
let owner: Session;
let current: { uri: string; progress: number; playing: boolean; timestamp: number; device: string };
let fetchMock: ReturnType<typeof vi.fn>;
let starts: number;
let requestCounter = 0;
let queue: unknown[];
let queuePersists = false;
let rateLimit = false;
let uncertainStart = false;
let progressFromClock = false;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const request = (body?: unknown, cookie = id, requestOrigin = origin) => new NextRequest(`${origin}/api/live`, { method: body === undefined ? "GET" : "POST", headers: { origin: requestOrigin, host: "127.0.0.1:3000", cookie: `${SESSION_COOKIE}=${cookie}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const command = (action: string, extra: object = {}) => { const state = liveSnapshot(owner); return { action, requestId: `request-${++requestCounter}`, runId: state?.runId, revision: state?.revision, ...extra }; };
async function start() {
  const response = await POST(request(command("start", { event, section: 0, confirmed: true })));
  expect(response.status).toBe(200);
  await vi.advanceTimersByTimeAsync(750);
  expect(liveSnapshot(owner)?.phase).toBe("playing");
  return liveSnapshot(owner)!;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  vi.stubEnv("SPOTIFY_CLIENT_ID", "client"); vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret"); vi.stubEnv("SPOTIFY_REDIRECT_URI", `${origin}/api/auth/callback`);
  store.sessions.clear(); store.cooldownUntil = 0; store.quotaExceeded = false;
  id = createSession({ accessToken: "private-access", refreshToken: "private-refresh", expiresAt: Date.now() + 3600_000 }); owner = getSession(id)!;
  current = { uri: "spotify:track:old", progress: 0, playing: true, timestamp: 99_000, device: "speaker" };
  starts = 0; queue = []; queuePersists = false; rateLimit = false; uncertainStart = false; progressFromClock = false;
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    if (rateLimit) return json({ error: {} }, 429, { "Retry-After": "30" });
    if (parsed.pathname.endsWith("/queue")) return json({ queue });
    if (parsed.pathname.endsWith("/play") && init.body) {
      starts++; current = { ...current, uri: JSON.parse(String(init.body)).uris[0], playing: true, progress: 0, timestamp: Date.now() };
      if (!queuePersists) queue = [];
      if (uncertainStart) throw new Error("Lost response after Spotify accepted start");
    }
    if (init.method !== "GET") return new Response(null, { status: 204 });
    return json({ is_playing: current.playing, progress_ms: progressFromClock && current.playing ? Math.min(60_000, Date.now() - current.timestamp) : current.progress, timestamp: current.timestamp, repeat_state: "off", shuffle_state: false,
      device: { id: current.device, name: "Speaker", type: "Speaker", is_restricted: false }, item: { type: "track", id: current.uri.split(":").at(-1), uri: current.uri, name: current.uri, duration_ms: 60_000, artists: [{ name: "Artist" }], album: { images: [] } } });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  const state = liveSnapshot(owner);
  if (state) await liveCommand(owner, { action: "end", requestId: `cleanup-${++requestCounter}`, runId: state.runId, revision: state.revision });
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe("live runner and routes", () => {
  it("rejects unauthenticated, cross-origin and invalid configuration requests", async () => {
    expect((await GET(request(undefined, "missing"))).status).toBe(401);
    expect((await POST(request(command("start"), id, "https://other.example"))).status).toBe(403);
    expect((await POST(request(command("start", { event: { ...event, sections: [{}] }, section: 0, confirmed: true })))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("starts one URI, takes a frozen snapshot, and shares observations across browser views", async () => {
    const state = await start();
    const count = fetchMock.mock.calls.length;
    await GET(request()); await GET(request()); await livePlayback(owner);
    expect(fetchMock.mock.calls).toHaveLength(count);
    const issued = fetchMock.mock.calls.find(([url, init]) => url.includes("/play?") && init.body)!;
    expect(JSON.parse(String(issued[1].body))).toEqual({ uris: ["spotify:track:a"], position_ms: 0 });
    expect(issued[0]).toContain("device_id=speaker");
    expect(state.event).not.toBe(event);
    expect(JSON.stringify(await (await GET(request())).json())).not.toContain("private-");
  });
  it("advances autonomously through a queued boundary and confirms the next track", async () => {
    await start();
    await POST(request(command("cue")));
    current.progress = 59_000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toBe(1);
    current.progress = 60_000; current.playing = false;
    await vi.advanceTimersByTimeAsync(750);
    expect(starts).toBe(2); expect(liveSnapshot(owner)?.phase).toBe("transitioning");
    await vi.advanceTimersByTimeAsync(750);
    expect(liveSnapshot(owner)?.cursor.section).toBe(1);
    expect(liveSnapshot(owner)?.transitionTiming?.approximateGapMs).not.toBeNull();
  });
  it("waits for two reset observations before issuing a queued transition", async () => {
    progressFromClock = true;
    await start(); await POST(request(command("cue")));
    await vi.advanceTimersByTimeAsync(59_000);
    current.progress = 0; current.playing = false;
    await vi.advanceTimersByTimeAsync(750);
    expect(starts).toBe(1); expect(liveSnapshot(owner)?.endCandidate).toBeTruthy();
    await vi.advanceTimersByTimeAsync(750);
    expect(starts).toBe(2); expect(liveSnapshot(owner)?.pending?.target.section).toBe(1);
    await vi.advanceTimersByTimeAsync(750);
    expect(liveSnapshot(owner)?.phase).toBe("playing"); expect(liveSnapshot(owner)?.cursor.section).toBe(1);
  });
  it("waits after Once completion until a confirmed next section command", async () => {
    const config: Event = { ...event, sections: event.sections.map(section => ({ ...section, playbackMode: "once" })) };
    expect((await POST(request(command("start", { event: config, section: 0, confirmed: true })))).status).toBe(200);
    await vi.advanceTimersByTimeAsync(750);
    current.progress = 59_000; await vi.advanceTimersByTimeAsync(10_000);
    current.progress = 60_000; current.playing = false; await vi.advanceTimersByTimeAsync(750);
    expect(starts).toBe(1); expect(liveSnapshot(owner)?.phase).toBe("section_complete");
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await GET(request())).status).toBe(200);
    expect(starts).toBe(1); expect(liveSnapshot(owner)?.phase).toBe("section_complete");
    expect((await POST(request(command("go_now")))).status).toBe(400);
    expect(starts).toBe(1);
    expect((await POST(request(command("go_now", { confirmed: true })))).status).toBe(200);
    expect(starts).toBe(2); expect(liveSnapshot(owner)?.pending?.target).toMatchObject({ section: 1, track: 0 });
    await vi.advanceTimersByTimeAsync(750);
    expect(liveSnapshot(owner)?.cursor.section).toBe(1);
    current.progress = 59_000; await vi.advanceTimersByTimeAsync(10_000);
    current.progress = 60_000; current.playing = false; await vi.advanceTimersByTimeAsync(750);
    expect(liveSnapshot(owner)?.phase).toBe("section_complete"); expect(starts).toBe(2);
  });
  it("rejects a stale cancellation after transition commit", async () => {
    await start(); await POST(request(command("cue")));
    const cancellation = command("cancel");
    current.progress = 59_000; await vi.advanceTimersByTimeAsync(10_000);
    current.progress = 60_000; current.playing = false; await vi.advanceTimersByTimeAsync(750);
    expect((await POST(request(cancellation))).status).toBe(409);
    expect(liveSnapshot(owner)?.pending?.target.section).toBe(1);
  });
  it("deduplicates GO NOW requests even after the state revision changes", async () => {
    await start();
    const immediate = command("go_now", { confirmed: true });
    expect((await POST(request(immediate))).status).toBe(200);
    expect((await POST(request(immediate))).status).toBe(200);
    expect(starts).toBe(2);
  });
  it("requires deliberate confirmation for GO NOW", async () => {
    await start(); expect((await POST(request(command("go_now")))).status).toBe(400); expect(starts).toBe(1);
  });
  it("allows the previous album/playlist queue to be replaced by a single-track start", async () => {
    queue = [{ uri: "spotify:track:album-next" }];
    await start();
    expect(starts).toBe(1); expect(liveSnapshot(owner)?.phase).toBe("playing");
    const calls = fetchMock.mock.calls.map(([url]) => url);
    expect(calls.some(url => url.includes("/queue"))).toBe(false);
  });
  it("keeps cue and GO NOW available when Spotify reports an ambiguous non-empty queue", async () => {
    queue = [{ uri: "spotify:track:queued" }]; queuePersists = true;
    await start();
    expect((await POST(request(command("cue")))).status).toBe(200);
    expect(liveSnapshot(owner)?.phase).toBe("next_section_queued");
    expect((await POST(request(command("go_now", { confirmed: true })))).status).toBe(200);
    expect(starts).toBe(2);
  });
  it("repairs the previous queue guard on reload without restarting the current audio", async () => {
    await start();
    Object.assign(liveSnapshot(owner)!, { phase: "recovery", message: LEGACY_QUEUE_ERROR, expectedEnd: null });
    expect((await GET(request())).status).toBe(200);
    expect(liveSnapshot(owner)?.phase).toBe("playing");
    expect(liveSnapshot(owner)?.message).toBeNull(); expect(starts).toBe(1);
    const count = fetchMock.mock.calls.length;
    await GET(request()); expect(fetchMock.mock.calls).toHaveLength(count);
  });
  it("rate limiting stops the short burst and waits Retry-After before another API call", async () => {
    await start(); current.progress = 59_000; await vi.advanceTimersByTimeAsync(10_000);
    rateLimit = true; await vi.advanceTimersByTimeAsync(750);
    expect(liveSnapshot(owner)?.phase).toBe("recovery");
    const count = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(29_999); expect(fetchMock.mock.calls).toHaveLength(count);
    rateLimit = false; await vi.advanceTimersByTimeAsync(1); expect(fetchMock.mock.calls.length).toBe(count + 1);
    expect(starts).toBe(1); expect(liveSnapshot(owner)?.phase).toBe("recovery");
  });
  it("an uncertain accepted start is observed without replaying the command", async () => {
    uncertainStart = true;
    const response = await POST(request(command("start", { event, section: 0, confirmed: true })));
    expect(response.status).toBe(200); expect(liveSnapshot(owner)?.phase).toBe("recovery");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(liveSnapshot(owner)?.phase).toBe("playing"); expect(starts).toBe(1);
  });
  it("a manual remote skip suspends live automation", async () => {
    await start(); await remoteControl(owner, "next");
    expect(liveSnapshot(owner)?.phase).toBe("recovery"); expect(starts).toBe(1);
  });
});
