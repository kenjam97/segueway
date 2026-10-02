import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { controlPlayback, exchangeCode, getPlayback } from "@/lib/server/spotify";
import { createSession, createState, getSession, store, type Session, SCOPES, SESSION_COOKIE, STATE_COOKIE } from "@/lib/server/store";
import { GET as login } from "@/app/api/auth/login/route";
import { GET as callback } from "@/app/api/auth/callback/route";
import { GET as playback, POST as command } from "@/app/api/playback/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as search } from "@/app/api/spotify/search/route";

const origin = "http://127.0.0.1:3000";
const session = (expired = false): Session => ({ tokens: { accessToken: "old-access", refreshToken: "secret-refresh", expiresAt: Date.now() + (expired ? -1000 : 3600_000) }, expiresAt: Date.now() + 3600_000 });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const noContent = () => new Response(null, { status: 204 });
const token = (refresh_token?: string) => json({ access_token: "new-access", expires_in: 3600, refresh_token, scope: SCOPES.join(" ") });
const request = (path: string, id?: string, body?: unknown, requestOrigin = origin) => new NextRequest(origin + path, { method: body !== undefined ? "POST" : "GET", headers: { host: new URL(origin).host, ...(id ? { cookie: `${SESSION_COOKIE}=${id}` } : {}), origin: requestOrigin, "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

beforeEach(() => {
  vi.stubEnv("SPOTIFY_CLIENT_ID", "client"); vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret"); vi.stubEnv("SPOTIFY_REDIRECT_URI", `${origin}/api/auth/callback`);
  store.sessions.clear(); store.states.clear(); store.cooldownUntil = 0; store.quotaExceeded = false;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Spotify service", () => {
  it.each(["play", "pause", "previous", "next"] as const)("accepts a successful empty 200 response for %s without parsing JSON", async (action) => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const id = createSession(session().tokens);
    const response = await command(request("/api/playback", id, { action }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("refreshes expired tokens, retains an omitted refresh token, and never caches requests", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(noContent()); vi.stubGlobal("fetch", fetch);
    const current = session(true);
    expect(await getPlayback(current)).toBeNull();
    expect(current.tokens.refreshToken).toBe("secret-refresh");
    expect(fetch.mock.calls[0][1].body.get("grant_type")).toBe("refresh_token");
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer new-access");
    expect(fetch.mock.calls.every((call) => call[1].cache === "no-store")).toBe(true);
  });
  it("coalesces concurrent refreshes and saves rotated refresh tokens", async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => url.includes("/api/token") ? token("rotated") : noContent()); vi.stubGlobal("fetch", fetch);
    const current = session(true);
    await Promise.all([getPlayback(current), getPlayback(current)]);
    expect(fetch.mock.calls.filter(([url]) => url.includes("/api/token"))).toHaveLength(1);
    expect(current.tokens.refreshToken).toBe("rotated");
  });
  it("refreshes after 401 and retries exactly once", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(token()).mockResolvedValueOnce(json({}, 401)); vi.stubGlobal("fetch", fetch);
    await expect(getPlayback(session())).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("rejects revoked refresh tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "invalid_grant" }, 400)));
    await expect(getPlayback(session(true))).rejects.toMatchObject({ status: 401, code: "REAUTHENTICATE" });
  });
  it("respects Retry-After across sessions without replaying a skip", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ error: { status: 429 } }, 429, { "Retry-After": "20" })); vi.stubGlobal("fetch", fetch);
    await expect(controlPlayback(session(), "next")).rejects.toMatchObject({ status: 429, retryAfter: 20 });
    await expect(getPlayback(session())).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("recognizes quota exhaustion without Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { reason: "QUOTA_EXCEEDED" } }, 429)));
    await expect(getPlayback(session())).rejects.toMatchObject({ status: 429, quotaExceeded: true, retryAfter: 3600 });
  });
  it("serializes commands and uses Spotify's documented methods", async () => {
    const fetch = vi.fn().mockImplementation(async () => noContent()); vi.stubGlobal("fetch", fetch);
    const current = session();
    await Promise.all([controlPlayback(current, "play"), controlPlayback(current, "pause"), controlPlayback(current, "previous"), controlPlayback(current, "next")]);
    expect(fetch.mock.calls.map(([url, init]) => [url.split("/").at(-1), init.method])).toEqual([["play", "PUT"], ["pause", "PUT"], ["previous", "POST"], ["next", "POST"]]);
  });
  it("returns only the normalized playback model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ is_playing: true, progress_ms: 123, device: { name: "Reception speaker", type: "Speaker", is_restricted: false }, item: { type: "track", name: "Song", artists: [{ name: "Artist" }], album: { images: [{ url: "https://i.scdn.co/image/example" }] }, duration_ms: 120000, external_urls: { spotify: "https://open.spotify.com/track/example" } }, actions: { disallows: { skipping_next: true } } })));
    const result = await getPlayback(session());
    expect(result).toMatchObject({ isPlaying: true, progressMs: 123, track: { name: "Song", artist: "Artist", durationMs: 120000 }, device: { name: "Reception speaker" }, disallowed: { skipping_next: true } });
    expect(JSON.stringify(result)).not.toContain("accessToken");
  });
  it("maps network failures and missing devices to useful errors", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("private upstream detail")).mockResolvedValueOnce(json({}, 404)); vi.stubGlobal("fetch", fetch);
    await expect(getPlayback(session())).rejects.toMatchObject({ status: 503, code: "UNAVAILABLE" });
    await expect(controlPlayback(session(), "play")).rejects.toMatchObject({ status: 404, code: "NO_DEVICE" });
  });
  it("does not accept a token lacking the requested scopes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ access_token: "x", refresh_token: "y", expires_in: 3600, scope: "user-read-playback-state" })));
    await expect(exchangeCode("code")).rejects.toMatchObject({ status: 401, code: "MISSING_SCOPES" });
  });
});

describe("authentication and HTTP boundary", () => {
  it("authenticates and validates track searches", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await search(request("/api/spotify/search?q=hello"))).status).toBe(401);
    const id = createSession(session().tokens);
    for (const query of ["", "q=hello&offset=-1", "q=hello&offset=1001", "q=hello&offset=no"]) expect((await search(request(`/api/spotify/search?${query}`, id))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("normalizes Spotify search metadata and uses encoded track-only pagination", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ tracks: { items: [{ id: "song", uri: "spotify:track:song", name: "Song", artists: [{ name: "One" }, { name: "Two" }], album: { name: "Album", images: [{ url: "https://i.scdn.co/image/mock" }] }, duration_ms: 120000 }], next: "https://api.spotify.com/v1/search?offset=20" } })); vi.stubGlobal("fetch", fetch);
    const id = createSession(session().tokens);
    const response = await search(request("/api/spotify/search?q=love%20%26%20joy&offset=10", id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tracks: [{ spotifyId: "song", uri: "spotify:track:song", name: "Song", artists: ["One", "Two"], albumName: "Album", artwork: "https://i.scdn.co/image/mock", durationMs: 120000 }], nextOffset: 20 });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get("q")).toBe("love & joy"); expect(url.searchParams.get("type")).toBe("track"); expect(url.searchParams.get("limit")).toBe("10");
  });
  it("refreshes search tokens and forwards rate limits without retrying", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(json({ error: { status: 429 } }, 429, { "Retry-After": "12" })); vi.stubGlobal("fetch", fetch);
    const id = createSession(session(true).tokens);
    const response = await search(request("/api/spotify/search?q=hello", id));
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("12"); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("requests only the three playback scopes with an HttpOnly state cookie", async () => {
    const response = await login(request("/api/auth/login"));
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("scope")?.split(" ")).toEqual(SCOPES);
    expect(response.cookies.get(STATE_COOKIE)?.httpOnly).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects mismatched OAuth state without exchanging the code", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const state = createState();
    const response = await callback(new NextRequest(`${origin}/api/auth/callback?state=wrong&code=code`, { headers: { cookie: `${STATE_COOKIE}=${state}` } }));
    expect(response.headers.get("location")).toContain("authError=state");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("creates an opaque session, keeps tokens server-side, and prevents callback replay", async () => {
    const fetch = vi.fn().mockResolvedValue(token("secret-refresh")); vi.stubGlobal("fetch", fetch);
    const state = createState();
    const req = new NextRequest(`${origin}/api/auth/callback?state=${state}&code=code`, { headers: { cookie: `${STATE_COOKIE}=${state}` } });
    const response = await callback(req);
    const cookie = response.cookies.get(SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe("lax"); expect(cookie.value).not.toContain("secret");
    expect(getSession(cookie.value)?.tokens.refreshToken).toBe("secret-refresh");
    expect(response.headers.get("location")).toBe(`${origin}/`);
    expect((await callback(req)).headers.get("location")).toContain("authError=state");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("denied consent never calls Spotify's token endpoint", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const state = createState();
    const response = await callback(new NextRequest(`${origin}/api/auth/callback?state=${state}&error=access_denied`, { headers: { cookie: `${STATE_COOKIE}=${state}` } }));
    expect(response.headers.get("location")).toContain("authError=denied"); expect(fetch).not.toHaveBeenCalled();
  });
  it("requires authentication and rejects cross-origin controls", async () => {
    expect((await playback(request("/api/playback"))).status).toBe(401);
    const id = createSession(session().tokens);
    expect((await command(request("/api/playback", id, { action: "next" }, "https://evil.example"))).status).toBe(403);
    expect((await command(request("/api/playback", id, { action: "volume" }))).status).toBe(400);
  });
  it("invalidates the server session and cookie on failed refresh", async () => {
    const id = createSession(session(true).tokens); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "invalid_grant" }, 400)));
    const response = await playback(request("/api/playback", id));
    expect(response.status).toBe(401); expect(getSession(id)).toBeNull(); expect(response.cookies.get(SESSION_COOKIE)?.maxAge).toBe(0);
  });
  it("logs out server-side and protects logout against CSRF", async () => {
    const id = createSession(session().tokens);
    expect((await logout(request("/api/auth/logout", id, {}, "https://evil.example"))).status).toBe(403);
    expect(getSession(id)).not.toBeNull();
    const response = await logout(request("/api/auth/logout", id, {}));
    expect(response.status).toBe(303); expect(getSession(id)).toBeNull(); expect(response.cookies.get(SESSION_COOKIE)?.maxAge).toBe(0);
  });
  it("expires sessions and enables Secure cookies for HTTPS", async () => {
    const id = createSession(session().tokens); getSession(id)!.expiresAt = Date.now() - 1;
    expect(getSession(id)).toBeNull();
    vi.stubEnv("SPOTIFY_REDIRECT_URI", "https://music.example/api/auth/callback");
    const response = await login(new NextRequest("https://music.example/api/auth/login"));
    expect(response.cookies.get(STATE_COOKIE)?.secure).toBe(true);
  });
});
